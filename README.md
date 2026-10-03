# Lexa

Pencarian dan penelusuran peraturan perundang-undangan Indonesia, dibangun di atas Cloudflare Workers
(D1, R2, KV, Queues, Vectorize, Workers AI).

> **Status: v0.1 dipulihkan.** Kode di repo ini adalah kode yang sedang berjalan di Worker `lexa` pada
> akun Cloudflare, dipulihkan dari sourcemap-nya. Backend (API) lengkap. **Kode frontend (SPA) dan
> skrip panen BPK belum ada di repo ini** (lihat [Yang belum ada](#yang-belum-ada)).
>
> **Jangan menyalakan deploy otomatis ke produksi sebelum membaca**
> [docs/hubungkan-github-cloudflare.md](docs/hubungkan-github-cloudflare.md). `wrangler.jsonc` memuat
> beberapa nilai yang belum terverifikasi (ditandai `TODO(verifikasi)`) dan sengaja dibuat gagal-aman.

## Yang dilakukan

- **Pencarian hybrid** untuk peraturan dan pasal: jalur sitasi ("UU 13/2003"), kata kunci (FTS5 dengan
  stemmer dan sinonim bahasa Indonesia), dan makna (Vectorize + embedding Workers AI), digabung dengan
  Reciprocal Rank Fusion, di-cache di KV.
- **Telusur** dengan filter dan facet: jenis, tahun, status, instansi, bidang.
- **Detail peraturan**: pasal dan ayat, relasi antar-peraturan (mengubah, mencabut, dasar hukum, dan
  seterusnya), tautan ke naskah resmi di peraturan.bpk.go.id.
- **Tanya Lexa**: jawaban AI yang hanya boleh bersumber dari kutipan pasal yang ditemukan, wajib
  menyebut sumbernya, dan menandai peraturan yang sudah dicabut atau diubah.
- **Akun**: login Google, koleksi pribadi, riwayat percakapan, laporan kesalahan data.
- **Ingest**: Cron harian + Queues menarik data dari API pasal.id; API impor menerima manifest dan PDF
  dari BPK; PDF diekstrak menjadi pasal dengan penilaian kualitas; hasilnya diindeks ke FTS5 dan Vectorize.

## Arsitektur

Satu Worker (`src/worker/index.ts`, Hono) mengerjakan tiga peran: `fetch` (API `/api/*`, `robots.txt`,
`sitemap.xml`), `scheduled` (Cron harian) dan `queue` (konsumer antrean ingest).

| Binding | Layanan | Resource | Fungsi |
|---|---|---|---|
| `DB` | D1 | `lexa-db` | peraturan, pasal, relasi, FTS5, akun, log |
| `CACHE` | KV | `lexa-cache` | cache pencarian, sesi login, pembatas laju |
| `DOCS` | R2 | `lexa-pdfs` | PDF asli (`pdf/…`) dan teks hasil ekstraksi (`teks/…`) |
| `AI` | Workers AI | n/a | embedding, ringkasan, tanya-jawab, `toMarkdown` untuk PDF |
| `VECTORIZE` | Vectorize | **TODO: nama indeks** | vektor per pasal |
| `INGEST_QUEUE` | Queues | `lexa-ingest` (diduga) | antrean ingest; DLQ `lexa-ingest-dlq` |

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

## Struktur repo

```
src/worker/index.ts      titik masuk: fetch + scheduled + queue
src/worker/routes/       api, fitur, dokumen, auth, tanya, koleksi, impor
src/worker/lib/          query (stemmer, parser kueri), search (hybrid + RRF), pasal (klien pasal.id),
                         bpk (parser manifest dan PDF), ingest (pipeline), sesi, auth, cors, bidang
src/worker/env.d.ts      tipe global Env (binding, variabel, secret)
src/shared/types.ts      tipe bersama (direkonstruksi; asalnya hanya berisi tipe)
migrations/              migrasi D1 0000-0004 (direkonstruksi dari skema produksi)
test/                    tes vitest (karakterisasi perilaku v0.1)
docs/                    analisis kelayakan dan panduan koneksi GitHub-Cloudflare
wrangler.jsonc           konfigurasi Worker (ada TODO yang harus diverifikasi)
```

## Memulai

Butuh Node.js 22 atau lebih baru (`.nvmrc`).

```bash
npm ci
cp .dev.vars.example .dev.vars     # isi bila perlu; berkas ini di-ignore Git
npm run check                      # typecheck + tes
npm run d1:migrate:local           # buat D1 lokal dari migrasi
```

- `npm test` mengeksekusi tes vitest. Sebagian tes memvalidasi ekspresi pencarian terhadap FTS5
  sungguhan lewat `node:sqlite`; bila Node Anda tidak menyertakannya, tes itu dilewati.
- `npm run build` hanya membundel Worker (dry run), tanpa login dan tanpa deploy.
- `npm run dev` menjalankan `wrangler dev`. Binding Workers AI dan Vectorize pada dasarnya berjalan di
  sisi Cloudflare, jadi jalur pencarian makna dan tanya-jawab memerlukan login Wrangler dan mode remote.
  Untuk logika murni, andalkan tes.

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
lewat dashboard. Nilainya tidak pernah masuk Git.

## Migrasi D1

Berkas di `migrations/` diberi nomor berurutan. **Jangan mengubah 0000-0004**: nama berkasnya sama
dengan yang tercatat di tabel `d1_migrations` produksi, sehingga dianggap sudah diterapkan di sana.
Perubahan skema baru = berkas baru (`0005_….sql`), lalu terapkan secara sengaja:

```bash
npm run d1:migrate:local     # uji di D1 lokal dulu
npm run d1:migrate:remote    # produksi; jalankan manual, bukan dari pipeline build
```

## Mengubah kode dengan aman

1. Ubah kode, jalankan `npm run check`.
2. Perubahan perilaku wajib disertai tes. Bug yang sudah diketahui didokumentasikan dengan `it.fails`
   (gagal yang diharapkan) atau `it.todo`; saat diperbaiki, `it.fails` akan memberi tahu agar dihapus.
3. Buka pull request. CI (`.github/workflows/ci.yml`) menjalankan typecheck, tes, bundling, dan
   migrasi pada D1 kosong, tanpa secrets.

## Isu yang diketahui

- **Pencarian kata kunci gagal diam-diam untuk kata bertanda hubung** (mis. "perundang-undangan"):
  ekspresi FTS5 tidak dikutip sehingga dibaca sebagai filter kolom dan galatnya ditelan. Terdokumentasi
  di `test/query.test.ts` (`it.fails`).
- Stemmer belum melucuti awalan "be-" ("bekerja" tidak menghasilkan "kerja"), dan nama panjang seperti
  "Peraturan Pemerintah Nomor 35 Tahun 2021" belum dikenali sebagai sitasi (keduanya `it.todo`).
- Sinkronisasi harian sering terhenti oleh batas 60 permintaan/menit API pasal.id; jenis PERMEN, POJK, dan
  PBI tidak bergerak sejak 2 Sep 2026.
- D1 dan R2 berada di Amerika Timur dengan read replication nonaktif, sehingga latensi dari Indonesia tinggi.
- Pembatas laju `/api/tanya` berbasis KV (tidak atomik); sitemap dibatasi 5.000 URL dan memakai URL berparameter.

## Yang belum ada

- **Frontend (SPA).** Komentar di `src/worker/index.ts` menyebut permintaan non-API "jatuh ke static
  assets SPA", tetapi kodenya tidak ikut ter-bundle ke Worker sehingga tidak bisa dipulihkan dari
  sourcemap. Bila Worker produksi memang melayani aset statis, lihat peringatan di
  [docs/hubungkan-github-cloudflare.md](docs/hubungkan-github-cloudflare.md).
- **Skrip panen BPK.** `cors.ts` hanya mengizinkan origin `peraturan.bpk.go.id`, yang menunjukkan panen
  dijalankan dari sesi peramban di situs BPK lalu mengirim data ke `/api/impor/*`. Skripnya tidak ada di
  repo ini.

## Dokumen

- [docs/analisis-kelayakan-lexa.md](docs/analisis-kelayakan-lexa.md): analisis kelayakan, risiko sumber
  data BPK, estimasi biaya, peta jalan, dan peta fitur.
- [docs/hubungkan-github-cloudflare.md](docs/hubungkan-github-cloudflare.md): menghubungkan repo ini ke
  Worker `lexa` lewat Workers Builds, dengan urutan yang aman.
