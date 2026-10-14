/**
 * Klien Gemini untuk membaca PDF peraturan yang tak bisa dibaca konversi bawaan.
 *
 * KENAPA ADA: konversi bawaan (Workers AI `toMarkdown`) hanya membaca LAPISAN TEKS sebuah PDF. Di produksi (14 Okt 2026)
 * 487 dari 2.630 peraturan yang sudah dipanen (18%) tak menghasilkan pasal yang layak: 442 `tanpa_pasal`, 37 `berat`, 8
 * `gagal`. Sebagian besar pindaian lama (1946-1969) dan pindaian modern tanpa lapisan teks (mis. UU 24/2019 dan UU 33/2014:
 * 927 dan 1.347 karakter dari PDF 191 dan 322 KB). Pengurai deterministik tak bisa memulihkan teks yang tak ada. Gemini
 * membaca halaman sebagai gambar, jadi lapisan teks yang hilang atau rusak tak menghalanginya.
 *
 * YANG DILAKUKAN: PDF dikirim sebaris (base64) dengan perintah transkripsi setia; jawabannya teks bersih dengan penanda
 * "=== HALAMAN n ===", yang diubah menjadi "### Page n" supaya sisa pipeline (bersihkanHalaman, uraikanPasal, uraikanPenjelasan,
 * nilaiKualitasEkstraksi, putuskanPenggantian) bekerja persis seperti pada teks hasil konversi bawaan. Gemini TIDAK menggantikan
 * pengurai: ia hanya menggantikan langkah "PDF menjadi teks".
 *
 * YANG TIDAK DIPERCAYA: teks hukum tak boleh berubah diam-diam. Hasil Gemini lolos hanya bila `periksaTranskripsi` tak
 * menemukan masalah (halaman lengkap dan berurutan, tak ada pengulangan, tak banyak [tidak terbaca]) dan, sesudah diurai,
 * bermutu sama dengan teks bawaan (`nilaiKualitasEkstraksi`) serta tak mengurangi nomor pasal yang sudah tersimpan
 * (`putuskanPenggantian`). Kunci (secret `GEMINI_API`) tak pernah dicatat, dan pemakaian token dibatasi per hari.
 *
 * Tak ada fitur pembaca Lexa yang bergantung pada modul ini: bila kunci tak dipasang atau kuota habis, hanya jalur
 * ekstrak-ulang `gemini` yang berhenti.
 */

import { bukaPdf, type PemecahPdf } from "./pdfBagi";

export const MODEL_BAWAAN = "gemini-flash-latest";
export const BASE_URL_BAWAAN = "https://generativelanguage.googleapis.com/v1beta";
/** Token (masuk + keluar) per hari UTC yang boleh dipakai semua pembacaan sekaligus. Bisa diubah lewat GEMINI_BATAS_HARIAN. */
export const ANGGARAN_HARIAN_BAWAAN = 5_000_000;
/** PDF dikirim sebaris: base64 menambah sepertiga dan satu permintaan dibatasi 20 MB. Yang lebih besar perlu Files API (belum didukung). */
export const MAKS_BYTE_PDF = 14 * 1024 * 1024;
/** Paling banyak berapa kali satu PDF dikirim untuk melanjutkan keluaran yang terpotong batas panjang jawaban. */
export const MAKS_PUTARAN = 6;
/**
 * PDF dibaca per potongan sependek ini (GEMINI_HALAMAN). Pembacaan nyata pertama (PP 3/1961, 9 halaman) memakan 337 detik dan
 * 13.052 token dalam satu panggilan; potongan pendek muat dalam batas waktu, dapat dibaca paralel, dan dicoba ulang satu per satu.
 */
export const HALAMAN_PER_PANGGILAN_BAWAAN = 4;
/** Panggilan Gemini yang berjalan bersamaan untuk satu PDF (GEMINI_PARALEL). Lebih banyak mempercepat, tetapi lebih mudah menabrak kuota. */
export const PARALEL_BAWAAN = 3;
/** PDF yang tak bisa dipecah dan lebih panjang dari ini ditolak: satu panggilan untuk semuanya tak akan selesai dalam batas waktu. */
export const MAKS_HALAMAN_UTUH = 30;
/**
 * PDF yang lebih panjang dari ini ditolak (`terlalu_panjang`) sebelum Gemini dipanggil sama sekali (GEMINI_HALAMAN_MAKS). Pembacaan
 * nyata pertama memakan ±38 detik dan ±1.450 token per halaman; satu pesan antrean menghabiskan paling lama 7 menit dan diulang
 * paling banyak tiga kali, jadi tiga potongan paralel selesai ±32 halaman per giliran (±130 halaman seluruhnya). Undang-undang
 * yang jauh lebih panjang (Cipta Kerja: 1.000+ halaman, ±1,7 juta token) akan menghabiskan anggaran harian dan menahan antrean
 * Cron berjam-jam; membacanya adalah keputusan yang disengaja: naikkan batas ini dulu.
 */
export const MAKS_HALAMAN_BAWAAN = 120;

const BATAS_WAKTU_BAWAAN_MS = 240_000;
/** Batas waktu satu panggilan untuk satu potongan; yang melewatinya dipecah lagi menjadi dua. */
const BATAS_WAKTU_BAGIAN_MS = 180_000;
const MAKS_PERCOBAAN = 3;
const JEDA_ULANG_MS = [4_000, 12_000];

/** Pengaturan berpikir model: angka (thinkingBudget, seri 2.5) atau tingkat (thinkingLevel, seri 3); null = bawaan model. */
export type PengaturanBerpikir = { anggaran: number } | { tingkat: string } | null;

