// @ts-check
/**
 * Warna menurut jenis peraturan (kelas `j-*` di app.css): UU ungu, PP biru, Perppu koral, UUD dan Tap MPR kuning.
 */

const KELAS = /** @type {Record<string, string>} */ ({ UUD: "j-uud", TAP_MPR: "j-tap", UU: "j-uu", PERPPU: "j-perppu", PP: "j-pp" });
const PENDEK = /** @type {Record<string, string>} */ ({ UUD: "UUD", TAP_MPR: "TAP", UU: "UU", PERPPU: "PPU", PP: "PP" });

/** "tap mpr" dan "TAP_MPR" menjadi "TAP_MPR". @param {string | null | undefined} s */
function normal(s) {
  return (s ?? "").trim().toUpperCase().replace(/\s+/g, "_");
}

/** @param {string | null | undefined} jenis kode internal, mis. "UU" atau "TAP_MPR" */
export function kelasJenis(jenis) {
  return KELAS[normal(jenis)] ?? "j-lain";
}

/** Kode tiga huruf untuk lingkaran kecil di sidebar. @param {string | null | undefined} jenis */
export function kodePendek(jenis) {
  const k = normal(jenis);
  return PENDEK[k] ?? k.slice(0, 3);
}

/** Jenis dari sitasi tampilan: "UU 13/2003" menjadi "UU", "TAP MPR 1/2003" menjadi "TAP_MPR". @param {string | null | undefined} sitasi */
export function jenisDariSitasi(sitasi) {
  const m = /^([A-Za-z][A-Za-z ]*?)\s*\d/.exec(sitasi ?? "");
  return m ? normal(m[1]) : "";
}
