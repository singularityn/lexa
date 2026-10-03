# Menghubungkan repo GitHub ke Worker `lexa`

Panduan ini menyelesaikan koneksi `singularityn/lexa` ke Worker `lexa` yang **sudah berjalan** di akun
Cloudflare lewat **Workers Builds** (integrasi Git bawaan Cloudflare: build dan deploy otomatis saat push,
URL pratinjau per branch/PR, dan check run di GitHub). Langkah di dashboard hanya bisa dilakukan pemilik akun.

## Keadaan repo saat ini

- Kode Worker identik byte-per-byte dengan produksi v0.1 (terverifikasi lewat sourcemap), ditambah perbaikan
  bug yang ditemukan lewat tes (lihat README, "Riwayat perubahan penting").
- `wrangler.jsonc` sudah lengkap: Vectorize `lexa-index`, antrean `lexa-ingest`, D1/KV/R2/AI, cron harian,
  dan aset statis dari `./public`. Tidak ada lagi placeholder yang membuat deploy ditolak.
- Antarmuka (SPA) ada di `public/`. Frontend v0.1 tidak bisa dipulihkan (tidak ikut dalam bundel Worker),
  jadi repo ini membawa antarmuka baru.
- `npm run check` (typecheck + tes) lolos, `npm run build` (`wrangler deploy --dry-run`) menampilkan 6
  binding dan 36 aset, dan CI GitHub hijau (termasuk tes e2e di Chromium).

## Yang berubah pada deploy pertama dari Git

Deploy dari Git **menimpa pengaturan Worker dengan isi `wrangler.jsonc`**. Rinciannya:

