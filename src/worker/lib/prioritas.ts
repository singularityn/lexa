/**
 * Urutan prioritas panen: peraturan yang paling dicari lebih dulu, yaitu menurut jenis (urutan `CAKUPAN_BAWAAN`:
 * UUD, Tap MPR, UU, Perppu, PP; jenis lain paling akhir), dan di dalam jenis yang terbaru lebih dulu.
 *
 * Dihitung langsung dari kolom `jenis` dan `tahun`, tidak disimpan. Dengan begitu baris yang dibuat jalur mana pun
 * (manifest, tautan daftar BPK, impor lama) otomatis ikut urutan yang sama, dan mengubah urutan tak perlu menulis
 * ulang ribuan baris. Pengganti kolom `laws.isi_giliran` (urutan antrean sumber lama; kolomnya masih ada di skema tetapi tak dipakai lagi).
 */

import { CAKUPAN_BAWAAN } from "../../shared/cakupan";

/** Ekspresi SQL peringkat: kecil dikerjakan dulu. `awalan` adalah alias tabel, mis. "l.". */
export function sqlPrioritas(awalan = ""): string {
  const peringkat = CAKUPAN_BAWAAN.map((jenis, i) => `WHEN '${jenis}' THEN ${i}`).join(" ");
  return `(CASE ${awalan}jenis ${peringkat} ELSE 9 END) * 10000 + (9999 - MIN(MAX(${awalan}tahun, 0), 9999))`;
}
