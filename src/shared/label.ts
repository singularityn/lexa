/**
 * Label sitasi peraturan untuk ditampilkan: "UU 13/2003", "POJK 48/POJK.04/2016".
 *
 * POJK terbitan lama tersimpan dengan nomor slug "48-pojk-04-2016" (lihat laws.nomor);
 * penulisan resminya "48/POJK.04/2016", sehingga tahun tidak perlu diulang. UUD bernomor "1945" atau "1945/P4"
 * ditulis "UUD 1945" dan "UUD 1945 Perubahan 4".
 * Antarmuka (public/js/format.js) punya salinan fungsi yang sama dan dijaga lewat
 * test/web.test.ts; ubah keduanya bersamaan.
 */

const POLA_SLUG_POJK = /^(\d+)-pojk-(\d{2})-(\d{4})$/i;

/** UUD di pasal.id: nomor "1945" untuk naskah asli dan "1945/P4" untuk Perubahan Keempat (tahunnya sama, 1945). */
export const POLA_NOMOR_UUD = /^(\d{4})(?:\/P(\d+))?$/i;

/** Tap MPR bernomor slug di pasal.id: "xvi-mpr-1998", "i-mprs-1960", "mprxxiv-mprs-1966" (penulisan resminya "XVI/MPR/1998"). */
export const POLA_SLUG_TAP_MPR = /^(?:mpr)?([ivxlcdm]+)[-/](mprs?)[-/](\d{4})$/i;

/** "13/2003"; untuk POJK bernomor slug "48/POJK.04/2016"; UUD "1945" dan "1945 Perubahan 4"; Tap MPR "XVI/MPR/1998". */
export function nomorTahun(jenis: string, nomor: string, tahun: number): string {
  const uud = jenis === "UUD" ? POLA_NOMOR_UUD.exec(nomor) : null;
  if (uud) return uud[2] ? `${uud[1]} Perubahan ${uud[2]}` : uud[1];
  const tap = jenis === "TAP_MPR" ? POLA_SLUG_TAP_MPR.exec(nomor) : null;
  if (tap) return `${tap[1].toUpperCase()}/${tap[2].toUpperCase()}/${tap[3]}`;
  const m = jenis === "POJK" ? POLA_SLUG_POJK.exec(nomor) : null;
  return m ? `${m[1]}/POJK.${m[2]}/${m[3]}` : `${nomor}/${tahun}`;
}

/** "UU 13/2003" */
export function labelSitasi(l: { jenis: string; nomor: string; tahun: number }): string {
  return `${l.jenis} ${nomorTahun(l.jenis, l.nomor, l.tahun)}`;
}

/**
 * Nama instansi untuk ditampilkan.
 *
 * Nilai tersimpan bisa "[object Object]" (galat ingest lama; lihat keTeks di lib/pasal.ts), kosong,
 * atau tajuk entri BPK yang berawalan negara: "Indonesia, Pemerintah Pusat". "Indonesia" saja tidak
 * memberi informasi apa pun (semua peraturan nasional), sehingga dianggap kosong.
 */
export function rapikanInstansi(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  if (s === "" || /^\[object \w+\]$/i.test(s)) return null;
  const tanpaNegara = s.replace(/^Indonesia\s*,\s*/i, "").trim();
  return tanpaNegara === "" || /^indonesia$/i.test(tanpaNegara) ? null : tanpaNegara;
}

const POLA_NOMOR_PASAL_OCR = /^(\d[\dO]*)([A-Z]{0,2})$/;

/**
 * Nomor pasal dengan salah baca OCR yang lazim dibereskan: angka nol terbaca huruf O ("1O" untuk 10, "12O" untuk 120).
 * Pasal sisipan memakai huruf A, B, C, ... tetapi tidak pernah O, jadi "O" sesudah angka pasti nol. Nomor lain
 * ("5A", "II", "Umum") tidak berubah. Di produksi 154 baris pasal pada 42 peraturan terkena (KUHP, Cipta Kerja,
 * Pelindungan Data Pribadi, ...). Antarmuka (public/js/format.js) punya salinan fungsi yang sama, dijaga
 * test/web.test.ts; ubah keduanya bersamaan.
 */
export function rapikanNomorPasal(nomor: string): string {
  const m = POLA_NOMOR_PASAL_OCR.exec(nomor);
  return m && m[1].includes("O") ? m[1].replace(/O/g, "0") + m[2] : nomor;
}

/** Rapikan nomor pasal pada satu baris `articles` sebelum dikirim ke klien; objek yang sama bila tak ada yang berubah. */
export function rapikanArtikel<T extends { nomor_pasal: string }>(a: T): T {
  const nomor = rapikanNomorPasal(a.nomor_pasal);
  return nomor === a.nomor_pasal ? a : { ...a, nomor_pasal: nomor };
}

/** Rapikan kolom-kolom `laws` yang bisa berisi sisa data buruk sebelum dikirim ke klien. */
export function rapikanLaw<T extends { instansi: string | null }>(law: T): T {
  const instansi = rapikanInstansi(law.instansi);
  return instansi === law.instansi ? law : { ...law, instansi };
}
