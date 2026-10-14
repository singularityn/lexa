# Lexa

Pencarian dan penelusuran peraturan perundang-undangan Indonesia, dibangun di atas Cloudflare Workers
(D1, R2, KV, Queues, Vectorize, Workers AI) dengan antarmuka web tanpa langkah build.

> **Status: v0.3.** Backend berawal dari kode v0.1 yang berjalan di Worker `lexa` (dipulihkan dari sourcemap
> produksi dan terbukti identik), dengan perbaikan bug yang ditemukan lewat tes. Antarmuka (`public/`) ditulis baru
> karena frontend v0.1 tidak ikut dalam bundel Worker, dan kini memakai desain dari Claude Design (merek hanya teks
> "Lexa"). **Sumber data tunggal: naskah resmi di peraturan.bpk.go.id.** Lexa tidak lagi memakai API atau layanan
> pasal.id (dihentikan 14 Okt 2026); data lama yang sudah tersimpan tetap ada dan digantikan bertahap oleh hasil panen
> BPK, yang dijalankan pengelola dari peramban sendiri. Lihat [docs/pipeline-data.md](docs/pipeline-data.md). Cara
> menyambungkan repo ini ke Cloudflare dan memeriksa hasilnya ada di
> [docs/hubungkan-github-cloudflare.md](docs/hubungkan-github-cloudflare.md).

## Yang dilakukan

