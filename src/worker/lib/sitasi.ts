/**
 * Pengenalan sitasi peraturan dari teks bebas: "UU 13/2003", "UU RI No. 13 Tahun 2003",
 * "Peraturan Pemerintah Republik Indonesia Nomor 35 Tahun 2021", "Perpu 2/2022",
 * "POJK 48/POJK.04/2016".
 *
 * Tata bahasanya sengaja ketat: nama jenis harus langsung diikuti nomor dan tahun. Salah
 * mengenali kueri biasa sebagai sitasi lebih merugikan daripada melewatkan sitasi, karena
 * hasil sitasi diberi bobot jauh di atas pencarian teks.
 */

export interface Sitasi {
  /** Kode jenis seperti di tabel `laws.jenis`: "UU", "PP", "PERPPU", "POJK", ... */
  jenis: string;
  nomor: string;
  tahun: number;
  /** Kode sektor pada penomoran resmi POJK ("04" pada 48/POJK.04/2016); jenis lain tidak punya. */
  sub?: string;
}

/**
 * Nama jenis (panjang maupun singkatan) -> kode jenis. URUTAN PENTING: pola yang lebih
 * panjang harus lebih dulu agar "peraturan pemerintah pengganti undang-undang" tidak terbaca
 * sebagai "peraturan pemerintah" atau "undang-undang".
 *
 * `nama`: nama kementerian atau daerah boleh terselip antara nama jenis dan nomor
 * ("Peraturan Menteri Ketenagakerjaan Nomor 5 Tahun 2020", "Perda DKI Jakarta Nomor 8 Tahun 2007").
 */
const NAMA_JENIS: ReadonlyArray<{ jenis: string; pola: string; nama?: true }> = [
  { jenis: "PERPPU", pola: String.raw`peraturan\s+pemerintah\s+pengganti\s+undang[\s-]*undang|perppu|perpu` },
  { jenis: "UU", pola: String.raw`undang[\s-]*undang|uu` },
  { jenis: "PP", pola: String.raw`peraturan\s+pemerintah|pp` },
  { jenis: "PERPRES", pola: String.raw`peraturan\s+presiden|perpres` },
  { jenis: "KEPPRES", pola: String.raw`keputusan\s+presiden|keppres` },
  { jenis: "INPRES", pola: String.raw`instruksi\s+presiden|inpres` },
  { jenis: "PERMEN", pola: String.raw`peraturan\s+menteri|permen`, nama: true },
  { jenis: "KEPMEN", pola: String.raw`keputusan\s+menteri|kepmen`, nama: true },
  { jenis: "POJK", pola: String.raw`peraturan\s+otoritas\s+jasa\s+keuangan|peraturan\s+ojk|pojk` },
  { jenis: "PBI", pola: String.raw`peraturan\s+bank\s+indonesia|pbi` },
  { jenis: "PERDA_PROV", pola: String.raw`peraturan\s+daerah|perda`, nama: true },
  { jenis: "PERGUB", pola: String.raw`peraturan\s+gubernur|pergub`, nama: true },
  { jenis: "PERBUP", pola: String.raw`peraturan\s+bupati|perbup`, nama: true },
  { jenis: "PERWALI", pola: String.raw`peraturan\s+wali\s*kota|perwali`, nama: true },
];

/** Satu alternatif bergrup per jenis (j0, j1, ...): grup yang terisi menunjukkan jenisnya. */
const POLA_JENIS = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${NAMA_JENIS.map((j, i) => `(?<j${i}>${j.pola})`).join("|")})(?![\\p{L}\\p{N}])`,
  "giu",
);

/**
 * Yang boleh menyusul nama jenis sebelum nomor: singkatan dalam kurung ("(UU)", "(Perpu)"),
 * "Republik Indonesia"/"RI", lalu "Nomor"/"No."; setelah nomor: "/", "Tahun", "Th.", atau spasi.
 */
const EKOR = String.raw`(?:\s*\([a-z]{2,6}\))?(?:\s+(?:republik\s+indonesia|ri))?(?:\s*(?:nomor|no)\.?)?\s*(\d+[a-z]?)(?:\s*\/\s*|\s+tahun\s+|\s+thn?\.?\s+|\s+)(\d{4})(?!\d)`;
const POLA_EKOR = new RegExp(EKOR, "iuy");
/** Seperti POLA_EKOR, dengan nama kementerian/daerah (maksimal 8 kata) sebelum nomor. */
const POLA_EKOR_NAMA = new RegExp(String.raw`(?:\s+\p{L}+){0,8}?` + EKOR, "iuy");

/** Penomoran resmi POJK: "48/POJK.04/2016" (dengan atau tanpa nama jenis di depannya). */
const POLA_POJK_RESMI = /(?<![\p{L}\p{N}/])(\d+)\s*\/\s*pojk\.(\d{2})\s*\/\s*(\d{4})(?!\d)/iu;

const TAHUN_MIN = 1900;
const TAHUN_MAKS = 2100;

const tahunMasuk = (tahun: number) => tahun >= TAHUN_MIN && tahun <= TAHUN_MAKS;

/** Sitasi pertama yang dikenali dalam `teks` beserta rentang teks yang dicakupnya (awal inklusif, akhir eksklusif). */
function cocokSitasi(teks: string): { sitasi: Sitasi; awal: number; akhir: number } | null {
  const resmi = POLA_POJK_RESMI.exec(teks);
  if (resmi && tahunMasuk(Number(resmi[3]))) {
    return {
      sitasi: { jenis: "POJK", nomor: resmi[1], tahun: Number(resmi[3]), sub: resmi[2] },
      awal: resmi.index,
      akhir: resmi.index + resmi[0].length,
    };
  }

  for (const m of teks.matchAll(POLA_JENIS)) {
    const indeks = NAMA_JENIS.findIndex((_, i) => m.groups?.[`j${i}`] !== undefined);
    const def = NAMA_JENIS[indeks];
    if (!def) continue;

    const ekor = def.nama ? POLA_EKOR_NAMA : POLA_EKOR;
    ekor.lastIndex = (m.index ?? 0) + m[0].length;
    const t = ekor.exec(teks);
    if (!t || !tahunMasuk(Number(t[2]))) continue;

    return {
      sitasi: { jenis: def.jenis, nomor: t[1], tahun: Number(t[2]) },
      awal: m.index ?? 0,
      akhir: t.index + t[0].length,
    };
  }
  return null;
}

/** Sitasi pertama yang dikenali dalam `teks`, atau null. */
export function uraiSitasi(teks: string): Sitasi | null {
  return cocokSitasi(teks)?.sitasi ?? null;
}

/**
 * Apakah seluruh `teks` hanyalah sebuah sitasi ("UU 13/2003", "Peraturan Pemerintah Nomor 35 Tahun 2021", kadang
 * berkutip), tanpa kata lain yang menyatakan topik ("UU 13/2003 pesangon")? Pencarian memakai ini untuk tidak mencari
 * kata dan makna bagi kueri yang jelas-jelas menunjuk satu dokumen: "13" dan "2003" hanya angka biasa di jutaan pasal.
 */
export function hanyaSitasi(teks: string): boolean {
  const c = cocokSitasi(teks);
  if (!c) return false;
  return `${teks.slice(0, c.awal)} ${teks.slice(c.akhir)}`.replace(/[^\p{L}\p{N}]+/gu, "") === "";
}
