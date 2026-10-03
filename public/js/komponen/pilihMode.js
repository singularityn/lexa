// @ts-check
import { h } from "../dom.js";
import { penyimpanan } from "../state.js";

const MODE = [
  ["hybrid", "Otomatis", "Sitasi, kata kunci, dan makna sekaligus (disarankan)"],
  ["keyword", "Kata persis", "Hanya kecocokan kata, dengan pelucutan imbuhan dan sinonim"],
  ["semantic", "Makna", "Kemiripan makna lewat AI; berguna bila Anda tidak tahu istilah resminya"],
];

/** Mode pencarian yang terakhir dipilih pengguna di perangkat ini. */
export function modeTersimpan() {
  const m = penyimpanan.baca("lexa:mode");
  return m === "keyword" || m === "semantic" ? m : "hybrid";
}

/**
 * Pilihan mode pencarian (radio berbentuk segmen).
 * @param {string} nilai
 * @param {(mode: string) => void} saatUbah
 * @param {string} [nama] nama grup radio, harus unik per halaman
 */
export function pilihMode(nilai, saatUbah, nama = "mode") {
  return h(
    "fieldset",
    { class: "segmen", style: { border: "1px solid var(--garis-kuat)", margin: "0", padding: "0" } },
    h("legend", { class: "sr-only" }, "Mode pencarian"),
    MODE.map(([kode, label, bantuan]) =>
      h(
        "label",
        { title: bantuan },
        h("input", {
          type: "radio",
          name: nama,
          value: kode,
          checked: kode === nilai,
          onchange: () => {
            penyimpanan.tulis("lexa:mode", kode);
            saatUbah(kode);
          },
        }),
        h("span", null, label),
      ),
    ),
  );
}
