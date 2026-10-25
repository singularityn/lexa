// @ts-check
import { s } from "../dom.js";

/**
 * Ikon garis 24x24 (gaya Lucide, ditulis ulang di sini; tanpa aset eksternal).
 * Setiap ikon berupa daftar elemen [tag, atribut].
 * @type {Record<string, Array<[string, Record<string, string>]>>}
 */
const BENTUK = {
  kurang: [["path", { d: "M5 12h14" }]],
  layarPenuh: [["path", { d: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" }]],
  layarKecil: [["path", { d: "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" }]],
  lebarHalaman: [["path", { d: "M4 12h16" }], ["path", { d: "m8 8-4 4 4 4" }], ["path", { d: "m16 8 4 4-4 4" }]],
  cari: [["circle", { cx: "11", cy: "11", r: "7" }], ["path", { d: "m20 20-3.5-3.5" }]],
  tandai: [["path", { d: "M6 3h12v18l-6-4-6 4z" }]],
  kutip: [["path", { d: "M5 13h4.5v4.5H5zM5 13c0-3 1.7-4.8 4.5-5" }], ["path", { d: "M13.5 13H18v4.5h-4.5zM13.5 13c0-3 1.7-4.8 4.5-5" }]],
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
  cetak: [["path", { d: "M7 9V4h10v5" }], ["rect", { x: "3.5", y: "9", width: "17", height: "8", rx: "2" }], ["path", { d: "M7 14h10v6H7z" }]],
  lainnya: [["circle", { cx: "5", cy: "12", r: "1.6" }], ["circle", { cx: "12", cy: "12", r: "1.6" }], ["circle", { cx: "19", cy: "12", r: "1.6" }]],
  kiri: [["path", { d: "m15 5-7 7 7 7" }]],
  naik: [["path", { d: "M12 19V5" }], ["path", { d: "m5 12 7-7 7 7" }]],
  toc: [["path", { d: "M3 6h18M7 12h14M11 18h10" }]],
  luring: [["path", { d: "M2 8.8a15 15 0 0 1 4-2.5M22 8.8a15 15 0 0 0-8-3.7M5 12.9a10 10 0 0 1 5-2.7M19 12.9a10 10 0 0 0-2.4-1.9M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M2 2l20 20" }]],
  teks: [["path", { d: "M4 19 9 5l5 14M5.8 14.5h6.4" }], ["path", { d: "M15 19l3-8 3 8M16 16.5h4" }]],
  penyaring: [["path", { d: "M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" }]],
  simpanLuring: [["path", { d: "M12 3v10" }], ["path", { d: "m8 9 4 4 4-4" }], ["path", { d: "M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" }]],
  beranda: [["rect", { x: "4", y: "4", width: "6.5", height: "6.5", rx: "2" }], ["rect", { x: "13.5", y: "4", width: "6.5", height: "6.5", rx: "2" }], ["rect", { x: "4", y: "13.5", width: "6.5", height: "6.5", rx: "2" }], ["rect", { x: "13.5", y: "13.5", width: "6.5", height: "6.5", rx: "2" }]],
  jam: [["circle", { cx: "12", cy: "12", r: "8.5" }], ["path", { d: "M12 7.5V12l3 2" }]],
  masuk: [["path", { d: "M10 5H6.5A2.5 2.5 0 0 0 4 7.5v9A2.5 2.5 0 0 0 6.5 19H10" }], ["path", { d: "M14 8l4 4-4 4M18 12H9" }]],
  papan: [["rect", { x: "4", y: "4", width: "6.5", height: "16", rx: "2" }], ["rect", { x: "13.5", y: "4", width: "6.5", height: "10", rx: "2" }]],
  hierarki: [["rect", { x: "3.5", y: "4", width: "7", height: "5", rx: "1.5" }], ["rect", { x: "13.5", y: "15", width: "7", height: "5", rx: "1.5" }], ["path", { d: "M7 9v3.5a2 2 0 0 0 2 2h4.5" }]],
  folder: [["path", { d: "M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2.2h7.2a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" }]],
  tambah: [["path", { d: "M12 5v14M5 12h14" }]],
  kanan: [["path", { d: "m9 5 7 7-7 7" }]],
  kalender: [["rect", { x: "3.5", y: "5", width: "17", height: "15.5", rx: "3" }], ["path", { d: "M3.5 10h17M8 3v4M16 3v4" }]],
  dokumen: [["path", { d: "M7 3.5h7l4.5 4.5v12.5H7z" }], ["path", { d: "M14 3.5V8h4.5M10 13h5M10 16.5h5" }]],
  kilau: [["path", { d: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" }], ["path", { d: "M19 16v4M17 18h4" }]],
  pensil: [["path", { d: "M4 20l4-1 11-11a2.1 2.1 0 0 0-3-3L5 16z" }]],
  sah: [["circle", { cx: "12", cy: "12", r: "9" }], ["path", { d: "m8.5 12.3 2.4 2.4 4.6-5" }]],
  bawah: [["path", { d: "m6 9 6 6 6-6" }]],
  urut: [["path", { d: "M8 5v14M4.5 15.5 8 19l3.5-3.5M16 19V5M12.5 8.5 16 5l3.5 3.5" }]],
  buku: [["path", { d: "M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z" }], ["path", { d: "M5 17a3 3 0 0 1 3-3h10" }]],
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
