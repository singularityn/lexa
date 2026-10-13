# Analisis lanjutan: pencarian, login Google, menu PDF, dan panen BPK

Dokumen ini menjawab empat catatan pemilik sesudah mencoba Lexa di produksi (12 Okt 2026) dan melanjutkan
[analisis-ux-dan-fitur.md](analisis-ux-dan-fitur.md) serta [pipeline-data.md](pipeline-data.md). Angka produksi diukur
langsung dari D1 `lexa-db` (hanya dibaca) pada 12 Okt 2026. Hal yang saya tidak bisa periksa dari lingkungan pengembangan
ditandai **[?]**, dan yang saya ketahui hanya dari hasil pencarian web (bukan dari membuka situsnya) ditandai **[P]**.

Isi: [ringkasan](#1-ringkasan) · [pencarian](#2-pencarian-peraturan-yang-namanya-memuat-kata-kunci-di-atas) ·
[login Google](#3-login-google-error-400-redirect_uri_mismatch) · [menu PDF](#4-menu-pdf-dan-fitur-lanjutannya) ·
[panen BPK](#5-panen-lanjutan-dari-bpk) · [temuan kualitas data](#6-temuan-kualitas-data-produksi) ·
[yang perlu Anda lakukan](#7-yang-hanya-bisa-anda-lakukan) · [peta jalan](#8-peta-jalan) · [pengujian](#9-pengujian)

## 1. Ringkasan

| Catatan Anda | Hasil | Status |
|---|---|---|
| Pencarian harus mengutamakan peraturan yang **judulnya** memuat kata yang dicari, bukan pasal yang menyebutnya | urutan hasil bertingkat: sitasi, lalu peraturan berjudul cocok, lalu fusi biasa; penilai judul sendiri (bukan BM25) | selesai, terpasang |
| Login Google: `Error 400: redirect_uri_mismatch` | penyebabnya di konsol Google (alamat pengalihan belum terdaftar persis); Lexa kini menampilkan alamat yang harus didaftarkan | **perlu tindakan Anda** ([bagian 7](#7-yang-hanya-bisa-anda-lakukan)) |
| Menu yang menampilkan PDF, untuk mengatasi ekstraksi yang belum akurat, dan fitur lanjutannya | tab **PDF** (PDF.js, jalan di ponsel), **Lihat di PDF** per pasal, **Periksa pasal** (PDF dibandingkan dengan teks di Lexa) | selesai, terpasang; fitur berikutnya di [bagian 4.3](#43-fitur-lanjutan-dan-urutan-pengerjaannya) |
| Panen lanjutan dari BPK untuk mengekstrak pasal dari dokumennya | skrip konsol dua tahap (jelajahi daftar BPK dan tautkan, lalu panen PDF), sisi server yang tahan terhadap data produksi yang kotor | kode selesai dan diuji terhadap BPK palsu; **belum pernah dijalankan di situs BPK sungguhan** |

Dua hal yang perlu terus terang dikatakan di awal:

- Sandbox pengembangan dan Worker Lexa **tidak bisa menjangkau peraturan.bpk.go.id** (di balik Cloudflare managed
  challenge; dari sandbox, DNS-nya pun diblokir). Karena itu panen tetap dijalankan dari peramban Anda, dan skrip panen
  saya tulis menurut apa yang diketahui tentang susunan BPK (alamat `/Details/<id>/<slug>`, `/Download/…`,
  `/Search?jenis=<n>&page=<n>`) lalu diuji terhadap situs BPK **palsu**. Dokumen ini memuat cara mengirim balik hasilnya bila
  ada yang tak cocok; perbaikannya kecil dan dikerjakan di sisi server tanpa menempel ulang skrip.
- Teks pasal untuk ±3.700 peraturan (3.502 PP, 158 UU, 17 Perppu, 39 Tap MPR, 5 UUD) belum ada di Lexa dan **hanya bisa datang dari naskah resmi**
  (pasal.id sejak 11 Okt 2026 hanya memberi metadata lewat API-nya). Itulah yang dikerjakan panen BPK; selama belum
  dijalankan, halaman bacanya menautkan naskah resmi dan tidak menampilkan pasal.

## 2. Pencarian: peraturan yang namanya memuat kata kunci di atas

**Keluhan**: mencari "kelautan" menampilkan pasal-pasal yang menyebut kata itu, sedangkan UU 32/2014 tentang Kelautan
tenggelam.

**Penyebab** (terbukti pada data produksi, bukan dugaan):

1. Fusi RRF menyejajarkan daftar peraturan dan daftar pasal. Sebuah pasal bisa menerima sumbangan dari pencarian teks *dan*
   vektor; sebuah peraturan hanya dari pencarian teks, sehingga skornya hampir selalu lebih kecil.
2. BM25 pada indeks peraturan tidak membedakan "judulnya Kelautan" dari "judulnya panjang dan kebetulan menyebut Kelautan":
   dari delapan judul yang memuat kata itu, UU 32/2014 berada di urutan **kedelapan**, di bawah tujuh PP tarif PNBP
   "... pada Departemen Kelautan dan Perikanan". Untuk "perikanan" (72 judul), UU 31/2004 yang berjudul persis "PERIKANAN"
   ada di urutan ke-58.
3. Kolom `tentang` di produksi berisi *bidang* ("PERIKANAN DAN KELAUTAN"), bukan pokok judul, jadi tak bisa dijadikan sinyal.

**Perbaikan** (`src/worker/lib/judul.ts`, `search.ts`, `query.ts`):

- Urutan akhir bertingkat: **sitasi** ("UU 13/2003") → **peraturan yang pokok judulnya memuat semua kata** → fusi biasa.
  Pokok judul = bagian sesudah " tentang " pertama pada judul resmi ("Undang-Undang Nomor 32 Tahun 2014 tentang **Kelautan**");
  kata di bagian depan ("Peraturan Pemerintah Nomor 27 Tahun 2021") tidak meloloskan apa pun.
- Penilai judul sendiri: kepadatan (bagian pokok judul yang dibicarakan kata itu), kata persis, kata terdepan, penalti bila
  hanya awalan, bonus bila belum dicabut. "Kelautan" 1/1 mengalahkan "Penyelenggaraan Bidang Kelautan dan Perikanan" 1/4
  dan PP tarif 1/10. Seri diputus hierarki jenis (UUD, Tap MPR, UU, Perppu, PP), lalu yang lebih baru.
- Bahan penilai diambil dari 100 judul dengan **pokok terpendek**, bukan urutan BM25 (BM25 terbukti memotong judul terbaik).
- **Jatah halaman** (15 dari 20, 37 dari 50 hasil) supaya kata umum ("pajak": 520 judul) tidak menghabiskan halaman dan pasal
  yang memuatnya tetap tampil.
- Singkatan jenis di depan kata lain membatasi tingkat judul ("uu perikanan", "pp kelautan"). Tanya Lexa tidak terpengaruh
  (ia hanya memakai pasal). Hasil membawa `cocok_judul: true`; kunci cache naik ke `v5`; saran ketik memakai penilai yang sama.
- Tampilan: halaman hasil memberi dua kelompok, "Peraturan yang judulnya memuat “…”" dan "Pasal dan hasil lainnya".
- Sekalian: `uraiKueri("constructor")` melempar galat 500 (kamus sinonim dibaca lewat warisan `Object`); kini hanya properti
  miliknya sendiri.

**Cara memeriksa di produksi**: cari `kelautan` (UU 32/2014 paling atas), `perikanan` (UU 31/2004), `ketenagakerjaan`,
`uu perikanan`. Bila ada kata yang masih keliru, kirim kata itu: `GET /api/admin/kueri-nihil` mencatat kueri tanpa hasil.

**Batas yang diketahui**:

- **73 dari 7.177 judul hanya berupa rujukan** ("Undang-Undang Nomor 7 Tahun 1981"): sumber katalognya tak memberi pokok, jadi
  mereka tak bisa lolos tingkat judul. Panen BPK memperbaikinya untuk peraturan yang dikunjungi (judul resmi BPK menggantikan
  judul tanpa pokok).
- Pencarian ini leksikal: "kelautan" tidak otomatis menemukan judul yang hanya berkata "laut", dan tak ada pemenggalan
  imbuhan (me-, ber-, -an, -kan). Pemenggalan ringan untuk tingkat judul adalah perbaikan berikutnya yang murah
  ([bagian 8](#8-peta-jalan)).
- Judul bersampah hasil salin PDF (mis. UU 4/2026: "… tentang UNDANG-UNDANG REPUBLIK INDONESIANOMOR 4 TAHUN 2026TENTANG…")
  tetap memuat kata kunci, tetapi kepadatannya buruk; panen BPK menggantinya dengan judul resmi.

## 3. Login Google: Error 400 redirect_uri_mismatch

**Penyebab**. Galat itu dijawab *halaman Google sendiri* dan tidak mengembalikan peramban ke Lexa, jadi Lexa tak bisa
menjelaskan apa pun saat terjadi. Artinya alamat pengalihan yang dikirim Lexa tidak terdaftar **persis** pada klien OAuth di
Google Cloud Console. Dokumentasi sebelumnya tak pernah menyebut alamat apa yang harus didaftarkan; itu kekurangan kami.

**Yang dikirim Lexa**: `https://<host-yang-dipakai>/api/auth/google/callback`. Untuk produksi:

```
https://lexa.fariqhfebrian18.workers.dev/api/auth/google/callback
```

**Yang harus Anda lakukan** (hanya pemilik akun Google yang bisa):

1. console.cloud.google.com → **APIs & Services → Credentials** → klien OAuth jenis **Web application** yang `Client ID`-nya
   dipasang sebagai secret `GOOGLE_CLIENT_ID` di Worker.
2. Pada **Authorized redirect URIs** tambahkan alamat di atas persis (https, tanpa garis miring penutup, host yang sama).
   Bila situs juga dibuka lewat domain lain (domain sendiri), daftarkan alamat untuk domain itu juga: alamat dibentuk dari host
   permintaan.
3. Simpan; perubahan bisa butuh beberapa menit untuk berlaku. Bila layar persetujuan berstatus *Testing*, tambahkan akun
   Google Anda sebagai **test user** (kalau tidak, Google menolak dengan `access_denied`, yang di Lexa tampil sebagai
   pesan "ditolak" di halaman Akun).

**Yang diubah di Lexa** supaya hal ini tidak membingungkan lagi:

- Alamat dibentuk di satu tempat (`lib/google.ts`, `uriCallback`) dan dipakai di awal alur *dan* di pertukaran kode, sehingga
  keduanya tak mungkin berselisih.
- `GET /api/auth/status` memuat `redirect_uri` (null selama login belum tersedia), dan halaman **Akun** menampilkannya di bagian
  bantuan "Pengelola situs: Google menampilkan redirect_uri_mismatch?" lengkap dengan langkah dan tombol salin: yang
  didaftarkan adalah alamat yang *sedang dipakai*.
- Callback menangani `error` dari Google (`access_denied` → "ditolak", lainnya → galat Google; dulu jatuh ke pesan
  "parameter" yang menyesatkan), dan state sekali-pakai ikut dihapus.
- README dan [hubungkan-github-cloudflare.md](hubungkan-github-cloudflare.md#login-google-oauth) memuat langkah konsol dan tabel
  galat lazim.

**Verifikasi**: buka `/akun` → bagian bantuan menampilkan alamat yang sama dengan yang Anda daftarkan → "Masuk dengan Google"
kembali ke Lexa dalam keadaan masuk. **[?]** Alur OAuth sungguhan tidak bisa saya jalankan (butuh akun Google Anda); yang diuji
otomatis adalah pembentukan alamat, kesamaannya di awal alur dan pertukaran kode, pemetaan galat, dan tampilan bantuan.

## 4. Menu PDF dan fitur lanjutannya

### 4.1 Mengapa penampil sendiri

Peramban ponsel tidak menampilkan PDF di dalam halaman (iOS hanya halaman pertama; Chrome Android menawarkan unduhan), jadi
`<iframe>` atau `<embed>` tidak memenuhi "menu yang menampilkan PDF". Halaman digambar sendiri dengan **PDF.js** 6.3.289
(build legacy untuk WebView lama; Apache-2.0; disalin ke `public/vendor/pdfjs`, 2,3 MB, sha256 dijaga tes): digambar malas
(hanya yang dekat layar, selebihnya dilepas agar memori ponsel aman; diuji 60 halaman), lapisan teks untuk memilih dan menyalin,
perbesar/perkecil/pas lebar, loncat ke halaman, galat yang jelas dengan "Coba lagi". CSP tetap ketat (tanpa eval, tanpa
WebAssembly, tanpa gaya sebaris): PDF.js dipanggil dengan `useWasm: false`, ukuran dipasang lewat CSSOM, dan 2,3 MB itu hanya
diunduh saat tab dibuka (diuji). Rute `/api/dokumen/pdf` melayani `Range` (206), jadi halaman jauh tak perlu mengunduh seluruh
berkas.

### 4.2 Tiga alat untuk menilai ekstraksi (semua terpasang)

| Alat | Cara kerja | Yang dijawab |
|---|---|---|
| **Tab PDF** | naskah asli yang diarsipkan Lexa, di dalam halaman peraturan | "apa kata aslinya?" |
| **Lihat di PDF** (pada tiap pasal) | halaman tempat pasal dimulai dicari di *lapisan teks PDF* di peramban pembaca (baris yang hanya berisi "Pasal N"; Romawi, akhiran huruf, dan nol-OCR dirapikan seperti di data; kemunculan pertama dipertahankan sehingga penjelasan yang memakai ulang nomor tak menggeser) | "pasal ini ada di halaman berapa?" |
| **Periksa pasal** (baru) | memindai seluruh batang tubuh PDF, berhenti di judul "PENJELASAN"/"PASAL DEMI PASAL" (pola yang sama dengan pengurai di server), lalu membandingkan nomor pasal di PDF dengan yang tersimpan: **ada di PDF tak ada di Lexa** (kemungkinan terlewat ekstraksi; tiap nomor membuka halamannya) dan **ada di Lexa tak tampak di PDF** (nomor salah baca, atau judul tak berdiri sendiri di barisnya) | "bagian mana yang perlu saya periksa?" |

Batasnya: PDF hasil pindaian (tanpa lapisan teks) tetap terbaca tetapi tak bisa dipindai otomatis (dikatakan di aplikasi);
yang dibandingkan hanya **nomor** pasal, isi pasal tetap perlu dibaca; dan memindai seluruh batang tubuh mengunduh sebagian
besar berkas PDF, itu pun hanya saat tombolnya diketuk. Tab PDF tampil untuk semua peraturan; yang PDF-nya belum diarsipkan
(±78% pada 12 Okt 2026) mendapat penjelasan dan tautan ke naskah resmi.

### 4.3 Fitur lanjutan dan urutan pengerjaannya

Dinilai menurut manfaat bagi tujuan Anda (mengatasi ekstraksi yang belum akurat), biaya, dan risiko:

| # | Fitur | Manfaat | Biaya | Risiko / catatan |
|---|---|---|---|---|
| 1 | **Laporkan kekeliruan dengan konteks halaman**: dari tab PDF, "Laporkan" membawa uri, nomor pasal, halaman PDF, dan teks yang tampak; `POST /api/laporan` dan `GET /api/admin/laporan` sudah ada | tinggi | rendah | perlu tinjauan manual oleh Anda |
| 2 | **Berdampingan (layar lebar)**: teks pasal di kiri, halaman PDF-nya di kanan, gulir bersinkron; di ponsel sakelar dua tampilan | tinggi | sedang | tata letak dan sinkronisasi gulir |
| 3 | **Skrip verifikasi massal**: menjalankan perbandingan "Periksa pasal" atas seluruh PDF di R2 (Node + PDF.js legacy) dan melaporkan peraturan mana yang punya pasal terlewat, diurutkan menurut parahnya | tinggi | sedang | dijalankan Anda (butuh akses R2); hasilnya menentukan prioritas ekstraksi ulang |
| 4 | **Cari di dalam PDF** (kata, dengan sorotan) | sedang | rendah-sedang | |
| 5 | **Indeks halaman per pasal di server** (`articles.halaman`), diisi saat ekstraksi, sehingga "Lihat di PDF" seketika dan hasil pencarian bisa menautkan langsung ke halaman PDF (`&hal=`) | sedang-tinggi | sedang | butuh pengurai lapisan teks di server (butir 6) |
| 6 | **Pengurai kedua dari lapisan teks PDF** (mis. build tanpa-DOM PDF.js di Worker, atau di peramban saat memanen) dan membandingkannya dengan `toMarkdown`; pilih yang bermutu lebih baik atau gabungkan | tinggi | sedang-tinggi | batas CPU/memori Worker pada PDF besar **[?]**; lapisan teks juga memberi posisi, jadi judul pasal dikenali dari tata letaknya, bukan dari tebakan baris |
| 7 | **OCR untuk PDF pindaian** (vonis `tanpa_pasal` di `ekstraksi_log`): model visi Workers AI atau layanan OCR, per halaman | tinggi untuk naskah tahun 1940-an–1970-an | tinggi | biaya per halaman; ketelitian nomor pasal perlu diuji; jumlahnya baru diketahui sesudah panen |
| 8 | **PDF luring** (cache service worker untuk `/api/dokumen/pdf`, dengan Range yang rumit) | sedang (ponsel) | sedang | ukuran berkas |
| 9 | **Koreksi oleh komunitas** (usulan koreksi pengguna masuk, dimoderasi) | sedang | tinggi | integritas teks hukum: selalu tampilkan bahwa rujukan yang berlaku adalah naskah resmi; sebaiknya sesudah butir 1 berjalan |
| 10 | **Sorot wilayah pasal di halaman PDF** (dari posisi di lapisan teks) | sedang | sedang | |

Urutan yang saya sarankan: **1 → 2 → 3 → 6 + 5 → 7 → 9**. Butir 1 dan 3 tidak menyentuh pengurai dan langsung memberi data
tentang seberapa buruk ekstraksi sebenarnya, sehingga butir 6 dan 7 dikerjakan berdasarkan angka, bukan firasat.

## 5. Panen lanjutan dari BPK

### 5.1 Keadaan sebenarnya di produksi (12 Okt 2026)

| Jenis | Baris | Punya `bpk_id` | Tanpa pasal | Catatan |
|---|---:|---:|---:|---|
| PP | 5.011 | **3** | 3.502 | 3.261 tanpa alamat sumber sama sekali |
| UU | 1.950 | 1.361 | 158 | |
| Perppu | 170 | 5 | 17 | 138 beralamat BPK (umumnya tanpa `bpk_id`); BPK juga menyebut 170 **[P]** |
| Tap MPR | 41 | 2 | 39 | sekitar 25 ketetapan sebenarnya; sisanya duplikat |
| UUD | 5 | 0 | 5 | naskah asli + 4 perubahan |

Skrip panen yang lama hanya bisa memproses peraturan yang sudah punya alamat BPK, jadi hampir seluruh PP tak tersentuh. Itulah
alasan tahap penjelajahan.

### 5.2 Yang dibangun

**Skrip** `scripts/bpk-console-harvest.js` (dijalankan di konsol peramban pada peraturan.bpk.go.id; panduan lengkap dan opsi di
[pipeline-data.md](pipeline-data.md#panen-bpk-melengkapi-teks)):

1. **Penjelajahan**: jenis dalam cakupan dicari dari halaman `/Jenis`, daftarnya dijelajahi halaman demi halaman, tiap entri
   (alamat rincian, teks tautan, tautan PDF di kartu) dikirim ke `POST /api/impor/tautan`.
2. **Panen PDF**: PDF diunduh langsung dari tautan di kartu daftar (separuh permintaan), atau lewat halaman rincian yang
   sekaligus memperbarui judul resmi dan status; diunggah ke Lexa, yang mengekstraknya menjadi pasal.
3. Ketahanan: pengulangan untuk 429/502/503/504 (menghormati `Retry-After`), tantangan Cloudflare dikenali, token salah dan Lexa
   tak terjangkau (CORS) dilaporkan sejak awal sebelum menyentuh BPK, tombol **Berhenti** dan kotak status, `terus: true` untuk
   berputar sampai habis, mode `periksa` untuk menganalisis halaman BPK yang sebenarnya.

**Server** (`/api/impor/*`): `tautan`, `manifest` (digabung menurut sitasi), `tanpa-berkas`, `ekstrak-ulang`, `ringkasan`.
Beberapa keputusan yang dipaksa oleh data produksi:

- **Pencocokan menurut sitasi**, bukan teks nomor atau URI: "01" = "1", "perpu" = "perppu", dan Tap MPR "XVI/MPR/1998" =
  "XVI-MPR-1998" = "xvi-mpr-1998". Sebelumnya manifest dengan URI turunan yang berbeda dari yang tersimpan melanggar indeks unik
  `(jenis, nomor, tahun)` dan **menggagalkan seluruh kiriman** (batch D1 atomik). Itu galat nyata untuk Perppu (145 dari 170
  baris produksi berURI "perpu").
- **Tautan yang keliru berarti PDF yang keliru**, dan PDF yang keliru menimpa pasal yang benar. Karena itu hanya slug dan teks
  tautan yang dipakai mengenali sitasi; jenis tak pernah ditukar (BPK menamai Perppu 7/1964 "uu-no-7-tahun-1964"; bila slug dan
  teks berselisih, data Lexa yang memutuskan, dan bila dua-duanya ada hasilnya `ambigu`, tak ada yang ditulis).
- **PDF yang bukan naskah peraturannya tak menghasilkan pasal.** `ekstrak_pdf` membandingkan judul resmi di kepala naskah hasil
  konversi dengan peraturan yang dituju dan menolak (mencatat, tidak menyimpan pasal) hanya bila ada bukti yang jelas: judul
  resmi bentuk "… REPUBLIK INDONESIA NOMOR N TAHUN T" ditemukan dan bukan milik peraturan itu. Ini jaring terakhir terhadap
  tautan BPK yang keliru, yang tak terlihat tanpa memeriksa ±3.700 berkas satu per satu dan yang tak bisa saya uji pada situs
  BPK sungguhan. Tanpa judul seperti itu naskah diproses seperti biasa.
- Naskah lama yang di BPK tak berkas ditandai (`bpk_tanpa_berkas:<uri>` di `sync_state`, tanpa migrasi, dengan alasannya)
  supaya tak memenuhi urutan terdepan daftar kerja di tiap putaran; yang halamannya dikenali tetapi tombol unduhnya tak
  dikenali pemilih skrip ditandai dengan alasan berbeda, tak dihitung sebagai kegagalan sesi, dan dicetak sebagai peringatan.
- Halaman rincian tanpa `Status` tak lagi menjadikan peraturan "berlaku"; judul BPK tanpa pokok tak menimpa judul lama yang
  berpokok; metadata yang dikirim sambil memanen terikat ke satu peraturan (`lexa_uri`) dan ditolak bila sitasinya tak cocok.

### 5.3 Yang saya ketahui tentang situs BPK, dan dari mana

Dari hasil pencarian web **[P]** (situsnya sendiri tak terjangkau dari sini):

- Daftar per jenis: `https://peraturan.bpk.go.id/Search?jenis=10` (Peraturan Pemerintah, "4.991 peraturan"), `jenis=13`
  (Inpres), `jenis=40` (Permendagri), `jenis=245` (Peraturan MPR); halaman lain lewat parameter `page`
  (`/Home/Search?jenis=59&page=2`). Id jenis UU dan Perppu belum saya lihat; skrip membacanya dari halaman `/Jenis`
  ("Jenis Peraturan", memuat jumlah per jenis).
- Rincian: `/Details/<id>/<slug>` (juga `/Home/Details/…` dan huruf kecil `/details/…`; kadang tanpa slug), slug berbentuk
  `pp-no-72-tahun-2012`, `uu-no-15-tahun-2006`, `perppu-no-2-tahun-2022` dan `perpu-no-1-tahun-2017` (kedua ejaan), tetapi Tap MPR
  `tap-mpr-no-xvimpr1998` (garis miring dibuang) dan `tap-mpr-no-i` (tahun hanya di kolom), serta UUD 1945
  `/Details/101646/uud-no--` ("UUD 1945 dan Amandemen", satu dokumen untuk naskah asli dan keempat perubahan).
- Unduhan: `/Download/<id-berkas>/<nama>.pdf` (id berkas **berbeda** dari id dokumen; kadang `?embed=True`). Hasil pencarian
  menyebut kartu daftar memuat judul, tahun, LN/TLN, dan tautan PDF; sebagian naskah lama tanpa berkas.

**[?]** Susunan HTML sebenarnya (kartu, penomoran halaman, tabel metadata) tak saya ketahui; pemilih di skrip dibuat longgar
(tautan `/Details/<id>`, `rel=next` atau teks "Selanjutnya/›", tabel dua kolom) dan mode `periksa` mencetak apa yang ditemukannya.

### 5.4 Etika, izin, dan biaya

- Skrip mengikuti sesi **Anda** (yang sudah lolos tantangan) dan satu permintaan sekali dengan jeda ±3-6 detik; jangan
  dikecilkan. Ketentuan penggunaan dan `robots.txt` BPK **tidak dapat saya baca** dari sini **[?]**; situsnya menyatakan dokumen
  bersumber dari instansi terkait dan layanannya terbuka untuk publik. Untuk penggunaan jangka panjang, jalur terbaik tetap
  izin tertulis atau data dari BPK (opsi C di [analisis-kelayakan-lexa.md](analisis-kelayakan-lexa.md#23-sumber-data-peraturanbpkgoid-pusat-risiko)).
- **Waktu**: ±4-6 detik per PDF → ±3.700 peraturan memakan ±5-7 jam; bagi ke beberapa sesi (`terus: true`, tombol Berhenti).
  Tab harus terbuka dan terlihat.
- **Sumber daya Cloudflare**: PDF di R2 (mungkin beberapa GB); D1 menulis puluhan baris pasal per peraturan ditambah indeks FTS
  (paket gratis: 100.000 baris tulis per hari → bagi ke beberapa hari); Workers AI untuk konversi PDF, penyematan semua pasal, dan
  ringkasan tiap peraturan (kuota neuron harian; pesan antrean diulang otomatis). Pantau di `/status`.
- **PDF pindaian** akan menghasilkan `tanpa_pasal`; mereka menunggu OCR (butir 7 di atas).

## 6. Temuan kualitas data produksi

Ditemukan saat mencocokkan sitasi; **belum ada yang diubah** (perlu persetujuan Anda, [bagian 7](#7-yang-hanya-bisa-anda-lakukan)):

| Temuan | Data | Dampak | Usulan |
|---|---|---|---|
| Duplikat Tap MPR | 41 baris untuk ±25 ketetapan; XVI/MPR/1998 ada tiga baris (`XVI/MPR/1998` dari BPK dengan 17 pasal, `XVI-MPR-1998`, `xvi-mpr-1998`); ada baris `iv-mpr-1999` bertahun 2004; URI berbeda ejaan (`tap-mpr`, `tap_mpr`, `tapmpr`) | hasil ganda, panen mengunduh PDF yang sama dua-tiga kali | gabungkan ke satu baris per ketetapan; pindahkan relasi, koleksi, dan penanda ke baris yang dipertahankan |
| PP "01" dan "1" (2022) | dua baris | hasil ganda | gabungkan |
| PP `%5B29` | nomor `%5B29` (karakter "[" yang terkodekan) | tak bisa dicocokkan | perbaiki nomor |
| 6 baris PP berURI jenis lain (`permenkumham`, `permendagri`, `perpres`, `permen-atrbpn`, `perbagi`, `uu`) | salah jenis di katalog | ikut cakupan PP padahal bukan | periksa dan keluarkan |
| 3 baris Perppu berURI `uu` | Perppu 7/1964 ber-slug BPK `uu-no-7-tahun-1964` | pencocokan lintas jenis tak aman | dibiarkan; pencocok sengaja tak menukar jenis |
| Judul bersampah / tanpa pokok | 73 judul hanya rujukan; sebagian judul hasil salin PDF | pencarian judul lemah | diganti judul resmi BPK lewat panen (otomatis untuk yang dikunjungi) |
| `bpk_id` bertipe teks kosong | `bpk_id = ''` pada sebagian baris | tertangani di kode (`<> ''`) | tak perlu tindakan |

SQL pembersihan Tap MPR/PP tidak saya jalankan. Bila Anda setuju, saya siapkan skrip yang menampilkan lebih dulu (SELECT) apa
yang akan digabung, lalu menjalankannya dalam satu transaksi.

## 7. Yang hanya bisa Anda lakukan

1. **Daftarkan alamat pengalihan Google** ([bagian 3](#3-login-google-error-400-redirect_uri_mismatch)): tanpa ini login Google
   tetap menampilkan `redirect_uri_mismatch`.
2. **Pastikan deploy terbaru selesai** (Workers Builds mendeploy setiap dorongan ke `main`); `GET /api/impor/ringkasan` dengan
   header `x-admin-token` harus menjawab JSON, dan `/akun` menampilkan alamat pengalihan.
3. **Jalankan skrip panen** dari peramban Anda, bertahap: uji penjelajahan (`kering`), penjelajahan, uji PDF (`kering`),
   panen. Bila ada yang tak cocok, kirim hasil `window.LEXA_PANEN = { periksa: true }` di halaman daftar dan halaman rincian,
   dan tabel "contoh entri berstatus tidak_dikenali" yang dicetak konsol. Langkah dan opsinya di
   [pipeline-data.md](pipeline-data.md#cara-menjalankan).
4. **Putuskan pembersihan duplikat** ([bagian 6](#6-temuan-kualitas-data-produksi)).
5. **Periksa paket Cloudflare** yang Anda pakai (D1 baris tulis harian, kuota neuron Workers AI) sebelum panen besar
   ([bagian 5.4](#54-etika-izin-dan-biaya)), dan pertimbangkan izin tertulis dari BPK untuk jangka panjang.
6. **Hapus cabang lama `claude/zealous-brown-63ek65`** di GitHub (gateway git dari sandbox menolak penghapusan cabang, HTTP 403).
7. **Coba pencarian** `kelautan`, `perikanan`, `uu perikanan`, `ketenagakerjaan` di produksi, dan kirim kata kunci yang masih
   keliru.

## 8. Peta jalan

| Prioritas | Pekerjaan | Mengapa |
|---|---|---|
| Sekarang | daftarkan alamat Google; jalankan panen bertahap; kirim hasil `periksa` bila perlu | membuka teks ±3.700 peraturan dan login |
| Berikutnya | laporkan kekeliruan dengan konteks halaman (butir 1); skrip verifikasi massal (butir 3) | mengukur seberapa buruk ekstraksi sebenarnya |
| Berikutnya | pembersihan duplikat Tap MPR/PP; pemenggalan imbuhan ringan untuk tingkat judul | data bersih; "kelautan" menemukan "laut" |
| Lalu | tampilan berdampingan (butir 2); cari di dalam PDF (butir 4) | verifikasi lebih cepat |
| Lalu | pengurai kedua dari lapisan teks + indeks halaman per pasal (butir 6 dan 5) | ekstraksi lebih akurat dan "Lihat di PDF" seketika |
| Setelah panen | OCR untuk naskah pindaian (butir 7), PDF luring (butir 8), koreksi komunitas (butir 9) | menutup sisa yang tak terbaca mesin |

## 9. Pengujian

- **Unit dan integrasi**: 1.239 tes (harness SQLite sungguhan + tiruan KV/R2/Queue/AI/Vectorize), termasuk pengenalan sitasi BPK
  (slug dan teks nyata dari hasil pencarian), pencocokan tahan penulisan ganda, manifest yang tak lagi menjatuhkan seluruh kiriman,
  penanda tanpa berkas, ekstrak ulang, dan perbandingan pasal PDF.
- **e2e di Chromium**: 202 tes, termasuk skrip panen terhadap situs BPK palsu (24 skenario: jenis dari `/Jenis`, halaman
  berikutnya, tautan langsung dari daftar, tanpa berkas, tantangan, 503/403, token salah, tombol berhenti, `periksa`) dan penampil
  PDF dengan PDF.js asli (23 skenario, termasuk "Periksa pasal" di 360 px).
- Uji **mutasi** pada tiap perilaku kunci (kode sengaja dirusak, ujinya harus gagal) untuk memastikan tesnya bermakna.
- **Tidak teruji**: situs BPK sungguhan, alur OAuth Google sungguhan, perangkat Android/iOS sungguhan.
