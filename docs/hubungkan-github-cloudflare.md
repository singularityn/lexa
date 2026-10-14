# Menghubungkan repo GitHub ke Worker `lexa`

Panduan ini menyelesaikan koneksi `singularityn/lexa` ke Worker `lexa` yang **sudah berjalan** di akun
Cloudflare lewat **Workers Builds** (integrasi Git bawaan Cloudflare: build dan deploy otomatis saat push,
URL pratinjau per branch/PR, dan check run di GitHub). Langkah di dashboard hanya bisa dilakukan pemilik akun.

## Keadaan repo saat ini

- Kode Worker identik byte-per-byte dengan produksi v0.1 (terverifikasi lewat sourcemap), ditambah perbaikan
  bug yang ditemukan lewat tes (lihat README, "Riwayat perubahan penting").
- `wrangler.jsonc` sudah lengkap: Vectorize `lexa-index`, antrean `lexa-ingest`, D1/KV/R2/AI, dua cron (harian untuk pemeliharaan,
  15 menit untuk Gemini otomatis yang mati kecuali dinyalakan), dan aset statis dari `./public`. Tidak ada lagi placeholder yang
  membuat deploy ditolak.
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
| Variabel teks (`EMBEDDING_MODEL`, `SUMMARY_MODEL`, `BPK_BASE`, `SEARCH_CACHE_TTL`) | dipertahankan (`keep_vars: true`). Sisa `PASAL_API_BASE` dan `TIK_CADANGAN` di dashboard tidak dibaca kode lagi; hapus saja |
| Secret (`ADMIN_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GEMINI_API`) | tidak tersentuh. `PASAL_API_TOKEN` tidak dibaca kode lagi; hapus dari dashboard |
| Cron | ditetapkan `0 19 * * *` (pemeliharaan harian) dan `*/15 * * * *` (Gemini otomatis; tak mengerjakan apa pun kecuali `GEMINI_OTOMATIS` dipasang). Deploy **mengganti** seluruh daftar pemicu dengan isi berkas, jadi pemicu per menit yang lama otomatis hilang |
| Placement | ditetapkan `region: aws:us-east-1` (hanya penangan `fetch`, yaitu API; aset statis, antrean, dan Cron tak terpengaruh): Worker berjalan di AS Timur, dekat D1 (`lexa-db` ada di ENAM), dan dari lokasi yang diterima Google. Penjelasan di bagian Gemini di bawah |
| Konsumer antrean (batch, retry, jeda, konkurensi, DLQ) | **tidak tersentuh**: sengaja tidak dideklarasikan |
| Compatibility date | `2026-08-05` (diperkirakan dari tanggal pembuatan Worker) |
| Observability, limits, rute/domain khusus | tidak dicantumkan; periksa di dashboard setelah deploy |

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
| Variabel | Settings > Variables and secrets | variabel teks (`EMBEDDING_MODEL`, `SUMMARY_MODEL`, `BPK_BASE`, `SEARCH_CACHE_TTL`) dan secret (`ADMIN_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, serta `GEMINI_API` bila dipakai) masih ada, ditambah `CAKUPAN_JENIS` (dari `wrangler.jsonc`) |
| Cron | Settings > Trigger events | `0 19 * * *` (pemeliharaan harian) dan `*/15 * * * *` (Gemini otomatis). Bila masih ada pemicu `* * * * *`, hapus; kode mengabaikannya |
| Konsumer antrean | Queues > lexa-ingest | masih terhubung ke `lexa`, DLQ dan retry seperti sebelumnya |
| API | `/api/stats`, `/api/search?q=pesangon`, `/robots.txt`, `/sitemap.xml` | 200 dengan data |
| Pencarian kata bertanda hubung | `/cari?q=perundang-undangan&mode=keyword` | ada hasil (bug lama: nihil) |
| Sitasi nama panjang | `/cari?q=Peraturan Pemerintah Pengganti Undang-Undang Nomor 2 Tahun 2022` | Perppu 2/2022 di urutan pertama berlabel "Sitasi" (bukan UU 2/2022) |
| Cakupan | `/api/stats` | `cakupan: ["UUD","TAP_MPR","UU","PERPPU","PP"]`; `total_peraturan` hanya yang dalam cakupan (7.177 pada 14 Okt 2026; tak ada lagi PERPRES, POJK, PERMEN) |
| Peraturan di luar cakupan | `/peraturan?uri=/akn/id/act/perpres/2022/1` (Perpres apa pun yang tersimpan) dan `/cari?q=Perpres 22/2015` | halaman "Peraturan ini di luar cakupan Lexa"; hasil pencarian dengan catatan "Lexa belum memuat peraturan jenis PERPRES" |
| Sitemap | `/sitemap.xml` | hanya URL UU, PP, Perppu, dan Tap MPR |
| Relasi ke Perppu | `/peraturan?uri=/akn/id/act/uu/1998/10`, tab Relasi | "PERPU No. 2 Tahun 2022" berupa tautan aktif ke halaman Perppu 2/2022 (dulu teks mati) |
| Pratinjau tautan | `curl -s -A 'WhatsApp/2' 'URL/peraturan?uri=/akn/id/act/uu/2003/13' \| grep -E 'og:(title\|image)'` (tanpa `-A`, seperti pembaca biasa, jawabannya cangkang umum) | `og:title` "UU 13/2003 …" dan `og:image` berupa alamat mutlak ke `/og/lexa.png`; untuk peraturan yang tidak ada, pratinjau umum situs ("Lexa: cari peraturan perundang-undangan Indonesia") |
| Gambar pratinjau | `/og/lexa.png` | 200, `image/png` |
| Token admin | `GET /api/admin/cek-token` dengan header `x-admin-token` | `secret_terpasang: true`, `cocok: true` |
| Login Google (bila diaktifkan) | `/akun` > Masuk dengan Google | kembali ke Lexa dalam keadaan masuk; bila Google menampilkan `redirect_uri_mismatch`, lihat [Login Google](#login-google-oauth) |
| Tab PDF | buka peraturan yang PDF-nya diarsipkan (mis. salah satu UU hasil panen), tab **PDF** | halaman tergambar tanpa galat di konsol; `GET /vendor/pdfjs/pdf.min.mjs` menjawab `text/javascript`; tombol "Lihat di PDF" pada pasal membuka halamannya; tombol "Periksa pasal" menampilkan perbandingan nomor pasal PDF dan Lexa |
| Pemeliharaan harian | D1: `SELECT value FROM sync_state WHERE key = 'denyut:0 19 * * *';` dan `SELECT job, status, detail, created_at FROM sync_log ORDER BY id DESC LIMIT 10;` | denyut berumur kurang dari sehari (setelah pukul 02:00 WIB); `/status` memuat panel "Kelengkapan data" |
| Tanpa pasal.id | `POST /api/admin/sync` dengan token admin | 410 `dihentikan`; tak ada permintaan keluar ke pasal.id dari Worker |

### Pipeline data: memeriksa dan mengendalikan

Data peraturan datang dari panen BPK (skrip di peramban pengelola) lewat `/api/impor/*`; Worker tidak menjemput apa pun.
Ekstraksi PDF, daftar hapus, dan pemeliharaan harian dijelaskan di [pipeline-data.md](pipeline-data.md), lengkap dengan SQL
pemeriksaan. Yang perlu diingat saat men-deploy:

- Kemajuan panen tersimpan di D1 (`laws.bpk_id`, `laws.r2_pdf_key`, `laws.jumlah_pasal`, `sync_state` untuk penanda
  "tanpa berkas"), jadi deploy atau rollback tidak mengulang dari awal. Panen yang sedang berjalan di peramban tidak terputus
  oleh deploy: ia hanya memanggil API impor, yang kompatibel mundur.
- Antrean `lexa-ingest` bisa masih memuat pesan sisa alur lama (`peraturan`, `tik`); konsumer membuangnya tanpa dikerjakan.
- Menempel ulang skrip panen hanya perlu bila `scripts/bpk-console-harvest.js` berubah (lihat riwayat commit).

### Cakupan peraturan

Lexa hanya memuat UUD dan setara (Tap MPR), undang-undang termasuk Perppu, dan peraturan pemerintah; daftarnya di
`vars.CAKUPAN_JENIS` pada `wrangler.jsonc` (bawaan di `src/shared/cakupan.ts`, dijaga sama oleh tes). Cara kerjanya ada di
[README](../README.md#cakupan-peraturan). Dua operasi yang perlu langkah sadar:

**Melebarkan cakupan** (mis. menambah Perpres): tambahkan kodenya di `CAKUPAN_JENIS`, deploy, lalu jalankan penjelajahan dan
panen BPK untuk jenis itu (opsi `jenis` pada skrip panen). Peraturan di luar cakupan sudah dihapus dari produksi (lihat
berikut), jadi datanya harus dipanen lagi dari BPK. Hasil pencarian lama di KV tidak ikut terpakai karena cakupan menjadi
bagian kunci cache.

**Penghapusan data di luar cakupan sudah dilakukan (11 Okt 2026)** atas permintaan pemilik. Urutannya, bila perlu diulang
untuk jenis lain:

1. Catat bookmark Time Travel: `npx wrangler d1 time-travel info lexa-db` (Time Travel menyimpan 30 hari pada paket berbayar; pemulihan tak mengubah R2 maupun Vectorize).
2. Lihat dulu yang akan dihapus (hanya baca):

   ```sql
   SELECT jenis, COUNT(*) AS peraturan, SUM(jumlah_pasal) AS pasal FROM laws
    WHERE jenis NOT IN ('UUD','TAP_MPR','UU','PERPPU','PP') GROUP BY jenis;
   ```

3. Catat dulu objek R2 dan vektor yang akan yatim sebagai batu nisan di `daftar_hapus` (`jenis_objek` `'r2'` dengan kunci
   dari `r2_text_key`/`r2_pdf_key`, dan `'vektor'` dengan id `frbr_uri`, `frbr_uri#pasal-…`, dan potongan `~n`). Pemeliharaan
   mengosongkannya bertahap (500 kunci R2 dan 1.000 id vektor per putaran) dan melepas barisnya sesudah objeknya terhapus.
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

Hasilnya: 2.131 peraturan dan 15.457 baris pasal terhapus; 6.393 berkas R2 dan 21.128 vektor dikosongkan bertahap oleh pemeliharaan.

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
`0007_penjelasan.sql` (tabel `penjelasan` dan kolom `ekstraksi_log.versi_parser`) juga hanya menambah; kodenya menahan galat
bila migrasi belum diterapkan, jadi urutan deploy dan migrasi tidak kritis, tetapi Penjelasan baru tersimpan dan uraian ulang
`usang` baru berjalan sesudah migrasi diterapkan.

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

## Gemini untuk PDF pindaian (opsional)

Peraturan yang PDF-nya pindaian tanpa lapisan teks tak menghasilkan pasal lewat konversi bawaan. Lexa dapat meminta Gemini
membacanya sebagai gambar (analisis, risiko, dan alasannya: [analisis-gemini.md](analisis-gemini.md)). Tanpa kunci, semua fitur lain
berjalan seperti biasa.

1. Dashboard > Workers & Pages > `lexa` > Settings > **Variables and Secrets** > Add > tipe **Secret**, nama `GEMINI_API`, isi kunci
   dari Google AI Studio. Secret tidak pernah dihapus oleh deploy (`keep_vars` melindungi variabel teks juga, tetapi variabel teks
   terlihat di dashboard).
2. Opsional, tipe teks: `GEMINI_MODEL` (bawaan `gemini-flash-latest`; nama model Google berganti dan dipensiunkan, jadi pilih yang
   masih didukung), `GEMINI_BATAS_HARIAN` (token masuk + keluar per hari UTC, bawaan 5.000.000), `GEMINI_BASE_URL` (mis. alamat AI
   Gateway Cloudflare; bawaan API Google langsung).
   Juga opsional: `GEMINI_BERPIKIR` (angka atau kata, mis. `0` atau `LOW`; mengecilkan token berpikir, yang pada pembacaan nyata pertama
   lebih banyak daripada token keluaran; bentuk nilainya berbeda per seri model, jadi uji dengan `geminiCek` sebelum membaca),
   `GEMINI_HALAMAN` (halaman per panggilan untuk PDF panjang, bawaan 4), `GEMINI_PARALEL` (panggilan bersamaan per PDF, bawaan 3), dan
   `GEMINI_HALAMAN_MAKS` (PDF yang lebih panjang ditolak tanpa memanggil Gemini, bawaan 120 halaman; naikkan hanya bila memang ingin
   membaca undang-undang yang sangat panjang).
3. Terapkan migrasi 0008 (tabel `pembacaan_ai`) sebelum memakainya: `npm run d1:migrate:remote`.
4. Uji dari konsol dengan skrip panen: `window.LEXA_PANEN = { geminiCek: true }`, lalu `{ geminiUji: ["/akn/id/act/uu/2019/24"] }`
   (percobaan kering), baru `{ gemini: true, batas: 3 }`.

Konsumer antrean `lexa-ingest` memproses pesan secara berurutan, dan satu pemanggilan dibatasi 15 menit oleh Cloudflare; pembacaan
Gemini memakan menit per PDF, jadi pesannya dikirim dalam kelompok kecil (skrip memakai `batas: 3` dan menunggu selesai).

### Galat `User location is not supported for the API use` (HTTP 400)

Google menilai lokasi dari alamat IP keluar, dan Worker berjalan di pusat data Cloudflare terdekat dengan pemanggilnya: dari Asia
Tenggara itu kadang Singapura atau Hong Kong, yang alamatnya sebagian dikenali Google sebagai wilayah tak didukung. Itu bukan salah
kunci, model, atau dokumen, dan tak ada hubungannya dengan negara tempat Anda tinggal. Yang dilakukan Lexa:

- `placement.region = "aws:us-east-1"` di `wrangler.jsonc`: penangan `fetch` (route `/api/impor/gemini-*` yang dipanggil skrip konsol)
  berjalan di AS Timur. Placement **tidak** berlaku untuk konsumer antrean dan Cron (dokumentasi Cloudflare: hanya penangan `fetch`).
- Galat itu digolongkan `lokasi` (sementara): diulang tiga kali di tempat (jeda 4 dan 12 detik), lalu pesan antrean dikembalikan dengan
  jeda 120 detik. Ia tak pernah dicatat `gagal` pada dokumen, jadi tak ada peraturan yang hilang dari daftar calon karenanya.
- `geminiCek` mencetak pusat data tempat Worker berjalan (`Worker berjalan di pusat data IAD (remote-IAD)`); galatnya membawa
  `lokasi_worker` yang sama. Bila konsumer antrean terkena, satu baris `sync_log` (job `gemini_galat`, paling banyak satu per jenis per
  10 menit) memuat jenis galat, alamat peraturan, dan lokasi keluar Worker (`[colo=SIN loc=SG]`): `SELECT created_at, detail FROM
  sync_log WHERE job = 'gemini_galat' ORDER BY id DESC LIMIT 10`.
- AI Gateway Cloudflare tidak dijamin memperbaikinya (laporan pengguna lain: galat yang sama lewat gateway dari Singapura atau Hong
  Kong), jadi `GEMINI_BASE_URL` bukan jalan keluar untuk masalah ini.
- Bila konsumer antrean ternyata sering terkena, langkah berikutnya: meneruskan panggilan Gemini lewat Durable Object dengan
  `locationHint` AS (belum dibangun; keputusan sesudah melihat baris `gemini_galat` di atas).

### Menjalankannya otomatis di Cloudflare (tanpa konsol)

Cron 15 menit (`*/15 * * * *`) dapat mengantrekan pembacaan sendiri, memakai secret `GEMINI_API` milik Worker. Ia mati sampai Anda
menambah variabel teks `GEMINI_OTOMATIS` di dashboard:

1. **Uraikan ulang dulu** supaya vonis semua peraturan jujur: skrip panen `window.LEXA_PANEN = { usang: true }` (sekali, tanpa biaya
   Gemini). Vonis `berat` kini juga berarti pasal hilang dari rangkaian atau pembukaan tertelan ke dalam pasal.
2. `GEMINI_OTOMATIS` = `uji`. Tiap 15 menit dua peraturan yang paling dicari (UU dan PP terbaru lebih dulu) yang vonisnya
   `tanpa_pasal`, `berat`, atau `gagal` dibaca Gemini sebagai percobaan kering: **tak ada pasal yang ditulis**. Berhenti sendiri setelah
   8 percobaan (`GEMINI_OTOMATIS_UJI_MAKS`). Hasilnya di D1: `SELECT frbr_uri, vonis_baru, pasal_baru, catatan FROM pembacaan_ai WHERE
   hasil = 'uji'` (catatannya memuat keputusan, rangkaian pasal, dan kesesuaian dengan teks lama), dan teksnya di R2 `teks-ai/...`.
3. Bila hasilnya baik, ubah menjadi `ya`: peraturan berikutnya dibaca sungguhan dan, bila lolos pagar, menggantikan pasal yang tersimpan.
   `GEMINI_OTOMATIS_BATAS` (bawaan 2, maks 10) mengatur banyaknya per putaran; anggaran token harian (`GEMINI_BATAS_HARIAN`) tetap
   menjadi batas biaya. Hapus variabelnya (atau kosongkan) untuk mematikan.

Putaran berikutnya menunggu semua peraturan putaran sebelumnya tercatat di `pembacaan_ai` (atau 45 menit berlalu), jadi antrean
tak menumpuk. Keadaannya terlihat di `GET /api/impor/ringkasan` (blok `gemini`: `otomatis`, `calon_belum_dicoba`, `anggaran`).

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
