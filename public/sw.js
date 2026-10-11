/* Lexa service worker.
 *
 * Tujuan, berurutan:
 *   1. Cangkang aplikasi (HTML, CSS, JS, ikon) tersedia tanpa jaringan.
 *   2. Peraturan yang pernah dibuka, atau sengaja disimpan pengguna, tetap bisa dibaca saat luring.
 *   3. Saat daring, pengguna TIDAK PERNAH disuguhi salinan usang.
 *
 * Karena butir 3, strateginya "jaringan dulu": setiap permintaan lebih dulu ke jaringan (dengan batas
 * waktu agar sinyal buruk tidak membuat halaman menggantung) dan cache hanya cadangan. Proyek ini
 * tanpa langkah build, jadi tidak ada nama berkas berhash; strategi "cache dulu" berisiko menyajikan
 * modul JavaScript dari dua rilis sekaligus.
 *
 * Yang TIDAK pernah disentuh: permintaan selain GET, permintaan lintas-origin, serta /api/search,
 * /api/tanya, /api/auth/*, dan /api/koleksi (milik pengguna, sensitif, atau memang harus segar).
 *
 * Daftar cangkang dan VERSI dibuat otomatis: jalankan `npm run sw` setelah mengubah berkas apa pun
 * di public/. Tes (test/pwa.test.ts) gagal bila sw.js belum mutakhir.
 */

// <<DAFTAR-CANGKANG (dibuat oleh scripts/perbarui-sw.mjs; jangan disunting tangan)
const VERSI = "cd507f536b36";
const CANGKANG = [
  "/css/app.css",
  "/favicon.svg",
  "/fonts/newsreader-latin-400-italic.woff2",
  "/fonts/newsreader-latin-400-normal.woff2",
  "/fonts/newsreader-latin-600-normal.woff2",
  "/fonts/plus-jakarta-sans-latin-400-normal.woff2",
  "/fonts/plus-jakarta-sans-latin-500-normal.woff2",
  "/fonts/plus-jakarta-sans-latin-600-normal.woff2",
  "/fonts/plus-jakarta-sans-latin-700-normal.woff2",
  "/ikon/apple-touch-icon.png",
  "/ikon/favicon-32.png",
  "/ikon/ikon-192.png",
  "/ikon/ikon-512.png",
  "/ikon/ikon-maskable-512.png",
  "/",
  "/js/api.js",
  "/js/bacaan.js",
  "/js/dom.js",
  "/js/format.js",
  "/js/halaman/akun.js",
  "/js/halaman/beranda.js",
  "/js/halaman/cari.js",
  "/js/halaman/koleksi.js",
  "/js/halaman/peraturan.js",
  "/js/halaman/status.js",
  "/js/halaman/tanya.js",
  "/js/halaman/telusuri.js",
  "/js/halaman/tentang.js",
  "/js/halaman/tidakDitemukan.js",
  "/js/komponen/ajakanPasang.js",
  "/js/komponen/daftarIsi.js",
  "/js/komponen/dialogLaporan.js",
  "/js/komponen/grafik.js",
  "/js/komponen/ikon.js",
  "/js/komponen/jenis.js",
  "/js/komponen/kartuHasil.js",
  "/js/komponen/kotakCari.js",
  "/js/komponen/lembar.js",
  "/js/komponen/navBawah.js",
  "/js/komponen/panelFilter.js",
  "/js/komponen/papanJenis.js",
  "/js/komponen/pilihMode.js",
  "/js/komponen/pitaLuring.js",
  "/js/komponen/progresBaca.js",
  "/js/komponen/sisiDilihat.js",
  "/js/komponen/toast.js",
  "/js/komponen/tombolTandai.js",
  "/js/komponen/umum.js",
  "/js/luring.js",
  "/js/main.js",
  "/js/navigasi.js",
  "/js/pwa.js",
  "/js/riwayat.js",
  "/js/router.js",
  "/js/state.js",
  "/js/tema.js",
  "/manifest.webmanifest",
];
// DAFTAR-CANGKANG>>

