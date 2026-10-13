# Lexa

Pencarian dan penelusuran peraturan perundang-undangan Indonesia, dibangun di atas Cloudflare Workers
(D1, R2, KV, Queues, Vectorize, Workers AI) dengan antarmuka web tanpa langkah build.

> **Status: v0.2.** Backend berawal dari kode v0.1 yang berjalan di Worker `lexa` (dipulihkan dari sourcemap
> produksi dan terbukti identik), dengan perbaikan bug yang ditemukan lewat tes, dan pipeline pengambilan isi yang
> ditulis ulang (katalog dulu, isi kemudian). Antarmuka (`public/`) ditulis baru karena frontend v0.1 tidak ikut dalam
> bundel Worker, dan kini memakai desain dari Claude Design (merek hanya teks "Lexa"). **Perhatian:** sejak 11 Okt 2026
> API pasal.id hanya memberi metadata ("discovery metadata only"), bukan teks pasal, sehingga teks peraturan baru harus
> datang dari naskah resmi BPK lewat skrip panen; lihat [docs/pipeline-data.md](docs/pipeline-data.md). Cara menyambungkan repo ini ke Cloudflare dan memeriksa
> hasilnya ada di [docs/hubungkan-github-cloudflare.md](docs/hubungkan-github-cloudflare.md).

## Yang dilakukan

