// @ts-check
/**
 * Penghubung tipis ke router, agar komponen bisa berpindah halaman tanpa
 * mengimpor instance router (menghindari impor melingkar).
 */

/** @type {(url: string, opsi?: { ganti?: boolean }) => void} */
let fungsi = (url) => {
  location.href = url;
};

/** @param {(url: string, opsi?: { ganti?: boolean }) => void} fn */
export function pasangNavigasi(fn) {
  fungsi = fn;
}

/** @param {string} url @param {{ ganti?: boolean }} [opsi] */
export function pergi(url, opsi) {
  fungsi(url, opsi);
}
