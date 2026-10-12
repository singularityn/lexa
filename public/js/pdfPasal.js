// @ts-check
/**
 * Mengenali judul pasal pada teks halaman PDF, supaya "Lihat di PDF" bisa membuka halaman tempat sebuah pasal dimulai.
 *
 * Lexa tidak menyimpan nomor halaman per pasal (teks pasal berasal dari konversi PDF yang membuang pembagian halaman).
 * Karena itu halamannya dicari di PDF-nya sendiri, di peramban pembaca: teks tiap halaman (lapisan teks PDF) dipindai
 * mencari baris yang hanya berisi judul pasal ("Pasal 156"). Fungsi di sini murni (tanpa DOM, tanpa PDF.js) agar bisa
 * diuji; pemindaiannya ada di komponen/penampilPdf.js.
 */

import { rapikanNomorPasal } from "./format.js";

/**
 * Baris yang hanya berisi judul pasal: "Pasal 156", "PASAL 5A", "Pasal 5 A", "Pasal I" (undang-undang perubahan memakai
 * angka Romawi). "Pasal 156 ayat (2)" di tengah kalimat BUKAN judul: sebuah judul berdiri sendiri di satu baris.
 */
const POLA_JUDUL_PASAL = /^pasal\s+(\d{1,4}(?:\s?[A-Za-z])?|[IVXLC]{1,6})$/i;

/**
 * Nomor pasal dari satu baris yang hanya berisi judul pasal, dirapikan seperti nomor di D1 ("1O" -> "10", spasi dan
 * huruf kecil pada akhiran dibuang: "5 a" -> "5A"); null bila baris itu bukan judul pasal.
 * @param {string} baris
 * @returns {string | null}
 */
export function nomorDariJudulPasal(baris) {
  const m = POLA_JUDUL_PASAL.exec(baris.replace(/\s+/g, " ").trim());
  if (!m) return null;
  const mentah = m[1].replace(/\s/g, "");
  // Angka Romawi tetap huruf besar; "5a" menjadi "5A".
  return rapikanNomorPasal(mentah.toUpperCase());
}

/**
 * Pecah item teks satu halaman (`TextContent.items` PDF.js) menjadi baris. Item bertanda `hasEOL` mengakhiri baris;
 * item penanda isi (tanpa `str`) dilewati.
 * @param {ReadonlyArray<{ str?: string, hasEOL?: boolean }>} item
 * @returns {string[]}
 */
export function barisDariItem(item) {
  /** @type {string[]} */
  const baris = [];
  let kini = "";
  for (const it of item) {
    if (typeof it.str !== "string") continue;
    kini += it.str;
    if (it.hasEOL) {
      baris.push(kini);
      kini = "";
    }
  }
  if (kini) baris.push(kini);
  return baris.map((b) => b.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/**
 * Nomor pasal yang judulnya tampak di halaman ini, menurut urutan kemunculan. Sebuah judul pasal sering menjadi item
 * tersendiri tanpa tanda akhir baris (bergantung pada pembuat PDF-nya), jadi tiap item juga diperiksa sebagai baris.
 * @param {ReadonlyArray<{ str?: string, hasEOL?: boolean }>} item
 * @returns {string[]}
 */
export function pasalDiHalaman(item) {
  const kandidat = [...barisDariItem(item), ...item.map((it) => (typeof it.str === "string" ? it.str.trim() : ""))];
  /** @type {string[]} */
  const hasil = [];
  for (const baris of kandidat) {
    const nomor = baris ? nomorDariJudulPasal(baris) : null;
    if (nomor && !hasil.includes(nomor)) hasil.push(nomor);
  }
  return hasil;
}

/**
 * Catat halaman pertama tempat tiap pasal muncul. Kemunculan pertama dipertahankan: penjelasan pasal demi pasal di
 * belakang naskah memakai ulang nomor yang sama, dan yang dicari adalah batang tubuhnya.
 * @param {Map<string, number>} indeks diubah di tempat
 * @param {number} halaman nomor halaman (mulai 1)
 * @param {ReadonlyArray<{ str?: string, hasEOL?: boolean }>} item
 * @returns {number} jumlah pasal baru yang tercatat
 */
export function catatPasalHalaman(indeks, halaman, item) {
  let baru = 0;
  for (const nomor of pasalDiHalaman(item)) {
    if (!indeks.has(nomor)) {
      indeks.set(nomor, halaman);
      baru++;
    }
  }
  return baru;
}
