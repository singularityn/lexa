/**
 * Daftar berkas cangkang aplikasi untuk service worker (public/sw.js) beserta versinya.
 *
 * Versi adalah hash isi seluruh berkas yang di-precache. Setiap perubahan pada antarmuka
 * mengubah sw.js, sehingga peramban memasang service worker baru dan menyegarkan salinan
 * luringnya. Dipakai oleh scripts/perbarui-sw.mjs (menulis) dan test/pwa.test.ts (memeriksa).
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/** Bukan bagian cangkang: berkas konfigurasi Cloudflare, dan service worker itu sendiri. */
const KECUALI = new Set(["_headers", "sw.js"]);

/** @param {string} dir @returns {Promise<string[]>} */
async function jelajahi(dir) {
  const hasil = [];
  for (const entri of await readdir(dir, { withFileTypes: true })) {
    const jalur = join(dir, entri.name);
    if (entri.isDirectory()) hasil.push(...(await jelajahi(jalur)));
    else hasil.push(jalur);
  }
  return hasil;
}

/** @param {string} [akar] */
export async function hitungDaftar(akar = "public") {
  const berkas = (await jelajahi(akar))
    .map((p) => relative(akar, p).split(sep).join("/"))
    .filter((p) => !KECUALI.has(p))
    .sort();
  const hash = createHash("sha256");
  for (const p of berkas) {
    hash.update(`${p}\0`);
    hash.update(await readFile(join(akar, p)));
    hash.update("\0");
  }
  return {
    versi: hash.digest("hex").slice(0, 12),
    // index.html dilayani di "/" (fallback SPA), sehingga itulah kuncinya di cache.
    url: berkas.map((p) => (p === "index.html" ? "/" : `/${p}`)),
  };
}

export const AWAL_BLOK = "// <<DAFTAR-CANGKANG";
export const AKHIR_BLOK = "// DAFTAR-CANGKANG>>";

/** @param {{ versi: string, url: string[] }} daftar */
export function tulisBlok({ versi, url }) {
  return (
    `${AWAL_BLOK} (dibuat oleh scripts/perbarui-sw.mjs; jangan disunting tangan)\n` +
    `const VERSI = "${versi}";\n` +
    `const CANGKANG = [\n${url.map((u) => `  "${u}",`).join("\n")}\n];\n` +
    AKHIR_BLOK
  );
}

/** Ganti blok bertanda di sw.js dengan daftar terbaru. @param {string} sumber @param {{ versi: string, url: string[] }} daftar */
export function gantiBlok(sumber, daftar) {
  const a = sumber.indexOf(AWAL_BLOK);
  const b = sumber.indexOf(AKHIR_BLOK);
  if (a < 0 || b < a) throw new Error("penanda DAFTAR-CANGKANG tidak ditemukan di sw.js");
  return sumber.slice(0, a) + tulisBlok(daftar) + sumber.slice(b + AKHIR_BLOK.length);
}
