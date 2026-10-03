// @ts-check
/**
 * Fungsi murni untuk antarmuka: pelabelan, URL, pengelompokan pasal, tata letak
 * graf, dan penguraian teks jawaban. Tidak menyentuh DOM sehingga bisa diuji
 * langsung di Node (lihat test/web.test.ts).
 */

/** @typedef {import("../../src/shared/types").Law} Law */
/** @typedef {import("../../src/shared/types").Article} Article */
/** @typedef {import("../../src/shared/types").StatusPeraturan} StatusPeraturan */
/** @typedef {import("../../src/shared/types").JenisRelasi} JenisRelasi */
/** @typedef {{ teks: string, tebal: boolean }} Sebaris */
/** @typedef {{ tipe: "p", isi: Sebaris[] } | { tipe: "ul" | "ol", butir: Sebaris[][] }} BlokTeks */

/** Nama lengkap jenis peraturan menurut kode internal. */
export const LABEL_JENIS = /** @type {Record<string, string>} */ ({
  UUD: "Undang-Undang Dasar",
  TAP_MPR: "Ketetapan MPR",
  UU: "Undang-Undang",
  PERPPU: "Perppu",
  PP: "Peraturan Pemerintah",
  PERPRES: "Peraturan Presiden",
  KEPPRES: "Keputusan Presiden",
  INPRES: "Instruksi Presiden",
  PERMEN: "Peraturan Menteri",
  KEPMEN: "Keputusan Menteri",
  POJK: "Peraturan OJK",
  PBI: "Peraturan Bank Indonesia",
  PERDA_PROV: "Perda Provinsi",
  PERDA_KAB: "Perda Kabupaten/Kota",
  PERGUB: "Peraturan Gubernur",
  PERBUP: "Peraturan Bupati",
  PERWALI: "Peraturan Wali Kota",
});

/** @param {string} kode */
export function labelJenis(kode) {
  return LABEL_JENIS[kode] ?? kode.replace(/_/g, " ");
}

/** Kode singkat untuk tampilan, mis. `PERDA_PROV` menjadi `PERDA`. @param {string} kode */
export function kodeJenis(kode) {
  return kode.replace(/_(PROV|KAB)$/, "").replace(/_/g, " ");
}

/**
 * "UU 13/2003"
 * @param {{ jenis: string, nomor: string, tahun: number }} l
 */
export function sitasi(l) {
  return `${kodeJenis(l.jenis)} ${nomorTahun(l.jenis, l.nomor, l.tahun)}`;
}

const POLA_SLUG_POJK = /^(\d+)-pojk-(\d{2})-(\d{4})$/i;

/**
 * "13/2003"; untuk POJK bernomor slug ("48-pojk-04-2016") penulisan resminya "48/POJK.04/2016".
 * Salinan dari src/shared/label.ts (dijaga sama oleh test/web.test.ts).
 * @param {string} jenis
 * @param {string} nomor
 * @param {number} tahun
 */
export function nomorTahun(jenis, nomor, tahun) {
  const m = jenis === "POJK" ? POLA_SLUG_POJK.exec(nomor) : null;
  return m ? `${m[1]}/POJK.${m[2]}/${m[3]}` : `${nomor}/${tahun}`;
}

/**
 * "UU 13/2003 Pasal 82 ayat (1)"
 * @param {{ jenis: string, nomor: string, tahun: number }} l
 * @param {string | null | undefined} pasal
 * @param {string | null | undefined} [ayat]
 */
export function sitasiPasal(l, pasal, ayat) {
  if (!pasal) return sitasi(l);
  return `${sitasi(l)} Pasal ${pasal}${ayat ? ` ayat (${ayat})` : ""}`;
}

/** "Undang-Undang Nomor 13 Tahun 2003" @param {{ jenis: string, nomor: string, tahun: number }} l */
export function namaLengkap(l) {
  const resmi = l.jenis === "POJK" && POLA_SLUG_POJK.test(l.nomor);
  return `${labelJenis(l.jenis)} Nomor ${resmi ? nomorTahun(l.jenis, l.nomor, l.tahun) : `${l.nomor} Tahun ${l.tahun}`}`;
}

export const LABEL_STATUS = /** @type {Record<string, string>} */ ({
  berlaku: "Berlaku",
  dicabut: "Dicabut",
  diubah: "Diubah",
});

/** @param {string | null | undefined} status */
export function labelStatus(status) {
  return status ? (LABEL_STATUS[status] ?? status) : "Status tidak diketahui";
}

export const LABEL_RELASI = /** @type {Record<string, string>} */ ({
  mengubah: "Mengubah",
  diubah_oleh: "Diubah oleh",
  mencabut: "Mencabut",
  dicabut_oleh: "Dicabut oleh",
  dasar_hukum: "Dasar hukum",
  menjadi_dasar_hukum: "Menjadi dasar hukum bagi",
  melaksanakan: "Melaksanakan",
  dilaksanakan_oleh: "Dilaksanakan oleh",
  terkait: "Terkait",
});

/** Urutan tampil kelompok relasi: yang paling memengaruhi keberlakuan lebih dulu. */
export const URUTAN_RELASI = [
  "dicabut_oleh", "diubah_oleh", "mencabut", "mengubah", "dasar_hukum",
  "melaksanakan", "dilaksanakan_oleh", "menjadi_dasar_hukum", "terkait",
];

/** @param {string} jenis */
export function labelRelasi(jenis) {
  return LABEL_RELASI[jenis] ?? jenis.replace(/_/g, " ");
}

const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/**
 * "2003-03-25" menjadi "25 Maret 2003"; nilai yang tidak dikenali dikembalikan apa adanya.
 * @param {string | null | undefined} iso
 */
export function tanggalIndonesia(iso) {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const bulan = BULAN[Number(m[2]) - 1];
  return bulan ? `${Number(m[3])} ${bulan} ${m[1]}` : iso;
}

/**
 * Ukuran berkas yang ramah dibaca: "480 KB", "1,2 MB".
 * @param {number} bita
 */
