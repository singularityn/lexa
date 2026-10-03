# Analisis Kelayakan dan Peta Fitur Lexa di Cloudflare

Disusun 3 Oktober 2026 untuk repo `singularityn/lexa`.

Sumber analisis: dokumentasi Cloudflare resmi (via tool pencarian dokumentasi), pembacaan **read-only** akun Cloudflare Anda (Worker, D1, R2, KV), serta sumber publik. **Tidak ada resource Cloudflare yang diubah dan tidak ada kode yang ditulis ke repo.**

Penanda tingkat bukti yang dipakai di seluruh dokumen:

| Tanda | Arti |
|---|---|
| **[V]** | Terverifikasi langsung: dokumentasi Cloudflare, isi akun Cloudflare Anda, atau kode yang sedang ter-deploy |
| **[P]** | Dari hasil pencarian web / halaman publik; belum saya buka langsung |
| **[I]** | Inferensi atau estimasi saya (asumsi dicantumkan) |
| **[?]** | Belum bisa diverifikasi dari sini |

---

## 0. Kesimpulan

1. **Layak.** Webapp Lexa (katalog, pencarian kata kunci + semantik, halaman dokumen per pasal, tanya-jawab AI bersitasi) bisa dibangun seluruhnya di layanan Cloudflare: Workers, D1, R2, KV, Queues, Workflows, Vectorize, Workers AI. Ini bukan hipotesis: **Lexa v0.1 sudah berjalan di akun Cloudflare Anda** (5.634 peraturan, 71.481 baris pasal/ayat, pencarian hybrid, tanya-jawab AI, login Google). [V]
2. **Namun belum ada di GitHub.** Repo `singularityn/lexa` kosong (tanpa branch). Kode hanya ada di Worker `lexa` yang ter-deploy. Untungnya sourcemap ikut ter-upload, sehingga 4.610 baris TypeScript (17 file) bisa dipulihkan utuh. [V]
3. **Risiko terbesar adalah sumber data, bukan Cloudflare.** Versi 0.1 tidak mengambil data BPK lewat Worker. Metadata dan PDF BPK didorong dari luar oleh skrip "panen" melalui API admin, sedangkan teks pasal sebagian besar dari API pihak ketiga (pasal.id) yang dibatasi 60 permintaan/menit. Sinkronisasi harian gagal berulang karena "rate limit", dan pesan galat di kode menyiratkan unduhan PDF BPK bisa berujung "halaman challenge". [V] Situs BPK sendiri tidak bisa saya buka dari sandbox ini (diblokir kebijakan jaringan), jadi **crawl BPK murni di dalam Workers belum terbukti**. [?]
4. **Cakupan realistis bertahap.** Peraturan pusat + K/L (sekitar 41 ribu dokumen) mudah. Perda (sekitar 264 ribu) layak secara teknis tetapi sebaiknya memakai indeks berjenjang karena ukuran D1 dan biaya vektor. [P][I]
5. **Biaya wajar** (orde besaran, di luar lonjakan trafik, dengan model LLM hemat): skenario pusat + K/L sekitar US$20–55/bulan; seluruh 305 ribu dokumen sekitar US$50–140/bulan. Embedding seluruh korpus hanya puluhan dolar sekali jalan. [I]
6. **Perbaikan cepat bernilai besar:** D1 dan R2 ada di Amerika Timur (ENAM, colo Newark) tanpa read replication, sehingga pencarian rata-rata 0,8–1,7 detik. Mengaktifkan read replication (gratis) + Sessions API adalah langkah pertama. [V]

**Rekomendasi inti:** pertahankan fondasi v0.1, pindahkan kodenya ke GitHub, hubungkan Workers Builds, lalu jalankan **Fase 0 (1 minggu)** untuk membuktikan jalur akuisisi data BPK sambil meminta izin resmi ke BPK, sebelum menskalakan ke ratusan ribu dokumen.

---

## 1. Yang sudah ada di akun Cloudflare Anda (Lexa v0.1)

### 1.1 Inventaris resource [V]

| Resource | Nama | Keterangan |
|---|---|---|
| Worker | `lexa` | Dibuat 5 Agu 2026, terakhir diubah 6 Agu 2026. Hono, 4.610 baris TS di 17 file. Handler: `fetch`, `scheduled` (cron harian sekitar 19:00 UTC = 02:00 WIB), `queue` |
| D1 | `lexa-db` | 82 MB, 23 tabel, wilayah **ENAM** (primary di colo EWR/Newark), read replication **nonaktif**. 5 migrasi (0000–0004) |
| R2 | `lexa-pdfs` | Lokasi ENAM, Standard. Menyimpan `pdf/…` dan `teks/…` |
| KV | `lexa-cache` | Cache hasil pencarian, sesi login, pembatas laju sederhana |
| Binding lain (dari kode) | `AI` (Workers AI), `VECTORIZE`, `INGEST_QUEUE` | Indeks Vectorize dan konfigurasi Queue tidak bisa saya inspeksi dengan tool yang tersedia [?] |
| Vars/secrets (nama saja) | `ADMIN_TOKEN`, `PASAL_API_TOKEN`, `GOOGLE_CLIENT_ID/SECRET`, `EMBEDDING_MODEL`, `SUMMARY_MODEL`, `BPK_BASE`, `PASAL_API_BASE`, `SEARCH_CACHE_TTL` | Nilainya tidak terlihat dan tidak saya baca |

Tidak ada binding `ASSETS` dan tidak ada HTML yang disajikan, jadi **antarmuka web belum terlihat di Worker ini**. Mungkin ada di tempat lain (mis. Pages), yang tidak bisa saya lihat dari tool yang ada. [V][?]

### 1.2 Isi data [V]

| Jenis | Jumlah | Punya pasal | PDF di R2 | Punya ID BPK | Rentang tahun |
|---|---:|---:|---:|---:|---|
| UU | 1.950 | 1.855 | 1.569 | 1.449 | 1945–2026 |
| PP | 1.383 | 1.364 | 4 | 3 | 1946–2020 |
| Perpres | 1.380 | 1.354 | 0 | 0 | 1959–2022 |
| POJK | 547 | 528 | 0 | 0 | 2013–2025 |
| Permen | 204 | 187 | 0 | 0 | 2024–2025 |
| Perppu | 168 | 161 | 3 | 5 | 1947–2024 |
| TAP MPR | 2 | 2 | 2 | 2 | 1998–2003 |
| **Total** | **5.634** | | | | |

- Status: berlaku 4.358; dicabut 1.042; diubah 234.
- Relasi: 1.675 (diubah_oleh 555, mengubah 482, mencabut 482, dicabut_oleh 137, terkait 19). **Relasi `dasar_hukum` dan `melaksanakan` masih nol.**
- Pasal/ayat: 71.481 baris, rata-rata 427 karakter, total 30,5 MB teks. D1 82 MB berarti **sekitar 2,7 byte D1 per byte teks** (termasuk indeks dan FTS5), atau sekitar 1,15 KB per baris pasal.
- Belum ada Perda sama sekali. Pemakaian masih tahap uji (2 pengguna, 8 percakapan, 13 log pencarian).

