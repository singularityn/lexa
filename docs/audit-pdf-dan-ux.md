# Audit menyeluruh Lexa dan rencana perbaikannya (25 Oktober 2026)

Permintaan pemilik: analisis ulang seluruh aplikasi, perbaiki fitur, UI/UX, dan mekanisme indeks peraturan dan pasal; kurangi teks
yang tak perlu; rapikan alur tombol dan menu; dan yang terpenting, **melihat peraturan dalam PDF** harus menjadi fitur utama.

## 1. Keadaan data di produksi (D1, 25 Oktober 2026)

| Jenis | Peraturan | Ber-PDF di R2 | Berisi pasal | Baris pasal |
|---|---:|---:|---:|---:|
| PP | 5.011 | 1.028 | 2.361 | 36.656 |
| UU | 1.950 | 1.604 | 1.880 | 66.814 |
| Perppu | 170 | 8 | 155 | 825 |
| Tap MPR | 41 | 2 | 2 | 31 |
| UUD | 5 | 0 | 0 | 0 |
| **Jumlah** | **7.177** | **2.642 (37%)** | ±4.400 | ±104.000 |

* Tidak ada panen baru sejak 14 Oktober (pekerjaan terakhir `pemeliharaan`, 19:14 UTC): jumlah PDF sama dengan sebelumnya.
* Vonis ekstraksi dari 2.642 PDF: 2.232 bersih, 131 ringan, 35 berat, 216 tanpa pasal, 16 gagal, 12 tanpa catatan. Semuanya masih
  berversi pengurai 3: pengukur versi 4 (pasal hilang, pembukaan tertelan) belum pernah dijalankan (`usang`).
* Gemini baru membaca satu peraturan (uji kering). Mode otomatis belum menyala (`GEMINI_OTOMATIS` belum diisi).
* 35.148 baris Penjelasan, 1.281 relasi, 2.816 ringkasan AI, 4.655 peraturan sudah punya vektor. Pengguna: 2, koleksi: 0.

Artinya "indeks yang benar-benar lengkap" terhalang tiga hal yang bukan cacat kode: 63% peraturan belum punya PDF (panen BPK hanya
bisa dari peramban pemilik), pengukur v4 belum diterapkan, dan pembacaan Gemini belum berjalan. Yang bisa dikerjakan di kode: menjadikan
tiap langkah itu otomatis atau satu ketukan, dan membuat PDF yang sudah ada bernilai penuh (lihat bagian 3).

## 2. Temuan antarmuka (dari tangkapan layar ponsel 390 px dan desktop 1280 px)

**Halaman peraturan (paling bermasalah).** Sebelum pembaca sampai ke pasal atau PDF ada: remah roti, jenis, judul, lencana status,
jumlah pasal, tanggal, **tujuh** tombol aksi (Simpan, Salin sitasi, Salin tautan, Simpan luring, Naskah resmi, PDF, Laporkan), kartu
ringkasan AI, akordeon "Informasi peraturan", lalu empat tab. Di ponsel isi baru mulai sekitar 1.250 px dari atas (layar 844 px):
layar pertama tidak memuat pasal maupun PDF. Di desktop halaman PDF baru muncul di dasar layar 800 px.

**PDF diperlakukan sebagai alat pemeriksa, bukan fitur utama.** Ia tab kedua, bilah alatnya ikut tergulir, dan ada tiga pintu yang
mirip: tombol "PDF" di bilah aksi (tab baru), tab "PDF" (penampil), dan tab "Naskah" (tautan PDF + teks konversi mentah). Fitur yang
tak ada: cari di dalam PDF, daftar pasal dengan nomor halaman, cubit-untuk-zoom, layar penuh, unduh, bagikan halaman, ingat halaman
terakhir, mode gelap. "Lihat di PDF" memindai PDF di peramban tiap pembaca (lambat) dan **tak bekerja pada PDF pindaian**, padahal
justru pindaian yang paling butuh PDF. Untuk 63% peraturan tanpa PDF, panel hanya menjelaskan panjang lebar.

**Halaman lain.** Beranda: judul besar, kalimat penjelasan, pemilih "Cara mencari: Otomatis/Kata persis/Makna" (istilah teknis, hampir
tak pernah perlu diubah), kartu "Tanya Lexa" setinggi satu layar ponsel. Telusuri: tiga kartu statistik besar (angka internal: jumlah
peraturan, pasal, persen vektor) mendorong daftar ke luar layar, ditambah kalimat cakupan. Status data: tabel istilah panen untuk pengelola
yang tampil bagi semua pengunjung. Tanya Lexa: halaman nyaris kosong, kalimat saran terpotong di tepi kanan ponsel. Bilah bawah:
ikon tanpa label kecuali yang aktif. Tentang: dinding teks.