- **Cakupan terbatas**: untuk saat ini hanya UUD dan setara (Tap MPR), undang-undang termasuk Perppu, dan
  peraturan pemerintah, supaya beban aplikasi tetap ringan. Peraturan di bawahnya (Perpres, Permen, POJK,
  Perda, ...) tidak disinkronkan, diimpor, dicari, maupun ditampilkan. Lihat [Cakupan peraturan](#cakupan-peraturan).
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
- **Membaca di ponsel**: halaman peraturan dengan daftar isi dan lompat ke pasal, lima ukuran huruf, Penjelasan
  yang dipisahkan dari batang tubuh, rujukan antarpasal yang bisa diketuk ("Pasal 156 ayat (2)"), lanjutkan
  membaca dari posisi terakhir, bagikan, cetak atau simpan PDF, penanda per pasal ke Koleksi, dan simpan untuk
  dibaca luring.
- **Tanya Lexa**: jawaban AI yang hanya boleh bersumber dari kutipan pasal yang ditemukan, wajib
  menyebut sumbernya, dan menandai peraturan yang sudah dicabut atau diubah.
- **Akun opsional**: login Google, koleksi pribadi dengan catatan (tamu menyimpannya di perangkat; saat
  masuk, koleksi perangkat digabung ke akun tanpa menimpa catatan), riwayat percakapan.
- **Ingest**: katalog dulu, isi kemudian. Daftar pasal.id disapu per jenis (UUD, Tap MPR, UU, Perppu, PP) ke D1, lalu
  isinya diambil satu per satu menurut prioritas oleh tik per menit (dengan cadangan lewat Queues); tiap peraturan
  membawa statusnya sendiri (menunggu, lengkap, kosong, gagal), responsnya diarsipkan di R2 supaya bisa diuraikan ulang
  tanpa pasal.id, dan data yang sudah ada tak pernah diganti dengan yang lebih sedikit. API impor menerima manifest
  dan PDF dari BPK; PDF diekstrak menjadi pasal dengan penilaian kualitas; hasilnya diindeks ke FTS5 dan Vectorize.
  Lihat [docs/pipeline-data.md](docs/pipeline-data.md).

## Arsitektur

Satu Worker (`src/worker/index.ts`, Hono) mengerjakan tiga peran: `fetch` (API `/api/*`, `robots.txt`,
`sitemap.xml`, dan `/peraturan` untuk pratinjau tautan), `scheduled` (Cron per menit untuk tik pipeline dan Cron harian
untuk pemeliharaan) dan `queue` (konsumer antrean ingest, yang juga menjalankan tik cadangan). Selain rute itu, permintaan dilayani sebagai aset statis dari `public/` dengan fallback ke
`index.html` (rute sisi klien).

| Binding | Layanan | Resource | Fungsi |
|---|---|---|---|
| `DB` | D1 | `lexa-db` | peraturan, pasal, relasi, FTS5, akun, log |
| `CACHE` | KV | `lexa-cache` | cache pencarian, sesi login, pembatas laju |
| `DOCS` | R2 | `lexa-pdfs` | PDF asli (`pdf/…`) dan teks hasil ekstraksi (`teks/…`) |
| `AI` | Workers AI | n/a | embedding, ringkasan, tanya-jawab, `toMarkdown` untuk PDF |
| `VECTORIZE` | Vectorize | `lexa-index` | vektor per pasal (bge-m3, 1024 dimensi, cosine) |
| `INGEST_QUEUE` | Queues | `lexa-ingest` | antrean ingest; DLQ `lexa-ingest-dlq` |
| `ASSETS` | Static Assets | `public/` | cangkang SPA yang dipakai `/peraturan` untuk pratinjau tautan |

Cron: `* * * * *` (tik pipeline) dan `0 19 * * *` (pemeliharaan harian, 02:00 WIB). Pemicu per menit baru terbukti
berjalan di produksi sekitar 17:40 UTC pada 11 Okt 2026 (jejak `denyut:* * * * *`), berjam-jam sesudah ditambahkan, sehingga
`vars.TIK_CADANGAN = "antrean"` menjalankan tik lewat rantai pesan di `lexa-ingest` sebagai cadangan; rantai berhenti sendiri
selama denyut Cron segar. Lihat [docs/pipeline-data.md](docs/pipeline-data.md). Skema D1 dan alasan desainnya ada di
`migrations/`.

### Endpoint API

| Kelompok | Endpoint |
|---|---|
| Pencarian dan telusur | `GET /api/search`, `GET /api/laws`, `GET /api/laws/detail?uri=`, `GET /api/suggest`, `GET /api/bidang`, `GET /api/relasi/graf`, `GET /api/stats` |
| Dokumen | `GET /api/dokumen/status`, `GET /api/dokumen/pdf`, `GET /api/dokumen/teks` |
| Tanya Lexa | `POST /api/tanya` (dibatasi laju per IP) |
| Akun | `GET /api/auth/status`, `GET /api/auth/google`, `GET /api/auth/google/callback`, `PATCH /api/auth/profil`, `POST /api/auth/keluar`; koleksi: `GET/PUT/DELETE /api/koleksi`, `POST /api/koleksi/gabung` |
| Laporan | `POST /api/laporan` |
| Admin (header `x-admin-token`) | `POST /api/admin/sync`, `GET /api/admin/ukur`, `GET /api/admin/laporan`, `GET /api/admin/kueri-nihil`, `GET /api/admin/cek-token` (diagnosis, hanya boolean) |
| Impor dari BPK (header `x-admin-token`) | `GET /api/impor/butuh-teks`, `GET /api/impor/ringkasan`, `POST /api/impor/tautan`, `POST /api/impor/manifest`, `PUT /api/impor/pdf`, `POST /api/impor/tanpa-berkas`, `POST /api/impor/ekstrak-ulang` |

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
menampilkan kelengkapan isi per jenis dan kendala pasal.id yang sedang berlaku.

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
src/worker/lib/          query (stemmer, parser kueri), search (hybrid + RRF), judul (tingkat judul), pasal (klien dan pengurai pasal.id),
                         bpk (parser manifest dan PDF), ingest (konsumer antrean, PDF, vektor), pratinjau (pratinjau tautan),
                         sesi, auth, cors, bidang, d1; pipeline isi: katalog, isi, tik, cadangan, akses, hapus,
                         pemeliharaan, diagnosa, keadaan, jadwal
src/worker/env.d.ts      tipe global Env (binding, variabel, secret)
src/shared/types.ts      tipe bersama
public/                  antarmuka (index.html, css/, js/, _headers, favicon, ikon/, og/, vendor/pdfjs: salinan PDF.js, lihat README-nya)
migrations/              migrasi D1: 0000-0004 direkonstruksi dari skema produksi, 0005-0006 antrean isi dan daftar hapus
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
| `PASAL_API_BASE` | variabel | basis URL API pasal.id |
| `TIK_CADANGAN` | variabel (di `wrangler.jsonc`) | `antrean` menyalakan rantai tik cadangan lewat antrean ingest, yang hanya berjalan selama denyut Cron per menit tidak segar (pemicu itu baru berjalan di produksi berjam-jam sesudah ditambahkan); tes dan pratinjau lokal tidak menyalakannya |
| `SEARCH_CACHE_TTL` | variabel | TTL cache pencarian dalam detik (bawaan 3600) |
| `CAKUPAN_JENIS` | variabel (di `wrangler.jsonc`) | kode jenis peraturan yang dicakup, dipisah koma; bawaan `UUD,TAP_MPR,UU,PERPPU,PP` (lihat [Cakupan peraturan](#cakupan-peraturan)) |
| `ADMIN_TOKEN` | secret | token untuk `/api/admin/*` dan `/api/impor/*` |
| `PASAL_API_TOKEN` | secret | token pribadi pasal.id (`Authorization: Bearer`) untuk daftar `/laws` (katalog); tanpa ini pipeline tak memanggil pasal.id. Teks pasal tak lagi dilayani API-nya untuk token mana pun (lihat [docs/pipeline-data.md](docs/pipeline-data.md#akses-isi-pasalid-temuan-11-okt-2026)) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | secret | login Google; tanpa ini aplikasi berjalan sebagai tamu |

Login Google memerlukan alamat pengalihan yang terdaftar **persis** di Google Cloud Console, yaitu
`https://<host-situs>/api/auth/google/callback` (untuk produksi:
`https://lexa.fariqhfebrian18.workers.dev/api/auth/google/callback`). Tanpa itu Google menjawab "Error 400:
redirect_uri_mismatch" dan tidak mengembalikan pengguna ke Lexa. Alamat yang sedang dikirim Lexa tampil di halaman
Akun (bagian bantuan, tertutup) dan pada `redirect_uri` di `GET /api/auth/status`. Langkah lengkap dan daftar galat:
[docs/hubungkan-github-cloudflare.md](docs/hubungkan-github-cloudflare.md#login-google-oauth).

Secret dipasang dengan `npx wrangler secret put NAMA` (jangan lewat pipa, newline ikut tersimpan) atau
lewat dashboard. Nilainya tidak pernah masuk Git. Variabel teks lain saat ini dipertahankan dari dashboard
(`keep_vars` di `wrangler.jsonc`); `CAKUPAN_JENIS` ditetapkan di `wrangler.jsonc` dan ikut setiap deploy.

## Pipeline data

Ringkasannya (rincian, SQL pemeriksaan, dan temuan produksi ada di [docs/pipeline-data.md](docs/pipeline-data.md)):

- **Katalog**: daftar `/laws` pasal.id disapu per jenis tiap 3 hari (UUD, Tap MPR, UU, Perppu, PP; 50 peraturan per
  permintaan) dan disimpan sebagai baris `laws` berstatus `menunggu`. Peraturan yang detailnya sulit diambil tetap tercatat.
- **Isi**: tik per menit mengambil detail satu per satu menurut `isi_giliran` (terverifikasi dulu; UUD < Tap MPR < UU <
  Perppu < PP; terbaru dulu), paling banyak 3 permintaan pasal.id per tik, mematuhi `Retry-After`. Respons mentah
  diarsipkan di R2 (`mentah/…`) sebelum diuraikan; penyimpanan tak pernah mengganti pasal dengan hasil yang lebih sedikit.
- **Akses pasal.id**: sejak 11 Okt 2026 detail dijawab tanpa teks (`content: "not_available_via_api"`, "Pasal.id's API
  provides discovery metadata only"). Pipeline tidak menganggapnya 'kosong': peraturan dibiarkan menunggu, pengambilan detail
  dijeda dan diperiksa tiap 30 menit lewat peraturan pembanding, dan berjalan lagi sendiri begitu teks kembali. Keadaannya
  tampil di `/status`. Teks baru kini datang dari **panen BPK** (`scripts/bpk-console-harvest.js` di peramban Anda:
  menjelajahi daftar BPK dan menautkan tiap entri ke peraturan Lexa, lalu mengunggah PDF-nya; lihat bagian "Yang belum ada").
- **Pemicu**: Cron `* * * * *` bila berjalan, selain itu rantai pesan di antrean (`TIK_CADANGAN`), disemai Cron harian
  dan permintaan HTTP. Cron harian menjalankan pemeliharaan.
- **Kontrol**: `POST /api/admin/sync` (`tik`, `uri`, `jenis`, `perbaiki_celah`, `ulang_arsip`, `ringkas_kosong`).

## Cakupan peraturan

Atas keputusan pemilik, cakupan Lexa dibatasi pada **UUD (dan yang setara: Ketetapan MPR), undang-undang
(termasuk Perppu), dan peraturan pemerintah**. Alasannya beban: ukuran D1 dan indeks FTS, jumlah vektor di
Vectorize, pemanggilan Workers AI, dan terutama antrean ingest yang dibatasi laju pasal.id (di produksi 429 datang
setelah belasan permintaan, dan pembacaan teks lengkap dibatasi 300 per akun per hari) yang sebelumnya terkuras oleh PERPRES
dan jenis lain sehingga PP tertinggal. Satu daftar (`CAKUPAN_JENIS`, bawaan
di `src/shared/cakupan.ts`) dipakai di semua tempat:

| Pintu | Perilaku untuk jenis di luar cakupan |
|---|---|
| Katalog dan tik | hanya menyapu jenis dalam cakupan (UUD, TAP_MPR, UU, PERPPU, PP: irisan `CAKUPAN_JENIS` dengan `JENIS_KATALOG`); baris daftar jenis lain dibuang; baris antrean di luar cakupan ditandai 'kosong' tanpa memanggil pasal.id |
| Konsumer antrean | pesan lama untuk URI di luar cakupan di-ack tanpa menyentuh pasal.id, AI, Vectorize, R2, atau D1; peraturan yang jenisnya dilaporkan pasal.id di luar cakupan tidak disimpan |
| `POST /api/admin/sync` | `jenis` di luar cakupan ditolak (400 `di_luar_cakupan`); `uri`, `ringkas_kosong`, dan `perbaiki_celah` hanya menyentuh yang dalam cakupan |
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
berkas R2 dan 21.128 vektor Vectorize yang yatim dicatat di tabel `daftar_hapus` dan dikosongkan bertahap oleh tik
(`lib/hapus.ts`). Melebarkan cakupan kelak berarti mengambil datanya lagi dari sumber.

Melebarkan cakupan: tambahkan kodenya ke `vars.CAKUPAN_JENIS` di `wrangler.jsonc` (mis.
`"UUD,TAP_MPR,UU,PERPPU,PP,PERPRES"`) **dan** ke `JENIS_KATALOG` di `src/worker/lib/katalog.ts` (dengan `PERINGKAT_JENIS` dan
`SQL_GILIRAN` di `lib/isi.ts` bila perlu urutannya), sebarkan, lalu mulai sapuan dengan
`POST /api/admin/sync {"jenis":["PERPRES"]}`. Hanya kode filter `type` yang dikenal pasal.id yang bekerja (`UU`, `PERPPU`,
`PP`, `PERPRES`, `PERMEN`, `POJK`, `PBI`; `UUD` dan `TAP_MPR` dibuktikan oleh sapuan pertama dan dicatat di
`katalog_dukungan:*`); yang lain masuk lewat impor BPK. Nilai kosong atau tak sah dibaca sebagai bawaan, bukan sebagai
"semua" maupun "tidak ada". Pratinjau lokal memakai bawaan yang sama (`CAKUPAN_JENIS=UU,PP,PERPRES npm run dev:node` untuk
melebarkannya).

## Migrasi D1

Berkas di `migrations/` diberi nomor berurutan. **Jangan mengubah 0000-0006**: nama berkasnya sama
dengan yang tercatat di tabel `d1_migrations` produksi, sehingga dianggap sudah diterapkan di sana (0005 dan 0006
diterapkan pada 11 Okt 2026: kolom `isi_*` dan penanda arsip pada `laws`, indeks antrean parsial, pemicu FTS yang hanya
menyala untuk kolom yang diindeks, dan tabel `daftar_hapus`). Perubahan skema baru = berkas baru (`0007_….sql`), lalu
terapkan secara sengaja:

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

- **pasal.id tidak memberi teks pasal lewat API (11 Okt 2026).** Setiap `GET /laws/<uri>` dijawab
  `{ work, content: "not_available_via_api", content_note }` tanpa `articles`; catatan pasal.id: "Pasal.id's API provides
  discovery metadata only. Read the text at the linked pasal.id page, or connect an AI assistant via MCP". Ini kebijakan API
  mereka, bukan masalah token atau kuota Lexa. Pipeline tidak lagi menganggap jawaban itu 'kosong' (peraturan dibiarkan
  'menunggu', jawabannya tak diarsipkan), menjeda pengambilan detail, memeriksa pulihnya akses tiap 30 menit, dan menampilkan
  keadaannya di `/status`. Peraturan baru (termasuk 5 UUD dan 39 Tap MPR yang kini terdaftar) hanya tercatat metadatanya
  sampai teksnya dipanen dari BPK (skrip panen di bawah) atau pasal.id membuka aksesnya lagi.
- **Cakupan data produksi (11 Okt 2026, sesudah penghapusan data di luar cakupan):** 3.870 peraturan dalam cakupan
  (UU 1.950, PP 1.750, Perppu 168, Tap MPR 2) dengan 53.119 baris pasal; 3.456 berstatus 'lengkap' (punya teks pasal,
  sebagian mungkin tersimpan tak utuh, lihat berikut) dan 414 'menunggu'. Katalog masih menyapu: UU di daftar pasal.id
  berjumlah 1.901 dan PP jauh lebih banyak daripada 1.750 (kursor lama menandakan ±5.000), sehingga angka ini naik, dengan
  status 'menunggu'. Belum ada UUD 1945 di D1: pasal.id mengenali `type=UUD` (5 dokumen, mis. `/akn/id/act/uud/1945/perubahan-4`), jadi
  sapuan katalog akan mencatatnya (teksnya menunggu akses pasal.id); `TAP_MPR` dicoba oleh sapuan (hasilnya di
  `katalog_dukungan:*`), dan yang tak tersedia masuk lewat impor BPK.
- **Ekstraksi pasal sebagian.** Sebelum teksnya ditutup, banyak undang-undang besar tersimpan sebagian (UU 17/2023: 59 dari
  458 pasal; UU 27/2009: Pasal 1 dan 400-408 dari 408; KUHAP 39 dari 286), polanya pasal yang punya ayat lenyap.
  Ukurannya: 2.190 dari 3.456 peraturan 'lengkap' bernomor pasal bercelah (perkiraan 63.888 pasal hilang; 574 dengan celah
  lebih dari 20 nomor); halaman baca memberi tahu pembaca bila penomoran bercelah. Pengurai sudah diperbaiki untuk simpul
  yatim dan ayat/butir bersaudara (`ratakanPohonPasal`), tetapi bentuk respons nyata
  belum pernah terlihat; ringkasannya akan tersimpan di `sync_state` kunci `diagisi:*` begitu pasal.id memberi teks lagi,
  dan pemeliharaan harian mengantrekan ulang yang tersimpan sebagian (150 sehari, terparah dulu) begitu akses pulih.
- Teks hasil ekstraksi versi lama masih memuat sisa: 401 peraturan punya baris pasal ber-id `~n` (umumnya bagian
  Penjelasan yang memakai ulang nomor pasal; UU 13/2003 punya 72 baris seperti itu dan UU 11/2020 744) dan 289
  memuat teks "PENJELASAN" di dalam baris pasalnya. Parser saat ini berhenti di judul "PENJELASAN"; antarmuka
  memisahkan keduanya dan merapikan penanda halaman PDF ("### Page 97 PRESIDEN REPUBLIK INDONESIA- 18 -") saat
  dibaca, tetapi datanya baru bersih setelah peraturan diekstrak ulang.
- PDF hasil pindai (mis. KUHP, UU 1/2023) diekstrak dengan salah baca OCR (kata menempel, nomor pasal bergeser);
  angka nol yang terbaca huruf O ("Pasal 1O") dirapikan saat dibaca dan saat ingest, selebihnya hanya ekstraksi
  ulang dengan sumber yang lebih baik yang memperbaikinya. Dari 1.577 ekstraksi PDF di produksi: 1.103 bersih,
  146 rusak ringan, 7 rusak berat, 320 tanpa pasal terdeteksi.
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
- Vektor yang yatim karena peraturan diambil ulang kini dicatat di `daftar_hapus` dan dihapus dari Vectorize oleh tik;
  yang menumpuk sebelumnya (21.128 id) sedang dikosongkan bertahap.
- Sisa 28 relasi menggantung ke PP menunjuk peraturan yang memang belum ter-ingest (katalog belum lengkap; ia akan
  tersambung begitu peraturannya tercatat).
- D1 dan R2 berada di Amerika Timur dengan read replication nonaktif, sehingga latensi dari Indonesia tinggi.
- Pembatas laju `/api/tanya` berbasis KV (tidak atomik); sitemap satu berkas (batas protokol 50.000
  URL; produksi memuat 3.870 dalam cakupan) dan memakai URL berparameter.
- Pratinjau tautan hanya ada untuk halaman peraturan (`/peraturan?uri=…`), dengan gambar merek yang sama untuk
  semuanya; halaman lain (mis. hasil pencarian) memakai pratinjau umum situs. WhatsApp dan Telegram menyimpan
  pratinjau per tautan, jadi tautan yang pernah dibagikan sebelum fitur ini ada bisa tetap tampil lama.

## Yang belum ada

- **Skrip panen BPK sudah ada tetapi belum pernah dicoba pada situs BPK sungguhan.** `scripts/bpk-console-harvest.js`
  dijalankan di konsol peramban pada peraturan.bpk.go.id dan bekerja dua tahap. (1) **Penjelajahan** (`jelajah: true`):
  membuka daftar BPK per jenis (UUD, Tap MPR, UU, Perppu, PP; alamat jenis dibaca dari halaman `/Jenis`), halaman demi
  halaman, dan mengirim tiap entri ke `POST /api/impor/tautan`, yang mengenali sitasinya (slug dan teks tautan, tahan
  terhadap "01"/"1", "perpu"/"perppu", dan tiga penulisan Tap MPR) lalu menyimpan `bpk_id` dan alamat rincian peraturan Lexa
  yang sama. Tahap ini diperlukan karena di produksi hanya 3 dari 5.011 PP yang punya tautan BPK. (2) **Panen PDF**:
  bertanya ke Lexa peraturan mana yang perlu teksnya (`GET /api/impor/butuh-teks`), mengunduh PDF-nya (langsung dari
  tautan di daftar, atau lewat halaman rincian yang sekaligus memperbarui judul resmi dan status), dan mengunggahnya
  (`PUT /api/impor/pdf`); Lexa mengekstraknya menjadi pasal. Naskah lama yang di BPK tak berkas ditandai
  (`POST /api/impor/tanpa-berkas`) supaya tak diulang. Ia diuji end-to-end di Chromium terhadap Lexa sungguhan dan situs
  BPK palsu (`e2e/panen.test.mjs`), tetapi susunan halaman BPK yang sebenarnya tak terjangkau dari lingkungan pengembangan,
  jadi jalankan bertahap (uji kering dulu) dan kirim hasil mode `periksa` bila ada yang tak cocok; panduan di
  [docs/pipeline-data.md](docs/pipeline-data.md#panen-bpk-melengkapi-teks). Worker sengaja tak pernah menghubungi BPK
  (di balik Cloudflare managed challenge).
- **Klien server MCP atau halaman web pasal.id.** Teks lengkap hanya dibaca lewat halaman web atau server MCP pasal.id
  (OAuth atau token pribadi, 300 pembacaan per akun per hari); sengaja tidak dibangun sebagai jalur pengambilan massal
  karena itu dirancang untuk pembaca dan asisten AI, dan ketentuan pasal.id melarang menyalin basis datanya. Bila pasal.id
  memberi akses data resmi (surat contoh di docs/pipeline-data.md), pengambilnya cukup menggantikan `getLawMentah` dan
  `uraiDetail` di `lib/pasal.ts`.

## Dokumen

- [docs/analisis-kelayakan-lexa.md](docs/analisis-kelayakan-lexa.md): analisis kelayakan, risiko sumber
  data BPK, estimasi biaya, peta jalan, dan peta fitur.
- [docs/hubungkan-github-cloudflare.md](docs/hubungkan-github-cloudflare.md): menghubungkan repo ini ke
  Worker `lexa` lewat Workers Builds, dengan daftar periksa pasca-deploy dan rollback.
- [docs/pipeline-data.md](docs/pipeline-data.md): pipeline katalog dan isi, akses pasal.id (temuan 11 Okt 2026),
  mengendalikan dan memeriksa pipeline di produksi, dan tindakan produksi.
- [docs/analisis-ux-dan-fitur.md](docs/analisis-ux-dan-fitur.md): analisis lanjutan UI/UX dan fitur (temuan,
  tindakan, peta jalan), memakai Claude Design, memasang ke layar utama, dan daftar periksa di perangkat asli.
- [docs/analisis-lanjutan-pencarian-login-pdf-panen.md](docs/analisis-lanjutan-pencarian-login-pdf-panen.md): analisis
  lanjutan 12 Okt 2026 atas empat catatan pemilik (pencarian berdasarkan judul peraturan, `redirect_uri_mismatch`,
  menu PDF dan fitur lanjutannya, panen lanjutan BPK), temuan data produksi, tindakan yang hanya bisa Anda lakukan,
  dan peta jalan.