### 1.3 Kemampuan yang sudah berjalan [V]

- Pencarian **hybrid**: jalur sitasi (bobot 12) + FTS5 (bobot 1,0) + vektor (bobot 0,8) digabung dengan Reciprocal Rank Fusion (K=60), bm25 berbobot (judul 3×, tentang 2×), cache hasil di KV.
- Normalisasi bahasa Indonesia: stemmer Nazief-Adriani ringkas, stopword, dan kamus sinonim hukum ("cuti" → "istirahat", "PHK" → "pemutusan hubungan kerja"). Penulisnya mencatat bahwa `kerja*` di FTS5 tidak menemukan "pekerja", dan itulah alasan modul ini ada.
- Ingest: antrean (Queues) → ambil detail → simpan → ekstraksi PDF dengan `env.AI.toMarkdown()` → parser pasal (BAB/Bagian/Pasal/Ayat/Penjelasan) → skor kualitas ekstraksi → embedding + upsert Vectorize (chunk ≤ 1.200 karakter) → ringkasan AI.
- Tanya-jawab AI (`/api/tanya`) dengan aturan ketat: jawab hanya dari kutipan pasal, sebut sumber, tandai peraturan berstatus dicabut/diubah, menolak menebak, ingatkan bahwa Lexa bukan penasihat hukum. Maksimum 6 pasal konteks × 1.500 karakter.
- Login Google (OAuth, verifikasi ID token), koleksi pengguna, laporan kesalahan, riwayat percakapan, `robots.txt` dan `sitemap.xml`, endpoint admin (`/admin/sync`, `/admin/ukur`, `/admin/kueri-nihil`), dan API impor (`POST /manifest`, `PUT /pdf`).

### 1.4 Kualitas ekstraksi PDF → pasal (1.577 dokumen, hampir semua UU) [V]

| Vonis | Jumlah | Persen | Catatan |
|---|---:|---:|---|
| bersih | 1.103 | 70,0% | rata-rata 41 pasal, PDF 229 KB, 0,9 detik |
| ringan | 146 | 9,3% | PDF lebih besar (rata-rata 1,5 MB) |
| berat | 7 | 0,4% | kerusakan ≥ 2 indikator per 1.000 karakter |
| tanpa_pasal | 320 | 20,3% | teks terbaca tetapi tidak ada pasal terdeteksi (banyak UU 1950-an: kemungkinan hasil pindaian tanpa lapisan teks) [I] |
| gagal | 1 | 0,06% | PDF 42 MB melebihi batas keluaran 50 juta karakter |

Artinya: untuk PDF yang punya lapisan teks, `toMarkdown` + parser sudah cukup baik. **Sekitar 1 dari 5 dokumen butuh OCR** (angka ini dari sampel UU, dan untuk Perda bisa lebih tinggi). [I]

### 1.5 Yang macet atau bermasalah [V]

- **Sinkronisasi harian gagal terus.** Log mencatat sedikitnya 48 kegagalan "rate limit" (26 di PERPRES, 22 di PP) plus 6 kegagalan 401 (token pasal.id tidak sah). Offset PERMEN/POJK/PBI terakhir bergerak 2 Sep 2026, jadi jenis-jenis itu tidak pernah tersentuh lagi. Penyebab: endpoint daftar dan detail pasal.id berbagi batas 60 permintaan/menit, dan konsumen antrean menghabiskannya.
- **Latensi.** Dari `search_log` (sampel kecil, 13 baris): hybrid rata-rata 1.667 ms (704–2.254), keyword 803 ms, semantik 1.312 ms. Penyebab utama: D1 primary di Amerika Timur dan kueri berurutan.
- **Pembatas laju KV** (`tanya:{ip}`, 20 per 5 menit) tidak atomik dan konsistensinya eventual, jadi mudah dilewati.
- **Sitemap** dibatasi 5.000 URL dan memakai URL berparameter (`/peraturan?uri=…`); untuk 300 ribu dokumen perlu sitemap index dan URL kanonik yang bersih.
- **Tidak ada kode di Git**, sehingga tidak ada riwayat, review, atau CI.

### 1.6 Kode sumber bisa dipulihkan [V]

Berkas upload Worker menyertakan `index.js.map` dengan `sourcesContent`. Struktur yang terpulihkan:

```
src/worker/index.ts            (148)   lib/query.ts   (257)  lib/bidang.ts (91)
src/worker/lib/search.ts       (485)   lib/auth.ts    (54)   lib/cors.ts   (24)
src/worker/lib/pasal.ts        (540)   lib/bpk.ts     (603)  lib/ingest.ts (628)
src/worker/lib/sesi.ts         (86)
src/worker/routes/api.ts       (515)   impor.ts (195)  dokumen.ts (151)  fitur.ts (243)
src/worker/routes/auth.ts      (268)   tanya.ts (223)  koleksi.ts (99)
```

Hasil pemulihan saya simpan sementara di direktori scratchpad sesi (bukan di repo) dan tidak ikut ter-commit. Jika Anda setuju, ini bisa menjadi commit pertama repo.

---

## 2. Kelayakan per lapisan

### 2.1 Hosting: "Workers Pages" → pakai Workers + Static Assets

- Cloudflare menyatakan **Workers Static Assets adalah jalur yang direkomendasikan untuk proyek baru**; Pages tetap berfungsi tetapi fitur baru difokuskan ke Workers. [V] ([Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/))
- Kebutuhan Lexa (Cron Triggers, Queues consumer, Workflows, Durable Objects, observability lengkap) adalah fitur Workers; dokumen migrasi Pages → Workers menyebut Workers memiliki set fitur yang lebih luas. [V]
- Batas yang relevan [V] ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)): aset statis 100.000 file/versi (Paid) dan 25 MiB/file; CPU hingga 5 menit/request (default 30 detik); subrequest 10.000/request (Paid) tetapi hanya 50 (Free); memori 128 MB; 250 Cron Trigger (Paid) vs 5 (Free).
- Konsekuensi: 305 ribu halaman dokumen **dirender on-demand lalu di-cache**, bukan dibangun statis. Pakai framework SSR di Workers (Astro adalah pilihan paling pas untuk situs kaya konten dan SEO; React Router/SvelteKit juga bisa). Pertahankan Hono untuk API.

### 2.2 Integrasi dengan repo GitHub (Workers Builds)

Cloudflare menyediakan integrasi Git bawaan (GitHub/GitLab) untuk build dan deploy otomatis saat push, **preview per branch/PR** (komentar PR berisi URL preview), GitHub check runs, dukungan monorepo (root directory + watch paths per Worker). [V] ([Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/))

Langkah dan jebakan untuk kasus Anda:

