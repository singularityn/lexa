/**
 * Harness uji integrasi.
 *
 * Menjalankan aplikasi Lexa yang SESUNGGUHNYA (default export `src/worker/index.ts`)
 * di Node terhadap SQLite sungguhan: migrasi di `migrations/` diterapkan apa
 * adanya, sehingga tabel, indeks FTS5, dan trigger sama dengan produksi. Binding
 * Cloudflare lain berupa tiruan setia untuk bagian API yang benar-benar dipakai
 * kode (lihat daftar di bawah).
 *
 * Yang DIBUKTIKAN: logika route, SQL, pipeline ingest, cron, dan konsumer antrean.
 * Yang TIDAK dibuktikan: perilaku runtime workerd dan layanan Cloudflare asli
 * (Workers AI, Vectorize); itu hanya bisa diuji pada deploy sungguhan.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";
import worker from "../../src/worker/index";
import { indeksVektor, type KonteksIngest } from "../../src/worker/lib/ingest";
import { PasalClient } from "../../src/worker/lib/pasal";
import { bacaCakupan } from "../../src/shared/cakupan";

// --- SQLite -----------------------------------------------------------------

/** Buka SQLite dalam memori; null bila `node:sqlite` tidak tersedia di Node ini. */
export function bukaSqlite(): DatabaseSync | null {
  try {
    const require = createRequire("file:///tes.js");
    const { DatabaseSync: Db } = require("node:sqlite") as { DatabaseSync: new (p: string) => DatabaseSync };
    const db = new Db(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    return db;
  } catch {
    return null;
  }
}

export const sqliteAda = bukaSqlite() !== null;

// --- D1 palsu ---------------------------------------------------------------

function keNilaiD1(v: unknown): unknown {
  if (v === undefined) throw new Error("D1_TYPE_ERROR: Type 'undefined' not supported");
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

interface HasilD1 {
  results: Record<string, unknown>[];
  success: true;
  meta: { changes: number; last_row_id: number; rows_read: number; rows_written: number };
}

export class PernyataanPalsu {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    private readonly nilai: unknown[] = [],
  ) {}

  bind(...nilai: unknown[]): PernyataanPalsu {
    // D1 menolak kueri dengan lebih dari 100 parameter terikat (SQLite biasa mengizinkan puluhan ribu).
    // Tanpa pagar ini, daftar IN yang panjang lolos di tes dan baru gagal di produksi.
    if (nilai.length > 100) throw new Error(`D1_ERROR: too many SQL variables (${nilai.length} > 100)`);
    // D1 juga menolak pola LIKE/GLOB lebih dari 50 byte. Parameter yang menjadi pola dicari lewat
    // posisi tanda tanya pada "LIKE ?" / "GLOB ?".
    for (const m of this.sql.matchAll(/\b(?:LIKE|GLOB)\s+\?/gi)) {
      const posisi = (this.sql.slice(0, (m.index ?? 0) + m[0].length).match(/\?/g) ?? []).length - 1;
      const pola = nilai[posisi];
      if (typeof pola === "string" && new TextEncoder().encode(pola).length > 50) {
        throw new Error("D1_ERROR: LIKE or GLOB pattern too complex");
      }
    }
    return new PernyataanPalsu(this.db, this.sql, nilai.map(keNilaiD1));
  }

  /** Eksekusi sinkron; dipakai juga oleh batch() di dalam transaksi. */
  eksekusi(): HasilD1 {
    const st = this.db.prepare(this.sql);
    if (/^\s*(select|with|pragma|explain)\b/i.test(this.sql)) {
      const results = st.all(...this.nilai);
      return { results, success: true, meta: { changes: 0, last_row_id: 0, rows_read: results.length, rows_written: 0 } };
    }
    const r = st.run(...this.nilai);
    return {
      results: [],
      success: true,
      meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid), rows_read: 0, rows_written: Number(r.changes) },
    };
  }

  async first<T = Record<string, unknown>>(kolom?: string): Promise<T | null> {
    const baris = this.eksekusi().results[0];
    if (!baris) return null;
    return (kolom ? baris[kolom] : baris) as T;
  }
  async all<T = Record<string, unknown>>(): Promise<HasilD1 & { results: T[] }> {
    return this.eksekusi() as HasilD1 & { results: T[] };
  }
  async run(): Promise<HasilD1> {
    return this.eksekusi();
  }
  async raw(): Promise<unknown[][]> {
    return this.eksekusi().results.map((b) => Object.values(b));
  }
}

