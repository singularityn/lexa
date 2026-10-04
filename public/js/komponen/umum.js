// @ts-check
/**
 * Komponen kecil yang dipakai banyak halaman.
 */

import { h } from "../dom.js";
import { ikon } from "./ikon.js";
import { kodeJenis, labelJenis, labelStatus } from "../format.js";
import { GalatApi } from "../api.js";

/** @param {string | null | undefined} status */
export function lencanaStatus(status) {
  const kelas = status === "berlaku" || status === "dicabut" || status === "diubah" ? `lencana-${status}` : "";
  // Teksnya dibungkus agar di kartu ponsel status "Berlaku" bisa menyusut menjadi titik hijau (CSS),
  // sementara pembaca layar tetap membaca teksnya.
  return h("span", { class: ["lencana", kelas], title: labelStatus(status) }, h("span", { class: "teks-status" }, labelStatus(status)));
}

/** @param {string} jenis */
export function lencanaJenis(jenis) {
  return h("span", { class: "lencana lencana-jenis", title: labelJenis(jenis) }, kodeJenis(jenis));
}

/**
 * Kerangka pemuatan: beberapa baris abu-abu berdenyut.
 * @param {number} [baris]
 */
export function kerangka(baris = 3) {
  return h(
    "div",
    { "aria-hidden": "true" },
    Array.from({ length: baris }, (_, i) => h("span", { class: "kerangka", style: { width: `${[92, 78, 64, 85][i % 4]}%` } })),
  );
}

/**
 * Daftar kartu kerangka untuk halaman hasil. Sengaja memakai kelas sendiri (bukan `.daftar-hasil`
 * dan `.hasil`) agar penghitung hasil, pembaca layar, dan tes tidak keliru menganggap kerangka
 * sebagai hasil sungguhan.
 * @param {number} n
 */
export function kerangkaHasil(n = 4) {
  return h(
    "div",
    { class: "daftar-kerangka", role: "status", "aria-label": "Memuat hasil" },
    Array.from({ length: n }, () => h("div", { class: "hasil-kerangka" }, kerangka(3))),
  );
}

/**
 * Catatan singkat di atas hasil (pencarian longgar, jenis di luar cakupan): kotak berikon info.
 * @param {...import("../dom.js").Anak} isi
 */
export function catatanHasil(...isi) {
  return h("div", { class: "catatan-hasil", role: "note" }, ikon("info"), h("p", null, ...isi));
}

/**
 * Kotak galat dengan tombol ulangi.
 * @param {unknown} galat
 * @param {() => void} [ulangi]
 */
export function kotakGalat(galat, ulangi) {
  const pesan = galat instanceof GalatApi ? galat.message : "Terjadi kesalahan tak terduga.";
  return h(
    "div",
    { class: "galat", role: "alert" },
    h("p", null, pesan),
    ulangi ? h("button", { class: "tombol tombol-kecil", type: "button", onclick: ulangi }, "Coba lagi") : null,
  );
}

/**
 * Keadaan kosong di dalam halaman yang sudah punya judul sendiri (h2).
 * @param {string} judul
 * @param {...import("../dom.js").Anak} isi
 */
export function keadaanKosong(judul, ...isi) {
  return h("div", { class: "kosong" }, h("h2", null, judul), ...isi);
}

/**
 * Halaman yang seluruh isinya keadaan kosong (404, tidak ditemukan): judulnya h1,
 * sebab tidak ada judul lain di halaman itu.
 * @param {string} judul
 * @param {...import("../dom.js").Anak} isi
 */
export function halamanKosong(judul, ...isi) {
  return h("div", { class: "kosong" }, h("h1", { style: { fontSize: "1.6rem" } }, judul), ...isi);
}

/**
 * Peringatan di atas halaman (dicabut/diubah/info).
 * @param {"dicabut" | "diubah" | "info"} jenis
 * @param {...import("../dom.js").Anak} isi
 */
export function peringatan(jenis, ...isi) {
  return h(
    "div",
    { class: `peringatan peringatan-${jenis}`, role: jenis === "info" ? "note" : "alert" },
    ikon(jenis === "info" ? "info" : "peringatan"),
    h("div", null, isi),
  );
}

/**
 * Tombol dengan ikon dan teks.
 * @param {string} nama
 * @param {string} teks
 * @param {Record<string, any>} [props]
 */
export function tombolIkon(nama, teks, props = {}) {
  const { kelas, ...sisa } = props;
  return h("button", { type: "button", class: ["tombol", kelas].filter(Boolean).join(" "), ...sisa }, ikon(nama), teks ? h("span", null, teks) : null);
}

/**
 * Paginasi dengan tautan nyata (bisa dibuka di tab baru).
 * @param {{ halaman: number, total: number, perHalaman: number, url: (halaman: number) => string }} opsi
 */
export function paginasi({ halaman, total, perHalaman, url }) {
  const jumlah = Math.max(1, Math.ceil(total / perHalaman));
  if (jumlah <= 1) return h("span");
  /** @type {Array<number | "…">} */
  const nomor = [];
  const tambahkan = (/** @type {number} */ n) => {
    if (n >= 1 && n <= jumlah && !nomor.includes(n)) nomor.push(n);
  };
  tambahkan(1);
  if (halaman - 2 > 2) nomor.push("…");
  for (let n = halaman - 2; n <= halaman + 2; n++) tambahkan(n);
  if (halaman + 2 < jumlah - 1) nomor.push("…");
  tambahkan(jumlah);

  return h(
    "nav",
    { class: "paginasi", "aria-label": "Halaman hasil" },
    halaman > 1 ? h("a", { href: url(halaman - 1), rel: "prev" }, "‹ Sebelumnya") : h("span", { class: "nonaktif" }, "‹ Sebelumnya"),
    nomor.map((n) =>
      n === "…"
        ? h("span", { "aria-hidden": "true" }, "…")
        : h("a", { href: url(n), "aria-current": n === halaman ? "page" : null, "aria-label": `Halaman ${n}` }, String(n)),
    ),
    halaman < jumlah ? h("a", { href: url(halaman + 1), rel: "next" }, "Berikutnya ›") : h("span", { class: "nonaktif" }, "Berikutnya ›"),
  );
}
