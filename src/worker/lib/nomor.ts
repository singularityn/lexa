/**
 * Penormalan nomor peraturan untuk membandingkan sitasi lintas sumber (BPK, peraturan.go.id, dan katalog lama yang masih tersimpan).
 *
 * Satu peraturan ditulis berbeda-beda menurut sumbernya, dan D1 produksi menyimpan semuanya apa adanya:
 *   - PP 1/2022 ada dua baris, nomor "01" dan "1";
 *   - Tap MPR XVI/MPR/1998 ada tiga baris, nomor "XVI/MPR/1998" (BPK), "XVI-MPR-1998" dan "xvi-mpr-1998" (katalog lama);
 *   - Tap MPR I/MPR/2003 di BPK hanya bernomor "I" (tahunnya kolom tersendiri).
 * Indeks unik laws(jenis, nomor, tahun) memeriksa teks nomor apa adanya, jadi tak menolak duplikat semacam itu, dan
 * pencocokan sitasi yang membandingkan teks mentah melewatkan peraturan yang sama. Yang dibandingkan di sini adalah
 * KUNCI: nomor yang sudah dinormalkan menurut jenisnya.
 */

/** Hanya huruf dan angka, huruf kecil: "XVI/MPR/1998" -> "xvimpr1998". */
export const ringkasNomor = (nomor: string): string => nomor.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Angka Romawi yang sah (sampai MMMCMXCIX), huruf kecil. */
const POLA_ROMAWI = /^(?=[ivxlcdm])m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/;

export interface NomorTapMpr {
  romawi: string;
  /** "mpr" (sesudah 1973) atau "mprs" (sementara, 1960-1968); null bila nomornya hanya angka Romawi ("I"). */
  badan: "mpr" | "mprs" | null;
  /** Tahun yang menempel pada nomor ("XVI/MPR/1998"); null bila nomornya tak memuatnya. */
  tahun: number | null;
}

/**
 * Urai nomor Tap MPR dalam penulisan apa pun: "XVI/MPR/1998", "xvi-mpr-1998", "mprxxiv-mprs-1966", "xvimpr1998"
 * (slug BPK membuang garis miringnya), atau "I" saja. Null bila bukan angka Romawi (nomor tak dikenal).
 */
export function uraiNomorTapMpr(mentah: string): NomorTapMpr | null {
  const s = ringkasNomor(mentah);
  // Lazy: huruf "m" bisa bagian angka Romawi ("xlm") dan awal "mpr"; angka Romawi diambil sependek yang membuat sisanya sah.
  const m = /^(?:mpr)?([ivxlcdm]+?)(mprs?)?(\d{4})?$/.exec(s);
  if (!m || !POLA_ROMAWI.test(m[1])) return null;
  return { romawi: m[1], badan: (m[2] as "mpr" | "mprs" | undefined) ?? null, tahun: m[3] ? Number(m[3]) : null };
}

/** Kunci pembanding sebuah sitasi. `inti` adalah nomor yang sudah dinormalkan menurut jenisnya. */
export interface KunciSitasi {
  jenis: string;
  tahun: number;
  inti: string;
  /** Hanya Tap MPR: "mpr" / "mprs" bila nomornya menyebutkan; null artinya tak diketahui (cocok dengan keduanya). */
  badan: string | null;
}

/**
 * Kunci pembanding untuk (jenis, nomor, tahun).
 *  - Tap MPR: angka Romawi dan badan ("xvi" + "mpr"); penulisan pemisah dan tahun yang menempel diabaikan.
 *  - lainnya: huruf dan angka saja, nol di depan dibuang ("01" = "1", "5 A" = "5a").
 */
export function kunciSitasi(jenis: string, nomor: string, tahun: number): KunciSitasi {
  if (jenis === "TAP_MPR") {
    const tap = uraiNomorTapMpr(nomor);
    if (tap) return { jenis, tahun, inti: tap.romawi, badan: tap.badan };
  }
  return { jenis, tahun, inti: ringkasNomor(nomor).replace(/^0+(?=[0-9])/, ""), badan: null };
}

/** Dua kunci menunjuk peraturan yang sama. Badan Tap MPR yang tak diketahui cocok dengan badan apa pun. */
export function samaSitasi(a: KunciSitasi, b: KunciSitasi): boolean {
  return a.jenis === b.jenis && a.tahun === b.tahun && a.inti === b.inti && (a.badan === b.badan || a.badan === null || b.badan === null);
}

/**
 * Nomor untuk baris BARU yang berasal dari BPK, selaras dengan penulisan baris yang sudah ada (konvensi katalog lama) supaya tak menambah ragam:
 * Tap MPR "XVI/MPR/1998" -> "xvi-mpr-1998"; nomor lain dirapikan spasinya dan nol di depannya dibuang.
 */
export function nomorKanonik(jenis: string, nomor: string): string {
  const bersih = nomor.trim();
  if (jenis === "TAP_MPR") {
    const tap = uraiNomorTapMpr(bersih);
    if (tap?.badan && tap.tahun) return `${tap.romawi}-${tap.badan}-${tap.tahun}`;
    return bersih.replace(/[\s/\\]+/g, "-");
  }
  return bersih.replace(/\s+/g, "").replace(/^0+(?=[0-9])/, "");
}
