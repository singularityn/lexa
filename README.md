# Lexa

Pencarian dan penelusuran peraturan perundang-undangan Indonesia, dibangun di atas Cloudflare Workers
(D1, R2, KV, Queues, Vectorize, Workers AI) dengan antarmuka web tanpa langkah build.

> **Status: v0.2.** Backend adalah kode v0.1 yang berjalan di Worker `lexa` (dipulihkan dari sourcemap
> produksi dan terbukti identik), dengan perbaikan bug yang ditemukan lewat tes. Antarmuka (`public/`)
> ditulis baru karena frontend v0.1 tidak ikut dalam bundel Worker. Cara menyambungkan repo ini ke
> Cloudflare dan memeriksa hasilnya ada di
> [docs/hubungkan-github-cloudflare.md](docs/hubungkan-github-cloudflare.md).

## Yang dilakukan

- **Pencarian hybrid** untuk peraturan dan pasal: jalur sitasi ("UU 13/2003"), kata kunci (FTS5 dengan
  stemmer dan sinonim bahasa Indonesia), dan makna (Vectorize + embedding Workers AI), digabung dengan
  Reciprocal Rank Fusion, di-cache di KV. Tiga mode: Gabungan, Kata kunci, Makna.
- **Telusur** dengan filter dan facet: jenis, tahun, status, instansi, bidang.
- **Detail peraturan**: pasal dan ayat, pencarian di dalam peraturan, relasi antar-peraturan (mengubah,
  mencabut, dasar hukum, dan seterusnya) beserta peta relasi dua arah, tautan ke naskah resmi di
  peraturan.bpk.go.id, PDF dan teks hasil konversi bila sudah diarsipkan, lapor kesalahan data.
- **Tanya Lexa**: jawaban AI yang hanya boleh bersumber dari kutipan pasal yang ditemukan, wajib
  menyebut sumbernya, dan menandai peraturan yang sudah dicabut atau diubah.
- **Akun opsional**: login Google, koleksi pribadi dengan catatan (tamu menyimpannya di perangkat; saat
  masuk, koleksi perangkat digabung ke akun tanpa menimpa catatan), riwayat percakapan.
- **Ingest**: Cron harian + Queues menarik data dari API pasal.id; API impor menerima manifest dan PDF
  dari BPK; PDF diekstrak menjadi pasal dengan penilaian kualitas; hasilnya diindeks ke FTS5 dan Vectorize.

## Arsitektur

Satu Worker (`src/worker/index.ts`, Hono) mengerjakan tiga peran: `fetch` (API `/api/*`, `robots.txt`,
`sitemap.xml`), `scheduled` (Cron harian) dan `queue` (konsumer antrean ingest). Selain rute itu,
permintaan dilayani sebagai aset statis dari `public/` dengan fallback ke `index.html` (rute sisi klien).

| Binding | Layanan | Resource | Fungsi |
|---|---|---|---|
| `DB` | D1 | `lexa-db` | peraturan, pasal, relasi, FTS5, akun, log |
| `CACHE` | KV | `lexa-cache` | cache pencarian, sesi login, pembatas laju |
| `DOCS` | R2 | `lexa-pdfs` | PDF asli (`pdf/…`) dan teks hasil ekstraksi (`teks/…`) |
| `AI` | Workers AI | n/a | embedding, ringkasan, tanya-jawab, `toMarkdown` untuk PDF |
| `VECTORIZE` | Vectorize | `lexa-index` | vektor per pasal (bge-m3, 1024 dimensi, cosine) |
| `INGEST_QUEUE` | Queues | `lexa-ingest` | antrean ingest; DLQ `lexa-ingest-dlq` |

Cron: harian pukul 19:00 UTC (02:00 WIB). Skema D1 dan alasan desainnya ada di `migrations/`.

### Endpoint API

| Kelompok | Endpoint |
|---|---|
| Pencarian dan telusur | `GET /api/search`, `GET /api/laws`, `GET /api/laws/detail?uri=`, `GET /api/suggest`, `GET /api/bidang`, `GET /api/relasi/graf`, `GET /api/stats` |
| Dokumen | `GET /api/dokumen/status`, `GET /api/dokumen/pdf`, `GET /api/dokumen/teks` |
| Tanya Lexa | `POST /api/tanya` (dibatasi laju per IP) |
| Akun | `GET /api/auth/status`, `GET /api/auth/google`, `GET /api/auth/google/callback`, `PATCH /api/auth/profil`, `POST /api/auth/keluar`; koleksi: `GET/PUT/DELETE /api/koleksi`, `POST /api/koleksi/gabung` |
| Laporan | `POST /api/laporan` |
| Admin (header `x-admin-token`) | `POST /api/admin/sync`, `GET /api/admin/ukur`, `GET /api/admin/laporan`, `GET /api/admin/kueri-nihil`, `GET /api/admin/cek-token` (diagnosis, hanya boolean) |
| Impor dari BPK (header `x-admin-token`) | `POST /api/impor/manifest`, `PUT /api/impor/pdf` |

Rute memakai mode ketat: `/api/tanya/` dan `/api/koleksi/` (dengan garis miring penutup) dijawab 404.

### Antarmuka

HTML, CSS, dan modul ES di `public/`; tanpa framework, tanpa langkah build, tanpa aset pihak ketiga.
Rute: `/` beranda, `/cari`, `/telusuri`, `/peraturan?uri=…` (sama dengan URL pada sitemap), `/tanya`,
`/koleksi`, `/akun`, `/tentang`, `/status`. Seluruh teks dinamis dimasukkan sebagai simpul teks (tanpa
`innerHTML`), CSP ketat lewat `public/_headers`, dan JavaScript-nya dicek tipenya (`checkJs`) lewat
`tsconfig.web.json`.

