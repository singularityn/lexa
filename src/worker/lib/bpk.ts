/**
 * Pemetaan data BPK → skema Lexa, dan pengurai naskah peraturan.
 *
 * Data BPK tidak diambil oleh Worker. Seluruh situs peraturan.bpk.go.id berada
 * di balik Cloudflare managed challenge, jadi pengambilan dilakukan manusia dari
 * sesi peramban miliknya sendiri (lihat scripts/bpk-console-harvest.js) lalu
 * hasilnya dikirim ke sini sebagai manifest. Modul ini murni pengolahan.
 */

import type { Law, JenisRelasi, StatusPeraturan } from "../../shared/types";
import { rapikanNomorPasal } from "../../shared/label";
import { uraiSitasi } from "./sitasi";

/** Satu dokumen di dalam manifest hasil panen. */
export interface DokumenBpk {
  bpk_id: string;
  slug?: string;
  detail_url?: string;
  pdf_url?: string;
  pdf_nama?: string;
  /** Seluruh pasangan label→nilai dari tabel metadata, apa adanya. */
  meta: Record<string, string>;
  relasi?: Array<{ label: string; bpk_id: string | null; teks: string }>;
  abstrak?: string[];
}

export interface Manifest {
  versi: number;
  dibuat?: string;
  sumber?: string;
  dokumen: DokumenBpk[];
}

/** "Bentuk Singkat" di BPK → kode jenis internal Lexa. */
const PETA_BENTUK: Record<string, string> = {
  UUD: "UUD",
  "TAP MPR": "TAP_MPR",
  UU: "UU",
  "UU DRT": "UU",
  PERPPU: "PERPPU",
  PERPU: "PERPPU",
  PP: "PP",
  "PERPRES": "PERPRES",
  "PERPRES RI": "PERPRES",
  KEPPRES: "KEPPRES",
  INPRES: "INPRES",
  PERMEN: "PERMEN",
  KEPMEN: "KEPMEN",
  PERMENKEU: "PERMEN",
  POJK: "POJK",
  PBI: "PBI",
  PERDA: "PERDA_PROV",
  "PERDA PROV": "PERDA_PROV",
  "PERDA KAB": "PERDA_KAB",
  "PERDA KOTA": "PERDA_KAB",
  PERGUB: "PERGUB",
  PERBUP: "PERBUP",
  PERWALI: "PERWALI",
};

/** Segmen jenis di dalam FRBR URI, disamakan dengan konvensi pasal.id. */
const SEGMEN_FRBR: Record<string, string> = {
  UUD: "uud",
  TAP_MPR: "tap-mpr",
  UU: "uu",
  PERPPU: "perppu",
  PP: "pp",
  PERPRES: "perpres",
  KEPPRES: "keppres",
  INPRES: "inpres",
  PERMEN: "permen",
  KEPMEN: "kepmen",
  POJK: "pojk",
  PBI: "pbi",
  PERDA_PROV: "perda-prov",
  PERDA_KAB: "perda-kab",
  PERGUB: "pergub",
  PERBUP: "perbup",
  PERWALI: "perwali",
};