const CACHE_CANGKANG = `lexa-cangkang-${VERSI}`;
/** Jawaban API baca yang pernah dilihat (terbatas, yang terlama dibuang). Naikkan nomornya bila bentuk jawaban API berubah tak kompatibel. */
const CACHE_BACA = "lexa-baca-v1";
/** Peraturan yang sengaja disimpan pengguna untuk dibaca luring; tidak pernah dibuang otomatis. */
const CACHE_SIMPAN = "lexa-simpan-v1";
const CACHE_AKTIF = [CACHE_CANGKANG, CACHE_BACA, CACHE_SIMPAN];

const MAKS_BACA = 80;
const BATAS_API_MS = 5000;
const BATAS_ASET_MS = 3500;
const BATAS_NAVIGASI_MS = 4500;

/** Jalur API publik yang aman disalin untuk baca luring. */
const API_BOLEH_SIMPAN = new Set([
  "/api/laws/detail",
  "/api/laws",
  "/api/stats",
  "/api/bidang",
  "/api/relasi/graf",
  "/api/dokumen/status",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_CANGKANG)
      // cache: "reload" melewati cache HTTP agar salinan luring pasti dari rilis ini.
      .then((cache) => cache.addAll(CANGKANG.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const nama of await caches.keys()) {
        if (nama.startsWith("lexa-") && !CACHE_AKTIF.includes(nama)) await caches.delete(nama);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const jalur = url.pathname;

  if (jalur.startsWith("/api/")) {
    if (API_BOLEH_SIMPAN.has(jalur)) event.respondWith(apiJaringanDulu(event, req));
    return; // selainnya langsung ke jaringan
  }
  if (jalur === "/sw.js" || jalur === "/robots.txt" || jalur === "/sitemap.xml") return;

  if (req.mode === "navigate") {
    event.respondWith(navigasi(event, req));
    return;
  }
  event.respondWith(asetJaringanDulu(event, req));
});

// --- Pembantu --------------------------------------------------------------

const tunggu = (ms) => new Promise((selesai) => setTimeout(selesai, ms));

/**
 * Jaringan dengan batas waktu. `dibatasi` bernilai null bila lewat batas atau gagal; `asli` tetap
 * berjalan sehingga hasilnya masih bisa dipakai untuk menyegarkan cache di latar belakang.
 */
function ambilDenganBatas(req, ms) {
  const asli = fetch(req);
  const dibatasi = Promise.race([asli.then((r) => r, () => null), tunggu(ms).then(() => null)]);
  return { asli, dibatasi };
}

/** Jawaban 5xx berarti server sedang bermasalah; perlakukan seperti jaringan gagal agar salinan yang ada dipakai. */
const galatServer = (res) => res.status >= 500;

/** Salin hanya jawaban sah dari origin kita. */
function layakDisimpan(res) {
  return Boolean(res) && res.ok && res.type === "basic";
}

/** @param {string} nama @param {Request} req @param {Response} res @param {number} [maks] */
async function simpan(nama, req, res, maks) {
  const cache = await caches.open(nama);
  await cache.put(req, res);
  if (maks) {
    const kunci = await cache.keys(); // urut penyisipan; put() memindahkan entri yang diperbarui ke akhir
    for (const k of kunci.slice(0, Math.max(0, kunci.length - maks))) await cache.delete(k);
  }
}

/**
 * Bila jawaban ini sudah disimpan pengguna untuk dibaca luring, perbarui salinan itu: simpanan tidak boleh usang
 * (peraturan bisa berubah status atau teksnya). Yang belum disimpan pengguna tidak ditambahkan ke sini.
 */
async function segarkanSimpanan(req, res) {
  const cache = await caches.open(CACHE_SIMPAN);
  if (await cache.match(req)) await cache.put(req, res);
}

/** Simpan jawaban jaringan yang segar ke cache baca (terbatas) dan, bila ada, ke simpanan pengguna. */
function simpanBaca(event, req, res) {
  event.waitUntil(simpan(CACHE_BACA, req, res.clone(), MAKS_BACA));
  event.waitUntil(segarkanSimpanan(req, res.clone()));
}

/** Cari salinan: simpanan pengguna dulu, lalu cache baca. */
async function cocokkanBaca(req) {
  for (const nama of [CACHE_SIMPAN, CACHE_BACA]) {
    const cache = await caches.open(nama);
    const ada = await cache.match(req);
    if (ada) return ada;
  }
  return null;
}

/** Beri tahu halaman bahwa jawaban ini salinan (header dibaca di public/js/api.js). */
function tandaiSalinan(res) {
  const header = new Headers(res.headers);
  header.set("x-lexa-salinan", "1");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: header });
}

