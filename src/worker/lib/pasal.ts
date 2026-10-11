/**
 * Klien API pasal.id.
 *
 * Bentuk respons di bawah ini sudah diverifikasi dengan token sungguhan
 * (`npm run verify:pasal`), bukan tebakan:
 *
 *   GET /laws    -> { total, limit, offset, laws: [{ id, frbr_uri, title,
 *                     number, year, status, type, issuing_body,
 *                     content_verified }] }
 *   GET /search  -> { query, total, results: [{ work_id, snippet, score,
 *                     matching_pasals, total_chunks }] }
 *
 * Dua hal yang penting diingat:
 *
 * 1. Paginasi memakai `limit`/`offset`, BUKAN `page`/`per_page`. Parameter yang
 *    salah nama diabaikan diam-diam — permintaan tetap dijawab 200 dengan 20
 *    record pertama, sehingga penyapuan bisa berputar di tempat tanpa terlihat
 *    gagal sama sekali.
 * 2. `/search` tidak mengembalikan metadata peraturan, hanya `work_id` dan
 *    cuplikan. Ia tidak dipakai jalur ingest; untuk memperoleh dokumen tetap
 *    harus lewat `/laws`.
 *
 * Pemetaan field tetap ditulis defensif (menerima beberapa nama) supaya
 * perubahan kecil di hulu tidak langsung mematikan ingest.
 */

import type { Law, Article, JenisRelasi, StatusPeraturan } from "../../shared/types";

export interface PasalClientOptions {
  base: string;
  token: string;
  /** Dipanggil saat kena 429, untuk mundur teratur. */
  onRateLimit?: (retryAfterMs: number) => void;
}

export class PasalRateLimitError extends Error {
  constructor(public retryAfterMs: number) {
    super(`pasal.id rate limit tercapai, coba lagi dalam ${retryAfterMs}ms`);
    this.name = "PasalRateLimitError";
  }
}

/**
 * Jeda dari header Retry-After, dalam milidetik. Header ini boleh berisi detik ("120") atau tanggal HTTP
 * ("Wed, 21 Oct 2026 07:28:00 GMT"); bentuk kedua dulu menghasilkan NaN yang merambat ke penundaan antrean.
 * Yang tak terbaca atau negatif dianggap 60 detik.
 */
export function bacaRetryAfter(nilai: string | null | undefined, sekarang = Date.now()): number {
  const bawaan = 60_000;
  if (nilai === null || nilai === undefined || nilai.trim() === "") return bawaan;
  const detik = Number(nilai);
  if (Number.isFinite(detik)) return detik >= 0 ? Math.round(detik * 1000) : bawaan;
  const tanggal = Date.parse(nilai);
  return Number.isNaN(tanggal) ? bawaan : Math.max(tanggal - sekarang, 0);
}

/** Jawaban apa adanya dari pasal.id, untuk diagnosis. */
export interface JawabanMentah {
  status: number;
  json: unknown;
  /** Hanya header yang menyangkut laju, kuota, atau penomoran (nama dalam huruf kecil). */
  header: Record<string, string>;
}

const POLA_HEADER_LAJU = /rate|limit|quota|retry|remaining|reset|total|count|page|link|cursor/i;

export class PasalApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: string,
  ) {
    super(message);
    this.name = "PasalApiError";
  }
}

/** Ambil nilai pertama yang ada dari beberapa kemungkinan nama field. */
function pilih<T = unknown>(obj: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "") return v as T;
  }
  return undefined;
}

function keStatus(v: unknown): StatusPeraturan {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("cabut")) return "dicabut";
  if (s.includes("ubah")) return "diubah";
  return "berlaku";
}

/** Nama kunci yang lazim memuat teks pada objek bersarang, mis. `issuing_body: { id: 3, name: "..." }`. */
const KUNCI_NAMA = ["name", "nama", "title", "judul", "label", "uraian", "value", "text", "teks"];

/**
 * Nilai API menjadi teks polos. Objek dan larik TIDAK boleh melewati `String(v)`: hasilnya
 * "[object Object]", dan itulah yang pernah tersimpan di kolom `instansi` pada 124 dari 181
 * peraturan produksi. Objek diambil nama-nya; yang bentuknya tak dikenal dianggap kosong,
 * karena nilai kosong lebih jujur daripada teks sampah.
 */
