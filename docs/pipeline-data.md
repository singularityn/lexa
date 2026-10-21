# Pipeline data: BPK sebagai sumber tunggal

Dokumen ini menjelaskan bagaimana UUD, Tap MPR, UU, Perppu, dan PP masuk ke Lexa, apa yang menjaga datanya, dan
bagaimana memeriksanya di produksi. **Sejak 14 Oktober 2026 satu-satunya sumber data adalah naskah resmi di
peraturan.bpk.go.id.** Lexa tidak lagi memakai API atau layanan pasal.id (sumber katalog dan teks sebelumnya); riwayat
dan alasannya ada di bagian [Sumber lama yang dihentikan](#sumber-lama-yang-dihentikan). Kodenya ada di `src/worker/lib/`
(`bpk`, `tautanBpk`, `prioritas`, `ingest`, `hapus`, `pemeliharaan`) dan `src/worker/routes/impor.ts`, tesnya di
`test/integration/` dan `e2e/panen.test.mjs`.

## Alur singkat

```
peramban pengelola di peraturan.bpk.go.id (sesi yang lolos tantangan Cloudflare)
  scripts/bpk-console-harvest.js
     1. jelajah   daftar BPK per jenis  ──►  POST /api/impor/tautan    ──►  laws.bpk_id + alamat rincian (peraturan baru dibuat)
     2. panen     GET /api/impor/butuh-teks  ──►  unduh PDF dari BPK  ──►  PUT /api/impor/pdf  ──►  R2 pdf/<uri>.pdf
                                                                                      │ antrean lexa-ingest
                                                                                      ▼
                                       ekstrak_pdf: Workers AI toMarkdown  ──►  teks/<uri>.md di R2
                                         ──►  bersihkanHalaman  ──►  uraikanPasal  ──►  articles di D1  ──►  indeks_vektor + ringkas (antrean)
                                                              └──►  uraikanPenjelasan  ──►  penjelasan di D1
```

Worker tidak pernah menghubungi BPK: situsnya di balik Cloudflare managed challenge dan menolak alamat pusat data, jadi
pengambilan dikerjakan **dari peramban pengelola**. Yang dikerjakan Worker hanya menerima, memetakan, dan menyimpan.

PDF pindaian (tanpa lapisan teks) tak terbaca `toMarkdown`. Untuk itu ada jalur cadangan yang opt-in: Gemini membaca halaman
sebagai gambar dan menggantikan langkah `toMarkdown`; sisa alurnya sama. Lihat [Pembacaan PDF pindaian oleh
Gemini](#pembacaan-pdf-pindaian-oleh-gemini)

## Komponen

**API impor** (`routes/impor.ts`, header `x-admin-token`). Daftar kerja, penautan, manifest, PDF, penanda "tanpa berkas",
ekstraksi ulang, dan ringkasan; tabelnya ada di bagian [Panen BPK](#panen-bpk-melengkapi-teks).

**Urutan prioritas** (`lib/prioritas.ts`). Daftar kerja diurutkan: yang sudah bertaut ke BPK dulu (alamatnya diketahui),
lalu menurut jenis (UUD, Tap MPR, UU, Perppu, PP; urutan `CAKUPAN_BAWAAN`), lalu tahun terbaru, lalu URI. Dihitung langsung
di SQL dari `jenis` dan `tahun`; kolom `laws.isi_giliran` (urutan antrean sumber lama) tidak dipakai lagi.

**Ekstraksi** (`lib/ingest.ts`, `ekstrakPdf`). PDF dikonversi Workers AI `toMarkdown`, teks konversi diarsipkan di R2
(`teks/<uri>.md`), `periksaKecocokanNaskah` menolak PDF yang judul resminya milik peraturan lain, lalu teks diurai:

- **`bersihkanHalaman`** (`lib/halaman.ts`) membuang artefak halaman PDF sebelum apa pun diurai: penanda `### Page N`, kepala
  bernomor halaman (`PRESIDEN⏎REPUBLIK INDONESIA- 20 -`, tahan salah baca OCR) dan yang tanpa nomor menempel pada judul, kaki
  (`SK No 004269 A`, `www.peraturan.go.id`), catchword (kata pertama halaman berikutnya diulang di ujung halaman ini),
  baris berulang di tepi halaman, dan bingkai tabel markdown. Hanya tepi halaman yang disentuh, kecuali satu hal: konversi
  kadang tak menaruh penanda halaman di antara catchword dan pengulangannya ("... 1 Januari 1996.Agar…Agar setiap orang
  mengetahuinya", "Ayat (4)…⏎Ayat (4)⏎Cukup jelas"; 827 baris pasal pada 184 peraturan produksi). Catchword semacam itu dibuang
  di mana pun ia berada, tetapi hanya bila titik-titiknya langsung disusul (spasi atau baris baru di antaranya) kata-kata yang
  sama dengan yang mendahuluinya: paling banyak enam kata, spasi dan huruf besar-kecil tak diperhatikan, penanda butir ("(2)",
  "c.") boleh ada di satu sisi saja, dan pengulangan harus berhenti di batas kata ("Pasal 1…⏎Pasal 12" tak tersentuh). Hasilnya
  idempoten.
- **`uraikanPasal`** (`lib/bpk.ts`) memecah batang tubuh menjadi pasal dan ayat. Ia berhenti di judul PENJELASAN (juga yang
  menempel pada kepala halaman) dan di **rumus penutup** ("Agar setiap orang mengetahuinya, memerintahkan pengundangan ...");
  pengesahan, tanda tangan, dan lampiran sesudahnya bukan isi pasal.
- **`uraikanPenjelasan`** (`lib/penjelasan.ts`) mengurai Penjelasan Umum dan penjelasan tiap pasal ke tabel `penjelasan`
  (migrasi 0007; `nomor_pasal` seperti `articles`, `Umum` untuk Penjelasan Umum). Penjelasan tidak masuk indeks pencarian,
  vektor, maupun hitungan pasal; `GET /api/laws/detail` menyajikannya dan antarmuka menampilkannya di bawah pasalnya.
- **`nilaiKualitasEkstraksi`** menilai mutu teks bersih (`ekstraksi_log`: bersih, ringan, berat, tanpa_pasal, gagal). Sejak
  versi pengurai 4 ia menghitung dua jenis kerusakan. Karakter: angka tercemar huruf, simbol liar, dan sisa catchword, per 1.000
  karakter (≥ 2 `berat`, ≥ 0,5 `ringan`). Struktur: **pasal yang hilang** dari rangkaian 1..N (nomor tertinggi tanpa pencilan;
  `celah_pasal`, `pasal_tertinggi`), dengan ≥ 5 nomor dan ≥ 25% `berat`, ≥ 3 nomor dan ≥ 10% `ringan`, dan **pembukaan yang
  tertelan ke dalam pasal** ("DEWAN PERWAKILAN RAKYAT REPUBLIK INDONESIA", "MEMUTUSKAN", "BAB IKETENTUAN UMUM" menempel; `berat`);
  Pasal 1 yang tak terbaca pada peraturan berpasal ≥ 10 sedikitnya `ringan`. Versi 1-3 hanya mengukur karakter dan buta
  terhadap pindaian ber-OCR yang kehilangan pasalnya (UU 32/2014 Kelautan dinilai `bersih`, begitu pula UU 12/1967 yang hanya
  terbaca 23 dari 58 pasal): dari 802 peraturan berpasal ≥ 10 yang dinilai `bersih` di produksi, 227 kehilangan seperempat
  nomornya atau lebih (14 Okt 2026, versi pengurai 0). Uraian ulang `usang` versi 3 memulihkan sebagian (UU 12/1967 lengkap); sisanya,
  115 dari 976, tetap hilang dan menjadi `berat` begitu diurai ulang dengan versi 4. Alasan vonis ditulis di `ekstraksi_log.catatan`.

Hasilnya disimpan atomik. **Keputusan menimpa pasal yang tersimpan** (`putuskanPenggantian`) dihitung dengan *nomor pasal
berbeda*, bukan baris: naskah lama yang menyimpan Penjelasan sebagai pasal kembar punya jauh lebih banyak baris daripada nomor.
Belum ada pasal: simpan. Hasil PDF baru: tidak menggantikan bila teks PDF rusak berat (vonis `berat`) atau nomornya lebih
sedikit (pindaian yang terbaca buruk tak boleh menimpa naskah yang lebih utuh), selain itu menggantikan, termasuk teks lama
sumber yang sudah dihentikan. Uraian ulang arsip BPK yang sama menggantikan, kecuali nomornya menyusut lebih dari separuh pada
naskah dengan sepuluh nomor atau lebih (lebih mungkin kerusakan pengurai daripada perbaikan). Pasal yang hasilnya persis sama
tidak ditulis ulang dan tidak diindeks ulang. (Jalur Gemini memutuskan dengan aturannya sendiri, lihat bagian Gemini: nomor
tersimpan yang tak ada pada bacaan baru, bukan jumlah nomor.) Vektor pasal yang lenyap atau memendek, dan arsip teks lama (`.txt`) yang
digantikan, dicatat di `daftar_hapus`. Setiap hasil penguraian mencatat `ekstraksi_log.versi_parser` (`VERSI_PARSER` di
`lib/bpk.ts`). Sesudahnya pengindeksan vektor dan, untuk naskah baru, ringkasan AI diantrekan.

**Daftar hapus** (`lib/hapus.ts`, tabel `daftar_hapus`). Objek R2 dan vektor Vectorize yang yatim dicatat sebagai batu nisan
dan dikosongkan oleh pemeliharaan harian: 500 kunci R2 dan 1.000 id vektor per putaran, putaran demi putaran sampai kosong
atau 8 menit habis. Barisnya baru dilepas sesudah objeknya terhapus.

**Pemeliharaan harian** (`lib/pemeliharaan.ts`, Cron `0 19 * * *` = 02:00 WIB): mengosongkan
daftar hapus, memangkas `sync_log` yang lebih tua dari 90 hari, dan membuang sisa keadaan sumber lama dari `sync_state`
(`katalog_*`, `diag:*`, `diagisi:*`, `statistik:*`, `log:*`, `pinjaman:*`, `offset:*`, `tik_*`, `denyut:*` selain denyut
harian, `akses_isi`, `akses_diperiksa`, `pasal_tunda_sampai`, `jenis_awal`). Satu baris `sync_log` (`pemeliharaan`) ditulis
hanya bila ada yang dikerjakan. Pemicu Cron lain yang dikenal hanya Gemini otomatis (`*/15 * * * *`, lihat bagian Gemini);
yang tak dikenal (sisa konfigurasi lama) diabaikan.

**Status** (`GET /api/stats`, halaman `/status`). Kelengkapan per jenis diukur dari sisi panen: bertaut BPK, ber-PDF,
berpasal, menunggu PDF, PDF belum terurai, serta jumlah "teks BPK" (arsip teks berekstensi `.md`) dan "teks lama" (tersimpan
sebelum panen BPK).

## Panen BPK (melengkapi teks)

Teks UUD, Tap MPR, UU, Perppu, dan PP datang dari naskah resmi BPK, dan hanya dari sana. Seluruh peraturan.bpk.go.id
di balik Cloudflare managed challenge dan Worker Lexa tidak pernah menghubunginya, jadi pengambilannya dikerjakan **dari
peramban Anda sendiri** oleh `scripts/bpk-console-harvest.js`, yang berbicara dengan Lexa lewat `/api/impor/*` (header
`x-admin-token`, secret `ADMIN_TOKEN`; origin BPK diizinkan CORS).

### Mengapa dua tahap

Daftar kerja (`GET /api/impor/butuh-teks`) hanya bisa menyebut peraturan yang alamatnya di BPK diketahui. Keadaan produksi
12 Okt 2026 (sebelum penjelajahan; angka terkini ada di `/status`):

| Jenis | Baris | Punya `bpk_id` | Alamat sumber lain | Tanpa pasal |
|---|---:|---:|---|---:|
| PP | 5.011 | **3** | peraturan.go.id 1.442; sumber lama 220; BPK 88; **kosong 3.261** | 3.502 |
| UU | 1.950 | 1.361 | peraturan.go.id 481; sumber lama 89 | 158 |
| Perppu | 170 | 5 (138 beralamat BPK) | | 17 |
| Tap MPR | 41 | 2 | | 39 |
| UUD | 5 | 0 | | 5 |

Jadi tanpa tahap pertama, skrip tak tahu ke mana harus pergi untuk hampir semua PP. Dua tahap:

1. **Penjelajahan** (`jelajah: true`): skrip membuka daftar BPK per jenis, halaman demi halaman (`/Search?jenis=<n>&page=<n>`;
   jenis dalam cakupan dicari dari halaman `/Jenis`), mengumpulkan tiap tautan `/Details/<id>/<slug>` beserta teks judul dan
   tautan PDF di kartunya, dan mengirimnya ke `POST /api/impor/tautan`. Lexa mengenali sitasinya dari slug dan teks tautan
   ("pp-no-5-tahun-2021", "Undang-undang (UU) No. 8 Tahun 1982", "tap-mpr-no-xvimpr1998"), mencocokkannya dengan peraturan
   Lexa, dan menyimpan `bpk_id` serta alamat rinciannya (bukan metadata lain). Cukup sekali.
2. **Panen PDF**: skrip bertanya `GET /api/impor/butuh-teks`, mengunduh PDF tiap peraturan, dan mengunggahnya
   (`PUT /api/impor/pdf`). Lexa mengekstraknya menjadi pasal di latar belakang (`ekstrak_pdf`: Workers AI `toMarkdown`, lalu
   pengurai pasal dengan penilaian mutu; hasil yang lebih sedikit dari pasal yang sudah tersimpan tidak menggantikannya).

### Endpoint

| Endpoint | Kegunaan |
|---|---|
| `GET /api/impor/butuh-teks?batas=50&jenis=UU,PP&celah=1&lama=1&semua=1` | daftar kerja: peraturan tanpa teks dan tanpa PDF; yang bertaut BPK didahulukan, lalu menurut jenis dan tahun terbaru (`lib/prioritas.ts`). Menjawab `total`, `tanpa_bpk`, `tanpa_berkas`. `celah=1` menyertakan teks yang baru sebagian; `lama=1` menyertakan peraturan berpasal dari teks lama sumber yang sudah dihentikan (didahulukan yang belum berteks sama sekali); `semua=1` menyertakan yang ditandai tanpa berkas |
| `GET /api/impor/ringkasan` | per jenis: `total`, `bertaut_bpk`, `ber_pdf`, `berpasal`, `pdf_belum_berpasal`, `perlu_pdf`; plus `tanpa_berkas` |
| `POST /api/impor/tautan` | `{ tautan: [{ url, teks, slug?, konteks?, uri? }], buat? }` (maks 200). Jawabannya memuat status tiap entri: `ditautkan`, `sudah`, `dibuat`, `tidak_ada`, `luar_cakupan`, `tidak_dikenali`, `ambigu`, `bentrok`, `gagal`. `uri` memetakan manual ke peraturan Lexa (mis. UUD 1945 ke `/akn/id/act/uud/1945/original`) |
| `POST /api/impor/manifest` | metadata + relasi halaman rincian. Dicocokkan menurut sitasi, bukan URI turunan; `lexa_uri` mengikat dokumen ke satu peraturan (hanya memperbarui; ditolak bila sitasinya tak cocok) |
| `PUT /api/impor/pdf?uri=` | berkas PDF; ke R2 `pdf/…`, lalu diantrekan `ekstrak_pdf` |
| `POST /api/impor/tanpa-berkas` | `{ uris: [...] }`: peraturan yang di BPK tak punya berkas (naskah lama hanya metadata); tak muncul lagi di daftar kerja |
| `POST /api/impor/ekstrak-ulang` | `{ uri?, batas?, jenis?, dariTeks?, usang?, setelah? }`: antrekan ulang ekstraksi PDF yang tersimpan tetapi belum berpasal (mis. setelah pengurai diperbaiki). `dariTeks: true` menguraikan arsip teks hasil konversi yang sudah ada (tanpa membaca PDF dan tanpa Workers AI), arsip BPK (`teks/<uri>.md`) didahulukan; peraturan tanpa arsip tetap dikonversi dari PDF-nya. `usang: true` menguraikan ulang (selalu dari arsip teks) peraturan yang terakhir diurai dengan versi pengurai lebih lama; lihat [bagian di bawah](#memperbarui-pengurai-uraikan-ulang-yang-usang) |
| `POST /api/impor/ringkas` | `{ batas? }`: antrekan ringkasan AI untuk peraturan yang sudah berteks tetapi belum beringkasan |
| `GET /api/impor/gemini-cek` | uji kunci, model, dan alamat Gemini dengan satu permintaan kecil; menjawab versi model, token, dan anggaran hari ini |
| `POST /api/impor/gemini-uji` | `{ uri }`: percobaan kering, Gemini membaca PDF satu peraturan dan Lexa melaporkan apa yang akan terjadi tanpa menulis pasal; lihat [bagian di bawah](#pembacaan-pdf-pindaian-oleh-gemini) |
| `POST /api/impor/ekstrak-ulang` `{ gemini: true }` | `{ batas?, vonis?, ulangi?, setelah?, uri? }`: antrekan pembacaan Gemini untuk peraturan yang teksnya tak layak |

Beberapa hal yang dijaga di sisi server karena data produksi menuntutnya:

- **Pencocokan menurut sitasi**, bukan teks nomor atau URI: "01" = "1" (PP 1/2022 ada dua baris), "perpu" = "perppu" (URI
  produksi memakai keduanya, sedangkan indeks unik `(jenis, nomor, tahun)` tak memeriksa URI), dan Tap MPR "XVI/MPR/1998" =
  "XVI-MPR-1998" = "xvi-mpr-1998" (tiga baris untuk satu ketetapan). Sebelumnya manifest dengan URI turunan yang berbeda dari
  yang tersimpan melanggar indeks unik dan menggagalkan SELURUH kiriman (batch D1 atomik); kini kegagalan satu dokumen
  terpisah dari yang lain.
- **Jenis tak pernah ditukar**: BPK pernah menamai Perppu 7/1964 "uu-no-7-tahun-1964". Bila slug dan teks tautan menunjuk
  dua peraturan yang berbeda, data Lexa yang memutuskan; bila dua-duanya ada di Lexa, hasilnya `ambigu` dan tak ada yang ditulis.
- **Tautan yang keliru berarti PDF yang keliru**, dan PDF yang keliru menimpa pasal yang benar. Karena itu teks kartu hasil
  hanya dipakai untuk tahun Tap MPR, bukan untuk mengenali sitasi. Sebagai jaring terakhir, `ekstrak_pdf` membandingkan judul
  resmi di kepala naskah hasil konversi ("PERATURAN PEMERINTAH REPUBLIK INDONESIA NOMOR 5 TAHUN 2021") dengan peraturan yang
  dituju; bila judul resmi itu ditemukan dan milik peraturan lain, **pasal tidak disimpan** (teks konversi tetap diarsipkan,
  PDF tetap ada, `ekstraksi_log` dan `isi_catatan` mencatat "PDF memuat judul PP 5/2021, bukan PP 99/2025"). Tanpa judul resmi
  yang dikenali (naskah lama, angka rusak oleh OCR, Tap MPR, UUD) naskah diproses seperti biasa; Undang-undang dan Perppu
  dianggap sejenis karena BPK pernah mencampurnya.
- Halaman rincian tanpa `Status` tidak menjadikan peraturan "berlaku"; judul BPK tanpa pokok (" tentang ") tidak menggantikan
  judul lama yang memilikinya, tetapi menggantikan judul bersampah yang berpokok (mis. UU 4/2026 yang judulnya hasil salin PDF).

### Cara menjalankan

Buka https://peraturan.bpk.go.id/ di peramban, selesaikan tantangan Cloudflare bila muncul, lalu DevTools > Console (F12).
Setel opsi dengan `window.LEXA_PANEN = { ... }` (Enter), tempel isi `scripts/bpk-console-harvest.js` (Enter), dan isi alamat Lexa
dan `ADMIN_TOKEN` pada kotak dialog (hanya di memori halaman). Kotak status di pojok kanan bawah menunjukkan kemajuan dan
punya tombol **Berhenti** (atau `lexaPanenBerhenti()` di konsol). Biarkan tab terbuka dan terlihat: peramban memperlambat
tab yang tersembunyi. Urutan yang dianjurkan:

| Langkah | Opsi | Apa yang terjadi |
|---|---|---|
| a. Uji penjelajahan | `{ jelajah: true, kering: true, halamanMaks: 2 }` | dua halaman per jenis dijelajahi, tak ada yang ditulis; konsol mencetak jenis yang ditemukan, jumlah entri, dan contoh entri bermasalah |
| b. Penjelajahan | `{ jelajah: true, hanyaJelajah: true }` | seluruh daftar UUD, Tap MPR, UU, Perppu, PP ditautkan (PP ±250-500 permintaan; jeda ±3 detik) |
| c. Uji PDF | `{ kering: true, batas: 3 }` | tiga PDF diunduh dan dibuang |
| d. Panen | `{ batas: 200, terus: true }` | putaran demi putaran sampai daftar kerja habis, tak ada kemajuan, 5 kegagalan beruntun, atau Anda menghentikannya |

Jalankan lagi kapan saja untuk melanjutkan: yang sudah tertaut dan yang PDF-nya sudah terunggah tak muncul lagi. Penjelajahan
yang terputus dilanjutkan dengan `halamanAwal` (alamat daftar dan nomor halaman tercetak di konsol).

Opsi lengkap (semuanya opsional):

| Opsi | Arti |
|---|---|
| `lexa`, `token` | alamat Lexa dan token admin (bila kosong, ditanyakan lewat kotak dialog) |
| `jelajah`, `hanyaJelajah` | jelajahi daftar BPK sebelum panen PDF; hanya jelajahi |
| `awal` | alamat daftar yang dijelajahi, mis. `["https://peraturan.bpk.go.id/Search?jenis=10"]`. Bila kosong: jenis dicari dari `/Jenis` BPK, atau dari halaman yang sedang dibuka bila sudah berupa daftar |
| `halamanMaks`, `halamanAwal` | batas halaman per daftar (600) dan halaman mulai (1) |
| `buat` | `false`: jangan membuat baris untuk peraturan BPK yang belum ada di Lexa (bawaan: dibuat, hanya bila sitasinya tak meragukan) |
| `batas`, `terus` | peraturan per putaran panen (50, maks 200); ulangi putaran sampai selesai |
| `jenis`, `celah` | saring jenis `"UU,PP"`; sertakan teks yang baru sebagian |
| `lama` | sertakan juga peraturan berpasal dari teks lama (bukan BPK) supaya naskah BPK menggantikannya; jalankan sesudah yang tanpa teks habis |
| `usang`, `jedaUsang` | tidak memanen apa pun dari BPK: uraikan ulang arsip teks yang diurai dengan versi pengurai lama, per `batas` (maks 100) dengan kursor, sampai habis; jeda antarputaran (8000 ms) |
| `jeda` | jeda minimum antarpermintaan ke BPK, ms (4000; minimum 2000, jangan dikecilkan) |
| `kering` | tidak menulis apa pun ke Lexa |
| `rincian` | buka halaman rincian walau tautan PDF langsung dari daftar diketahui (metadata ikut diperbarui; dua kali lipat permintaan) |
| `periksa` | hanya menganalisis halaman yang sedang dibuka dan mencetaknya |
| `papan` | `false`: tanpa kotak status |

### Bila tidak berjalan seperti yang diharapkan

Skrip ditulis menurut susunan BPK yang diketahui (alamat `/Details/<id>/<slug>` dan `/Download/<id>/<berkas>`, daftar
`/Search?jenis=<n>&page=<n>`); sudah dijalankan pemilik pada situs sungguhan sejak 14 Okt 2026 (lihat di bawah).
Yang berguna dikirim balik bila ada yang tak sesuai:

- Di halaman daftar BPK (mis. `https://peraturan.bpk.go.id/Search?jenis=10`): `window.LEXA_PANEN = { periksa: true }` lalu
  tempel skrip. Ia mencetak jumlah hasil yang disebut BPK, sepuluh entri pertama (id, slug, teks, tautan PDF di kartu),
  tautan halaman berikutnya yang akan diikuti, dan tautan jenis yang dikenali.
- Di halaman rincian: hal yang sama untuk tabel metadata dan semua tautan unduhan.
- Setelah penjelajahan: tabel "contoh entri berstatus tidak_dikenali / tidak_ada / ambigu / bentrok" yang dicetak konsol
  (teks, slug, kartu, dan alasan dari Lexa). `tidak_dikenali` berarti pengenalan sitasi perlu disesuaikan dengan bentuk
  teks BPK yang sebenarnya; itu perbaikan kecil di `src/worker/lib/tautanBpk.ts` (tanpa menempel ulang skrip).

Pesan galat yang lazim:

| Pesan | Arti dan tindakan |
|---|---|
| `Lexa 401` | token salah; skrip berhenti sebelum menyentuh BPK |
| `Lexa tak terjangkau … CORS` | alamat Lexa salah, atau Lexa belum men-deploy versi yang mengizinkan origin BPK |
| `Lexa belum menjalankan versi yang mendukung penjelajahan` | deploy terbaru belum selesai (404 pada `/api/impor/ringkasan`) |
| `tantangan_cloudflare` | sesi BPK kedaluwarsa atau diblokir (dikenali dari status 403, atau isi halaman yang memang begitu); muat ulang tab, selesaikan tantangan, jalankan lagi. Dokumen ini TIDAK dicoba lewat halaman rincian — percobaan itu akan gagal karena sebab yang sama |
| `berkas yang terunduh bukan PDF dan bukan halaman tantangan yang dikenali` | tautan usang atau berkas dipindahkan BPK — BUKAN masalah sesi. Skrip sudah mencoba halaman rincian sendiri (lihat "tautan PDF langsung … usang" di bawah); pesan ini berarti itu juga gagal. Jalankan `{ periksa: true }` di halaman rincian dokumen itu (alamatnya: `GET /api/dokumen/status?uri=<frbr_uri>` lewat Lexa, field `bpk_url`) |
| `tautan PDF tak ditemukan di halaman rincian` | halaman tak berformat yang dikenal (tanpa tabel metadata maupun tautan unduhan); jalankan `periksa` di halaman itu |
| `5 kegagalan beruntun` | skrip berhenti sendiri; periksa sesi BPK dulu (pesan kegagalan pertama menunjukkan apakah ini sungguh sesi atau bukan — lihat dua baris di atas) |

**Tautan PDF langsung dari daftar yang usang (ditemukan dan diperbaiki 14 Okt 2026).** Tautan unduhan yang disimpan sewaktu
penjelajahan (`jelajah`) kadang usang — BPK memindahkan berkas, atau hasil pencariannya sendiri sudah tak mutakhir. Sebelum
perbaikan, kegagalan tautan itu SELALU dianggap masalah sesi (kata "tantangan" kebetulan ada di teks penjelasnya) sehingga
halaman rincian tak pernah dicoba sebagai jalur kedua — mengunci dokumen itu di urutan pertama antrean `butuh-teks`
**untuk selamanya**, karena kegagalan yang terjadi di peramban tak pernah tercatat di Lexa (PDF tak pernah terunggah, jadi
dokumen yang sama selalu diminta lagi di percobaan berikutnya). Ini ditemukan lewat laporan pemilik: `GAGAL: yang terunduh
bukan PDF` berulang pada UU 6/2023 (Cipta Kerja), yang selalu nomor satu di antrean tanpa satu dokumen pun di depannya.

Sekarang skrip membedakan tegas: hanya kegagalan yang SUNGGUH dikenali sebagai tantangan (status 403, atau isi halamannya
memang begitu) yang menyerah langsung; tautan yang gagal karena sebab lain (usang, dipindahkan) tetap dicoba lewat halaman
rincian sebelum dilaporkan gagal. **Tempel ulang skrip dari repo** (versi sebelumnya tak membawa perbaikan ini) sebelum
melanjutkan panen yang macet. Bila tempel ulang saja belum memulihkan satu dokumen tertentu, tandai `tanpa-berkas` secara
manual agar yang lain tak ikut tertahan, sambil diselidiki lewat `{ periksa: true }` di halaman rinciannya:

```js
fetch('https://lexa.<akun>.workers.dev/api/impor/tanpa-berkas', {
  method: 'POST', headers: { 'x-admin-token': T, 'content-type': 'application/json' },
  body: JSON.stringify({ uris: ['/akn/id/act/uu/2023/6'], alasan: 'unduhan gagal berulang, diselidiki manual' }),
}).then(r => r.json()).then(console.log)
```

### Biaya dan batas

- **Waktu**: ±4-6 detik per PDF (jeda yang sopan), jadi ±3.700 peraturan yang belum berteks memakan ±5-7 jam; dibagi beberapa sesi dengan `batas` dan
  `terus`. Penjelajahan PP sendiri ±250-500 permintaan.
- **R2**: PDF disimpan di `pdf/…` (rata-rata mungkin ratusan KB; 3.700 berkas bisa beberapa GB).
- **D1**: tiap peraturan menulis puluhan baris pasal ditambah indeks FTS; bila akun Anda di paket gratis (100.000 baris tulis
  per hari), bagi panen ke beberapa hari.
- **Workers AI**: konversi PDF, penyematan semua pasal (bge-m3), dan ringkasan tiap peraturan memakai kuota neuron harian;
  pesan antrean yang kehabisan kuota diulang otomatis. Pantau di `/status` dan `sync_log` (`ekstrak_pdf`).
- **PDF hasil pindaian** (tanpa lapisan teks) menghasilkan `tanpa_pasal` di `ekstraksi_log`; mereka tetap tersimpan dan terbaca
  di tab PDF, tetapi pasalnya menunggu OCR (lihat analisis lanjutan). Setelah pengurai pasal diperbaiki, antrekan ulang dengan
  `POST /api/impor/ekstrak-ulang`. Teks hasil konversinya kini selalu diarsipkan dan kuncinya dicatat (`laws.r2_text_key`) walau tak
  ada pasal yang terdeteksi: teksnya terbaca di tab Dokumen ("Lihat teks hasil konversi") dan bisa diperiksa lewat
  `GET /api/dokumen/teks?uri=` untuk memperbaiki pengurai; `dariTeks: true` menguraikannya ulang tanpa konversi.

### Menjalankan skrip panen dari server sendiri: tidak bisa untuk BPK

Dicoba 13 Okt 2026 dari server awan milik pengguna (Ubuntu 22.04, Oracle Cloud): `peraturan.bpk.go.id/` dan `/robots.txt`
dijawab **403 "Access Denied / Akses Ditolak"** oleh Cloudflare, tanpa `cf-mitigated: challenge` dan tanpa halaman "Just a
moment". Itu pemblokiran jaringan (alamat atau ASN pusat data), bukan tantangan yang bisa dilewati peramban, jadi panen BPK
harus dijalankan dari peramban di jaringan yang diterima BPK (rumah atau kantor di Indonesia), seperti pada "Cara menjalankan".
Jangan mencoba mengakalinya (proxy, penyamaran peramban): itu penolakan akses oleh pemilik situs. Dari server yang sama
terjangkau: situs Lexa, registri npm, nodejs.org, `jdih.setneg.go.id` (robots.txt mengizinkan semua; struktur daftar PP dan PDF-nya
belum dipetakan). Tidak terjangkau: `peraturan.go.id` dan `jdihn.go.id` (waktu habis).

### Memantau dan memeriksa

```sql
-- Kemajuan per jenis (atau GET /api/impor/ringkasan)
SELECT jenis, COUNT(*) AS total, SUM(bpk_id IS NOT NULL AND bpk_id <> '') AS bertaut_bpk,
       SUM(r2_pdf_key IS NOT NULL) AS ber_pdf, SUM(jumlah_pasal > 0) AS berpasal
  FROM laws GROUP BY jenis;
-- Hasil ekstraksi PDF terakhir
SELECT vonis, COUNT(*) FROM ekstraksi_log GROUP BY vonis;
SELECT job, status, detail, jumlah, created_at FROM sync_log WHERE job LIKE 'impor_bpk%' OR job = 'ekstrak_pdf' ORDER BY id DESC LIMIT 20;
-- Penanda tanpa berkas, dan alasannya (alasan "tautan PDF-nya tak dikenali" berarti halaman dimuat tetapi pemilih skrip
-- tak mengenali tombol unduhnya: periksa satu halaman itu dengan { periksa: true })
SELECT value, COUNT(*) FROM sync_state WHERE key LIKE 'bpk_tanpa_berkas:%' GROUP BY value;
-- PDF yang ternyata bukan naskah peraturannya (pasal tidak disimpan)
SELECT frbr_uri, catatan FROM ekstraksi_log WHERE catatan LIKE 'PDF memuat judul%';
-- Duplikat data (satu peraturan, beberapa baris): Tap MPR ditulis tiga cara, PP "01" dan "1"
SELECT frbr_uri, nomor, tahun, jumlah_pasal FROM laws WHERE jenis = 'TAP_MPR' ORDER BY tahun, lower(nomor);
```

### PDF yang sudah ada di R2 tetapi belum berpasal (temuan 13 Okt 2026)

Di produksi 106 peraturan (UU 104, Perppu 1, PP 1) punya PDF di R2 namun `jumlah_pasal = 0`. Asal PDF-nya eksperimen pengukuran
Agustus 2026 (`GET /api/admin/ukur`), yang mengonversi dan menilai tetapi tidak menyimpan pasal. Dua kelompok:

| Kelompok | Jumlah | Sebab | Pemulihan |
|---|---|---|---|
| Vonis `bersih`/`ringan`, `ekstraksi_log.jumlah_pasal > 0`, arsip teks ada (`r2_text_key`) | 14 (KUHP/UU 1/2023: 1.032 pasal, UU 2/2017, UU 20/2016, UU 13/2016, UU 39/2014, UU 23/2007, ...) | pasal terukur tetapi tak pernah disimpan | `ekstrak-ulang` dengan `dariTeks: true` (tanpa Workers AI) |
| Vonis `tanpa_pasal`, tanpa arsip teks | 89 (hampir semuanya UU 1946-1954) | judul pasal gaya lama "Pasal 1." (titik tunggal) dibuang pengurai sebagai catchword kaki halaman; diperbaiki di `uraikanPasal` (lib/bpk.ts) | `ekstrak-ulang` biasa (konversi ulang dari PDF; PDF-nya kecil, 20-80 KB) |

Setelah rilis dengan perbaikan ini terpasang, jalankan dari mana saja yang punya token (token dibaca tanpa gema dan tidak masuk
riwayat perintah). `dariTeks: true` cukup untuk keduanya: peraturan yang punya arsip teks diuraikan tanpa Workers AI, yang tidak
punya dikonversi ulang dari PDF-nya. Karena `batas` maksimum 100 per pemanggilan dan ada 106 peraturan, jalankan dua kali dengan
jeda beberapa menit (antrean perlu waktu untuk memproses yang pertama):

```bash
read -rs -p 'ADMIN_TOKEN: ' T; echo
for i in 1 2; do
  curl -sS -X POST https://lexa.<akun>.workers.dev/api/impor/ekstrak-ulang -H "x-admin-token: $T" -H 'content-type: application/json' \
    -d '{"jenis":["UU","PERPPU","PP"],"batas":100,"dariTeks":true}'; echo
  [ "$i" = 1 ] && sleep 180
done
unset T
```

`ekstrak-ulang` mendahulukan yang paling lama dicoba, jadi pemanggilan berulang berputar melewati semuanya. Pantau:

```sql
SELECT l.jenis, e.vonis, COUNT(*) FROM laws l LEFT JOIN ekstraksi_log e ON e.frbr_uri = l.frbr_uri
 WHERE l.r2_pdf_key IS NOT NULL AND l.jumlah_pasal = 0 GROUP BY 1, 2;
```

Sisa yang tetap `tanpa_pasal` kini punya arsip teks (`r2_text_key`), jadi bentuk kegagalannya bisa dibaca lewat
`GET /api/dokumen/teks?uri=` dan pengurainya diperbaiki dengan bukti, bukan dugaan.

## Memperbarui pengurai: uraikan ulang yang usang

Memperbaiki `halaman.ts`, `penjelasan.ts`, atau `uraikanPasal` tidak mengubah apa pun yang sudah tersimpan. Karena arsip teks
konversi (`teks/<uri>.md`) ada di R2, peraturan yang sudah dipanen cukup **diuraikan ulang dari arsipnya**, tanpa mengunduh
ulang dari BPK dan tanpa konversi PDF (Workers AI). Setiap perubahan yang mengubah hasil menaikkan `VERSI_PARSER`
(`lib/bpk.ts`); `ekstraksi_log.versi_parser` mencatat versi yang menghasilkan pasal tersimpan (baris yang ada sebelum
migrasi 0007 bernilai 0), dan mode `usang` menawarkan yang versinya lebih rendah.

Urutannya (satu kali per versi):

1. Terapkan migrasi 0007 (`npm run d1:migrate:remote`; pada produksi Lexa ini sudah diterapkan 14 Okt 2026) dan deploy rilis
   yang memuat pengurai baru.
2. Jalankan uraian ulang, salah satunya:
   - di konsol peramban (tab situs BPK atau Lexa): `window.LEXA_PANEN = { usang: true }`, tempel
     `scripts/bpk-console-harvest.js`, isi alamat Lexa dan token; atau
   - dari terminal (token dibaca tanpa gema):

   ```bash
   read -rs -p 'ADMIN_TOKEN: ' T; echo
   LEXA=https://lexa.<akun>.workers.dev; SETELAH=""
   while :; do
     R=$(curl -sS -X POST "$LEXA/api/impor/ekstrak-ulang" -H "x-admin-token: $T" -H 'content-type: application/json' \
          -d "{\"usang\":true,\"batas\":100,\"setelah\":\"$SETELAH\"}")
     echo "$R" | head -c 300; echo
     N=$(echo "$R" | sed -n 's/.*"diantrekan":\([0-9]*\).*/\1/p'); [ "${N:-0}" = 0 ] && break
     SETELAH=$(echo "$R" | sed -n 's/.*"terakhir":"\([^"]*\)".*/\1/p'); sleep 10
   done
   unset T
   ```
3. Pantau: `usang_tersisa` pada jawaban menyusut seiring antrean dikerjakan; di D1:

   ```sql
   SELECT versi_parser, vonis, COUNT(*) FROM ekstraksi_log GROUP BY 1, 2;
   SELECT jenis_objek, COUNT(*) FROM daftar_hapus GROUP BY 1;   -- vektor dan arsip lama yang menunggu dibersihkan (02:00 WIB)
   SELECT COUNT(*) FROM penjelasan;
   ```

Biayanya: tanpa konversi PDF dan tanpa unduhan BPK; tiap peraturan membaca satu objek R2, menulis ulang pasalnya (bila
berubah), dan mengantrekan pengindeksan vektor (embedding Workers AI untuk pasal yang berubah). Ringkasan AI tidak disusun
ulang untuk naskah yang sama. Pesan yang gagal diulang antrean; peraturan yang gagal tetap berversi lama dan muncul lagi pada
putaran berikutnya. Hasil ekstraksi `gagal` tidak ditawarkan (tak ada arsip teks untuk diurai).

Angka produksi sebelum uraian ulang pertama (14 Okt 2026): 2.635 baris `ekstraksi_log` (bersih 1.892, tanpa_pasal 442,
ringan 251, berat 37, gagal 8); 701 peraturan menyimpan Penjelasan di batang tubuh; 442 `tanpa_pasal` ikut dicoba lagi dan
sebagian mungkin kini terurai.

## Pembacaan PDF pindaian oleh Gemini

Pertimbangan, data, biaya, dan risikonya ada di [analisis-gemini.md](analisis-gemini.md); yang di bawah ini cara kerja pipeline-nya.

**Mengapa.** `toMarkdown` hanya membaca lapisan teks PDF, dan pindaian ber-OCR kerap kehilangan atau menempelkan pasalnya.
(Angka di bawah dihitung dengan pengukur lama; yang baru menambah peraturan `berat` yang kehilangan pasal, lihat
`nilaiKualitasEkstraksi`.) Pada 14 Okt 2026, 487 dari 2.630 peraturan yang dipanen (442
`tanpa_pasal`, 37 `berat`, 8 `gagal`) tak punya pasal yang layak: 42 pindaian modern yang nyaris tanpa lapisan teks, 37 yang
lapisan teksnya rusak, dan 402 ketikan lama (1946-1979) yang bentuknya tak dikenali pengurai (sebagian pulih lewat mode
`usang`, 161 hampir tanpa teks). Gemini membaca halaman sebagai gambar.

**Alur** (`lib/gemini.ts`, `ekstrakPdf` dengan `pembaca: "gemini"`):

1. `POST /api/impor/ekstrak-ulang {"gemini":true}` mengantrekan pesan `ekstrak_pdf` dengan `pembaca: "gemini"` untuk peraturan ber-PDF
   yang vonis ekstraksinya `tanpa_pasal`, `berat`, atau `gagal`, yang belum pernah dicoba (tabel `pembacaan_ai`), menurut urutan
   alamat. Tanpa secret `GEMINI_API` menjawab 503; bila anggaran token hari ini habis, tak ada yang diantrekan.
2. Konsumer membaca PDF (sebaris, base64, hingga 14 MB) dengan petunjuk transkripsi setia. PDF yang lebih panjang dari
   `GEMINI_HALAMAN` (bawaan 4) dipecah per halaman dengan pdf-lib (`lib/pdfBagi.ts`) dan dibaca per potongan, `GEMINI_PARALEL`
   (bawaan 3) sekaligus; PDF yang lebih panjang dari `GEMINI_HALAMAN_MAKS` (bawaan 120 halaman) ditolak `terlalu_panjang` sebelum
   Gemini dipanggil (Cipta Kerja, 1.000+ halaman, akan menghabiskan ±1,7 juta token dan menahan antrean otomatis berjam-jam; naikkan
   batasnya bila memang ingin membacanya); PDF pendek, atau yang tak bisa dipecah (terenkripsi, rusak; paling banyak 30 halaman,
   selain itu ditolak `terlalu_panjang`), dibaca dalam satu panggilan, dan jawaban yang terpotong batas panjang dilanjutkan dari halaman terakhir yang
   utuh (maks 6 putaran). Satu potongan yang lewat batas waktu (3 menit), terpotong, atau penandanya tak sebanyak halamannya dipecah
   dua, sampai satu halaman. Potongan yang selesai disimpan di R2 `teks-ai-bagian/<alamat>/<ukuran PDF>/<m>-<n>.md` dan dimuat
   kembali bila pesan diulang (kuota, atau tenggat 7 menit per pesan yang melepas galat sementara `tertunda`); dibersihkan setelah
   pembacaan selesai atau gagal tetap. Penanda `=== HALAMAN n ===` (relatif per potongan, dinomori ulang menurut urutan) menjadi
   `### Page n`. `GEMINI_BERPIKIR` mengatur token berpikir (lihat analisis-gemini.md). Model yang penuh (503 "high demand") atau
   kuotanya habis (429) diulang tiga kali; bila `GEMINI_MODEL_CADANGAN` terpasang, model itu dicoba sekali (dua percobaan, tanpa
   pengaturan berpikir) dan hasilnya bertanda `cadangan`; selebihnya galat sementara (antrean mengembalikan pesan dengan jeda tanpa
   mencatat `gagal`; skrip konsol menunggu dan mengulang sendiri).
3. **Pagar** (`periksaTranskripsi`, `putuskanPenerimaanAi`): jawaban selesai normal; halaman berurutan dari 1 dan sebanding dengan
   jumlah halaman PDF; tak ada pengulangan berturut-turut; `[tidak terbaca]` tak lebih dari 1,5% kata; judul cocok dengan
   peraturan yang dituju; pengurai menemukan pasal; mutu bukan `berat` (termasuk kehilangan seperempat nomor pasalnya); dan pasal
   yang tersimpan tak berkurang: **nomor tersimpan yang tak ada pada bacaan baru** (`nomorLamaHilang`: menurut bilangan, pencilan
   dan nomor non-angka dibuang, Pasal 1 selalu dihitung) paling banyak 5%. Memakai himpunan, bukan jumlah nomor berbeda, karena
   baris tersimpan dari pengurai lama memuat Penjelasan sebagai pasal dan nomor sampah ("2O", "I") yang menggelembungkan
   jumlah, dan bacaan Gemini yang lengkap akan tampak "kurang" lalu ditolak.
4. Lolos: teks diarsipkan di `teks-ai/<uri>.md` lalu dipromosikan ke `teks/<uri>.md` (teks bawaan yang tertimpa disimpan sekali di
   `teks-bawaan/<uri>.md`); pasal, Penjelasan, log ekstraksi (catatan
   "dibaca Gemini (versi model)") ditulis seperti biasa; indeks vektor dan ringkasan diantrekan; `pembacaan_ai.hasil = 'dipakai'`.
   Tidak lolos: tidak ada pasal atau log ekstraksi yang berubah; teks tetap diarsipkan di `teks-ai/` dan sebabnya dicatat
   (`ditolak`, `dipertahankan`, `gagal`).
5. Antarmuka memberi catatan pada peraturan yang pasalnya `dipakai` dari bacaan AI (`pembaca_ai` di `GET /api/laws/detail`). Bila
   konversi PDF yang baru kelak menggantikan pasalnya, catatan berubah menjadi `digantikan` dan hilang.

**Uji kering dulu.** `POST /api/impor/gemini-uji {"uri":"..."}` menjalankan langkah 2-3 untuk satu peraturan dan melaporkan:
`masalah`, `hasil` (pasal, vonis, celah), `tersimpan` (pasal dan vonis sekarang), `keputusan`, `kesesuaian_dengan_teks_lama` (bagian
rangkaian tiga kata yang sama di kedua bacaan), `token`, `durasi_ms`, dan cuplikan. Tak ada pasal yang ditulis.

**Tidak membayar dua kali.** Peraturan yang sudah pernah dicoba (selain `uji`) dilewati saat memilih daftar kerja dan saat konsumer
menerima pesannya, kecuali `ulangi: true` atau `uri`; pesan ganda tidak membaca PDF yang sama lagi.

**Anggaran dan kegagalan.** Token (masuk + keluar) dihitung per hari UTC di KV (`gemini:token:YYYY-MM-DD`) dan dibatasi
`GEMINI_BATAS_HARIAN` (bawaan 5.000.000), termasuk pembacaan yang gagal. 429 dan 5xx membuat pesan diulang antrean dengan jeda
`Retry-After`; PDF ditolak, jawaban diblokir (`RECITATION`, `SAFETY`) atau terlalu besar dicatat `gagal` dan tidak diulang; kunci
atau model yang salah dilepas tanpa menandai dokumen (tetap layak dicoba setelah diperbaiki). Satu pemanggilan konsumer dibatasi 15
menit, jadi pesan Gemini yang tersisa dalam satu batch ditunda (dikirim ulang) setelah 4 menit.

**Otomatis di Cloudflare** (`lib/geminiOtomatis.ts`, Cron `*/15 * * * *`). Alurnya: panen BPK mengunggah PDF ke R2 dan konversi bawaan
langsung menghasilkan teks sementara; Cron ini lalu membaca ulang SEMUA PDF dengan Gemini dan menggantikan teks sementara itu bila hasilnya
lolos pagar. Mati kecuali variabel `GEMINI_OTOMATIS` dipasang: `uji` (percobaan kering atas peraturan yang teksnya bermasalah, yaitu
vonis `tanpa_pasal`, `berat`, `gagal`; hasilnya hanya di `pembacaan_ai` dan `teks-ai/`; berhenti sendiri setelah
`GEMINI_OTOMATIS_UJI_MAKS` percobaan, bawaan 8) atau `ya` (membaca sungguhan, semua vonis). Tiap putaran mengantrekan paling banyak
`GEMINI_OTOMATIS_BATAS` (bawaan 2 pada `uji`, 5 pada `ya`, maks 20) peraturan ber-PDF yang belum pernah dibaca Gemini sungguhan
(`GEMINI_OTOMATIS_VONIS` mempersempit). Percobaan kering mengambil contoh menurut prioritas panen (UU dan PP terbaru lebih dulu);
pembacaan sungguhan mendahulukan teks yang paling rusak (`tanpa_pasal`, `gagal`, `berat`, `ringan`, `bersih`), lalu prioritas yang sama.
PDF yang sudah di R2 tetapi belum punya baris `ekstraksi_log` dihitung `tanpa_pasal`. Konversi bawaan melewati peraturan yang sudah punya
bacaan Gemini yang dipakai, jadi teks hasil Gemini tak pernah turun lagi ke hasil OCR. Putaran berikutnya menunggu semua pesan putaran
sebelumnya tercatat di `pembacaan_ai`, atau 45 menit (keadaannya di KV `gemini:otomatis:putaran`), supaya antrean tak menumpuk; pesan
yang tak sempat dikerjakan dalam satu giliran konsumer ditunda dengan dikirim ulang (bukan `retry()`), sehingga tak menghabiskan
`max_retries`. Pagar biayanya sama: anggaran token harian, satu peraturan satu pembacaan. Pesan dari Cron membawa `otomatis: true` (dan
`uji: true` pada mode uji, yang dikerjakan `ujiGemini`; kolom `catatan` percobaan memuat keputusan, rangkaian pasal, dan kesesuaian dengan
teks lama, cukup untuk menilai dari D1). `GET /api/impor/ringkasan` memuat blok `gemini.otomatis`, `gemini.calon_belum_dicoba` (teks
rusak) dan `gemini.belum_dibaca` (semuanya, per vonis); skrip konsol mencetak ringkasan itu di awal setiap jalan.

Memeriksa hasil di D1:

```sql
SELECT hasil, COUNT(*) AS n, SUM(token_masuk + token_keluar + token_pikir) AS token FROM pembacaan_ai GROUP BY hasil;
SELECT frbr_uri, vonis_baru, pasal_baru, catatan FROM pembacaan_ai WHERE hasil = 'uji' ORDER BY dicoba_at DESC;
SELECT frbr_uri, hasil, catatan FROM pembacaan_ai WHERE hasil IN ('ditolak','gagal','dipertahankan') ORDER BY dicoba_at DESC LIMIT 50;
```

## Mengendalikan pipeline

Semua lewat `/api/impor/*` dengan header `x-admin-token` (tabel di bagian Panen BPK). Tambahan:

| Permintaan | Efek |
|---|---|
| `POST /api/impor/ringkas` `{"batas":100}` | antrekan ringkasan AI untuk peraturan yang sudah berteks tetapi belum beringkasan (terbaru dulu, 1-500) |
| `POST /api/impor/ekstrak-ulang` `{"dariTeks":true,"batas":100}` | uraikan ulang arsip teks yang belum berpasal (tanpa Workers AI) |
| `POST /api/impor/ekstrak-ulang` `{"usang":true,"batas":100,"setelah":"<uri>"}` | uraikan ulang peraturan yang diurai dengan versi pengurai lama, per 100 dengan kursor `terakhir`; 503 bila migrasi 0007 belum diterapkan |
| `POST /api/impor/ekstrak-ulang` `{"gemini":true,"batas":3}` | Gemini membaca PDF peraturan yang teksnya tak layak (`vonis` untuk menyaring, `ulangi` untuk mencoba lagi, `uri` untuk satu peraturan); 503 bila `GEMINI_API` belum dipasang atau migrasi 0008 belum diterapkan |
| `POST /api/admin/sync` | **dihentikan**: menjawab 410 dan menunjuk endpoint di atas |

## Memeriksa produksi

D1 (dashboard > D1 > `lexa-db` > Console, atau `npx wrangler d1 execute lexa-db --remote --command "..."`):

```sql
-- Kelengkapan per jenis (sama dengan panel /status)
SELECT jenis, COUNT(*) AS total, SUM(bpk_id IS NOT NULL AND bpk_id <> '') AS bertaut_bpk, SUM(r2_pdf_key IS NOT NULL) AS ber_pdf,
       SUM(jumlah_pasal > 0) AS berpasal, SUM(jumlah_pasal = 0 AND r2_pdf_key IS NULL) AS perlu_pdf,
       SUM(jumlah_pasal > 0 AND r2_text_key LIKE '%.md') AS teks_bpk,
       SUM(jumlah_pasal > 0 AND (r2_text_key IS NULL OR r2_text_key NOT LIKE '%.md')) AS teks_lama
  FROM laws GROUP BY jenis;
-- Kejadian terakhir (impor, ekstraksi, ringkasan, pemeliharaan)
SELECT job, status, detail, created_at FROM sync_log ORDER BY id DESC LIMIT 20;
-- Pemeliharaan harian terakhir berjalan
SELECT value FROM sync_state WHERE key = 'denyut:0 19 * * *';
-- Sisa pembersihan R2 dan Vectorize
SELECT jenis_objek, COUNT(*) FROM daftar_hapus GROUP BY 1;
```

## Sumber lama yang dihentikan

Sampai 11 Oktober 2026 katalog peraturan dan sebagian besar teks pasal datang dari API pasal.id (Worker menyapu daftar
`/laws` dan mengambil detailnya lewat Cron per menit dengan cadangan rantai antrean). Pada 11 Oktober 2026 diagnosis
produksi menemukan bahwa setiap `GET /laws/<uri>` dijawab 200 hanya dengan
`{ work, content: "not_available_via_api", content_note }` (catatan pasal.id: "Pasal.id's API provides discovery metadata
only. Read the text at the linked pasal.id page, or connect an AI assistant via MCP"), tanpa `articles`, untuk peraturan
terverifikasi maupun tidak: kebijakan API mereka, bukan masalah token atau kuota Lexa. Ketentuan pasal.id juga melarang
mendistribusikan ulang basis data terstruktur dan menyalin halaman webnya secara massal.

Atas keputusan pemilik (14 Oktober 2026) Lexa **berhenti memakai pasal.id sepenuhnya**: klien API, sapuan katalog,
pengambilan isi, diagnosis, pemeriksaan akses, Cron per menit, rantai tik cadangan, variabel `PASAL_API_BASE`, `TIK_CADANGAN`,
dan secret `PASAL_API_TOKEN` dihapus dari kode dan konfigurasi; `POST /api/admin/sync` menjawab 410; tautan "Sumber data"
ke halaman pasal.id tidak disajikan lagi (204 baris produksi masih menyimpannya); peraturan baru hanya tercatat lewat
penjelajahan BPK.

Yang **tidak** diubah: data yang sudah tersimpan. Baris `laws` dan `articles` yang berasal dari sumber lama tetap ada
(kolom `isi_*` dibiarkan di skema) dan dipakai sampai naskah BPK-nya dipanen dan terbaca utuh, saat itu ia digantikan.
Penggantian dijaga: hasil PDF yang jelas lebih buruk dari teks yang tersimpan tidak menggantikannya. Panel kelengkapan di
`/status` menghitung "teks lama" yang tersisa. Arsip respons mentah sumber lama di R2 (`mentah/…`) tidak dipakai lagi; kosong
untuk peraturan dalam cakupan pada 14 Okt 2026.

## Tindakan produksi 11 Okt 2026

Atas permintaan pemilik (cakupan UUD, Tap MPR, UU, Perppu, PP; data di luar cakupan dihapus):

- Migrasi 0005 dan 0006 diterapkan dan tercatat di `d1_migrations`.
- 2.131 peraturan di luar cakupan (PERPRES, POJK, PERMEN, dll.) dan 15.457 baris pasalnya dihapus dari D1 beserta
  relasinya. Objek yatim dicatat di `daftar_hapus` (6.393 berkas R2 dan 21.128 vektor) dan dikosongkan bertahap.

## Ekstraksi pasal: yang diketahui dan yang belum

Diukur pada produksi 14 Okt 2026 (hasil pengurai sebelum `VERSI_PARSER` 1): 19.000 dari 90.317 baris pasal (1.666 peraturan) memuat
penanda halaman; 8.699 memuat kepala "PRESIDEN REPUBLIK INDONESIA"; 701 peraturan menyimpan Penjelasan di pasal terakhir atau
sebagai pasal kembar `~2`; hampir semua menyimpan pengesahan di pasal terakhir. Itu dijawab oleh `bersihkanHalaman`, batas
Penjelasan yang menempel, tabel `penjelasan`, dan penutup di atas, dan data lama diperbaiki lewat uraian ulang `usang`.
Yang tetap tidak bisa diperbaiki pengurai: pindaian dengan kata menempel dan salah baca OCR ("denganpotensidan kekayaan alam",
"UU 10/2020" dengan "FRESIDENREFUELIK"); Penjelasannya tetap dicoba diurai, tetapi hasilnya sebaik teks sumbernya, dan PDF
asli di tab PDF adalah pembandingnya.

Teks yang berasal dari sumber lama banyak yang tersimpan sebagian (pola: pasal yang punya ayat lenyap; UU 17/2023 hanya 59 dari
458 pasal, UU 27/2009 hanya Pasal 1 dan 400-408, KUHAP 39 dari 286). Halaman baca memberi tahu pembaca bila penomoran pasal
bercelah ("Teks peraturan ini tampaknya belum lengkap", `celahNomorPasal` di `public/js/format.js`), dan
`GET /api/impor/butuh-teks?celah=1` menyertakan peraturan seperti itu dalam daftar panen BPK. Ukuran pada 11 Okt 2026: 2.190
dari 3.456 peraturan berteks bernomor pasal bercelah (UU perubahan mengutip nomor peraturan lain sehingga sebagian wajar).
PDF hasil pindaian menghasilkan `tanpa_pasal`; teks konversinya tetap diarsipkan dan bisa diperiksa lewat
`GET /api/dokumen/teks?uri=`.
