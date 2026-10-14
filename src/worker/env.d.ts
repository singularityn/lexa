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
  /** Model Gemini untuk membaca PDF yang tak punya lapisan teks (lib/gemini.ts); bawaan `gemini-flash-latest`. */
  GEMINI_MODEL?: string;
  /** Alamat dasar API Gemini; bawaan API Google langsung. Isi dengan alamat AI Gateway Cloudflare bila dipakai. */
  GEMINI_BASE_URL?: string;
  /** Token (masuk + keluar) per hari UTC yang boleh dipakai semua pembacaan Gemini (string; bawaan 5.000.000). */
  GEMINI_BATAS_HARIAN?: string;
  /**
   * Gemini otomatis lewat Cron 15 menit (lib/geminiOtomatis.ts): `uji` (percobaan kering, berhenti sendiri setelah
   * GEMINI_OTOMATIS_UJI_MAKS) atau `ya` (membaca sungguhan). Tak ada atau nilai lain: mati.
   */
  GEMINI_OTOMATIS?: string;
  /** Peraturan yang diantrekan tiap putaran Gemini otomatis (bawaan 2, maksimum 10). */
  GEMINI_OTOMATIS_BATAS?: string;
  /** Banyaknya percobaan kering sebelum mode `uji` berhenti sendiri (bawaan 8). */
  GEMINI_OTOMATIS_UJI_MAKS?: string;
  /** Vonis ekstraksi yang menjadi calon, dipisah koma (bawaan `tanpa_pasal,berat,gagal`). */
  GEMINI_OTOMATIS_VONIS?: string;

  // --- Secret (dipasang lewat `wrangler secret put`) ---
  ADMIN_TOKEN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /**
   * Kunci API Gemini (Google AI Studio). Opsional: tanpa ini jalur ekstrak-ulang `gemini` menjawab 503 dan semua fitur lain
   * berjalan seperti biasa. Pasang sebagai Secret (bukan variabel teks) di Settings > Variables and Secrets.
   */
  GEMINI_API?: string;
}