export class D1Palsu {
  constructor(readonly db: DatabaseSync) {}
  prepare(sql: string): PernyataanPalsu {
    return new PernyataanPalsu(this.db, sql);
  }
  /** Seperti D1: semua pernyataan dalam satu transaksi; galat membatalkan semuanya. */
  async batch(daftar: PernyataanPalsu[]): Promise<HasilD1[]> {
    this.db.exec("BEGIN");
    try {
      const hasil = daftar.map((p) => p.eksekusi());
      this.db.exec("COMMIT");
      return hasil;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  async exec(sql: string) {
    this.db.exec(sql);
    return { count: 1, duration: 0 };
  }
}

// --- KV, R2, Queue palsu ----------------------------------------------------

export class KvPalsu {
  readonly isi = new Map<string, { nilai: string; kedaluwarsa?: number }>();
  async get(kunci: string, tipe?: string | { type: string }): Promise<unknown> {
    const e = this.isi.get(kunci);
    if (!e || (e.kedaluwarsa !== undefined && e.kedaluwarsa <= Date.now())) return null;
    const jenis = typeof tipe === "string" ? tipe : tipe?.type;
    return jenis === "json" ? JSON.parse(e.nilai) : e.nilai;
  }
  async put(kunci: string, nilai: string, opsi?: { expirationTtl?: number }): Promise<void> {
    this.isi.set(kunci, {
      nilai,
      kedaluwarsa: opsi?.expirationTtl ? Date.now() + opsi.expirationTtl * 1000 : undefined,
    });
  }
  async delete(kunci: string): Promise<void> {
    this.isi.delete(kunci);
  }
}

interface MetadataHttp {
  contentType?: string;
  cacheControl?: string;
}

export class R2Palsu {
  readonly objek = new Map<
    string,
    { bytes: Uint8Array; httpMetadata?: MetadataHttp; customMetadata?: Record<string, string> }
  >();

  async put(
    kunci: string,
    nilai: string | ArrayBuffer | ArrayBufferView | Blob | ReadableStream,
    opsi?: { httpMetadata?: MetadataHttp; customMetadata?: Record<string, string> },
  ) {
    const bytes = new Uint8Array(await new Response(nilai as BodyInit).arrayBuffer());
    this.objek.set(kunci, { bytes, httpMetadata: opsi?.httpMetadata, customMetadata: opsi?.customMetadata });
    return { key: kunci, size: bytes.byteLength };
  }

  /** Seperti R2: menghapus satu kunci atau larik (maksimal 1000), dan kunci yang tak ada bukan galat. */
  readonly panggilanHapus: string[][] = [];
  async delete(kunci: string | string[]): Promise<void> {
    const daftar = Array.isArray(kunci) ? kunci : [kunci];
    if (daftar.length > 1000) throw new Error("R2: tidak boleh menghapus lebih dari 1000 kunci sekali jalan");
    this.panggilanHapus.push(daftar);
    for (const k of daftar) this.objek.delete(k);
  }

  /**
   * Meniru R2: `opsi.range` bisa berupa `Headers` (dibaca dari header Range) atau
   * `{ offset, length }`. Seperti R2 asli, `range` terisi bahkan pada GET utuh.
   */
  async get(kunci: string, opsi?: { range?: Headers | { offset?: number; length?: number } }) {
    const o = this.objek.get(kunci);
    if (!o) return null;
    const ukuran = o.bytes.byteLength;
    let offset = 0;
    let panjang = ukuran;
    const r = opsi?.range;
    if (r instanceof Headers) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(r.get("range") ?? "");
      if (m) {
        if (m[1] === "") {
          panjang = Math.min(Number(m[2]), ukuran);
          offset = ukuran - panjang;
        } else {
          offset = Number(m[1]);
          panjang = (m[2] === "" ? ukuran - 1 : Math.min(Number(m[2]), ukuran - 1)) - offset + 1;
        }
      }
    } else if (r) {
      offset = r.offset ?? 0;
      panjang = r.length ?? ukuran - offset;
    }
    const potongan = o.bytes.slice(offset, offset + panjang);
    return {
      key: kunci,
      size: ukuran,
      httpEtag: '"etag-uji"',
      httpMetadata: o.httpMetadata,
      customMetadata: o.customMetadata,
      range: { offset, length: panjang },
      get body() {
        return new Response(potongan).body;
      },
      async arrayBuffer() {
        return potongan.slice().buffer;
      },
      async text() {
        return new TextDecoder().decode(potongan);
      },
      writeHttpMetadata(h: Headers) {
        if (o.httpMetadata?.contentType) h.set("content-type", o.httpMetadata.contentType);
        if (o.httpMetadata?.cacheControl) h.set("cache-control", o.httpMetadata.cacheControl);
      },
    };
  }
}

export class AntreanPalsu {
  readonly pesan: unknown[] = [];
  /** Setiap pengiriman beserta opsinya (mis. delaySeconds), berurutan. */
  readonly dikirim: Array<{ badan: unknown; opsi?: { delaySeconds?: number } }> = [];
  async send(badan: unknown, opsi?: { delaySeconds?: number }): Promise<void> {
    this.pesan.push(badan);
    this.dikirim.push({ badan, opsi });
  }
  async sendBatch(daftar: Array<{ body: unknown }>): Promise<void> {
    for (const d of daftar) {
      this.pesan.push(d.body);
      this.dikirim.push({ badan: d.body });
    }
  }
  /** Ambil dan kosongkan antrean (meniru pengiriman ke konsumer). */
  kuras(): unknown[] {
    return this.pesan.splice(0, this.pesan.length);
  }
}

// --- Workers AI dan Vectorize palsu -----------------------------------------

const DIMENSI = 32;

/** Embedding deterministik: kantong-kata yang di-hash ke 32 dimensi, dinormalkan. */
export function embedPalsu(teks: string): number[] {
  const v = new Array<number>(DIMENSI).fill(0);
  for (const kata of teks.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let h = 2166136261;
    for (const c of kata) {
      h ^= c.charCodeAt(0);
      h = Math.imul(h, 16777619) >>> 0;
    }
    v[h % DIMENSI] += 1;
  }
  const norma = Math.hypot(...v) || 1;
  return v.map((x) => x / norma);
}

type Obrolan = { messages: Array<{ role: string; content: string }> };

export class AiPalsu {
  readonly panggilan: Array<{ model: string; masukan: unknown }> = [];
  /** Jawaban model teks; bisa diganti per tes. */
  jawaban: string | ((masukan: Obrolan) => string) = "Jawaban uji.";
  /** Hasil toMarkdown per nama berkas. */
  readonly markdown = new Map<string, string>();
  /** Bila diisi, run() melempar galat ini (menguji ketahanan terhadap kegagalan AI). */
  galat: Error | null = null;
  /** Seperti `galat`, tetapi hanya untuk model teks; embedding tetap berhasil. */
  galatObrolan: Error | null = null;
  /** Bila diisi, toMarkdown() mengembalikan kegagalan konversi ini untuk semua berkas. */
  galatKonversi: string | null = null;
  /** Nama berkas yang dikonversi toMarkdown(), berurutan (menguji bahwa uraian-ulang dari arsip tak mengonversi). */
  readonly konversi: string[] = [];
  /** Penundaan (ms) sebelum embedding menjawab: menguji batas waktu pencarian makna. */
  tundaEmbedding = 0;

