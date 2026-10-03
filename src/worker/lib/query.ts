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

/** Kata yang tidak menambah makna pencarian dan hanya memperbesar recall palsu. */
const STOPWORDS = new Set([
  "yang", "dan", "atau", "di", "ke", "dari", "untuk", "pada", "dengan", "dalam",
  "adalah", "ini", "itu", "sebagai", "oleh", "tentang", "akan", "telah", "dapat",
  "tidak", "juga", "serta", "bagi", "atas", "para", "agar", "bila", "jika",
  "yaitu", "yakni", "ialah", "maka", "namun", "tetapi", "karena", "sehingga",
]);

/**
 * Istilah hukum yang sering ditulis berbeda oleh pengguna awam vs teks resmi.
 * Ini menutup jurang kosakata yang tidak bisa diselesaikan stemming.
 *
 * Contoh yang memotivasi: kueri "cuti melahirkan" semula nihil hasil, padahal
 * UU 13/2003 Pasal 82 mengaturnya — undang-undang memakai kata "istirahat",
 * bukan "cuti". Tidak ada algoritma pelucut imbuhan yang bisa menjembatani itu.
 */
const SINONIM: Record<string, string[]> = {
  phk: ["pemutusan hubungan kerja", "pemutusan"],
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
  ite: ["informasi dan transaksi elektronik"],
  ciptaker: ["cipta kerja"],
  ojk: ["otoritas jasa keuangan"],
  bpjs: ["badan penyelenggara jaminan sosial"],
  umkm: ["usaha mikro kecil dan menengah"],
  pt: ["perseroan terbatas"],
  koperasi: ["perkoperasian"],
};

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
  /** Ekspresi siap dikirim ke `MATCH`. */
  fts: string;
  /** Frasa dalam tanda kutip yang diminta pengguna secara eksplisit. */
  frasa: string[];
  /** Semua term yang akhirnya dicari — ditampilkan ke pengguna. */
  terms: string[];
  /** Sitasi yang terdeteksi, mis. {jenis:"UU", nomor:"13", tahun:2003}. */
  sitasi: { jenis: string; nomor: string; tahun: number } | null;
}

const POLA_SITASI =
  /\b(uu|undang-undang|perppu|pp|perpres|keppres|inpres|permen|kepmen|perda|pergub|perbup|perwali|pojk|pbi)\s*(?:no\.?|nomor)?\s*(\d+[a-z]?)\s*(?:\/|\s+tahun\s+|\s+th\.?\s+|\s+)(\d{4})\b/i;

const ALIAS_JENIS: Record<string, string> = {
  "undang-undang": "UU",
  uu: "UU",
  perppu: "PERPPU",
  pp: "PP",
  perpres: "PERPRES",
  keppres: "KEPPRES",
  inpres: "INPRES",
  permen: "PERMEN",
  kepmen: "KEPMEN",
  perda: "PERDA_PROV",
  pergub: "PERGUB",
  perbup: "PERBUP",
  perwali: "PERWALI",
  pojk: "POJK",
  pbi: "PBI",
};

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
  const sitasiMatch = raw.match(POLA_SITASI);
  const sitasi = sitasiMatch
    ? {
        jenis: ALIAS_JENIS[sitasiMatch[1].toLowerCase()] ?? sitasiMatch[1].toUpperCase(),
        nomor: sitasiMatch[2],
        tahun: Number(sitasiMatch[3]),
      }
    : null;

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
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));

  const kelompok: string[] = [];
  const semuaTerm = new Set<string>();

  for (const f of frasa) {
    kelompok.push(`"${f}"`);
    semuaTerm.add(f);
  }

  for (const token of tokens) {
    const varian = new Set<string>();

    for (const dasar of kataDasar(token)) {
      // Prefix-match menangkap turunan ke depan ("kerja" -> "kerjakan").
      varian.add(dasar.length >= 4 ? `${dasar}*` : dasar);
      semuaTerm.add(dasar);
    }
    // Token asli selalu ikut, dengan bobot alami lebih tinggi karena persis.
    varian.add(token);

    for (const sin of SINONIM[token] ?? []) {
      varian.add(`"${sin}"`);
      semuaTerm.add(sin);
    }

    kelompok.push(`(${[...varian].join(" OR ")})`);
  }

  return {
    fts: kelompok.join(" AND "),
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
