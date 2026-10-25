// @ts-check
/**
 * Rumus murni penampil PDF (tanpa DOM, supaya bisa diuji): gestur zoom (cubitan dua jari, ketuk dua kali) dan pencarian halaman
 * pada letak gulir. Pemasangan pendengar sentuh dan roda ada di pdfGestur.js.
 */

/** Nilai dijepit ke [min, maks]. @param {number} nilai @param {number} min @param {number} maks */
export function jepit(nilai, min, maks) {
  return Math.min(maks, Math.max(min, nilai));
}

/** Jarak antara dua titik sentuh. @param {{ clientX: number, clientY: number }} a @param {{ clientX: number, clientY: number }} b */
export function jarakSentuh(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * Perbesaran dari sebuah cubitan, dijepit supaya zoom akhirnya (zoomAwal x rasio) tetap di [min, maks].
 * @param {number} jarakAwal
 * @param {number} jarakKini
 * @param {number} zoomAwal
 * @param {number} min
 * @param {number} maks
 */
export function rasioCubit(jarakAwal, jarakKini, zoomAwal, min, maks) {
  if (!(jarakAwal > 0) || !(zoomAwal > 0)) return 1;
  return jepit(jarakKini / jarakAwal, min / zoomAwal, maks / zoomAwal);
}

/**
 * Apakah dua ketukan berurutan adalah ketuk-dua-kali: cukup dekat waktunya dan letaknya.
 * @param {{ waktu: number, x: number, y: number }} a
 * @param {{ waktu: number, x: number, y: number }} b
 * @param {{ jedaMs?: number, jarakPx?: number }} [o]
 */
export function ketukDua(a, b, { jedaMs = 320, jarakPx = 32 } = {}) {
  return b.waktu - a.waktu <= jedaMs && b.waktu > a.waktu && Math.hypot(a.x - b.x, a.y - b.y) <= jarakPx;
}

/**
 * Indeks pertama (0..n-1) yang tepi bawahnya belum di atas `y`; n bila semua halaman sudah di atas `y`. `bawah(i)` harus naik
 * menurut i (halaman tersusun dari atas ke bawah). Pencarian biner: naskah ratusan halaman tak perlu dipindai satu per satu
 * setiap kali digulir.
 * @param {number} n
 * @param {(i: number) => number} bawah
 * @param {number} y
 */
export function indeksPertamaDi(n, bawah, y) {
  let rendah = 0;
  let tinggi = n;
  while (rendah < tinggi) {
    const tengah = (rendah + tinggi) >> 1;
    if (bawah(tengah) >= y) tinggi = tengah;
    else rendah = tengah + 1;
  }
  return rendah;
}

/**
 * Halaman yang paling banyak terlihat di layar dan halaman-halaman yang dekat dengannya (untuk digambar).
 * Halaman terlihat sebagian besar menjadi "halaman saat ini"; bila sama, yang lebih awal. Gulir yang tak terjangkau (di luar isi)
 * tidak menghasilkan halaman.
 * @param {number} n jumlah halaman
 * @param {(i: number) => number} atas tepi atas halaman ke-i (0-based) dalam isi yang tergulir
 * @param {(i: number) => number} bawah tepi bawahnya
 * @param {number} gulir letak gulir atas
 * @param {number} tinggi tinggi bagian yang terlihat
 * @param {number} margin jarak di luar layar yang masih dianggap "dekat"
 * @returns {{ utama: number, dekat: number[] }} nomor halaman (mulai 1); utama 0 bila tak ada halaman yang terlihat
 */
export function halamanTerlihat(n, atas, bawah, gulir, tinggi, margin) {
  /** @type {number[]} */
  const dekat = [];
  let utama = 0;
  let luasUtama = 0;
  for (let i = indeksPertamaDi(n, bawah, gulir - margin); i < n; i++) {
    if (atas(i) > gulir + tinggi + margin) break;
    dekat.push(i + 1);
    const tampak = Math.min(bawah(i), gulir + tinggi) - Math.max(atas(i), gulir);
    if (tampak > luasUtama) {
      luasUtama = tampak;
      utama = i + 1;
    }
  }
  return { utama, dekat };
}
