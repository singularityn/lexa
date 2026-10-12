# PDF.js (salinan untuk penampil PDF Lexa)

Penampil PDF di halaman peraturan (tab "PDF", `public/js/komponen/penampilPdf.js`) memakai PDF.js dari Mozilla,
Apache-2.0 (lihat `LICENSE`). Salinannya ada di repo, bukan dari CDN, karena CSP aplikasi hanya mengizinkan skrip dari
asal sendiri.

- Versi: **pdfjs-dist 6.3.289** (rilis 29 Agu 2026), dari paket npm, tanpa diubah.
- Berkas yang dipakai: `pdf.min.mjs` (inti), `pdf.worker.min.mjs` (pekerja), dan `wasm/*_nowasm_fallback.js`
  (dekoder JBIG2 dan JPEG 2000 versi JavaScript untuk PDF hasil pindaian). Aplikasi memanggil `getDocument` dengan
  `useWasm: false`, sehingga dekoder WebAssembly (yang menuntut `'wasm-unsafe-eval'` pada CSP) tidak dipakai dan CSP
  tetap ketat. PDF.js 6 tidak memakai `eval`/`new Function`, jadi CSP tak perlu dilonggarkan untuk itu.
- Memakai build **legacy** (`legacy/build/*`), bukan `build/*`: ia membawa polyfill untuk peramban ponsel yang lebih tua
  (WebView Android dan iOS beberapa versi ke belakang), dengan selisih ukuran yang kecil.
- Tidak ikut service worker: `scripts/sw-daftar.mjs` mengecualikan `vendor/`, jadi 2,3 MB ini hanya diunduh saat tab
  PDF dibuka dan disimpan di cache saat itu juga.
- `SHA256SUMS` dijaga `test/vendor.test.ts`: berkas yang berubah tanpa memperbarui daftar ini membuat tes gagal.

## Memperbarui

```sh
mkdir /tmp/pdfjs && cd /tmp/pdfjs && npm pack pdfjs-dist@<versi> && tar -xzf pdfjs-dist-<versi>.tgz
cp package/legacy/build/pdf.min.mjs package/legacy/build/pdf.worker.min.mjs <repo>/public/vendor/pdfjs/
cp package/wasm/jbig2_nowasm_fallback.js package/wasm/openjpeg_nowasm_fallback.js <repo>/public/vendor/pdfjs/wasm/
cp package/LICENSE <repo>/public/vendor/pdfjs/ && cp package/wasm/LICENSE_* <repo>/public/vendor/pdfjs/wasm/
cd <repo>/public/vendor/pdfjs && sha256sum pdf.min.mjs pdf.worker.min.mjs wasm/*.js > SHA256SUMS
cd <repo> && npm run sw && npm run e2e
```

Perbarui juga versinya di berkas ini. Pilih rilis yang sudah beberapa minggu umurnya, dan jalankan e2e `penampil PDF`.
