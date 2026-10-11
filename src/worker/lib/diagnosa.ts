/**
 * Diagnosis bentuk respons pasal.id.
 *
 * Latar belakangnya data produksi sendiri: banyak undang-undang besar tersimpan hanya sebagian. UU 17/2023
 * (458 pasal) punya 59 baris, UU 27/2009 (408 pasal) hanya Pasal 1 dan 400-408, KUHAP 39 dari 286, dan polanya
 * selalu pasal yang punya ayat lenyap. Penyebabnya tidak terlihat dari dalam repo: kode pemetaan sudah benar untuk
 * bentuk respons yang dikenalnya, dan bentuk respons produksi hanya bisa dilihat dari Worker yang berjalan.
 * Jadi Worker meringkas strukturnya sendiri (tipe simpul, ada tidaknya isi, simpul yatim, petunjuk paginasi,
 * header kuota) dan menyimpan ringkasan itu di `sync_state` ("diag:...") agar bisa dibaca dan dijadikan dasar
 * perbaikan. Ringkasan sengaja tidak memuat teks peraturan: teks panjang diganti panjangnya.
 */

import { keTeks, petakanSimpul, PasalRateLimitError, type PasalClient, type SimpulPasal } from "./pasal";

type Objek = Record<string, unknown>;

const adalahObjek = (v: unknown): v is Objek => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Bentuk sebuah nilai JSON dalam ukuran kecil: skalar dipertahankan, teks panjang diganti panjangnya, larik dan
 * objek yang dalam diringkas. Dipakai untuk memperlihatkan nama-nama field tanpa membawa isinya.
 */
export function bentukSingkat(v: unknown, kedalaman = 0): unknown {
  if (v === null || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return v.length > 60 ? `<teks ${v.length} huruf>` : v;
  if (Array.isArray(v)) {
    if (kedalaman >= 2) return `<larik ${v.length}>`;
    const awal = v.slice(0, 3).map((x) => bentukSingkat(x, kedalaman + 1));
    return v.length > 3 ? [...awal, `…${v.length - 3} lagi`] : awal;
  }
  if (adalahObjek(v)) {
    if (kedalaman >= 3) return `<objek ${Object.keys(v).length} kunci>`;
    return Object.fromEntries(
      Object.entries(v).slice(0, 30).map(([k, x]) => [k, bentukSingkat(x, kedalaman + 1)]),
    );
  }
  return `<${typeof v}>`;
}

function hitung<T>(daftar: T[], kunci: (x: T) => string): Record<string, number> {
  const hasil: Record<string, number> = {};
  for (const x of daftar) {
    const k = kunci(x);
    hasil[k] = (hasil[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(hasil).sort((a, b) => b[1] - a[1]).slice(0, 25));
}

/** Nama field simpul (gabungan seluruh simpul) beserta jumlah simpul yang memilikinya. */
function gabunganKunci(daftar: Objek[]): Record<string, number> {
  return hitung(daftar.flatMap((s) => Object.keys(s)), (k) => k);
}

/** Skalar di tingkat atas objek: petunjuk paginasi (total, limit, next, ...) biasanya ada di sini. */
function skalarAtas(o: Objek): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(o)
      .filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v))
      .map(([k, v]) => [k, bentukSingkat(v)]),
  );
}

/** Larik simpul dari nilai `articles`, apa pun pembungkusnya. */
function ambilSimpul(mentah: unknown): { daftar: unknown[]; pembungkus: string } {
  if (Array.isArray(mentah)) return { daftar: mentah, pembungkus: "larik" };
  if (adalahObjek(mentah)) {
    for (const k of ["items", "nodes", "data", "results", "articles", "pasal", "children"]) {
      if (Array.isArray(mentah[k])) return { daftar: mentah[k] as unknown[], pembungkus: `objek.${k}` };
    }
    return { daftar: [], pembungkus: `objek(${Object.keys(mentah).slice(0, 8).join(",")})` };
  }
  return { daftar: [], pembungkus: mentah === undefined ? "tidak ada" : typeof mentah };
}

