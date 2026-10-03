// @ts-check
import { s } from "../dom.js";

/**
 * Ikon garis 24x24 (gaya Lucide, ditulis ulang di sini; tanpa aset eksternal).
 * Setiap ikon berupa daftar elemen [tag, atribut].
 * @type {Record<string, Array<[string, Record<string, string>]>>}
 */
const BENTUK = {
  cari: [["circle", { cx: "11", cy: "11", r: "7" }], ["path", { d: "m20 20-3.5-3.5" }]],
  tandai: [["path", { d: "M6 3h12v18l-6-4-6 4z" }]],
  salin: [["rect", { x: "9", y: "9", width: "11", height: "11", rx: "2" }], ["path", { d: "M5 15V6a2 2 0 0 1 2-2h9" }]],
  tautan: [["path", { d: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" }], ["path", { d: "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" }]],
  luar: [["path", { d: "M14 4h6v6" }], ["path", { d: "M20 4 10 14" }], ["path", { d: "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" }]],
  unduh: [["path", { d: "M12 4v11" }], ["path", { d: "m7 11 5 5 5-5" }], ["path", { d: "M5 20h14" }]],
  bendera: [["path", { d: "M5 21V4" }], ["path", { d: "M5 4h12l-2 4 2 4H5" }]],
  bulan: [["path", { d: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" }]],
  matahari: [["circle", { cx: "12", cy: "12", r: "4" }], ["path", { d: "M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" }]],
  menu: [["path", { d: "M4 6h16M4 12h16M4 18h16" }]],
  tutup: [["path", { d: "M6 6l12 12M18 6 6 18" }]],
  info: [["circle", { cx: "12", cy: "12", r: "9" }], ["path", { d: "M12 11v5M12 8h.01" }]],
  peringatan: [["path", { d: "M12 3 2 20h20z" }], ["path", { d: "M12 10v4M12 17h.01" }]],
  centang: [["path", { d: "m5 12 5 5 9-10" }]],
  kirim: [["path", { d: "M5 12h14" }], ["path", { d: "m13 6 6 6-6 6" }]],
  sampah: [["path", { d: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" }]],
  peta: [["circle", { cx: "6", cy: "6", r: "2.5" }], ["circle", { cx: "18", cy: "8", r: "2.5" }], ["circle", { cx: "12", cy: "18", r: "2.5" }], ["path", { d: "m8 7 8 1M7 8l4 8M17 10l-4 6" }]],
  tanya: [["path", { d: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z" }], ["path", { d: "M9.5 10a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5M12 17h.01" }]],
  daftar: [["path", { d: "M9 6h11M9 12h11M9 18h11" }], ["path", { d: "M4.5 6h.01M4.5 12h.01M4.5 18h.01" }]],
  akun: [["circle", { cx: "12", cy: "8", r: "4" }], ["path", { d: "M4 21a8 8 0 0 1 16 0" }]],
  pasang: [["rect", { x: "7", y: "2.5", width: "10", height: "19", rx: "2.5" }], ["path", { d: "M12 8v6" }], ["path", { d: "m9.5 11.5 2.5 2.5 2.5-2.5" }]],
  bagikan: [["circle", { cx: "18", cy: "5", r: "2.5" }], ["circle", { cx: "6", cy: "12", r: "2.5" }], ["circle", { cx: "18", cy: "19", r: "2.5" }], ["path", { d: "m8.2 10.9 7.6-4.4M8.2 13.1l7.6 4.4" }]],
  lainnya: [["circle", { cx: "5", cy: "12", r: "1.6" }], ["circle", { cx: "12", cy: "12", r: "1.6" }], ["circle", { cx: "19", cy: "12", r: "1.6" }]],
  kiri: [["path", { d: "m15 5-7 7 7 7" }]],
  naik: [["path", { d: "M12 19V5" }], ["path", { d: "m5 12 7-7 7 7" }]],
  toc: [["path", { d: "M3 6h18M7 12h14M11 18h10" }]],
  luring: [["path", { d: "M2 8.8a15 15 0 0 1 4-2.5M22 8.8a15 15 0 0 0-8-3.7M5 12.9a10 10 0 0 1 5-2.7M19 12.9a10 10 0 0 0-2.4-1.9M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M2 2l20 20" }]],
  teks: [["path", { d: "M4 19 9 5l5 14M5.8 14.5h6.4" }], ["path", { d: "M15 19l3-8 3 8M16 16.5h4" }]],
  simpanLuring: [["path", { d: "M12 3v10" }], ["path", { d: "m8 9 4 4 4-4" }], ["path", { d: "M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" }]],
};

/**
 * @param {keyof typeof BENTUK | string} nama
 * @param {{ isi?: boolean, kelas?: string, label?: string }} [opsi]
 */
export function ikon(nama, opsi = {}) {
  const svg = s("svg", {
    viewBox: "0 0 24 24",
    class: ["ikon", opsi.isi ? "ikon-isi" : "", opsi.kelas ?? ""].filter(Boolean).join(" "),
    "aria-hidden": opsi.label ? null : "true",
    role: opsi.label ? "img" : null,
    "aria-label": opsi.label ?? null,
    focusable: "false",
  });
  for (const [tag, attr] of BENTUK[nama] ?? []) svg.appendChild(s(tag, attr));
  return svg;
}