/** Ambil nilai metadata tanpa peduli beda huruf besar/kecil dan titik. */
function metaAmbil(meta: Record<string, string>, ...label: string[]): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[.\s:]/g, "");
  const peta = new Map(Object.entries(meta).map(([k, v]) => [norm(k), v]));
  for (const l of label) {
    const v = peta.get(norm(l));
    if (v && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Bangun FRBR URI yang sama bentuknya dengan milik pasal.id, supaya dokumen
 * hasil panen BPK menyatu dengan hasil ingest pasal.id alih-alih menggandakan.
 */
export function frbrDari(jenis: string, nomor: string, tahun: number): string {
  const segmen = SEGMEN_FRBR[jenis] ?? jenis.toLowerCase().replace(/_/g, "-");
  return `/akn/id/act/${segmen}/${tahun}/${nomor}`;
}

/** BPK menulis tanggal sebagai "25 Maret 2003". */
const BULAN: Record<string, string> = {
  januari: "01", februari: "02", maret: "03", april: "04", mei: "05", juni: "06",
  juli: "07", agustus: "08", september: "09", oktober: "10", november: "11", desember: "12",
};

export function tanggalIndonesia(teks: string | null): string | null {
  if (!teks) return null;
  const s = teks.trim();

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const m = s.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m) {
    const bulan = BULAN[m[2].toLowerCase()];
    if (bulan) return `${m[3]}-${bulan}-${m[1].padStart(2, "0")}`;
  }

  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;

  return null;
}

export function statusDari(teks: string | null): StatusPeraturan {
  const s = (teks ?? "").toLowerCase();
  // Urutan penting: "tidak berlaku" mengandung "berlaku", jadi harus dicek dulu.
  if (s.includes("tidak berlaku") || s.includes("dicabut")) return "dicabut";
  if (s.includes("diubah")) return "diubah";
  return "berlaku";
}

/** Label relasi di halaman BPK → enum relasi Lexa. */
export function relasiDari(label: string): JenisRelasi {
  const s = label.toLowerCase();
  if (s.includes("dicabut")) return "dicabut_oleh";
  if (s.includes("mencabut")) return "mencabut";
  if (s.includes("diubah")) return "diubah_oleh";
  if (s.includes("mengubah")) return "mengubah";
  if (s.includes("dasar hukum")) return "dasar_hukum";
  if (s.includes("pelaksana")) return "dilaksanakan_oleh";
  if (s.includes("melaksanakan")) return "melaksanakan";
  return "terkait";
}

/**
 * Petakan satu dokumen manifest menjadi baris `laws`.
 * Mengembalikan null bila metadata intinya tidak cukup untuk membentuk sitasi.
 */
export function petakanDokumen(
  doc: DokumenBpk,
): { law: Law; relasi: Array<{ to_uri: string; jenis_relasi: JenisRelasi; keterangan: string | null }> } | null {
  const meta = doc.meta ?? {};

  const judul = metaAmbil(meta, "Judul", "Tentang");
  if (!judul) return null;

  const bentukSingkat = metaAmbil(meta, "Bentuk Singkat", "Bentuk", "Jenis");
  const jenis =
    (bentukSingkat && PETA_BENTUK[bentukSingkat.toUpperCase().trim()]) ??
    tebakJenisDariJudul(judul) ??
    "LAIN";

  const nomor = metaAmbil(meta, "Nomor", "No") ?? tebakNomorDariJudul(judul);
  const tahunTeks = metaAmbil(meta, "Tahun");
  const tahun = Number(tahunTeks) || tebakTahunDariJudul(judul) || 0;

  if (!nomor || !tahun) return null;

  const frbr = frbrDari(jenis, nomor, tahun);

  const law: Law = {
    frbr_uri: frbr,
    jenis,
    nomor,
    tahun,
    judul,
    tentang: metaAmbil(meta, "Subjek", "Tentang"),
    status: statusDari(metaAmbil(meta, "Status")),
    tanggal_penetapan: tanggalIndonesia(metaAmbil(meta, "Tanggal Penetapan", "Tanggal Ditetapkan")),
    tanggal_berlaku: tanggalIndonesia(
      metaAmbil(meta, "Tanggal Berlaku", "Tanggal Pengundangan"),
    ),
    instansi: metaAmbil(meta, "T.E.U.", "TEU", "Tempat Penetapan", "Lokasi"),
    bidang: metaAmbil(meta, "Bidang", "Subjek"),
    bpk_id: doc.bpk_id,
    sumber_url: doc.detail_url ?? null,
    ringkasan: doc.abstrak?.length ? doc.abstrak.join(" ").slice(0, 2000) : null,
    jumlah_pasal: 0,
  };

  const relasi = (doc.relasi ?? [])
    .map((r) => {
      // Relasi hanya bisa dipakai bila peraturan tujuannya bisa diidentifikasi.
      // Coba dari teksnya ("UU No. 13 Tahun 2003"); bila gagal, lewati.
      const target = sitasiDariTeks(r.teks);
      if (!target) return null;
      return {
        to_uri: frbrDari(target.jenis, target.nomor, target.tahun),
        jenis_relasi: relasiDari(r.label),
        keterangan: r.teks.slice(0, 300),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  return { law, relasi };
}

const POLA_SITASI_TEKS =
  /\b(UUD|TAP\s*MPR|UU|PERPPU|PERPU|PP|PERPRES|KEPPRES|INPRES|PERMEN|KEPMEN|POJK|PBI|PERDA|PERGUB|PERBUP|PERWALI|Undang-Undang|Peraturan\s+Pemerintah|Peraturan\s+Presiden|Keputusan\s+Presiden)\b[^\d]{0,30}?(\d+[A-Za-z]?)\s*(?:Tahun|Thn\.?|\/)\s*(\d{4})/i;

const ALIAS_TEKS: Record<string, string> = {
  "undang-undang": "UU",
  "peraturan pemerintah": "PP",
  "peraturan presiden": "PERPRES",
  "keputusan presiden": "KEPPRES",
  perpu: "PERPPU",
  perda: "PERDA_PROV",
  "tap mpr": "TAP_MPR",
};

/**
 * Tarik sitasi terstruktur dari kalimat bebas seperti "UU No. 13 Tahun 2003".
 *
 * Tata bahasa ketat bersama pencarian (sitasi.ts) dicoba lebih dulu; ia membedakan
 * "Peraturan Pemerintah Pengganti Undang-Undang" (PERPPU) dari "Undang-Undang" dan
 * mengenali Peraturan Menteri/OJK/BI. Pola longgar lama menjadi cadangan untuk bentuk
 * yang tak dicakupnya (UUD, TAP MPR, atau kata sisipan sampai 30 karakter).
 */
export function sitasiDariTeks(
  teks: string,
): { jenis: string; nomor: string; tahun: number } | null {
  const tepat = uraiSitasi(teks);
  if (tepat) return { jenis: tepat.jenis, nomor: tepat.nomor, tahun: tepat.tahun };

  const m = teks.match(POLA_SITASI_TEKS);
  if (!m) return null;

  const mentah = m[1].toLowerCase().replace(/\s+/g, " ").trim();
  const jenis = ALIAS_TEKS[mentah] ?? PETA_BENTUK[mentah.toUpperCase()] ?? mentah.toUpperCase();

  return { jenis, nomor: m[2], tahun: Number(m[3]) };
}

function tebakJenisDariJudul(judul: string): string | null {
  const s = sitasiDariTeks(judul);
  return s?.jenis ?? null;
}
function tebakNomorDariJudul(judul: string): string | null {
  return sitasiDariTeks(judul)?.nomor ?? null;
}
function tebakTahunDariJudul(judul: string): number | null {
  return sitasiDariTeks(judul)?.tahun ?? null;
}

// ---------------------------------------------------------------------------
// Pengurai naskah peraturan
// ---------------------------------------------------------------------------

export interface PasalTerurai {
  nomor_pasal: string;
  ayat: string | null;
  bab: string | null;
  bagian: string | null;
  isi: string;
  urutan: number;
}

const RE_BAB = /^#{0,6}\s*\**\s*(BAB\s+[IVXLCDM]+|BAB\s+\d+)\b\s*\**\s*(.*)$/i;
const RE_BAGIAN = /^#{0,6}\s*\**\s*(Bagian\s+[A-Za-z]+)\b\s*\**\s*(.*)$/i;

/**
 * Judul pasal, beserta sisa barisnya.
 *
 * Sebelumnya pola ini menuntut "Pasal N" berdiri sendiri di satu baris. Itu
 * salah: `env.AI.toMarkdown()` kerap menyambung judul dengan isinya tanpa
 * pemisah sama sekali — teks nyata dari UU 10/2010 berbunyi
 * "Pasal 1Dalam Undang-Undang ini, ..." dan "Pasal 2(1) Anggaran pendapatan...".
 * Dokumen itu punya 77 baris berawalan "Pasal N" dan NOL baris yang isinya
 * hanya "Pasal N", sehingga penguraian menghasilkan nol pasal dari 118 ribu
 * karakter teks yang sebenarnya bersih.
 *
 * Akhiran huruf pada nomor pasal ("Pasal 6A") hanya diterima bila TIDAK diikuti
 * huruf kecil. Tanpa syarat itu, "Pasal 1Dalam" terbaca sebagai pasal "1D".
 *
 * Angka romawi ikut diterima. Undang-undang perubahan — seluruh kelas
 * "Perubahan Atas Undang-Undang ..." — menomori pasalnya "Pasal I" dan
 * "Pasal II", bukan angka. UU 5/1995 sama sekali tidak terurai karena pola ini
 * hanya menerima digit. Syarat "tidak diikuti huruf kecil" juga berlaku di
 * sini, supaya "Pasal Ini ..." tidak terbaca sebagai pasal "I".
 */
const RE_PASAL =
  /^#{0,6}\s*\**\s*(?:Pasal|PASAL|pasal)\s+(\d+(?:[A-Z](?![a-z]))?|[IVXLC]+(?![a-z]))\s*\**\s*:?\s*(.*)$/;

/**
 * Sisa baris yang menandakan ini BUKAN judul pasal:
 * - "Pasal 2 ayat (2) terdiri atas:" — sambungan rujukan silang dari baris
 *   sebelumnya yang berakhir "sebagaimana dimaksud dalam".
 * - "Pasal 9; dan/atau" atau "Pasal 48, Pasal 87, ..." — rujukan silang yang
 *   terpotong baris tepat sebelum tanda baca. Judul pasal sungguhan tidak
 *   pernah langsung diikuti titik koma atau koma.
 * - "Pasal 15 . . ." — catchword di kaki halaman, penanda sambung ke halaman
 *   berikutnya.
 */
const RE_RUJUKAN_AYAT = /^(?:ayat\b|[;,])/i;
// `+`, bukan `*`: dengan `*` pola ini juga cocok dengan string kosong, sehingga
// judul pasal klasik "Pasal 1" (yang sisa barisnya memang kosong) ikut terbuang.
const RE_CATCHWORD = /^[.·…]+[.\s·…]*$/;

const RE_AYAT = /^\((\d+[a-z]?)\)\s+/;
/**
 * Awal bagian penjelasan. Penomoran pasal diulang di sana, jadi penguraian
 * harus berhenti — kalau tidak, tiap pasal punya kembaran berisi "Cukup jelas."
 *
 * Pola ini menuntut barisnya benar-benar berupa JUDUL bagian: huruf kapital dan
 * tidak diikuti apa pun selain "ATAS ...". Versi sebelumnya memakai flag `/i`
 * dan hanya mencocokkan awal baris, sehingga kalimat yang kebetulan terpotong
 * baris tepat sebelum kata "penjelasan" ikut menghentikan penguraian. Pada
 * UU 10/2010 hal itu terjadi di baris 769 ("penjelasan ayat ini.") dan
 * membuang 35 dari 39 pasal — tanpa error apa pun.
 */
const RE_PENJELASAN =
  /^#{0,6}\s*\**\s*(?:PENJELASAN|P\s+E\s+N\s+J\s+E\s+L\s+A\s+S\s+A\s+N)\b(?:\s+ATAS\b.*)?\s*\**\s*$/;

/**
 * Penanda berhenti kedua: subjudul "PASAL DEMI PASAL" di dalam penjelasan.
 *
 * Tidak semua dokumen memuat baris "PENJELASAN" yang berdiri sendiri —
 * UU 5/1995 langsung masuk ke "PASAL DEMI PASAL", lalu mengulang "Pasal I"
 * dan "Pasal II" berisi "Cukup jelas". Tanpa penanda ini, tiap pasal
 * mendapat kembaran kosong makna.
 */
const RE_PASAL_DEMI_PASAL = /^#{0,6}\s*\**\s*PASAL\s+DEMI\s+PASAL\s*\**\s*$/i;

/**
 * Pisahkan judul pasal yang menempel di AKHIR baris sebelumnya.
 *
 * `toMarkdown` menyambung teks lintas baris PDF dengan tiga pola berbeda.
 * Dua sudah ditangani pencocok baris ("Pasal 1" sendirian, dan
 * "Pasal 1Dalam ..."). Yang ketiga menempel ke ujung kalimat sebelumnya:
 *
 *     ... kepentingan masyarakat.Pasal 5
 *     ... mendapat persetujuan Bapepam.Pasal 12
 *     PRESIDEN REPUBLIK INDONESIA- 17 -Pasal 20
 *
 * Pada UU 8/1995 pola ini menyembunyikan 31 dari 115 pasal. Penandanya khas dan
 * aman dipakai: TIDAK ADA spasi antara tanda baca penutup dan kata "Pasal".
 * Prosa normal selalu menulis ". Pasal 5" atau "dalam Pasal 5" dengan spasi,
 * sehingga rujukan silang tidak ikut terpecah.
 */
function pisahkanJudulMenempel(naskah: string): string {
  return naskah
    // Menempel pada tanda baca penutup kalimat.
    .replace(/([.;:)"])(Pasal\s+(?:\d|[IVXLC]))/g, "$1\n$2")
    // Menempel pada artefak nomor halaman, mis. "- 17 -Pasal 20".
    .replace(/(-\s*\d+\s*-)\s*(Pasal\s+(?:\d|[IVXLC]))/g, "$1\n$2");
}

/** Buang artefak konversi PDF yang mengotori teks. */
function bersihkanBaris(baris: string): string {
  return baris
    .replace(/\r/g, "")
    .replace(/^\s*[-*]{3,}\s*$/, "")      // garis horizontal markdown
    .replace(/^\s*\|?\s*-\s*\d+\s*-\s*\|?\s*$/, "") // nomor halaman "- 12 -"
    .replace(/ /g, " ")
    .trimEnd();
}

/**
 * Urai naskah (markdown hasil `env.AI.toMarkdown()` atau teks polos) menjadi
 * daftar pasal/ayat.
 */
export function uraikanPasal(naskah: string): PasalTerurai[] {
  const baris = pisahkanJudulMenempel(naskah).split("\n").map(bersihkanBaris);

  const hasil: PasalTerurai[] = [];
  let bab: string | null = null;
  let bagian: string | null = null;
  let nomorPasal: string | null = null;
  let buffer: string[] = [];

  function tutupPasal() {
    if (!nomorPasal) return;
    const teks = buffer.join("\n").trim();
    buffer = [];
    if (!teks) {
      nomorPasal = null;
      return;
    }

    for (const bagianPasal of pecahAyat(teks)) {
      hasil.push({
        nomor_pasal: nomorPasal,
        ayat: bagianPasal.ayat,
        bab,
        bagian,
        isi: bagianPasal.isi,
        urutan: hasil.length,
      });
    }
    nomorPasal = null;
  }

  for (const b of baris) {
    if (RE_PENJELASAN.test(b) || RE_PASAL_DEMI_PASAL.test(b)) {
      tutupPasal();
      break;
    }

    const mBab = b.match(RE_BAB);
    if (mBab) {
      tutupPasal();
      bab = [mBab[1], mBab[2].replace(/\**/g, "").trim()].filter(Boolean).join(" ").trim();
      bagian = null;
      continue;
    }

    const mBagian = b.match(RE_BAGIAN);
    if (mBagian) {
      tutupPasal();
      bagian = [mBagian[1], mBagian[2].replace(/\**/g, "").trim()].filter(Boolean).join(" ").trim();
      continue;
    }

    const mPasal = b.match(RE_PASAL);
    if (mPasal) {
      const sisa = mPasal[2].trim();

      // Catchword kaki halaman: buang seluruh barisnya, ia bukan isi apa pun.
      if (RE_CATCHWORD.test(sisa)) continue;

      // Sambungan rujukan silang: bukan judul, tetapi kalimatnya nyata —
      // jadi tetap dimasukkan sebagai isi pasal yang sedang berjalan.
      if (RE_RUJUKAN_AYAT.test(sisa)) {
        if (nomorPasal) buffer.push(b);
        continue;
      }

      tutupPasal();
      // Angka nol yang terbaca huruf O oleh OCR ("Pasal 1O" untuk 10) dibereskan sejak ingest.
      nomorPasal = rapikanNomorPasal(mPasal[1].toUpperCase());
      // Isi yang menempel pada baris judul menjadi awal badan pasal.
      if (sisa) buffer.push(sisa);
      continue;
    }

    if (nomorPasal) buffer.push(b);
  }
  tutupPasal();

  return hasil;
}

/**
 * Pecah badan pasal menjadi ayat-ayat bernomor "(1)", "(2)", …
 *
 * Tidak setiap "(N)" di awal baris adalah ayat baru. Rujukan silang yang
 * terpotong baris menghasilkan bentuk yang sama persis:
 *
 *     ... sebagaimana dimaksud pada ayat
 *     (1) huruf a direncanakan sebesar Rp850.255.476.000.000,00
 *
 * Dua penjaga dipakai: nomor ayat harus menaik — penomoran ayat selalu
 * berurutan, jadi "(1)" sesudah "(2)" pasti rujukan — dan baris sebelumnya
 * tidak boleh berakhir dengan kata "ayat".
 */
function pecahAyat(teks: string): Array<{ ayat: string | null; isi: string }> {
  const baris = teks.split("\n");
  const bagian: Array<{ ayat: string | null; isi: string[] }> = [];
  let kini: { ayat: string | null; isi: string[] } | null = null;
  let terakhir = 0;
  let sebelumnya = "";

  for (const b of baris) {
    const m = b.match(RE_AYAT);
    const nomor = m ? parseInt(m[1], 10) : 0;
    const lanjutanRujukan = /\bayat\s*$/i.test(sebelumnya);
    const ayatBaru = m && !lanjutanRujukan && (!Number.isFinite(nomor) || nomor > terakhir);

    if (ayatBaru && m) {
      if (kini) bagian.push(kini);
      kini = { ayat: m[1], isi: [b.replace(RE_AYAT, "")] };
      terakhir = Number.isFinite(nomor) ? nomor : terakhir;
    } else if (kini) {
      kini.isi.push(b);
    } else {
      // Teks sebelum ayat pertama — pasal tanpa ayat, atau kalimat pembuka.
      kini = { ayat: null, isi: [b] };
    }
    sebelumnya = b;
  }
  if (kini) bagian.push(kini);

  return bagian
    .map((s) => ({ ayat: s.ayat, isi: s.isi.join("\n").trim() }))
    .filter((s) => s.isi.length > 0);
}

/** Bentuk id pasal yang stabil, sejajar dengan yang dipakai jalur pasal.id. */
export function idPasal(frbrUri: string, nomorPasal: string, ayat: string | null): string {
  return `${frbrUri}#pasal-${nomorPasal}${ayat ? `-ayat-${ayat}` : ""}`;
}

/**
 * Bangun id untuk sekumpulan pasal, dijamin tidak ada yang kembar.
 *
 * `articles.id` adalah PRIMARY KEY dan `D1.batch()` bersifat atomik, jadi satu
 * id kembar membatalkan penyimpanan SELURUH dokumen. Ini bukan kemungkinan
 * teoretis: penguraian UU 10/2010 menghasilkan 121 baris dengan 120 id unik —
 * satu tabrakan pada "pasal-8-ayat-2" — dan itu cukup untuk membuat seluruh
 * 121 pasal tidak tersimpan sama sekali.
 *
 * Nomor pasal yang berulang bisa sah (peraturan pengubah kerap menyebut ulang
 * nomor yang sama) maupun akibat salah deteksi. Keduanya diselesaikan sama:
 * beri akhiran pembeda, jangan buang isinya.
 */
export function idPasalUnik(frbrUri: string, pasal: PasalTerurai[]): string[] {
  const terpakai = new Set<string>();

  return pasal.map((p) => {
    const dasar = idPasal(frbrUri, p.nomor_pasal, p.ayat);
    if (!terpakai.has(dasar)) {
      terpakai.add(dasar);
      return dasar;
    }
    let n = 2;
    while (terpakai.has(`${dasar}~${n}`)) n++;
    const id = `${dasar}~${n}`;
    terpakai.add(id);
    return id;
  });
}

// ---------------------------------------------------------------------------
// Penilaian kualitas ekstraksi
//
// Seluruh rencana "BPK sebagai sumber utama" bertumpu pada satu mata rantai
// yang belum pernah diuji dengan dokumen nyata: PDF → toMarkdown → pasal.
// Modul ini mengubah pertanyaan "apakah hasilnya bagus?" menjadi angka, supaya
// keputusan arsitektur diambil dari pengukuran, bukan dugaan.
// ---------------------------------------------------------------------------

export interface LaporanKualitas {
  panjang_teks: number;
  jumlah_pasal: number;
  jumlah_ayat: number;
  pasal_tertinggi: number;
  /** Nomor pasal tertinggi dikurangi jumlah pasal unik — pasal yang hilang. */
  celah_pasal: number;
  /** Token angka yang tercemar huruf, mis. "2O24" atau "L78.865". */
  angka_tercemar: number;
  /** Simbol yang tidak semestinya muncul, mis. "€" atau "o/o" untuk persen. */
  simbol_liar: number;
  /** Sisa catchword ganti halaman, mis. "c. Sisa. ." */
  artefak_halaman: number;
  /** Indikator kerusakan per 1.000 karakter. Makin kecil makin bersih. */
  kerusakan_per_1000: number;
  vonis: "bersih" | "ringan" | "berat" | "tanpa_pasal";
}

// Token sepanjang ≥4 yang tersusun dari angka/pemisah DAN memuat huruf O/l/I/L.
// "2O24" dan "L78.865" tertangkap; "1.000" tidak (tanpa huruf); "III" juga
// tidak (tanpa angka).
//
// Batas dinyatakan dengan lookaround terhadap kelas karakternya sendiri, bukan
// `\b`. Nilai rupiah hampir selalu ditulis menempel pada "Rp", dan `\b` tidak
// mengenali batas antara "p" dan "2" — sehingga "Rp2O24", bentuk yang justru
// paling sering rusak di dokumen keuangan, luput sama sekali.
const RE_ANGKA_TERCEMAR =
  /(?<![0-9.,OlIL])(?=[0-9.,OlIL]*[0-9])(?=[0-9.,OlIL]*[OlIL])[0-9.,OlIL]{4,}(?![0-9.,OlIL])/g;
// Idem: "72o/o" tidak punya batas kata sebelum "o".
const RE_SIMBOL_LIAR = /[€£¥§¤]|o\/o/g;
const RE_ARTEFAK_HALAMAN = /\.\s+\.\s*\.?/g;

function hitung(teks: string, pola: RegExp): number {
  return (teks.match(pola) ?? []).length;
}

export function nilaiKualitasEkstraksi(
  naskah: string,
  pasal: PasalTerurai[],
): LaporanKualitas {
  const panjang = naskah.length;

  const nomorUnik = new Set(pasal.map((p) => p.nomor_pasal));
  const nomorAngka = [...nomorUnik]
    .map((n) => parseInt(n, 10))
    .filter((n) => Number.isFinite(n));
  const tertinggi = nomorAngka.length ? Math.max(...nomorAngka) : 0;

  const angkaTercemar = hitung(naskah, RE_ANGKA_TERCEMAR);
  const simbolLiar = hitung(naskah, RE_SIMBOL_LIAR);
  const artefak = hitung(naskah, RE_ARTEFAK_HALAMAN);

  const totalIndikator = angkaTercemar + simbolLiar + artefak;
  const per1000 = panjang > 0 ? (totalIndikator * 1000) / panjang : 0;

  const vonis: LaporanKualitas["vonis"] =
    pasal.length === 0 ? "tanpa_pasal"
    : per1000 >= 2 ? "berat"
    : per1000 >= 0.5 ? "ringan"
    : "bersih";

  return {
    panjang_teks: panjang,
    jumlah_pasal: pasal.length,
    jumlah_ayat: pasal.filter((p) => p.ayat !== null).length,
    pasal_tertinggi: tertinggi,
    celah_pasal: Math.max(tertinggi - nomorUnik.size, 0),
    angka_tercemar: angkaTercemar,
    simbol_liar: simbolLiar,
    artefak_halaman: artefak,
    kerusakan_per_1000: Number(per1000.toFixed(3)),
    vonis,
  };
}
