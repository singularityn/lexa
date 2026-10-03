/**
 * Normalisasi kueri bahasa Indonesia untuk FTS5.
 *
 * Alasan modul ini ada: FTS5 mencocokkan token secara harfiah, sedangkan bahasa
 * Indonesia sangat aglutinatif. Uji langsung di D1 menunjukkan `kerja*` TIDAK
 * menemukan "pekerja" — karena prefix-match hanya melihat awal token. Tanpa
 * pelucutan imbuhan, sisi keyword dari hybrid search kehilangan banyak dokumen
 * yang jelas relevan.
 *
 * Implementasi memakai versi ringkas algoritma Nazief-Adriani: lucuti infleksi
 * (partikel, posesif) lalu derivasi (awalan, akhiran), dengan aturan peluluhan
 * konsonan yang paling umum.
 */

import { type Sitasi, uraiSitasi } from "./sitasi";

/** Kata yang tidak menambah makna pencarian dan hanya memperbesar recall palsu. */
const STOPWORDS = new Set([
  "yang", "dan", "atau", "di", "ke", "dari", "untuk", "pada", "dengan", "dalam",
  "adalah", "ini", "itu", "sebagai", "oleh", "tentang", "akan", "telah", "dapat",
  "tidak", "juga", "serta", "bagi", "atas", "para", "agar", "bila", "jika",
  "yaitu", "yakni", "ialah", "maka", "namun", "tetapi", "karena", "sehingga",
  // Kata tanya dan kata ganti orang: pertanyaan sehari-hari ("berapa lama cuti melahirkan bagi pekerja
  // perempuan?") penuh dengan kata ini, dan tidak satu pun muncul sebagai istilah di batang tubuh pasal.
  // Menyertakannya membuat kueri AND tidak pernah menemukan apa-apa.
  "apa", "apakah", "berapa", "bagaimana", "siapa", "siapakah", "kapan", "mengapa", "kenapa",
  "dimana", "mana", "adakah", "saya", "kami", "kita", "anda", "kamu", "aku", "ingin", "mau",
  "tolong", "mohon",
]);

/**
 * Singkatan dan ejaan lain dari kata yang SAMA. Perluasannya ikut dianggap "kata yang diketik"
 * (lihat `ftsLiteral`): pengguna yang mengetik "PHK" menginginkan pasal-pasal tentang pemutusan
 * hubungan kerja, bukan hanya pasal yang kebetulan menyebut singkatan "PHK"; dan "perlindungan"
 * harus menemukan UU "Pelindungan Data Pribadi" (ejaan resmi terbaru memakai "pelindungan").
 */
const VARIAN_KATA: Record<string, string[]> = {
  phk: ["pemutusan hubungan kerja", "pemutusan"],
  ite: ["informasi dan transaksi elektronik"],
  ciptaker: ["cipta kerja"],
  ojk: ["otoritas jasa keuangan"],
  bpjs: ["badan penyelenggara jaminan sosial"],
  umkm: ["usaha mikro kecil dan menengah"],
  pt: ["perseroan terbatas"],
  perlindungan: ["pelindungan"],
  pelindungan: ["perlindungan"],
  izin: ["ijin"],
  ijin: ["izin"],
  asas: ["azas"],
  azas: ["asas"],
  risiko: ["resiko"],
  resiko: ["risiko"],
  analisis: ["analisa"],
  analisa: ["analisis"],
};

/**
 * Istilah hukum yang sering ditulis berbeda oleh pengguna awam vs teks resmi.
 * Ini menutup jurang kosakata yang tidak bisa diselesaikan stemming.
 *
 * Contoh yang memotivasi: kueri "cuti melahirkan" semula nihil hasil, padahal
 * UU 13/2003 Pasal 82 mengaturnya — undang-undang memakai kata "istirahat",
 * bukan "cuti". Tidak ada algoritma pelucut imbuhan yang bisa menjembatani itu.
 *
 * Berbeda dari `VARIAN_KATA`, ini kata LAIN yang bermakna dekat. Dokumen yang memuat sinonimnya
 * saja tidak boleh mengalahkan dokumen yang memuat kata yang diketik (contoh nyata: "pesangon"
 * menempatkan Perpres tentang "uang kompensasi" anggota KPU di atas UU Ketenagakerjaan).
 */
