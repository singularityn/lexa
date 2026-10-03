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

/** Rapikan kolom-kolom `laws` yang bisa berisi sisa data buruk sebelum dikirim ke klien. */
export function rapikanLaw<T extends { instansi: string | null }>(law: T): T {
  const instansi = rapikanInstansi(law.instansi);
  return instansi === law.instansi ? law : { ...law, instansi };
}