/** Nomor pasal sebagai angka bila diawali angka ("12A" menjadi 12), selain itu NaN. */
function angkaPasal(nomor: string | null): number {
  const m = /^\d+/.exec(nomor ?? "");
  return m ? Number(m[0]) : NaN;
}

/**
 * Ringkasan struktur respons detail `/laws/<uri>`. Yang diukur menjawab pertanyaan tertentu:
 *  - pasal yang tak berisi: berapa, dan apakah anak-anaknya (ayat) berisi?
 *  - ada simpul yatim (parent_id menunjuk simpul yang tak ada di respons)?
 *  - field apa yang dikandung simpul, siapa tahu isi teks ada di field selain content/isi/text?
 *  - adakah petunjuk paginasi atau pemotongan (total, next, partial, detail_access)?
 */
export function ringkasDetail(json: unknown): Objek {
  const o = adalahObjek(json) ? json : {};
  const hasil: Objek = {
    kunci_atas: Object.keys(o),
    skalar_atas: skalarAtas(o),
    detail_access: bentukSingkat(o.detail_access),
    work: bentukSingkat(o.work ?? o.data ?? o.law),
  };

  const { daftar, pembungkus } = ambilSimpul(o.articles ?? o.pasal);
  const mentahSimpul = daftar.filter(adalahObjek);
  hasil.articles_pembungkus = pembungkus;
  if (adalahObjek(o.articles)) hasil.articles_skalar = skalarAtas(o.articles);
  hasil.jumlah_simpul = mentahSimpul.length;
  hasil.kunci_simpul = gabunganKunci(mentahSimpul);

  const simpul = mentahSimpul.map((s) => petakanSimpul(s)).filter((s): s is SimpulPasal => s !== null);
  const ada = new Set(simpul.map((s) => s.id));
  const anak = new Map<number, SimpulPasal[]>();
  for (const s of simpul) {
    if (s.parent_id !== null) anak.set(s.parent_id, [...(anak.get(s.parent_id) ?? []), s]);
  }
  const berisi = (s: SimpulPasal) => Boolean(s.content && s.content.trim());
  /** Simpul atau salah satu keturunannya membawa teks. */
  const adaTeks = (s: SimpulPasal, tingkat = 0): boolean =>
    berisi(s) || (tingkat < 8 && (anak.get(s.id) ?? []).some((a) => adaTeks(a, tingkat + 1)));

  hasil.tipe = hitung(simpul, (s) => s.type || "(kosong)");
  hasil.tipe_berisi = hitung(simpul.filter(berisi), (s) => s.type || "(kosong)");
  hasil.akar = simpul.filter((s) => s.parent_id === null).length;
  hasil.yatim = simpul.filter((s) => s.parent_id !== null && !ada.has(s.parent_id)).length;
  hasil.id_ganda = simpul.length - ada.size;
  hasil.karakter_total = simpul.reduce((n, s) => n + (s.content?.length ?? 0) + (s.heading?.length ?? 0), 0);
  hasil.urutan = {
    minimum: simpul.reduce((m, s) => Math.min(m, s.sort_order), Infinity),
    maksimum: simpul.reduce((m, s) => Math.max(m, s.sort_order), -Infinity),
    unik: new Set(simpul.map((s) => s.sort_order)).size,
  };

  const pasal = simpul.filter((s) => s.type === "pasal");
  const ayat = simpul.filter((s) => s.type === "ayat");
  const pasalKosong = pasal.filter((s) => !adaTeks(s));
  hasil.pasal = {
    total: pasal.length,
    nomor_unik: new Set(pasal.map((s) => s.number)).size,
    nomor_maks: pasal.reduce((m, s) => Math.max(m, angkaPasal(s.number) || 0), 0),
    berisi_sendiri: pasal.filter(berisi).length,
    berisi_dengan_keturunan: pasal.length - pasalKosong.length,
    tanpa_teks_sama_sekali: pasalKosong.length,
    punya_anak: pasal.filter((s) => (anak.get(s.id) ?? []).length > 0).length,
    punya_ayat: pasal.filter((s) => (anak.get(s.id) ?? []).some((a) => a.type === "ayat")).length,
    kosong_punya_ayat: pasalKosong.filter((s) => (anak.get(s.id) ?? []).some((a) => a.type === "ayat")).length,
    contoh_tanpa_teks: pasalKosong.slice(0, 30).map((s) => s.number),
    contoh_berisi: pasal.filter(adaTeks).slice(0, 30).map((s) => s.number),
  };
  hasil.ayat = {
    total: ayat.length,
    berisi: ayat.filter(berisi).length,
    punya_anak: ayat.filter((s) => (anak.get(s.id) ?? []).length > 0).length,
  };

  // Contoh bentuk simpul nyata: pasal tanpa teks beserta dua anaknya, dan pasal berisi, dari data mentah.
  const mentahPerId = new Map(mentahSimpul.map((s) => [Number(s.id), s]));
  const contoh = (s: SimpulPasal) => ({
    simpul: bentukSingkat(mentahPerId.get(s.id)),
    anak: (anak.get(s.id) ?? []).slice(0, 2).map((a) => bentukSingkat(mentahPerId.get(a.id))),
  });
  hasil.contoh_pasal_tanpa_teks = pasalKosong.slice(0, 3).map(contoh);
  hasil.contoh_pasal_berisi = pasal.filter(adaTeks).slice(0, 2).map(contoh);
  const relasi = o.relationships ?? o.relasi ?? o.relations;
  hasil.relasi = Array.isArray(relasi) ? { jumlah: relasi.length, contoh: bentukSingkat(relasi[0]) } : bentukSingkat(relasi);
  return hasil;
}