export interface KonfigGemini {
  kunci: string;
  model: string;
  baseUrl: string;
  /** Token (masuk + keluar) yang boleh dipakai per hari UTC. */
  anggaranHarian: number;
  /**
   * GEMINI_BERPIKIR. Pembacaan nyata pertama memakai 4.443 token berpikir dari 7.748 token yang dihasilkan, sedangkan transkripsi tak
   * butuh bernalar: mengecilkannya menurunkan biaya dan waktu. Bentuk nilainya berbeda per seri model, jadi tak ada bawaan; uji
   * dengan `geminiCek`, yang mengirim pengaturan yang sama.
   */
  berpikir: PengaturanBerpikir;
  /** Halaman per panggilan (GEMINI_HALAMAN). */
  halamanPerPanggilan: number;
  /** Panggilan bersamaan per PDF (GEMINI_PARALEL). */
  paralel: number;
  /** PDF yang lebih panjang ditolak tanpa memanggil Gemini (GEMINI_HALAMAN_MAKS). */
  halamanMaks: number;
}

/** Variabel dan secret yang dibaca modul ini (env.d.ts). */
export interface EnvGemini {
  GEMINI_API?: string;
  GEMINI_MODEL?: string;
  GEMINI_BASE_URL?: string;
  GEMINI_BATAS_HARIAN?: string;
  GEMINI_BERPIKIR?: string;
  GEMINI_HALAMAN?: string;
  GEMINI_PARALEL?: string;
  GEMINI_HALAMAN_MAKS?: string;
}

function bacaBerpikir(nilai: string | undefined): PengaturanBerpikir {
  const v = (nilai ?? "").trim();
  if (/^\d{1,6}$/.test(v)) return { anggaran: Number(v) };
  if (/^[A-Za-z][A-Za-z_]{1,31}$/.test(v)) return { tingkat: v };
  return null;
}

const bulatDalam = (nilai: string | undefined, bawaan: number, min: number, maks: number) => {
  const n = Number.parseInt((nilai ?? "").trim(), 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), maks) : bawaan;
};