export function keTeks(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    return s === "" || /^\[object \w+\]$/.test(s) ? null : s;
  }
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (Array.isArray(v)) {
    const bagian = v.map(keTeks).filter((x): x is string => x !== null);
    return bagian.length ? [...new Set(bagian)].join(", ") : null;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of KUNCI_NAMA) {
      const t = keTeks(o[k]);
      if (t) return t;
    }
  }
  return null;
}

/** Normalkan tanggal apa pun bentuknya menjadi YYYY-MM-DD. */
function keTanggal(v: unknown): string | null {
  const s = keTeks(v);
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Turunkan jenis/nomor/tahun dari FRBR URI bila field eksplisit tidak ada.
 * Bentuk FRBR: /akn/id/act/uu/2003/13
 */
function uraiFrbr(uri: string): { jenis?: string; tahun?: number; nomor?: string } {
  const m = uri.match(/\/akn\/id\/act\/([^/]+)\/(\d{4})\/([^/]+)/i);
  if (!m) return {};
  return { jenis: m[1].toUpperCase().replace(/-/g, "_"), tahun: Number(m[2]), nomor: m[3] };
}

export function petakanLaw(raw: Record<string, unknown>): Law | null {
  const frbr =
    pilih<string>(raw, "frbr_uri", "frbrUri", "uri", "id") ?? null;
  if (!frbr) return null;

  const dariUri = uraiFrbr(frbr);
  const judul = keTeks(pilih(raw, "judul", "title", "nama"));
  if (!judul) return null;

  const tahun = Number(pilih(raw, "tahun", "year") ?? dariUri.tahun ?? 0);
  const jenis = String(
    pilih(raw, "jenis", "type", "jenis_peraturan") ?? dariUri.jenis ?? "LAIN",
  ).toUpperCase().replace(/[\s-]/g, "_");

  return {
    frbr_uri: frbr,
    jenis,
    nomor: String(pilih(raw, "nomor", "number", "no") ?? dariUri.nomor ?? "-"),
    tahun: Number.isFinite(tahun) ? tahun : 0,
    judul,
    tentang: keTeks(pilih(raw, "tentang", "about", "subjek", "perihal")),
    status: keStatus(pilih(raw, "status", "status_peraturan")),
    tanggal_penetapan: keTanggal(
      pilih(raw, "tanggal_penetapan", "tanggal_ditetapkan", "date_enacted", "tanggal"),
    ),
    tanggal_berlaku: keTanggal(
      pilih(raw, "tanggal_berlaku", "tanggal_diundangkan", "date_effective"),
    ),
    instansi: keTeks(
      pilih(raw, "issuing_body", "instansi", "pemrakarsa", "penerbit", "institution", "teu_badan"),
    ),
    bidang: keTeks(pilih(raw, "bidang", "subjek_hukum", "kategori", "tema")),
    bpk_id: keTeks(pilih(raw, "bpk_id", "bpkId", "id_bpk")),
    sumber_url: keTeks(pilih(raw, "sumber_url", "url", "source_url", "url_file")),
    ringkasan: keTeks(pilih(raw, "ringkasan", "summary", "abstrak")),
    jumlah_pasal:
      Number(pilih(raw, "jumlah_pasal", "total_pasal", "article_count", "total_chunks") ?? 0) || 0,
  };
}

/**
 * Satu simpul pada pohon `articles` milik pasal.id.
 *
 * Strukturnya berupa pohon, bukan daftar datar: BAB, Bagian, Pasal, ayat, dan
 * huruf semuanya menjadi simpul yang saling terhubung lewat `parent_id`.
 * Contoh nyata dari API:
 *   { id: 25124682, type: "bab", number: "I", heading: "KETENTUAN UMUM",
 *     content: "", parent_id: null, sort_order: 2 }
 */
export interface SimpulPasal {
  id: number;
  type: string;
  number: string | null;
  heading: string | null;
  content: string | null;
  parent_id: number | null;
  sort_order: number;
}

/** Simpul yang hanya membentuk kerangka dokumen, bukan isi yang dicari. */
const TIPE_KERANGKA = new Set(["bab", "buku", "bagian", "paragraf", "paragraph", "chapter", "section"]);

export function petakanSimpul(raw: Record<string, unknown>): SimpulPasal | null {
  const id = Number(pilih(raw, "id") ?? NaN);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    type: String(pilih(raw, "type", "tipe") ?? "").toLowerCase().trim(),
    number: keTeks(pilih(raw, "number", "nomor")),
    heading: keTeks(pilih(raw, "heading", "judul", "title")),
    content: keTeks(pilih(raw, "content", "isi", "text")),
    parent_id: (() => {
      const p = pilih(raw, "parent_id", "parentId");
      const n = Number(p);
      return p === undefined || p === null || !Number.isFinite(n) ? null : n;
    })(),
    sort_order: Number(pilih(raw, "sort_order", "sortOrder", "urutan") ?? 0) || 0,
  };
}