  /** Panggilan ke model teks (bukan embedding), untuk memeriksa prompt. */
  get panggilanObrolan() {
    return this.panggilan.filter((p) => Array.isArray((p.masukan as Partial<Obrolan>).messages));
  }

  async run(model: string, masukan: { text?: string[] } & Partial<Obrolan>): Promise<unknown> {
    this.panggilan.push({ model, masukan });
    if (this.galat) throw this.galat;
    if (Array.isArray(masukan.text)) {
      if (this.tundaEmbedding) await new Promise((selesai) => setTimeout(selesai, this.tundaEmbedding));
      return { shape: [masukan.text.length, DIMENSI], data: masukan.text.map(embedPalsu) };
    }
    if (masukan.messages) {
      if (this.galatObrolan) throw this.galatObrolan;
      const m = masukan as Obrolan;
      return { response: typeof this.jawaban === "function" ? this.jawaban(m) : this.jawaban };
    }
    return {};
  }

  async toMarkdown(berkas: Array<{ name: string; blob: Blob }>) {
    this.konversi.push(...berkas.map((b) => b.name));
    return berkas.map((b) =>
      this.galatKonversi !== null
        ? { name: b.name, mimeType: "application/pdf", format: "error" as const, error: this.galatKonversi }
        : {
            name: b.name,
            mimeType: "application/pdf",
            format: "markdown" as const,
            tokens: 0,
            data: this.markdown.get(b.name) ?? "",
          },
    );
  }
}

function kosinus(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * (b[i] ?? 0);
  return dot; // vektor sudah dinormalkan
}

export class VektorPalsu {
  readonly simpan = new Map<string, { values: number[]; metadata: Record<string, unknown> }>();