/** Konfigurasi dari env; null bila kunci tak dipasang. Nilai variabel yang tak sah diabaikan (jatuh ke bawaan), bukan ditolak. */
export function bacaKonfigGemini(env: EnvGemini): KonfigGemini | null {
  const kunci = (env.GEMINI_API ?? "").trim();
  if (!kunci) return null;

  // "models/gemini-..." (bentuk di dokumentasi Google) dan "gemini-..." sama saja.
  const model = (env.GEMINI_MODEL ?? "").trim().replace(/^models\//, "");
  const baseUrl = (env.GEMINI_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const anggaran = Number.parseInt((env.GEMINI_BATAS_HARIAN ?? "").trim(), 10);

  return {
    kunci,
    model: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(model) ? model : MODEL_BAWAAN,
    baseUrl: /^https:\/\/[^\s?#]+$/.test(baseUrl) ? baseUrl : BASE_URL_BAWAAN,
    anggaranHarian: Number.isFinite(anggaran) && anggaran > 0 ? anggaran : ANGGARAN_HARIAN_BAWAAN,
    berpikir: bacaBerpikir(env.GEMINI_BERPIKIR),
    halamanPerPanggilan: bulatDalam(env.GEMINI_HALAMAN, HALAMAN_PER_PANGGILAN_BAWAAN, 1, 20),
    paralel: bulatDalam(env.GEMINI_PARALEL, PARALEL_BAWAAN, 1, 8),
    halamanMaks: bulatDalam(env.GEMINI_HALAMAN_MAKS, MAKS_HALAMAN_BAWAAN, 1, 5000),
  };
}

// ---------------------------------------------------------------------------
// Galat
// ---------------------------------------------------------------------------

export type JenisGalatGemini =
  | "kunci" //         kunci tak sah, tak berizin, atau API belum diaktifkan: berlaku untuk semua dokumen
  | "model" //         model tak ditemukan
  | "permintaan" //    permintaan ditolak (parameter tak dikenal model, isi terlalu besar)
  | "diblokir" //      jawaban dihentikan (SAFETY, RECITATION, ...) atau permintaan diblokir
  | "terlalu_besar" // PDF melebihi MAKS_BYTE_PDF
  | "terlalu_panjang" // PDF melebihi GEMINI_HALAMAN_MAKS halaman, atau tak bisa dipecah dan melebihi MAKS_HALAMAN_UTUH halaman
  | "keluaran" //      jawaban tak bisa dilanjutkan atau tak lengkap setelah MAKS_PUTARAN, atau satu halaman terlalu padat
  | "anggaran" //      anggaran token harian habis
  | "kuota" //         429: laju atau kuota Google habis (sementara)
  | "server" //        5xx dari Google (sementara)
  | "jaringan" //     Google tak terjangkau atau melewati batas waktu (sementara)
  | "lokasi" //       400 "User location is not supported": Google menilai alamat keluar pusat data Cloudflare tempat Worker berjalan berada di wilayah tak didukung; sifat lokasi eksekusi, bukan dokumen atau kunci (sementara)
  | "tertunda"; //     tenggat giliran habis di tengah pembacaan; bagian yang selesai tersimpan, sisanya dilanjutkan (sementara)

const SEMENTARA: ReadonlySet<JenisGalatGemini> = new Set(["kuota", "server", "jaringan", "tertunda", "lokasi"]);

/**
 * Galat pemanggilan Gemini. Yang `sementara` layak dicoba lagi nanti (konsumer antrean mengulang pesan dengan jeda
 * `jedaDetik`); selebihnya akan gagal sama persis dan dicatat tanpa diulang. Pesan tak pernah memuat kunci.
 */
export class GalatGemini extends Error {
  readonly sementara: boolean;
  constructor(
    readonly jenis: JenisGalatGemini,
    pesan: string,
    readonly rincian: { status?: number; jedaDetik?: number; habisWaktu?: boolean } = {},
  ) {
    super(pesan);
    this.name = "GalatGemini";
    this.sementara = SEMENTARA.has(jenis);
  }
  get status(): number | undefined {
    return this.rincian.status;
  }
  get jedaDetik(): number | undefined {
    return this.rincian.jedaDetik;
  }
  /** Gagal karena panggilan melewati batas waktu (bukan jaringan putus): potongan yang lebih pendek mungkin selesai. */
  get habisWaktu(): boolean {
    return this.rincian.habisWaktu === true;
  }
}

/** Buang kunci dari teks apa pun yang akan dicatat atau dikembalikan ke pemanggil. */
function samarkan(teks: string, kunci: string): string {
  return kunci ? teks.split(kunci).join("***") : teks;
}

// ---------------------------------------------------------------------------
// Pemakaian token dan anggaran harian
// ---------------------------------------------------------------------------

export interface PemakaianToken {
  masuk: number;
  keluar: number;
  /** Token "berpikir" model; ditagih sebagai keluaran. */
  pikir: number;
  total: number;
}

export const tokenKosong = (): PemakaianToken => ({ masuk: 0, keluar: 0, pikir: 0, total: 0 });

function tambahToken(a: PemakaianToken, b: PemakaianToken): PemakaianToken {
  return { masuk: a.masuk + b.masuk, keluar: a.keluar + b.keluar, pikir: a.pikir + b.pikir, total: a.total + b.total };
}

const kunciAnggaran = (sekarang: Date) => `gemini:token:${sekarang.toISOString().slice(0, 10)}`;

/** Token yang sudah dipakai hari ini (UTC) oleh semua pembacaan. Galat KV dibaca sebagai 0: anggaran adalah pengaman, bukan akuntansi. */
export async function pemakaianHariIni(kv: KVNamespace, sekarang: Date = new Date()): Promise<number> {
  const nilai = Number(await kv.get(kunciAnggaran(sekarang)).catch(() => null));
  return Number.isFinite(nilai) && nilai > 0 ? nilai : 0;
}

/** Tambahkan `token` ke hitungan hari ini. Baca-ubah-tulis tak atomik (KV): pengaman lunak, sedikit terlampaui itu wajar. */
export async function catatPemakaian(kv: KVNamespace, token: number, sekarang: Date = new Date()): Promise<number> {
  const sebelum = await pemakaianHariIni(kv, sekarang);
  if (!(token > 0)) return sebelum;
  const baru = sebelum + Math.round(token);
  await kv.put(kunciAnggaran(sekarang), String(baru), { expirationTtl: 3 * 86_400 }).catch(() => {});
  return baru;
}

// ---------------------------------------------------------------------------
// Pembantu PDF
// ---------------------------------------------------------------------------

/** Kelipatan 3: sambungan antarpotongan base64 tak butuh padding. */
const POTONGAN_BYTE = 30_000;

/** Base64 untuk byte sebesar apa pun tanpa menumpuk argumen (String.fromCharCode(...besar) melampaui batas tumpukan). */
export function keBase64(bytes: Uint8Array): string {
  let hasil = "";
  for (let i = 0; i < bytes.length; i += POTONGAN_BYTE) hasil += btoa(String.fromCharCode(...bytes.subarray(i, i + POTONGAN_BYTE)));
  return hasil;
}

/**
 * Perkiraan jumlah halaman dari objek "/Type /Page" (bukan "/Pages") di dalam berkas. null bila tak terbaca: PDF modern sering
 * menyimpan objek halaman dalam aliran terkompresi, dan itu bukan alasan menolak apa pun, hanya hilangnya satu pemeriksaan.
 */
export function perkirakanHalamanPdf(bytes: Uint8Array): number | null {
  let teks = "";
  for (let i = 0; i < bytes.length; i += POTONGAN_BYTE) teks += String.fromCharCode(...bytes.subarray(i, i + POTONGAN_BYTE));
  const jumlah = teks.match(/\/Type\s*\/Page(?![A-Za-z])/g)?.length ?? 0;
  return jumlah > 0 ? jumlah : null;
}

// ---------------------------------------------------------------------------
// Perintah transkripsi
// ---------------------------------------------------------------------------

export const PETUNJUK_TRANSKRIPSI = [
  "Anda adalah mesin transkripsi untuk dokumen peraturan perundang-undangan Republik Indonesia. Satu-satunya tugas Anda: menyalin isi berkas PDF yang diberikan menjadi teks yang bersih dan setia pada naskah aslinya. Anda bukan editor, penerjemah, atau peringkas.",
  "",
  "ATURAN ISI (tidak boleh dilanggar):",
  '1. Salin kata demi kata. Jangan merangkum, memparafrasa, menerjemahkan, menambah, atau menghilangkan kata, angka, atau pasal. Pertahankan ejaan, istilah, dan huruf besar-kecil sebagaimana tercetak, termasuk ejaan lama ("Undang-undang", "Lembaran-Negara").',
  "2. Bagian yang tidak terbaca atau meragukan ditulis [tidak terbaca]. Jangan menebak dan jangan melengkapi dari ingatan Anda tentang peraturan itu.",
  "3. Keluarkan HANYA hasil transkripsi: tanpa pembuka, komentar, penjelasan, atau pagar kode.",
  "",
  "YANG DIBUANG (bukan bagian naskah):",
  '- kepala dan kaki cetak yang berulang di setiap halaman: tulisan "PRESIDEN REPUBLIK INDONESIA" di atas halaman, nomor halaman cetak seperti "- 12 -", "SK No ...", alamat situs, "DISTRIBUSI", cap, tanda air, dan coretan;',
  "- catchword: satu atau beberapa kata di ujung bawah halaman yang hanya mengulang kata pertama halaman berikutnya (sering diikuti titik-titik).",
  'Selain itu semua teks harus ikut: judul, pembukaan (Menimbang, Mengingat, Memutuskan, Menetapkan), batang tubuh, penutup, pengesahan, Penjelasan, dan lampiran. Kalimat naskah seperti "PRESIDEN REPUBLIK INDONESIA," pada pembukaan dan tanda tangan adalah bagian naskah dan harus tetap.',
  "",
  "FORMAT:",
  "- Gabungkan baris yang terputus karena lebar halaman menjadi satu kalimat, dan sambungkan kata yang terpotong tanda hubung di ujung baris.",
  '- Tulis di baris sendiri: judul peraturan, "BAB I" beserta judul babnya, "Bagian Kesatu" beserta judulnya, "Paragraf 1", "Pasal 1" (hanya nomor pasal di baris itu), "PENJELASAN", "I. UMUM", "II. PASAL DEMI PASAL".',
  '- Isi pasal ditulis pada baris sesudah "Pasal N". Setiap ayat "(1)", "(2)", setiap huruf "a.", "b.", dan setiap angka "1.", "2." dimulai pada baris baru lengkap dengan penandanya.',
  '- Pasal sisipan ditulis apa adanya ("Pasal 28A"). Tabel disalin baris demi baris, kolom dipisah " | ".',
  "- Pada awal setiap halaman PDF, di baris sendiri, tulis penanda persis berbentuk === HALAMAN n === dengan n nomor urut halaman PDF mulai dari 1.",
].join("\n");

export const PERINTAH_AWAL = "Transkripsikan seluruh dokumen PDF ini sesuai aturan.";

export const perintahLanjut = (halaman: number) =>
  `Transkripsikan dokumen PDF ini sesuai aturan, tetapi mulai dari halaman ${halaman}: tulis penanda === HALAMAN ${halaman} === lebih dulu, lalu teruskan sampai halaman terakhir. Jangan mengulang halaman sebelum ${halaman}.`;

/** Perintah untuk satu potongan: PDF-nya hanya memuat halaman `mulai`-`akhir` dari `total`, dan penandanya relatif (mulai dari 1). */
export const perintahBagian = (mulai: number, akhir: number, total: number) =>
  `PDF ini hanya memuat halaman ${mulai} sampai ${akhir} dari naskah sepanjang ${total} halaman. Transkripsikan semua halaman di PDF ini sesuai aturan, dan beri penanda === HALAMAN n === dengan n dihitung dari 1 menurut urutan halaman di PDF ini (halaman pertama PDF ini = 1). Potongan ini mungkin dimulai atau berakhir di tengah kalimat atau pasal: salin apa adanya, jangan dilengkapi atau diberi kata pembuka.`;

/**
 * Pemblokiran bawaan Gemini sering salah menyangka naskah hukum (narkotika, pornografi, terorisme, pidana) sebagai konten
 * berbahaya. Yang disalin di sini dokumen resmi negara, jadi semua kategori dilonggarkan.
 */
const KATEGORI_KEAMANAN = ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"];

/** `generationConfig` dari GEMINI_BERPIKIR; kosong bila tak diatur, jadi tak ada parameter khusus versi yang terkirim tanpa diminta. */
export function pengaturanGenerasi(k: Pick<KonfigGemini, "berpikir">) {
  if (!k.berpikir) return {};
  const berpikir = "anggaran" in k.berpikir ? { thinkingBudget: k.berpikir.anggaran } : { thinkingLevel: k.berpikir.tingkat };
  return { generationConfig: { thinkingConfig: berpikir } };
}

function badanTranskripsi(k: KonfigGemini, pdfBase64: string, perintah: string) {
  return {
    systemInstruction: { parts: [{ text: PETUNJUK_TRANSKRIPSI }] },
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: "application/pdf", data: pdfBase64 } }, { text: perintah }] }],
    safetySettings: KATEGORI_KEAMANAN.map((category) => ({ category, threshold: "BLOCK_NONE" })),
    ...pengaturanGenerasi(k),
  };
}

