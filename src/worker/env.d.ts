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
   * Pengaturan berpikir model: angka (thinkingBudget, mis. `0` pada seri 2.5) atau kata (thinkingLevel, mis. `LOW` pada seri 3).
   * Tak ada bawaan: pembacaan nyata pertama memakai 4.443 token berpikir dari 7.748 token yang dihasilkan, jadi mengecilkannya
   * menurunkan biaya dan waktu. Nilai yang ditolak model muncul sebagai galat 400 pada `geminiCek`.
   */
  GEMINI_BERPIKIR?: string;
  /**
   * Model Gemini cadangan, dicoba sekali bila model utama (GEMINI_MODEL) masih sibuk (503 "high demand") atau kuotanya habis (429)
   * setelah percobaannya. Tanpa bawaan. Pengaturan berpikir tidak dikirim ke model cadangan.
   */
  GEMINI_MODEL_CADANGAN?: string;
  /** Halaman per panggilan Gemini untuk PDF panjang (bawaan 4, 1-20). */
  GEMINI_HALAMAN?: string;
  /** Panggilan Gemini yang berjalan bersamaan untuk satu PDF (bawaan 3, 1-8). */
  GEMINI_PARALEL?: string;
  /**
   * PDF yang lebih panjang dari ini (bawaan 120, 1-5000) ditolak tanpa memanggil Gemini (`terlalu_panjang`), supaya undang-undang
   * raksasa (Cipta Kerja: 1.000+ halaman) tak menghabiskan anggaran harian atau menahan antrean Cron. Naikkan untuk membacanya sengaja.
   */
  GEMINI_HALAMAN_MAKS?: string;
  /**
   * Gemini otomatis lewat Cron 15 menit (lib/geminiOtomatis.ts): `uji` (percobaan kering atas peraturan yang teksnya bermasalah,
   * berhenti sendiri setelah GEMINI_OTOMATIS_UJI_MAKS) atau `ya` (membaca sungguhan SEMUA PDF yang belum dibaca Gemini, yang paling
   * rusak lebih dulu). Tak ada atau nilai lain: mati.
   */
  GEMINI_OTOMATIS?: string;
  /** Peraturan yang diantrekan tiap putaran Gemini otomatis (bawaan 2 pada `uji` dan 5 pada `ya`, maksimum 20). */
  GEMINI_OTOMATIS_BATAS?: string;
  /** Banyaknya percobaan kering sebelum mode `uji` berhenti sendiri (bawaan 8). */
  GEMINI_OTOMATIS_UJI_MAKS?: string;
  /** Vonis ekstraksi yang menjadi calon, dipisah koma (bawaan `tanpa_pasal,berat,gagal` pada `uji`; semua vonis pada `ya`). */
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