  async upsert(vektor: Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }>) {
    for (const v of vektor) this.simpan.set(v.id, { values: v.values, metadata: v.metadata ?? {} });
    return { mutationId: "uji", count: vektor.length };
  }

  /** Id yang membuat deleteByIds menolak seluruh panggilannya (menguji isolasi id bermasalah). */
  readonly idRacun = new Set<string>();
  readonly panggilanHapus: string[][] = [];
  async deleteByIds(ids: string[]) {
    this.panggilanHapus.push(ids);
    if (ids.some((id) => this.idRacun.has(id))) throw new Error("VECTOR_DELETE_ERROR: id ditolak");
    for (const id of ids) this.simpan.delete(id);
    return { mutationId: "uji-hapus", ids, count: ids.length };
  }

  async query(
    q: number[],
    opsi: { topK?: number; filter?: Record<string, { $in?: unknown[] }> } = {},
  ) {
    const kandidat = [...this.simpan.entries()]
      .filter(([, v]) =>
        Object.entries(opsi.filter ?? {}).every(([k, cond]) => !cond.$in || cond.$in.includes(v.metadata[k])),
      )
      .map(([id, v]) => ({ id, score: kosinus(q, v.values), metadata: v.metadata }))
      .sort((a, b) => b.score - a.score)
      .slice(0, opsi.topK ?? 10);
    return { matches: kandidat, count: kandidat.length };
  }
}

/** Header blok `/*` di public/_headers (CSP dan kawan-kawan), seperti yang ditambahkan Workers Static Assets. */
function headerGlobalAset(): Record<string, string> {
  const hasil: Record<string, string> = {};
  let aktif = false;
  for (const baris of readFileSync("public/_headers", "utf8").split("\n")) {
    if (!baris.trim() || baris.trim().startsWith("#")) continue;
    if (!/^\s/.test(baris)) {
      aktif = baris.trim() === "/*";
      continue;
    }
    const i = baris.indexOf(":");
    if (aktif && i > 0) hasil[baris.slice(0, i).trim()] = baris.slice(i + 1).trim();
  }
  return hasil;
}

const JENIS_ASET: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

/**
 * Binding `ASSETS` tiruan: berkas dari public/ yang sesungguhnya, dengan fallback SPA (jalur yang tak dikenal
 * menjawab index.html, 200) dan header global dari public/_headers. Seperti aslinya, jawaban membawa ETag dan
 * cache-control yang memaksa validasi.
 */
export class AsetPalsu {
  /** Ubah isi index.html sebelum disajikan: untuk menguji cangkang yang berubah bentuk. */
  gantiCangkang: ((html: string) => string) | null = null;
  /** Bila diisi, setiap permintaan melempar galat ini (aset tak terjangkau). */
  galat: Error | null = null;
  permintaan: string[] = [];

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const req = new Request(input as Request, init);
    if (this.galat) throw this.galat;
    const jalur = new URL(req.url).pathname;
    this.permintaan.push(jalur);
    let berkas = join("public", normalize(jalur === "/" ? "index.html" : jalur.slice(1)));
    let ada = false;
    try {
      ada = statSync(berkas).isFile();
    } catch {
      ada = false;
    }
    if (!ada) berkas = join("public", "index.html");

    let badan: string | Uint8Array = readFileSync(berkas);
    if (berkas.endsWith("index.html")) {
      badan = readFileSync(berkas, "utf8");
      if (this.gantiCangkang) badan = this.gantiCangkang(badan);
    }
    const header = new Headers({
      ...headerGlobalAset(),
      "content-type": JENIS_ASET[extname(berkas)] ?? "application/octet-stream",
      "cache-control": "public, max-age=0, must-revalidate",
      etag: '"aset-uji"',
      "last-modified": "Sat, 03 Oct 2026 00:00:00 GMT",
      "cf-cache-status": "HIT",
    });
    return new Response(badan as BodyInit, { status: 200, headers: header });
  }
}

