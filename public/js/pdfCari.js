// @ts-check
/**
 * Pencarian teks di dalam PDF (penampil PDF): murni, tanpa DOM dan tanpa PDF.js, supaya bisa diuji. Pemindaian halaman dan
 * penandaan di lapisan teks ada di komponen/penampilPdf.js.
 *
 * Teks satu halaman disusun dari `TextContent.items` PDF.js: tiap item ditempel apa adanya, dan item berakhir baris (`hasEOL`)
 * disusul baris baru. Letak awal tiap item dicatat, sehingga kecocokan (rentang karakter di teks itu) bisa dikembalikan ke item
 * yang digambar sebagai satu `<span>` di lapisan teks. Pencarian tak peduli huruf besar-kecil, dan spasi pada kueri cocok dengan
 * spasi, baris baru, atau rangkaiannya di PDF ("pekerja perempuan" ditemukan walau "perempuan" ada di baris berikutnya).
 */

/** Paling banyak kecocokan yang dikumpulkan: kata sangat umum di naskah ratusan halaman tak perlu diurai seluruhnya. */
export const MAKS_KECOCOKAN = 1000;
/** Kueri yang lebih pendek dari ini tak dicari: terlalu banyak kecocokan yang tak berarti. */
export const MIN_KARAKTER = 2;

/**
 * @typedef {{ teks: string, awal: number[], bagian: string[], akhirBaris: boolean[] }} TeksHalaman
 *   `awal[i]`: letak awal item ke-i (hanya item bertulisan `str`) di `teks`; `bagian[i]`: tulisan item itu;
 *   `akhirBaris[i]`: item itu mengakhiri baris (`hasEOL`).
 */

/**
 * @param {ReadonlyArray<{ str?: string, hasEOL?: boolean }>} item
 * @returns {TeksHalaman}
 */
export function bangunTeksHalaman(item) {
  let teks = "";
  /** @type {number[]} */
  const awal = [];
  /** @type {string[]} */
  const bagian = [];
  /** @type {boolean[]} */
  const akhirBaris = [];
  for (const it of item) {
    if (typeof it.str !== "string") continue;
    awal.push(teks.length);
    bagian.push(it.str);
    akhirBaris.push(Boolean(it.hasEOL));
    teks += it.str;
    if (it.hasEOL) teks += "\n";
  }
  return { teks, awal, bagian, akhirBaris };
}

/**
 * Item teks halaman dalam bentuk yang dipahami pdfPasal.js (`str` dan `hasEOL`), untuk mengenali judul pasal tanpa membaca
 * ulang halaman dari PDF.
 * @param {TeksHalaman} halaman
 * @returns {Array<{ str: string, hasEOL: boolean }>}
 */
export function itemDariTeks(halaman) {
  return halaman.bagian.map((str, i) => ({ str, hasEOL: halaman.akhirBaris[i] }));
}

/** @param {string} t */
const lolos = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Pola pencarian dari kueri: tanpa huruf besar-kecil, spasi menjadi `\s+`. null bila kueri terlalu pendek.
 * @param {string} kueri
 * @returns {RegExp | null}
 */
export function polaCari(kueri) {
  const kata = kueri.trim().split(/\s+/).filter(Boolean);
  if (kata.join(" ").length < MIN_KARAKTER) return null;
  return new RegExp(kata.map(lolos).join("\\s+"), "giu");
}

/**
 * Semua kecocokan pada satu halaman, menurut urutannya.
 * @param {TeksHalaman} halaman
 * @param {RegExp} pola hasil `polaCari`
 * @param {number} [maks]
 * @returns {Array<{ mulai: number, akhir: number }>} rentang karakter di `halaman.teks`
 */
export function cariDiHalaman(halaman, pola, maks = MAKS_KECOCOKAN) {
  /** @type {Array<{ mulai: number, akhir: number }>} */
  const hasil = [];
  pola.lastIndex = 0;
  for (const m of halaman.teks.matchAll(pola)) {
    if (m[0].length === 0) continue;
    const mulai = m.index ?? 0;
    hasil.push({ mulai, akhir: mulai + m[0].length });
    if (hasil.length >= maks) break;
  }
  return hasil;
}

/**
 * Indeks item yang memuat karakter di `letak` (pencarian biner pada letak awal tiap item); -1 bila tak ada item.
 * @param {number[]} awal
 * @param {number} letak
 */
export function itemDiLetak(awal, letak) {
  if (!awal.length || letak < 0) return -1;
  let rendah = 0;
  let tinggi = awal.length - 1;
  while (rendah < tinggi) {
    const tengah = (rendah + tinggi + 1) >> 1;
    if (awal[tengah] <= letak) rendah = tengah;
    else tinggi = tengah - 1;
  }
  return rendah;
}

/**
 * Rentang sebuah kecocokan dalam bentuk item dan karakter di dalam item itu, untuk penandaan di lapisan teks.
 * `sampai` bersifat eksklusif. Baris baru yang ditambahkan sesudah item berakhir baris tak ikut ditandai.
 * @param {TeksHalaman} halaman
 * @param {{ mulai: number, akhir: number }} cocok
 * @returns {{ itemAwal: number, dari: number, itemAkhir: number, sampai: number } | null}
 */
export function rentangItem(halaman, cocok) {
  const itemAwal = itemDiLetak(halaman.awal, cocok.mulai);
  const itemAkhir = itemDiLetak(halaman.awal, cocok.akhir - 1);
  if (itemAwal < 0 || itemAkhir < 0) return null;
  const dari = Math.min(cocok.mulai - halaman.awal[itemAwal], halaman.bagian[itemAwal].length);
  const sampai = Math.min(cocok.akhir - halaman.awal[itemAkhir], halaman.bagian[itemAkhir].length);
  return { itemAwal, dari, itemAkhir, sampai };
}