const SINONIM: Record<string, string[]> = {
  pesangon: ["uang pesangon", "kompensasi"],
  buruh: ["pekerja", "karyawan", "tenaga kerja"],
  pekerja: ["buruh", "karyawan", "tenaga kerja"],
  karyawan: ["pekerja", "buruh"],
  upah: ["gaji", "pengupahan"],
  gaji: ["upah", "pengupahan"],
  cuti: ["istirahat", "libur"],
  melahirkan: ["persalinan", "kelahiran"],
  hamil: ["kehamilan", "mengandung"],
  lembur: ["waktu kerja lembur", "kerja lembur"],
  kontrak: ["perjanjian kerja waktu tertentu", "pkwt", "perjanjian kerja"],
  outsourcing: ["alih daya", "penyediaan jasa pekerja"],
  pensiun: ["jaminan hari tua", "jaminan pensiun"],
  magang: ["pemagangan", "pelatihan kerja"],
  mogok: ["mogok kerja"],
  serikat: ["serikat pekerja", "serikat buruh"],
  pajak: ["perpajakan", "pungutan"],
  korupsi: ["tindak pidana korupsi", "tipikor"],
  narkoba: ["narkotika", "psikotropika"],
  nikah: ["perkawinan", "pernikahan"],
  cerai: ["perceraian", "putusnya perkawinan"],
  warisan: ["pewarisan", "waris"],
  tanah: ["pertanahan", "agraria"],
  lingkungan: ["lingkungan hidup"],
  koperasi: ["perkoperasian"],
};

/** Jumlah kelompok kata terdepan yang dipakai membentuk pasangan pada pencarian longgar. */
const MAKS_KATA_LONGGAR = 6;

const PARTIKEL = /(?:-?(?:lah|kah|tah|pun))$/;
const POSESIF = /(?:-?(?:ku|mu|nya))$/;
const AKHIRAN = /(?:kan|an|i)$/;

/** Awalan sederhana yang bisa langsung dipotong tanpa peluluhan. */
const AWALAN_SEDERHANA = /^(?:di|ke|se|ter|ber|per)/;

/**
 * Awalan dengan peluluhan konsonan: pola -> [pengganti awal kata].
 * Contoh: "menulis" -> men + (t)ulis; "pengusaha" -> peng + (k?)usaha/usaha.
 */
const PELULUHAN: Array<[RegExp, string[]]> = [
  [/^meng([aiueo])/, ["k$1", "$1"]],
  [/^peng([aiueo])/, ["k$1", "$1"]],
  [/^meny([aiueo])/, ["s$1"]],
  [/^peny([aiueo])/, ["s$1"]],
  [/^men([aiueo])/, ["t$1", "$1"]],
  [/^pen([aiueo])/, ["t$1", "$1"]],
  [/^mem([aiueo])/, ["p$1", "$1"]],
  [/^pem([aiueo])/, ["p$1", "$1"]],
  [/^meng/, [""]],
  [/^peng/, [""]],
  [/^meny/, [""]],
  [/^peny/, [""]],
  [/^men/, [""]],
  [/^pen/, [""]],
  [/^mem/, [""]],
  [/^pem/, [""]],
  [/^me/, [""]],
  [/^pe/, [""]],
];

/**
 * Kembalikan kemungkinan kata dasar dari sebuah kata.
 * Sengaja mengembalikan beberapa kandidat, bukan satu: FTS5 murah untuk OR,
 * dan salah tebak stem lebih mahal daripada satu term ekstra.
 */
