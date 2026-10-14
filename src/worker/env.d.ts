/**
 * Tipe global `Env` untuk Worker Lexa.
 *
 * Nama binding, variabel, dan secret ini harus sama dengan yang ada di
 * `wrangler.jsonc` dan di dashboard Cloudflare. File ini hanya berisi tipe
 * (tidak ikut ter-bundle), sehingga tidak memengaruhi perilaku runtime.
 */
interface Env {
  // --- Binding ---
  /** D1 `lexa-db`: peraturan, pasal, relasi, pengguna, log. */
  DB: D1Database;
  /** KV `lexa-cache`: cache hasil pencarian, sesi login, pembatas laju. */
  CACHE: KVNamespace;
  /** R2 `lexa-pdfs`: PDF asli (`pdf/…`) dan teks hasil ekstraksi (`teks/…`). */
  DOCS: R2Bucket;
  /** Workers AI: embedding, ringkasan, tanya-jawab, `toMarkdown` untuk PDF. */
  AI: Ai;
  /** Indeks Vectorize berisi vektor per pasal. */
  VECTORIZE: VectorizeIndex;
  /** Antrean ingest (producer dan konsumer ada pada Worker yang sama). */
  INGEST_QUEUE: Queue<import("./lib/ingest").PesanIngest>;
  /** Aset statis (`public/`): dipakai untuk menyajikan cangkang SPA dengan pratinjau tautan (lib/pratinjau.ts). */
  ASSETS: Fetcher;

  // --- Variabel (bukan rahasia) ---
  /** Model embedding Workers AI, mis. `@cf/baai/bge-m3`. */
  EMBEDDING_MODEL: string;
  /** Model teks Workers AI untuk ringkasan dan tanya-jawab. */
  SUMMARY_MODEL: string;
  /** Basis URL situs BPK untuk membangun tautan sumber resmi. */
  BPK_BASE: string;
  /** TTL cache hasil pencarian dalam detik (string; bawaan 3600). */
  SEARCH_CACHE_TTL: string;
  /**
   * Batas waktu pencarian makna (embedding Workers AI + Vectorize) dalam milidetik (string; bawaan `BATAS_VEKTOR_MS` di
   * lib/search.ts). Lewat batas ini hasil kata kunci dikirim tanpa menunggu, dan tidak disimpan di cache.
   */
  BATAS_VEKTOR_MS?: string;
  /**
   * Jenis peraturan yang dicakup, kode seperti `laws.jenis` dipisah koma (mis. `UUD,TAP_MPR,UU,PERPPU,PP`).
   * Tak ada atau tak sah: `CAKUPAN_BAWAAN` di shared/cakupan.ts. Lihat berkas itu.
   */
  CAKUPAN_JENIS?: string;

  // --- Secret (dipasang lewat `wrangler secret put`) ---
  ADMIN_TOKEN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}
