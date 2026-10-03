/**
 * Membuat ikon PNG aplikasi (PWA, layar utama iOS/Android, favicon) dari logo SVG.
 *
 *   node scripts/buat-ikon.mjs          # menulis ke public/ikon/
 *
 * Memakai Chromium lewat playwright-core (sudah menjadi dependensi pengembangan untuk tes e2e),
 * sehingga tidak perlu pustaka gambar tambahan. Hasilnya di-commit; jalankan ulang hanya bila
 * logo berubah.
 *
 * Ikon "maskable" sengaja berbeda: latar penuh tanpa sudut membulat, dan lambang dikecilkan ke
 * zona aman (40% jari-jari dari tengah) supaya tidak terpotong oleh bentuk topeng Android.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const BIRU = "#1b4b82";
const AMBER = "#e8b53a";
const LAMBANG = `<path d="M22 14h8v30h16v7H22z" fill="#fff"/><circle cx="46" cy="19" r="4" fill="${AMBER}"/>`;

/** Lambang L berpusat di (32, 32) dengan skala `s` (aslinya berpusat di 36, 32.5). */
const lambang = (s) => `<g transform="translate(32 32) scale(${s}) translate(-36 -32.5)">${LAMBANG}</g>`;

const VARIAN = [
  // Bentuk biasa: kotak membulat dengan sudut transparan.
  { berkas: "ikon-192.png", ukuran: 192, svg: `<rect width="64" height="64" rx="14" fill="${BIRU}"/>${LAMBANG}`, transparan: true },
  { berkas: "ikon-512.png", ukuran: 512, svg: `<rect width="64" height="64" rx="14" fill="${BIRU}"/>${LAMBANG}`, transparan: true },
  // Maskable: latar penuh, lambang di zona aman.
  { berkas: "ikon-maskable-512.png", ukuran: 512, svg: `<rect width="64" height="64" fill="${BIRU}"/>${lambang(0.82)}`, transparan: false },
  // iOS membulatkan sudutnya sendiri dan menolak transparansi.
  { berkas: "apple-touch-icon.png", ukuran: 180, svg: `<rect width="64" height="64" fill="${BIRU}"/>${lambang(0.92)}`, transparan: false },
  { berkas: "favicon-32.png", ukuran: 32, svg: `<rect width="64" height="64" rx="12" fill="${BIRU}"/>${LAMBANG}`, transparan: true },
];

const tujuan = join(process.cwd(), "public", "ikon");
await mkdir(tujuan, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const v of VARIAN) {
    await page.setViewportSize({ width: v.ukuran, height: v.ukuran });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">` +
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${v.ukuran}" height="${v.ukuran}" style="display:block">${v.svg}</svg>` +
        `</body></html>`,
    );
    const png = await page.screenshot({ omitBackground: v.transparan, clip: { x: 0, y: 0, width: v.ukuran, height: v.ukuran } });
    await writeFile(join(tujuan, v.berkas), png);
    console.log(`${v.berkas}  ${v.ukuran}x${v.ukuran}  ${png.length} bita`);
  }
} finally {
  await browser.close();
}