1. Pasang **Cloudflare Workers & Pages GitHub App** pada `singularityn/lexa` (status pemasangan saat ini [?]).
2. Repo perlu `wrangler.jsonc` dengan `name: "lexa"`. **Nama Worker di dashboard harus sama persis dengan `name` di config**, kalau tidak build gagal. [V]
3. **Deploy pertama dari Git menimpa kode live.** Pulihkan sumber dulu, uji di preview, baru aktifkan production.
4. Variabel non-rahasia yang hanya diset di dashboard dan tidak ada di `wrangler.jsonc` berisiko terhapus saat deploy; definisikan di config (atau gunakan `keep_vars`). Secrets tidak terhapus. [I] (uji di preview)
5. Preview memakai resource yang sama kecuali dipisah. Buat set `lexa-staging` (D1, KV, R2, Queue, Vectorize) agar uji tidak menyentuh data produksi.
6. Jalankan migrasi D1 otomatis dan berurutan (`wrangler d1 migrations apply`). Tabel `d1_migrations` sudah mencatat `0000_hapus_skema_lama`, `0001_initial_schema`, `0002_log_ekstraksi`, `0003_fitur_lanjutan`, `0004_akun`; berkas SQL-nya perlu direkonstruksi dari skema aktif.
7. Konfigurasi cron, queue consumer, Vectorize, dan vars harus disalin dari dashboard ke `wrangler.jsonc` agar repo menjadi sumber kebenaran. [?]
8. Repo masih kosong: buat `main` terlebih dahulu sebagai production branch.

### 2.3 Sumber data: peraturan.bpk.go.id (pusat risiko)

**Yang saya ketahui:**