## 3. Rencana

**A. PDF sebagai fitur utama**

1. *Indeks pasal per halaman (server).* Konversi dan bacaan Gemini sudah menyisipkan penanda `### Page n`, tetapi pengurai membuangnya.
   Kolom baru `articles.halaman` (dan `laws.jumlah_halaman`) diisi saat ekstraksi dari penanda itu, dan terisi untuk peraturan lama lewat
   uraian ulang otomatis oleh Cron (tanpa biaya AI, tanpa konsol). Hasilnya: "Lihat di PDF" seketika, juga untuk PDF pindaian; daftar pasal
   dengan nomor halaman di penampil; hasil pencarian bisa menunjuk halaman.
2. *Penampil PDF baru.* Penampil punya penggulirnya sendiri dan mengisi sisa layar (bukan lagi di bawah tumpukan keterangan), dengan
   bilah ringkas: loncat ke pasal (daftar bernomor halaman), halaman n/N, cari di PDF, zoom (tombol, cubit, ketuk dua kali), layar penuh,
   dan menu (unduh, buka di tab baru, bagikan halaman ini, halaman gelap, periksa pasal). Mengingat halaman terakhir.
3. *Halaman peraturan dirampingkan.* Judul, status, dan pemilih **Teks | PDF | Relasi | Info** tepat di bawahnya; aksi sekunder ke satu
   menu; ringkasan AI, metadata, dan sumber pindah ke "Info"; tab "Naskah" dibuang (isinya melebur ke PDF dan Info). Peraturan tanpa PDF:
   tombol "Buka PDF di BPK" yang jelas dan "Minta PDF ini" (sinyal permintaan yang mengurutkan panen berikutnya).

**B. Kebersihan antarmuka di semua halaman**: beranda yang ringkas (tanpa pemilih mode, kartu Tanya yang kecil), Telusuri tanpa kartu
statistik, kalimat dan istilah yang tak perlu dibuang, bilah bawah berlabel, kolom saran Tanya Lexa yang membungkus, halaman Status yang
bahasanya untuk pembaca.

**C. Mekanisme indeks yang jalan sendiri**: uraian ulang peraturan berversi pengurai lama oleh Cron secara bertahap; tanda "diminta
pembaca" mengurutkan panen; panduan panen dan pembacaan Gemini yang satu ketukan.

**D. Mutu**: tes unit, integrasi, dan e2e untuk semuanya; uji mutasi pada logika baru; dokumen dan penerapan migrasi ke produksi.

## 4. Hasil (25 Oktober 2026)

**A. PDF sebagai fitur utama**

* *Indeks pasal per halaman* (migrasi 0009, sudah di produksi): tiap pasal menyimpan halaman PDF tempat ia dimulai. Cron 15 menit
  menguraikan ulang peraturan berpengurai lama dari arsip teksnya (20 peraturan per putaran; `URAIAN_ULANG_BATAS` sampai 100,
  `URAIAN_ULANG_OTOMATIS=mati` mematikan). Diverifikasi di produksi: 33 peraturan dan 408 baris pasal sudah bernomor halaman setelah
  dua putaran. Sisa ±2.600 peraturan selesai sendiri dalam ±33 jam pada pengaturan bawaan.
* *Penampil PDF baru* (`public/js/komponen/penampilPdf.js`, dengan `pdfZoom.js`, `pdfCari.js`, `pdfGestur.js`, `indeksPasalPdf.js` dan
  tiga lembar: pasal, cari, periksa): penggulir sendiri yang mengisi sisa layar; halaman digambar hanya bila terlihat (naskah 501
  halaman: buka <1 dtk, loncat ke halaman 400 ±150 ms, cari seluruh naskah ±1 dtk, 2-5 kanvas hidup, memori JS tetap 10 MB); daftar
  **Pasal** bernomor halaman (dari server, diverifikasi terhadap teks PDF, dan tetap bekerja untuk PDF pindaian); **cari di PDF**
  dengan penanda semua kecocokan (CSS Custom Highlight); cubit dua jari, ketuk dua kali, dan Ctrl+roda dengan titik fokus yang tetap
  di tempatnya; **Pas lebar**; layar penuh (tombol Kembali menutupnya); halaman gelap; halaman terakhir diingat per PDF dan ikut di
  alamat (`tab=pdf&hal=N`); unduh dan buka di tab baru; **Periksa pasal**.
