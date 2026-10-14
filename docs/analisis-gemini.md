# Analisis: Gemini untuk membaca dan merapikan teks pasal

Pertanyaan pemilik (14 Oktober 2026): apakah AI (kunci Gemini, tersimpan di Cloudflare sebagai `GEMINI_API`) bisa mengambil data
langsung dari PDF atau dari hasil ekstraksi BPK, lalu merapikan teks pasalnya, supaya ekstraksi lebih cepat dan akurat?

Dokumen ini menimbang ide itu terhadap **data produksi**, menyebut apa yang dibangun dan mengapa bentuknya begitu, dan jujur soal
apa yang belum bisa dibuktikan dari lingkungan pengembangan (tak ada panggilan Gemini yang dilakukan di sini: kuncinya hanya ada di
Worker). Cara menjalankannya ada di bagian [Cara memakai](#cara-memakai).

## Kesimpulan

1. **Layak, tetapi nilainya bukan di "merapikan semua teks".** Pengukur mutu Lexa menilai 72% peraturan yang sudah dipanen
   `bersih`; yang rusak bukan kerapiannya melainkan **ada-tidaknya teks**. Menulis ulang teks yang sudah baik dengan model bahasa
   menambah biaya dan, pada naskah hukum, risiko perubahan yang tak terlihat, tanpa memperbaiki apa pun.
2. **Yang terbukti perlu: membaca halaman sebagai gambar.** Dari 2.630 peraturan yang sudah dipanen, **487 (18%)** tidak punya
   pasal yang layak (442 `tanpa_pasal`, 37 `berat`, 8 `gagal`). Penyebabnya tiga.
   (a) **42 pindaian modern** (2010 ke atas): PDF ratusan KB tetapi lapisan teksnya nyaris kosong (rata-rata 1,6 ribu karakter),
   karena konversi bawaan (Workers AI `toMarkdown`) hanya membaca lapisan teks. Contoh nyata: **UU 24/2019 (Ekonomi Kreatif)** dan
   **UU 33/2014 (Jaminan Produk Halal)** kini tidak punya satu pasal pun di Lexa (927 dan 1.347 karakter dari PDF 191 dan 322 KB).
   (b) **37 `berat`** (33 dari 2020-an): lapisan teks ada (rata-rata 51 ribu karakter) tetapi rusak.
   (c) **402 ketikan lama (1946-1979)**: teks ada tetapi bentuknya tak dikenali pengurai. Sebagian pulih lewat uraian ulang `usang`
   (tanpa biaya); 161 di antaranya hampir tanpa teks (di bawah 1.500 karakter, termasuk 3 `gagal`) sehingga hanya bisa dibaca dari
   gambar. Pengurai yang sehebat apa pun tak bisa memulihkan teks yang tak ada atau rusak; Gemini membaca gambar halamannya.
3. **Dibangun: pembaca PDF cadangan yang opt-in dan berpagar**, bukan perapi teks. Gemini hanya menggantikan langkah "PDF menjadi
   teks"; pengurai, pengukur mutu, dan aturan penggantian yang sudah teruji tetap menjadi hakim. Hasil yang meragukan ditolak dan
   tak mengubah apa pun.
4. **Ditunda dengan sengaja: merapikan teks `ringan` (251 peraturan).** Layak dievaluasi sesudah ada hasil nyata dari tahap 3.
5. **Belum teruji terhadap Gemini sungguhan.** Kualitas baca pindaian berbahasa Indonesia, laju penolakan `RECITATION`, dan
   biaya sebenarnya baru diketahui setelah uji kering di bawah. Karena itu jalurnya dimulai dari uji kering yang tak menulis apa pun.

## Data produksi (14 Oktober 2026)

Cakupan: 7.177 peraturan (PP 5.011, UU 1.950, Perppu 170, Tap MPR 41, UUD 5). Sudah dipanen dan diekstrak: 2.630. Sisanya (±4.550)
belum dipanen; bila proporsinya sama, ±800 lagi akan butuh pembacaan gambar.

| Vonis ekstraksi | Peraturan | Rata-rata karakter | Arti |
|---|---:|---:|---|
| `bersih` | 1.892 | 23.689 | teks terbaca dan bermutu |
| `ringan` | 251 | 62.813 | terbaca, ada sedikit kerusakan (OCR, kata menempel) |
| `berat` | 37 | 51.271 | lapisan teks ada tetapi rusak |
| `tanpa_pasal` | 442 | 5.328 | teks terbaca, tak ada pasal terdeteksi |
| `gagal` | 8 | 0 | konversi gagal (4 di antaranya PDF 10 MB, tahun 1990-an) |

Sebaran yang bermasalah (`tanpa_pasal`, `berat`, `gagal`), menurut dasawarsa peraturan:

| Dasawarsa | Peraturan | Ciri |
|---|---:|---|
| 1940-an | 82 | PDF kecil (±48 KB), teks 6,7 KB rata-rata: ketikan lama yang polanya tak dikenali |
| 1950-an | 115 | idem (±46 KB); 2 di antaranya `gagal` |
| 1960-an | 169 | 105 di antaranya teks di bawah 1.500 karakter |
| 1970-an | 36 | 34 di bawah 1.500 karakter |
| 1980-an dan 1990-an | 6 | 5 `gagal` (4 PDF sebesar 10 MB, 1990-an) dan 1 `tanpa_pasal` |
| 2010-an | 45 | 41 **pindaian modern**: PDF 0,8 MB tetapi teks hanya 1,6 KB rata-rata; 4 `berat` |
| 2020-an | 34 | 33 `berat`: lapisan teks ada tetapi rusak (PDF 3,5 MB rata-rata) |

Tiga kelompok dengan nilai berbeda:

* **Pindaian modern (±42 peraturan, 2010-an dan 2020-an)** adalah yang paling terasa bagi pengguna: peraturan yang masih berlaku
  tampil tanpa pasal. Ditambah **37 `berat`** (33 dari 2020-an) yang berlapisan teks rusak.
* **Ketikan lama (402 peraturan, 1946-1979; 399 `tanpa_pasal` dan 3 `gagal`)** sebagian ditangani perbaikan pengurai (judul pasal
  gaya lama "Pasal 1." yang dulu dibuang sebagai catchword; menunggu uraian ulang `usang`, jadi berapa yang pulih baru diketahui
  sesudahnya). Sisanya, termasuk 161 yang teksnya di bawah 1.500 karakter, perlu dibaca ulang dari gambar. Nilainya terutama
  historis.
* **PDF besar yang gagal dikonversi (8)**, 4 di antaranya 10 MB: masih muat dikirim sebaris (batas 14 MB).

## Pilihan rancangan

| Opsi | Cara kerja | Risiko | Putusan |
|---|---|---|---|
| A. Gemini menulis ulang semua teks hasil ekstraksi | teks `bersih`, `ringan` dikirim, dikembalikan "rapi" | mengubah naskah hukum diam-diam (satu angka atau kata hilang tak terlihat); keluaran besar (±65 juta karakter = puluhan juta token keluaran, bagian termahal); tak memperbaiki yang rusak karena tak ada teks | **tidak** |
| B. Gemini hanya menandai struktur (batas pasal), teks tetap dari sumber | keluaran kecil; teks tak berubah | tak menolong PDF tanpa lapisan teks, yang justru masalah utama | tidak untuk kasus utama |
| **C. Gemini membaca PDF sebagai gambar untuk peraturan yang teksnya tak layak** | transkripsi setia → pengurai Lexa → pagar mutu → ganti bila lolos | salah baca pada pindaian buruk; ditahan pagar di bawah | **dibangun** |
| D. Gemini merapikan teks `ringan` | polesan lokal | sama dengan A, skala kecil (251) | ditunda sampai ada bukti dari C |

Alasan C membentuk seluruh rancangan: **Gemini diberi tugas yang paling sempit dan paling mudah diperiksa**: menyalin gambar
halaman menjadi teks, bukan menafsirkan atau memperbaiki. Hasilnya lalu diperlakukan seperti keluaran konversi lain.

## Apa yang dibangun

```
konsol (skrip panen)               Worker Lexa                                      Google
{ geminiCek / geminiUji / gemini } → /api/impor/gemini-cek, gemini-uji, ekstrak-ulang
                                     └ ekstrak-ulang { gemini } → antrean Cloudflare
                                                                  └ ekstrakPdf(pembaca: gemini)
                                                                      PDF dari R2 ──base64──→ generateContent
                                                                      ← teks + "=== HALAMAN n ===" (diubah menjadi "### Page n")
                                                                      → bersihkanHalaman → uraikanPasal → mutu → keputusan
```

* **Dua langkah, bukan satu.** `gemini-uji` = percobaan kering: membaca satu PDF, melaporkan apa yang AKAN terjadi, tidak menulis pasal.
  `ekstrak-ulang { gemini: true }` = pembacaan sungguhan di latar belakang lewat antrean.
* **Pagar sebelum teks dipakai** (`putuskanPenerimaanAi`, `periksaTranskripsi`):
  1. jawaban selesai normal (`STOP`); `RECITATION`, `SAFETY`, atau terpotong tak terselamatkan → tak dipakai;
  2. halaman berurutan dari 1 tanpa lompatan, dan tidak jauh lebih sedikit daripada jumlah halaman PDF;
  3. tidak ada baris panjang yang sama diulang berturut-turut (model yang terjebak);
  4. bagian `[tidak terbaca]` (diminta bila ragu, menggantikan tebakan) tidak lebih dari 1,5% kata;
  5. judul dalam teks cocok dengan peraturan yang dituju (PDF peraturan lain ditolak);
  6. pengurai menemukan pasal, dan mutu hasilnya (`nilaiKualitasEkstraksi`) bukan `berat`;
  7. tidak mengurangi nomor pasal yang sudah tersimpan (`putuskanPenggantian`).
  Yang gagal salah satunya **tidak mengubah apa pun** di pasal maupun log ekstraksi; hanya `pembacaan_ai` mencatat sebabnya.
* **Keterlacakan.** Teks Gemini selalu diarsipkan di R2 `teks-ai/<alamat>.md` untuk diperiksa; yang dipakai juga dipromosikan ke
  `teks/<alamat>.md` (uraian ulang `usang` membacanya), dan teks konversi bawaan yang tertimpa disimpan sekali di
  `teks-bawaan/<alamat>.md`, supaya bacaan AI yang kelak terbukti keliru bisa dipulihkan. Tabel `pembacaan_ai` (migrasi 0008) mencatat per peraturan: hasil, versi
  model yang menjawab, halaman, putaran, token, durasi, vonis dan pasal hasil bacaan. `ekstraksi_log.catatan` menyebut
  "dibaca Gemini (versi model)".
* **Transparansi untuk pembaca.** Peraturan yang pasalnya berasal dari bacaan AI menampilkan catatan di atas teks: "Teks dibaca
  otomatis dari PDF dengan AI ... bandingkan dengan PDF asli sebelum mengutipnya." Bila kelak konversi PDF yang lebih baik
  menggantikannya, catatan itu hilang sendiri (`digantikan`).
* **Kunci dan biaya.** Kunci hanya di secret `GEMINI_API`, dikirim lewat header `x-goog-api-key` (bukan URL), dan disamarkan dari
  setiap pesan galat dan log. Anggaran token per hari UTC (bawaan 5.000.000, `GEMINI_BATAS_HARIAN`) dihitung di KV, termasuk token
  pembacaan yang gagal; bila habis, tak ada yang diantrekan dan antrean melepas pesannya tanpa memanggil Google.
* **Tidak membayar dua kali.** Peraturan yang sudah pernah dicoba (selain percobaan kering) dilewati, baik saat memilih daftar kerja
  maupun saat konsumer menerima pesannya, kecuali diminta `ulangi: true` (atau `uri`): pesan yang diantrekan ganda atau diulang
  antrean tidak membaca PDF yang sama lagi.
* **Ketahanan.** Galat sementara (429, 5xx, jaringan) membuat pesan antrean diulang dengan jeda dari `Retry-After`; galat tetap
  (PDF ditolak, diblokir) dicatat `gagal` dan tak diulang; galat yang berlaku untuk semua dokumen (kunci, model) tak ditandai per
  dokumen, supaya semuanya tetap layak dicoba setelah diperbaiki. Keluaran yang terpotong batas panjang jawaban dilanjutkan dari
  halaman terakhir yang utuh (maksimal enam putaran). Satu pemanggilan konsumer dibatasi 15 menit oleh Cloudflare, jadi pesan Gemini
  yang tersisa dalam satu batch dikembalikan ke antrean setelah 8 menit.
* **Tanpa ketergantungan pada versi model.** Nama model adalah variabel (`GEMINI_MODEL`, bawaan alias `gemini-flash-latest`), dan
  tak ada parameter khusus versi yang dikirim (suhu, tingkat berpikir). Alasannya di bagian berikut.

## Pengujian

* Klien, pagar, dan anggaran: `test/gemini.test.ts` (51 tes, tanpa jaringan: `fetch` diganti jawaban palsu, jeda ulang diganti pencatat).
* Penyimpanan dan keputusan di atas SQLite sungguhan dengan Worker asli: `test/integration/gemini.test.ts` (55 tes): peraturan tanpa
  pasal, pasal tersimpan lebih utuh, halaman terlewat, PDF peraturan lain, tanpa kunci, anggaran habis, kuota, kunci salah, PDF
  ditolak, batas waktu konsumer, pesan ganda, teks bawaan yang tertimpa, uji kering, pengantrean massal, dan catatan di detail.
* Skrip dan antarmuka di Chromium dengan Gemini palsu: `e2e/gemini.test.mjs` (10 tes).
* Uji mutasi pada klien, pemeriksa, anggaran, penyimpanan, dan route: 164 perubahan kecil pada kode (batas, kondisi, nama header,
  urutan) disuntikkan satu per satu. Putaran pertama menyisakan 34 yang lolos; dari situ tes ditambah (batas anggaran tepat di
  angka, ambang `[tidak terbaca]`, status 408, jeda `Retry-After`, galat tak terduga yang tak boleh ditelan, dan lain-lain) dan satu
  kode mati dibuang. Akhirnya 161 terbunuh dan 3 setara fungsional (memotong di kemunculan pertama alih-alih terakhir bila keluaran
  Gemini sendiri sudah rusak karena penanda halaman ganda, satu mutan yang salah ketik, dan pembuangan BOM yang sudah dikerjakan
  `trim()`).
* Yang **tidak** teruji: Gemini sungguhan. Tak ada panggilan ke Google yang dilakukan dari lingkungan pengembangan.

## Fakta Gemini API: yang terverifikasi dan yang belum

Sumber: pencarian web pada 14 Oktober 2026. Halaman dokumentasi resmi Google tak terjangkau dari lingkungan pengembangan (DNS
diblokir), jadi yang di bawah berasal dari hasil pencarian dan blog pihak ketiga, **dan harus dicek ulang** di halaman Google.

| Hal | Yang diketahui | Konsekuensi di rancangan |
|---|---|---|
| Daftar model berganti cepat | alias `gemini-flash-latest` menunjuk Gemini 3.5 Flash sejak 19 Mei 2026 (catatan rilis), kini ada 3.6, 3.7, 3.8; 2.5 Flash-Lite dijadwalkan pensiun 16 Okt 2026; 3.7 Flash pensiun 28 Jan 2027 | model = variabel; versi yang menjawab dicatat per peraturan; tak ada bawaan yang bergantung pada satu versi |
| Parameter berpikir | pada seri 3, `thinking_budget` angka tak lagi didukung (diganti `thinking_level` dengan nilai yang berbeda per model; `MINIMAL` ditolak di 3.8 Flash) | tak mengirim `thinkingConfig`; menanggung token berpikir bawaan |
| Suhu | untuk seri 3 Google menganjurkan suhu bawaan (di bawah 1,0 dapat menimbulkan perulangan) | tak mengirim suhu |
| PDF | sebaris bila seluruh permintaan < 20 MB, selain itu File API; ±258 token per halaman (rata-rata; pindaian bisa jauh lebih); batas 1.000 halaman dan 50 MB (blog) | batas 14 MB sebaris (base64 +33%); File API ditunda; token pindaian diukur nyata |
| Keluaran terstruktur | `responseJsonSchema` (camelCase di REST) di seri 3 | tidak dipakai: keluaran teks biasa + pengurai Lexa, jadi tak ada kontrak skema yang bisa berubah |
| Harga | sumber saling bertentangan (Flash-Lite 2.5: $0,10/$0,40; 3.1 Flash-Lite: $0,25/$1,50; 2.5 Flash: $0,30/$2,50; 3 Flash: $0,50/$3,00; 3.5 Flash: $1,50/$9,00 per juta token masuk/keluar) | **tak dijadikan fakta**; perkiraan di bawah memakai tiga tingkat harga sebagai rentang |
| Tier gratis | batas laju kecil dan berbeda-beda menurut sumber; isi yang dikirim pada tier gratis dapat dipakai Google untuk memperbaiki produknya | peraturan adalah teks publik, tetapi untuk kuota yang layak gunakan akun berbayar |

## Perkiraan biaya

Rumus: `token masuk ≈ halaman × token per halaman` (258 untuk teks, ±800-1.100 untuk pindaian: belum terukur) dan `token keluar ≈
karakter / 3,5` ditambah token berpikir. Untuk 487 peraturan dengan anggapan rata-rata 20 halaman dan 20.000 karakter:
±7,8 juta token masuk dan ±2,9 juta token keluar.

| Tingkat harga (per juta token masuk / keluar) | Perkiraan total |
|---|---:|
| $0,25 / $1,50 (kelas Flash-Lite) | ±$6 |
| $0,50 / $3,00 (kelas Flash) | ±$13 |
| $1,50 / $9,00 (kelas Flash generasi terbaru) | ±$38 |

Angka ini selisihnya besar karena dua hal yang belum diketahui: jumlah halaman rata-rata, dan token berpikir. Yang pasti adalah
batasnya: anggaran harian menahan pemakaian di `GEMINI_BATAS_HARIAN` token per hari, apa pun yang terjadi. Menulis ulang seluruh
korpus (opsi A) akan puluhan kali lebih mahal, itu salah satu alasan tidak dipilih.

## Risiko dan penjagaannya

| Risiko | Penjagaan | Sisa risiko |
|---|---|---|
| Teks hukum berubah diam-diam (kata, angka, tanggal) | perintah salin setia + larangan menebak + `[tidak terbaca]`; pagar di atas; catatan "dibaca AI" di antarmuka; PDF asli tetap ada dan tombol "Lihat di PDF" per pasal; teks Gemini diarsipkan | **salah baca satu angka di dalam isi pasal tak bisa dideteksi otomatis.** Itulah sebabnya hasil diberi catatan dan uji kering membandingkan dengan lapisan teks lama bila ada |
| Gemini menolak naskah tertentu (`RECITATION` karena naskah dikenali, `SAFETY` untuk pidana atau narkotika) | kategori keamanan dilonggarkan (`BLOCK_NONE`); penolakan dicatat `gagal`, tidak diulang | laju penolakan belum diketahui; diukur pada uji kering |
| Biaya tak terkendali | anggaran harian, batas per putaran (maks 20), tunggu selesai sebelum mengantrekan lagi, 429 diulang dengan jeda | kecil |
| Model dipensiunkan atau diganti | variabel + alias + versi dicatat | bila alias berganti model, mutu bisa berubah tanpa pemberitahuan: pantau `pembacaan_ai.model` |
| Kunci bocor | secret, header, penyamaran galat; tak ada di D1, KV, R2, log | rotasi kunci bila curiga |
| Konsumer antrean terpotong waktu | batas giliran 8 menit untuk pesan Gemini; batas waktu 4 menit per pemanggilan, tak diulang di tempat | pesan yang terpotong diulang antrean (dan mengulang biaya satu dokumen) |
| PDF > 14 MB | ditolak dengan alasan jelas | 4 PDF 10 MB (1990-an) masih muat; File API menyusul bila ada yang lebih besar |
| Privasi dan hak | peraturan adalah teks publik (UU 28/2014 Pasal 42 mengecualikannya dari hak cipta) | pada tier gratis Google dapat memakai isi kiriman untuk produknya |

## Cara memakai

Prasyarat: secret `GEMINI_API` ada di Worker (Cloudflare > Workers > lexa > Settings > Variables and Secrets, **tipe Secret**;
`keep_vars` sudah aktif, tetapi variabel teks terlihat di dashboard). Migrasi 0008 (tabel `pembacaan_ai`) sudah diterapkan di
produksi. Variabel opsional: `GEMINI_MODEL`, `GEMINI_BATAS_HARIAN`, `GEMINI_BASE_URL` (untuk AI Gateway Cloudflare).

Di konsol peramban (tab situs BPK atau Lexa), setel opsi lalu tempel `scripts/bpk-console-harvest.js`:

0. **Uraikan ulang yang usang lebih dulu** (`window.LEXA_PANEN = { usang: true }`, sekali). Pengurai sudah diperbaiki sejak data
   produksi ini diekstrak: sebagian `tanpa_pasal` (ketikan 1946-1969 bergaya "Pasal 1.") pulih hanya dengan menguraikan ulang
   arsip teksnya, tanpa biaya. Jangan membayar Gemini untuk yang bisa diperbaiki secara deterministik; yang masih `tanpa_pasal`,
   `berat`, atau `gagal` sesudahnya barulah calonnya.
1. **Cek sambungan.** `window.LEXA_PANEN = { geminiCek: true }`. Hasil yang baik mencetak model, versi model, dan anggaran. Galat
   menyebut penyebabnya (kunci salah, model tak ada, kuota).
2. **Uji kering pada beberapa peraturan** (tak menulis pasal): `window.LEXA_PANEN = { geminiUji: ["/akn/id/act/uu/2019/24",
   "/akn/id/act/uu/2014/33", "/akn/id/act/pp/1961/3"] }`. Pilih sedikitnya satu pindaian modern, satu ketikan lama, dan satu `berat`.
   Tiap peraturan melaporkan keputusan, pasal terbaca dibanding tersimpan, mutu, halaman terbaca dari halaman PDF, token, dan
   kesesuaian dengan teks lama. Baca juga teksnya di R2 (`teks-ai/...`) dan bandingkan beberapa pasal dengan PDF-nya.
3. **Putuskan.** Layak dilanjutkan bila keputusan `dipakai`, `masalah` kosong, halaman lengkap, dan sampel pasal cocok dengan PDF.
   `kesesuaian_dengan_teks_lama` yang tinggi menandakan dua bacaan saling sepakat; yang rendah pada dokumen berlapisan teks rusak
   wajar, tetapi minta pemeriksaan manual.
4. **Baca sungguhan.** `window.LEXA_PANEN = { gemini: true, batas: 3 }`. Skrip mengantrekan kelompok kecil, menunggu Lexa
   menyelesaikannya, lalu lanjut sampai habis atau anggaran habis. `geminiVonis: "tanpa_pasal"` menyaring; `ulangi: true` mencoba
   lagi yang pernah dicoba.
5. **Pantau.** `GET /api/impor/ringkasan` memuat blok `gemini` (anggaran hari ini, hitungan hasil). Di D1:
   `SELECT hasil, COUNT(*) FROM pembacaan_ai GROUP BY hasil` dan, untuk yang ditolak, `SELECT frbr_uri, catatan FROM pembacaan_ai
   WHERE hasil IN ('ditolak','gagal')`.

Hentikan dan periksa bila: banyak `ditolak` dengan sebab yang sama (perintah perlu disesuaikan), banyak `gagal` bersebab
`RECITATION` (alihkan ke model lain atau potong per halaman), atau pasal hasil bacaan yang dicek manual ternyata keliru.

## Yang sengaja belum dibangun

* **Audit mutu `bersih`.** Pengukur menilai kerusakan karakter dan struktur; salah baca halus yang lolos darinya tak terlihat.
  `geminiUji` pada sekitar 20 peraturan `bersih` yang dipilih acak, dengan melihat `kesesuaian_dengan_teks_lama`, mengukur
  seberapa sering bacaan gambar dan lapisan teks berselisih: bukti yang diperlukan sebelum memutuskan apakah merapikan `ringan`
  atau `bersih` layak dibiayai.
* **Merapikan teks `ringan` dan `bersih`.** Pembersih halaman dan pengurai deterministik menangani artefak struktural dengan bukti
  data (lihat [tinjauan-analisis-eksternal.md](tinjauan-analisis-eksternal.md)); yang tersisa adalah salah baca OCR, yang hanya
  bisa diperbaiki dengan membaca gambar lagi (opsi C dengan `geminiVonis: "ringan"`), dan itu perlu bukti mutu dari tahap uji.
* **Files API** untuk PDF di atas 14 MB, dan **Batch API** (biaya lebih rendah, hasil sampai 24 jam) bila volumenya membesar.
* **Dua bacaan saling memeriksa per pasal** (lapisan teks vs gambar) dengan antrean tinjau manual untuk yang berselisih.
* **AI Gateway** Cloudflare di depan Gemini (log, cache, batas laju): cukup mengisi `GEMINI_BASE_URL`, tanpa perubahan kode.
