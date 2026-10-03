/**
 * Perbarui daftar cangkang dan versi di public/sw.js.
 *
 *   npm run sw             # tulis ulang bila berubah
 *   npm run sw -- --periksa  # keluar 1 bila sw.js belum mutakhir (dipakai tes)
 *
 * Jalankan setelah menambah, menghapus, atau mengubah berkas apa pun di public/.
 */
import { readFile, writeFile } from "node:fs/promises";
import { gantiBlok, hitungDaftar } from "./sw-daftar.mjs";

const BERKAS = "public/sw.js";
const lama = await readFile(BERKAS, "utf8");
const baru = gantiBlok(lama, await hitungDaftar("public"));

if (baru === lama) {
  console.log("sw.js sudah mutakhir");
} else if (process.argv.includes("--periksa")) {
  console.error("sw.js belum mutakhir: jalankan `npm run sw`");
  process.exit(1);
} else {
  await writeFile(BERKAS, baru);
  console.log("sw.js diperbarui");
}