export function kataDasar(kata: string): string[] {
  const asli = kata.toLowerCase();
  const kandidat = new Set<string>([asli]);

  // Pelucutan infleksi tanpa kamus kata dasar bisa salah: "berlaku" berakhiran
  // "ku" yang menyerupai posesif, dan memangkasnya jadi "berla" menghalangi
  // awalan "ber-" ikut terlucuti. Karena itu awalan dicari dari kata asli DAN
  // dari bentuk terlucuti, bukan hanya dari hasil pelucutan.
  const basis = new Set<string>([asli]);

  const tanpaInfleksi = asli.replace(PARTIKEL, "").replace(POSESIF, "");
  if (tanpaInfleksi.length >= 4) basis.add(tanpaInfleksi);

  // Lucuti akhiran derivasi dari tiap basis yang sudah ada.
  for (const b of [...basis]) {
    kandidat.add(b);
    const tanpaAkhiran = b.replace(AKHIRAN, "");
    if (tanpaAkhiran.length >= 4) {
      kandidat.add(tanpaAkhiran);
      basis.add(tanpaAkhiran);
    }
  }

  // Lucuti awalan — dengan peluluhan konsonan bila ada.
  for (const b of basis) {
    for (const [pola, gantiList] of PELULUHAN) {
      if (!pola.test(b)) continue;
      for (const ganti of gantiList) {
        const hasil = b.replace(pola, ganti);
        if (hasil.length >= 3) kandidat.add(hasil);
      }
      break; // hanya satu lapis awalan per basis
    }
    if (AWALAN_SEDERHANA.test(b)) {
      const hasil = b.replace(AWALAN_SEDERHANA, "");
      if (hasil.length >= 3) kandidat.add(hasil);
    }
  }

  return [...kandidat];
}

