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
- `npm run check` (typecheck + tes) lolos, `npm run build` (`wrangler deploy --dry-run`) menampilkan 7
  binding (termasuk `ASSETS`, aset statis yang dipakai pratinjau tautan) dan 55 aset, dan CI GitHub hijau
  (termasuk tes e2e di Chromium).

## Yang berubah pada deploy pertama dari Git

Deploy dari Git **menimpa pengaturan Worker dengan isi `wrangler.jsonc`**. Rinciannya:

| Hal | Efek pada deploy pertama |
|---|---|
| Kode Worker | diganti dengan kode repo (sama dengan produksi + perbaikan bug) |
| Antarmuka di URL dasar | **diganti** dengan `public/`. Bila sebelumnya ada UI lama, ia tidak ikut dipertahankan (lihat Rollback) |
| Binding `DB`, `CACHE`, `DOCS`, `AI`, `VECTORIZE`, `INGEST_QUEUE`, `ASSETS` | ditetapkan sesuai berkas. **Binding lain yang hanya ada di dashboard akan terlepas** (kode tidak memakai yang lain) |
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
branch default di GitHub. Semua pekerjaan kini ada di `main`, dan branch lama hanyalah leluhur `main`
(semua commitnya sudah ada di `main`).

1. GitHub > **Settings > Branches > Default branch**: `main`. (Selesai.)
2. Cloudflare > Workers & Pages > `lexa` > **Settings > Builds > Branch control**: **Production branch** = `main`.
   (Selesai.)
3. Branch lama dihapus setelah keduanya beres: `git push origin --delete claude/zealous-brown-63ek65`
   (GitHub menolak menghapus branch default, jadi ini baru bisa setelah langkah 1). Bila perlu dipulihkan, SHA
   ujungnya `24efcd5`.

### 2. Pengaturan build

Cloudflare > `lexa` > **Settings > Builds**:

| Kolom | Nilai |
|---|---|
| Root directory | `/` |
| Build command | `npm run check` (typecheck + tes; dependensi dipasang otomatis dari `package-lock.json`; Node mengikuti `.nvmrc` = 22) |
| Deploy command | `npx wrangler deploy` |
| Preview command (cabang selain produksi) | lihat catatan di bawah |

Nama Worker di dashboard (`lexa`) harus sama persis dengan `name` di `wrangler.jsonc`; kalau tidak, build gagal.
`npm run check` sengaja tidak menjalankan tes e2e (butuh peramban); itu dikerjakan CI GitHub.

> **Pratinjau cabang.** Worker yang baru disambungkan memakai *Worker Previews*: cabang selain produksi
> menjalankan **Preview command** (`npx wrangler preview`), bukan deploy. Pratinjau **tidak mewarisi** binding
> produksi dan membutuhkan blok `previews` di `wrangler.jsonc` dengan sumber daya uji. Lexa belum punya D1/KV/R2
> uji, jadi blok itu sengaja tidak ada: build pratinjau sebuah cabang dapat gagal atau menghasilkan URL tanpa
> binding (antarmuka tampil, API tidak). Jangan menunjuk binding `previews` ke sumber daya produksi, karena
> pratinjau lalu bisa menulis ke data produksi. Cara termudah: matikan **Enable Preview Builds** di Branch
> control, atau abaikan galat build cabang. (Worker yang disambungkan sebelum fitur ini memakai model lama:
> "Non-production branch deploy command" `npx wrangler versions upload`, yang memakai resource produksi.)
> Untuk melihat perubahan sebelum produksi, pakai `npm run dev:node` (lihat README) atau `npx wrangler dev`.

### 3. Deploy produksi

Setiap push ke production branch (`main`) otomatis menjalankan build command lalu deploy command.

> **Jangan memakai "Retry build" untuk men-deploy `main` terbaru.** Retry mengulang *commit yang sama* dari
> build lama itu (dengan pengaturan build saat ini), bukan ujung `main` sekarang; build lama bisa saja berasal
> dari cabang lain atau commit awal. Yang benar: dorong commit baru ke `main` (atau pakai API Builds
> "Trigger a manual build" dengan `{"branch": "main"}`). "Retry build" hanya berguna untuk mengulang build yang
> gagal karena galat sesaat (mis. jaringan) pada commit yang memang ingin Anda bangun.

Siapkan Rollback (di bawah) sebelum mulai.

> Ingin lebih hati-hati? Pakai `npx wrangler deploy --dry-run` sebagai Deploy command untuk satu putaran:
> build memverifikasi konfigurasi dan bundel tanpa mengubah Worker produksi. Lalu ganti ke `npx wrangler deploy`.

### Daftar periksa pasca-deploy pertama