// --- Lingkungan uji ---------------------------------------------------------

export interface Lingkungan {
  env: Env;
  db: D1Palsu;
  sqlite: DatabaseSync;
  kv: KvPalsu;
  r2: R2Palsu;
  antrean: AntreanPalsu;
  ai: AiPalsu;
  vektor: VektorPalsu;
  aset: AsetPalsu;
  tutup(): void;
}

export const TOKEN_ADMIN = "token-admin-uji";

/** Buat lingkungan baru: SQLite kosong + seluruh migrasi + binding tiruan. */
export function buatLingkungan(): Lingkungan {
  const sqlite = bukaSqlite();
  if (!sqlite) throw new Error("node:sqlite tidak tersedia; tes integrasi seharusnya dilewati.");

  for (const nama of readdirSync("migrations").filter((n) => n.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(`migrations/${nama}`, "utf8"));
  }

  const db = new D1Palsu(sqlite);
  const kv = new KvPalsu();
  const r2 = new R2Palsu();
  const antrean = new AntreanPalsu();
  const ai = new AiPalsu();
  const vektor = new VektorPalsu();
  const aset = new AsetPalsu();

  const env = {
    DB: db,
    CACHE: kv,
    DOCS: r2,
    AI: ai,
    VECTORIZE: vektor,
    INGEST_QUEUE: antrean,
    ASSETS: aset,
    EMBEDDING_MODEL: "@cf/baai/bge-m3",
    SUMMARY_MODEL: "@cf/uji/teks",
    BPK_BASE: "https://peraturan.bpk.go.id",
    PASAL_API_BASE: "https://pasal.test/api",
    SEARCH_CACHE_TTL: "3600",
    ADMIN_TOKEN: TOKEN_ADMIN,
    PASAL_API_TOKEN: "token-pasal-uji",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
  } as unknown as Env;

  return { env, db, sqlite, kv, r2, antrean, ai, vektor, aset, tutup: () => sqlite.close() };
}

// --- Memanggil Worker -------------------------------------------------------

function buatCtx() {
  const tugas: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: (p: Promise<unknown>) => void tugas.push(p),
      passThroughOnException: () => {},
    } as unknown as ExecutionContext,
    /** Tunggu semua pekerjaan latar (waitUntil) selesai, seperti runtime nyata. */
    selesai: () => Promise.allSettled(tugas),
  };
}

export const ASAL = "https://lexa.test";

/** Panggil handler `fetch` Worker, lalu tunggu pekerjaan latar selesai. */
export async function panggil(l: Lingkungan, path: string, init?: RequestInit): Promise<Response> {
  const { ctx, selesai } = buatCtx();
  const res = await worker.fetch(new Request(ASAL + path, init), l.env, ctx);
  await selesai();
  return res;
}

export async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export interface HasilAntrean {
  diakui: number;
  diulang: Array<{ penundaanDetik?: number }>;
}

/** Jalankan konsumer antrean Worker untuk sekumpulan pesan. */
export async function jalankanAntrean(l: Lingkungan, pesan: unknown[]): Promise<HasilAntrean> {
  const hasil: HasilAntrean = { diakui: 0, diulang: [] };
  const batch = {
    queue: "lexa-ingest",
    messages: pesan.map((body, i) => ({
      id: `uji-${i}`,
      timestamp: new Date(),
      attempts: 1,
      body,
      ack: () => void hasil.diakui++,
      retry: (o?: { delaySeconds?: number }) => void hasil.diulang.push({ penundaanDetik: o?.delaySeconds }),
    })),
    ackAll: () => {},
    retryAll: () => {},
  };
  await worker.queue(batch as never, l.env);
  return hasil;
}

/** Pemicu harian (sapuan daftar) dan per menit (tik), seperti di wrangler.jsonc. */
export const CRON_HARIAN = "0 19 * * *";
export const CRON_MENIT = "* * * * *";

/** Jalankan handler `scheduled` (cron) Worker dan tunggu pekerjaan latar. Bawaannya pemicu harian. */
export async function jalankanCron(l: Lingkungan, cron: string = CRON_HARIAN): Promise<void> {
  const { ctx, selesai } = buatCtx();
  await worker.scheduled({ cron, scheduledTime: Date.now(), type: "scheduled", noRetry() {} } as never, l.env, ctx);
  await selesai();
}