/** Hilangkan karakter yang punya arti khusus di sintaks FTS5. */
function bersihkanToken(token: string): string {
  return token.replace(/["'^*():{}[\]]/g, "").trim();
}

export interface KueriTerurai {
  /** Ekspresi siap dikirim ke `MATCH`: semua kelompok kata harus ada (AND), dengan sinonim. */
  fts: string;
  /**
   * Sama dengan `fts` tetapi TANPA sinonim: hanya kata yang diketik pengguna (dan kata dasarnya).
   * Dipakai untuk memberi peringkat lebih tinggi pada dokumen yang memuat kata itu sendiri; tanpa ini
   * "pesangon" menempatkan Perpres tentang "uang kompensasi" anggota KPU di atas UU Ketenagakerjaan,
   * karena kata "kompensasi" (sinonim) muncul dua kali di judulnya. Sama dengan `fts` bila kueri
   * tidak punya sinonim.
   */
  ftsLiteral: string;
  /**
   * Cadangan untuk kueri berbentuk kalimat (tiga kata atau lebih): cukup DUA dari kelompok kata yang
   * muncul bersama, alih-alih semuanya; frasa berkutip tetap wajib. Kosong untuk kueri yang lebih
   * pendek: melonggarkan "kapal selam" menjadi salah satu kata hanya mendatangkan sampah (awalan "selam"
   * cocok dengan "selama"). Hanya dijalankan bila `fts` hampir tidak menemukan apa pun.
   */
  ftsLonggar: string;
  /** Frasa dalam tanda kutip yang diminta pengguna secara eksplisit. */
  frasa: string[];
  /** Semua term yang akhirnya dicari — ditampilkan ke pengguna. */
  terms: string[];
  /** Sitasi yang terdeteksi, mis. {jenis:"UU", nomor:"13", tahun:2003}. */
  sitasi: Sitasi | null;
}

/**
 * Ubah kueri bebas dari pengguna menjadi ekspresi FTS5.
 *
 * Aturan yang dipakai:
 * - `"frasa dikutip"` dipertahankan utuh sebagai phrase match.
 * - Token biasa diperluas menjadi OR dari kandidat kata dasar + prefix match.
 * - Sinonim istilah hukum ikut ditambahkan sebagai frasa.
 * - Antar-kelompok token digabung `AND` supaya presisi tetap terjaga.
 */
export function uraiKueri(raw: string): KueriTerurai {
  const sitasi = uraiSitasi(raw);

  // Tarik keluar frasa berkutip lebih dulu supaya tidak ikut dipecah.
  const frasa: string[] = [];
  const sisa = raw.replace(/"([^"]+)"/g, (_, isi: string) => {
    const bersih = bersihkanToken(isi);
    if (bersih) frasa.push(bersih);
    return " ";
  });

  const tokens = sisa
    .toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .map(bersihkanToken)
    // Tanda hubung di tepi kata ("-pesangon", "pesangon-") bukan bagian kata.
    .map((t) => t.replace(/^-+|-+$/g, ""))
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));

  const kelompokFrasa: string[] = [];
  /** Kelompok kata dengan sinonim, dan tanpa sinonim; sejajar satu sama lain. */
  const kelompokKata: string[] = [];
  const kelompokLiteral: string[] = [];
  const semuaTerm = new Set<string>();
  let adaSinonim = false;

  for (const f of frasa) {
    kelompokFrasa.push(`"${f}"`);
    semuaTerm.add(f);
  }

  for (const token of tokens) {
    const varian = new Set<string>();

    // Setiap term DIKUTIP. Tanpa kutip, "perundang-undangan" dibaca FTS5 sebagai
    // "perundang" dikurangi "undangan" (filter kolom) dan seluruh kueri gagal dengan
    // "no such column". Tokenizer tabel memakai tokenchars '-', jadi bentuk berkutip
    // dipecah persis seperti teks yang diindeks. `*` (prefix) ditaruh di luar kutip.
    for (const dasar of kataDasar(token)) {
      // Prefix-match menangkap turunan ke depan ("kerja" -> "kerjakan").
      varian.add(dasar.length >= 4 ? `"${dasar}"*` : `"${dasar}"`);
      semuaTerm.add(dasar);
    }
    // Token asli selalu ikut, dengan bobot alami lebih tinggi karena persis.
    varian.add(`"${token}"`);
    // Singkatan dan ejaan lain dari kata yang sama dihitung sebagai kata yang diketik.
    for (const v of VARIAN_KATA[token] ?? []) {
      varian.add(`"${v}"`);
      semuaTerm.add(v);
    }
    kelompokLiteral.push(`(${[...varian].join(" OR ")})`);

    for (const sin of SINONIM[token] ?? []) {
      varian.add(`"${sin}"`);
      semuaTerm.add(sin);
      adaSinonim = true;
    }
    kelompokKata.push(`(${[...varian].join(" OR ")})`);
  }

  const fts = [...kelompokFrasa, ...kelompokKata].join(" AND ");
  const ftsLiteral = adaSinonim ? [...kelompokFrasa, ...kelompokLiteral].join(" AND ") : fts;
  // Cadangan: dua kelompok kata mana pun yang muncul bersama (maksimal enam kelompok pertama agar
  // ekspresinya tidak membengkak: C(6,2) = 15 pasangan).
  const ftsLonggar = (() => {
    const kata = kelompokKata.slice(0, MAKS_KATA_LONGGAR);
    if (kata.length < 3) return "";
    const pasangan: string[] = [];
    for (let i = 0; i < kata.length; i++) for (let j = i + 1; j < kata.length; j++) pasangan.push(`(${kata[i]} AND ${kata[j]})`);
    return [...kelompokFrasa, `(${pasangan.join(" OR ")})`].join(" AND ");
  })();

  return {
    fts,
    ftsLiteral,
    ftsLonggar,
    frasa,
    terms: [...semuaTerm],
    sitasi,
  };
}

/**
 * Versi kueri untuk embedding: buang sintaks, sisakan bahasa alami.
 * Model bge-m3 bekerja pada kalimat, bukan operator boolean.
 */
export function kueriUntukEmbedding(raw: string): string {
  return raw.replace(/["*()]/g, " ").replace(/\s+/g, " ").trim();
}
