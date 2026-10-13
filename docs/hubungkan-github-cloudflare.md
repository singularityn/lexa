# Menghubungkan repo GitHub ke Worker `lexa`

Panduan ini menyelesaikan koneksi `singularityn/lexa` ke Worker `lexa` yang **sudah berjalan** di akun
Cloudflare lewat **Workers Builds** (integrasi Git bawaan Cloudflare: build dan deploy otomatis saat push,
URL pratinjau per branch/PR, dan check run di GitHub). Langkah di dashboard hanya bisa dilakukan pemilik akun.

## Keadaan repo saat ini

- Kode Worker identik byte-per-byte dengan produksi v0.1 (terverifikasi lewat sourcemap), ditambah perbaikan
  bug yang ditemukan lewat tes (lihat README, "Riwayat perubahan penting").
- `wrangler.jsonc` sudah lengkap: Vectorize `lexa-index`, antrean `lexa-ingest`, D1/KV/R2/AI, cron per menit dan
  harian, `vars.TIK_CADANGAN`, dan aset statis dari `./public`. Tidak ada lagi placeholder yang membuat deploy ditolak.
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
| Cron | ditetapkan `* * * * *` (tik pipeline) dan `0 19 * * *` (pemeliharaan harian). Deploy **mengganti** seluruh daftar pemicu dengan isi berkas |
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
| Cron | Settings > Trigger events | `* * * * *` dan `0 19 * * *`. Pemicu per menit baru terbukti berjalan di produksi sekitar 17:40 UTC pada 11 Okt 2026 (kunci `denyut:* * * * *` di `sync_state`), berjam-jam sesudah ditambahkan; bila suatu saat denyutnya basi, periksa daftarnya di sini. Pipeline tetap berjalan lewat rantai pesan antrean (`TIK_CADANGAN`), yang dimulai oleh satu kunjungan ke situs atau Cron harian dan berhenti sendiri selama Cron per menit segar |
| Konsumer antrean | Queues > lexa-ingest | masih terhubung ke `lexa`, DLQ dan retry seperti sebelumnya |
| API | `/api/stats`, `/api/search?q=pesangon`, `/robots.txt`, `/sitemap.xml` | 200 dengan data |
| Pencarian kata bertanda hubung | `/cari?q=perundang-undangan&mode=keyword` | ada hasil (bug lama: nihil) |
| Sitasi nama panjang | `/cari?q=Peraturan Pemerintah Pengganti Undang-Undang Nomor 2 Tahun 2022` | Perppu 2/2022 di urutan pertama berlabel "Sitasi" (bukan UU 2/2022) |
| Cakupan | `/api/stats` | `cakupan: ["UUD","TAP_MPR","UU","PERPPU","PP"]`; `total_peraturan` hanya yang dalam cakupan (3.870 sesudah penghapusan 11 Okt 2026 dan naik bersama katalog; tak ada lagi PERPRES, POJK, PERMEN) |
| Peraturan di luar cakupan | `/peraturan?uri=/akn/id/act/perpres/2022/1` (Perpres apa pun yang tersimpan) dan `/cari?q=Perpres 22/2015` | halaman "Peraturan ini di luar cakupan Lexa"; hasil pencarian dengan catatan "Lexa belum memuat peraturan jenis PERPRES" |
| Sitemap | `/sitemap.xml` | hanya URL UU, PP, Perppu, dan Tap MPR |
| Relasi ke Perppu | `/peraturan?uri=/akn/id/act/uu/1998/10`, tab Relasi | "PERPU No. 2 Tahun 2022" berupa tautan aktif ke halaman Perppu 2/2022 (dulu teks mati) |
| Pratinjau tautan | `curl -s -A 'WhatsApp/2' 'URL/peraturan?uri=/akn/id/act/uu/2003/13' \| grep -E 'og:(title\|image)'` (tanpa `-A`, seperti pembaca biasa, jawabannya cangkang umum) | `og:title` "UU 13/2003 …" dan `og:image` berupa alamat mutlak ke `/og/lexa.png`; untuk peraturan yang tidak ada, pratinjau umum situs ("Lexa: cari peraturan perundang-undangan Indonesia") |
| Gambar pratinjau | `/og/lexa.png` | 200, `image/png` |
| Token admin | `GET /api/admin/cek-token` dengan header `x-admin-token` | `secret_terpasang: true`, `cocok: true` |
| Login Google (bila diaktifkan) | `/akun` > Masuk dengan Google | kembali ke Lexa dalam keadaan masuk; bila Google menampilkan `redirect_uri_mismatch`, lihat [Login Google](#login-google-oauth) |
| Tab PDF | buka peraturan yang PDF-nya diarsipkan (mis. salah satu UU hasil panen), tab **PDF** | halaman tergambar tanpa galat di konsol; `GET /vendor/pdfjs/pdf.min.mjs` menjawab `text/javascript`; tombol "Lihat di PDF" pada pasal membuka halamannya; tombol "Periksa pasal" menampilkan perbandingan nomor pasal PDF dan Lexa |
| Pipeline berjalan | D1: `SELECT key, value, updated_at FROM sync_state WHERE key LIKE 'denyut:%' OR key IN ('akses_isi','pasal_tunda_sampai','tik_antre_sampai');` dan `SELECT job, status, detail, created_at FROM sync_log ORDER BY id DESC LIMIT 10;` | `denyut:antrean` (atau `denyut:* * * * *`) segar dalam 5 menit; `/status` memuat panel "Kelengkapan isi" |
| Akses isi pasal.id | `/status` dan `SELECT value FROM sync_state WHERE key = 'akses_isi';` | tak ada baris `akses_isi` (akses baik). Bila ada, catatan pasal.id dan langkahnya di [pipeline-data.md](pipeline-data.md#akses-isi-pasalid-temuan-11-okt-2026) |

### Pipeline isi: memeriksa dan mengendalikan

Pengambilan isi peraturan (katalog, antrean per peraturan, tik per menit, cadangan antrean, arsip respons, daftar hapus,
pemeliharaan harian) dan temuan akses pasal.id dijelaskan di [pipeline-data.md](pipeline-data.md), lengkap dengan SQL
pemeriksaan dan `POST /api/admin/sync`. Yang perlu diingat saat men-deploy:

- Tik berjalan tiap menit selama ada kerja dan dijeda bila pasal.id minta jeda; kemajuan katalog dan antrean tersimpan di
  D1 (`sync_state`, kolom `laws.isi_*`), jadi deploy atau rollback tidak mengulang dari awal.
- Rantai cadangan dimulai oleh satu permintaan HTTP ke situs atau Cron harian sesudah deploy; bila `/status` menunjukkan
  denyut yang basi, buka situsnya sekali.
- API pasal.id hanya memberi metadata sejak 11 Okt 2026; memperbarui `PASAL_API_TOKEN` tidak mengembalikan teksnya. Teks
  baru dipanen dari BPK lewat `scripts/bpk-console-harvest.js` (lihat pipeline-data.md, "Panen BPK").

### Cakupan peraturan

Lexa hanya memuat UUD dan setara (Tap MPR), undang-undang termasuk Perppu, dan peraturan pemerintah; daftarnya di
`vars.CAKUPAN_JENIS` pada `wrangler.jsonc` (bawaan di `src/shared/cakupan.ts`, dijaga sama oleh tes). Cara kerjanya ada di
[README](../README.md#cakupan-peraturan). Dua operasi yang perlu langkah sadar:

**Melebarkan cakupan** (mis. menambah Perpres): tambahkan kodenya di `CAKUPAN_JENIS` **dan** di `JENIS_KATALOG`
(`src/worker/lib/katalog.ts`), deploy, lalu jalankan `POST /api/admin/sync {"jenis":["PERPRES"]}`. Sapuan hanya bekerja bila
kode filternya dikenal pasal.id (`UU`, `PERPPU`, `PP`, `PERPRES`, `PERMEN`, `POJK`, `PBI`). Peraturan di luar cakupan
sudah dihapus dari produksi (lihat berikut), jadi datanya harus diambil lagi dari sumber, dengan batas laju dan akses teks
pasal.id yang sama. Hasil pencarian lama di KV tidak ikut terpakai karena cakupan menjadi bagian kunci cache.

**Penghapusan data di luar cakupan sudah dilakukan (11 Okt 2026)** atas permintaan pemilik. Urutannya, bila perlu diulang
untuk jenis lain:

1. Catat bookmark Time Travel: `npx wrangler d1 time-travel info lexa-db` (Time Travel menyimpan 30 hari pada paket berbayar; pemulihan tak mengubah R2 maupun Vectorize).
2. Lihat dulu yang akan dihapus (hanya baca):

   ```sql
   SELECT jenis, COUNT(*) AS peraturan, SUM(jumlah_pasal) AS pasal FROM laws
    WHERE jenis NOT IN ('UUD','TAP_MPR','UU','PERPPU','PP') GROUP BY jenis;
   ```

3. Catat dulu objek R2 dan vektor yang akan yatim sebagai batu nisan di `daftar_hapus` (`jenis_objek` `'r2'` dengan kunci
   dari `r2_text_key`/`r2_pdf_key`, dan `'vektor'` dengan id `frbr_uri`, `frbr_uri#pasal-…`, dan potongan `~n`). Tik
   mengosongkannya bertahap (500 kunci R2 dan 1.000 id vektor per tik) dan melepas barisnya sesudah objeknya terhapus.
4. Hapus dari D1, anak lebih dulu, dalam potongan agar tiap pernyataan tidak terlalu berat (pemicu FTS5 ikut menghapus
   entri indeks). Ulangi pasangan pertama sampai `changes` 0, lalu jalankan sisanya:

   ```sql
   DELETE FROM articles WHERE rowid IN (
     SELECT rowid FROM articles WHERE frbr_uri IN
       (SELECT frbr_uri FROM laws WHERE jenis NOT IN ('UUD','TAP_MPR','UU','PERPPU','PP')) LIMIT 2000);
   DELETE FROM relations WHERE from_uri IN (SELECT frbr_uri FROM laws WHERE jenis NOT IN ('UUD','TAP_MPR','UU','PERPPU','PP'));
   DELETE FROM ekstraksi_log WHERE frbr_uri IN (SELECT frbr_uri FROM laws WHERE jenis NOT IN ('UUD','TAP_MPR','UU','PERPPU','PP'));
   DELETE FROM laws WHERE jenis NOT IN ('UUD','TAP_MPR','UU','PERPPU','PP');
   ```

Hasilnya: 2.131 peraturan dan 15.457 baris pasal terhapus; 6.393 berkas R2 dan 21.128 vektor dikosongkan oleh tik.

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
rollback kode tetap aman. Sebelum migrasi besar, catat bookmark D1 Time Travel. Pipeline isi memerlukan migrasi
`0005_antrean_isi_dan_daftar_hapus.sql` dan `0006_arsip_respons.sql`; keduanya sudah diterapkan di produksi (11 Okt 2026)
sebelum kodenya di-deploy, dan hanya menambah (kolom, indeks, tabel), jadi rollback kode tetap aman.

## Rahasia

Rahasia tidak pernah masuk Git. Karena deploy dilakukan oleh Workers Builds di sisi Cloudflare, GitHub
Actions **tidak** membutuhkan token Cloudflare; CI di repo ini (`.github/workflows/ci.yml`) hanya menjalankan
typecheck, tes, bundling, migrasi pada D1 kosong, dan tes e2e.

## Login Google (OAuth)

Login Google bersifat opsional: tanpa `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET` aplikasi berjalan sebagai tamu. Untuk
mengaktifkannya:

1. **Google Cloud Console** (console.cloud.google.com) > pilih atau buat proyek > **APIs & Services > OAuth consent screen**:
   isi nama aplikasi dan email dukungan. Selama berstatus *Testing*, hanya akun yang didaftarkan di "Test users" yang bisa
   masuk (yang lain melihat "Error 403: access_denied"); ubah ke *In production* bila semua orang boleh masuk. Lexa hanya
   meminta `openid email profile`, jadi tak perlu verifikasi cakupan sensitif.
2. **APIs & Services > Credentials > Create credentials > OAuth client ID**, jenis **Web application** (bukan Desktop, Android, atau
   iOS: jenis itu tidak menerima alamat pengalihan web).
3. **Authorized redirect URIs**: tambahkan alamat berikut, **persis**, satu per host yang dipakai pengunjung:

   | Host | Alamat yang didaftarkan |
   |---|---|
   | Produksi (`workers.dev`) | `https://lexa.fariqhfebrian18.workers.dev/api/auth/google/callback` |
   | Domain sendiri, bila dipasang | `https://<domain>/api/auth/google/callback` |
   | Pengembangan lokal (`npx wrangler dev`) | `http://localhost:8787/api/auth/google/callback` |

   Isi "Authorized JavaScript origins" tidak dipakai alur ini (kodenya dipertukarkan di server), boleh dikosongkan.
4. Salin **Client ID** dan **Client secret** ke Worker: `npx wrangler secret put GOOGLE_CLIENT_ID` dan
   `npx wrangler secret put GOOGLE_CLIENT_SECRET` (atau dashboard: Settings > Variables and secrets). Tidak perlu deploy ulang.
5. Buka `/akun`: tombol "Masuk dengan Google" tampil. Di bawahnya ada bagian tertutup "Pengelola situs: Google menampilkan
   redirect_uri_mismatch?" yang memuat alamat pengalihan yang **dikirim Lexa saat itu** (sama dengan
   `redirect_uri` pada `GET /api/auth/status`), lengkap dengan tombol salin. Daftarkan alamat itu.

### Galat yang lazim

| Yang tampil | Penyebab | Perbaikan |
|---|---|---|
| **Error 400: redirect_uri_mismatch** (halaman Google) | Alamat pengalihan yang dikirim Lexa tidak terdaftar persis di klien OAuth. Google menampilkannya sendiri dan tidak mengembalikan pengguna ke Lexa, jadi Lexa tak bisa menjelaskannya pada saat itu | Daftarkan alamat yang tampil di `/akun` (bagian bantuan). Harus sama huruf demi huruf: `https`, host, `/api/auth/google/callback`, tanpa garis miring penutup. Salah umum: mendaftarkan hanya `https://lexa.fariqhfebrian18.workers.dev/`, jalur gaya NextAuth (`/api/auth/callback/google`), atau `http://`. Klik "error details" di halaman Google untuk melihat `redirect_uri` yang dikirim. Perubahan di Google bisa butuh beberapa menit |
| Alamat berbeda dari yang diharapkan | Alamat mengikuti host yang dibuka pengunjung: lewat `workers.dev` dan lewat domain sendiri menghasilkan dua alamat | Daftarkan keduanya, atau arahkan pengunjung ke satu host |
| **Error 403: access_denied** / "app not verified" | Layar persetujuan berstatus *Testing* dan akun belum jadi "Test user" | Tambahkan akunnya di OAuth consent screen > Test users, atau ubah ke *In production* |
| **Error 401: invalid_client** | Client ID salah/terhapus, atau jenis klien bukan Web application | Periksa `GOOGLE_CLIENT_ID`; buat klien jenis Web application |
| Kembali ke `/akun?galat=token` | Client secret salah (kode tak bisa ditukar) | Pasang ulang `GOOGLE_CLIENT_SECRET`; jangan lewat pipa (newline ikut tersimpan) |
| Kembali ke `/akun?galat=ditolak` atau `galat=google` | Pengguna membatalkan, atau Google mengembalikan galat lain | Coba lagi |

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