/** Ringkasan respons daftar `/laws?...`: total, nama field, sebaran jenis/status/verifikasi, contoh satu item. */
export function ringkasDaftar(json: unknown): Objek {
  const o = adalahObjek(json) ? json : {};
  const { daftar, pembungkus } = ambilSimpul(o.laws ?? o.data ?? o.results ?? o.items);
  const item = daftar.filter(adalahObjek);
  const tahun = item.map((i) => Number(i.year ?? i.tahun)).filter(Number.isFinite);
  return {
    kunci_atas: Object.keys(o),
    skalar_atas: skalarAtas(o),
    pembungkus,
    jumlah: item.length,
    kunci_item: gabunganKunci(item),
    jenis: hitung(item, (i) => String(keTeks(i.type ?? i.jenis) ?? "(kosong)")),
    status: hitung(item, (i) => String(keTeks(i.status) ?? "(kosong)")),
    terverifikasi: hitung(item, (i) => String(i.content_verified ?? "(tidak ada)")),
    tahun: tahun.length
      ? { minimum: tahun.reduce((m, t) => Math.min(m, t), Infinity), maksimum: tahun.reduce((m, t) => Math.max(m, t), -Infinity) }
      : null,
    contoh: bentukSingkat(item[0]),
  };
}

/** Satu pemeriksaan: apa yang diminta dan bagaimana meringkas jawabannya. */
interface Pemeriksaan {
  kunci: string;
  jalur: string;
  params?: Record<string, string | number>;
  ringkas: "daftar" | "detail";
}

/**
 * Daftar pemeriksaan, dikerjakan berurutan satu per menit. Pembanding yang utuh didahulukan (UU 13/2003 punya 193
 * pasal dan di produksi tersimpan lengkap), lalu yang tersimpan sebagian. Pemeriksaan daftar mencari kode `type`
 * yang benar untuk UUD dan Tap MPR (kode tak dikenal diabaikan diam-diam oleh pasal.id dan menghasilkan SEMUA
 * peraturan, jadi `total` yang sama dengan daftar tanpa filter berarti kodenya salah), dan sebaran jenis nyata
 * pada beberapa posisi daftar tanpa filter.
 */