export function ukuranBerkas(bita) {
  if (!Number.isFinite(bita) || bita < 0) return "";
  if (bita < 1024) return `${bita} B`;
  if (bita < 1024 * 1024) return `${Math.round(bita / 1024)} KB`;
  return `${(bita / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/** @param {number | null | undefined} n */
export function angka(n) {
  return new Intl.NumberFormat("id-ID").format(n ?? 0);
}

// --- Judul dan nama bidang -----------------------------------------------------

/** Kata sambung yang ditulis huruf kecil di tengah judul. */
const KATA_KECIL = new Set([
  "dan", "atau", "di", "ke", "dari", "untuk", "yang", "serta", "bagi", "pada", "dengan", "dalam", "oleh",
  "atas", "terhadap", "sebagai", "tentang", "antara", "kepada", "sampai", "hingga", "menjadi", "adalah", "itu", "ini",
]);

/**
 * Singkatan yang memuat huruf hidup (yang tanpa huruf hidup, mis. BPK, DPR, KPK, PT, dikenali otomatis).
 * Hanya dipakai saat teks sumber seluruhnya huruf besar, karena BPK menulis banyak judul dan nama bidang begitu.
 */
const SINGKATAN = new Set([
  "APBN", "APBD", "BUMN", "BUMD", "BLU", "BPJS", "OJK", "TNI", "POLRI", "RI", "NKRI", "HAM", "ITE", "UMKM", "PNS", "ASN",
  "KUHP", "KUHAP", "NPWP", "PPN", "PPH", "PBB", "BPHTB", "IPTEK", "ASEAN", "UU", "PP", "POJK", "PERPPU", "PERPRES", "PERMEN",
  "KPU", "BAWASLU", "BNPB", "BNN", "BPOM", "BRIN", "IUP", "ZEE", "UNESCO", "ILO", "WHO", "COVID", "AI",
]);

const ANGKA_ROMAWI = /^(?=[IVXLCDM])M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/;

/**
 * Rapikan huruf besar/kecil sebuah judul atau topik.
 *
 * - Seluruhnya huruf besar (BPK menulis sekitar seperempat judul dan hampir semua nama bidang begitu):
 *   menjadi huruf judul ("Tata Cara Hubungan Antar Lembaga"), dengan singkatan dan angka Romawi dipertahankan.
 * - Campuran: hanya kata sambung berkapital di tengah ("Bagi", "Dan", "Atas") yang diturunkan, supaya
 *   "Pemberian Uang Kompensasi/penghargaan Bagi Ketua dan Anggota" tidak terbaca setengah-setengah.
 *
 * Tidak mengubah isi data; hanya tampilan.
 * @param {string | null | undefined} teks
 */
export function rapikanHuruf(teks) {
  if (!teks) return "";
  const t = teks.trim().replace(/\s+/g, " ");
  const semuaBesar = !/\p{Ll}/u.test(t) && /\p{Lu}/u.test(t);
  let pertama = true;
  return t.replace(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu, (kata) => {
    const awal = pertama;
    pertama = false;
    const kecil = kata.toLowerCase();
    if (KATA_KECIL.has(kecil)) return awal ? kecil[0].toUpperCase() + kecil.slice(1) : kecil;
    if (!semuaBesar) return kata;
    const besar = kata.toUpperCase();
    if (SINGKATAN.has(besar) || ANGKA_ROMAWI.test(besar) || /\d/.test(kata)) return besar;
    // Singkatan tanpa huruf hidup: BPK, DPR, MPR, KPK, PT, MK.
    if (kata.length <= 5 && !/[AIUEO]/.test(besar)) return besar;
    return kata[0].toUpperCase() + kata.slice(1).toLowerCase();
  });
}

/**
 * Pisahkan judul resmi ("Peraturan Pemerintah Nomor 85 Tahun 2013 tentang Tata Cara …") menjadi
 * kepala dan topik. Sitasi ("PP 85/2013") sudah mengenali peraturannya, jadi daftar cukup menampilkan topik.
 * Judul yang tidak berbentuk begitu (mis. "Penetapan Peraturan Pemerintah Pengganti …") dibiarkan utuh.
 * @param {string | null | undefined} judul
 * @returns {{ kepala: string | null, topik: string }}
 */
export function pisahJudul(judul) {
  const t = (judul ?? "").trim();
  const m = /^((?:Undang-?\s?undang|Peraturan|Keputusan|Instruksi|Ketetapan|Perpu|Perppu)\b.*?\b(?:nomor|no\.?)\s+\S+(?:\s+tahun\s+\d{4})?)\s+tentang\s+(.+)$/is.exec(t);
  return m ? { kepala: m[1].trim(), topik: m[2].trim() } : { kepala: null, topik: t };
}

/**
 * Judul untuk kartu dan daftar: topiknya saja, dengan huruf yang dirapikan.
 * @param {string | null | undefined} judul
 */
export function judulRingkas(judul) {
  return rapikanHuruf(pisahJudul(judul).topik);
}

/**
 * Bidang dari nilai kolom `bidang` ("APBN - BUMN"): nama aslinya (untuk filter/URL) dan labelnya yang dirapikan.
 * @param {string | null | undefined} bidang
 * @returns {Array<{ nama: string, label: string }>}
 */
export function pecahBidang(bidang) {
  if (!bidang) return [];
  /** @type {Map<string, { nama: string, label: string }>} */
  const peta = new Map();
  for (const nama of bidang.split(/\s+-\s+/).map((b) => b.trim()).filter(Boolean)) {
    const label = rapikanHuruf(nama);
    if (!peta.has(label)) peta.set(label, { nama, label });
  }
  return [...peta.values()];
}

/** Daftar bidang dari nilai kolom `bidang` ("APBN - BUMN"), dirapikan hurufnya. @param {string | null | undefined} bidang */
export function daftarBidang(bidang) {
  return pecahBidang(bidang).map((b) => b.label);
}

/**
 * Bagian setelah `#` pada id pasal. Akhiran `~n` TIDAK dibuang: id kembar hasil
 * penyaringan ingest (`...-ayat-2~2`) adalah id pasal yang sah.
 * @param {string | null | undefined} idPasal
 */
export function jangkarDariId(idPasal) {
  if (!idPasal) return "";
  const i = idPasal.indexOf("#");
  return i >= 0 ? idPasal.slice(i + 1) : idPasal;
}

/**
 * Susun query string dari objek; nilai kosong dibuang, larik digabung dengan koma.
 * @param {Record<string, string | number | boolean | Array<string | number> | null | undefined>} params
 */
export function queryString(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "" || v === false) continue;
    if (Array.isArray(v)) {
      if (v.length) q.set(k, v.join(","));
    } else {
      q.set(k, String(v));
    }
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * Tautan ke halaman peraturan (sama dengan URL pada sitemap).
 * @param {string} uri
 * @param {{ q?: string | null, jangkar?: string | null }} [opsi]
 */
export function urlPeraturan(uri, opsi = {}) {
  const jangkar = opsi.jangkar ? `#${opsi.jangkar}` : "";
  return `/peraturan${queryString({ uri, q: opsi.q })}${jangkar}`;
}

/**
 * Entri koleksi bisa berupa peraturan (`/akn/id/act/uu/2003/13`) atau satu pasal di dalamnya
 * (`/akn/id/act/uu/2003/13#pasal-82`). Pisahkan alamat peraturan dari jangkar pasalnya.
 * @param {string} uri
 * @returns {{ uri: string, jangkar: string | null }}
 */
export function pecahUriKoleksi(uri) {
  const i = uri.indexOf("#");
  if (i < 0) return { uri, jangkar: null };
  const jangkar = uri.slice(i + 1);
  return { uri: uri.slice(0, i), jangkar: jangkar || null };
}

/** Tautan ke halaman peraturan (dan pasalnya bila entri koleksi berupa pasal). @param {string} uriKoleksi */
export function urlEntriKoleksi(uriKoleksi) {
  const { uri, jangkar } = pecahUriKoleksi(uriKoleksi);
  return urlPeraturan(uri, { jangkar });
}

/**
 * Baca filter pencarian dari query string.
 * @param {URLSearchParams} p
 */
export function bacaFilter(p) {
  /** @param {string} nama */
  const daftar = (nama) =>
    p.getAll(nama).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
  /** @param {string} nama */
  const bilangan = (nama) => {
    const n = Number(p.get(nama));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const mode = p.get("mode");
  return {
    q: (p.get("q") ?? "").trim(),
    mode: mode === "keyword" || mode === "semantic" ? mode : "hybrid",
    jenis: daftar("jenis"),
    status: daftar("status"),
    tahun_min: bilangan("tahun_min"),
    tahun_max: bilangan("tahun_max"),
    bidang: p.get("bidang") || undefined,
  };
}

/**
 * Penanda halaman hasil konversi PDF yang terselip di tengah teks pasal, mis.
 * "Cukup jelas    ### Page 97 PRESIDEN REPUBLIK INDONESIA- 18 -" atau
 * "### Page 98 PRESIDEN REPUBLIK INDONESIA- 19 -Ayat (1) Cukup jelas". Itu kepala halaman, bukan
 * bunyi peraturan. Hanya tampilan yang dirapikan; data di database tidak diubah.
 */
const RE_PENANDA_HALAMAN = /\s*#{1,6}\s*Page\s+\d+(?:\s+[A-Z][A-Z .,/&()-]*?\s*-\s*\d+\s*-)?\s*/g;

/**
 * Kepala/kaki halaman cetak yang ikut terekstrak tanpa penanda "### Page": "PRESIDEN⏎REPUBLIK INDONESIA- 3 -",
 * "MENTERI KEUANGAN REPUBLIK INDONESIA - 12 -". Dikenali dari "REPUBLIK INDONESIA" huruf besar yang disusul
 * nomor halaman "- N -", sehingga kalimat biasa yang menyebut republik tidak tersentuh. Spasi dan baris baru di
 * sekitarnya dibiarkan agar bagian teks di kiri dan kanannya tetap tersambung lewat penyusunan ulang baris.
 */
const RE_KEPALA_HALAMAN = /[ \t]*\b(?:(?:PRESIDEN|MENTERI(?:[ \t]+[A-Z]{3,}){0,4}|GUBERNUR(?:[ \t]+[A-Z]{3,}){0,3}|BUPATI(?:[ \t]+[A-Z]{3,}){0,3}|WALI[ \t]+KOTA(?:[ \t]+[A-Z]{3,}){0,3})\s+)?REPUBLIK\s+INDONESIA\s*-\s*\d{1,4}\s*-[ \t]*/g;
/** Nomor halaman yang berdiri sendiri pada satu baris: "- 12 -". */
const RE_NOMOR_HALAMAN = /^[ \t]*-\s*\d{1,4}\s*-[ \t]*$/gm;

/** @param {string | null | undefined} teks */
export function bersihkanArtefak(teks) {
  if (!teks) return "";
  return teks
    .replace(RE_PENANDA_HALAMAN, " ")
    .replace(RE_KEPALA_HALAMAN, " ")
    .replace(RE_NOMOR_HALAMAN, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * @typedef {{ tipe: "p" } | { tipe: "label" } | { tipe: "butir", penanda: string, tingkat: 1 | 2 }} JenisBlokPasal
 * @typedef {JenisBlokPasal & { teks: string }} BlokPasal
 */

/** Awal butir daftar: "1.", "2)", "(3)", "a.", "b)", "(c)", atau tanda hubung/titik. */
const RE_BUTIR = /^(\(\d{1,3}\)|\d{1,3}[.)]|\([a-z]{1,2}\)|[a-z][.)]|[-•–])\s+(\S.*)$/;
/** Baris yang jelas belum selesai walau baris berikutnya berawal huruf besar: berakhir koma atau kata penghubung ("…berada di⏎Indonesia"). */
const RE_BELUM_SELESAI = /(?:,|\b(?:di|ke|dari|yang|dan|atau|untuk|pada|dengan|dalam|oleh|atas|adalah|sebagai|serta|bagi|kepada|terhadap|antara|tentang|yaitu|yakni))$/i;
/** Kalimat yang sudah selesai: berakhir titik, titik dua, titik koma, atau tanda seru/tanya (boleh diikuti tanda kutip/kurung penutup). */
const RE_SELESAI = /[.:;!?]["”')\]]?\s*$/;
/** Kata majemuk yang kehilangan tanda hubung saat PDF dikonversi menjadi teks. */
const RE_HURUF_HILANG = /\b(perundang|undang) (undang|undangan)\b/gi;
/** Butir yang terlipat dalam satu baris: kalimat selesai lalu "(2) Huruf besar…", atau ";" lalu "b. huruf kecil…". */
/** Baris sepanjang ini (atau lebih) yang tak berakhir tanda baca adalah baris yang dipatahkan lebar kolom, bukan akhir paragraf. */
const PANJANG_BARIS_LIPAT = 50;
/** Label struktur yang berdiri sendiri di satu baris: "BAB XII", "Bagian Kedua", "Paragraf 2", "Pasal 156". */
const RE_LABEL_STRUKTUR = /^(?:BAB|Bagian|Paragraf|Pasal)\s+[\p{L}\d.]+$/u;
/** Penunjuk bagian dalam penjelasan pasal demi pasal: "Ayat (2)", "Huruf b", "Angka 3". */
const RE_LABEL_PENJELASAN = /^(?:Ayat \(\d{1,3}[a-z]?\)|Huruf [a-z]{1,2}|Angka \d{1,3}|Butir \d{1,3})$/;
/** Judul berhuruf kapital semua ("KETENAGAKERJAAN", "II. PASAL DEMI PASAL"). */
const RE_SEMUA_KAPITAL = /^[^\p{Ll}]*\p{Lu}[^\p{Ll}]*\p{Lu}[^\p{Ll}]*$/u;
const RE_BUTIR_SATU_BARIS = /(?<=[.:;])\s+(?=\(\d{1,3}\)\s+\p{Lu})|(?<=;)\s+(?=[a-z][.)]\s+\p{Ll})/gu;

/**
 * Teks sebuah pasal/ayat menjadi blok untuk ditampilkan.
 *
 * Teks hasil ekstraksi PDF membawa pemenggalan baris dari lembar cetak ("…dengan tenaga kerja⏎pada waktu
 * sebelum…"), sehingga satu kalimat patah di tengah dan `white-space: pre-line` menampilkannya apa
 * adanya. Di sini baris yang jelas merupakan lanjutan (kalimat sebelumnya belum selesai dan baris
 * ini berawal huruf kecil) disambung kembali, sedangkan butir daftar ("1.", "a.", "(2)", "-") menjadi
 * blok sendiri dengan penandanya, supaya bisa ditampilkan menjorok. Penanda halaman PDF dibuang
 * (lihat `bersihkanArtefak`). Hanya tampilan: isi di database tidak diubah.
 *
 * @param {string | null | undefined} teks
 * @returns {BlokPasal[]}
 */
export function bacaIsiPasal(teks) {
  const bersih = bersihkanArtefak(teks)
    .replace(RE_HURUF_HILANG, (_, a, b) => `${a}-${b}`)
    .replace(RE_BUTIR_SATU_BARIS, "\n");
  if (!bersih) return [];
  /** @type {BlokPasal[]} */
  const blok = [];
  /** @type {BlokPasal | null} */
  let saatIni = null;
  let barisKosong = false;
  let panjangSebelumnya = 0;

  for (const mentah of bersih.split(/\r?\n/)) {
    const baris = mentah.replace(/\s+/g, " ").trim();
    if (!baris) {
      barisKosong = true;
      continue;
    }
    const m = RE_BUTIR.exec(baris);
    if (RE_LABEL_PENJELASAN.test(baris)) {
      saatIni = { tipe: "label", teks: baris };
      blok.push(saatIni);
    } else if (m) {
      const penanda = m[1];
      saatIni = { tipe: "butir", penanda, tingkat: /^\(?[a-z]{1,2}[.)]?$|^\([a-z]{1,2}\)$/i.test(penanda) && !/\d/.test(penanda) ? 2 : 1, teks: m[2] };
      blok.push(saatIni);
    } else if (
      saatIni && saatIni.tipe !== "label" && !barisKosong && !RE_SELESAI.test(saatIni.teks) &&
      (/^[\p{Ll}\d(]/u.test(baris) ||
        RE_BELUM_SELESAI.test(saatIni.teks) ||
        // Baris panjang tanpa tanda akhir dipatahkan lebar kolom: "...diatur dengan Peraturan" / "Pemerintah.".
        (panjangSebelumnya >= PANJANG_BARIS_LIPAT && !RE_LABEL_STRUKTUR.test(baris) && !RE_SEMUA_KAPITAL.test(baris)))
    ) {
      saatIni.teks += ` ${baris}`;
    } else {
      saatIni = { tipe: "p", teks: baris };
      blok.push(saatIni);
    }
    barisKosong = false;
    panjangSebelumnya = baris.length;
  }
  return blok;
}

const KATA_HENTI = new Set([
  "yang", "dan", "atau", "di", "ke", "dari", "untuk", "pada", "dengan", "dalam", "adalah", "ini", "itu",
  "oleh", "tentang", "akan", "telah", "dapat", "tidak", "juga", "serta", "bagi", "atas", "para", "agar",
]);

/**
 * Istilah dari kueri yang layak ditandai di teks peraturan.
 * @param {string | null | undefined} q
 */
export function istilahDariKueri(q) {
  if (!q) return [];
  const unik = new Set(
    q.toLowerCase().split(/[^\p{L}\p{N}-]+/u).map((t) => t.replace(/^-+|-+$/g, "")).filter((t) => t.length >= 3 && !KATA_HENTI.has(t)),
  );
  return [...unik].slice(0, 8);
}

/** Akhiran id pasal untuk nomor yang muncul lagi di dokumen yang sama (lihat idPasalUnik di server). */
const RE_NOMOR_KEMBAR = /~\d+$/;
/** Rangkaian nomor berulang sependek ini tidak dianggap Penjelasan. */
const MIN_PENJELASAN = 3;
/** Judul naskah penjelasan yang terbawa di dalam teks pasal terakhir ("PENJELASAN ATAS UNDANG-UNDANG ..."). */
const RE_PENJELASAN_TERTANAM = /PENJELASAN\s*ATAS\s*(?:UNDANG|PERATURAN)/;
const RE_JUDUL_UMUM = /(?:^|\n)[ \t]*[-–]?[ \t]*I\.[ \t]*UMUM[ \t]*(?:\n|$)/;
const RE_PASAL_DEMI_PASAL = /\n?[ \t]*[-–]?[ \t]*II\.[ \t]*PASAL[ \t]+DEMI[ \t]+PASAL[ \t]*$/i;

/**
 * Pisahkan "Penjelasan Umum" yang ikut tersimpan di ujung teks pasal terakhir (hasil ekstraksi PDF lama:
 * tanda tangan pengesahan, lalu "PENJELASAN ATAS UNDANG-UNDANG ...", "I. UMUM", dan seterusnya).
 * @param {string} teks
 * @returns {{ batang: string, umum: string } | null} null bila teks tidak memuat naskah penjelasan
 */
export function pisahPenjelasanTertanam(teks) {
  const i = teks.search(RE_PENJELASAN_TERTANAM);
  if (i < 0) return null;
  const batang = teks
    .slice(0, i)
    .replace(/\s*(?:#{1,6}[ \t]*Page[ \t]+\d+\s*)?(?:PRESIDEN\s*REPUBLIK[ \t]+INDONESIA)?\s*$/, "")
    .trim();
  const sisa = teks.slice(i);
  const judul = RE_JUDUL_UMUM.exec(sisa);
  const umum = (judul && judul.index < 700 ? sisa.slice(judul.index + judul[0].length) : sisa).replace(RE_PASAL_DEMI_PASAL, "").trim();
  return { batang, umum };
}

/** Nilai angka di awal nomor pasal ("5A" menjadi 5); NaN bila tidak berangka (mis. "I", "Umum"). @param {string} nomor */
const nilaiNomor = (nomor) => {
  const m = /^\d+/.exec(nomor.trim());
  return m ? Number(m[0]) : Number.NaN;
};

/**
 * Indeks tempat penomoran pasal kembali ke awal setelah mencapai nomor tinggi, lalu menaik lagi: awal "pasal demi pasal".
 * Penurunan tunggal (salah deteksi di tengah teks) tidak cukup; harus kembali ke nomor kecil dan diikuti deretan menaik.
 * @param {Array<{ nomor: string }>} kelompok
 */
function cariPenomoranUlang(kelompok) {
  let tertinggi = 0;
  for (let i = 0; i < kelompok.length; i++) {
    const v = nilaiNomor(kelompok[i].nomor);
    if (Number.isNaN(v)) continue;
    if (tertinggi >= 15 && v <= 10 && v <= tertinggi / 4) {
      const berikut = kelompok.slice(i + 1, i + 7).map((g) => nilaiNomor(g.nomor));
      let naik = 0;
      let sebelumnya = v;
      for (const n of berikut) {
        if (!Number.isNaN(n) && n > sebelumnya) naik++;
        if (!Number.isNaN(n)) sebelumnya = n;
      }
      if (berikut.length >= 2 && naik >= Math.ceil(berikut.length * 0.6)) return i;
    }
    tertinggi = Math.max(tertinggi, v);
  }
  return -1;
}

/**
 * Kelompok pasal untuk ditampilkan: baris berurutan dengan nomor pasal sama
 * (satu per ayat) digabung, dan bab/bagian dibawa agar judulnya bisa dimunculkan.
 *
 * Bagian "Penjelasan" (pasal demi pasal) memakai ulang nomor batang tubuh; saat ingest ia mendapat
 * akhiran `~n` pada id (`pasal-1~2`). Rangkaian bernomor berulang yang berlangsung sampai akhir dokumen
 * dan cukup panjang ditandai `penjelasan`; satu-dua nomor kembar di tengah peraturan (salah deteksi atau
 * kutipan pada peraturan pengubah) tidak.
 * @param {Article[]} artikel
 * @returns {Array<{ jangkar: string, nomor: string, judul: string | null, bab: string | null, bagian: string | null, babBaru: boolean, bagianBaru: boolean, penjelasan: boolean, penjelasanBaru: boolean, butir: Article[] }>}
 */
export function kelompokkanPasal(artikel) {
  /** @type {ReturnType<typeof kelompokkanPasal>} */
  const hasil = [];
  let babSebelumnya = /** @type {string | null} */ (null);
  let bagianSebelumnya = /** @type {string | null} */ (null);
  for (const a of artikel) {
    const terakhir = hasil.at(-1);
    if (terakhir && terakhir.nomor === a.nomor_pasal) {
      terakhir.butir.push(a);
      continue;
    }
    const babBaru = a.bab !== babSebelumnya && a.bab !== null;
    const bagianBaru = a.bagian !== bagianSebelumnya && a.bagian !== null;
    babSebelumnya = a.bab ?? babSebelumnya;
    bagianSebelumnya = a.bagian ?? bagianSebelumnya;
    hasil.push({
      // "pasal-5-ayat-1~2" menjadi "pasal-5~2": akhiran pembeda ikut, supaya penjelasan tidak berbagi id dengan batang tubuh.
      jangkar: jangkarDariId(a.id).replace(/-ayat-[^~]*/, "") || `pasal-${a.nomor_pasal}`,
      nomor: a.nomor_pasal,
      judul: a.judul,
      bab: a.bab,
      bagian: a.bagian,
      babBaru,
      bagianBaru,
      penjelasan: false,
      penjelasanBaru: false,
      butir: [a],
    });
  }

  return tandaiPenjelasan(hasil);
}

/**
 * Tandai bagian Penjelasan pada kelompok pasal (mengubah `kelompok` di tempat), dengan tiga petunjuk berurutan:
 *  1. naskah penjelasan yang terbawa di teks sebuah pasal (dipisah menjadi kelompok "Umum");
 *  2. penomoran yang kembali ke awal setelah mencapai nomor tinggi;
 *  3. rangkaian id berakhiran ~n yang berlangsung sampai akhir dokumen.
 * @param {ReturnType<typeof kelompokkanPasal>} kelompok
 */
function tandaiPenjelasan(kelompok) {
  /** @param {number} dari */
  const tandaiDari = (dari) => {
    for (let k = dari; k < kelompok.length; k++) {
      kelompok[k].penjelasan = true;
      kelompok[k].penjelasanBaru = k === dari;
    }
  };

  for (let i = 0; i < kelompok.length; i++) {
    const g = kelompok[i];
    const j = g.butir.findIndex((b) => RE_PENJELASAN_TERTANAM.test(b.isi));
    const pisah = j < 0 ? null : pisahPenjelasanTertanam(g.butir[j].isi);
    if (!pisah) continue;

    const asal = g.butir[j];
    const sesudah = g.butir.slice(j + 1);
    const butirBatang = [...g.butir.slice(0, j), ...(pisah.batang ? [{ ...asal, isi: pisah.batang }] : [])];
    const butirUmum = [...(pisah.umum ? [{ ...asal, id: `${asal.frbr_uri}#penjelasan-umum`, nomor_pasal: "Umum", ayat: null, bab: null, bagian: null, judul: null, isi: pisah.umum }] : []), ...sesudah];

    // Pasal yang isinya habis terpotong (penjelasan mulai di awal teksnya) tidak dipertahankan sebagai kelompok kosong.
    let awal = i + 1;
    if (butirBatang.length) {
      g.butir = butirBatang;
    } else {
      kelompok.splice(i, 1);
      awal = i;
    }
    if (butirUmum.length) {
      kelompok.splice(awal, 0, {
        jangkar: "penjelasan-umum", nomor: "Umum", judul: null, bab: null, bagian: null, babBaru: false, bagianBaru: false,
        penjelasan: true, penjelasanBaru: true, butir: butirUmum,
      });
    }
    tandaiDari(awal);
    return kelompok;
  }

  const ulang = cariPenomoranUlang(kelompok);
  if (ulang >= 0) {
    tandaiDari(ulang);
    return kelompok;
  }

  let awal = kelompok.length;
  let kembar = 0;
  for (let i = kelompok.length - 1; i >= 0; i--) {
    const berulang = RE_NOMOR_KEMBAR.test(kelompok[i].jangkar);
    if (berulang) kembar++;
    const panjang = kelompok.length - i;
    if (berulang && panjang >= MIN_PENJELASAN && kembar / panjang >= 0.9) awal = i;
  }
  tandaiDari(awal);
  return kelompok;
}

/**
 * Daftar isi: pasal dikelompokkan menurut BAB menurut urutan kemunculannya. Pasal yang tidak punya BAB
 * (peraturan tanpa struktur BAB, atau sebelum BAB pertama) masuk ke kelompok tanpa judul.
 * @param {ReturnType<typeof kelompokkanPasal>} kelompok
 * @returns {Array<{ bab: string | null, penjelasan: boolean, pasal: Array<{ nomor: string, jangkar: string }> }>}
 */
export function strukturDaftarIsi(kelompok) {
  /** @type {Array<{ bab: string | null, penjelasan: boolean, pasal: Array<{ nomor: string, jangkar: string }> }>} */
  const hasil = [];
  /** @type {(typeof hasil)[number] | null} */
  let saatIni = null;
  for (const g of kelompok) {
    if (g.penjelasan) {
      // Penjelasan menjadi kelompok tersendiri, apa pun BAB yang terbawa dari batang tubuh.
      if (!saatIni?.penjelasan) {
        saatIni = { bab: null, penjelasan: true, pasal: [] };
        hasil.push(saatIni);
      }
    } else if (g.bab !== null && (g.babBaru || saatIni === null)) {
      saatIni = { bab: g.bab, penjelasan: false, pasal: [] };
      hasil.push(saatIni);
    } else if (saatIni === null) {
      saatIni = { bab: null, penjelasan: false, pasal: [] };
      hasil.push(saatIni);
    }
    saatIni.pasal.push({ nomor: g.nomor, jangkar: g.jangkar });
  }
  return hasil;
}

/**
 * Nama kelompok untuk judul dan label: "Pasal 82", "Penjelasan Pasal 82", atau "Penjelasan Umum".
 * @param {{ nomor: string, penjelasan: boolean }} g
 */
export function namaPasal(g) {
  if (!g.penjelasan) return `Pasal ${g.nomor}`;
  return g.nomor === "Umum" ? "Penjelasan Umum" : `Penjelasan Pasal ${g.nomor}`;
}

/**
 * Jumlah pasal batang tubuh (nomor berbeda; penjelasan tidak dihitung, dan nomor kembar akibat salah
 * deteksi saat ekstraksi tidak dihitung dua kali).
 * @param {Array<{ nomor: string, penjelasan: boolean }>} kelompok
 */
export function hitungPasal(kelompok) {
  return new Set(kelompok.filter((g) => !g.penjelasan).map((g) => g.nomor.toLowerCase())).size;
}

/**
 * Teks polos sebuah pasal (untuk disalin): "Pasal 82", lalu tiap ayat/butir pada barisnya sendiri.
 * `kepala: false` membuang baris "Pasal 82" (bila sitasi lengkapnya sudah ditulis di atasnya).
 * @param {ReturnType<typeof kelompokkanPasal>[number]} g
 * @param {{ kepala?: boolean }} [opsi]
 */
export function teksPasal(g, { kepala = true } = {}) {
  /** @type {string[]} */
  const baris = kepala ? [namaPasal(g)] : [];
  if (g.judul) baris.push(g.judul);
  for (const b of g.butir) {
    const blok = bacaIsiPasal(b.isi);
    const isiBlok = blok.map((x) => (x.tipe === "butir" ? `${x.penanda} ${x.teks}` : x.teks));
    if (b.ayat !== null && isiBlok.length) isiBlok[0] = `(${b.ayat}) ${isiBlok[0]}`;
    baris.push(...isiBlok);
  }
  return baris.join("\n");
}

// --- Rujukan antarpasal ---------------------------------------------------------

/** Inti rujukan: "Pasal 156", "pasal 5A", dengan "ayat (2)" bila ada. Nomor tidak boleh disambung huruf lain ("Pasal 1Dalam"). */
const RE_RUJUKAN_PASAL = /\b[Pp]asal\s+(\d{1,4}[A-Z]?)(?![\p{L}\d])(?:\s+ayat\s+\((\d{1,3}[a-z]?)\))?/gu;
/** Keterangan yang menempel pada rujukan: "ayat (3)", "huruf b", "angka 2", juga daftarnya ("huruf a dan huruf b"). */
const RE_KETERANGAN_RUJUKAN = /^(?:\s*(?:,|dan|atau|serta)?\s*(?:ayat\s+\(\d{1,3}[a-z]?\)|huruf\s+[a-z]\b|angka\s+\d{1,3}|butir\s+\d{1,3}))+/;
/** Sela antara dua rujukan dalam satu rangkaian: "Pasal 5, Pasal 6, dan Pasal 7", "Pasal 77 sampai dengan Pasal 85". */
const RE_SELA_RANGKAIAN = /^\s*(?:,|dan|atau|serta|sampai\s+dengan|s\.d\.)?\s*$/;
/** Yang mengikuti rangkaian rujukan dan menandakan pasalnya milik peraturan lain ("Pasal 5 Undang-Undang Nomor 1 Tahun 1974"). */
const RE_PERATURAN_LAIN =
  /^\s+(?:Undang[- ]Undang(?!\s+ini\b)|Peraturan\s+(?:Pemerintah|Presiden|Daerah|Menteri|Gubernur|Bupati|Wali|Perundang|Mahkamah|Bank|Otoritas)|Peraturan\s+\S+\s+Nomor|Keputusan\s+(?:Presiden|Menteri)|Instruksi\s+Presiden|Kitab\s+Undang|Perpu\b|Perppu\b|Ordonansi|Staatsblad|Wetboek|Reglement)/i;

/**
 * Pecah teks pasal menjadi potongan biasa dan rujukan ke pasal lain DI PERATURAN YANG SAMA.
 * Rangkaian rujukan yang diikuti nama peraturan lain ("Pasal 5 dan Pasal 6 Undang-Undang Nomor 1 Tahun 1974",
 * "Pasal 2 Kitab Undang-Undang Hukum Pidana") tidak ditautkan; "Undang-Undang ini" tetap dianggap peraturan yang sama.
 * Hanya inti rujukan ("Pasal 5 ayat (2)") yang ditautkan, bukan keterangan sesudahnya ("huruf b").
 *
 * @param {string} teks
 * @returns {Array<string | { teks: string, nomor: string, ayat: string | null }>}
 */
export function pecahRujukan(teks) {
  /** @type {Array<{ awal: number, akhirInti: number, akhir: number, nomor: string, ayat: string | null }>} */
  const rujukan = [];
  for (const m of teks.matchAll(RE_RUJUKAN_PASAL)) {
    const akhirInti = m.index + m[0].length;
    const tambahan = RE_KETERANGAN_RUJUKAN.exec(teks.slice(akhirInti));
    rujukan.push({ awal: m.index, akhirInti, akhir: akhirInti + (tambahan ? tambahan[0].length : 0), nomor: m[1], ayat: m[2] ?? null });
  }
  if (!rujukan.length) return [teks];

  // Peraturan lain di ujung sebuah rangkaian berlaku bagi semua rujukan di rangkaian itu.
  const luar = rujukan.map(() => false);
  for (let i = 0; i < rujukan.length; ) {
    let j = i;
    while (j + 1 < rujukan.length) {
      const sela = teks.slice(rujukan[j].akhir, rujukan[j + 1].awal);
      if (sela.length > 24 || !RE_SELA_RANGKAIAN.test(sela)) break;
      j++;
    }
    if (RE_PERATURAN_LAIN.test(teks.slice(rujukan[j].akhir, rujukan[j].akhir + 80))) luar.fill(true, i, j + 1);
    i = j + 1;
  }

  /** @type {Array<string | { teks: string, nomor: string, ayat: string | null }>} */
  const hasil = [];
  let kursor = 0;
  rujukan.forEach((r, i) => {
    if (luar[i]) return;
    if (r.awal > kursor) hasil.push(teks.slice(kursor, r.awal));
    hasil.push({ teks: teks.slice(r.awal, r.akhirInti), nomor: r.nomor, ayat: r.ayat });
    kursor = r.akhirInti;
  });
  if (kursor < teks.length) hasil.push(teks.slice(kursor));
  return hasil;
}

// --- Graf relasi --------------------------------------------------------------

/** Prioritas jenis relasi saat dua peraturan punya lebih dari satu sisi (mis. pasangan invers). */
const PRIORITAS_SISI = ["mencabut", "dicabut_oleh", "mengubah", "diubah_oleh", "melaksanakan", "dilaksanakan_oleh", "dasar_hukum", "menjadi_dasar_hukum", "terkait"];

/**
 * Satu sisi per pasangan peraturan: relasi invers (A mencabut B, B dicabut oleh A)
 * digambar sebagai satu garis.
 * @param {Array<{ dari: string, ke: string, jenis: string }>} sisi
 */
export function sisiUnik(sisi) {
  /** @type {Map<string, { dari: string, ke: string, jenis: string }>} */
  const peta = new Map();
  for (const s of sisi) {
    const kunci = [s.dari, s.ke].sort().join("\u0000");
    const ada = peta.get(kunci);
    if (!ada || PRIORITAS_SISI.indexOf(s.jenis) < PRIORITAS_SISI.indexOf(ada.jenis)) peta.set(kunci, s);
  }
  return [...peta.values()];
}

/**
 * Tata letak melingkar: pusat di tengah, tetangga langsung pada cincin pertama,
 * tetangga dari tetangga pada cincin kedua (searah induknya).
 * @param {Array<{ uri: string, jarak: number }>} simpul
 * @param {Array<{ dari: string, ke: string }>} sisi
 * @param {string} pusat
 * @param {{ lebarSimpul?: number, tinggiSimpul?: number }} [opsi]
 */
export function tataLetakGraf(simpul, sisi, pusat, opsi = {}) {
  const lebarSimpul = opsi.lebarSimpul ?? 116;
  const tinggiSimpul = opsi.tinggiSimpul ?? 36;
  const cincin1 = simpul.filter((n) => n.jarak === 1);
  const cincin2 = simpul.filter((n) => n.jarak >= 2);

  /** @param {number} n @param {number} dasar */
  const radius = (n, dasar) => Math.max(dasar, (n * (lebarSimpul + 18)) / (2 * Math.PI));
  const r1 = cincin1.length ? radius(cincin1.length, 150) : 0;
  const r2 = cincin2.length ? Math.max(r1 + 120, radius(cincin2.length, r1 + 120)) : 0;
  const rMaks = r2 || r1;
  const lebar = Math.max(560, 2 * (rMaks + lebarSimpul / 2 + 24));
  const tinggi = Math.max(320, 2 * (rMaks + tinggiSimpul / 2 + 24));
  const cx = lebar / 2;
  const cy = tinggi / 2;

  /** @type {Map<string, { x: number, y: number, sudut: number }>} */
  const posisi = new Map([[pusat, { x: cx, y: cy, sudut: 0 }]]);

  cincin1.forEach((n, i) => {
    const sudut = -Math.PI / 2 + (2 * Math.PI * i) / cincin1.length;
    posisi.set(n.uri, { x: cx + r1 * Math.cos(sudut), y: cy + r1 * Math.sin(sudut), sudut });
  });

  // Cincin kedua mengikuti sudut induknya agar garis tidak saling silang berlebihan.
  /** @param {string} uri */
  const sudutInduk = (uri) => {
    const sudut = sisi
      .flatMap((s) => (s.dari === uri ? [s.ke] : s.ke === uri ? [s.dari] : []))
      .map((u) => posisi.get(u))
      .filter((p) => p !== undefined && p.sudut !== undefined && cincin1.some((c) => posisi.get(c.uri) === p))
      .map((p) => /** @type {{ sudut: number }} */ (p).sudut);
    return sudut.length ? sudut.reduce((a, b) => a + b, 0) / sudut.length : 0;
  };
  const urut2 = [...cincin2].sort((a, b) => sudutInduk(a.uri) - sudutInduk(b.uri));
  urut2.forEach((n, i) => {
    const sudut = -Math.PI / 2 + (2 * Math.PI * (i + 0.5)) / urut2.length;
    posisi.set(n.uri, { x: cx + r2 * Math.cos(sudut), y: cy + r2 * Math.sin(sudut), sudut });
  });

  return { lebar, tinggi, posisi, lebarSimpul, tinggiSimpul };
}

// --- Teks jawaban model -------------------------------------------------------

/** @param {string} baris @returns {Sebaris[]} */
function sebaris(baris) {
  /** @type {Sebaris[]} */
  const hasil = [];
  let tebal = false;
  for (const bagian of baris.split(/(\*\*|__)/)) {
    if (bagian === "**" || bagian === "__") tebal = !tebal;
    else if (bagian) hasil.push({ teks: bagian, tebal });
  }
  return hasil;
}

/**
 * Uraikan jawaban model (Markdown ringan) menjadi blok yang aman dirender:
 * paragraf, daftar bernomor/bebas, dan teks **tebal**. Selebihnya dianggap teks biasa.
 * @param {string} teks
 * @returns {BlokTeks[]}
 */
export function bacaTeksModel(teks) {
  /** @type {BlokTeks[]} */
  const blok = [];
  /** @type {string[]} */
  let paragraf = [];
  /** @type {{ tipe: "ul" | "ol", butir: Sebaris[][] } | null} */
  let daftar = null;

  const tutupParagraf = () => {
    if (paragraf.length) blok.push({ tipe: "p", isi: sebaris(paragraf.join(" ")) });
    paragraf = [];
  };
  const tutupDaftar = () => {
    if (daftar) blok.push(daftar);
    daftar = null;
  };

  for (const mentah of teks.replace(/\r\n?/g, "\n").split("\n")) {
    const baris = mentah.trim();
    if (!baris) {
      tutupParagraf();
      tutupDaftar();
      continue;
    }
    const judul = /^#{1,6}\s+(.*)$/.exec(baris);
    const bebas = /^[-*•]\s+(.*)$/.exec(baris);
    const bernomor = /^\d+[.)]\s+(.*)$/.exec(baris);
    if (judul) {
      tutupParagraf();
      tutupDaftar();
      blok.push({ tipe: "p", isi: [{ teks: judul[1].replace(/\*\*|__/g, ""), tebal: true }] });
    } else if (bebas || bernomor) {
      tutupParagraf();
      const tipe = bebas ? "ul" : "ol";
      if (daftar && daftar.tipe !== tipe) tutupDaftar();
      daftar ??= { tipe, butir: [] };
      daftar.butir.push(sebaris((bebas ?? bernomor)?.[1] ?? ""));
    } else {
      tutupDaftar();
      paragraf.push(baris);
    }
  }
  tutupParagraf();
  tutupDaftar();
  return blok;
}

/** Teks polos dari blok, untuk disalin. @param {BlokTeks[]} blok */
export function blokKeTeks(blok) {
  return blok
    .map((b) =>
      b.tipe === "p"
        ? b.isi.map((x) => x.teks).join("")
        : b.butir.map((it, i) => `${b.tipe === "ol" ? `${i + 1}.` : "-"} ${it.map((x) => x.teks).join("")}`).join("\n"),
    )
    .join("\n\n");
}