// ---------------------------------------------------------------------------
// Pemanggilan
// ---------------------------------------------------------------------------

export interface OpsiPanggilan {
  /** Pengganti `fetch` (uji). */
  fetchFn?: typeof fetch;
  /** Pengganti jeda (uji): tanpa ini jeda ulang benar-benar menunggu. */
  tidur?: (ms: number) => Promise<void>;
  batasWaktuMs?: number;
}

export interface HasilPanggilan {
  teks: string;
  /** finishReason: STOP, MAX_TOKENS, SAFETY, RECITATION, ... */
  selesai: string;
  token: PemakaianToken;
  versiModel: string;
}

const tidurNyata = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

interface BerkasJawaban {
  candidates?: Array<{ content?: { parts?: Array<{ text?: unknown; thought?: unknown }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number };
  promptFeedback?: { blockReason?: string };
  modelVersion?: string;
}

function uraiJawaban(json: BerkasJawaban, model: string): HasilPanggilan {
  const calon = json.candidates?.[0];
  if (!calon) {
    const sebab = json.promptFeedback?.blockReason;
    throw new GalatGemini("diblokir", `Gemini tidak memberi jawaban${sebab ? ` (permintaan diblokir: ${sebab})` : ""}`);
  }
  const teks = (calon.content?.parts ?? [])
    .filter((p) => p.thought !== true && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");
  const u = json.usageMetadata ?? {};
  const masuk = u.promptTokenCount ?? 0;
  const keluar = u.candidatesTokenCount ?? 0;
  const pikir = u.thoughtsTokenCount ?? 0;
  return {
    teks,
    selesai: calon.finishReason ?? "STOP",
    token: { masuk, keluar, pikir, total: u.totalTokenCount ?? masuk + keluar + pikir },
    versiModel: json.modelVersion || model,
  };
}

/** Detik dari header Retry-After (angka saja; tanggal HTTP tak dipakai Google), dibatasi 15 menit. */
function jedaDariHeader(res: Response): number | undefined {
  const n = Number(res.headers.get("retry-after"));
  return Number.isFinite(n) && n > 0 ? Math.min(Math.ceil(n), 900) : undefined;
}

async function galatDariRespons(res: Response, k: KonfigGemini): Promise<GalatGemini> {
  let pesan = "";
  let kode = "";
  try {
    const j = (await res.json()) as { error?: { message?: string; status?: string } };
    pesan = j.error?.message ?? "";
    kode = j.error?.status ?? "";
  } catch {
    /* badan bukan JSON: cukup status */
  }
  const ringkas = samarkan(pesan, k.kunci).replace(/\s+/g, " ").trim().slice(0, 300);
  const status = res.status;
  const rincian = { status };
  const sisipan = ringkas ? `: ${ringkas}` : "";
  // Google menilai lokasi dari alamat IP keluar. Worker berjalan di pusat data Cloudflare terdekat dengan pemanggilnya (kadang
  // Hong Kong atau Singapura), dan alamat sebagian pusat data dikenali sebagai wilayah yang tak didukung. Itu keadaan lokasi
  // eksekusi, bukan salah dokumen atau kunci: percobaan berikutnya (alamat atau pusat data lain) bisa berhasil, jadi bukan "permintaan".
  if (status === 400 && /user location is not supported/i.test(pesan)) {
    return new GalatGemini(
      "lokasi",
      `Google menolak lokasi tempat Worker berjalan (HTTP 400)${sisipan}. Dicoba lagi di lokasi lain; bila terus terjadi, tetapkan placement.region ke wilayah AS di wrangler.jsonc`,
      { status, jedaDetik: 120 },
    );
  }
  // Kunci yang salah dijawab 400 INVALID_ARGUMENT ("API key not valid"), bukan 401.
  if (status === 401 || status === 403 || /API[ _]?KEY/i.test(`${pesan} ${kode}`)) {
    return new GalatGemini("kunci", `Gemini menolak kunci (HTTP ${status})${sisipan}`, rincian);
  }
  if (status === 404) return new GalatGemini("model", `Model ${k.model} tidak ditemukan (HTTP 404)${sisipan}`, rincian);
  if (status === 429) {
    return new GalatGemini("kuota", `Kuota atau laju Gemini habis (HTTP 429)${sisipan}`, { status, jedaDetik: jedaDariHeader(res) ?? 120 });
  }
  if (status === 408 || status >= 500) return new GalatGemini("server", `Gemini bermasalah (HTTP ${status})${sisipan}`, { status, jedaDetik: jedaDariHeader(res) ?? 60 });
  return new GalatGemini("permintaan", `Gemini menolak permintaan (HTTP ${status})${sisipan}`, rincian);
}

/** Satu pemanggilan generateContent, dengan pengulangan untuk gangguan jaringan, 5xx, dan penolakan lokasi (alamat keluar bisa berganti). Kuota (429) langsung dilaporkan. */
export async function panggilGemini(k: KonfigGemini, badan: unknown, opsi: OpsiPanggilan = {}): Promise<HasilPanggilan> {
  const fetchFn = opsi.fetchFn ?? fetch;
  const tidur = opsi.tidur ?? tidurNyata;
  const url = `${k.baseUrl}/models/${k.model}:generateContent`;
  const isi = JSON.stringify(badan);

  for (let percobaan = 1; ; percobaan++) {
    let res: Response;
    try {
      res = await fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": k.kunci },
        body: isi,
        signal: AbortSignal.timeout(opsi.batasWaktuMs ?? BATAS_WAKTU_BAWAAN_MS),
      });
    } catch (e) {
      // Lewat batas waktu tidak diulang di tempat: permintaan yang sama akan lewat lagi dan Google mungkin sudah menagihnya.
      // Antrean mengulang pesannya nanti.
      const habisWaktu = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      if (!habisWaktu && percobaan < MAKS_PERCOBAAN) {
        await tidur(JEDA_ULANG_MS[percobaan - 1] ?? 12_000);
        continue;
      }
      throw new GalatGemini(
        "jaringan",
        habisWaktu ? `Gemini tidak menjawab dalam ${Math.round((opsi.batasWaktuMs ?? BATAS_WAKTU_BAWAAN_MS) / 1000)} detik` : `Gemini tidak terjangkau: ${samarkan(String(e), k.kunci).slice(0, 200)}`,
        { jedaDetik: 60, habisWaktu },
      );
    }

    if (res.ok) {
      let json: BerkasJawaban;
      try {
        json = (await res.json()) as BerkasJawaban;
      } catch {
        throw new GalatGemini("server", "Jawaban Gemini bukan JSON yang sah", { status: res.status, jedaDetik: 60 });
      }
      return uraiJawaban(json, k.model);
    }

    const galat = await galatDariRespons(res, k);
    if ((galat.jenis === "server" || galat.jenis === "lokasi") && percobaan < MAKS_PERCOBAAN) {
      await tidur(JEDA_ULANG_MS[percobaan - 1] ?? 12_000);
      continue;
    }
    throw galat;
  }
}