/**
 * Ratakan pohon `articles` menjadi baris-baris `Article`.
 *
 * Aturannya:
 * - Simpul kerangka (BAB, Bagian, Paragraf) tidak pernah menjadi baris sendiri;
 *   ia hanya menyumbang konteks bagi pasal di bawahnya. Kalau ini diabaikan,
 *   basis data akan penuh "pasal" berisi teks kosong.
 * - Pasal yang punya anak `ayat` dipecah menjadi satu baris per ayat, karena
 *   ayat-lah unit yang dikutip praktisi.
 * - Simpul lain (huruf, angka, butir) digabungkan ke teks induk terdekat,
 *   supaya daftar rincian tidak terpisah dari kalimat pengantarnya.
 */
export function ratakanPohonPasal(simpulList: SimpulPasal[], frbrUri: string): Article[] {
  const anak = new Map<number | null, SimpulPasal[]>();
  for (const s of simpulList) {
    const kunci = s.parent_id;
    const daftar = anak.get(kunci);
    if (daftar) daftar.push(s);
    else anak.set(kunci, [s]);
  }
  for (const daftar of anak.values()) daftar.sort((a, b) => a.sort_order - b.sort_order);

  /** Rangkai teks sebuah simpul beserta seluruh keturunannya. */
  function teksLengkap(s: SimpulPasal, lewatiTipe?: Set<string>): string {
    const bagian: string[] = [];
    if (s.heading && !TIPE_KERANGKA.has(s.type)) bagian.push(s.heading);
    if (s.content) bagian.push(s.content);
    for (const a of anak.get(s.id) ?? []) {
      if (lewatiTipe?.has(a.type)) continue;
      const t = teksLengkap(a);
      if (t) bagian.push(a.number ? `(${a.number}) ${t}`.replace(/^\((\d+)\) /, "($1) ") : t);
    }
    return bagian.join("\n").trim();
  }

  const hasil: Article[] = [];

  function telusuri(daftar: SimpulPasal[], bab: string | null, bagian: string | null) {
    for (const s of daftar) {
      const anaknya = anak.get(s.id) ?? [];

      if (TIPE_KERANGKA.has(s.type)) {
        const label = [s.type.toUpperCase(), s.number, s.heading].filter(Boolean).join(" ").trim();
        const babBaru = /bab|buku/.test(s.type) ? label : bab;
        const bagianBaru = /bagian|paragraf|paragraph|section/.test(s.type) ? label : bagian;
        telusuri(anaknya, babBaru, bagianBaru);
        continue;
      }

      if (s.type === "pasal") {
        const nomor = s.number ?? String(hasil.length + 1);
        const ayatList = anaknya.filter((a) => a.type === "ayat");

        if (ayatList.length) {
          // Teks milik pasal sendiri (kalimat pengantar sebelum ayat pertama)
          // ikut menempel pada ayat (1) agar tidak hilang.
          const pengantar = [s.heading, s.content].filter(Boolean).join("\n").trim();
          const sebelum = hasil.length;

          ayatList.forEach((a, i) => {
            const isi = [i === 0 ? pengantar : "", teksLengkap(a)].filter(Boolean).join("\n").trim();
            if (!isi) return;
            hasil.push({
              id: `${frbrUri}#pasal-${nomor}-ayat-${a.number ?? i + 1}`,
              frbr_uri: frbrUri,
              nomor_pasal: nomor,
              ayat: a.number ?? String(i + 1),
              bab, bagian,
              judul: s.heading,
              isi,
              urutan: hasil.length,
            });
          });

          // Jaring pengaman: bila pemecahan per ayat tidak menghasilkan apa pun
          // — misalnya simpul ayat datang tanpa isi karena akses dibatasi —
          // pasalnya TIDAK boleh ikut lenyap. Ini pernah terjadi sungguhan:
          // UU 15/2025 tersimpan dengan Pasal 1, 3, 4, … 13, dan hanya Pasal 2
          // (satu-satunya yang berayat) yang hilang tanpa jejak.
          if (hasil.length === sebelum) {
            const isi = teksLengkap(s);
            if (isi) {
              hasil.push({
                id: `${frbrUri}#pasal-${nomor}`,
                frbr_uri: frbrUri,
                nomor_pasal: nomor,
                ayat: null,
                bab, bagian,
                judul: s.heading,
                isi,
                urutan: hasil.length,
              });
            }
          }
        } else {
          const isi = teksLengkap(s);
          if (isi) {
            hasil.push({
              id: `${frbrUri}#pasal-${nomor}`,
              frbr_uri: frbrUri,
              nomor_pasal: nomor,
              ayat: null,
              bab, bagian,
              judul: s.heading,
              isi,
              urutan: hasil.length,
            });
          }
        }
        continue;
      }

      // Tipe lain di tingkat atas (mis. "menimbang", "mengingat") dilewati:
      // ia bukan norma yang dicari orang, dan hanya menggemukkan indeks.
      telusuri(anaknya, bab, bagian);
    }
  }

  telusuri(anak.get(null) ?? [], null, null);
  return hasil;
}