| Hal | Efek pada deploy pertama |
|---|---|
| Kode Worker | diganti dengan kode repo (sama dengan produksi + perbaikan bug) |
| Antarmuka di URL dasar | **diganti** dengan `public/`. Bila sebelumnya ada UI lama, ia tidak ikut dipertahankan (lihat Rollback) |
| Binding `DB`, `CACHE`, `DOCS`, `AI`, `VECTORIZE`, `INGEST_QUEUE` | ditetapkan sesuai berkas. **Binding lain yang hanya ada di dashboard akan terlepas** (kode tidak memakai yang lain) |
| Variabel teks (`EMBEDDING_MODEL`, `SUMMARY_MODEL`, `BPK_BASE`, `PASAL_API_BASE`, `SEARCH_CACHE_TTL`) | dipertahankan (`keep_vars: true`) |
| Secret (`ADMIN_TOKEN`, `PASAL_API_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) | tidak tersentuh |
| Cron | ditetapkan `0 19 * * *` (sesuai jam eksekusi di log sinkronisasi) |
| Konsumer antrean (batch, retry, jeda, konkurensi, DLQ) | **tidak tersentuh**: sengaja tidak dideklarasikan |
| Compatibility date | `2026-08-05` (diperkirakan dari tanggal pembuatan Worker) |
| Observability, placement, limits, rute/domain khusus | tidak dicantumkan; periksa di dashboard setelah deploy |

Bila ada pengaturan di dashboard yang tidak ada dalam daftar di atas (mis. binding tambahan atau domain
khusus), catat dulu: itu yang perlu dicocokkan sebelum deploy produksi.

## Langkah

### 1. Branch

Repo awalnya kosong, sehingga branch yang pertama kali di-push (`claude/zealous-brown-63ek65`) menjadi
branch default di GitHub. `main` sudah dibuat dari commit yang sama dan terus diperbarui.

1. GitHub > **Settings > Branches > Default branch**: ubah ke `main`.
2. Cloudflare > Workers & Pages > `lexa` > **Settings > Builds > Branch control**: **Production branch** = `main`.
3. Setelah keduanya beres, hapus branch lama: `git push origin --delete claude/zealous-brown-63ek65`
   (GitHub menolak menghapus branch default, jadi lakukan setelah langkah 1).

### 2. Pengaturan build

Cloudflare > `lexa` > **Settings > Builds**:

| Kolom | Nilai |
|---|---|
| Root directory | `/` |
| Build command | `npm run check` (typecheck + tes; dependensi dipasang otomatis dari `package-lock.json`; Node mengikuti `.nvmrc` = 22) |
| Deploy command | `npx wrangler deploy` |
| Non-production branch deploy command | `npx wrangler versions upload` (bawaan) |
| Build non-production branches | aktif |

Nama Worker di dashboard (`lexa`) harus sama persis dengan `name` di `wrangler.jsonc`; kalau tidak, build gagal.
`npm run check` sengaja tidak menjalankan tes e2e (butuh peramban); itu dikerjakan CI GitHub.

> Ingin lebih hati-hati? Pakai `npx wrangler deploy --dry-run` sebagai Deploy command untuk satu putaran:
> build memverifikasi konfigurasi dan bundel tanpa mengubah Worker produksi. Lalu ganti ke `npx wrangler deploy`.

### 3. Lihat dulu di URL pratinjau (tanpa memengaruhi produksi)

Push ke branch selain `main` (atau buka pull request): Workers Builds mengunggah versi baru tanpa
mengaktifkannya dan memasang URL pratinjau serta check run **Workers Builds: lexa** di GitHub.

- Buka URL pratinjau: beranda, `/cari?q=pesangon`, `/telusuri`, satu halaman peraturan, `/tanya`.
- API: `/api/stats`, `/api/search?q=pesangon`, `/api/laws?per_page=5`, `/robots.txt`, `/sitemap.xml`.

> Pratinjau memakai **resource produksi yang sama** (D1, KV, R2, Queue) kecuali Anda mengatur isolasi di
> pengaturan Previews. Cron dan konsumer antrean tidak berjalan di pratinjau. Hindari memicu endpoint penulisan
> (`/api/admin/*`, `/api/impor/*`) dari pratinjau. Pencarian dan koleksi tamu bersifat baca/lokal sehingga aman.

### 4. Deploy produksi

Push ke `main` (atau **Retry build** pada build terakhir) setelah Deploy command diset ke `npx wrangler deploy`.
Siapkan Rollback (di bawah) sebelum mulai.

### Daftar periksa pasca-deploy pertama

| Periksa | Di mana | Harapan |
|---|---|---|
| Versi aktif | Deployments | versi baru bersumber GitHub, aktif |
| Antarmuka | buka URL dasar | beranda Lexa tampil dengan statistik; `/tentang` dibuka langsung tanpa 404 |
| Binding | Settings > Bindings | `DB`, `CACHE`, `DOCS`, `AI`, `VECTORIZE`, `INGEST_QUEUE` utuh |
| Variabel | Settings > Variables and secrets | kelima variabel teks dan keempat secret masih ada |
| Cron | Settings > Trigger events | `0 19 * * *` |
| Konsumer antrean | Queues > lexa-ingest | masih terhubung ke `lexa`, DLQ dan retry seperti sebelumnya |
| API | `/api/stats`, `/api/search?q=pesangon`, `/robots.txt`, `/sitemap.xml` | 200 dengan data |
| Pencarian kata bertanda hubung | `/cari?q=perundang-undangan&mode=keyword` | ada hasil (bug lama: nihil) |
| Token admin | `GET /api/admin/cek-token` dengan header `x-admin-token` | `secret_terpasang: true`, `cocok: true` |
| Login Google (bila diaktifkan) | `/akun` > Masuk dengan Google | kembali ke Lexa dalam keadaan masuk |
| Cron berjalan | D1: `SELECT * FROM sync_log ORDER BY id DESC LIMIT 5;` | entri `jadwal_sinkronisasi` baru sekitar 19:00 UTC |

Setelah beberapa hari, lihat `sync_log` dan `/status`: jenis PERMEN, POJK, dan PBI seharusnya mulai bergerak
(perbaikan pembuangan pesan saat kena batas laju pasal.id).

### Rollback

Dashboard > `lexa` > **Deployments** > pilih versi sebelumnya > **Rollback** (atau `npx wrangler rollback`).
Rollback mengembalikan kode, konfigurasi, **dan aset statis** versi itu, jadi UI lama (bila ada) kembali.
Rollback **tidak** mengembalikan data D1 maupun migrasi yang sudah diterapkan.

## Migrasi D1 dan pipeline

Jangan menjalankan migrasi dari build. Terapkan secara sengaja sebelum men-deploy kode yang membutuhkannya:
`npm run d1:migrate:remote`. Rancang migrasi agar kompatibel mundur (tambah dulu, hapus kemudian), supaya
rollback kode tetap aman. Sebelum migrasi besar, catat bookmark D1 Time Travel. Perbaikan di v0.2 **tidak**
memerlukan migrasi baru.

## Rahasia

Rahasia tidak pernah masuk Git. Karena deploy dilakukan oleh Workers Builds di sisi Cloudflare, GitHub
Actions **tidak** membutuhkan token Cloudflare; CI di repo ini (`.github/workflows/ci.yml`) hanya menjalankan
typecheck, tes, bundling, migrasi pada D1 kosong, dan tes e2e.

## Jebakan yang perlu diingat

- Nama Worker di dashboard harus sama dengan `name` di `wrangler.jsonc`.
- Variabel yang hanya ada di dashboard dihapus oleh deploy kecuali tercantum di `vars` atau `keep_vars` aktif.
- `wrangler.jsonc` adalah sumber kebenaran untuk yang dicantumkannya: setelan yang diubah manual di dashboard
  akan tertimpa deploy berikutnya. Ubah lewat Git. (Pengecualian: konsumer antrean, observability, dan
  setelan lain yang sengaja tidak dicantumkan.)
- Mendeklarasikan `queues.consumers` di `wrangler.jsonc` menimpa pengaturan konsumer di dashboard dengan nilai
  bawaan (batch 10, retry 3). Pipeline ingest bergantung pada retry yang lebih longgar, jadi cocokkan dulu
  bila ingin memindahkannya ke Git.
- Memutus koneksi: Settings > Builds > Disconnect. Worker tetap berjalan dengan versi terakhir.

## Alternatif: deploy lewat GitHub Actions

Bila Anda memilih tidak memakai Workers Builds, tambahkan secret repo `CLOUDFLARE_API_TOKEN` dan
`CLOUDFLARE_ACCOUNT_ID` lalu langkah deploy dengan `cloudflare/wrangler-action`. Itu sengaja tidak
dikonfigurasi di sini karena butuh token berhak tulis ke akun Anda.