export const PEMERIKSAAN: readonly Pemeriksaan[] = [
  { kunci: "daftar:semua:0", jalur: "/laws", params: { limit: 100, offset: 0 }, ringkas: "daftar" },
  { kunci: "detail:uu/2003/13", jalur: "/laws/akn/id/act/uu/2003/13", ringkas: "detail" },
  { kunci: "detail:uu/2023/17", jalur: "/laws/akn/id/act/uu/2023/17", ringkas: "detail" },
  { kunci: "detail:uu/2009/27", jalur: "/laws/akn/id/act/uu/2009/27", ringkas: "detail" },
  { kunci: "detail:uu/1981/8", jalur: "/laws/akn/id/act/uu/1981/8", ringkas: "detail" },
  { kunci: "detail:pp/2009/56", jalur: "/laws/akn/id/act/pp/2009/56", ringkas: "detail" },
  { kunci: "daftar:UUD", jalur: "/laws", params: { type: "UUD", limit: 100 }, ringkas: "daftar" },
  { kunci: "daftar:TAP_MPR", jalur: "/laws", params: { type: "TAP_MPR", limit: 100 }, ringkas: "daftar" },
  { kunci: "daftar:PERPPU", jalur: "/laws", params: { type: "PERPPU", limit: 100 }, ringkas: "daftar" },
  { kunci: "daftar:semua:3000", jalur: "/laws", params: { limit: 100, offset: 3000 }, ringkas: "daftar" },
  { kunci: "daftar:semua:9000", jalur: "/laws", params: { limit: 100, offset: 9000 }, ringkas: "daftar" },
  { kunci: "daftar:semua:20000", jalur: "/laws", params: { limit: 100, offset: 20000 }, ringkas: "daftar" },
  { kunci: "daftar:semua:35000", jalur: "/laws", params: { limit: 100, offset: 35000 }, ringkas: "daftar" },
];

export const KUNCI_DIAG = "diag:";

export interface HasilDiagnosa {
  /** Kunci pemeriksaan yang baru dikerjakan, null bila semuanya sudah ada. */
  kunci: string | null;
  /** Jeda dari pasal.id bila kena batas laju. */
  tundaMs?: number;
}

/**
 * Kerjakan satu pemeriksaan yang belum ada hasilnya. Hasil dan galat sama-sama disimpan: galat HTTP (mis. 404 untuk
 * kode jenis yang tak dikenal) adalah temuan, bukan alasan mengulang tanpa akhir. Hanya batas laju yang membuat
 * pemeriksaan diulang pada menit berikutnya.
 */
export async function jalankanDiagnosa(db: D1Database, pasal: PasalClient): Promise<HasilDiagnosa> {
  const { results } = await db
    .prepare(`SELECT key FROM sync_state WHERE key LIKE 'diag:%'`)
    .all<{ key: string }>();
  const sudah = new Set(results.map((r) => r.key));
  const berikut = PEMERIKSAAN.find((p) => !sudah.has(KUNCI_DIAG + p.kunci));
  if (!berikut) return { kunci: null };

  const catatan: Objek = { diambil: new Date().toISOString(), jalur: berikut.jalur, params: berikut.params ?? null };
  try {
    const jawaban = await pasal.ambilMentah(berikut.jalur, berikut.params);
    catatan.status_http = jawaban.status;
    catatan.header = jawaban.header;
    catatan.ringkasan = berikut.ringkas === "daftar" ? ringkasDaftar(jawaban.json) : ringkasDetail(jawaban.json);
  } catch (e) {
    if (e instanceof PasalRateLimitError) return { kunci: null, tundaMs: e.retryAfterMs };
    catatan.galat = String(e).slice(0, 300);
    const status = (e as { status?: number }).status;
    if (status) catatan.status_http = status;
  }

  await db
    .prepare(
      `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(KUNCI_DIAG + berikut.kunci, JSON.stringify(catatan).slice(0, 12000))
    .run();
  return { kunci: berikut.kunci };
}