- **Cakupan terbatas**: untuk saat ini hanya UUD dan setara (Tap MPR), undang-undang termasuk Perppu, dan
  peraturan pemerintah, supaya beban aplikasi tetap ringan. Peraturan di bawahnya (Perpres, Permen, POJK,
  Perda, ...) tidak diimpor, dicari, maupun ditampilkan. Lihat [Cakupan peraturan](#cakupan-peraturan).
- **Pencarian hybrid** untuk peraturan dan pasal: jalur sitasi ("UU 13/2003", "Peraturan Pemerintah
  Republik Indonesia Nomor 35 Tahun 2021", "Perppu 2/2022"), kata kunci (FTS5 dengan
  stemmer dan sinonim bahasa Indonesia), dan makna (Vectorize + embedding Workers AI), digabung dengan
  Reciprocal Rank Fusion, di-cache di KV. Tiga mode: Gabungan, Kata kunci, Makna. **Peraturan yang judulnya
  memuat kata kunci selalu tampil di atas pasal** (tingkat judul, `src/worker/lib/judul.ts`): "kelautan" menampilkan
  UU 32/2014 tentang Kelautan lebih dulu, bukan pasal-pasal yang kebetulan menyebut kata itu. Urutan di dalam
  tingkatnya menurut seberapa besar bagian judul yang dibicarakan kata itu, bukan BM25; "uu perikanan" atau
  "pp kelautan" membatasi tingkat judul pada jenisnya.
- **Telusur** dengan filter dan facet: jenis, tahun, status, instansi, bidang.
- **Detail peraturan**: pasal dan ayat, pencarian di dalam peraturan, relasi antar-peraturan (mengubah,
  mencabut, dasar hukum, dan seterusnya) beserta peta relasi dua arah, tautan ke naskah resmi di
  peraturan.bpk.go.id, PDF dan teks hasil konversi bila sudah diarsipkan, lapor kesalahan data.
- **Tab PDF**: naskah asli yang diarsipkan Lexa ditampilkan di dalam halaman peraturan (PDF.js, digambar per halaman
  dengan lapisan teks, perbesar/perkecil, loncat ke halaman; berjalan juga di ponsel, yang tak bisa menampilkan PDF
  di dalam halaman). Tombol **Lihat di PDF** pada tiap pasal membuka halaman tempat pasal itu dimulai, dicari di teks
  PDF-nya, supaya hasil ekstraksi yang meragukan bisa dibandingkan dengan aslinya. Tombol **Periksa pasal** memindai
  seluruh batang tubuh PDF (penjelasan tidak dihitung) dan membandingkan nomor pasal yang judulnya tampak di sana dengan
  pasal yang tersimpan: yang ada di PDF tetapi tak ada di Lexa kemungkinan terlewat oleh ekstraksi, dan tiap nomor membuka
  halamannya. PDF hanya ada untuk peraturan yang dipanen dari BPK; selebihnya tab ini menjelaskan itu. PDF.js dimuat
  hanya saat tab dibuka (`public/vendor/pdfjs`).
- **Membaca di ponsel**: halaman peraturan dengan daftar isi dan lompat ke pasal, lima ukuran huruf, **Penjelasan resmi di
  bawah pasal yang dijelaskannya** (lipatan tertutup; "Penjelasan: cukup jelas" bila hanya itu; Penjelasan Umum di awal;
  ikut dicari), rujukan antarpasal yang bisa diketuk ("Pasal 156 ayat (2)"), lanjutkan membaca dari posisi terakhir,
  bagikan, **salin kutipan lengkap** ("Pasal 156 Undang-Undang Nomor 13 Tahun 2003 tentang Ketenagakerjaan", teks pasal, dan
  tautan) atau pasal beserta penjelasannya, cetak atau simpan PDF, penanda per pasal ke Koleksi, dan simpan untuk dibaca luring.
- **Tanya Lexa**: jawaban AI yang hanya boleh bersumber dari kutipan pasal yang ditemukan, wajib
  menyebut sumbernya, dan menandai peraturan yang sudah dicabut atau diubah.
- **Akun opsional**: login Google, koleksi pribadi dengan catatan (tamu menyimpannya di perangkat; saat
  masuk, koleksi perangkat digabung ke akun tanpa menimpa catatan), riwayat percakapan.
- **Ingest dari BPK**: Worker tidak pernah menghubungi BPK (situsnya di balik Cloudflare managed challenge). Skrip
  `scripts/bpk-console-harvest.js` dijalankan pengelola di konsol peramban pada peraturan.bpk.go.id: ia menjelajahi daftar
  BPK per jenis, menautkan tiap entri ke peraturan Lexa (`bpk_id`), mengunduh PDF-nya, dan mengunggahnya ke API impor
  (token admin). Worker mengekstrak PDF menjadi pasal (Workers AI `toMarkdown`, pembersih artefak halaman, pengurai
  `uraikanPasal`) dan Penjelasannya (`uraikanPenjelasan`, tabel `penjelasan`) dengan penilaian kualitas, dan hasilnya
  diindeks ke FTS5 dan Vectorize. Data yang sudah ada tak pernah diganti dengan hasil yang jelas lebih buruk. Perbaikan
  pengurai diterapkan ke yang sudah tersimpan lewat uraian ulang arsip teks (`usang`), tanpa mengunduh ulang dari BPK.
  Lihat [docs/pipeline-data.md](docs/pipeline-data.md).

## Arsitektur

Satu Worker (`src/worker/index.ts`, Hono) mengerjakan tiga peran: `fetch` (API `/api/*`, `robots.txt`,
`sitemap.xml`, dan `/peraturan` untuk pratinjau tautan), `scheduled` (Cron harian untuk pemeliharaan, dan Cron 15 menit untuk
Gemini otomatis yang mati kecuali dinyalakan) dan `queue`
(konsumer antrean ingest: ekstraksi PDF, indeks vektor, ringkasan AI). Selain rute itu, permintaan dilayani sebagai aset
statis dari `public/` dengan fallback ke `index.html` (rute sisi klien). Worker tidak memanggil layanan data pihak
ketiga mana pun: satu-satunya panggilan keluar adalah Google (login) dan layanan Cloudflare sendiri.

| Binding | Layanan | Resource | Fungsi |
|---|---|---|---|
| `DB` | D1 | `lexa-db` | peraturan, pasal, relasi, FTS5, akun, log |
| `CACHE` | KV | `lexa-cache` | cache pencarian, sesi login, pembatas laju |
| `DOCS` | R2 | `lexa-pdfs` | PDF asli (`pdf/…`) dan teks hasil ekstraksi (`teks/…`) |
| `AI` | Workers AI | n/a | embedding, ringkasan, tanya-jawab, `toMarkdown` untuk PDF |
| `VECTORIZE` | Vectorize | `lexa-index` | vektor per pasal (bge-m3, 1024 dimensi, cosine) |
| `INGEST_QUEUE` | Queues | `lexa-ingest` | antrean ingest; DLQ `lexa-ingest-dlq` |
| `ASSETS` | Static Assets | `public/` | cangkang SPA yang dipakai `/peraturan` untuk pratinjau tautan |

Cron: dua pemicu. `0 19 * * *` (pemeliharaan harian, 02:00 WIB) mengosongkan daftar hapus (berkas R2 dan vektor yatim),
memangkas log lama, dan membuang sisa keadaan sumber lama. `*/15 * * * *` menjalankan Gemini otomatis
(`src/worker/lib/geminiOtomatis.ts`): tak mengerjakan apa pun, dan tak menyentuh D1 maupun Gemini, kecuali variabel
`GEMINI_OTOMATIS` dipasang. Data peraturan tidak dijemput Cron; ia masuk dari panen BPK lewat `/api/impor/*`. Skema D1 dan
alasan desainnya ada di `migrations/`.

### Endpoint API

| Kelompok | Endpoint |
|---|---|
| Pencarian dan telusur | `GET /api/search`, `GET /api/laws`, `GET /api/laws/detail?uri=`, `GET /api/suggest`, `GET /api/bidang`, `GET /api/relasi/graf`, `GET /api/stats` |
| Dokumen | `GET /api/dokumen/status`, `GET /api/dokumen/pdf`, `GET /api/dokumen/teks` |
| Tanya Lexa | `POST /api/tanya` (dibatasi laju per IP) |
| Akun | `GET /api/auth/status`, `GET /api/auth/google`, `GET /api/auth/google/callback`, `PATCH /api/auth/profil`, `POST /api/auth/keluar`; koleksi: `GET/PUT/DELETE /api/koleksi`, `POST /api/koleksi/gabung` |
| Laporan | `POST /api/laporan` |
| Admin (header `x-admin-token`) | `GET /api/admin/ukur`, `GET /api/admin/laporan`, `GET /api/admin/kueri-nihil`, `GET /api/admin/cek-token` (diagnosis, hanya boolean); `POST /api/admin/sync` sudah dihentikan (menjawab 410 dengan petunjuk pengganti) |
| Impor dari BPK (header `x-admin-token`) | `GET /api/impor/butuh-teks`, `GET /api/impor/ringkasan`, `POST /api/impor/tautan`, `POST /api/impor/manifest`, `PUT /api/impor/pdf`, `POST /api/impor/tanpa-berkas`, `POST /api/impor/ekstrak-ulang`, `POST /api/impor/ringkas`, `GET /api/impor/gemini-cek`, `POST /api/impor/gemini-uji` |

Rute memakai mode ketat: `/api/tanya/` dan `/api/koleksi/` (dengan garis miring penutup) dijawab 404.

### Antarmuka

HTML, CSS, dan modul ES di `public/`; tanpa framework, tanpa langkah build, tanpa aset pihak ketiga.
Rute: `/` beranda, `/cari`, `/telusuri`, `/peraturan?uri=…` (sama dengan URL pada sitemap), `/tanya`,
`/koleksi`, `/akun`, `/tentang`, `/status`. Seluruh teks dinamis dimasukkan sebagai simpul teks (tanpa
`innerHTML`), CSP ketat lewat `public/_headers`, dan JavaScript-nya dicek tipenya (`checkJs`) lewat
`tsconfig.web.json`.

Desainnya dari Claude Design (paket `Redesign UI aplikasi Lexa`, Oktober 2026): palet krem dan tinta (terang dan gelap),
Plus Jakarta Sans untuk antarmuka dan Newsreader untuk naskah, kapsul navigasi mengambang di ponsel dan bilah samping di
layar lebar. Huruf dilayani dari `public/fonts/` (hanya aksara latin, 128 KB) supaya CSP tetap `font-src 'self'`.
**Tidak ada logo**: merek hanyalah teks "Lexa" (Newsreader 600); favicon, ikon aplikasi, dan gambar pratinjau tautan
memakai tipografi yang sama dan dibuat ulang oleh `npm run ikon` dan `node scripts/buat-og.mjs`. Halaman `/status`
menampilkan kelengkapan data per jenis diukur dari panen BPK (bertaut, ber-PDF, berpasal, menunggu).

#### Pratinjau tautan

WhatsApp, Telegram, dan mesin pencari membaca `<head>` tanpa menjalankan JavaScript. Karena itu
`GET /peraturan?uri=…` dilayani Worker (`src/worker/lib/pratinjau.ts`, termasuk `run_worker_first`). Untuk
perayap dan aplikasi pesan (dikenali dari User-Agent) ia mengambil `index.html` lewat binding `ASSETS` dan
menyuntikkan judul, deskripsi, alamat kanonik, dan gambar (`public/og/lexa.png`, dibuat `node scripts/buat-og.mjs`)
dari data peraturannya. Pembaca biasa langsung menerima cangkang tanpa pencarian D1, jadi waktu muat tidak
bertambah; peramban menyetel judul dan deskripsi yang sama lewat JavaScript (`pratinjauPeraturan` di
`public/js/format.js` dipakai kedua sisi, dan peraturan yang dicabut atau diubah diawali statusnya). Bila apa
pun gagal (peraturan tidak ada, D1 galat, `index.html` berubah bentuk), yang disajikan adalah cangkang biasa,
tidak pernah galat. Halaman lain memakai pratinjau umum situs. Mencobanya:
`curl -A "WhatsApp/2" 'https://<situs>/peraturan?uri=/akn/id/act/uu/2003/13' | grep og:`.

#### Ponsel dan layar utama (PWA)

Lexa dirancang mobile-first dan dapat dipasang ke layar utama (Android/Chrome lewat tombol Pasang, iOS lewat
Bagikan > Tambahkan ke Layar Utama; panduannya tampil di aplikasi dan di halaman Akun). Di layar sempit
navigasi utama ada di bilah bawah, dan area aman (takik, bilah gestur) dihormati.

- `public/manifest.webmanifest` dan ikon PNG di `public/ikon/` (dibuat oleh `npm run ikon`; hasilnya di-commit).
- `public/sw.js` menyimpan cangkang aplikasi dan peraturan yang pernah dibuka agar terbaca tanpa jaringan.
  Strateginya **jaringan dulu**: saat daring pengguna tidak pernah disuguhi salinan usang; salinan hanya
  dipakai bila jaringan gagal, lambat, atau server 5xx. Pencarian, tanya jawab, sesi, dan koleksi tidak pernah
  disentuh.
- **Simpan untuk dibaca luring** (lembar "Lainnya" di halaman peraturan): isi, status dokumen, dan peta relasi
  langsung disalin ke cache `lexa-simpan-v1` (maksimal 30 peraturan; tidak ikut dibuang oleh batas 80 entri cache
  baca) dan diperbarui otomatis setiap kali dibuka saat daring. Daftar dan tombol hapusnya ada di halaman Akun.
- **Setiap kali berkas di `public/` berubah, jalankan `npm run sw`** (menulis ulang daftar precache dan
  versi di `sw.js`). `npm test` gagal bila lupa, supaya pengguna tidak terjebak di cangkang lama.

## Struktur repo

```
src/worker/index.ts      titik masuk: fetch + scheduled + queue
src/worker/routes/       api, fitur, dokumen, auth, tanya, koleksi, impor
src/worker/lib/          query (stemmer, parser kueri), search (hybrid + RRF), judul (tingkat judul), bpk (parser manifest
                         dan pengurai pasal), halaman (pembersih artefak halaman PDF), penjelasan (pengurai Penjelasan),
                         tautanBpk (penautan daftar BPK), prioritas (urutan panen), ingest (konsumer antrean, PDF, vektor,
                         aturan penggantian), pratinjau (pratinjau tautan), sesi, auth, cors, bidang, d1; hapus,
                         pemeliharaan, keadaan, jadwal (pekerjaan harian), gemini (pembaca PDF pindaian)
src/worker/env.d.ts      tipe global Env (binding, variabel, secret)
src/shared/types.ts      tipe bersama
public/                  antarmuka (index.html, css/, js/, _headers, favicon, ikon/, og/, vendor/pdfjs: salinan PDF.js, lihat README-nya)
migrations/              migrasi D1: 0000-0004 direkonstruksi dari skema produksi, 0005-0006 kolom isi_* (kini tak dipakai) dan daftar hapus,
                         0007 tabel penjelasan dan ekstraksi_log.versi_parser, 0008 tabel pembacaan_ai
test/                    tes unit; test/integration: Worker asli di atas SQLite sungguhan
e2e/                     tes antarmuka di Chromium
scripts/                 pratinjau lokal (dev-node.ts), data contoh, pembuat ikon dan gambar pratinjau, pembaruan sw.js
docs/                    analisis kelayakan, panduan koneksi GitHub-Cloudflare, pipeline data, analisis UI/UX
wrangler.jsonc           konfigurasi Worker
```

## Memulai

Butuh Node.js 22 atau lebih baru (`.nvmrc`).

```bash
npm ci
npm run check            # typecheck (Worker + antarmuka) + ratusan tes
npm run dev:node         # pratinjau lokal di http://localhost:8787, tanpa akun Cloudflare
npm run e2e              # tes antarmuka di Chromium (butuh: npx playwright-core install chromium)
npm run sw               # perbarui daftar precache service worker setelah mengubah isi public/
npm run d1:migrate:local # buat D1 lokal dari migrasi
cp .dev.vars.example .dev.vars   # hanya untuk wrangler dev; berkas ini di-ignore Git
```

- **`npm run dev:node`** menjalankan Worker asli dan antarmuka di atas SQLite sungguhan dengan 11 peraturan
  contoh (parafrase singkat, **bukan naskah resmi**; ada pita peringatan di layar). Workers AI, Vectorize,
  KV, R2, dan Queue berupa tiruan, sehingga pencarian makna dan jawaban Tanya Lexa hanya peragaan. "Masuk
  dengan Google" diganti masuk instan sebagai pengguna uji agar alur akun bisa dicoba. Dengan
  `LEXA_DATA_NYATA=berkas.json` pratinjau memuat salinan baris produksi (`laws`, `articles`, `relations`) agar
  tampilan dinilai dengan judul dan pasal sungguhan; berkas itu jangan di-commit (`.dev/` diabaikan Git).
  `LEXA_TANPA_CACHE_API=1` hanya dipakai tes e2e service worker.
- **`npm test`** menjalankan vitest: tes unit, tes integrasi (SQLite sungguhan lewat `node:sqlite`,
  dilewati bila Node Anda tidak menyertakannya), dan tes fungsi murni antarmuka.
- **`npm run build`** hanya membundel Worker (dry run), tanpa login dan tanpa deploy.
- **`npm run dev`** (`wrangler dev`): binding Workers AI dan Vectorize berjalan di sisi Cloudflare, jadi jalur
  pencarian makna dan tanya-jawab memerlukan login Wrangler dan mode remote.

### Variabel dan secret

| Nama | Jenis | Keterangan |
|---|---|---|
| `EMBEDDING_MODEL` | variabel | model embedding Workers AI (kode dan komentar menyebut bge-m3, 1024 dimensi) |
| `SUMMARY_MODEL` | variabel | model teks untuk ringkasan dan tanya-jawab |
| `BPK_BASE` | variabel | basis URL peraturan.bpk.go.id untuk tautan sumber |
| `SEARCH_CACHE_TTL` | variabel | TTL cache pencarian dalam detik (bawaan 3600) |
| `CAKUPAN_JENIS` | variabel (di `wrangler.jsonc`) | kode jenis peraturan yang dicakup, dipisah koma; bawaan `UUD,TAP_MPR,UU,PERPPU,PP` (lihat [Cakupan peraturan](#cakupan-peraturan)) |
| `ADMIN_TOKEN` | secret | token untuk `/api/admin/*` dan `/api/impor/*` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | secret | login Google; tanpa ini aplikasi berjalan sebagai tamu |
| `GEMINI_API` | secret (opsional) | kunci Gemini untuk membaca PDF pindaian; tanpa ini jalur `gemini` menjawab 503 dan fitur lain tak terpengaruh |
| `GEMINI_MODEL`, `GEMINI_BATAS_HARIAN`, `GEMINI_BASE_URL` | variabel (opsional) | model (bawaan `gemini-flash-latest`), anggaran token per hari UTC (bawaan 5.000.000), dan alamat dasar API (mis. AI Gateway) |
| `GEMINI_BERPIKIR`, `GEMINI_HALAMAN`, `GEMINI_PARALEL`, `GEMINI_HALAMAN_MAKS` | variabel (opsional) | pengaturan berpikir model (angka = `thinkingBudget`, kata = `thinkingLevel`; tanpa bawaan, diuji `geminiCek`), halaman per panggilan untuk PDF panjang (bawaan 4, 1-20), panggilan bersamaan per PDF (bawaan 3, 1-8), dan batas panjang PDF yang mau dibaca (bawaan 120 halaman, 1-5000; yang lebih panjang ditolak `terlalu_panjang` sebelum Gemini dipanggil, supaya Cipta Kerja dan sejenisnya tak menghabiskan anggaran) |
| `GEMINI_OTOMATIS` | variabel (opsional) | `uji` (percobaan kering otomatis, berhenti sendiri setelah `GEMINI_OTOMATIS_UJI_MAKS`) atau `ya` (membaca sungguhan) lewat Cron 15 menit; tak ada atau nilai lain: mati |
| `GEMINI_OTOMATIS_BATAS`, `GEMINI_OTOMATIS_UJI_MAKS`, `GEMINI_OTOMATIS_VONIS` | variabel (opsional) | peraturan per putaran (bawaan 2, maks 10), banyak percobaan kering (bawaan 8), dan vonis calon (bawaan `tanpa_pasal,berat,gagal`) |

Login Google memerlukan alamat pengalihan yang terdaftar **persis** di Google Cloud Console, yaitu
`https://<host-situs>/api/auth/google/callback` (untuk produksi:
`https://lexa.fariqhfebrian18.workers.dev/api/auth/google/callback`). Tanpa itu Google menjawab "Error 400:
redirect_uri_mismatch" dan tidak mengembalikan pengguna ke Lexa. Alamat yang sedang dikirim Lexa tampil di halaman
Akun (bagian bantuan, tertutup) dan pada `redirect_uri` di `GET /api/auth/status`. Langkah lengkap dan daftar galat:
[docs/hubungkan-github-cloudflare.md](docs/hubungkan-github-cloudflare.md#login-google-oauth).

Secret dipasang dengan `npx wrangler secret put NAMA` (jangan lewat pipa, newline ikut tersimpan) atau
lewat dashboard. Nilainya tidak pernah masuk Git. Variabel teks lain saat ini dipertahankan dari dashboard
(`keep_vars` di `wrangler.jsonc`); `CAKUPAN_JENIS` ditetapkan di `wrangler.jsonc` dan ikut setiap deploy. `placement.region` (AS Timur) juga
ditetapkan di sana: Google menolak alamat keluar dari sebagian pusat data Cloudflare di Asia (galat Gemini `User location is not supported`),
dan lokasi itu sekaligus dekat dengan D1; lihat [docs/hubungkan-github-cloudflare.md](docs/hubungkan-github-cloudflare.md).

Sisa pengaturan sumber lama (variabel `PASAL_API_BASE` dan `TIK_CADANGAN`, secret `PASAL_API_TOKEN`) tidak dibaca kode lagi;
hapus saja dari dashboard Cloudflare (Workers & Pages > lexa > Settings > Variables and Secrets).

## Pipeline data

Ringkasannya (rincian, perintah, dan SQL pemeriksaan ada di [docs/pipeline-data.md](docs/pipeline-data.md)):

- **Sumber**: hanya naskah resmi BPK. Peraturan baru (dan tautan BPK-nya) masuk lewat **penjelajahan** daftar BPK
  (`jelajah: true`, sesekali untuk menangkap peraturan baru); teksnya lewat **panen PDF** (`GET /api/impor/butuh-teks`
  memberi daftar kerja: yang bertaut ke BPK dulu, lalu UUD < Tap MPR < UU < Perppu < PP, terbaru dulu).
- **Ekstraksi**: `PUT /api/impor/pdf` menyimpan PDF di R2 dan mengantrekan ekstraksi; konsumer antrean mengubahnya menjadi
  teks (Workers AI), pasal dan ayat, lalu mencatat mutu hasilnya (`ekstraksi_log`). Teks konversi diarsipkan di R2 (`teks/…md`)
  sehingga perbaikan pengurai cukup menguraikan ulang arsip (`POST /api/impor/ekstrak-ulang` dengan `dariTeks: true`), tanpa
  mengunduh ulang dari BPK dan tanpa konversi ulang.
- **Pembersihan dan Penjelasan**: artefak halaman PDF (penanda, kepala, kaki, catchword) dibuang sebelum diurai; batang tubuh
  berhenti di judul PENJELASAN dan di rumus penutup (pengesahan dan lampiran bukan isi pasal); Penjelasan disimpan di tabel
  `penjelasan`, bukan sebagai pasal kembar.
- **Pengaman**: PDF yang judul resminya milik peraturan lain tidak menghasilkan pasal; hasil yang jelas lebih buruk tidak
  menggantikan teks yang sudah ada (dihitung dengan nomor pasal berbeda); naskah lama yang di BPK tak berkas ditandai
  (`POST /api/impor/tanpa-berkas`).
- **Pengurai diperbarui**: `ekstraksi_log.versi_parser` mencatat versi yang menghasilkan pasal tersimpan;
  `POST /api/impor/ekstrak-ulang {"usang": true}` (atau opsi skrip `usang: true`) menguraikan ulang yang berversi lama dari
  arsip teksnya. `butuh-teks?lama=1` (opsi `lama`) menyertakan peraturan yang masih bertumpu pada teks lama supaya naskah
  BPK menggantikannya.
- **PDF pindaian**: PDF tanpa lapisan teks tak menghasilkan pasal lewat konversi bawaan. Untuk peraturan semacam itu Gemini
  dapat membaca halaman sebagai gambar (opsi skrip `geminiCek`, `geminiUji`, `gemini`; `POST /api/impor/ekstrak-ulang
  {"gemini": true}`). Opt-in, berpagar (halaman lengkap, mutu sama, tak mengurangi pasal tersimpan, anggaran token harian), dan
  peraturan yang pasalnya dibaca AI diberi catatan di antarmuka. Dapat berjalan sendiri di Cloudflare tanpa peramban:
  `GEMINI_OTOMATIS=uji` lalu `ya`. Calonnya peraturan yang vonis ekstraksinya `tanpa_pasal`, `berat`, atau `gagal`; vonis
  `berat` kini juga berarti pasal hilang dari rangkaian atau pembukaan tertelan ke dalam pasal. Analisis, risiko, dan cara
  memakainya: [docs/analisis-gemini.md](docs/analisis-gemini.md).
- **Pemeliharaan harian** (Cron 02:00 WIB): daftar hapus dikosongkan, log lebih tua dari 90 hari dipangkas, sisa keadaan
  sumber lama dibuang.

## Cakupan peraturan

Atas keputusan pemilik, cakupan Lexa dibatasi pada **UUD (dan yang setara: Ketetapan MPR), undang-undang
(termasuk Perppu), dan peraturan pemerintah**. Alasannya beban: ukuran D1 dan indeks FTS, jumlah vektor di
Vectorize, pemanggilan Workers AI, dan lamanya panen BPK dari peramban (beberapa ribu PDF). Satu daftar
(`CAKUPAN_JENIS`, bawaan di `src/shared/cakupan.ts`) dipakai di semua tempat:

| Pintu | Perilaku untuk jenis di luar cakupan |
|---|---|
| Konsumer antrean | pesan lama untuk URI di luar cakupan di-ack tanpa menyentuh AI, Vectorize, R2, atau D1 |
| `GET /api/impor/butuh-teks`, `POST /api/impor/ekstrak-ulang`, `POST /api/impor/ringkas` | `jenis` di luar cakupan ditolak (400 `di_luar_cakupan`); hanya yang dalam cakupan yang diminta atau diantrekan |
| Impor BPK | dokumen di luar cakupan dimasukkan ke `ditolak` dengan alasannya (skrip panen cukup membaca daftar itu); PDF untuk baris lama di luar cakupan ditolak (422) |
| Pencarian (kata, sitasi, makna) | kata kunci dan sitasi disaring di SQL, hasil makna saat hidrasi (kandidat vektor lama tak bisa disaring di Vectorize; hidrasi mengambil 2x `limit` agar halaman tetap penuh); sitasi seperti "Perpres 12/2020" tidak dicari tetapi dijelaskan (`di_luar_cakupan` pada jawaban) |
| Telusur, facet, saran, bidang, statistik, sitemap, pratinjau tautan, peta relasi, berkas dokumen | hanya yang dalam cakupan; relasi ke peraturan di luar cakupan disembunyikan |
| `GET /api/laws/detail`, `/api/relasi/graf` | 404 dengan `error: "di_luar_cakupan"` dan daftar cakupan; antarmuka menampilkan penjelasannya |

Penentu cakupan adalah kolom `laws.jenis`. Segmen FRBR URI hanya jalan pintas untuk yang jelas di luar cakupan
(`perpres`, `keppres`, ...): POJK memakai segmen `peraturan-ojk` dan 204 PERMEN tersebar pada puluhan segmen
(`permenkeu`, `mk`, `pkpu`, ...), sehingga URI yang tak dikenal dinilai "belum jelas" dan diserahkan ke barisnya. Pesan
Cron membawa kode jenis untuk alasan yang sama.

Baris peraturan di luar cakupan **sudah dihapus dari produksi pada 11 Okt 2026** atas permintaan pemilik: 2.131
peraturan (PERPRES 1.380, POJK 547, PERMEN 204, dan sisanya) dengan 15.457 baris pasal dan relasinya dari D1, sedangkan 6.393
berkas R2 dan 21.128 vektor Vectorize yang yatim dicatat di tabel `daftar_hapus` dan dikosongkan oleh pemeliharaan
(`lib/hapus.ts`). Melebarkan cakupan kelak berarti memanen datanya dari BPK.

Melebarkan cakupan: tambahkan kodenya ke `vars.CAKUPAN_JENIS` di `wrangler.jsonc` (mis.
`"UUD,TAP_MPR,UU,PERPPU,PP,PERPRES"`), sebarkan, lalu jalankan penjelajahan dan panen BPK untuk jenis itu (opsi `jenis` pada
skrip panen). Urutan prioritas panen (`lib/prioritas.ts`) mengikuti `CAKUPAN_BAWAAN`; jenis lain di urutan terakhir. Nilai
kosong atau tak sah dibaca sebagai bawaan, bukan sebagai "semua" maupun "tidak ada". Pratinjau lokal memakai bawaan yang sama
(`CAKUPAN_JENIS=UU,PP,PERPRES npm run dev:node` untuk melebarkannya).

## Migrasi D1

Berkas di `migrations/` diberi nomor berurutan. **Jangan mengubah berkas yang sudah diterapkan**: nama berkasnya sama
dengan yang tercatat di tabel `d1_migrations` produksi, sehingga dianggap sudah diterapkan di sana (0005 dan 0006
diterapkan pada 11 Okt 2026: kolom `isi_*` dan penanda arsip pada `laws`, indeks antrean parsial, pemicu FTS yang hanya
menyala untuk kolom yang diindeks, dan tabel `daftar_hapus`; kolom `isi_*` kini tak dipakai lagi tetapi dibiarkan; 0007
menambah tabel `penjelasan` dan kolom `ekstraksi_log.versi_parser`, dan 0008 tabel `pembacaan_ai`, keduanya kompatibel
mundur: kode menahan galatnya bila belum diterapkan). Perubahan
skema baru = berkas baru, lalu terapkan secara sengaja **sebelum** men-deploy kode yang membutuhkannya:

```bash
npm run d1:migrate:local     # uji di D1 lokal dulu
npm run d1:migrate:remote    # produksi; jalankan manual, bukan dari pipeline build
```

## Mengubah kode dengan aman

1. Ubah kode, jalankan `npm run check` (dan `npm run e2e` bila menyentuh antarmuka; `npm run sw` bila menyentuh `public/`).
2. Perubahan perilaku wajib disertai tes. Bug yang sudah diketahui tetapi belum diperbaiki
   didokumentasikan dengan `it.fails` (gagal yang diharapkan) atau `it.todo`; saat diperbaiki, `it.fails`
   akan memberi tahu agar dihapus.
3. Jangan menulis kueri D1 dengan daftar `IN (...)` yang panjangnya mengikuti data: D1 menolak lebih dari
   100 parameter terikat. Pakai `pilihDalam` di `src/worker/lib/d1.ts`. Tiruan D1 di tes menolak pelanggaran
   ini seperti aslinya.
4. Buka pull request. CI (`.github/workflows/ci.yml`) menjalankan typecheck, tes, bundling, migrasi pada D1
   kosong, dan tes e2e, tanpa secrets.

Cakupan tes: logika route, SQL, pipeline ingest, Cron, konsumer antrean, alur Google OAuth (dengan JWT
RS256 buatan tes), dan antarmuka di Chromium (termasuk axe-core terang dan gelap). Yang **tidak** teruji
di sandbox: perilaku runtime workerd dan layanan Cloudflare asli (Workers AI, Vectorize); itu hanya bisa
dilihat pada deploy sungguhan.

## Riwayat perubahan penting

Ditemukan lewat tes integrasi pada kode v0.1, semuanya sudah diperbaiki dan punya tes:

- Pencarian kata kunci nihil untuk kata bertanda hubung ("perundang-undangan"): ekspresi FTS5 tidak
  dikutip dan galatnya ditelan.
- Sinkronisasi Cron membuang pesan yang sudah terkumpul saat kena batas laju pasal.id (429) padahal kursor
  sudah maju. Terbukti di produksi: kursor `PP` = 4300 padahal hanya 1.383 PP tersimpan, `PERMEN` = 2100
  padahal hanya 204. Selain itu urutan jenis yang tetap membuat PERPRES (yang selalu kena 429 lebih dulu)
  menghalangi PERMEN, POJK, dan PBI; kini urutannya diputar. Langkah pemulihan ada di
  [docs/hubungkan-github-cloudflare.md](docs/hubungkan-github-cloudflare.md).
- Open redirect setelah login Google (`kembali=//host`).
- Tiga kueri melampaui batas 100 parameter D1 pada data besar: graf relasi, manifest impor, filter jenis.
- Potongan pasal panjang (`~n`) dan vektor yatim muncul sebagai pasal fiktif di hasil pencarian.
- `/api/suggest?q=%%` cocok dengan semua judul, dan kueri panjang ditolak D1 (pola LIKE maksimal 50 byte).
- Filter bidang memakai `LIKE` dengan pola yang melampaui 50 byte untuk nama bidang BPK yang panjang (mis.
  "PEMBENTUKAN, PERUBAHAN, DAN PEMBUBARAN KOMISI / KOMITE / …"); kini memakai `INSTR`.
- Jalur sitasi melewatkan sebagian besar bentuk yang lazim diketik: nama panjang ("Peraturan Pemerintah
  Nomor 35 Tahun 2021"), "UU RI No. 13 Tahun 2003", "Perpu 2/2022", Peraturan Menteri/OJK/BI. Lebih buruk,
  "Peraturan Pemerintah Pengganti Undang-Undang Nomor 2 Tahun 2022" dibaca sebagai **UU** 2/2022 (hukum yang
  keliru dengan bobot sitasi 12). Pengurai relasi impor BPK punya kekeliruan jenis yang sama. Kini keduanya
  memakai satu tata bahasa ketat (`src/worker/lib/sitasi.ts`).
- 422 dari 547 POJK produksi bernomor slug (`48-pojk-04-2016`), sehingga pencarian sitasi persis `nomor = ?`
  tak pernah menemukannya dan "48/POJK.04/2016" bahkan tidak dikenali. Pencarian sitasi kini mencocokkan slug
  (dan awalan `n-`), dan label POJK ditulis dengan penomoran resminya ("POJK 48/POJK.04/2016").
- Relasi ke PERPPU menggantung: pasal.id menyimpan peraturannya sebagai `/akn/id/act/perpu/2022/2` tetapi
  relasi menunjuk `/akn/id/act/perppu/2022/2`. Di produksi 117 dari 124 relasi ke PERPPU (145 dari 1.675
  relasi seluruhnya menggantung) tidak menemukan tujuannya, sehingga tautannya mati dan relasi masuk di halaman
  PERPPU tidak ditemukan. Endpoint detail dan graf kini menyelesaikan kedua ejaan saat dibaca
  (`src/worker/lib/uri.ts`); data tidak diubah dan tidak ada kueri tambahan bila tak ada URI beralias.
- Klien API menganggap jawaban 2xx yang badannya tak terbaca sebagai `null`, sehingga `sesi.data` bisa menjadi
  `null` dan header meledak (ditemukan CI saat pengguna berpindah halaman di tengah permintaan). Kini menjadi
  galat yang tertangani, dan kerangka pemuatan tidak lagi memakai kelas `.hasil` milik hasil sungguhan.

## Isu yang diketahui

- **Sebagian teks pasal masih dari sumber lama yang sudah dihentikan.** Sampai 11 Okt 2026 katalog dan teks pasal juga
  datang dari pasal.id; Lexa tidak memakai layanan itu lagi (14 Okt 2026), tetapi teks yang sudah tersimpan dibiarkan dan
  digantikan bertahap oleh naskah BPK begitu PDF-nya dipanen dan terbaca utuh (hasil PDF yang jelas lebih buruk tidak
  menggantikannya). Panel kelengkapan di `/status` menghitung "teks lama" yang tersisa.
- **Cakupan data produksi (14 Okt 2026):** 7.177 peraturan dalam cakupan (PP 5.011, UU 1.950, Perppu 170, Tap MPR 41,
  UUD 5); sekitar 4.200 punya teks pasal dan 3.000 menunggu PDF dari BPK (hampir semuanya PP). UUD 1945 dan 39 Tap MPR sudah
  terdaftar tetapi belum berteks. Angka terkini ada di `/status` dan `GET /api/impor/ringkasan`.
- **Ekstraksi pasal sebagian.** Teks lama banyak yang tersimpan sebagian (UU 17/2023: 59 dari 458 pasal; UU 27/2009: Pasal 1
  dan 400-408 dari 408; KUHAP 39 dari 286), polanya pasal yang punya ayat lenyap; halaman baca memberi tahu pembaca bila
  penomoran bercelah. `GET /api/impor/butuh-teks?celah=1` menyertakannya dalam daftar panen BPK.
- **Teks hasil ekstraksi versi lama masih memuat sisa** sampai diuraikan ulang: 19.000 baris pasal (1.666 peraturan) bertanda
  halaman ("### Page 97 PRESIDEN REPUBLIK INDONESIA- 18 -"), 701 peraturan menyimpan Penjelasan di pasal terakhir atau sebagai
  pasal kembar `~n`, dan hampir semua menyimpan pengesahan di pasal terakhir. Pengurai saat ini sudah memperbaiki ketiganya;
  data yang tersimpan baru bersih setelah `ekstrak-ulang` mode `usang` dijalankan sekali
  ([docs/pipeline-data.md](docs/pipeline-data.md#memperbarui-pengurai-uraikan-ulang-yang-usang)). Antarmuka merapikannya
  saat dibaca selama itu.
- PDF hasil pindai (mis. KUHP, UU 1/2023) diekstrak dengan salah baca OCR (kata menempel, nomor pasal bergeser);
  angka nol yang terbaca huruf O ("Pasal 1O") dirapikan saat dibaca dan saat ingest, selebihnya hanya ekstraksi
  ulang dengan sumber yang lebih baik yang memperbaikinya.
- 72,8% kolom `instansi` di produksi berisi "[object Object]" (kerusakan lama pada ingest); antarmuka dan API
  menganggapnya kosong saat dibaca, datanya sendiri belum diperbaiki.
- Stemmer belum melucuti awalan "be-" ("bekerja" tidak menghasilkan "kerja"; `it.todo`).
- Sitasi bernama kementerian dikenali sebagai Peraturan Menteri umum: basis data tidak menyimpan kementerian
  pada judul PERMEN, jadi "Peraturan Menteri Kesehatan Nomor 29 Tahun 2025" menampilkan semua PERMEN 29/2025.
  Penomoran resmi selain POJK (mis. "91/PMK.05/2024") belum dikenali. (Keduanya di luar cakupan saat ini; logikanya
  tetap dijaga tes dengan cakupan dilebarkan.)
- Ambang relevansi Tanya Lexa berbasis peringkat RRF, bukan kemiripan mutlak: enam hasil vektor teratas
  selalu lolos untuk kueri apa pun. Perlindungan utamanya prompt yang tegas; ambang sesungguhnya butuh skor
  kosinus dari Vectorize.
- Vektor yang yatim karena peraturan dihapus atau diganti dicatat di `daftar_hapus` dan dihapus dari Vectorize oleh
  pemeliharaan harian.
- Relasi yang menggantung (peraturan tujuannya belum tercatat di Lexa) akan tersambung begitu peraturannya tercatat lewat
  penjelajahan BPK.
- D1 dan R2 berada di Amerika Timur dengan read replication nonaktif, sehingga latensi dari Indonesia tinggi.
- Pembatas laju `/api/tanya` berbasis KV (tidak atomik); sitemap satu berkas (batas protokol 50.000
  URL; produksi memuat 7.177 dalam cakupan) dan memakai URL berparameter.
- Pratinjau tautan hanya ada untuk halaman peraturan (`/peraturan?uri=…`), dengan gambar merek yang sama untuk
  semuanya; halaman lain (mis. hasil pencarian) memakai pratinjau umum situs. WhatsApp dan Telegram menyimpan
  pratinjau per tautan, jadi tautan yang pernah dibagikan sebelum fitur ini ada bisa tetap tampil lama.

## Yang belum ada

- **Panen BPK tanpa peramban.** Pengambilan dari server tidak mungkin: situs BPK di balik Cloudflare managed challenge dan
  menolak alamat IP pusat data. Panen karenanya dikerjakan skrip `scripts/bpk-console-harvest.js` di konsol peramban
  pengelola (sesi yang sudah lolos tantangan). Dua tahap: (1) **penjelajahan** (`jelajah: true`) membuka daftar BPK per jenis
  dan mengirim tiap entri ke `POST /api/impor/tautan`, yang mengenali sitasinya (slug dan teks tautan, tahan terhadap
  "01"/"1", "perpu"/"perppu", dan tiga penulisan Tap MPR) lalu menyimpan `bpk_id` dan alamat rincian peraturan Lexa yang
  sama; (2) **panen PDF** bertanya ke Lexa peraturan mana yang perlu teksnya (`GET /api/impor/butuh-teks`), mengunduh
  PDF-nya, dan mengunggahnya (`PUT /api/impor/pdf`). Ia diuji end-to-end di Chromium terhadap Lexa sungguhan dan situs BPK
  palsu (`e2e/panen.test.mjs`); panduan dan penanganan galat ada di
  [docs/pipeline-data.md](docs/pipeline-data.md#panen-bpk-melengkapi-teks).
- **Fitur dari tinjauan analisis eksternal yang belum dikerjakan**: tampilan sandingan perubahan (redline) dan teks
  konsolidasi, Tanya Lexa multi-putaran dengan pratinjau sitasi, gambar pratinjau tautan dinamis, anotasi dan folder riset.
  Alasan dan prioritasnya ada di [docs/tinjauan-analisis-eksternal.md](docs/tinjauan-analisis-eksternal.md).

## Dokumen

- [docs/analisis-kelayakan-lexa.md](docs/analisis-kelayakan-lexa.md): analisis kelayakan, risiko sumber
  data BPK, estimasi biaya, peta jalan, dan peta fitur.
- [docs/hubungkan-github-cloudflare.md](docs/hubungkan-github-cloudflare.md): menghubungkan repo ini ke
  Worker `lexa` lewat Workers Builds, dengan daftar periksa pasca-deploy dan rollback.
- [docs/pipeline-data.md](docs/pipeline-data.md): pipeline data dari BPK (penjelajahan, panen PDF, ekstraksi),
  mengendalikan dan memeriksa pipeline di produksi, dan tindakan produksi. Bagian riwayat menyimpan temuan 11 Okt 2026
  tentang sumber lama yang dihentikan.
- [docs/tinjauan-analisis-eksternal.md](docs/tinjauan-analisis-eksternal.md): tinjauan klaim dokumen analisis eksternal
  terhadap kode (terbukti, sebagian, sudah ada, atau keliru), apa yang dikerjakan, dan yang ditunda.
- [docs/analisis-ux-dan-fitur.md](docs/analisis-ux-dan-fitur.md): analisis lanjutan UI/UX dan fitur (temuan,
  tindakan, peta jalan), memakai Claude Design, memasang ke layar utama, dan daftar periksa di perangkat asli.
- [docs/analisis-lanjutan-pencarian-login-pdf-panen.md](docs/analisis-lanjutan-pencarian-login-pdf-panen.md): analisis
  lanjutan 12 Okt 2026 atas empat catatan pemilik (pencarian berdasarkan judul peraturan, `redirect_uri_mismatch`,
  menu PDF dan fitur lanjutannya, panen lanjutan BPK), temuan data produksi, tindakan yang hanya bisa Anda lakukan,
  dan peta jalan.