| Periksa | Di mana | Harapan |
|---|---|---|
| Versi aktif | Deployments | versi baru bersumber GitHub, aktif |
| Antarmuka | buka URL dasar | beranda Lexa tampil dengan statistik; `/tentang` dibuka langsung tanpa 404 |
| Binding | Settings > Bindings | `DB`, `CACHE`, `DOCS`, `AI`, `VECTORIZE`, `INGEST_QUEUE`, `ASSETS` utuh |
| Variabel | Settings > Variables and secrets | kelima variabel teks dashboard dan keempat secret masih ada, ditambah `CAKUPAN_JENIS` (dari `wrangler.jsonc`) |
| Cron | Settings > Trigger events | `0 19 * * *` |
| Konsumer antrean | Queues > lexa-ingest | masih terhubung ke `lexa`, DLQ dan retry seperti sebelumnya |
| API | `/api/stats`, `/api/search?q=pesangon`, `/robots.txt`, `/sitemap.xml` | 200 dengan data |
| Pencarian kata bertanda hubung | `/cari?q=perundang-undangan&mode=keyword` | ada hasil (bug lama: nihil) |
| Sitasi nama panjang | `/cari?q=Peraturan Pemerintah Pengganti Undang-Undang Nomor 2 Tahun 2022` | Perppu 2/2022 di urutan pertama berlabel "Sitasi" (bukan UU 2/2022) |
| Cakupan | `/api/stats` | `cakupan: ["UUD","TAP_MPR","UU","PERPPU","PP"]`; `total_peraturan` hanya yang dalam cakupan (3.5xx, bukan 5.6xx) |
| Peraturan di luar cakupan | `/peraturan?uri=/akn/id/act/perpres/2022/1` (Perpres apa pun yang tersimpan) dan `/cari?q=Perpres 22/2015` | halaman "Peraturan ini di luar cakupan Lexa"; hasil pencarian dengan catatan "Lexa belum memuat peraturan jenis PERPRES" |
| Sitemap | `/sitemap.xml` | hanya URL UU, PP, Perppu, dan Tap MPR |
| Relasi ke Perppu | `/peraturan?uri=/akn/id/act/uu/1998/10`, tab Relasi | "PERPU No. 2 Tahun 2022" berupa tautan aktif ke halaman Perppu 2/2022 (dulu teks mati) |
| Pratinjau tautan | `curl -s -A 'WhatsApp/2' 'URL/peraturan?uri=/akn/id/act/uu/2003/13' \| grep -E 'og:(title\|image)'` (tanpa `-A`, seperti pembaca biasa, jawabannya cangkang umum) | `og:title` "UU 13/2003 …" dan `og:image` berupa alamat mutlak ke `/og/lexa.png`; untuk peraturan yang tidak ada, pratinjau umum situs ("Lexa: cari peraturan perundang-undangan Indonesia") |
| Gambar pratinjau | `/og/lexa.png` | 200, `image/png` |
| Token admin | `GET /api/admin/cek-token` dengan header `x-admin-token` | `secret_terpasang: true`, `cocok: true` |
| Login Google (bila diaktifkan) | `/akun` > Masuk dengan Google | kembali ke Lexa dalam keadaan masuk |
| Cron berjalan | D1: `SELECT * FROM sync_log ORDER BY id DESC LIMIT 5;` | entri `jadwal_sinkronisasi` baru sekitar 19:00 UTC |

Setelah beberapa hari, lihat `sync_log` dan `/status`: entri `jadwal_sinkronisasi` hanya menyebut `UU,PERPPU,PP`
(tidak ada lagi PERPRES, PERMEN, POJK, dan PBI), dan "rate limit pada PERPRES" tidak muncul lagi. Pesan lama untuk
jenis di luar cakupan yang masih ada di antrean dibuang konsumer tanpa menyentuh pasal.id.

### Pemulihan data sinkronisasi (opsional, SETELAH deploy ini aktif)

Kode v0.1 membuang pesan yang sudah terkumpul setiap kali Cron kena batas laju, padahal kursor offset sudah
maju. Di produksi (4 Okt 2026) kursor melampaui isi database: `offset:PP` = 4400 sedangkan hanya 1.422 PP yang
tersimpan (pasal.id sedikitnya memuat ±4.400 PP). Kursor tidak mundur sendiri, jadi halaman yang terlewat baru
terjangkau setelah kursor berputar penuh. Sesudah cakupan dibatasi, PERPRES tak lagi menghabiskan jatah laju
sehingga PP bergerak setiap hari dan putarannya selesai dalam hitungan hari; mengulang dari awal tidak lagi
perlu, hanya mempercepat. Perhatikan bebannya: itu berarti ±3.000 PP tambahan (peraturan, pasal, vektor, dan
ringkasan AI), yang tetap dalam cakupan. Bila ingin memindai ulang sekarang, jalankan di D1 (dashboard > D1 >
`lexa-db` > Console, atau `npx wrangler d1 execute lexa-db --remote`):

```sql
UPDATE sync_state SET value = '0' WHERE key IN ('offset:UU', 'offset:PERPPU', 'offset:PP');
DELETE FROM sync_state WHERE key = 'jenis_awal';
```

Aman diulang: sapuan hanya mengantrekan peraturan yang belum ada, berubah status, atau masih kosong. Antrean
diproses ≤60 permintaan/menit dan Cron berhenti mengantrekan bila lebih dari 400 peraturan dalam cakupan menunggu
isinya, jadi pemulihan berjalan bertahap selama beberapa hari. Pantau lewat `/status` (jumlah peraturan naik) dan
`SELECT COUNT(*) FROM laws WHERE jenis IN ('UUD','TAP_MPR','UU','PERPPU','PP');`.

