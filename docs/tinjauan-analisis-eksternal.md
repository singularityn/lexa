# Tinjauan atas "Analisis Source Code dan Rekomendasi Pengembangan Lexa"

Dokumen ini menimbang tiap klaim laporan analisis eksternal yang diserahkan pemilik pada 14 Oktober 2026 (berkas
`Analisis_Source_Code_dan_Rekomendasi_Pengembangan_Lexa.md`) terhadap **kode di repositori ini dan data produksi**, bukan
terhadap kesan pertama. Ukuran data diambil dari D1 `lexa-db` secara baca-saja pada hari yang sama. Untuk tiap temuan ada
putusan, buktinya, dan tindakannya; yang tidak dikerjakan disebut berikut alasannya.

Laporan itu menganalisis salinan kode sebelum 14 Oktober 2026. Modul yang disebutnya (`pasal.ts`, `isi.ts`, `tik.ts`,
`diagnosa.ts`, `cadangan.ts`) memang ada saat itu, tetapi `pasal.ts` adalah **klien API pasal.id**, bukan pengurai pasal
(pengurainya `uraikanPasal` di `lib/bpk.ts`), dan hampir semua modul sumber lama itu sudah dihapus pada hari yang sama
(Lexa berhenti memakai pasal.id; lihat [pipeline-data.md](pipeline-data.md#sumber-lama-yang-dihentikan)).

## Ringkasan putusan

| # | Klaim laporan | Putusan | Tindakan |
|---|---|---|---|
| 3.1 | Arsip respons mentah dan teks penuh disimpan di D1; batas 10 GB akan cepat habis | **Keliru** | tidak ada; D1 ±108 MB (±1% dari 10 GB), arsip di R2 sejak awal |
| 3.2a | Pasal sisipan (`23A`) dan Romawi (`Pasal I`) tak tertangani | **Sudah ada** | tidak ada; sudah ditangani dan dijaga tes |
| 3.2b | Kepala/kaki halaman PDF bocor ke tengah kalimat | **Terbukti, diukur** | **dikerjakan**: pembersih halaman (`lib/halaman.ts`) |
| 3.2c | Penjelasan "Pasal demi pasal" terbaca sebagai pasal kembar | **Terbukti, lebih besar dari dugaan** | **dikerjakan**: batas Penjelasan dan tabel `penjelasan` |
| 3.2d | Penguraian dua tahap: Pembukaan, Batang Tubuh, Penutup, Penjelasan | **Sebagian** | **dikerjakan** untuk Penutup dan Penjelasan; Pembukaan tak disimpan (belum perlu) |
| 3.3 | `antrean_isi` di D1 sebagai antrean pekerjaan berisiko `SQLITE_BUSY` dan batas subrequest | **Keliru** | tidak ada; antrean sudah Cloudflare Queues, dan mekanisme yang dikritik sudah dihapus |
| 3.4 | Waterfall modul ES pada kunjungan pertama; bundling `esbuild` memangkas FCP 40-60% | **Sebagian** | **dikerjakan**: `modulepreload` 16 modul inti; bundling **ditunda** |
| 3.5 | `content-visibility: auto` pada kartu pasal | **Sudah ada** | tidak ada |
| 3.6a | Pembatas laju `/api/tanya` memakai memori isolate atau D1 (`tik.ts`) | **Premis keliru** | tidak ada; pembatasnya penghitung KV per IP |
| 3.6b | Pakai binding Rate Limiting asli | **Benar, bernilai kecil** | **ditunda** |
| 3.6c | Perketat CSP dan batasi skrip eksternal | **Sudah ada** | tidak ada; `script-src 'self'`, tanpa skrip eksternal |
| 4.1 | Peta silsilah dan status peraturan | **Sebagian ada** | ditunda (lini masa dan pelaksana) |
| 4.2 | Sandingan perubahan (redline) dan teks konsolidasi | **Belum ada** | **ditunda** |
| 4.3 | Tanya Lexa multi-putaran, pratinjau sitasi | **Sebagian ada** | ditunda (pencarian hibrida dan kutipan sudah ada) |
| 4.4 | Penjelasan sebagai akordeon di bawah pasal, lencana "Cukup jelas" | **Dikerjakan** | `penjelasan` di bawah pasal dan Penjelasan Umum |
| 4.5 | Anotasi, sorotan, folder riset | **Sebagian ada** | ditunda |
| 4.6 | Salin kutipan, tautan dalam per pasal, gambar OG dinamis | **Sebagian ada** | **dikerjakan**: "Salin kutipan lengkap"; OG dinamis ditunda |

## Temuan yang terbukti

### Kepala, kaki, dan penanda halaman (3.2b)

Konversi PDF (Workers AI `toMarkdown`) menyisipkan penanda `### Page N` di tiap batas halaman dan membiarkan kepala serta
kaki cetak menjadi teks biasa. Diukur pada `articles` produksi:

- **19.000 dari 90.317** baris pasal (1.666 peraturan) memuat penanda halaman;
- **8.699** baris memuat kepala "PRESIDEN REPUBLIK INDONESIA", paling sering menempel pada kata berikutnya
  (`REPUBLIK INDONESIA- 20 -BAB V`, `PRESIDENREPUBLIK INDONESIA-20-(3) Dalam`);
- kaki Lembaran Negara `SK No 004269 A`, situs `www.peraturan.go.id`, dan **catchword** (kata pertama halaman berikutnya
  diulang di ujung halaman ini: `Pemantau . . .`, `Huruf d`, `Ayat(2)...`).

Laporan menyarankan penyaring baris berulang berbasis frekuensi. Itu saja tidak cukup: sebagian besar artefak **menempel**
pada teks dan tidak berdiri di barisnya sendiri. Pembersih (`lib/halaman.ts`, 45 tes yang memakai cuplikan naskah
produksi) bekerja per halaman dan hanya menyentuh tepi halaman atau bentuk yang khas:

- penanda halaman dibuang;
- kepala yang berakhir pada nomor halaman cetak (`- 20 -`) dibuang, tahan terhadap salah baca OCR
  (`PRESTOENR,EPUBLIK INDONESIA-3-`) dan penomoran yang berganti di Penjelasan;
- kepala tanpa nomor yang menempel pada judul (`PRESIDEN⏎REPUBLIK INDONESIAPENJELASAN`) dibuang;
- kaki tetap dibuang, juga yang menempel pada kata terakhir halaman;
- catchword dibuang hanya bila halaman berikutnya memang diawali kata yang sama (titik-titiknya boleh hilang dibaca OCR,
  spasinya boleh berbeda); bila penanda halaman tak terletak di antaranya ("1996.Agar…Agar setiap orang", UU 8/1995), titik-titik
  yang langsung disusul pengulangan persis (paling banyak lima kata) dibuang di mana pun letaknya;
- baris yang sama di tepi sedikitnya 30% halaman dibuang (`DISTRIBUSI II`);
- bingkai tabel markdown (`| Pasal 1 |`) dibuka supaya judul dan catchword di dalam sel tetap terbaca.

Isi di tengah halaman tidak dihapus selain catchword yang langsung diulang itu, dan membersihkan teks yang sudah bersih tidak mengubahnya.

### Penjelasan yang tersimpan di tempat yang salah (3.2c)

Laporan benar bahwa Penjelasan bocor ke batang tubuh, tetapi ukurannya lebih besar dan mekanismenya lain. Judul
"PENJELASAN" pada halaman pertama Penjelasan tak punya nomor halaman, sehingga kepalanya menempel padanya
(`PRESIDEN⏎REPUBLIK INDONESIAPENJELASAN⏎ATAS⏎UNDANG-UNDANG ...`) dan **lolos dari batas penguraian**. Akibatnya di produksi:

- **701 peraturan** menyimpan seluruh Penjelasan di pasal terakhirnya (hingga 24.000 karakter; UU 7/1998 Pasal 3), atau sebagai
  pasal kembar berakhiran `~2` (PP 53/2010: 51 pasal batang tubuh, 121 baris sesudahnya, 22.675 karakter);
- teks itu ikut masuk ke indeks pencarian, vektor, dan kutipan, dan antarmuka harus menebak batasnya.

Perbaikannya ada di tiga lapis:

1. **Batas**: `RE_PENJELASAN` dan `pisahkanJudulMenempel` mengenali judul yang menempel pada kepala atau pada kata lain, juga
   `PENJELASANATASUNDANG-UNDANG` (pindaian). Pasal terakhir kini berhenti sebelum Penjelasan.
2. **Penyimpanan**: Penjelasan diurai terpisah (`lib/penjelasan.ts`, 31 tes) dan disimpan di tabel baru `penjelasan` (migrasi
   0007), bukan sebagai pasal. Pengurai memisahkan Penjelasan Umum dan penjelasan tiap pasal, memperluas rentang (`Pasal 4
   sampai dengan Pasal 6`), memecah bentuk pindaian yang menempel (`jelasPasal 4Ayat (1)Pada`, `KEPABEANANUMUM`), memisahkan
   label `Ayat (1)` / `Huruf a`, dan menimbang apakah baris "Pasal N" itu judul atau rujukan silang yang terpotong dari
   urutan nomornya.
3. **Tampilan**: lihat 4.4.

### Rumus penutup dan lampiran di pasal terakhir (3.2d)

Pemeriksaan data yang sama menemukan cacat yang tak disebut laporan: hampir setiap peraturan menyimpan **pengesahan** (rumus
"Agar setiap orang mengetahuinya, memerintahkan pengundangan ...", tanda tangan, pengundangan, nomor Lembaran Negara) dan
lampiran (naskah perjanjian yang disahkan, tabel) di pasal terakhirnya. Pengurai kini berhenti di rumus baku itu dan
mengabaikan sisanya sampai Penjelasan. Rumus dikenali hanya bila memuat "mengetahui" dan, dalam tiga baris berikutnya,
"memerintahkan pengundangan", jadi kalimat pasal yang kebetulan berawal "Agar setiap orang ..." tidak terpotong. Teks lengkap
tetap ada di arsip R2 dan PDF-nya. Pembukaan (Menimbang, Mengingat) tetap tidak disimpan: belum ada fitur yang memerlukannya.

### Waterfall modul ES (3.4)

Laporan benar bahwa kunjungan pertama menemukan modul tingkat demi tingkat: `index.html` hanya memra-muat `main.js`, sedangkan
`main.js` meng-import 16 modul statis lain (`router`, `state`, `dom`, `api`, `format`, enam komponen, ...). Tindakan:
**`modulepreload` untuk seluruh 16 modul itu**, sehingga peramban menemukannya sekaligus dari HTML. Tanpa langkah build,
tanpa berkas gabungan yang harus dijaga sama dengan daftar precache service worker. `test/pwa.test.ts` menjaga daftar
`modulepreload` sama dengan grafik import statis `main.js` (halaman yang dimuat malas tidak ikut).

**Bundling `esbuild` ditunda**: ia menambah rantai build, mempersulit daftar precache `sw.js`, dan angka "40-60%" di laporan
tidak berasal dari pengukuran. Layak dipertimbangkan lagi bila ukuran nyata (Lighthouse pada ponsel kelas bawah) menunjukkan
muat awal sebagai masalah. Catatan: aset statis divalidasi ulang pada tiap kunjungan (ETag, `max-age=0`) dan service worker
mendahulukan jaringan, jadi pra-muat paralel membantu kunjungan berikutnya juga, bukan hanya yang pertama.

## Klaim yang tidak berlaku

- **3.1 (D1 10 GB).** Arsip respons mentah (`mentah/<uri>.json.gz`, gzip), PDF (`pdf/…`), dan teks konversi (`teks/…md`) ada di
  **R2** sejak awal. Migrasi `0006_arsip_respons.sql` hanya menambah kolom penanda `isi_arsip` pada `laws`; tabel
  `arsip_respons` tidak pernah ada. D1 berisi metadata, teks per pasal, dan indeks FTS5: ±108 MB pada 14 Okt 2026.
- **3.2a (pasal sisipan, Romawi).** `RE_PASAL` menerima `Pasal 23A` (akhiran huruf tidak boleh diikuti huruf kecil, supaya
  `Pasal 1Dalam` tidak terbaca `1D`) dan `Pasal I`, `Pasal II` (supaya `Pasal Ini` tidak terbaca `I`); keduanya punya tes.
- **3.3 (antrean di D1).** Tidak ada tabel `antrean_isi`. Pekerjaan ekstraksi, pengindeksan, dan ringkasan berjalan lewat
  Cloudflare Queues (`lexa-ingest`) dengan percobaan ulang bawaan. Worker tidak pernah menghubungi BPK, jadi batas subrequest
  tidak relevan. Mekanisme yang memang mendekati gambaran laporan, pelacak isi per peraturan di `laws` dan Cron per menit
  untuk sumber lama (migrasi 0005), sudah dihapus pada 14 Okt 2026 bersama sumbernya.
- **3.5 (`content-visibility`).** Sudah ada: `.pasal { content-visibility: auto; contain-intrinsic-size: auto 120px }`
  di `public/css/app.css`; tes e2e merender peraturan sintetis 1.500 pasal. `IntersectionObserver` untuk "lazy-hydration"
  tak diperlukan: tombol aksi per pasal murah dan dibuat bersama pasalnya.
- **3.6a (pembatas laju).** `tik.ts` bukan pembatas laju; ia pemicu Cron sumber lama. Pembatas `/api/tanya` adalah penghitung
  KV per IP (20 permintaan per 5 menit): tidak memakai D1 maupun memori isolate. Kelemahannya nyata tetapi lain: KV konsisten
  akhirnya dan baca-ubah-tulisnya tidak atomik, jadi batas bisa terlampaui sedikit.
- **3.6c (CSP).** Sudah ketat: `default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none';
  frame-ancestors 'none'`. Login Google memakai pengalihan sisi server, tanpa skrip Google Identity Services.

## Fitur

| # | Fitur | Keadaan | Catatan |
|---|---|---|---|
| 4.4 | Penjelasan di bawah pasal | **Dikerjakan** | lipatan tertutup per pasal; "Penjelasan: cukup jelas" bila hanya itu; Penjelasan Umum di awal; ikut dicari |
| 4.6 | Salin kutipan | **Sebagian dikerjakan** | tautan dalam per pasal (`#pasal-82`) dan "Salin sitasi/tautan" sudah ada; kini ada **Salin kutipan lengkap** (`Pasal 156 Undang-Undang Nomor 13 Tahun 2003 tentang Ketenagakerjaan`, teks pasal, tautan) dan **Salin pasal beserta penjelasannya**. Nomor Lembaran Negara/Tambahan tidak tersimpan, jadi bentuk kutipan yang menyertakannya tidak dibuat |
| 4.6 | Gambar OG dinamis | Ditunda | pratinjau tautan per peraturan sudah ada (judul, deskripsi); gambarnya satu untuk semua. Menggambar per peraturan butuh rendering gambar di Worker |
| 4.1 | Silsilah dan status | Sebagian ada | tab Relasi dengan peta relasi dua arah; lini masa perubahan dan daftar peraturan pelaksana belum |
| 4.2 | Sandingan perubahan | Ditunda | butuh memetakan "Ketentuan Pasal N diubah ..." ke teks pasal lama; nilai tinggi, usaha besar; calon pekerjaan berikutnya |
| 4.3 | Tanya Lexa multi-putaran | Ditunda | pencarian hibrida (FTS5 + Vectorize `bge-m3` + RRF) dan jawaban yang wajib menyebut pasal sudah ada |
| 4.5 | Anotasi dan folder riset | Ditunda | koleksi dan catatan per pasal sudah ada; sorotan dan folder belum |

## Peta jalan laporan (bagian 5)

| Tahap | Butir | Keadaan |
|---|---|---|
| 1 | `content-visibility: auto` | sudah ada |
| 1 | Tautan dalam dan salin kutipan 1 klik | tautan sudah ada; kutipan lengkap ditambahkan |
| 1 | Penjelasan sebaris | dikerjakan |
| 1 | Bundling frontend | diganti `modulepreload` (lihat di atas) |
| 2 | Arsip ke R2 | sudah di R2 |
| 2 | Sanitasi halaman PDF dan pasal sisipan | sanitasi dikerjakan; pasal sisipan sudah ada |
| 2 | Rate limiting di tepi | ditunda |
| 3 | RAG semantik | pencarian semantik ada; multi-putaran ditunda |
| 3 | Visualisasi silsilah | sebagian ada |
| 3 | Redline dan anotasi | ditunda |

## Yang perlu dilakukan pemilik

Urutannya penting karena data lama tidak berubah sendiri:

1. **Terapkan migrasi 0007** sebelum perubahan ini dipakai penuh: `npm run d1:migrate:remote` (tabel `penjelasan` dan kolom
   `ekstraksi_log.versi_parser`). Kode menahan galatnya bila migrasi belum diterapkan, tetapi Penjelasan tidak tersimpan dan
   `ekstrak-ulang` mode `usang` menjawab 503 sampai itu.
2. **Uraikan ulang yang sudah terlanjur tersimpan** (sekali): tempel ulang `scripts/bpk-console-harvest.js` dengan
   `window.LEXA_PANEN = { usang: true }`, atau jalankan perintah di [pipeline-data.md](pipeline-data.md#memperbarui-pengurai-uraikan-ulang-yang-usang).
   Ini memperbaiki 701 peraturan yang menyimpan Penjelasan di batang tubuh, 19.000 baris yang bertanda halaman, dan pengesahan di
   pasal terakhir, tanpa mengunduh ulang apa pun dari BPK dan tanpa konversi PDF.
3. Lanjutkan panen seperti biasa. Setelah peraturan tanpa teks habis, `{ lama: true }` memanen naskah BPK untuk peraturan yang
   masih bertumpu pada teks lama.