/** Kuras antrean lalu jalankan konsumer sampai kosong (mengikuti rantai pesan). */
export async function kurasSemua(l: Lingkungan, maksPutaran = 10): Promise<number> {
  let total = 0;
  for (let i = 0; i < maksPutaran; i++) {
    const pesan = l.antrean.kuras();
    if (!pesan.length) break;
    total += pesan.length;
    await jalankanAntrean(l, pesan);
  }
  return total;
}

// --- Data uji ---------------------------------------------------------------

export interface PeraturanUji {
  uri: string;
  jenis: string;
  nomor: string;
  tahun: number;
  judul: string;
  status?: "berlaku" | "dicabut" | "diubah";
  tentang?: string;
  instansi?: string;
  bidang?: string;
  bpkId?: string;
  pasal?: Array<{ nomor: string; ayat?: string | null; bab?: string | null; isi: string }>;
}

/** Sisipkan peraturan dan pasal lewat SQL biasa; trigger mengisi indeks FTS5. */
export async function sisipkan(l: Lingkungan, daftar: PeraturanUji[]): Promise<void> {
  for (const p of daftar) {
    await l.db
      .prepare(
        `INSERT INTO laws (frbr_uri, jenis, nomor, tahun, judul, tentang, status, instansi, bidang, bpk_id, jumlah_pasal, isi_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        p.uri, p.jenis, p.nomor, p.tahun, p.judul, p.tentang ?? null, p.status ?? "berlaku",
        p.instansi ?? null, p.bidang ?? null, p.bpkId ?? null, p.pasal?.length ?? 0,
        // Seperti hasil pengambilan isi: yang punya pasal lengkap, yang tidak masih menunggu.
        p.pasal?.length ? "lengkap" : "menunggu",
      )
      .run();
    for (const [i, a] of (p.pasal ?? []).entries()) {
      const id = `${p.uri}#pasal-${a.nomor}${a.ayat ? `-ayat-${a.ayat}` : ""}`;
      await l.db
        .prepare(
          `INSERT INTO articles (id, frbr_uri, nomor_pasal, ayat, bab, isi, urutan) VALUES (?,?,?,?,?,?,?)`,
        )
        .bind(id, p.uri, a.nomor, a.ayat ?? null, a.bab ?? null, a.isi, i)
        .run();
    }
  }
}

export const KORPUS: PeraturanUji[] = [
  {
    uri: "/akn/id/act/uu/2003/13", jenis: "UU", nomor: "13", tahun: 2003, judul: "Ketenagakerjaan",
    tentang: "Ketenagakerjaan", instansi: "Indonesia", bidang: "KETENAGAKERJAAN", bpkId: "1001",
    pasal: [
      { nomor: "82", ayat: "1", bab: "BAB X", isi: "Pekerja perempuan berhak memperoleh istirahat selama 1,5 bulan sebelum saatnya melahirkan anak dan 1,5 bulan sesudah melahirkan menurut perhitungan dokter kandungan." },
      { nomor: "156", ayat: "1", bab: "BAB XII", isi: "Dalam hal terjadi pemutusan hubungan kerja, pengusaha wajib membayar uang pesangon dan atau uang penghargaan masa kerja dan uang penggantian hak yang seharusnya diterima." },
    ],
  },
  {
    uri: "/akn/id/act/uu/2020/11", jenis: "UU", nomor: "11", tahun: 2020, judul: "Cipta Kerja",
    status: "dicabut", tentang: "Cipta Kerja", instansi: "Indonesia", bidang: "EKONOMI - KETENAGAKERJAAN", bpkId: "149750",
    pasal: [{ nomor: "1", isi: "Cipta kerja adalah upaya penciptaan kerja melalui usaha kemudahan, perlindungan, dan pemberdayaan koperasi dan usaha mikro, kecil, dan menengah." }],
  },
  {
    uri: "/akn/id/act/uu/2023/6", jenis: "UU", nomor: "6", tahun: 2023,
    judul: "Penetapan Peraturan Pemerintah Pengganti Undang-Undang Nomor 2 Tahun 2022 tentang Cipta Kerja menjadi Undang-Undang",
    instansi: "Indonesia", bidang: "EKONOMI", bpkId: "246523",
    pasal: [{ nomor: "1", isi: "Peraturan Pemerintah Pengganti Undang-Undang Nomor 2 Tahun 2022 tentang Cipta Kerja ditetapkan menjadi undang-undang." }],
  },
  {
    uri: "/akn/id/act/pp/2021/35", jenis: "PP", nomor: "35", tahun: 2021,
    judul: "Perjanjian Kerja Waktu Tertentu, Alih Daya, Waktu Kerja dan Waktu Istirahat, dan Pemutusan Hubungan Kerja",
    instansi: "Indonesia", bidang: "KETENAGAKERJAAN",
    pasal: [{ nomor: "40", ayat: "1", isi: "Dalam hal terjadi pemutusan hubungan kerja, pengusaha wajib membayar uang pesangon dan atau uang penghargaan masa kerja dan uang penggantian hak." }],
  },
];

