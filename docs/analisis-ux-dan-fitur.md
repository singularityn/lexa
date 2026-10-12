# Analisis lanjutan: UI/UX dan fitur Lexa

Dokumen ini melanjutkan [analisis-kelayakan-lexa.md](analisis-kelayakan-lexa.md) setelah situs berjalan di
Cloudflare. Pemicunya: situs sudah hidup, tetapi tampilannya dinilai buruk, fiturnya masih kurang, dan
aplikasi harus nyaman di ponsel serta bisa ditambahkan ke layar utama.

Isi: [ringkasan](#1-ringkasan) · [cara menilai](#2-cara-menilai) · [temuan dan tindakan](#3-temuan-dan-tindakan) ·
[fitur baru](#4-fitur-baru-dan-cara-memakainya) · [kualitas data](#5-kualitas-data-yang-memengaruhi-pengalaman) ·
[peta jalan](#6-peta-jalan) · [Claude Design](#7-memakai-claude-design) ·
[ke layar utama](#8-menambahkan-ke-layar-utama-dan-memeriksanya-di-perangkat-asli) ·
[yang perlu keputusan Anda](#9-yang-perlu-keputusan-atau-tindakan-anda) · [pengujian](#10-pengujian) ·
[desain Claude Design diterapkan](#11-desain-claude-design-diterapkan-oktober-2026)

## 1. Ringkasan

- **Penyebab utama kesan "buruk"** bukan satu bug, melainkan tiga hal yang bertumpuk: (1) tata letak dirancang untuk
  layar lebar lalu dikecilkan, (2) data hasil ekstraksi PDF tampil apa adanya (judul huruf besar semua, teks
  patah di tengah kalimat, penjelasan bercampur dengan pasal, "390 pasal" untuk undang-undang yang pasalnya 193),
  dan (3) hampir tidak ada fitur membaca yang diharapkan pembaca peraturan: daftar isi, lompat ke pasal,
  rujukan yang bisa diklik, ukuran huruf, melanjutkan bacaan.
- **Yang sudah diubah** (semua di cabang `main`, terpasang otomatis lewat Workers Builds):
  kerangka ponsel dengan bilah navigasi bawah; beranda, hasil pencarian, filter, dan Tanya Lexa yang dirancang
  ulang mulai dari layar 390 px; halaman peraturan yang baru (header ringkas, daftar isi, lembar aksi, tampilan
  teks, penjelasan terpisah, rujukan antarpasal yang bisa diklik); PWA yang bisa dipasang dan terbaca luring;
  pratinjau tautan saat peraturan dibagikan; perbaikan relevansi pencarian dan kebersihan data.
- **Yang tidak bisa saya lakukan dari sini**: membuka situs produksi (jaringan sandbox dibatasi) dan menguji di
  perangkat Android/iPhone sungguhan. Semuanya diuji di Chromium dengan emulasi sentuh, salinan data produksi, dan
  uji otomatis. Daftar periksa untuk perangkat asli ada di [bagian 8](#8-menambahkan-ke-layar-utama-dan-memeriksanya-di-perangkat-asli).
- **Claude Design bisa dipakai**, sebagai alat merancang tampilan (mockup), bukan sebagai pengganti kode. Alurnya
  di [bagian 7](#7-memakai-claude-design).
- **Cakupan peraturan dibatasi** atas keputusan pemilik: UUD (dan setara: Tap MPR), undang-undang termasuk Perppu,
  dan peraturan pemerintah saja, supaya beban aplikasi tidak berat. Peraturan lain (Perpres, Permen, POJK, Perda, ...)
  tidak lagi disinkronkan, diimpor, dicari, atau ditampilkan; yang sudah tersimpan (2.131 dari 5.673 pada 4 Okt 2026)
  hanya disembunyikan. Rinciannya di [README](../README.md#cakupan-peraturan); angka-angka di bawah yang
  menyebut 5.634 peraturan adalah pengukuran 3 Okt 2026 sebelum pembatasan.

## 2. Cara menilai

1. Contoh baris produksi (181 dari 5.634 peraturan, dengan 1.126 baris pasal dan 513 relasi) dimuat ke pratinjau
   lokal (`LEXA_DATA_NYATA=.dev/data-nyata.json npm run dev:node`; berkas itu sengaja tidak masuk Git). Teks pasal
   hanya disertakan untuk empat peraturan (UU 13/2003, 7/2014, 8/1999, 11/2008) agar berkasnya kecil, jadi di
   situlah kualitas baca diukur. Untuk melihat variasi data yang sebenarnya, dua kali 120-an peraturan acak dari
   produksi (UU, PP, Perpres, POJK, Permen, Perppu; total 249 peraturan dan 6.551 baris pasal) disapu lewat penyusun
   teks halaman baca dengan kueri baca-saja ke D1, dan semua judul produksi (5.634) diperiksa lewat pengurai judul
   dan sitasi. Hasilnya: tidak ada galat, tidak ada penanda halaman tersisa, setiap peraturan diproses di bawah
   250 ms, dan tiap judul menghasilkan topik. Temuannya menjadi tiga perbaikan (nomor pasal OCR, tautan rujukan di
   peraturan perubahan, judul yang menempel pada kepala halaman) dan catatan di bagian 5.
2. Tiap layar diambil gambarnya di 390×844 (ponsel, sentuh), 1024×768 (tablet), dan 1280×900 (desktop), terang dan
   gelap, lalu dinilai satu per satu. Setiap perbaikan diverifikasi ulang dengan gambar, bukan hanya dengan tes.
3. Perilaku dijaga tes: unit (`npm test`), e2e Chromium (`npm run e2e`) termasuk emulasi sentuh dan jaringan yang
   diputus untuk service worker, serta axe-core (aksesibilitas) pada halaman dan semua lembar, tema terang dan gelap.
   Tiap perilaku utama diperiksa dengan mutasi: kode sengaja dirusak untuk memastikan tesnya benar-benar gagal.
4. Perilaku di runtime Cloudflare diperiksa dengan `wrangler dev --local` (workerd) untuk perubahan yang menyentuh
   Worker; perubahan antarmuka murni tidak menyentuhnya.

## 3. Temuan dan tindakan

| Area | Temuan | Tindakan |
|---|---|---|
| Kerangka ponsel | Menu hamburger, header tinggi, tidak ada area aman (takik dan bilah gestur menimpa konten), sasaran ketuk kecil, bilah tetap tampil saat papan ketik terbuka | Bilah navigasi bawah 5 tab (Cari, Telusuri, Tanya, Koleksi, Masuk) yang menyingkir saat mengetik; header satu baris; `viewport-fit=cover` dan `env(safe-area-inset-*)`; sasaran ketuk 44 px; `dvh` alih-alih `vh`; pita luring |
| Beranda | Empat kartu statistik di paling atas tidak berguna bagi pembaca; kotak cari kecil dan placeholder terpotong | Hero ringkas, kotak cari 56 px, chip contoh yang digulir menyamping, kartu ajakan ke Tanya Lexa, "Terakhir dilihat" (membuka langsung di pasal terakhir dibaca) dan "Terakhir dicari" |
| Kartu hasil | Judul UPPERCASE panjang, lencana jenis dan chip "kata kunci/makna" yang hanya bermakna bagi mesin, "N pasal" yang sebenarnya jumlah baris | Judul hanya topik dengan huruf dirapikan, sitasi sebagai penanda utama, status "Berlaku" menjadi titik hijau di ponsel, seluruh kartu bisa diketuk, cuplikan yang mengulang judul disembunyikan |
| Filter | Panel samping memakan layar ponsel | Lembar modal dari bawah (`<dialog>`, fokus terperangkap, Esc menutup), filter aktif tampil sebagai chip yang bisa dilepas satu per satu |
| Tanya Lexa | Kotak tulis tidak menempel; mengetuk tombol kirim di ponsel kehilangan ketukan karena fokus lepas dan bilah bawah muncul lagi | Tata letak obrolan (kotak tulis menempel di atas bilah bawah, contoh pertanyaan di atasnya); fokus dijaga saat tombol kirim ditekan |
| Halaman peraturan | Header memakan lebih dari satu layar ponsel; enam tombol aksi; tab tidak menempel; teks tanpa tipografi; tidak ada daftar isi | Header ringkas (tab dan awal teks terlihat tanpa menggulir di 390×844); tiga aksi utama, sisanya di lembar "Lainnya"; tab menempel di bawah header; daftar isi; teks berhuruf berkaki dengan panjang baris dibatasi 72ch |
| Teks hasil ekstraksi PDF | Baris patah di tengah kalimat, kepala halaman ("PRESIDEN REPUBLIK INDONESIA- 18 -") dan "### Page 80" ikut tampil, daftar butir menyatu menjadi satu paragraf | Penyusunan ulang teks (`bacaIsiPasal`): butir 1./a. dengan indentasi menggantung, baris yang dipatahkan lebar kolom disambung, artefak halaman dibuang (judul yang menempel pada kepala halaman, mis. "…- 5 -Pasal 7", tetap berawal di baris baru, tidak tersambung ke "Cukup jelas" sebelumnya) |
| Nomor pasal salah baca OCR | Angka nol terbaca huruf O: "Pasal 1O" untuk 10, "12O" untuk 120 (154 baris di 42 peraturan produksi, termasuk KUHP, Cipta Kerja, Pelindungan Data Pribadi); daftar isi, "Lompat ke pasal", dan tautan rujukan tidak menemukannya | Nomor dirapikan saat dibaca di API (detail, hasil pencarian, Tanya Lexa) dan di antarmuka (termasuk jawaban lama yang tersimpan di perangkat); parser ingest memperbaikinya sejak awal. Data di D1 tidak diubah |
| Penjelasan | UU 13/2003 menampilkan "390 pasal": penjelasan pasal demi pasal memakai ulang nomor pasal, dan penjelasan umum menempel di Pasal 193 (8.630 karakter) | Penjelasan dikenali (penjelasan umum yang terbawa, penomoran yang kembali ke awal, atau id berakhiran ~n), diberi judul sendiri, dihitung terpisah, dan punya kelompok sendiri di daftar isi: "193 pasal dan penjelasannya" |
| Daftar isi | Tidak ada | Lembar dari bawah (kolom lengket di samping teks di layar ≥1100 px): BAB dengan rentang pasalnya, "Lompat ke pasal" ("156", "Pasal 5A"), tombol mengambang |
| Pencarian | "pesangon" menempatkan Perpres 22/2015 di atas UU 13/2003 Pasal 156 karena sinonim muncul di judulnya; "perlindungan data pribadi" tidak menemukan UU "Pelindungan Data Pribadi"; kalimat ("berapa lama cuti melahirkan…") tidak menemukan apa-apa | Kata yang diketik dicari lebih dulu daripada sinonim, ejaan lain dianggap kata yang sama, cadangan longgar untuk kueri ≥3 kata yang dinyatakan terus terang di atas hasil. Catatan lanjutan (12 Oktober 2026): "kelautan" menempatkan UU 32/2014 tentang Kelautan di bawah pasal-pasal dan PP tarif PNBP; kini peraturan yang **judulnya** memuat kata kunci tampil di atas semua pasal, diurutkan menurut seberapa besar bagian judul yang dibicarakan kata itu (`src/worker/lib/judul.ts`) |
| Data | 72,8% kolom `instansi` di produksi berisi "[object Object]" | Dirapikan saat dibaca; perbaikan permanen perlu persetujuan Anda ([bagian 9](#9-yang-perlu-keputusan-atau-tindakan-anda)) |
| Aksesibilitas | Batas kolom isian dan kontrol segmen hanya 1,5–1,8:1 terhadap latar (di bawah 3:1 menurut WCAG 1.4.11); cincin fokus tembus pandang 45–50% | Token `garis-kontrol` (3,2:1 atau lebih di kedua tema) untuk batas kolom isian dan kontrol pilihan, cincin fokus 80% (≥3:1); axe-core tanpa pelanggaran serius/kritis pada semua halaman utama dan semua lembar, terang dan gelap; fokus kembali ke pemicu saat lembar ditutup; tautan di dalam teks dibedakan dengan garis titik-titik, bukan warna saja. Kontras token dijaga `test/tokens.test.ts` |

## 4. Fitur baru dan cara memakainya

| Fitur | Di mana | Catatan |
|---|---|---|
| Pasang ke layar utama | Spanduk "Pasang Lexa", halaman Akun | Android: tombol Pasang; iOS: Bagikan > Tambahkan ke Layar Utama (panduan tampil di aplikasi) |
| Baca luring otomatis | Otomatis | Peraturan yang pernah dibuka tetap terbaca tanpa jaringan (80 jawaban terakhir) |
| **Simpan untuk dibaca luring** | Lembar "Lainnya" di peraturan; daftar di Akun | Tidak ikut terbuang oleh batas di atas, diperbarui otomatis saat daring, maksimal 30 peraturan, dengan ukurannya |
| Daftar isi dan lompat ke pasal | Tombol "Daftar isi" di peraturan | Kolom di samping teks di layar lebar |
| Rujukan antarpasal | Di dalam teks pasal | "Pasal 156 ayat (2)" membuka pasalnya; pasal milik peraturan lain tidak ditautkan. Tidak dibuat pada peraturan perubahan ("tentang Perubahan Atas …"): "Pasal 41" di sana menunjuk pasal peraturan yang diubah, bukan pasal bernomor sama di peraturan itu sendiri |
| Lanjutkan membaca | Peraturan dan beranda | Posisi disimpan di perangkat ini saja |
| Tandai pasal | Ikon penanda di judul tiap pasal | Disimpan ke Koleksi (tamu: di perangkat; masuk: tersinkron), lengkap dengan catatan |
| Tampilan teks | Tombol "Tampilan teks" | Lima ukuran huruf, berkaki atau tanpa kaki |
| Bagikan | Lembar "Lainnya" dan lembar tiap pasal | Memakai lembar bagikan perangkat (WhatsApp, Telegram, dll.) dengan sitasi dan tautan |
| Cetak atau simpan PDF | Lembar "Lainnya" | Hanya judul, status, dan seluruh teks; tanpa navigasi |
| Riwayat | Beranda; dihapus dari Akun | Hanya di perangkat, tidak dikirim ke server |
| **Pratinjau tautan** | Saat tautan peraturan dibagikan ke WhatsApp, Telegram, dll. | Judul ("UU 13/2003 Ketenagakerjaan"), deskripsi (ringkasan; peraturan dicabut/diubah diawali statusnya), dan gambar merek tampil, bukan sekadar "Lexa". Disuntikkan Worker ke cangkang SPA hanya untuk perayap dan aplikasi pesan (pembaca biasa tidak menunggu pencarian D1); bila gagal, cangkang biasa |

## 5. Kualitas data yang memengaruhi pengalaman

- **Cakupan teks sudah luas.** Pada 3 Okt 2026, produksi memuat 5.634 peraturan (4.358 berlaku, 1.042 dicabut, 234
  diubah) dan 71.481 baris pasal. 5.451 peraturan (97%) punya teks pasal; 183 hanya metadata, sehingga halaman
  bacanya menampilkan "Teks pasal belum tersedia" dengan tautan ke naskah resmi. Yang menurunkan mutu baca bukan
  ketiadaan teks, melainkan sisa ekstraksi lama (butir berikutnya). Sesudah cakupan dibatasi (4 Okt 2026), yang
  disajikan 3.542 peraturan (UU 1.950, PP 1.422, Perppu 168, Tap MPR 2) dengan 56.170 baris pasal; 3.420 punya teks
  pasal dan 122 hanya metadata.
- **Teks yang ada berasal dari ekstraksi PDF yang memuat penanda halaman dan penjelasan.** Di produksi, 401
  peraturan punya baris pasal ber-id `~n` (4.815 baris, umumnya Penjelasan yang memakai ulang nomor pasal) dan 289
  memuat teks "PENJELASAN" di dalam baris pasalnya. Parser sekarang berhenti di "PENJELASAN"/"PASAL DEMI PASAL"
  dan tidak lagi memecah pasal di rujukan silang seperti "Pasal 9; dan/atau", jadi peraturan yang diingest ulang
  akan lebih bersih. Antarmuka tetap menangani data yang sudah ada (penjelasan, nomor kembar) saat dibaca.
- **PDF hasil pindai** (mis. KUHP, UU 1/2023; UU 2/2022) diekstrak dengan salah baca OCR: kata menempel ("sesuaidengan"),
  nomor pasal bergeser atau hilang. Dari 1.577 ekstraksi PDF produksi, 1.103 bersih, 146 rusak ringan, 7 rusak
  berat, dan 320 tidak menemukan pasal sama sekali (kemungkinan besar pindaian). Hanya ekstraksi ulang dengan
  sumber yang lebih baik yang memperbaikinya; antarmuka tidak bisa menebak kata yang hilang.
- **`instansi` rusak** di sebagian besar baris produksi (lihat bagian 9).
- **Tanya Lexa** memberi label "Pasal N" juga pada kutipan yang sebenarnya penjelasan (data lama). Dampaknya
  kecil karena jawabannya wajib menyebut sumber, tetapi akan hilang sendiri setelah peraturan diingest ulang tanpa penjelasan.

## 6. Peta jalan

Urutan berdasarkan dampak bagi pembaca dibanding usaha. Belum dikerjakan kecuali disebut lain.

**P1: berikutnya**
1. **Ekstrak ulang peraturan lama dengan parser saat ini** (terutama ~400 peraturan yang Penjelasannya tercampur
   dengan pasal), dan lengkapi 122 peraturan dalam cakupan yang belum punya teks pasal. Sinkronisasi Cron harian
   berhenti di tengah jalan karena batas laju pasal.id pada PERPRES (254 sampai 369 peraturan diantrekan per hari);
   sesudah cakupan dibatasi Cron tak lagi menyapu PERPRES, sehingga jatah lajunya dipakai UU, Perppu, dan PP.
2. **Sorot dan catatan pada kalimat**, bukan hanya pada pasal.
3. **Pratinjau tautan yang lebih kaya**: gambar per peraturan (sitasi dan topik di dalam gambar), dan pratinjau
   untuk hasil pencarian. Pratinjau dasar per peraturan sudah ada (bagian 4).

**P2**
4. Bandingkan versi (sebelum/sesudah perubahan) untuk peraturan yang diubah; butuh data versi per pasal.
5. Peringatan saat peraturan di koleksi dicabut atau diubah (butuh pemeriksaan berkala).
6. Pencarian di dalam peraturan dengan lompat antarkemunculan.
7. Penyimpanan luring otomatis untuk isi Koleksi (dengan batas ukuran).

**P3**
8. Notifikasi push (Android dan iOS 16.4+ untuk aplikasi yang dipasang).
9. Mode baca fokus (header menyingkir saat menggulir).
10. Ekspor koleksi ke format sitasi (BibTeX, RIS).

## 7. Memakai Claude Design

**Bisa**, dengan pembagian tugas yang jelas:

- Claude Design (kanvas desain di claude.ai) cocok untuk **merancang tampilan**: layar beranda, hasil, halaman
  baca, variasi tema, tata letak tablet. Hasilnya mockup dan prototipe, bukan kode yang langsung dipakai.
- Lexa tidak punya langkah build dan memakai CSP ketat (tanpa gaya atau skrip sebaris), jadi desain tidak bisa
  "dilepas" begitu saja ke situs. Desain diterjemahkan ke `public/css/app.css` (token warna, tipografi, jarak) dan modul
  di `public/js/`. Itu bagian yang saya kerjakan: Anda memberi arah dan gambar, saya memasangkannya, menjalankan tes,
  dan memeriksa hasilnya.
- Titik awal yang praktis adalah **Design System**, supaya layar yang dihasilkan Claude Design konsisten dengan
  yang sudah ada. **Design System Lexa sudah dibuat**: <https://claude.ai/artifact/WFTDkg5SPJLMVKaKQvV32R>.
  Sifatnya **pribadi**: hanya akun Anda yang bisa membukanya, dan saya tidak bisa membagikannya (pakai menu
  Share di halamannya bila ingin berbagi dengan orang lain). Isinya:
  - **Token** dibaca langsung dari `public/css/app.css`, bukan diketik ulang: 23 warna (terang dan gelap, tiap
    catatan menyebut permukaan tempat teksnya terbaca dan kontras minimalnya), 14 gaya huruf, 9 langkah jarak, 6
    radius, bayangan, dan ukuran tata letak (lebar konten, tinggi bilah bawah, sasaran ketuk 44 px).
  - **Buku merek** (README): bahasa dan nada, warna, tipografi, jarak dan bentuk, aturan "ponsel dulu",
    aksesibilitas, ikon, dan hal yang dihindari.
  - **Tujuh komponen** dengan pratinjau dan panduan: Tombol, Lencana status, Kotak cari, Kartu hasil, Lembar aksi,
    Bilah navigasi bawah, dan Teks pasal; ditambah sampul.
  - **Aset**: tanda Lexa (`lexa-mark.svg`) dan 31 ikon garis (`ikon.json`), diambil dari kode.
  - Pratinjau komponen adalah **rendisi statis** (HTML dan kelas CSS yang sama dengan aplikasi), bukan komponen
    React hidup, karena Lexa tidak memakai kerangka komponen. Halaman penuh (beranda, halaman peraturan, Tanya Lexa)
    belum ada sebagai komponen sendiri.

Alur yang disarankan:
1. Di Claude Design, mulai desain baru dengan design system **Lexa**, lalu minta layar yang ingin diubah (mis.
   "halaman baca peraturan di ponsel dengan daftar isi mengambang").
2. Bandingkan dengan tangkapan layar situs sekarang; pilih yang disukai dan beri catatan.
3. Kirim hasilnya (tautan atau gambar) ke sini. Saya terjemahkan ke CSS/JS, uji di 390×844 dan 1280×900 terang dan
   gelap, dan terapkan ke `main`.

Batas: Design System tidak otomatis mengikuti kode. Setelah `app.css` atau ikon berubah, minta saya
menyinkronkan ulang ("perbarui Design System Lexa dari repositori"); token, ikon, dan pratinjau dibangun ulang dari
kode, sedangkan catatan yang Anda tulis sendiri di halamannya dipertahankan.

## 8. Menambahkan ke layar utama dan memeriksanya di perangkat asli

**Android (Chrome):** buka situs, ketuk **Pasang** di spanduk atau menu ⋮ > **Pasang aplikasi**. Ikon Lexa muncul di
layar utama dan membuka aplikasi tanpa bilah alamat.

**iPhone/iPad (Safari):** buka situs di **Safari** (bukan di dalam aplikasi lain), ketuk **Bagikan** > **Tambahkan ke
Layar Utama**. iOS tidak punya tombol Pasang; panduannya ditampilkan di aplikasi. Aplikasi yang dibuka dari layar
utama menyimpan data sendiri, dan Lexa menyediakan tombol kembali karena iOS tidak punya.

Daftar periksa (belum bisa saya jalankan di perangkat asli):
1. Pasang, lalu buka dari ikon: tanpa bilah alamat; warna bilah status mengikuti tema aplikasi.
2. Bilah navigasi bawah tidak tertutup bilah gestur; berputar ke lanskap tetap rapi.
3. Matikan data dan Wi-Fi: Beranda tampil, peraturan yang pernah dibuka terbaca, pita "Luring" muncul.
4. "Simpan untuk dibaca luring" pada satu peraturan, mode pesawat, peraturan itu tetap terbaca.
5. Bagikan satu peraturan ke WhatsApp: sitasi dan tautan terisi.
6. Perbesar ukuran huruf sistem: tidak ada teks terpotong.
7. Tema gelap: kontras teks pasal dan tautan rujukan.
8. Perbarui: setelah rilis baru, muncul tawaran "Muat ulang" (bukan paksaan).

## 9. Yang perlu keputusan atau tindakan Anda

1. **Hapus cabang lama `claude/zealous-brown-63ek65`** di GitHub (Branches). Penghapusan dari sini ditolak (HTTP 403).
2. **Perbaikan `instansi` di produksi** (mengubah data, jadi menunggu persetujuan):
   ```sql
   -- periksa dulu (hanya membaca)
   SELECT COUNT(*) AS rusak FROM laws WHERE instansi LIKE '%[object Object]%';
   -- perbaikan: nilai aslinya sudah hilang, kosongkan; terisi lagi saat peraturan diingest ulang
   UPDATE laws SET instansi = NULL WHERE instansi LIKE '%[object Object]%';
   ```
   Tampilan sudah menganggap nilai itu kosong, jadi perbaikan ini tidak mengubah apa yang dilihat pembaca.
3. **Kursor Cron** melampaui isi basis data (`offset:PP` = 4400 sedangkan 1.422 PP tersimpan; lihat
   [hubungkan-github-cloudflare.md](hubungkan-github-cloudflare.md)). Sesudah cakupan dibatasi, PP bergerak sendiri
   setiap hari, jadi pengaturan ulang hanya mempercepat dan opsional (`UPDATE sync_state SET value = '0' WHERE key IN
   ('offset:UU','offset:PERPPU','offset:PP');`). Perhatikan bebannya: itu berarti ±3.000 PP tambahan yang masuk
   cakupan (peraturan, pasal, vektor, dan ringkasan AI).
3a. **Data di luar cakupan** (2.131 peraturan, ±15.500 baris pasal): disembunyikan, belum dihapus. Menghapusnya
   mengecilkan D1 dan FTS5 tetapi tidak bisa dibatalkan kecuali lewat Time Travel D1, dan melebarkan cakupan
   kelak berarti menarik ulang. Langkah dan peringatannya ada di
   [hubungkan-github-cloudflare.md](hubungkan-github-cloudflare.md#cakupan-peraturan); tidak dijalankan tanpa persetujuan Anda.
4. **Matikan Preview Builds** di Workers Builds bila belum: tanpa blok `previews` di `wrangler.jsonc` build pratinjau tidak didukung.
5. **Periksa di perangkat asli** memakai daftar di bagian 8 dan laporkan yang janggal.
6. **Coba pratinjau tautan**: bagikan satu tautan peraturan (mis. UU 13/2003) ke diri sendiri di WhatsApp atau
   Telegram. Judul dan gambar seharusnya tampil. Tautan yang pernah dikirim sebelum rilis ini bisa tetap
   tampil lama karena aplikasi pesan menyimpan pratinjaunya; pakai tautan yang belum pernah dikirim.

## 10. Pengujian

```bash
npm run check        # tipe + semua tes unit dan integrasi
npm run e2e          # Chromium: antarmuka, PWA/luring, halaman baca (butuh Chromium)
npm run sw           # WAJIB setelah mengubah berkas di public/ (daftar precache service worker)
LEXA_DATA_NYATA=.dev/data-nyata.json npm run dev:node   # pratinjau dengan salinan data produksi
node scripts/buat-og.mjs   # buat ulang gambar pratinjau tautan (public/og/lexa.png), hanya bila merek berubah
```

`e2e/baca.test.mjs` menguji halaman peraturan (ponsel sentuh dan layar lebar, axe di semua lembar),
`e2e/pwa.test.mjs` menguji pemasangan, luring, dan simpanan luring dengan service worker sungguhan, dan
`e2e/ui.test.mjs` menguji halaman lain (termasuk pratinjau tautan dengan JavaScript dimatikan, seperti perayap).
`test/integration/pratinjau.test.ts` menguji penyuntikan di Worker asli (pelolosan HTML, jatuh ke cangkang biasa).
Tes unit utama: `test/web.test.ts` (fungsi murni antarmuka),
`test/pwa.test.ts` (service worker dengan Cache API tiruan), `test/tokens.test.ts` (kontras warna token di kedua
tema), dan `test/browser/*.test.ts`.

## 11. Desain Claude Design diterapkan (Oktober 2026)

Pemilik menjalankan redesain di Claude Design (paket `Redesign UI aplikasi Lexa`, tidak bisa di-push langsung ke GitHub),
lalu paketnya diterjemahkan ke `public/` seperti alur di bagian 7. Yang diterapkan:

- **Token dan tipografi**: palet krem dan tinta (terang dan gelap) di `public/css/app.css`; Plus Jakarta Sans (400, 500,
  600, 700) untuk antarmuka dan Newsreader (400, 400 miring, 600) untuk naskah dan merek, dilayani dari `public/fonts/`
  (latin saja, 128 KB) sehingga CSP `font-src 'self'` tak berubah dan tak ada permintaan ke pihak ketiga.
- **Bentuk**: kapsul navigasi mengambang di dasar layar ponsel (tepi bawah 14 px di atas dasar, ditambah area aman) dengan
  sasaran ketuk 44 px, dan bilah samping pada layar ≥861 px; kartu pastel per jenis (UUD, Tap MPR, UU, Perppu, PP) lewat
  `komponen/jenis.js`, papan beranda (`papanJenis.js`), progres baca (`progresBaca.js`), dan jejak yang baru dilihat
  (`sisiDilihat.js`).
- **Tanpa logo**: atas permintaan pemilik merek hanya teks "Lexa" (Newsreader 600) di bilah atas, bilah samping, dan layar
  muat. Favicon (`favicon.svg`), ikon aplikasi (192, 512, maskable, apple-touch), dan gambar pratinjau tautan
  (`og/lexa.png`) dibuat ulang bertipografi serupa oleh `scripts/buat-ikon.mjs` dan `scripts/buat-og.mjs`.
- **Penyesuaian saat menerapkan**: aturan cetak untuk `main.bungkus`, `min-width: 44px` pada tautan bilah bawah di
  layar sempit (target ketuk), `theme-color` mengikuti palet baru, dan pramuat Newsreader 600 agar merek tak berkedip.
  Tes e2e disesuaikan (warna tema `#f4ecda`/`#14130f`, kapsul navigasi) dan axe-core tetap bersih di tema terang dan gelap.
- **Tambahan setelahnya**: panel "Kelengkapan isi" di `/status` (per jenis: di sumber, tersimpan, berisi pasal, menunggu,
  tanpa isi, gagal; kendala pasal.id yang berlaku), dan keadaan kosong halaman baca yang lebih jelas (judul, nomor, dan
  status sudah tercatat tetapi pasal belum diambil; tautan ke naskah di sumber).

Design System Lexa (bagian 7) dibangun dari kode lama dan belum disinkronkan ulang; minta "perbarui Design System Lexa dari
repositori" bila ingin tokennya mengikuti palet baru.