/** Uji sambungan: kunci, model, dan alamat. Murah (beberapa token) dan tak menyentuh dokumen mana pun. */
export async function pingGemini(k: KonfigGemini, opsi: OpsiPanggilan = {}) {
  const mulai = Date.now();
  const hasil = await panggilGemini(k, { contents: [{ role: "user", parts: [{ text: "Balas hanya dengan satu kata: siap" }] }], ...pengaturanGenerasi(k) }, opsi);
  return { balasan: hasil.teks.trim().slice(0, 80), selesai: hasil.selesai, versiModel: hasil.versiModel, token: hasil.token, durasiMs: Date.now() - mulai };
}

// ---------------------------------------------------------------------------
// Keluaran: penanda halaman dan bentuk markdown
// ---------------------------------------------------------------------------

/** "=== HALAMAN 3 ===" (kadang dibungkus tanda markdown atau diberi spasi) di baris sendiri. */
const RE_PENANDA_AI = /^[ \t#*_`>-]*={2,}[ \t]*HALAMAN[ \t]+(\d{1,5})[ \t]*={2,}[ \t*_`]*$\n?/gim;
const RE_PENANDA_MD = /^### Page (\d+)$/gm;

/**
 * Keluaran Gemini menjadi markdown seperti hasil toMarkdown: pagar kode yang membungkus seluruh jawaban dibuang, dan penanda
 * "=== HALAMAN n ===" menjadi "### Page n" (jarak vertikal sama dengan konversi bawaan), yang dikenali bersihkanHalaman.
 */
export function keMarkdownHalaman(keluaran: string): string {
  // trim() juga membuang BOM (U+FEFF) di awal.
  let teks = keluaran.replace(/\r\n?/g, "\n").trim();
  const pagar = /^```[A-Za-z]*\n([\s\S]*?)\n?```$/.exec(teks);
  if (pagar) teks = pagar[1].trim();
  return teks.replace(RE_PENANDA_AI, (_semua, n: string) => `\n\n\n\n### Page ${Number(n)}\n`).trim();
}

/** Nomor semua penanda halaman, menurut urutan kemunculan. */
export function nomorPenanda(markdown: string): number[] {
  return [...markdown.matchAll(RE_PENANDA_MD)].map((m) => Number(m[1]));
}

/** Teks sebelum penanda halaman `nomor` yang terakhir muncul (penandanya sendiri ikut dibuang). */
function potongSebelumPenanda(markdown: string, nomor: number): string {
  let posisi = -1;
  for (const m of markdown.matchAll(RE_PENANDA_MD)) if (Number(m[1]) === nomor) posisi = m.index ?? posisi;
  return posisi < 0 ? markdown : markdown.slice(0, posisi).trimEnd();
}

// ---------------------------------------------------------------------------
// Membaca PDF
// ---------------------------------------------------------------------------

export interface OpsiBaca extends OpsiPanggilan {
  /** Dipanggil sesudah tiap pemanggilan dengan pemakaiannya, supaya token terhitung walau pembacaan akhirnya gagal. */
  pakai?: (token: PemakaianToken) => void;
  /** Berhenti (galat "anggaran") bila token pembacaan ini melampaui jumlah itu. */
  maksToken?: number;
  /** Halaman per panggilan dan panggilan bersamaan; bawaannya dari konfigurasi (GEMINI_HALAMAN, GEMINI_PARALEL). */
  halamanPerPanggilan?: number;
  paralel?: number;
  /**
   * Saat (milidetik sejak epoch) sesudahnya tak ada panggilan baru. Pembacaan yang belum selesai dilepas sebagai galat sementara
   * "tertunda"; bagian yang sudah dibaca tersimpan lewat `simpanBagian`, jadi percobaan berikutnya melanjutkannya.
   */
  tenggat?: number;
  /** Bagian yang sudah dibaca (markdown ber-penanda "### Page n" menurut nomor PDF asli) untuk rentang itu, atau null. */
  muatBagian?: (mulai: number, akhir: number) => Promise<string | null>;
  simpanBagian?: (mulai: number, akhir: number, markdown: string) => Promise<void>;
  /** Pengganti pembuka PDF (uji). */
  bukaPdf?: (bytes: Uint8Array) => Promise<PemecahPdf | null>;
}

export interface HasilBacaPdf {
  /** Markdown dengan penanda "### Page n". */
  markdown: string;
  /** Nomor halaman terakhir yang ditandai. */
  halaman: number;
  /** Jumlah halaman PDF: dari pdf-lib bila bisa dibuka, selain itu perkiraan (lihat perkirakanHalamanPdf); null bila tak terbaca. */
  halamanPdf: number | null;
  /** Banyaknya panggilan Gemini yang berhasil (potongan, termasuk potongan yang dipecah ulang). */
  putaran: number;
  token: PemakaianToken;
  versiModel: string;
}

/**
 * Baca seluruh PDF dengan Gemini. PDF yang lebih panjang dari `halamanPerPanggilan` dipecah (pdf-lib) dan dibaca per potongan,
 * `paralel` sekaligus (`bacaBerbagian`); yang pendek, atau yang tak bisa dipecah (terenkripsi, rusak), dibaca dalam satu panggilan
 * (`bacaUtuh`). Hasilnya markdown ber-penanda halaman yang sama untuk kedua jalan. PDF yang melebihi `halamanMaks` ditolak
 * (`terlalu_panjang`) sebelum satu pun panggilan dibuat.
 */
export async function bacaPdfDenganGemini(k: KonfigGemini, bytes: Uint8Array, opsi: OpsiBaca = {}): Promise<HasilBacaPdf> {
  if (bytes.byteLength > MAKS_BYTE_PDF) {
    throw new GalatGemini(
      "terlalu_besar",
      `PDF ${(bytes.byteLength / 1048576).toFixed(1)} MB melebihi batas ${MAKS_BYTE_PDF / 1048576} MB untuk dikirim sebaris (Files API belum didukung)`,
    );
  }
  const pemecah = await (opsi.bukaPdf ?? bukaPdf)(bytes).catch(() => null);
  if (pemecah && pemecah.halaman > k.halamanMaks) {
    throw new GalatGemini(
      "terlalu_panjang",
      `PDF ${pemecah.halaman} halaman melebihi batas ${k.halamanMaks} halaman per pembacaan (GEMINI_HALAMAN_MAKS): naikkan batasnya di dashboard bila memang ingin membacanya`,
    );
  }
  const ukuran = Math.max(1, opsi.halamanPerPanggilan ?? k.halamanPerPanggilan);
  if (pemecah && pemecah.halaman > ukuran) return bacaBerbagian(k, bytes, pemecah, opsi);

  const halamanPdf = pemecah?.halaman ?? perkirakanHalamanPdf(bytes);
  const batasUtuh = Math.min(MAKS_HALAMAN_UTUH, k.halamanMaks);
  if (!pemecah && halamanPdf !== null && halamanPdf > batasUtuh) {
    throw new GalatGemini("terlalu_panjang", `PDF ${halamanPdf} halaman dan tak bisa dipecah (terenkripsi atau rusak), padahal batasnya ${batasUtuh} halaman: satu panggilan untuk semuanya tak akan selesai tepat waktu`);
  }
  return bacaUtuh(k, bytes, opsi, halamanPdf);
}

/**
 * Satu PDF, satu panggilan. Keluaran yang terpotong batas panjang jawaban (MAX_TOKENS) dilanjutkan: halaman terakhir yang terpotong
 * dibuang, lalu PDF dikirim lagi dengan perintah mulai dari halaman itu. Lebih dari MAKS_PUTARAN putaran, atau berhenti karena
 * alasan lain (SAFETY, RECITATION), dilaporkan sebagai galat; teks yang sebagian tak dipakai.
 */
async function bacaUtuh(k: KonfigGemini, bytes: Uint8Array, opsi: OpsiBaca, halamanPdf: number | null): Promise<HasilBacaPdf> {
  const data = keBase64(bytes);
  let token = tokenKosong();
  let versiModel = k.model;
  let gabung = "";
  let mulaiDari = 1;

  for (let putaran = 1; putaran <= MAKS_PUTARAN; putaran++) {
    const jawaban = await panggilGemini(k, badanTranskripsi(k, data, putaran === 1 ? PERINTAH_AWAL : perintahLanjut(mulaiDari)), opsi);
    token = tambahToken(token, jawaban.token);
    versiModel = jawaban.versiModel;
    opsi.pakai?.(jawaban.token);
    if (opsi.maksToken !== undefined && token.total > opsi.maksToken) {
      throw new GalatGemini("anggaran", `Pembacaan melampaui sisa anggaran token harian (${token.total} token terpakai)`);
    }

    const bagian = keMarkdownHalaman(jawaban.teks);
    gabung = putaran === 1 ? bagian : `${gabung}\n${bagian}`.trim();

    if (jawaban.selesai === "STOP") {
      const nomor = nomorPenanda(gabung);
      return { markdown: gabung, halaman: nomor.length ? Math.max(...nomor) : 0, halamanPdf, putaran, token, versiModel };
    }
    if (jawaban.selesai !== "MAX_TOKENS") {
      throw new GalatGemini("diblokir", `Gemini berhenti membaca dengan alasan ${jawaban.selesai}`);
    }

    // Terpotong: halaman terakhir belum utuh. Buang, lalu lanjutkan dari halaman itu.
    const akhir = Math.max(0, ...nomorPenanda(bagian));
    if (akhir <= mulaiDari) {
      throw new GalatGemini("keluaran", `Pembacaan terpotong pada halaman ${mulaiDari} dan tak bisa dilanjutkan`);
    }
    gabung = potongSebelumPenanda(gabung, akhir);
    mulaiDari = akhir;
  }
  throw new GalatGemini("keluaran", `PDF terlalu panjang: belum selesai terbaca setelah ${MAKS_PUTARAN} putaran (sampai halaman ${mulaiDari})`);
}

/**
 * Penanda halaman relatif sebuah potongan (1..jumlah, menurut urutan kemunculan) menjadi nomor halaman PDF asli (`mulai`...). Yang
 * dihitung urutannya, bukan angka yang dicetak model: model kadang memakai nomor asli alih-alih relatif. null bila banyaknya penanda
 * tak sama dengan `jumlah` (halaman terlewat atau tertambah). Potongan satu halaman tak pernah gagal: penandanya dipasang sendiri.
 */
export function nomoriBagian(markdown: string, mulai: number, jumlah: number): string | null {
  if (jumlah === 1) return `### Page ${mulai}\n${markdown.replace(RE_PENANDA_MD, "").trim()}`;
  if (nomorPenanda(markdown).length !== jumlah) return null;
  let urutan = 0;
  return markdown.replace(RE_PENANDA_MD, () => `### Page ${mulai + urutan++}`);
}

/** Jalankan `jumlah` tugas dengan paling banyak `paralel` sekaligus; berhenti mengambil tugas baru sesudah galat pertama. Galat tetap didahulukan atas yang sementara. */
async function jalankanBerbatas<T>(jumlah: number, paralel: number, kerja: (i: number) => Promise<T>): Promise<T[]> {
  const hasil = new Array<T>(jumlah);
  const galat: unknown[] = [];
  let berikut = 0;
  const pekerja = Array.from({ length: Math.min(paralel, jumlah) }, async () => {
    while (!galat.length) {
      const i = berikut++;
      if (i >= jumlah) return;
      try {
        hasil[i] = await kerja(i);
      } catch (e) {
        galat.push(e);
      }
    }
  });
  await Promise.all(pekerja);
  if (galat.length) throw galat.find((e) => !(e instanceof GalatGemini) || !e.sementara) ?? galat[0];
  return hasil;
}

/**
 * PDF panjang dibaca per potongan `halamanPerPanggilan` halaman, `paralel` sekaligus. Satu potongan yang lewat batas waktu, terpotong
 * batas panjang jawaban, atau penandanya tak cocok dipecah dua dan dibaca lagi, sampai satu halaman. Potongan yang sudah dibaca
 * disimpan lewat `simpanBagian` dan dimuat kembali lewat `muatBagian`, supaya pembacaan yang terputus (kuota, tenggat giliran)
 * dilanjutkan tanpa membayar ulang. Sesudah `tenggat` tak ada panggilan baru: galat sementara "tertunda".
 */
async function bacaBerbagian(k: KonfigGemini, bytes: Uint8Array, pemecah: PemecahPdf, opsi: OpsiBaca): Promise<HasilBacaPdf> {
  const total = pemecah.halaman;
  const ukuran = Math.max(1, opsi.halamanPerPanggilan ?? k.halamanPerPanggilan);
  const paralel = Math.max(1, opsi.paralel ?? k.paralel);
  const rentang: Array<[number, number]> = [];
  for (let m = 1; m <= total; m += ukuran) rentang.push([m, Math.min(m + ukuran - 1, total)]);

  let token = tokenKosong();
  let versiModel = k.model;
  let panggilan = 0;
  let selesai = 0;

  const baca = async (mulai: number, akhir: number): Promise<string> => {
    const tersimpan = await opsi.muatBagian?.(mulai, akhir).catch(() => null);
    if (tersimpan) return tersimpan;

    const jumlah = akhir - mulai + 1;
    const pecah = async () => {
      const tengah = mulai + Math.floor((jumlah - 1) / 2);
      const kiri = await baca(mulai, tengah);
      const kanan = await baca(tengah + 1, akhir);
      const gabung = `${kiri}\n\n\n\n${kanan}`;
      await opsi.simpanBagian?.(mulai, akhir, gabung).catch(() => {});
      return gabung;
    };

    if (opsi.tenggat !== undefined && Date.now() > opsi.tenggat) {
      throw new GalatGemini("tertunda", `Tenggat giliran habis di tengah pembacaan (${selesai} dari ${rentang.length} potongan awal selesai); dilanjutkan oleh percobaan berikutnya`, { jedaDetik: 30 });
    }
    if (opsi.maksToken !== undefined && token.total >= opsi.maksToken) {
      throw new GalatGemini("anggaran", `Pembacaan melampaui sisa anggaran token harian (${token.total} token terpakai)`);
    }

    let jawaban: HasilPanggilan;
    try {
      const potongan = jumlah === total ? bytes : await pemecah.ambil(mulai, akhir);
      jawaban = await panggilGemini(k, badanTranskripsi(k, keBase64(potongan), perintahBagian(mulai, akhir, total)), {
        ...opsi,
        batasWaktuMs: opsi.batasWaktuMs ?? BATAS_WAKTU_BAGIAN_MS,
      });
    } catch (e) {
      if (jumlah > 1 && e instanceof GalatGemini && e.habisWaktu) return pecah();
      throw e;
    }
    token = tambahToken(token, jawaban.token);
    versiModel = jawaban.versiModel;
    panggilan++;
    opsi.pakai?.(jawaban.token);
    // Tak ada galat anggaran di sini: yang sudah dibaca tak dibuang karena tokennya melampaui sisa. Anggaran dijaga sebelum
    // tiap panggilan baru (di atas), jadi kelebihannya paling banyak sebesar panggilan yang sudah berjalan bersamaan.

    if (jawaban.selesai === "MAX_TOKENS") {
      if (jumlah > 1) return pecah();
      throw new GalatGemini("keluaran", `Halaman ${mulai} terlalu padat: jawaban terpotong batas panjang`);
    }
    if (jawaban.selesai !== "STOP") {
      throw new GalatGemini("diblokir", `Gemini berhenti membaca halaman ${mulai}-${akhir} dengan alasan ${jawaban.selesai}`);
    }
    const hasil = nomoriBagian(keMarkdownHalaman(jawaban.teks), mulai, jumlah);
    if (hasil === null) return pecah();
    await opsi.simpanBagian?.(mulai, akhir, hasil).catch(() => {});
    selesai++;
    return hasil;
  };

  const bagian = await jalankanBerbatas(rentang.length, paralel, (i) => baca(rentang[i][0], rentang[i][1]));
  const markdown = bagian.join("\n\n\n\n").trim();
  const nomor = nomorPenanda(markdown);
  return { markdown, halaman: nomor.length ? Math.max(...nomor) : 0, halamanPdf: total, putaran: panggilan, token, versiModel };
}

// ---------------------------------------------------------------------------
// Pemeriksaan hasil
// ---------------------------------------------------------------------------

/** Teks yang dibaca model ragu-ragu: kata kunci [tidak terbaca] yang diminta dalam perintah. */
const RE_TAK_TERBACA = /\[tidak terbaca\]/gi;

/**
 * Masalah pada hasil transkripsi; kosong bila lolos. Menjaga tiga hal yang tak terlihat dari kualitas pasal saja: halaman yang
 * hilang (model berhenti lebih awal dengan sopan), pengulangan (model terjebak), dan tebakan (terlalu banyak bagian tak terbaca).
 */
export function periksaTranskripsi(markdown: string, halamanPdf: number | null): string[] {
  const masalah: string[] = [];
  const nomor = nomorPenanda(markdown);

  if (!nomor.length) {
    masalah.push("tanpa penanda halaman");
  } else {
    const urut = nomor.every((n, i) => n === i + 1);
    if (!urut) masalah.push(`penanda halaman tak berurutan dari 1 (${nomor.slice(0, 8).join(", ")}${nomor.length > 8 ? ", ..." : ""})`);
    if (halamanPdf !== null && nomor.length < halamanPdf && halamanPdf - nomor.length >= 2 && nomor.length < halamanPdf * 0.9) {
      masalah.push(`hanya ${nomor.length} dari ${halamanPdf} halaman PDF yang terbaca`);
    }
  }

  const isi = markdown.replace(RE_PENANDA_MD, "").trim();
  if (isi.length < 150) masalah.push(`teks terlalu sedikit (${isi.length} karakter)`);

  const tak = isi.match(RE_TAK_TERBACA)?.length ?? 0;
  const kata = isi.split(/\s+/).filter(Boolean).length;
  if (tak >= 5 && tak > kata * 0.015) masalah.push(`terlalu banyak bagian tak terbaca (${tak} dalam ${kata} kata)`);

  // Model yang terjebak mengulang baris yang sama berpuluh kali.
  const baris = isi.split("\n").map((b) => b.trim());
  let beruntun = 1;
  for (let i = 1; i < baris.length; i++) {
    beruntun = baris[i].length >= 30 && baris[i] === baris[i - 1] ? beruntun + 1 : 1;
    if (beruntun >= 4) {
      masalah.push(`baris yang sama diulang ${beruntun} kali berturut-turut ("${baris[i].slice(0, 40)}")`);
      break;
    }
  }
  return masalah;
}