const RELASI_VALID: readonly JenisRelasi[] = [
  "mengubah", "diubah_oleh", "mencabut", "dicabut_oleh",
  "dasar_hukum", "menjadi_dasar_hukum", "melaksanakan", "dilaksanakan_oleh", "terkait",
];

/** Petakan label relasi bebas dari API ke enum yang dipakai skema D1. */
export function petakanJenisRelasi(raw: unknown): JenisRelasi {
  const s = String(raw ?? "").toLowerCase().replace(/[\s-]/g, "_");
  if ((RELASI_VALID as readonly string[]).includes(s)) return s as JenisRelasi;
  if (s.includes("dicabut")) return "dicabut_oleh";
  if (s.includes("mencabut")) return "mencabut";
  if (s.includes("diubah")) return "diubah_oleh";
  if (s.includes("mengubah")) return "mengubah";
  if (s.includes("dasar")) return "dasar_hukum";
  if (s.includes("melaksanakan")) return "melaksanakan";
  return "terkait";
}

/** Cari array dokumen di dalam respons, apa pun nama pembungkusnya. */
function ambilDaftar(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  if (typeof json !== "object" || json === null) return [];
  const obj = json as Record<string, unknown>;
  for (const key of ["data", "results", "laws", "items", "hits", "peraturan"]) {
    const v = obj[key];
    if (Array.isArray(v)) return v as Record<string, unknown>[];
  }
  return [];
}

/** Satu baris hasil `/search`. Sengaja bukan `Law`: metadatanya memang tidak ada. */
export interface HasilCariPasal {
  work_id: number;
  snippet: string;
  score: number;
  matching_pasals: string;
  total_chunks: number;
}

/** Bentuk URL yang dipakai endpoint detail. */
type BentukDetail = "path" | "query";

export class PasalClient {
  /** Bentuk URL detail yang terakhir terbukti bekerja, agar tidak dicoba ulang. */
  private static bentukDetail: BentukDetail | null = null;

  constructor(private opts: PasalClientOptions) {}