- Struktur URL (dari hasil pencarian) [P]: detail `/Details/{id}/{slug}` (mis. [UU 11/2020](https://peraturan.bpk.go.id/Details/149750/uu-no-11-tahun-2020)), varian lama `/Home/Details/…`, unduhan `/Download/{id}/{nama-file}.pdf`, pencarian `/Search?jenis=…&tema=…&page=…`, daftar jenis `/Jenis`, statistik `/Statistik`.
- Statistik (snapshot dari ringkasan halaman `/Statistik`, belum saya buka langsung) [P]:

| Kategori | Berlaku | Tidak berlaku | Total |
|---|---:|---:|---:|
| Peraturan pusat | 13.649 | 3.720 | 17.369 |
| Peraturan K/L | 15.830 | 7.918 | 23.748 |
| Peraturan daerah | 244.910 | 19.226 | 264.136 |
| Peraturan BPK | 24 | 24 | 48 |
| **Total** | | | **± 305.301** |

  Konsisten dengan ID dokumen terbaru yang terlihat (UU 63/2024 = ID 304897).
- Medan metadata yang terbukti ada (dari pemetaan di kode v0.1) [V]: Judul, Bentuk (singkat), Nomor, Tahun, Status, Tanggal Penetapan, Tanggal Pengundangan/Berlaku, T.E.U. Badan/Tempat Penetapan, Subjek, Bidang, Abstrak, dan daftar **peraturan terkait** (mengubah, diubah oleh, mencabut, dicabut oleh, dasar hukum, pelaksana). Dari hasil pencarian, ada juga "Sumber: LN/TLN" dan jumlah halaman. [P]
- Disclaimer situs (menurut ringkasan hasil pencarian, teks resminya perlu dibaca langsung): dokumen bersumber dari situs instansi terkait dan bila ada perbedaan isi pengguna diminta memverifikasi ke instansi; layanan bisa diakses publik gratis tanpa syarat. [P]

**Yang tidak bisa saya verifikasi [?]:** `robots.txt`, syarat penggunaan, batas laju, perilaku WAF/anti-bot terhadap egress Cloudflare, ada tidaknya API atau ekspor massal. Host `peraturan.bpk.go.id` diblokir oleh kebijakan jaringan environment sesi ini (bukan oleh BPK).

**Indikasi risiko akses:**

- Kode `PUT /pdf` di v0.1 menolak isi yang bukan `%PDF-` dengan pesan: "Sesi BPK mungkin kedaluwarsa dan yang terunduh adalah halaman challenge." Artinya penulis v0.1 mengunduh PDF dengan sesi yang melewati challenge dan mengunggahnya dari luar. [V]
- README komunitas [indonesia-gov-apis](https://github.com/suryast/indonesia-gov-apis) mencatat `jdih.bpk.go.id` (portal BPK yang berbeda dari `peraturan.bpk.go.id`) memberi 403 dari luar negeri dan 200 dari Indonesia, serta klaim umum bahwa banyak situs .go.id memblokir IP datacenter. Ini klaim komunitas, belum diuji untuk host yang relevan. [P]
- **Browser Run (Browser Rendering) bukan jalan keluar:** endpoint `/crawl` menaati `robots.txt`, mengidentifikasi diri sebagai bot, dan **tidak menembus** bot-protection atau CAPTCHA. [V] ([dokumentasi](https://developers.cloudflare.com/browser-run/quick-actions/crawl-endpoint/))
- Placement hint (`placement.region`, mis. `aws:ap-southeast-3` untuk Jakarta) membuat Worker berjalan di data center Cloudflare dengan latensi terendah ke region itu [V], sehingga **mungkin** membantu bila BPK membatasi geografi. Apakah itu cukup, belum teruji. [?]

**Opsi akuisisi data:**

| Opsi | Cara kerja | Kelebihan | Kekurangan | Penilaian |
|---|---|---|---|---|
| A. Crawl langsung dari Worker (Cron + Queues + Workflows) | Worker `fetch` HTML/PDF BPK dengan kecepatan sopan | 100% di Cloudflare, otomatis | Belum terbukti; ada indikasi challenge/IP block | Uji di Fase 0 |
| B. Harvester terkendali di luar Workers, mendorong ke API impor Lexa | Skrip dengan IP Indonesia mengambil data, lalu `POST /manifest` dan `PUT /pdf` (sudah ada) | Terbukti dipakai v0.1; penyimpanan, pengolahan, dan penyajian tetap di Cloudflare | Ada komponen non-Cloudflare; sesi/challenge rapuh | Jalan sekarang, skala kecil |
| C. Kerja sama resmi dengan BPK (izin tertulis, dump/API, daftar putih User-Agent) | Surat/MoU ke pengelola JDIH BPK | Menghapus risiko hukum dan teknis, data lebih lengkap | Butuh waktu, hasil tidak pasti | **Jalur terbaik jangka panjang** |
| D. Agregator/alternatif: [pasal.id](https://pasal.id/en/api), peraturan.go.id, [JDIHN](https://jdihn.go.id/uploads/user_guide/User%20Guide%20Integrasi.pdf) | API atau crawl sumber lain | Cepat; pasal.id sudah terstruktur (pohon pasal, relasi) | Ketergantungan pihak ketiga; batas 60/menit; pasal.id berlisensi AGPL-3.0 (kode), lisensi datanya tidak saya temukan; BPK bukan lagi source-of-record | Pelengkap dan cross-check saja |

**Rekomendasi:** C + B sebagai jalur utama (BPK sebagai source-of-record untuk metadata dan PDF), D hanya untuk mempercepat dan memvalidasi, A hanya jika uji Fase 0 lolos. **Jangan merekayasa cara menembus challenge, CAPTCHA, atau pemblokiran IP**; itu rapuh dan berisiko hukum (lihat 2.4). Jika Fase 0 menunjukkan BPK menutup akses otomatis, keputusan produk perlu diambil bersama (izin resmi, atau pivot sumber).

Estimasi beban crawl bila diizinkan, pada 1 permintaan/detik [I]: pusat + K/L (41 ribu dokumen × 2 permintaan) ≈ 23 jam; seluruh 305 ribu dokumen ≈ 7 hari. Setelah itu hanya inkremental (puluhan hingga ratusan dokumen per hari).

### 2.4 Aspek hukum dan etika

| Topik | Catatan |
|---|---|
| Hak cipta | UU 28/2014 **Pasal 42**: tidak ada hak cipta atas peraturan perundang-undangan (juga putusan pengadilan dan pidato kenegaraan). Teks peraturan bebas dipakai ulang. [P] Ringkasan AI, anotasi, dan susunan basis data buatan Lexa adalah karya Lexa; sebaliknya, kompilasi data BPK bisa dipersoalkan sebagai ciptaan turunan (UU 28/2014 Pasal 40, perlu dicek). [I] Alasan tambahan untuk meminta izin tertulis. |
| Keabsahan | Naskah resmi adalah yang dimuat di Lembaran/Berita Negara atau Lembaran/Berita Daerah. Salinan elektronik bersifat informatif; BPK sendiri meminta verifikasi ke instansi sumber. [P] Lexa wajib menampilkan disclaimer, tautan sumber resmi, hash PDF, dan waktu panen. |
| Akses otomatis | Mengabaikan `robots.txt` atau menembus mekanisme pengaman dapat dipersoalkan (UU ITE Pasal 30–32). [I] Praktik sopan: User-Agent jelas + kontak, ≤ 1 permintaan/detik atau sesuai `crawl-delay`, jam sepi, conditional GET (ETag/Last-Modified), backoff pada 429/5xx, tombol pemadam. |
| Data pribadi (UU PDP 27/2022) | Peraturan jarang memuat data pribadi, tetapi Lexa menyimpan email/nama/foto Google dan riwayat percakapan. Perlu kebijakan privasi, retensi, hak hapus, dan catatan bahwa D1 berada di Amerika Timur (transfer lintas batas). D1 hanya menawarkan jurisdiction terbatas (misalnya `us`) dan tidak ada yang khusus Indonesia. [V][I] |
| Konten AI | Bukan nasihat hukum; wajib bersitasi; tandai jelas bagian yang dihasilkan AI; sediakan jalur koreksi (`laporan_kesalahan` sudah ada). |

### 2.5 Pipeline ingest di Cloudflare

| Tahap | Layanan | Catatan |
|---|---|---|
| Penjadwalan | Cron Triggers | CPU 30 detik (interval < 1 jam) atau 15 menit (≥ 1 jam). [V] |
| Antrean dan fan-out | Queues | `max_concurrency`, `max_retries`, dead-letter queue, `retry_delay` tersedia di konfigurasi. [V] Konsumen v0.1 sudah menangani 429 dengan menunda sisa batch. |
| Backfill jangka panjang | **Workflows** | Default 10.000 langkah/instans (hingga 25.000), 50.000 instans berjalan bersamaan, 300 pembuatan instans/detik, retensi status 30 hari (Paid). CPU 30 detik/invokasi (hingga 5 menit). [V] ([limits](https://developers.cloudflare.com/workflows/reference/limits/)) Cocok menggantikan loop offset manual di `sync_state`. |
| Unduh dan simpan PDF | Worker → R2 | Alirkan body ke R2 (jangan muat di memori; batas 128 MB). Hitung SHA-256 sambil mengalir. |
| PDF → teks | `env.AI.toMarkdown()` | Sudah terbukti (bagian 1.4). Batas keluaran 50 juta karakter; pecah PDF raksasa. [V] |
| OCR dokumen pindaian | **Cloudflare Containers** (Tesseract `ind` / `ocrmypdf`) | Deterministik dan murah: ditagih per 10 ms aktif; taksiran ±US$0,0015 per dokumen 30 halaman, ±US$15 untuk 10 ribu dokumen. [V][I] ([harga](https://developers.cloudflare.com/containers/platform/pricing/)). Alternatif: model visi Workers AI (Qwen3.8-27B, GLM-5.3-Flash) hanya untuk dokumen "berat" atau sebagai penguji sampel, bukan OCR utama, karena risiko halusinasi pada teks hukum. |
| Parser struktur | Worker (TypeScript) | Sudah ada (BAB, Bagian, Pasal, Ayat, Penjelasan). Tambahkan huruf/angka, Lampiran, Konsiderans (Menimbang/Mengingat → relasi `dasar_hukum`). |
| Kontrol mutu | D1 `ekstraksi_log` + sampling | Pertahankan skor kerusakan; tambahkan verifikasi sampel dengan model visi (membandingkan teks dengan gambar halaman) seperti dilakukan proyek pasal.id. [P] |
| Embedding dan indeks | Workers AI → Vectorize, D1 FTS5 | Bagian 2.6. |

### 2.6 Penyimpanan dan pencarian

**D1.** Harga dan batas [V] ([pricing](https://developers.cloudflare.com/workers/platform/pricing/)): Free 5 GB total, 5 juta baris dibaca/hari, 100 ribu baris ditulis/hari (**sejak 1 Sep 2026 kueri gagal bila melewati batas harian**); Paid menyertakan 25 miliar baca dan 50 juta tulis per bulan, 5 GB termasuk lalu US$0,75/GB-bulan. Batas ukuran per database biasanya 10 GB di Paid, tetapi angkanya tidak muncul di dokumentasi yang saya akses, jadi perlu dicek. [?] FTS5 didukung (v0.1 memakainya); ekspor database dengan virtual table sebaiknya tidak diandalkan sebagai backup, jadi simpan salinan kanonik JSONL di R2. [I]

**Read replication.** D1 membuat replika baca otomatis di setiap region (ENAM, WNAM, WEUR, EEUR, APAC, OC), **tanpa biaya tambahan**, tetapi hanya dipakai bila kode memakai **Sessions API** (`env.DB.withSession()`). [V] ([dokumentasi](https://developers.cloudflare.com/d1/best-practices/read-replication/)) v0.1 memakai `env.DB.prepare()` langsung, jadi semua kueri ke primary di Amerika.

**Vectorize.** Satu indeks hingga 20 juta vektor, 1.536 dimensi, topK 50 (dengan metadata) atau 100, 10 metadata index, upsert 1.000/batch. [V] ([limits](https://developers.cloudflare.com/vectorize/platform/limits/)) Rumus biaya: `((kueri + vektor tersimpan) × dimensi × US$0,01/juta) + (vektor tersimpan × dimensi × US$0,05/100 juta)`, dengan jatah gratis 50 juta dimensi terkueri dan 10 juta tersimpan. [V] Artinya **biaya didominasi jumlah vektor, bukan trafik**.

**Model Workers AI relevan** [V]: embedding `@cf/baai/bge-m3` (multibahasa 100+ bahasa, US$0,0118 per juta token), `@cf/qwen/qwen3-embedding-0.6b` (1.024 dim, konteks 8.192), `@cf/google/embeddinggemma-300m`; reranker `@cf/baai/bge-reranker-base`; LLM `qwen3-30b-a3b-fp8` (US$0,0509/0,335 per juta token masuk/keluar), `glm-5.3-flash` (US$0,15/0,50), `qwen3.8-27b` (US$0,45/3,20); terjemahan `m2m100-1.2b`.

**AI Search (RAG terkelola) vs rakit sendiri** [V] ([limits & pricing](https://developers.cloudflare.com/ai-search/platform/limits-pricing/)): AI Search GA sejak 1 Okt 2026, hybrid search default, OCR tersedia untuk PDF pindaian, **penagihan mulai 1 Nov 2026**: ingest US$0,75/juta token, penyimpanan US$2/GB-bulan, kueri semantik/hybrid US$0,75 per 1.000, full-text US$0,10 per 1.000. Batasnya: 100.000 file/instans (Free) atau 500.000 untuk hybrid (Paid), hanya 5 field metadata kustom, kontrol chunking terbatas. Perbandingan ingest: US$0,75 vs US$0,0118 per juta token berarti **sekitar 64× lebih mahal** daripada embedding langsung. Untuk Lexa: **pertahankan pipeline sendiri** (D1 FTS5 + Vectorize); gunakan AI Search hanya untuk fitur dokumen privat milik pengguna atau prototipe cepat.

**Peningkatan pencarian yang disarankan:**

1. Tambahkan kolom teks **terstem saat indeks** (`isi_stem`) agar normalisasi simetris dengan kueri (saat ini stemming hanya di sisi kueri).
2. Reranker `bge-reranker-base` pada top 30 → 10.
3. Chunk **per pasal** (gabungkan ayat) dengan awalan konteks "UU 13/2003 › BAB XI › Pasal 156" agar vektor lebih sedikit dan lebih bermakna.
4. Filter metadata Vectorize untuk `jenis`, `status`, `tahun` (sudah ada sebagian).
5. Golden set 100–200 kueri (sitasi, istilah awam, pertanyaan situasional) untuk mengukur recall@10 dan MRR sebelum dan sesudah tiap perubahan.

### 2.7 AI / RAG

- Prompt dan ambang relevansi v0.1 sudah baik sebagai dasar. Tambahkan: (a) verifikasi pasca-jawaban bahwa setiap sitasi ada di konteks yang diambil, (b) penolakan eksplisit di luar cakupan, (c) harness evaluasi otomatis, (d) cache jawaban untuk pertanyaan populer.
- Taksiran biaya per pertanyaan (2,7 ribu token masuk + 0,5 ribu keluar) [I]: `qwen3-30b-a3b` ≈ US$0,0003 (≈ US$31 per 100 ribu pertanyaan); `glm-5.3-flash` ≈ US$0,00065 (≈ US$65); `qwen3.8-27b` ≈ US$0,0028 (≈ US$280). Model bernalar menghasilkan lebih banyak token keluaran, jadi bisa 2–5× lebih mahal.
- Kualitas bahasa Indonesia untuk tiap model harus diuji dengan golden set, bukan diasumsikan.
- Gunakan **AI Gateway** untuk cache, pembatasan laju, log, dan anggaran. Penyedia eksternal bisa ditambahkan lewat Gateway bila diinginkan, tetapi itu keluar dari prinsip "semua di Cloudflare".

### 2.8 Performa untuk pengguna Indonesia

Sasaran awal (belum diukur) [I]: p95 pencarian kata kunci < 300 ms dan halaman dokumen ter-cache < 150 ms dari Jakarta.

1. Aktifkan read replication + Sessions API (gratis). Penulisan hanya dari ingest (batch), jadi primary di Amerika bisa diterima.
2. Kurangi kueri berurutan: gabungkan lewat `batch()`; hindari satu kueri per hasil.
3. Cache: `Cache-Control` + `stale-while-revalidate` untuk halaman dokumen, KV/Cache API untuk hasil pencarian populer dan embedding kueri.
4. Teks panjang dan PDF disajikan dari R2 lewat CDN (egress R2 gratis). [V]
5. Streaming jawaban AI.
6. `placement.mode = "smart"` **tidak** cocok untuk jalur pengguna (akan menjauhkan Worker dari pengguna); biarkan Worker di edge dan andalkan replika. Placement region hanya untuk Worker ingest. [I]
7. D1 baru dengan location hint `apac` hanya bila replika tidak cukup; lokasi ditentukan saat pembuatan dan migrasi dengan FTS perlu dibangun ulang dari R2. [I]

### 2.9 Keamanan, privasi, dan penyalahgunaan

- Ganti pembatas laju berbasis KV dengan **Rate Limiting binding** atau Durable Object; pasang **Turnstile** pada `/api/tanya` dan `/laporan`; aturan WAF; anggaran dan peringatan di AI Gateway.
- Pindahkan secrets ke Secrets Store atau pertahankan sebagai Worker secrets; rotasi `ADMIN_TOKEN`; batasi `/admin/*` dengan **Cloudflare Access**.
- Backup: D1 Time Travel + dump JSONL berkala ke R2.
- Observabilitas: Workers Logs/Traces, Analytics Engine untuk metrik pencarian, Web Analytics yang ramah privasi.

---

## 3. Estimasi skala dan biaya (orde besaran) [I]

Asumsi: dua skenario berdasarkan statistik BPK (bagian 2.3) dan rasio nyata dari D1 Anda (12,7 baris pasal per peraturan, 427 karakter per baris, 2,7× overhead). Teks rata-rata per dokumen belum pasti, jadi diberi rentang.

| Komponen | Skenario S: pusat + K/L (± 41 ribu dok) | Skenario L: + Perda (± 305 ribu dok) |
|---|---|---|
| Baris pasal/ayat | 0,5–1,6 juta | 3,9–8 juta |
| D1 (teks + FTS5 + indeks) | 0,6–2,4 GB (muat dalam jatah 5 GB) | 4,5–18 GB; kemungkinan perlu ≥ 2 database + sekitar US$0–10/bln |
| R2 (PDF + teks) | ± 12–40 GB ≈ US$0,2–0,6/bln | ± 90–300 GB ≈ US$1,4–4,5/bln; operasi tulis sekali jalan ≈ US$1,4 |
| Vektor (1.024 dim, 300 ribu kueri/bln) | US$8–20/bln | US$40–90/bln |
| Embedding korpus (sekali, bge-m3) | ≈ US$1–3 | ≈ US$5–20 |
| Workers Paid | US$5/bln | US$5/bln + kelebihan trafik |
| LLM tanya-jawab | US$3–30 untuk 10–50 ribu pertanyaan dengan model hemat; hingga ± US$280 per 100 ribu pertanyaan dengan model besar | sama |
| **Total perkiraan (model hemat)** | **≈ US$20–55/bln** | **≈ US$50–140/bln** |

Strategi menekan ukuran untuk Perda: **indeks berjenjang**. Tingkat 1 (indeks penuh per pasal + vektor) untuk peraturan pusat, K/L, dan Perda provinsi atau Perda strategis; tingkat 2 (metadata + judul + ringkasan, vektor tingkat dokumen) untuk sisanya, dengan ekstraksi teks **on-demand** saat dokumen dibuka lalu di-cache.

---

## 4. Arsitektur target dan struktur repo

```
Pengguna ─▶ Edge Cloudflare (CDN, WAF, Turnstile, Rate Limiting)
              │
              ▼
      Worker "lexa"  (Hono API + SSR + Static Assets)
        │     │      │       │
        │     │      │       └─▶ D1 (metadata, pasal, FTS5; replika baca APAC)
        │     │      └─────────▶ Vectorize (vektor per pasal)
        │     └────────────────▶ KV (cache/sesi)   R2 (PDF, teks, dump JSONL)
        └──────────────────────▶ Workers AI via AI Gateway (embedding, rerank, LLM)

Cron ─▶ Worker "lexa-ingest" ─▶ Queues ─▶ konsumen (unduh, parse, indeks)
              ▲                                │
   Workflows (backfill & retry jangka panjang) └─▶ Containers (OCR Tesseract)
              ▲
   Sumber: BPK (izin / harvester / crawl terbukti) · pasal.id (opsional, cross-check)
```

Struktur monorepo yang disarankan (pnpm workspaces; tiap Worker = satu proyek Workers Builds dengan root directory dan watch paths sendiri):

```
lexa/
├─ apps/
│  ├─ web/        # Worker "lexa": SSR + API (Hono), aset statis
│  └─ ingest/     # Worker "lexa-ingest": cron, queue, workflows, API impor
├─ packages/
│  ├─ core/       # tipe, FRBR URI, parser sitasi, stemmer, parser pasal (+ tes)
│  └─ db/         # migrasi D1 dan kueri bertipe
├─ migrations/    # 0000–0004 sebagai baseline, lalu lanjut
├─ docs/
└─ .github/workflows/   # CI: typecheck, tes, lint, migrasi pratinjau
```

Tahap awal boleh satu Worker saja (struktur v0.1) lalu dipecah saat ingest membesar.

---

## 5. Risiko dan mitigasi

| # | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| R1 | Akses BPK (challenge/geo-block/syarat penggunaan/izin) | Tinggi | Surat resmi ke BPK; uji Fase 0 dari tiga titik pandang; harvester terkendali; sumber cadangan; tanpa penerobosan pengaman |
| R2 | Kekeliruan konten hukum (teks salah/usang) menimbulkan kerugian | Tinggi | Disclaimer, tautan sumber resmi, hash dan waktu panen, badge status, lencana kualitas ekstraksi, jalur lapor kesalahan, AI hanya bersitasi |
| R3 | Kualitas ekstraksi (±20% tanpa lapisan teks, OCR salah) | Sedang–Tinggi | Pipeline OCR, sampling dengan model visi, tampilkan PDF di samping teks, tandai dokumen berkualitas rendah |
| R4 | Batas dan biaya platform (ukuran D1, biaya vektor, penagihan AI Search 1 Nov 2026, batas gratis D1 sejak 1 Sep 2026) | Sedang | Sharding D1, chunk per pasal, indeks berjenjang, anggaran dan peringatan penagihan, pakai Paid |
| R5 | Ketergantungan pihak ketiga (pasal.id: token, 60/menit, AGPL) | Sedang | Jadikan opsional; jangan menyalin kode AGPL ke Lexa tanpa memahami konsekuensinya; BPK sebagai sumber utama |
| R6 | Latensi tinggi untuk pengguna Indonesia | Sedang (pasti terjadi) | Read replication + Sessions API, cache, kurangi kueri berurutan |
| R7 | Kode di luar Git, satu pemilik pengetahuan | Sedang | Pulihkan sumber, CI, review, dokumentasi |
| R8 | Penyalahgunaan (scraping Lexa, biaya AI) | Sedang | Turnstile, Rate Limiting, WAF, AI Gateway, API key |
| R9 | Privasi pengguna (UU PDP) | Rendah–Sedang | Kebijakan privasi, retensi, hak hapus, minimisasi data |
| R10 | Perubahan platform (Pages → Workers, `McpAgent` kini feature-frozen, penagihan baru) | Rendah–Sedang | Kunci versi, pantau changelog, gunakan `createMcpHandler` untuk MCP |

---

## 6. Peta jalan bertahap

Perkiraan kasar untuk 1–2 pengembang; angka waktu bukan komitmen.

**Fase 0: Pembuktian dan fondasi (± 1 minggu)**

1. Kirim permintaan resmi ke pengelola JDIH BPK (izin pemakaian ulang, ekspor massal/API, daftar putih User-Agent, kontak teknis).
2. Uji akses BPK dari tiga titik: (i) Worker biasa, (ii) Worker dengan `placement.region = aws:ap-southeast-3`, (iii) mesin di Indonesia. Catat status, header, tipe isi (PDF atau HTML challenge), `robots.txt`, `/Statistik`. Putuskan opsi A/B/C.
3. Pulihkan sumber v0.1 ke repo (`main`), tambahkan `wrangler.jsonc` yang menunjuk resource yang ada, rekonstruksi berkas migrasi.
4. Hubungkan Workers Builds (preview dulu, production setelah regresi nol); set staging.
5. Quick wins: aktifkan read replication + Sessions API; hentikan kegagalan sinkronisasi (pisahkan anggaran laju daftar vs detail, atau pindah sumber); ganti pembatas laju.
6. Buat golden set evaluasi pencarian.

*Kriteria selesai:* keputusan jalur akuisisi BPK terdokumentasi; deploy dari GitHub setara v0.1; latensi pencarian turun signifikan.

**Fase 1: Korpus pusat + K/L (± 3–5 minggu)** — pipeline akuisisi sesuai Fase 0 (Workflows + Queues), OCR di Containers, parser v2 (huruf/angka, Lampiran, Konsiderans), relasi `dasar_hukum`, status, sinkronisasi inkremental harian, dasbor mutu data.
*Kriteria:* ≥ 95% dokumen punya teks; ≥ 90% berkualitas bersih/ringan; metadata ≥ 98% lengkap.

**Fase 2: Produk publik (± 3–4 minggu)** — UI SSR (Astro), halaman dokumen per pasal dengan tautan dalam, filter facet, koleksi, laporan kesalahan, SEO (sitemap index, JSON-LD), disclaimer, kebijakan privasi, Turnstile; peluncuran beta.

**Fase 3: AI dan pemantauan (± 3–4 minggu)** — Tanya Lexa v2 (reranker + evaluasi + verifikasi sitasi), ringkasan, notifikasi/digest, API publik, MCP server.

**Fase 4: Perda dan fitur lanjutan (berkelanjutan)** — Perda berjenjang, peta, pelacak peraturan pelaksana, validator dasar hukum, konsolidasi (riset), fitur tim.

---

## 7. Analisis lanjutan: fitur pendukung

Skala usaha: **S** ≤ 1 minggu, **M** 1–3 minggu, **L** > 3 minggu. Nilai: T (tinggi), S (sedang), R (rendah).

### 7.1 Inti produk

| Fitur | Nilai | Usaha | Layanan Cloudflare / data | Catatan |
|---|---|---|---|---|
| Katalog dan filter facet (jenis, tahun, status, instansi, bidang, wilayah) | T | M | D1 | Wilayah penting untuk Perda |
| Pencarian sitasi dan alias ("UU ITE", "KUHP", "Pasal 28 UU 11/2008") | T | S | D1 + parser sitasi (sebagian sudah ada) | Jalur tercepat dan paling presisi |
| Halaman dokumen: metadata, status, relasi, PDF, teks per pasal, daftar isi, salin sitasi | T | M | SSR, D1, R2 | Tautan dalam `/uu/13/2003/pasal/156/ayat/1` |
| Penjelasan berdampingan (Penjelasan Umum dan Pasal demi Pasal) | S–T | S | parser (regex sudah ada) | Membantu pembaca non-ahli |
| Status dan kekuatan berlaku + linimasa perubahan | T | M | data BPK (status + relasi) | Diferensiasi berbasis data resmi |
| SEO skala besar (SSR, sitemap index, JSON-LD `Legislation`, kanonik) | T | M | Workers, Cache | Sumber pertumbuhan organik |
| Koleksi, catatan, riwayat, ekspor (PDF/DOCX/Markdown, BibTeX/RIS) | S | M | D1, R2 | Backend koleksi sudah ada |
| PWA, mode hemat data, baca offline | S | M | Service Worker + Cache | Relevan untuk konektivitas |
| Aksesibilitas (ukuran huruf, kontras, baca-keras lewat Web Speech API) | S | S | frontend | TTS di Workers AI tidak mencakup bahasa Indonesia [I] |

### 7.2 Kecerdasan hukum

| Fitur | Nilai | Usaha | Layanan Cloudflare / data | Catatan |
|---|---|---|---|---|
| Tanya Lexa v2 (reranker, evaluasi, verifikasi sitasi, penolakan) | T | M | Workers AI, Vectorize, AI Gateway | Sudah ada versi dasar |
| Ringkasan dan "bahasa awam" per dokumen/pasal | S–T | S | Workers AI | Wajib berlabel AI |
| Ekstraksi terstruktur: definisi, sanksi, kewajiban, tenggat, instansi pelaksana | T | L | Workers AI + aturan | Akurasi harus diukur; tampilkan kutipan sumber |
| **Pelacak peraturan pelaksana**: deteksi "diatur lebih lanjut dengan PP/Perpres/Permen", cocokkan dengan peraturan yang mencantumkannya di Mengingat, tampilkan terbit/belum | T | L | parser + relasi `dasar_hukum` | Fitur yang jarang ada; bernilai bagi tim kepatuhan |
| **Validator dasar hukum**: unggah draf, deteksi sitasi, cek status berlaku, usulkan dasar hukum | T | M | parser sitasi + D1 | Sangat berguna untuk perancang peraturan |
| Perbandingan dua dokumen/versi (diff), Perppu vs UU | S | M | D1/R2 | Konsolidasi otomatis (menerapkan diktum perubahan) adalah riset terpisah |
| Glosarium dari Ketentuan Umum + perbandingan definisi lintas peraturan | S–T | M | ekstraksi + Vectorize | Menunjukkan istilah yang didefinisikan berbeda |
| Terjemahan Inggris tidak resmi | S | S | `m2m100-1.2b` | Tandai jelas tidak resmi; berguna bagi investor asing |
| Analisis kontrak terhadap regulasi (dokumen privat pengguna) | T | L | AI Search per-tenant atau R2 privat | Privasi dan UU PDP; paket berbayar |

### 7.3 Navigasi dan visualisasi

| Fitur | Nilai | Usaha | Catatan |
|---|---|---|---|
| Graf relasi (mengubah, mencabut, dasar hukum, pelaksana) | S–T | M | Endpoint `/relasi/graf` sudah ada |
| Hierarki norma (UUD → UU → PP → Perpres → Permen → Perda) | S | S | Berdasar jenis |
| Peta dan analitik Perda per daerah/topik; perbandingan antar daerah (pajak, retribusi) | S–T | L | Setelah korpus Perda |
| Dasbor "kesehatan data" publik (cakupan, kualitas, sinkron terakhir) | S | S | Membangun kepercayaan |

### 7.4 Pemantauan dan notifikasi

| Fitur | Nilai | Usaha | Layanan | Catatan |
|---|---|---|---|---|
| Pantau topik/instansi/jenis, digest email | T | M | Email Service (pengiriman masih beta, butuh Paid) [V], Cron | Retensi pengguna |
| Umpan RSS/Atom, webhook, bot Telegram | S | S | Workers | Murah dibuat |
| Peringatan perubahan status untuk dokumen di koleksi | T | S | D1 + Cron | Memanfaatkan sinkron harian |

### 7.5 Platform dan ekosistem

| Fitur | Nilai | Usaha | Layanan | Catatan |
|---|---|---|---|---|
| REST API publik + OpenAPI + API key | T | M | Workers, KV/D1, Rate Limiting | Dasar untuk integrasi pihak lain |
| **MCP server** agar Claude/ChatGPT/IDE bisa memakai Lexa | T | S–M | Agents SDK `createMcpHandler` (stateless); `McpAgent` kini feature-frozen [V] | Distribusi ke ekosistem agen |
| Ekstensi browser/widget auto-link sitasi | S | M | frontend | Menarik pengguna media dan firma hukum |
| Dump data berkala (JSONL/Parquet) di R2, kueri via R2 SQL | S | M | R2, R2 SQL | Untuk peneliti; perhatikan syarat BPK |

### 7.6 Kolaborasi dan paket profesional

| Fitur | Nilai | Usaha | Layanan | Catatan |
|---|---|---|---|---|
| Ruang kerja tim: koleksi bersama, anotasi, komentar | S–T | L | Durable Objects, D1 | |
| Radar kepatuhan per sektor (paket regulasi + pemantauan + daftar periksa) | T | L | semua di atas | Perlu kurasi isi |
| Asisten harmonisasi Ranperda (tumpang tindih, benturan hierarki) | T | L | Vectorize + relasi | Ada kebutuhan nyata: proyek komunitas Kanwil Kemenkum Kalsel serupa [P] |
| SSO dan kontrol akses untuk instansi | S | M | Cloudflare Access | |
| Pembayaran | — | — | Di luar Cloudflare (mis. Midtrans/Xendit) | Keluar dari prinsip "semua di Cloudflare" |

### 7.7 Mutu data dan operasi

| Fitur | Nilai | Usaha | Catatan |
|---|---|---|---|
| Konsol admin ingest: antrean, kegagalan, override manual, penanganan takedown | T | M | |
| Alur koreksi komunitas (`laporan_kesalahan` → tinjau → tambalan) | T | M | Pola serupa dipakai pasal.id [P] |
| Verifikasi sampel dengan model visi | S–T | M | Dokumen "ringan/berat" |
| Cross-check dengan sumber lain (peraturan.go.id, JDIHN, pasal.id) untuk mendeteksi selisih judul/tanggal/status | S | M | |
| Analitik pencarian (kueri nihil → sinonim baru) | T | S | `/admin/kueri-nihil` sudah ada |

### 7.8 Prioritas yang disarankan

1. **Fondasi kepercayaan:** status, provenance (sumber, hash, waktu panen), disclaimer, jalur koreksi.
2. **Halaman dokumen per pasal + SEO + pencarian sitasi/alias.**
3. **Relasi dan linimasa perubahan** dari data BPK.
4. **Pipeline OCR + kontrol mutu** (menaikkan cakupan teks dari ± 80% ke > 95%).
5. **Pantau dan notifikasi.**
6. **API publik + MCP.**
7. **Pelacak peraturan pelaksana.**
8. **Tanya Lexa v2** (reranker + evaluasi).
9. **Validator dasar hukum.**
10. Perda berjenjang, graf/peta, fitur tim.

---

## 8. Keputusan yang diperlukan dan langkah berikutnya

**Keputusan untuk Anda:**

1. **Kebijakan sumber data:** BPK saja (butuh izin dan harvester) atau hibrida dengan pasal.id untuk akselerasi? Rekomendasi: BPK sebagai source-of-record, pasal.id opsional sebagai pelengkap.
2. **Cakupan peluncuran:** pusat + K/L dulu (rekomendasi), Perda menyusul dengan indeks berjenjang.
3. **Rencana Cloudflare:** Workers Paid (Vectorize, Queues, Containers, Email Sending). Status rencana akun saat ini [?].
4. **Frontend:** Astro SSR (rekomendasi) atau lainnya; apakah sudah ada UI di tempat lain?
5. **Penanggung jawab** komunikasi dengan BPK dan entitas yang mengelola Lexa (syarat penggunaan, privasi, takedown).
6. **Domain** produksi.

**Hal yang dapat saya kerjakan berikutnya (menunggu persetujuan Anda):**

- Memulihkan 17 file TypeScript dari sourcemap ke repo sebagai commit pertama, menyiapkan `wrangler.jsonc` untuk resource yang ada, CI, dan rekonstruksi migrasi. Karena remote masih kosong, push pertama menjadikan branch yang dipush sebagai branch default di GitHub; saya perlu tahu Anda ingin `main` dibuat lebih dulu.
- Mengaktifkan read replication D1 dan menyesuaikan kode ke Sessions API (mengubah setelan produksi, jadi perlu persetujuan).
- Menjalankan uji akses BPK (Fase 0): bisa lewat Worker uji, atau, bila Anda mengizinkan host `peraturan.bpk.go.id` di pengaturan jaringan environment sesi ini (Network access → Custom → Allowed domains; panduan: https://code.claude.com/docs/en/cloud-environments#network-access), saya bisa memeriksa `robots.txt`, struktur halaman, dan perilaku anti-bot dari sandbox. Perlu dicatat, hasil dari sandbox tidak sama dengan perilaku terhadap egress Cloudflare Workers.

---

## Lampiran A. Matriks verifikasi

| Klaim | Status |
|---|---|
| Resource `lexa` di akun Cloudflare (Worker, D1, R2, KV), skema dan statistik data | [V] dibaca read-only |
| Kode, binding, alur ingest, prompt AI, kualitas ekstraksi, log sinkronisasi | [V] dari kode ter-deploy dan D1 |
| Batas dan harga Workers, D1, Vectorize, Workflows, R2, AI Search, Containers, Workers AI | [V] dokumentasi Cloudflare (Okt 2026), kecuali batas ukuran per database D1 [?] |
| Struktur URL, statistik 305 ribu dokumen, disclaimer BPK | [P] hasil pencarian web |
| Perilaku live `peraturan.bpk.go.id` (robots.txt, anti-bot, geo-block, batas laju, syarat penggunaan) | [?] diblokir di sandbox |
| Klaim komunitas tentang pemblokiran IP/geografi situs .go.id | [P] README pihak ketiga, bukan untuk host yang sama |
| Keadaan indeks Vectorize, konfigurasi Queue/cron, pemasangan GitHub App, rencana akun | [?] di luar jangkauan tool |
| Estimasi ukuran, biaya, dan waktu | [I] asumsi tercantum |

## Lampiran B. Sumber

Cloudflare (dokumentasi resmi): [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) · [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) · [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) · [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) · [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/) · [D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/) · [D1 data location](https://developers.cloudflare.com/d1/configuration/data-location/) · [Vectorize limits](https://developers.cloudflare.com/vectorize/platform/limits/) · [AI Search limits & pricing](https://developers.cloudflare.com/ai-search/platform/limits-pricing/) · [Workers AI bge-m3](https://developers.cloudflare.com/workers-ai/models/bge-m3/) · [R2 pricing](https://developers.cloudflare.com/r2/pricing/) · [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/) · [Browser Run crawl](https://developers.cloudflare.com/browser-run/quick-actions/crawl-endpoint/) · [Remote MCP server](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/) · [Email Service](https://developers.cloudflare.com/email-service/)

Publik: [Database Peraturan BPK](https://peraturan.bpk.go.id/) · [Statistik](https://peraturan.bpk.go.id/Statistik) · [Jenis](https://peraturan.bpk.go.id/Jenis) · [UU 28/2014 (Wikisumber)](https://id.wikisource.org/wiki/Undang-Undang_Republik_Indonesia_Nomor_28_Tahun_2014) · [Pasal 42 UU 28/2014 di pasal.id](https://pasal.id/peraturan/uu/uu-no-28-tahun-2014/pasal-42) · [pasal.id](https://pasal.id/en) · [github.com/ilhamfp/pasal](https://github.com/ilhamfp/pasal) · [github.com/suryast/indonesia-gov-apis](https://github.com/suryast/indonesia-gov-apis) · [github.com/NeaByteLab/Peraturan-Crawler](https://github.com/NeaByteLab/Peraturan-Crawler) · [github.com/TenkaMyLove/Sistem-Pencarian-Pasal](https://github.com/TenkaMyLove/Sistem-Pencarian-Pasal) · [Panduan integrasi JDIHN](https://jdihn.go.id/uploads/user_guide/User%20Guide%20Integrasi.pdf) · [API JDIH Perpusnas](https://api-jdih.perpusnas.go.id/docs/index.html)