## Struktur repo

```
src/worker/index.ts      titik masuk: fetch + scheduled + queue
src/worker/routes/       api, fitur, dokumen, auth, tanya, koleksi, impor
src/worker/lib/          query (stemmer, parser kueri), search (hybrid + RRF), pasal (klien pasal.id),
                         bpk (parser manifest dan PDF), ingest (pipeline), sesi, auth, cors, bidang, d1
src/worker/env.d.ts      tipe global Env (binding, variabel, secret)
src/shared/types.ts      tipe bersama
public/                  antarmuka (index.html, css/, js/, _headers, favicon)
migrations/              migrasi D1 0000-0004 (direkonstruksi dari skema produksi)
test/                    tes unit; test/integration: Worker asli di atas SQLite sungguhan
e2e/                     tes antarmuka di Chromium
scripts/                 pratinjau lokal (dev-node.ts) dan data contoh
docs/                    analisis kelayakan dan panduan koneksi GitHub-Cloudflare
wrangler.jsonc           konfigurasi Worker
```

## Memulai

Butuh Node.js 22 atau lebih baru (`.nvmrc`).

```bash
npm ci
npm run check            # typecheck (Worker + antarmuka) + ratusan tes
npm run dev:node         # pratinjau lokal di http://localhost:8787, tanpa akun Cloudflare
npm run e2e              # tes antarmuka di Chromium (butuh: npx playwright-core install chromium)
npm run d1:migrate:local # buat D1 lokal dari migrasi
cp .dev.vars.example .dev.vars   # hanya untuk wrangler dev; berkas ini di-ignore Git
```

- **`npm run dev:node`** menjalankan Worker asli dan antarmuka di atas SQLite sungguhan dengan 11 peraturan
  contoh (parafrase singkat, **bukan naskah resmi**; ada pita peringatan di layar). Workers AI, Vectorize,
  KV, R2, dan Queue berupa tiruan, sehingga pencarian makna dan jawaban Tanya Lexa hanya peragaan. "Masuk
  dengan Google" diganti masuk instan sebagai pengguna uji agar alur akun bisa dicoba.
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
| `SEARCH_CACHE_TTL` | variabel | TTL cache pencarian dalam detik (bawaan 3600) |
| `ADMIN_TOKEN` | secret | token untuk `/api/admin/*` dan `/api/impor/*` |
| `PASAL_API_TOKEN` | secret | token API pasal.id; tanpa ini sinkronisasi terjadwal dilewati |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | secret | login Google; tanpa ini aplikasi berjalan sebagai tamu |

Secret dipasang dengan `npx wrangler secret put NAMA` (jangan lewat pipa, newline ikut tersimpan) atau
lewat dashboard. Nilainya tidak pernah masuk Git. Variabel teks saat ini dipertahankan dari dashboard
(`keep_vars` di `wrangler.jsonc`).

## Migrasi D1

Berkas di `migrations/` diberi nomor berurutan. **Jangan mengubah 0000-0004**: nama berkasnya sama
dengan yang tercatat di tabel `d1_migrations` produksi, sehingga dianggap sudah diterapkan di sana.
Perubahan skema baru = berkas baru (`0005_….sql`), lalu terapkan secara sengaja:

```bash
npm run d1:migrate:local     # uji di D1 lokal dulu
npm run d1:migrate:remote    # produksi; jalankan manual, bukan dari pipeline build
```

## Mengubah kode dengan aman

1. Ubah kode, jalankan `npm run check` (dan `npm run e2e` bila menyentuh antarmuka).
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
- `/api/suggest?q=%%` cocok dengan semua judul.

## Isu yang diketahui

- Stemmer belum melucuti awalan "be-" ("bekerja" tidak menghasilkan "kerja"), dan nama panjang seperti
  "Peraturan Pemerintah Nomor 35 Tahun 2021" belum dikenali sebagai sitasi (keduanya `it.todo`).
- Ambang relevansi Tanya Lexa berbasis peringkat RRF, bukan kemiripan mutlak: enam hasil vektor teratas
  selalu lolos untuk kueri apa pun. Perlindungan utamanya prompt yang tegas; ambang sesungguhnya butuh skor
  kosinus dari Vectorize.
- Vektor lama tidak dihapus dari Vectorize saat peraturan diingest ulang (disaring saat pencarian, tetapi
  menumpuk).
- D1 dan R2 berada di Amerika Timur dengan read replication nonaktif, sehingga latensi dari Indonesia tinggi.
- Pembatas laju `/api/tanya` berbasis KV (tidak atomik); sitemap dibatasi 5.000 URL dan memakai URL
  berparameter.
- Halaman peraturan dirender di klien; untuk SEO yang baik, judul dan deskripsi perlu disisipkan dari Worker.

## Yang belum ada

- **Skrip panen BPK.** `cors.ts` hanya mengizinkan origin `peraturan.bpk.go.id`, yang menunjukkan panen
  dijalankan dari sesi peramban di situs BPK lalu mengirim data ke `/api/impor/*`. Skripnya
  (`scripts/bpk-console-harvest.js` menurut komentar kode) tidak ada di repo ini.

## Dokumen

- [docs/analisis-kelayakan-lexa.md](docs/analisis-kelayakan-lexa.md): analisis kelayakan, risiko sumber
  data BPK, estimasi biaya, peta jalan, dan peta fitur.
- [docs/hubungkan-github-cloudflare.md](docs/hubungkan-github-cloudflare.md): menghubungkan repo ini ke
  Worker `lexa` lewat Workers Builds, dengan daftar periksa pasca-deploy dan rollback.