// --- Pembantu tes -----------------------------------------------------------

/** Konteks ingest yang dibangun dari lingkungan uji, sama seperti `konteksIngest` di Worker. */
export function konteksIngestUji(l: Lingkungan): KonteksIngest {
  return {
    db: l.env.DB,
    vectorize: l.env.VECTORIZE,
    ai: l.env.AI,
    docs: l.env.DOCS,
    queue: l.env.INGEST_QUEUE,
    pasal: new PasalClient({ base: l.env.PASAL_API_BASE, token: l.env.PASAL_API_TOKEN }),
    embeddingModel: l.env.EMBEDDING_MODEL,
    summaryModel: l.env.SUMMARY_MODEL,
    cakupan: bacaCakupan(l.env.CAKUPAN_JENIS),
  };
}

/** Indeks vektor untuk peraturan yang diberikan (bawaan: seluruh KORPUS) lewat kode asli. */
export async function indeksSemua(l: Lingkungan, daftar: string[] = KORPUS.map((p) => p.uri)): Promise<void> {
  const ctx = konteksIngestUji(l);
  for (const uri of daftar) await indeksVektor(ctx, uri);
}

export interface RelasiUji {
  dari: string;
  ke: string;
  jenis: string;
  keterangan?: string;
}

export async function sisipkanRelasi(l: Lingkungan, daftar: RelasiUji[]): Promise<void> {
  for (const r of daftar) {
    await l.db
      .prepare(`INSERT INTO relations (from_uri, to_uri, jenis_relasi, keterangan) VALUES (?,?,?,?)`)
      .bind(r.dari, r.ke, r.jenis, r.keterangan ?? null)
      .run();
  }
}

/** Pasangan relasi dua arah yang lazim: UU 6/2023 mencabut UU 11/2020. */
export const RELASI_CIPTA_KERJA: RelasiUji[] = [
  { dari: "/akn/id/act/uu/2020/11", ke: "/akn/id/act/uu/2023/6", jenis: "dicabut_oleh", keterangan: "UU 6/2023" },
  { dari: "/akn/id/act/uu/2023/6", ke: "/akn/id/act/uu/2020/11", jenis: "mencabut", keterangan: "UU 11/2020" },
];

/** Buat pengguna + sesi di KV; kembalikan header Cookie untuk permintaan berikutnya. */
export async function masukSebagai(
  l: Lingkungan,
  p: { id?: string; email?: string; nama?: string | null; idSesi?: string } = {},
): Promise<{ cookie: string }> {
  const id = p.id ?? "u1";
  const email = p.email ?? `${id}@example.test`;
  const idSesi = p.idSesi ?? `sesi-${id}`;
  await l.db
    .prepare(`INSERT OR IGNORE INTO pengguna (id, email, nama) VALUES (?,?,?)`)
    .bind(id, email, p.nama === undefined ? "Penguji" : p.nama)
    .run();
  await l.kv.put(
    `sesi:${idSesi}`,
    JSON.stringify({ pengguna_id: id, email, nama: p.nama === undefined ? "Penguji" : p.nama, foto_url: null, dibuat: Date.now() }),
  );
  return { cookie: `lexa_sesi=${idSesi}` };
}

/** Permintaan dengan badan JSON. */
export function kirim(metode: string, badan?: unknown, header: Record<string, string> = {}): RequestInit {
  return {
    method: metode,
    headers: { "content-type": "application/json", ...header },
    body: badan === undefined ? undefined : JSON.stringify(badan),
  };
}
