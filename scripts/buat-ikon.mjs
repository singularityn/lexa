/**
 * Membuat ikon PNG aplikasi (PWA, layar utama iOS/Android, favicon) dari nama merek Lexa.
 *
 *   node scripts/buat-ikon.mjs          # menulis ke public/ikon/
 *
 * Mereknya hanya teks, tanpa lambang: ikon besar memuat kata "Lexa" dalam huruf yang sama dengan nama di
 * antarmuka (Newsreader 600, dari public/fonts/), dan favicon yang terlalu kecil untuk empat huruf memuat huruf
 * pertamanya. Berkas huruf disematkan sebagai data URI supaya hasilnya sama di mesin mana pun.
 *
 * Memakai Chromium lewat playwright-core (sudah menjadi dependensi pengembangan untuk tes e2e), sehingga tidak
 * perlu pustaka gambar tambahan. Hasilnya di-commit; jalankan ulang hanya bila merek berubah.
 *
 * Ikon "maskable" sengaja berbeda: latar penuh tanpa sudut membulat, dan teks dikecilkan ke zona aman (lingkaran
 * berjari-jari 40% dari tengah) supaya tidak terpotong oleh bentuk topeng Android.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const TINTA = "#14130f";
const KERTAS = "#f4ecda";

const huruf = (await readFile(join(process.cwd(), "public", "fonts", "newsreader-latin-600-normal.woff2"))).toString("base64");

const VARIAN = [
  // Bentuk biasa: kotak membulat dengan sudut transparan.
  { berkas: "ikon-192.png", ukuran: 192, kata: "Lexa", teks: 30, sudut: 22, transparan: true },
  { berkas: "ikon-512.png", ukuran: 512, kata: "Lexa", teks: 30, sudut: 22, transparan: true },
  // Maskable: latar penuh, teks di zona aman.
  { berkas: "ikon-maskable-512.png", ukuran: 512, kata: "Lexa", teks: 23, sudut: 0, transparan: false },
  // iOS membulatkan sudutnya sendiri dan menolak transparansi.
  { berkas: "apple-touch-icon.png", ukuran: 180, kata: "Lexa", teks: 30, sudut: 0, transparan: false },
  // Favicon: empat huruf tak terbaca pada 32 px, jadi huruf pertama saja.
  { berkas: "favicon-32.png", ukuran: 32, kata: "L", teks: 78, sudut: 22, transparan: true },
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
      `<!doctype html><html><head><meta charset="utf-8"><style>
        @font-face { font-family: "Newsreader"; font-weight: 600; src: url(data:font/woff2;base64,${huruf}) format("woff2"); }
        html, body { margin: 0; background: transparent; }
        .tile { width: ${v.ukuran}px; height: ${v.ukuran}px; background: ${TINTA}; border-radius: ${(v.sudut / 100) * v.ukuran}px;
          display: grid; place-items: center; overflow: hidden; }
        /* Ukuran huruf sebagai persen sisi ikon; sedikit naik supaya tampak berpusat secara optik. */
        .t { color: ${KERTAS}; font-family: "Newsreader", serif; font-weight: 600; line-height: 1; letter-spacing: -0.02em;
          font-size: ${(v.teks / 100) * v.ukuran}px; transform: translateY(-3%); }
      </style></head><body><div class="tile"><div class="t">${v.kata}</div></div></body></html>`,
    );
    await page.evaluate(() => document.fonts.ready);
    const png = await page.screenshot({ omitBackground: v.transparan, clip: { x: 0, y: 0, width: v.ukuran, height: v.ukuran } });
    await writeFile(join(tujuan, v.berkas), png);
    console.log(`${v.berkas}  ${v.ukuran}x${v.ukuran}  ${png.length} bita`);
  }
} finally {
  await browser.close();
}
