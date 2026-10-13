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

// --- Batang tubuh saja, dan perbandingan dengan teks di Lexa --------------------------------------------------------

/**
 * Judul bagian penjelasan, berhuruf besar seperti di naskah: "PENJELASAN", "PENJELASAN ATAS UNDANG-UNDANG ...",
 * "P E N J E L A S A N" (dieja renggang), dan subjudul "PASAL DEMI PASAL". Pola yang sama dipakai pengurai di server
 * (RE_PENJELASAN dan RE_PASAL_DEMI_PASAL di src/worker/lib/bpk.ts): ia berhenti di baris yang sama, jadi yang dibandingkan
 * di sini adalah batang tubuh yang sama dengan yang diekstrak.
 */
const POLA_PENJELASAN = /^(?:PENJELASAN|P\s+E\s+N\s+J\s+E\s+L\s+A\s+S\s+A\s+N)(?:\s+ATAS\b.*)?$|^PASAL\s+DEMI\s+PASAL$/;

/** @param {string} baris */
export function adalahJudulPenjelasan(baris) {
  return POLA_PENJELASAN.test(baris.replace(/\s+/g, " ").trim());
}

/**
 * Pindai satu halaman berurutan: nomor pasal yang judulnya tampak sebelum bagian penjelasan, dan apakah bagian penjelasan
 * dimulai di halaman ini. Yang tertulis sesudah judul penjelasan tidak dihitung: penjelasan pasal demi pasal memakai ulang
 * nomor yang sama dan akan menutupi pasal yang judulnya tak terbaca di batang tubuh.
 * @param {ReadonlyArray<{ str?: string, hasEOL?: boolean }>} item
 * @returns {{ pasal: string[], penjelasan: boolean }}
 */
export function pindaiHalaman(item) {
  /** @type {string[]} */
  const pasal = [];
  let penjelasan = false;
  /** @param {string} baris @returns {boolean} true bila baris itu judul penjelasan (pemindaian berhenti) */
  const periksa = (baris) => {
    const b = baris.replace(/\s+/g, " ").trim();
    if (!b) return false;
    if (adalahJudulPenjelasan(b)) {
      penjelasan = true;
      return true;
    }
    const nomor = nomorDariJudulPasal(b);
    if (nomor && !pasal.includes(nomor)) pasal.push(nomor);
    return false;
  };
  let kini = "";
  for (const it of item) {
    if (typeof it.str !== "string") continue;
    // Judul sering menjadi item tersendiri tanpa tanda akhir baris, jadi tiap item diperiksa juga sebagai baris.
    if (periksa(it.str)) break;
    kini += it.str;
    if (it.hasEOL) {
      if (periksa(kini)) break;
      kini = "";
    }
  }
  if (!penjelasan && kini) periksa(kini);
  return { pasal, penjelasan };
}

/**
 * Seperti catatPasalHalaman, tetapi hanya batang tubuh: berhenti di judul penjelasan dan melaporkannya.
 * @param {Map<string, number>} indeks diubah di tempat
 * @param {number} halaman nomor halaman (mulai 1)
 * @param {ReadonlyArray<{ str?: string, hasEOL?: boolean }>} item
 * @returns {{ baru: number, penjelasan: boolean }}
 */
export function catatHalamanBadan(indeks, halaman, item) {
  const { pasal, penjelasan } = pindaiHalaman(item);
  let baru = 0;
  for (const nomor of pasal) {
    if (!indeks.has(nomor)) {
      indeks.set(nomor, halaman);
      baru++;
    }
  }
  return { baru, penjelasan };
}

/** @param {string} romawi */
function nilaiRomawi(romawi) {
  /** @type {Record<string, number>} */
  const nilai = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let jumlah = 0;
  for (let i = 0; i < romawi.length; i++) {
    const sekarang = nilai[romawi[i]] ?? 0;
    const berikut = nilai[romawi[i + 1]] ?? 0;
    jumlah += sekarang < berikut ? -sekarang : sekarang;
  }
  return jumlah;
}

/**
 * Urutan alami nomor pasal: 1, 2, 2A, 10, lalu angka Romawi (I, II, ...).
 * @param {string} a
 * @param {string} b
 */
export function bandingkanNomorPasal(a, b) {
  /** @param {string} n */
  const urai = (n) => {
    const m = /^(\d+)([A-Z]*)$/.exec(n);
    return m ? { jenis: 0, nilai: Number(m[1]), akhiran: m[2] } : { jenis: 1, nilai: nilaiRomawi(n), akhiran: "" };
  };
  const pa = urai(a);
  const pb = urai(b);
  return pa.jenis - pb.jenis || pa.nilai - pb.nilai || (pa.akhiran < pb.akhiran ? -1 : pa.akhiran > pb.akhiran ? 1 : 0);
}

/** Nomor pasal yang lazim; nilai lain di data (mis. "Umum") tidak ikut dibandingkan karena PDF tak mungkin memuat judulnya. */
const POLA_NOMOR_LAZIM = /^(?:\d{1,4}[A-Z]{0,2}|[IVXLC]{1,6})$/;

/**
 * Bandingkan nomor pasal yang judulnya tampak di PDF dengan yang tersimpan di Lexa.
 * @param {Iterable<string>} dariPdf
 * @param {Iterable<string>} dariLexa
 * @returns {{ pdf: number, lexa: number, sama: number, hanyaPdf: string[], hanyaLexa: string[] }}
 *   hanyaPdf: judulnya ada di PDF tetapi pasalnya tak ada di Lexa (kemungkinan terlewat oleh ekstraksi);
 *   hanyaLexa: ada di Lexa tetapi judulnya tak tampak di PDF (salah baca nomor, atau judul tak berdiri sendiri di PDF)
 */
export function bandingkanPasal(dariPdf, dariLexa) {
  const pdf = new Set(dariPdf);
  const lexa = new Set([...dariLexa].map((n) => String(n).trim().toUpperCase()).filter((n) => POLA_NOMOR_LAZIM.test(n)));
  const hanyaPdf = [...pdf].filter((n) => !lexa.has(n)).sort(bandingkanNomorPasal);
  const hanyaLexa = [...lexa].filter((n) => !pdf.has(n)).sort(bandingkanNomorPasal);
  return { pdf: pdf.size, lexa: lexa.size, sama: pdf.size - hanyaPdf.length, hanyaPdf, hanyaLexa };
}