* *Halaman peraturan dirampingkan*: judul, status, tiga tombol (Simpan, Salin sitasi, Lainnya), lalu **Teks | PDF | Relasi | Info**.
  Ringkasan AI, metadata, dan sumber pindah ke Info; tab Naskah dan tombol PDF ganda dibuang. Isi mulai di layar pertama ponsel
  (sebelumnya sekitar 1.250 px di bawahnya). Tiap pasal punya tombol "hal. N" yang selalu terlihat; hasil pencarian pasal juga
  membawanya. Peraturan yang pasalnya belum terbaca tetapi PDF-nya ada langsung membuka tab PDF.
* *Peraturan tanpa PDF*: tombol **Buka naskah resmi (BPK)** dan **Minta PDF ini** (lihat C).

**B. Kebersihan antarmuka**: beranda tanpa pemilih mode dan kartu Tanya yang kecil; Telusuri tanpa kartu statistik; Status berbahasa
pembaca (tabel dan riwayat pekerjaan dilipat) dengan tiga kartu angka yang ringkas di ponsel; Tentang dipadatkan; Koleksi dan Akun tanpa
kalimat berulang; Tanya Lexa dengan contoh pertanyaan yang membungkus dan, di layar lebar, judul-contoh-kotak tulis sebagai satu kelompok
di tengah; bilah bawah berlabel untuk semua tujuan. Teks yang mengulang judul atau menjelaskan yang sudah jelas dibuang di semua halaman.

**C. Mekanisme indeks otomatis**: tombol **Minta PDF ini** (`POST /api/dokumen/minta`, migrasi 0010) mencatat peminat per peraturan,
dibatasi per alamat; `GET /api/impor/butuh-teks` mendahulukan yang diminta (terbanyak dulu) dan memasukkannya walau sudah berpasal dari
teks lama; skrip panen mencetak jumlahnya; panduan panen satu ketukan (`{ batas: 200, terus: true, lama: true }`) dan bagian
"Permintaan PDF dari pembaca" ada di [pipeline-data.md](pipeline-data.md).

**D. Mutu**: 1.712 tes unit dan integrasi; 277 tes e2e di Chromium (ui 86, pwa 27, baca 49, penampil PDF 62, panen 33, cakupan lebar 2,
gemini 18), termasuk axe terang dan gelap dan konsol bebas galat dan pelanggaran CSP. Uji mutasi atas logika baru (rumus zoom dan
halaman terlihat, pencarian di PDF, indeks pasal, "Minta PDF", urutan antrean, halaman pada hasil pencarian): 95 mutan, 72 terbunuh pada
percobaan pertama; 20 dari 23 yang selamat dibunuh dengan tes tambahan, 3 sisanya setara (kodenya tak terjangkau: penjepit yang
berlebih, penjumlahan yang tak berpengaruh, dan reset yang sudah dilakukan hasil kueri).

## 5. Yang tetap di tangan pemilik, dan batasnya

* **Panen BPK** hanya bisa dari peramban pemilik (BPK menolak alamat server). Baru 37% peraturan punya PDF; tab PDF dan nomor halaman
  pasal hanya ada untuk yang sudah dipanen. Jalankan lagi skrip panen (opsi ada di bagian 3 [pipeline-data.md](pipeline-data.md)), lalu
  `{ batas: 200, terus: true, lama: true }` sampai antrean habis. Peraturan yang paling diminta pembaca otomatis di depan.
* **Kunci yang tertempel di obrolan** (Gemini dan NVIDIA) harus dicabut dan diganti; kunci baru hanya di secret Cloudflare.
* Opsional: `GEMINI_OTOMATIS=uji`, lalu `ya`, untuk PDF pindaian; `URAIAN_ULANG_BATAS` lebih besar bila paket Cloudflare mengizinkan
  (paket gratis: 100.000 baris tulis D1 per hari).
* Belum teruji dengan PDF BPK sungguhan (sandbox tak bisa menjangkau BPK ataupun produksi): penampil diuji dengan PDF buatan tes dan
  naskah 501 halaman; PDF aneh (font tak tertanam, halaman sangat besar) baru ketahuan setelah dipakai.
