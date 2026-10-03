// @ts-check
/**
 * Preferensi membaca (ukuran dan jenis huruf teks peraturan), disimpan di perangkat ini.
 * Berlaku lewat atribut data pada elemen teks, yang gayanya ada di app.css.
 */

import { penyimpanan } from "./state.js";

const KUNCI = "lexa:baca:v1";
export const UKURAN = ["Kecil", "Sedang", "Besar", "Lebih besar", "Terbesar"];
export const UKURAN_BAWAAN = 1;
export const HURUF = /** @type {const} */ (["serif", "sans"]);

/** @typedef {{ ukuran: number, huruf: "serif" | "sans" }} PrefBaca */

/** @returns {PrefBaca} */
export function bacaPref() {
  try {
    const m = JSON.parse(penyimpanan.baca(KUNCI) ?? "{}");
    const ukuran = Number.isInteger(m?.ukuran) && m.ukuran >= 0 && m.ukuran < UKURAN.length ? m.ukuran : UKURAN_BAWAAN;
    return { ukuran, huruf: m?.huruf === "sans" ? "sans" : "serif" };
  } catch {
    return { ukuran: UKURAN_BAWAAN, huruf: "serif" };
  }
}

/** @param {Partial<PrefBaca>} sebagian @returns {PrefBaca} */
export function simpanPref(sebagian) {
  const baru = { ...bacaPref(), ...sebagian };
  penyimpanan.tulis(KUNCI, JSON.stringify(baru));
  return baru;
}

/** Pasang preferensi pada elemen teks. @param {HTMLElement} el @param {PrefBaca} [pref] */
export function terapkanPref(el, pref = bacaPref()) {
  el.dataset.ukuran = String(pref.ukuran);
  el.dataset.huruf = pref.huruf;
}