### Cakupan peraturan

Lexa hanya memuat UUD dan setara (Tap MPR), undang-undang termasuk Perppu, dan peraturan pemerintah; daftarnya di
`vars.CAKUPAN_JENIS` pada `wrangler.jsonc` (bawaan di `src/shared/cakupan.ts`, dijaga sama oleh tes). Cara kerjanya ada di
[README](../README.md#cakupan-peraturan). Dua operasi yang perlu langkah sadar:

**Melebarkan cakupan** (mis. menambah Perpres): tambahkan kodenya di `CAKUPAN_JENIS`, deploy, lalu jalankan
sinkronisasi (Cron akan menyapunya bila kodenya dikenal pasal.id: `UU`, `PERPPU`, `PP`, `PERPRES`, `PERMEN`, `POJK`, `PBI`).
Baris yang sudah tersimpan langsung tampil lagi. Hasil pencarian lama di KV tidak ikut terpakai karena cakupan menjadi
bagian kunci cache. Kursor sapuan jenis tambahan (`offset:PERPRES`, dst.) masih menyimpan nilai lamanya; setel ke 0 bila
ingin memindai dari awal.

**Menghapus data di luar cakupan** (opsional, TIDAK dilakukan otomatis, tidak bisa dibatalkan kecuali lewat D1 Time
Travel): baris-barisnya hanya disembunyikan. Menghapusnya mengecilkan D1 dan indeks FTS5 (±22% baris pasal pada
4 Okt 2026), tetapi melebarkan cakupan kelak berarti menarik ulang dari pasal.id (≤360 peraturan per jam). Urutannya:

1. Catat bookmark Time Travel: `npx wrangler d1 time-travel info lexa-db`.
2. Lihat dulu yang akan dihapus (hanya baca):

   ```sql
   SELECT jenis, COUNT(*) AS peraturan, SUM(jumlah_pasal) AS pasal FROM laws
    WHERE jenis NOT IN ('UUD','TAP_MPR','UU','PERPPU','PP') GROUP BY jenis;
   ```

3. Hapus dari D1, anak lebih dulu, dalam potongan agar tiap pernyataan tidak terlalu berat (pemicu FTS5 ikut
   menghapus entri indeks). Ulangi pasangan pertama sampai `changes` 0, lalu jalankan sisanya:

   ```sql
   DELETE FROM articles WHERE rowid IN (
     SELECT rowid FROM articles WHERE frbr_uri IN
       (SELECT frbr_uri FROM laws WHERE jenis NOT IN ('UUD','TAP_MPR','UU','PERPPU','PP')) LIMIT 2000);
   DELETE FROM relations WHERE from_uri IN (SELECT frbr_uri FROM laws WHERE jenis NOT IN ('UUD','TAP_MPR','UU','PERPPU','PP'));
   DELETE FROM ekstraksi_log WHERE frbr_uri IN (SELECT frbr_uri FROM laws WHERE jenis NOT IN ('UUD','TAP_MPR','UU','PERPPU','PP'));
   DELETE FROM laws WHERE jenis NOT IN ('UUD','TAP_MPR','UU','PERPPU','PP');
   ```

4. Berkas R2 (`teks/akn/id/act/<jenis>/…` dan, bila ada, `pdf/…`) dan vektor di Vectorize (id vektor =
   `frbr_uri` atau `frbr_uri#pasal-…`, potongan lanjutan berakhiran `~n`) tidak ikut terhapus oleh langkah D1. Keduanya
   tidak terlihat pengguna (pencarian menyaring kandidat vektor di luar cakupan) dan murah disimpan; hapus hanya bila
   perlu: berkas R2 dengan `npx wrangler r2 object delete lexa-pdfs/<kunci>` (kuncinya ada di kolom `r2_text_key` dan
   `r2_pdf_key`, simpan daftarnya sebelum langkah 3), vektor lewat `deleteByIds` pada binding `VECTORIZE` atau API REST
   Vectorize (`wrangler vectorize list-vectors lexa-index` membantu mendaftar id). Minta bantuan menyusun skripnya bila perlu.

### Rollback

Dashboard > `lexa` > **Deployments** > pilih versi sebelumnya > **Rollback** (atau `npx wrangler rollback`).
Rollback mengembalikan kode, konfigurasi, **dan aset statis** versi itu, jadi UI lama (bila ada) kembali.
Rollback **tidak** mengembalikan data D1 maupun migrasi yang sudah diterapkan.

Bila hanya halaman peraturan yang bermasalah setelah rilis pratinjau tautan (`/peraturan` dilayani Worker, lihat
`src/worker/lib/pratinjau.ts`), cukup hapus `"/peraturan"` dari `assets.run_worker_first` di `wrangler.jsonc`
lalu deploy: halaman kembali dilayani sebagai aset statis seperti sebelumnya, hanya tanpa pratinjau tautan.

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
