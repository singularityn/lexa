/**
 * Tipe yang dipakai bersama oleh Worker (dan frontend).
 *
 * Catatan asal-usul: berkas aslinya hanya berisi tipe sehingga tidak ikut
 * ter-bundle ke Worker produksi dan tidak ada di sourcemap. Isi di sini
 * direkonstruksi dari pemakaiannya di `src/worker` (bentuk objek yang dibuat
 * dan dikembalikan oleh API), lalu dicocokkan dengan skema D1 produksi.
 */

/** Status peraturan; mengikuti CHECK constraint pada tabel `laws`. */
export type StatusPeraturan = "berlaku" | "dicabut" | "diubah";

/** Jenis hubungan antar-peraturan; mengikuti CHECK constraint pada tabel `relations`. */
export type JenisRelasi =
  | "mengubah"
  | "diubah_oleh"
  | "mencabut"
  | "dicabut_oleh"
  | "dasar_hukum"
  | "menjadi_dasar_hukum"
  | "melaksanakan"
  | "dilaksanakan_oleh"
  | "terkait";

/** Satu peraturan (baris tabel `laws`, tanpa kolom internal). */
export interface Law {
  /** URI gaya FRBR/Akoma Ntoso, mis. `/akn/id/act/uu/2003/13`. */
  frbr_uri: string;
  /** Kode jenis huruf besar, mis. `UU`, `PP`, `PERPRES`, `PERMEN`, `POJK`. */
  jenis: string;
  nomor: string;
  tahun: number;
  judul: string;
  tentang: string | null;
  status: StatusPeraturan;
  tanggal_penetapan: string | null;
  tanggal_berlaku: string | null;
  instansi: string | null;
  bidang: string | null;
  /** ID dokumen di peraturan.bpk.go.id (untuk tautan ke naskah resmi). */
  bpk_id: string | null;
  sumber_url: string | null;
  ringkasan: string | null;
  jumlah_pasal: number;
}

/** Satu pasal atau ayat (baris tabel `articles`). */
export interface Article {
  id: string;
  frbr_uri: string;
  nomor_pasal: string;
  ayat: string | null;
  bab: string | null;
  bagian: string | null;
  judul: string | null;
  isi: string;
  urutan: number;
}

/**
 * Relasi keluar dari sebuah peraturan, digabung (LEFT JOIN) dengan metadata
 * peraturan tujuan. Kolom tujuan bernilai null bila peraturan itu belum
 * ter-ingest.
 */
export interface Relation {
  to_uri: string;
  jenis_relasi: JenisRelasi;
  keterangan: string | null;
  judul: string | null;
  jenis: string | null;
  nomor: string | null;
  tahun: number | null;
  status: StatusPeraturan | null;
}

/** Mode pencarian. `hybrid` menggabungkan sitasi, kata kunci (FTS5), dan makna (vektor). */
export type SearchMode = "hybrid" | "keyword" | "semantic";

/** Asal sebuah hasil pencarian sebelum digabung dengan RRF. */
export type SumberPencarian = "sitasi" | "fts" | "vector";

export interface SearchFilters {
  jenis?: string[];
  status?: StatusPeraturan[];
  tahun_min?: number;
  tahun_max?: number;
  instansi?: string;
  bidang?: string;
}

/** Satu hasil pencarian: sebuah peraturan, atau sebuah pasal di dalamnya. */
export interface SearchHit {
  frbr_uri: string;
  jenis: string;
  nomor: string;
  tahun: number;
  judul: string;
  tentang: string | null;
  status: StatusPeraturan;
  /** Cuplikan teks; dari FTS5 sudah memuat penanda `<mark>`. */
  snippet: string | null;
  /** Terisi bila hasilnya level pasal. */
  article_id: string | null;
  nomor_pasal: string | null;
  ayat: string | null;
  /**
   * Skor RRF gabungan. Urutan hasil bukan urutan skor: peraturan yang namanya memuat kata kunci (`cocok_judul`)
   * selalu didahulukan, apa pun skornya (lihat lib/judul.ts).
   */
  score: number;
  sources: SumberPencarian[];
  /**
   * Ada (true) bila hasil ini peraturan yang JUDULNYA memuat kata yang diketik ("kelautan" -> "Undang-Undang Nomor 32
   * Tahun 2014 tentang Kelautan"). Hasil seperti ini selalu berada di awal daftar, berurutan dari yang pokok judulnya
   * paling dibicarakan kata itu. Tidak pernah ada pada hasil pasal.
   */
  cocok_judul?: true;
}

export interface SearchResponse {
  query: string;
  mode: SearchMode;
  hits: SearchHit[];
  total: number;
  durasi_ms: number;
  /** Istilah hasil normalisasi (stem, sinonim) yang dipakai pada sisi kata kunci. */
  expanded_terms: string[];
  cached: boolean;
  /**
   * Ada bila hasil memuat cadangan longgar: pencarian ketat (semua kata) menemukan terlalu sedikit,
   * sehingga ditambah peraturan yang memuat sebagian kata. `penuh` = jumlah hasil yang memuat semua kata.
   */
  longgar?: { penuh: number };
  /**
   * Ada bila kueri berbentuk sitasi ke jenis peraturan di luar cakupan Lexa ("Perpres 12/2020"): kode jenisnya
   * ("PERPRES") dan jenis yang dicakup. Peraturan itu sendiri tidak dicari; hasil lain tetap berasal dari
   * kata-katanya.
   */
  di_luar_cakupan?: { jenis: string; cakupan: string[] };
}

/** Satu butir facet pada halaman telusur. */
export interface FacetItem {
  value: string;
  count: number;
  label: string;
}

/** Respons `GET /api/laws` (telusur dengan filter dan facet). */
export interface BrowseResponse {
  laws: Law[];
  total: number;
  page: number;
  per_page: number;
  facets: {
    jenis: FacetItem[];
    tahun: FacetItem[];
    status: FacetItem[];
  };
  /** Kode jenis yang dicakup Lexa (shared/cakupan.ts); jenis lain tidak ada di daftar maupun facet. */
  cakupan: string[];
  /** Jenis pada filter `jenis` yang di luar cakupan dan karenanya tidak menghasilkan apa pun. */
  di_luar_cakupan?: string[];
}

/** Respons `GET /api/laws/detail?uri=…`. */
export interface LawDetailResponse {
  law: Law;
  articles: Article[];
  relations: Relation[];
  /** Tautan ke naskah di peraturan.bpk.go.id, bila `bpk_id` diketahui. */
  bpk_url: string | null;
}
