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

export const MODEL_BAWAAN = "gemini-flash-latest";
export const BASE_URL_BAWAAN = "https://generativelanguage.googleapis.com/v1beta";
/** Token (masuk + keluar) per hari UTC yang boleh dipakai semua pembacaan sekaligus. Bisa diubah lewat GEMINI_BATAS_HARIAN. */
export const ANGGARAN_HARIAN_BAWAAN = 5_000_000;
/** PDF dikirim sebaris: base64 menambah sepertiga dan satu permintaan dibatasi 20 MB. Yang lebih besar perlu Files API (belum didukung). */
export const MAKS_BYTE_PDF = 14 * 1024 * 1024;
/** Paling banyak berapa kali satu PDF dikirim untuk melanjutkan keluaran yang terpotong batas panjang jawaban. */
export const MAKS_PUTARAN = 6;

const BATAS_WAKTU_BAWAAN_MS = 240_000;
const MAKS_PERCOBAAN = 3;
const JEDA_ULANG_MS = [4_000, 12_000];

export interface KonfigGemini {
  kunci: string;
  model: string;
  baseUrl: string;
  /** Token (masuk + keluar) yang boleh dipakai per hari UTC. */
  anggaranHarian: number;
}

/** Variabel dan secret yang dibaca modul ini (env.d.ts). */
export interface EnvGemini {
  GEMINI_API?: string;
  GEMINI_MODEL?: string;
  GEMINI_BASE_URL?: string;
  GEMINI_BATAS_HARIAN?: string;
}

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
  | "keluaran" //      jawaban tak bisa dilanjutkan atau tak lengkap setelah MAKS_PUTARAN
  | "anggaran" //      anggaran token harian habis
  | "kuota" //         429: laju atau kuota Google habis (sementara)
  | "server" //        5xx dari Google (sementara)
  | "jaringan"; //     Google tak terjangkau atau melewati batas waktu (sementara)

const SEMENTARA: ReadonlySet<JenisGalatGemini> = new Set(["kuota", "server", "jaringan"]);

/**
 * Galat pemanggilan Gemini. Yang `sementara` layak dicoba lagi nanti (konsumer antrean mengulang pesan dengan jeda
 * `jedaDetik`); selebihnya akan gagal sama persis dan dicatat tanpa diulang. Pesan tak pernah memuat kunci.
 */
export class GalatGemini extends Error {
  readonly sementara: boolean;
  constructor(
    readonly jenis: JenisGalatGemini,
    pesan: string,
    readonly rincian: { status?: number; jedaDetik?: number } = {},
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

/**
 * Pemblokiran bawaan Gemini sering salah menyangka naskah hukum (narkotika, pornografi, terorisme, pidana) sebagai konten
 * berbahaya. Yang disalin di sini dokumen resmi negara, jadi semua kategori dilonggarkan.
 */
const KATEGORI_KEAMANAN = ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"];

function badanTranskripsi(pdfBase64: string, perintah: string) {
  return {
    systemInstruction: { parts: [{ text: PETUNJUK_TRANSKRIPSI }] },
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: "application/pdf", data: pdfBase64 } }, { text: perintah }] }],
    safetySettings: KATEGORI_KEAMANAN.map((category) => ({ category, threshold: "BLOCK_NONE" })),
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

/** Satu pemanggilan generateContent, dengan pengulangan untuk gangguan jaringan dan 5xx. Kuota (429) langsung dilaporkan. */
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
      throw new GalatGemini("jaringan", `Gemini tidak terjangkau: ${samarkan(String(e), k.kunci).slice(0, 200)}`, { jedaDetik: 60 });
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
    if (galat.jenis === "server" && percobaan < MAKS_PERCOBAAN) {
      await tidur(JEDA_ULANG_MS[percobaan - 1] ?? 12_000);
      continue;
    }
    throw galat;
  }
}

/** Uji sambungan: kunci, model, dan alamat. Murah (beberapa token) dan tak menyentuh dokumen mana pun. */
export async function pingGemini(k: KonfigGemini, opsi: OpsiPanggilan = {}) {
  const mulai = Date.now();
  const hasil = await panggilGemini(k, { contents: [{ role: "user", parts: [{ text: "Balas hanya dengan satu kata: siap" }] }] }, opsi);
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
}

export interface HasilBacaPdf {
  /** Markdown dengan penanda "### Page n". */
  markdown: string;
  /** Nomor halaman terakhir yang ditandai. */
  halaman: number;
  /** Perkiraan jumlah halaman PDF (lihat perkirakanHalamanPdf); null bila tak terbaca. */
  halamanPdf: number | null;
  putaran: number;
  token: PemakaianToken;
  versiModel: string;
}

/**
 * Baca seluruh PDF dengan Gemini. Keluaran yang terpotong batas panjang jawaban (MAX_TOKENS) dilanjutkan: halaman terakhir
 * yang terpotong dibuang, lalu PDF dikirim lagi dengan perintah mulai dari halaman itu. Lebih dari MAKS_PUTARAN putaran,
 * atau berhenti karena alasan lain (SAFETY, RECITATION), dilaporkan sebagai galat; teks yang sebagian tak dipakai.
 */
export async function bacaPdfDenganGemini(k: KonfigGemini, bytes: Uint8Array, opsi: OpsiBaca = {}): Promise<HasilBacaPdf> {
  if (bytes.byteLength > MAKS_BYTE_PDF) {
    throw new GalatGemini(
      "terlalu_besar",
      `PDF ${(bytes.byteLength / 1048576).toFixed(1)} MB melebihi batas ${MAKS_BYTE_PDF / 1048576} MB untuk dikirim sebaris (Files API belum didukung)`,
    );
  }
  const halamanPdf = perkirakanHalamanPdf(bytes);
  const data = keBase64(bytes);
  let token = tokenKosong();
  let versiModel = k.model;
  let gabung = "";
  let mulaiDari = 1;

  for (let putaran = 1; putaran <= MAKS_PUTARAN; putaran++) {
    const jawaban = await panggilGemini(k, badanTranskripsi(data, putaran === 1 ? PERINTAH_AWAL : perintahLanjut(mulaiDari)), opsi);
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
