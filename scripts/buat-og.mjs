/**
 * Membuat gambar pratinjau tautan (Open Graph / Twitter card) Lexa: kartu merek 1200x630.
 *
 *   node scripts/buat-og.mjs          # menulis public/og/lexa.png
 *
 * Gambar ini tampil di WhatsApp, Telegram, dan sejenisnya saat tautan Lexa dibagikan (lihat
 * src/worker/lib/pratinjau.ts). Mereknya hanya teks: nama Lexa dalam huruf yang sama dengan antarmuka
 * (Newsreader 600, dari public/fonts/), di atas kertas krem yang sama dengan latar aplikasi, dengan deretan
 * blok pastel penanda jenis peraturan (UUD kuning, UU ungu, Perppu koral, PP biru) dan pola baris teks
 * berindentasi menggantung (susunan ayat dan butir peraturan). Berkas huruf disematkan sebagai data URI.
 *
 * Memakai Chromium lewat playwright-core, seperti scripts/buat-ikon.mjs. Hasilnya di-commit;
 * jalankan ulang hanya bila merek berubah.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const W = 1200;
const H = 630;
const WARNA = {
  bg: "#f4ecda",
  teks: "#11110d",
  redup: "#5d594d",
  tinta: "#0b0b08",
  kertas: "#f4ecda",
  ungu: "#dcc3f6",
  ungu2: "#3b1a66",
  biru: "#bfd6f6",
  biru2: "#15375e",
  koral: "#ffc9b8",
  koral2: "#6b2a14",
  kuning: "#fde3a2",
  kuning2: "#5b4000",
};

const bacaHuruf = async (nama) => (await readFile(join(process.cwd(), "public", "fonts", nama))).toString("base64");
const SERIF = await bacaHuruf("newsreader-latin-600-normal.woff2");
const SANS = await bacaHuruf("plus-jakarta-sans-latin-500-normal.woff2");

/** Baris teks berindentasi menggantung: [x, y, lebar]. Dua tingkat, seperti ayat dan butir. */
function baris(x0, y0, pola, kelas) {
  return pola
    .map(([dx, dy, lebar]) => `<rect class="${kelas}" x="${x0 + dx}" y="${y0 + dy}" width="${lebar}" height="12" rx="6"/>`)
    .join("");
}
const POLA = [
  [0, 0, 128], [24, 24, 104], [24, 48, 80],
  [0, 84, 136], [24, 108, 88], [24, 132, 64],
  [0, 168, 120], [24, 192, 96],
];

const html = `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><style>
  @font-face { font-family: "Newsreader"; font-weight: 600; src: url(data:font/woff2;base64,${SERIF}) format("woff2"); }
  @font-face { font-family: "Plus Jakarta Sans"; font-weight: 500; src: url(data:font/woff2;base64,${SANS}) format("woff2"); }
  html, body { margin: 0; width: ${W}px; height: ${H}px; background: ${WARNA.bg}; overflow: hidden; }
  body { background-image: radial-gradient(760px 460px at 100% 0%, rgba(255, 244, 214, 0.9), transparent 70%), radial-gradient(620px 440px at 0% 100%, rgba(255, 250, 240, 0.8), transparent 65%); }
  .nama { position: absolute; left: 68px; top: 150px; margin: 0; color: ${WARNA.teks};
    font: 600 232px/1 "Newsreader", Georgia, serif; letter-spacing: -0.03em; }
  .tag { position: absolute; left: 76px; top: 408px; width: 560px; margin: 0; color: ${WARNA.redup};
    font: 500 33px/1.42 "Plus Jakarta Sans", system-ui, sans-serif; }
  .jenis { position: absolute; left: 76px; top: 536px; display: flex; gap: 12px; margin: 0; padding: 0; list-style: none;
    font: 500 22px/1 "Plus Jakarta Sans", system-ui, sans-serif; }
  .jenis li { padding: 11px 18px; border-radius: 999px; }
  svg.seni { position: absolute; left: 0; top: 0; }
  .ungu { fill: ${WARNA.ungu}; } .biru { fill: ${WARNA.biru}; } .koral { fill: ${WARNA.koral}; }
  .kuning { fill: ${WARNA.kuning}; } .tinta { fill: ${WARNA.tinta}; }
  .garis-gelap { fill: ${WARNA.tinta}; opacity: 0.55; } .garis-terang { fill: ${WARNA.kertas}; opacity: 0.85; }
</style></head><body>
  <h1 class="nama">Lexa</h1>
  <p class="tag">Cari dan baca peraturan perundang-undangan Indonesia.</p>
  <ul class="jenis">
    <li style="background:${WARNA.kuning};color:${WARNA.kuning2}">UUD</li>
    <li style="background:${WARNA.ungu};color:${WARNA.ungu2}">UU</li>
    <li style="background:${WARNA.koral};color:${WARNA.koral2}">Perppu</li>
    <li style="background:${WARNA.biru};color:${WARNA.biru2}">PP</li>
  </ul>
  <svg class="seni" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
    <rect class="ungu" x="676" y="-40" width="184" height="480" rx="28"/>
    <rect class="kuning" x="876" y="188" width="184" height="400" rx="28"/>
    <rect class="koral" x="676" y="460" width="184" height="200" rx="28"/>
    <rect class="tinta" x="1076" y="96" width="220" height="492" rx="28"/>
    <circle class="biru" cx="822" cy="58" r="26"/>
    ${baris(700, 196, POLA, "garis-gelap")}
    ${baris(900, 244, POLA, "garis-gelap")}
    ${baris(1100, 152, POLA, "garis-terang")}
  </svg>
</body></html>`;

const tujuan = join(process.cwd(), "public", "og");
await mkdir(tujuan, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
  await writeFile(join(tujuan, "lexa.png"), png);
  console.log(`lexa.png  ${W}x${H}  ${png.length} bita`);
} finally {
  await browser.close();
}