function jawabLuring() {
  return new Response(
    JSON.stringify({ error: "luring", message: "Anda sedang luring dan data ini belum tersimpan di perangkat." }),
    { status: 503, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } },
  );
}

function halamanLuring() {
  const html =
    '<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>Lexa (luring)</title><body style=\"font:16px/1.6 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1d2129\">" +
    "<h1>Anda sedang luring</h1><p>Lexa belum tersimpan di perangkat ini. Sambungkan ke internet lalu muat ulang; " +
    'setelah itu Lexa dan peraturan yang pernah Anda buka dapat dibaca tanpa jaringan.</p><p><a href="">Muat ulang</a></p></body></html>';
  return new Response(html, { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

// --- Strategi --------------------------------------------------------------

/** Berkas statis (CSS, JS, ikon): jaringan dulu, cache bila luring atau lambat. */
async function asetJaringanDulu(event, req) {
  const { asli, dibatasi } = ambilDenganBatas(req, BATAS_ASET_MS);
  const res = await dibatasi;
  if (res && !galatServer(res)) {
    if (layakDisimpan(res)) event.waitUntil(simpan(CACHE_CANGKANG, req, res.clone()));
    return res;
  }
  const cadangan = await caches.match(req);
  if (cadangan) {
    event.waitUntil(asli.then((r) => (layakDisimpan(r) ? simpan(CACHE_CANGKANG, req, r) : null)).catch(() => {}));
    return cadangan;
  }
  if (res) return res; // tidak ada salinan: tampilkan galat servernya apa adanya
  try {
    const r = await asli;
    if (layakDisimpan(r)) event.waitUntil(simpan(CACHE_CANGKANG, req, r.clone()));
    return r;
  } catch {
    return Response.error();
  }
}

/** Jawaban API baca: jaringan dulu; luring atau lambat memakai salinan, dengan penanda. */
async function apiJaringanDulu(event, req) {
  const { asli, dibatasi } = ambilDenganBatas(req, BATAS_API_MS);
  const res = await dibatasi;
  if (res && !galatServer(res)) {
    if (layakDisimpan(res)) simpanBaca(event, req, res);
    return res;
  }
  const cadangan = await cocokkanBaca(req);
  if (cadangan) {
    event.waitUntil(asli.then((r) => (layakDisimpan(r) ? Promise.all([simpan(CACHE_BACA, req, r.clone(), MAKS_BACA), segarkanSimpanan(req, r.clone())]) : null)).catch(() => {}));
    return tandaiSalinan(cadangan);
  }
  if (res) return res; // tidak ada salinan: biarkan halaman menampilkan galat servernya
  try {
    const r = await asli;
    if (layakDisimpan(r)) simpanBaca(event, req, r);
    return r;
  } catch {
    return jawabLuring();
  }
}

/** Navigasi halaman: SPA, jadi luring atau lambat cukup menyajikan cangkang (index.html). */
async function navigasi(event, req) {
  const { asli, dibatasi } = ambilDenganBatas(req, BATAS_NAVIGASI_MS);
  const res = await dibatasi;
  if (res && !galatServer(res)) return res;
  const cangkang = await caches.match("/", { cacheName: CACHE_CANGKANG });
  if (cangkang) return cangkang;
  if (res) return res;
  try {
    return await asli;
  } catch {
    return halamanLuring();
  }
}
