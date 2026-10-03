/**
 * Membuat gambar pratinjau tautan (Open Graph / Twitter card) Lexa: kartu merek 1200x630.
 *
 *   node scripts/buat-og.mjs          # menulis public/og/lexa.png
 *
 * Gambar ini tampil di WhatsApp, Telegram, dan sejenisnya saat tautan Lexa dibagikan (lihat
 * src/worker/lib/pratinjau.ts). Warna dan bentuknya sama dengan sampul Design System: blok warna
 * merek dengan pola baris teks berindentasi menggantung (susunan ayat dan butir peraturan).
 *
 * Memakai Chromium lewat playwright-core, seperti scripts/buat-ikon.mjs. Hasilnya di-commit;
 * jalankan ulang hanya bila merek berubah. Huruf yang dipakai adalah huruf berkaki pertama yang
 * tersedia di mesin ini (urutannya sama dengan --font-judul di css/app.css).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const W = 1200;
const H = 630;
const WARNA = {
  bg: "#f7f5ef",
  teks: "#1d2129",
  redup: "#566070",
  garis: "#e1ddd0",
  biru: "#1b4b82",
  lembut: "#e7eef8",
  emas: "#e8b53a",
};

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
  html, body { margin: 0; width: ${W}px; height: ${H}px; background: ${WARNA.bg}; overflow: hidden; }
  .nama { position: absolute; left: 72px; top: 212px; margin: 0; color: ${WARNA.teks};
    font: 700 196px/0.95 "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif; letter-spacing: -0.02em; }
  .tag { position: absolute; left: 80px; top: 440px; width: 580px; margin: 0; color: ${WARNA.redup};
    font: 400 34px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  .tanda { position: absolute; left: 72px; top: 72px; width: 96px; height: 96px; }
  svg.seni { position: absolute; left: 0; top: 0; }
  .biru { fill: ${WARNA.biru}; } .lembut { fill: ${WARNA.lembut}; stroke: ${WARNA.garis}; stroke-width: 2; }
  .tinta { fill: ${WARNA.teks}; } .emas { fill: ${WARNA.emas}; }
  .putih { fill: #fff; opacity: 0.92; } .garis { fill: ${WARNA.biru}; }
</style></head><body>
  <svg class="tanda" viewBox="0 0 64 64" role="img" aria-label="Lexa">
    <rect width="64" height="64" rx="14" fill="${WARNA.biru}"/>
    <path d="M22 14h8v30h16v7H22z" fill="#fff"/><circle cx="46" cy="19" r="4" fill="${WARNA.emas}"/>
  </svg>
  <h1 class="nama">Lexa</h1>
  <p class="tag">Cari dan baca peraturan perundang-undangan Indonesia.</p>
  <svg class="seni" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
    <rect class="biru" x="676" y="-40" width="184" height="480" rx="24"/>
    <circle class="emas" cx="822" cy="58" r="20"/>
    <rect class="lembut" x="876" y="188" width="184" height="400" rx="24"/>
    <rect class="tinta" x="1076" y="96" width="220" height="492" rx="24"/>
    ${baris(700, 196, POLA, "putih")}
    ${baris(900, 244, POLA, "garis")}
  </svg>
</body></html>`;

const tujuan = join(process.cwd(), "public", "og");
await mkdir(tujuan, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
  await writeFile(join(tujuan, "lexa.png"), png);
  console.log(`lexa.png  ${W}x${H}  ${png.length} bita`);
} finally {
  await browser.close();
}
