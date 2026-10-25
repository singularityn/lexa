/**
 * Peta pasal ke halaman PDF: di halaman berapa tiap pasal dimulai.
 *
 * Konversi PDF (Workers AI `toMarkdown`) dan bacaan Gemini sama-sama menyisipkan penanda "### Page n" di batas halaman, tetapi
 * pengurai pasal (`uraikanPasal`) bekerja pada teks yang sudah disambung dan tak membawa nomor halaman. Akibatnya "Lihat di PDF"
 * dulu memindai PDF di peramban tiap pembaca dan tak bisa bekerja pada pindaian. Di sini nomor itu dipulihkan dari penanda yang
 * sama, tanpa mengubah satu pun hasil pengurai: judul pasal dicari lagi di teks tiap halaman (yang sudah dibersihkan) dan dicocokkan
 * dengan urutan pasal yang SUDAH terurai. Pencocokan berurutan itulah yang menjaganya tetap benar: rujukan silang yang kebetulan
 * diawali "Pasal 5" di tengah halaman tak dianggap judul, karena yang dicari hanya nomor berikutnya menurut hasil pengurai.
 *
 * Hasilnya `null` untuk semua pasal bila naskah tak punya penanda halaman (teks lama, atau teks polos); pembaca lalu jatuh ke
 * pemindaian PDF di peramban. Pasal yang judulnya tak ditemukan di halaman mana pun mengikuti halaman pasal sebelumnya.
 */

import { bersihkanBaris, nomorJudulPasal, pisahkanJudulMenempel, RE_PASAL_DEMI_PASAL, RE_PENJELASAN } from "./bpk";
import { bersihkanPerHalaman } from "./halaman";

/**
 * Berapa pasal ke depan (dari yang diharapkan berikutnya) yang boleh dilompati. Judul yang terlewat oleh penguraian ulang tidak ada,
 * tetapi judul yang dibaca ganda atau salah dibaca OCR bisa membuat satu dua pasal tak punya judul di teks halamannya.
 */
const JENDELA = 6;

/**
 * @param naskah teks mentah berpenanda halaman (isi `teks/<uri>.md`)
 * @param pasal hasil `uraikanPasal(naskah)`, menurut urutannya
 * @returns halaman PDF (mulai 1) tempat tiap baris `pasal` dimulai, sejajar dengan `pasal`; null bila tak diketahui
 */
export function petakanHalamanPasal(naskah: string, pasal: ReadonlyArray<{ nomor_pasal: string }>): Array<number | null> {
  const hasil: Array<number | null> = pasal.map(() => null);
  if (!pasal.length) return hasil;

  const halaman = bersihkanPerHalaman(naskah);
  if (!halaman.some((h) => h.nomor !== null)) return hasil;

  // Baris ayat satu pasal berurutan dan bernomor sama: satu entri per pasal.
  const urutan: Array<{ nomor: string; awal: number }> = [];
  pasal.forEach((p, i) => {
    if (urutan[urutan.length - 1]?.nomor !== p.nomor_pasal) urutan.push({ nomor: p.nomor_pasal, awal: i });
  });
  const dimulaiDi: Array<number | null> = urutan.map(() => null);

  let berikut = 0;
  // Bagian sebelum penanda pertama adalah halaman 1: konversi bawaan tak menandai halaman pertama.
  let sekarang = 1;
  badan: for (const h of halaman) {
    if (h.nomor !== null) sekarang = h.nomor;
    for (const baris of pisahkanJudulMenempel(h.teks).split("\n").map(bersihkanBaris)) {
      // Penjelasan memakai ulang nomor pasal; batang tubuh sudah selesai.
      if (RE_PENJELASAN.test(baris) || RE_PASAL_DEMI_PASAL.test(baris)) break badan;
      const nomor = nomorJudulPasal(baris);
      if (nomor === null) continue;
      for (let k = berikut; k < Math.min(urutan.length, berikut + JENDELA); k++) {
        if (urutan[k].nomor !== nomor) continue;
        dimulaiDi[k] = sekarang;
        berikut = k + 1;
        break;
      }
    }
  }

  let terakhir: number | null = null;
  urutan.forEach((u, k) => {
    if (dimulaiDi[k] !== null) terakhir = dimulaiDi[k];
    const akhir = k + 1 < urutan.length ? urutan[k + 1].awal : pasal.length;
    for (let i = u.awal; i < akhir; i++) hasil[i] = terakhir;
  });
  return hasil;
}