  /** Kirim permintaan; 429 dan galat HTTP lain dilempar, sisanya dikembalikan sebagai Response. */
  private async kirim(path: string, params?: Record<string, string | number | undefined>): Promise<Response> {
    const url = new URL(this.opts.base.replace(/\/$/, "") + path);
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.opts.token}`,
        Accept: "application/json",
        "User-Agent": "Lexa/0.1 (+https://github.com/lexa; kontak via aplikasi)",
      },
      // Cache di edge: metadata peraturan nyaris tidak pernah berubah.
      cf: { cacheTtl: 3600, cacheEverything: true },
    });

    if (res.status === 429) {
      const retryAfter = bacaRetryAfter(res.headers.get("retry-after"));
      this.opts.onRateLimit?.(retryAfter);
      throw new PasalRateLimitError(retryAfter);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new PasalApiError(res.status, `pasal.id ${res.status} pada ${path}`, body.slice(0, 500));
    }
    return res;
  }

  private async request(path: string, params?: Record<string, string | number | undefined>) {
    return (await this.kirim(path, params)).json();
  }

  /**
   * Jawaban mentah beserta header laju/kuota, tanpa pemetaan apa pun. Hanya untuk diagnosis (lib/diagnosa.ts):
   * bentuk respons produksi tidak terlihat dari luar, dan menebaknya sudah pernah menghasilkan data yang
   * tampak sukses tetapi tak utuh.
   */
  async ambilMentah(path: string, params?: Record<string, string | number | undefined>): Promise<JawabanMentah> {
    const res = await this.kirim(path, params);
    const header: Record<string, string> = {};
    for (const [k, v] of res.headers) {
      if (POLA_HEADER_LAJU.test(k) && Object.keys(header).length < 20) header[k.toLowerCase()] = v.slice(0, 120);
    }
    return { status: res.status, json: await res.json(), header };
  }

  /**
   * Pencarian teks di pasal.id.
   *
   * Balasannya TIDAK memuat metadata peraturan — hanya `work_id` dan cuplikan.
   * Karena itu hasilnya dikembalikan apa adanya, bukan sebagai `Law`. Jalur
   * ingest tidak memakai endpoint ini; pencarian Lexa dilayani indeks sendiri.
   */
  async search(q: string, opts: { limit?: number } = {}): Promise<HasilCariPasal[]> {
    const json = await this.request("/search", { q, limit: Math.min(opts.limit ?? 20, 20) });
    return ambilDaftar(json).map((r) => ({
      work_id: Number(pilih(r, "work_id", "id") ?? 0),
      snippet: String(pilih(r, "snippet", "cuplikan") ?? ""),
      score: Number(pilih(r, "score") ?? 0),
      matching_pasals: String(pilih(r, "matching_pasals") ?? ""),
      total_chunks: Number(pilih(r, "total_chunks") ?? 0),
    }));
  }

  /**
   * Daftar peraturan.
   *
   * Paginasi memakai `limit`/`offset`. Ini bukan detail sepele: memakai
   * `page`/`per_page` membuat API mengabaikannya dan selalu mengembalikan
   * 20 record pertama — penyapuan akan berputar di tempat sambil tampak sukses.
   */
  async listLaws(opts: {
    jenis?: string;
    tahun?: number;
    status?: string;
    offset?: number;
    limit?: number;
  } = {}) {
    const limit = Math.min(opts.limit ?? 50, 100);
    const offset = Math.max(opts.offset ?? 0, 0);

    const json = await this.request("/laws", {
      // Nama filter mengikuti nama field pada respons: `type`, bukan `jenis`.
      type: opts.jenis,
      year: opts.tahun,
      status: opts.status,
      limit,
      offset,
    });

    const daftar = ambilDaftar(json);
    const obj = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
    // `total` berada di tingkat atas respons, bukan di dalam objek meta.
    const total = Number(pilih(obj, "total", "total_count", "count") ?? daftar.length);
    // API bisa memaksakan limit-nya sendiri, jadi langkah berikutnya dihitung
    // dari jumlah yang benar-benar diterima — bukan dari limit yang diminta.
    const diterima = daftar.length;

    const laws: Law[] = [];
    // Id numerik internal pasal.id disimpan terpisah: ia tidak masuk skema D1,
    // tetapi endpoint detail kemungkinan memerlukannya.
    const idNumerik = new Map<string, number>();

    for (const mentah of daftar) {
      const law = petakanLaw(mentah);
      if (!law) continue;
      laws.push(law);
      const id = Number(pilih(mentah, "id", "work_id") ?? 0);
      if (id) idNumerik.set(law.frbr_uri, id);
    }

    return {
      laws,
      idNumerik,
      total,
      offsetBerikut: offset + diterima,
      hasMore: diterima > 0 && offset + diterima < total,
    };
  }

  /**
   * Ambil detail satu peraturan.
   *
   * Bentuk URL sudah diuji: FRBR URI ditempelkan apa adanya sebagai sisa path
   * (`/laws/akn/id/act/uu/2003/13`). Meng-encode-nya utuh dijawab 404. Bentuk
   * `?uri=` juga bekerja dan dipakai sebagai cadangan bila pola path berubah.
   */
  private async requestDetail(frbrUri: string): Promise<unknown> {
    const bersih = frbrUri.replace(/^\/+/, "");
    const urutan: Array<[BentukDetail, string]> = PasalClient.bentukDetail === "query"
      ? [["query", `/laws?uri=${encodeURIComponent(frbrUri)}`]]
      : [
          ["path", `/laws/${bersih}`],
          ["query", `/laws?uri=${encodeURIComponent(frbrUri)}`],
        ];

    let terakhir: Error | null = null;

    for (const [bentuk, path] of urutan) {
      try {
        const json = await this.request(path);
        PasalClient.bentukDetail = bentuk;
        return json;
      } catch (e) {
        // Rate limit harus naik ke pemanggil; mencoba bentuk lain hanya
        // memperparah keadaan.
        if (e instanceof PasalRateLimitError) throw e;
        if (e instanceof PasalApiError && e.status === 404) {
          terakhir = e;
          continue;
        }
        throw e;
      }
    }

    // Bentuk tersimpan ternyata tidak lagi bekerja — lupakan agar percobaan
    // berikutnya menelusuri ulang dari awal.
    PasalClient.bentukDetail = null;
    throw terakhir ?? new PasalApiError(404, `Detail tidak ditemukan untuk ${frbrUri}`);
  }

  /**
   * Detail satu peraturan: metadata + pasal + relasi.
   *
   * Respons berbentuk `{ work, articles, relationships, detail_access }`, dengan
   * `articles` berupa POHON (bab → pasal → ayat), bukan daftar datar.
   */
  async getLaw(frbrUri: string) {
    const json = await this.requestDetail(frbrUri);
    const obj = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
    const inti = (obj.work ?? obj.data ?? obj.law ?? obj) as Record<string, unknown>;

    const law = petakanLaw(inti);
    if (!law) throw new PasalApiError(422, `Respons pasal.id tak terpetakan untuk ${frbrUri}`);

    const rawArticles = (pilih<unknown[]>(obj, "articles", "pasal") ?? []) as unknown[];
    const simpul = Array.isArray(rawArticles)
      ? rawArticles
          .map((a) => petakanSimpul(a as Record<string, unknown>))
          .filter((s): s is SimpulPasal => s !== null)
      : [];
    const articles: Article[] = ratakanPohonPasal(simpul, law.frbr_uri);

    const rawRelations =
      (pilih<unknown[]>(obj, "relationships", "relasi", "relations", "hubungan") ?? []) as unknown[];
    const relations = Array.isArray(rawRelations)
      ? rawRelations
          .map((r) => {
            const o = r as Record<string, unknown>;
            const to = keTeks(
              pilih(o, "frbr_uri", "related_frbr_uri", "target_frbr_uri", "uri", "to", "target"),
            );
            if (!to) return null;
            return {
              to_uri: to,
              jenis_relasi: petakanJenisRelasi(
                pilih(o, "relationship_type", "type", "jenis", "relasi", "relation"),
              ),
              keterangan: keTeks(pilih(o, "keterangan", "note", "description", "title")),
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null)
      : [];

    return { law: { ...law, jumlah_pasal: articles.length }, articles, relations };
  }
}

/** Bangun URL sumber resmi di BPK — situsnya tidak di-scrape, hanya ditautkan. */
export function urlBpk(base: string, bpkId: string | null): string | null {
  return bpkId ? `${base.replace(/\/$/, "")}/Details/${bpkId}` : null;
}
