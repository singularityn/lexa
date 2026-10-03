/**
 * Label sitasi peraturan untuk ditampilkan: "UU 13/2003", "POJK 48/POJK.04/2016".
 *
 * POJK terbitan lama tersimpan dengan nomor slug "48-pojk-04-2016" (lihat laws.nomor);
 * penulisan resminya "48/POJK.04/2016", sehingga tahun tidak perlu diulang.
 * Antarmuka (public/js/format.js) punya salinan fungsi yang sama dan dijaga lewat
 * test/web.test.ts; ubah keduanya bersamaan.
 */

const POLA_SLUG_POJK = /^(\d+)-pojk-(\d{2})-(\d{4})$/i;

/** "13/2003"; untuk POJK bernomor slug "48/POJK.04/2016". */
export function nomorTahun(jenis: string, nomor: string, tahun: number): string {
  const m = jenis === "POJK" ? POLA_SLUG_POJK.exec(nomor) : null;
  return m ? `${m[1]}/POJK.${m[2]}/${m[3]}` : `${nomor}/${tahun}`;
}

/** "UU 13/2003" */
export function labelSitasi(l: { jenis: string; nomor: string; tahun: number }): string {
  return `${l.jenis} ${nomorTahun(l.jenis, l.nomor, l.tahun)}`;
}
