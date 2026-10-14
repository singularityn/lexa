# Analisis: Gemini untuk membaca dan merapikan teks pasal

Pertanyaan pemilik (14 Oktober 2026): apakah AI (kunci Gemini, tersimpan di Cloudflare sebagai `GEMINI_API`) bisa mengambil data
langsung dari PDF atau dari hasil ekstraksi BPK, lalu merapikan teks pasalnya, supaya ekstraksi lebih cepat dan akurat?

Dokumen ini menimbang ide itu terhadap **data produksi**, menyebut apa yang dibangun dan mengapa bentuknya begitu, dan jujur soal
apa yang belum bisa dibuktikan dari lingkungan pengembangan (tak ada panggilan Gemini yang dilakukan di sini: kuncinya hanya ada di
Worker). Cara menjalankannya ada di bagian [Cara memakai](#cara-memakai).

> **Koreksi (14 Oktober 2026, sore).** Versi pertama dokumen ini menyimpulkan bahwa "yang rusak bukan kerapiannya melainkan
> ada-tidaknya teks", berdasarkan vonis pengukur mutu: 72% peraturan `bersih`. Pemilik membantahnya dengan tangkapan layar UU 32/2014
> (Kelautan): pasalnya berantakan dan sebagian tak ada. Pemeriksaan D1 membenarkannya, dan **pengukur mutu itulah yang keliru**: ia
> hanya menghitung kerusakan karakter (angka tercemar huruf, simbol liar, sisa catchword) dan buta terhadap pasal yang hilang.
> Bagian [Kasus UU 32/2014](#kasus-uu-322014-kelautan) memuat buktinya; perbaikannya (pengukur menghitung pasal hilang dan pembukaan
> yang tertelan, pagar Gemini yang tak tertipu baris lama, dan Gemini otomatis di Cloudflare) dijelaskan di sana dan di
> [Cara memakai](#cara-memakai). Angka "bersih" di bawah adalah angka pengukur lama.

## Kesimpulan

1. **Layak, dan lebih luas daripada dugaan pertama.** Pengukur lama menilai 72% peraturan yang dipanen `bersih`, tetapi ia buta
   terhadap pasal yang hilang. Pada data sebelum uraian ulang (versi pengurai 0), dari 802 peraturan berpasal 10 atau lebih yang ia
   nilai `bersih`, **227 (28%) kehilangan seperempat nomor pasalnya atau lebih**. Pemilik lalu menjalankan `usang` (versi 3), yang
   memulihkan sebagian besar secara deterministik (UU 12/1967 dari 23 menjadi 58 dari 58 pasal), tetapi **sisanya tetap hilang**:
   dari 976 peraturan berpasal ≥ 10 yang masih `bersih`, 115 (11,8%) kehilangan seperempat nomornya atau lebih, 45 (4,6%) 10-25%,
   dan 80 tak punya Pasal 1 (simulasi pengukur versi 4 pada D1 produksi, 14 Oktober sore). Jadi yang rusak adalah **ada-tidaknya teks
   dan kelengkapan pasalnya**, bukan sekadar kerapiannya. Yang tak dipilih tetap sama: menyuruh model menulis ulang teks yang sudah
   lengkap menambah biaya dan, pada naskah hukum, risiko perubahan yang tak terlihat.
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

Vonis di bawah adalah vonis **pengukur lama** (versi pengurai 0-3). Pengukur versi 4 juga menghitung pasal yang hilang dan
pembukaan yang tertelan ke dalam pasal, jadi sebagian `bersih` dan `ringan` akan menjadi `berat` begitu diurai ulang (`usang`).

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
  6. pengurai menemukan pasal, dan mutu hasilnya (`nilaiKualitasEkstraksi`) bukan `berat`: sejak versi pengurai 4 itu juga berarti
     tidak kehilangan seperempat nomor pasalnya dan tidak memuat pembukaan di dalam pasal;
  7. tidak mengurangi pasal yang sudah tersimpan: nomor tersimpan yang tak ada pada bacaan baru (menurut bilangan, pencilan
     dibuang, Pasal 1 selalu dihitung) paling banyak 5% (`nomorLamaHilang`). Bukan jumlah nomor berbeda: baris tersimpan dari
     pengurai lama memuat Penjelasan sebagai pasal dan nomor sampah, yang menggelembungkan jumlah dan membuat bacaan yang lengkap
     ditolak (lihat kasus UU 32/2014).
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

## Kasus UU 32/2014 (Kelautan)

Tangkapan layar dari pemilik menampilkan "Pasal 20" yang isinya bermula `, Pasal 22D ayat (1), Pasal 25A, dan Pasal 33 ayat(3)
Undang-Undang Dasar Ncgara Republik Indonesia Tahun1945; MengingatDengan ... MEMUTUSI(AN:Menetapkan : UNDANG-UNDANG TENTANG
KELAUTAN.BAB IKETENTUAN UMUMpasal IDalam Undang-Undang ini yang dimaksud dengan:1. Laut adalah ...`. Keadaan di D1 produksi
(`/akn/id/act/uu/2014/32`):

* **Sebelum uraian ulang** (versi pengurai 0): 101 baris pasal, vonis `bersih`. Baris bernomor "2O" (3.690 karakter) memuat
  pembukaan sampai Pasal 1; baris "Cukup jelas." bernomor 3, 4, 5, ... (Penjelasan) tersisip di antara pasal; nomor rusak ("I",
  "7" untuk 71, "3" untuk 31, dua "30"); Pasal 73 menelan 12.177 karakter sisanya.
* **Sesudah uraian ulang `usang`** (versi 3, dijalankan pemilik pada 14 Oktober): 49 baris, 40 nomor berbeda (2 sampai 73), tanpa
  nomor bukan angka. Pembukaan dan Penjelasan sudah lepas dari pasal, **tetapi Pasal 1 dan 32 nomor lain tetap tak terbaca**
  (`celah_pasal` tercatat 33 dari `pasal_tertinggi` 73), dan vonisnya tetap `bersih`.

Gejala dan penyebabnya:

| Gejala | Bukti | Penyebab |
|---|---|---|
| pasal hilang | nomor yang ada: 2, 3, 4, 6, 7, 8, 9, 11, 12, 15, 16, 17, 19, 24, 26, 27, 30, 33, 36, ... 73; tak ada 1, 5, 10, 13, 14, 18, 20 sampai 23, ... | judul pasal rusak OCR ("pasai 66", "Pasal 7 1", "pasal I" menempel pada "UMUM") atau tak ada di lapisan teks, tak dikenali pengurai |
| kata menempel dan salah baca | `wilayahyurisdiksi`, `danberkelanjutan`, `Ncgara`, `larak` (jarak), `evaiuasi`, `kesatuangeogralis` | lapisan teks PDF kehilangan spasi di ujung baris; OCR |
| pembukaan masuk pasal (versi 0) | baris "2O" | "Pasal 20" di daftar Mengingat dibaca sebagai judul |

Yang gagal menangkapnya: **pengukur mutu**. Ia mencatat `celah_pasal` (33) tetapi tak memakainya, dan menilai hanya kerusakan karakter,
yang tak cukup untuk melewati ambang, jadi `bersih`. Itu yang membuat angka "72% bersih" menyesatkan, dan yang membuat Gemini tak pernah
menjadi calon bagi peraturan seperti ini. Survei D1, hanya peraturan dengan sedikitnya 10 nomor pasal. Sebelum `usang` (versi 0): dari 802 yang `bersih`, 227 kehilangan
seperempat nomornya atau lebih, 36 kehilangan 10-25%, dan 530 utuh. Sesudah `usang` versi 3 (pemilik, 14 Oktober sore): dari 976 yang
`bersih`, 115 dan 45; dari 72 `ringan`, 33 dan 15; dari 20 `berat`, 6 dan 2. Uraian ulang yang diperbaiki sudah memulihkan separuhnya
(mis. UU 12/1967: lengkap 58 dari 58, UU 3/1958 dan UU 6/1966 lengkap), jadi **sisanya adalah yang memang tak bisa dipulihkan dari lapisan
teks**: pasal yang tak ada di lapisan teks, atau judulnya rusak OCR.

Yang diperbaiki:

1. **Pengukur** (`nilaiKualitasEkstraksi`, versi pengurai 4): menghitung pasal yang hilang dari rangkaian 1..N (N = nomor tertinggi
   tanpa pencilan) dan pasal yang memuat pembukaan atau judul bab. Kehilangan ≥ 5 nomor dan ≥ 25% atau pembukaan tertelan: `berat`;
   ≥ 3 nomor dan ≥ 10%, atau Pasal 1 tak terbaca pada peraturan berpasal ≥ 10: `ringan`. Alasannya ditulis di
   `ekstraksi_log.catatan`. UU 32/2014 (40 dari 73 nomor, tanpa Pasal 1) kini `berat`. Uraian ulang `usang` menerapkannya ke seluruh
   peraturan tanpa biaya Gemini; yang menjadi `berat` otomatis menjadi calon.
2. **Pagar Gemini** membandingkan nomor, bukan jumlah nomor berbeda. Baris tersimpan dari pengurai lama (versi 0, sebelum `usang`)
   memuat Penjelasan sebagai pasal dan nomor sampah, yang menggelembungkan jumlahnya sehingga bacaan Gemini yang lengkap tampak
   "kurang" dan ditolak. Himpunan nomor tersimpan dan bacaan baru dibandingkan menurut bilangannya, pencilan pada yang tersimpan
   dibuang, dan paling banyak 5% nomor tersimpan boleh tak ada pada bacaan baru. Menulis tesnya menemukan kontradiksi kedua: aturan
   jumlah lama masih berjalan SESUDAH keputusan Gemini dan membatalkannya; kini jalur Gemini hanya tunduk pada keputusannya sendiri.
3. **Gemini otomatis di Cloudflare** (bagian berikut), supaya semua peraturan seperti ini dibaca tanpa konsol.

## Gemini otomatis di Cloudflare

Permintaan pemilik: bila ada cara agar Gemini berjalan sendiri di Cloudflare, itu pilihan yang bagus. Bentuknya Cron 15 menit
(`*/15 * * * *`, `lib/geminiOtomatis.ts`) yang memakai secret `GEMINI_API` milik Worker dan antrean yang sama dengan jalur manual.

* **Mati secara bawaan.** Tanpa variabel `GEMINI_OTOMATIS`, pemicunya kembali seketika: tak menyentuh D1, KV, maupun Google.
* **`GEMINI_OTOMATIS=uji`**: percobaan kering. Dua peraturan per putaran (`GEMINI_OTOMATIS_BATAS`) dibaca dan hasilnya hanya
  dicatat di `pembacaan_ai` (hasil `uji`, kolom `catatan` memuat keputusan, rangkaian pasal, pasal tersimpan yang hilang, dan
  kesesuaian dengan teks lama) dan di R2 `teks-ai/`. **Tak ada pasal yang ditulis.** Berhenti sendiri setelah 8 percobaan
  (`GEMINI_OTOMATIS_UJI_MAKS`), supaya biaya uji terbatas dan hasilnya sempat diperiksa.
* **`GEMINI_OTOMATIS=ya`**: membaca sungguhan; yang lolos pagar menggantikan pasal tersimpan.
* **Calon**: peraturan ber-PDF yang vonisnya `tanpa_pasal`, `berat`, atau `gagal` (`GEMINI_OTOMATIS_VONIS`), belum pernah dicoba,
  menurut prioritas panen (UU lalu PP, terbaru lebih dulu). Jalankan `usang` lebih dulu agar vonisnya jujur.
* **Tak menumpuk.** Putaran berikutnya menunggu semua peraturan putaran sebelumnya tercatat di `pembacaan_ai`, atau 45 menit berlalu.
* **Pagar biaya sama**: anggaran token harian, satu peraturan satu pembacaan, galat sementara diulang antrean.
* **Terlihat dari D1 saja**: `SELECT frbr_uri, vonis_baru, pasal_baru, catatan FROM pembacaan_ai WHERE hasil = 'uji'`. Itu juga yang
  memungkinkan hasilnya dinilai tanpa membuka R2 atau konsol.

## Pengukuran nyata pertama (14 Oktober 2026)

Pemilik menjalankan uji kering `geminiUji` atas **PP 3/1961** (satu dari empat contoh di langkah 2) lewat secret `GEMINI_API` milik
Worker pukul 12:06 UTC. Itu satu-satunya pembacaan nyata sampai sekarang; barisnya di `pembacaan_ai`:

| Ukuran | Nilai | Per halaman |
|---|---:|---:|
| model yang menjawab (alias `gemini-flash-latest`) | `gemini-3.8-flash` | |
| halaman terbaca / putaran | 9 / 1 | |
| token masuk | 5.304 | **589** |
| token keluar | 3.305 | 367 |
| token berpikir | **4.443** | 494 |
| total | 13.052 | **1.450** |
| durasi | **337,8 detik** | 37,5 detik |
| hasil | `akan dipakai`, vonis `bersih`, **25 nomor pasal** | |

Sebelumnya peraturan ini `tanpa_pasal` (549 karakter dari PDF). Jadi sambungan, kunci, model, dan alamat bawaan bekerja, dan satu
ketikan 1961 yang tak punya teks kini terbaca menjadi 25 pasal bernomor.

Yang diajarkannya, dan yang diubah:

1. **Satu panggilan untuk satu PDF tak muat untuk yang panjang.** 337,8 detik untuk 9 halaman (mungkin termasuk satu percobaan ulang
   atas 5xx, tetapi tak bisa dipastikan). UU 32/2014 punya ±50 halaman, dan satu pemanggilan konsumer antrean dibatasi 15 menit; batas
   waktu satu panggilan kami 4 menit. Dibangun: **pembacaan per potongan halaman** (`lib/pdfBagi.ts`, pdf-lib): PDF dipecah per 4 halaman
   (`GEMINI_HALAMAN`), dibaca tiga sekaligus (`GEMINI_PARALEL`), potongan yang lewat batas waktu 3 menit, terpotong batas panjang
   jawaban, atau penandanya tak cocok dipecah dua sampai satu halaman, potongan yang selesai disimpan di R2 (`teks-ai-bagian/`) supaya
   kuota atau tenggat tak membuat yang sudah dibayar dibaca ulang, dan satu pesan antrean berhenti memulai panggilan baru sesudah 7
   menit (galat sementara `tertunda`, dilanjutkan percobaan berikutnya). PDF terenkripsi atau rusak yang tak bisa dipecah dibaca
   utuh bila paling banyak 30 halaman, selain itu ditolak (`terlalu_panjang`) tanpa memanggil Gemini.
2. **Token berpikir lebih banyak daripada token keluaran** (4.443 dari 7.748 yang dihasilkan), padahal transkripsi tak butuh bernalar.
   Dibangun: variabel `GEMINI_BERPIKIR` (angka = `thinkingBudget`, kata = `thinkingLevel`), tanpa bawaan karena bentuknya berbeda per seri
   model. `geminiCek` mengirim pengaturan yang sama, jadi nilai yang ditolak model muncul sebagai galat 400 dengan pesan Google sebelum
   satu pun PDF dibaca. Mengecilkannya mestinya memangkas hampir separuh token yang dihasilkan; efek sebenarnya perlu diukur.
3. **Token masuk per halaman 589**, bukan 258 (teks) atau 800-1.100 (anggapan pindaian). Biayanya di bagian berikut diperbarui.
4. **Waktu 37 detik per halaman** (bila tak ada percobaan ulang di dalamnya) menentukan apakah calon selesai dalam hari atau minggu:
   dengan anggaran harian bawaan ±170 peraturan 20 halaman sehari, jadi ±420 calon selesai dalam tiga hari, dan waktunya terbatas
   kuota Google dan paralelnya (tiga potongan sekaligus), bukan Worker.

Belum diketahui dari satu sampel: apakah 25 pasal itu semuanya benar dan lengkap. Teksnya ada di R2 `teks-ai/akn/id/act/pp/1961/3.md`
(bandingkan beberapa pasal dengan PDF-nya), dan `kesesuaian_dengan_teks_lama` tak berguna untuk peraturan yang lapisan teksnya nyaris kosong.

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
| Parameter berpikir | pada seri 3, `thinking_budget` angka tak lagi didukung (diganti `thinking_level` dengan nilai yang berbeda per model; `MINIMAL` ditolak di 3.8 Flash) | tanpa bawaan; `GEMINI_BERPIKIR` mengirim `thinkingBudget` (angka) atau `thinkingLevel` (kata) bila diisi, dan `geminiCek` menguji nilainya. **Terukur: 4.443 token berpikir dari 7.748 yang dihasilkan** |
| Suhu | untuk seri 3 Google menganjurkan suhu bawaan (di bawah 1,0 dapat menimbulkan perulangan) | tak mengirim suhu |
| PDF | sebaris bila seluruh permintaan < 20 MB, selain itu File API; ±258 token per halaman (rata-rata; pindaian bisa jauh lebih); batas 1.000 halaman dan 50 MB (blog) | batas 14 MB sebaris (base64 +33%); File API ditunda. **Terukur: 589 token masuk per halaman pindaian** |
| Terverifikasi dari satu pembacaan nyata | kunci di header `x-goog-api-key`, alamat `generativelanguage.googleapis.com/v1beta`, alias `gemini-flash-latest` (dijawab `gemini-3.8-flash`), PDF sebaris, `systemInstruction`, dan `safetySettings` diterima; `usageMetadata` memuat token masuk, keluar, dan berpikir | tak ada yang perlu diubah di klien |
| Kecepatan | **337,8 detik untuk 9 halaman** (satu sampel, mungkin termasuk percobaan ulang) | PDF dipecah per 4 halaman dan dibaca paralel |
| Keluaran terstruktur | `responseJsonSchema` (camelCase di REST) di seri 3 | tidak dipakai: keluaran teks biasa + pengurai Lexa, jadi tak ada kontrak skema yang bisa berubah |
| Harga | sumber saling bertentangan (Flash-Lite 2.5: $0,10/$0,40; 3.1 Flash-Lite: $0,25/$1,50; 2.5 Flash: $0,30/$2,50; 3 Flash: $0,50/$3,00; 3.5 Flash: $1,50/$9,00 per juta token masuk/keluar) | **tak dijadikan fakta**; perkiraan di bawah memakai tiga tingkat harga sebagai rentang |
| Tier gratis | batas laju kecil dan berbeda-beda menurut sumber; isi yang dikirim pada tier gratis dapat dipakai Google untuk memperbaiki produknya | peraturan adalah teks publik, tetapi untuk kuota yang layak gunakan akun berbayar |

## Perkiraan biaya

Dasarnya kini satu pengukuran nyata (bagian di atas): **1.450 token per halaman** (589 masuk, 367 keluar, 494 berpikir). Harga model
yang menjawab (`gemini-3.8-flash`) tidak diketahui, jadi tiga tingkat harga dipakai sebagai rentang (sumber pencarian web saling
bertentangan, lihat bagian fakta). Biaya per halaman:

| Tingkat harga (per juta token masuk / keluar) | Per halaman | Per peraturan 20 halaman |
|---|---:|---:|
| $0,25 / $1,50 (kelas Flash-Lite) | $0,0014 | ±$0,03 |
| $0,50 / $3,00 (kelas Flash) | $0,0029 | ±$0,06 |
| $1,50 / $9,00 (kelas Flash generasi terbaru) | $0,0086 | ±$0,17 |

Keluaran dan berpikir ditagih sebagai keluaran, jadi berpikirlah yang mahal: bila `GEMINI_BERPIKIR` menghilangkan token berpikir, tingkat
terakhir menjadi ±$0,0042 per halaman (±$0,08 per peraturan 20 halaman). Jumlah calon yang pasti baru diketahui setelah uraian ulang
`usang` dengan pengukur versi 4 (`calon_belum_dicoba` di `/api/impor/ringkasan`). Simulasi pada D1 produksi (14 Oktober sore, sesudah
`usang` versi 3 oleh pemilik) memberi ±420 dari 2.630 (16%): 216 `tanpa_pasal` + 16 `gagal` + ±187 `berat` (35 lama, ±152 baru karena
pasal hilang). Sisa ±4.550 peraturan yang belum dipanen menambah ±730 bila proporsinya sama. Dengan anggapan 20 halaman rata-rata:

| Calon | $0,25 / $1,50 | $0,50 / $3,00 | $1,50 / $9,00 |
|---:|---:|---:|---:|
| 420 (yang sudah dipanen) | ±$12 | ±$24 | ±$73 |
| 1.150 (dengan yang belum dipanen) | ±$33 | ±$66 | ±$199 |

Perkiraan awal dokumen ini (±$6 / $13 / $38 untuk 487 peraturan) terlalu rendah sekitar dua kali: ia menganggap 800-1.100 token masuk
per halaman tetapi keluaran dari panjang teks saja, dan melupakan bahwa berpikir ditagih sebagai keluaran.

**Langit-langit per hari.** Anggaran bawaan 5.000.000 token per hari UTC (`GEMINI_BATAS_HARIAN`) menghitung masuk, keluar, dan berpikir
sekaligus: ±3.450 halaman sehari, ±170 peraturan 20 halaman, bernilai ±$5, ±$10, atau ±$30 sehari pada tiga tingkat harga di atas.
Itu hitungan turunan, bukan angka tagihan. Sisa anggaran diperiksa sebelum tiap potongan dan sesudahnya; pengamannya lunak (KV tak
atomik, dan tiga potongan berjalan bersamaan), jadi kelebihan sebesar beberapa potongan mungkin terjadi. Untuk batas yang lebih
ketat, turunkan `GEMINI_BATAS_HARIAN` di dashboard tanpa deploy. Menulis ulang seluruh korpus (opsi A) akan puluhan kali lebih mahal,
itu salah satu alasan tidak dipilih.

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

0. **Uraikan ulang yang usang lebih dulu** (`window.LEXA_PANEN = { usang: true }`, sekali). Seluruh 2.630 baris masih berversi
   pengurai 0, dan versi 4 menghitung pasal yang hilang, jadi vonis semua peraturan dihitung ulang dari arsip teksnya tanpa biaya
   Gemini: sebagian `tanpa_pasal` (ketikan 1946-1969 bergaya "Pasal 1.") pulih, dan `bersih` yang kehilangan pasal menjadi `berat`.
   Jangan membayar Gemini untuk yang bisa diperbaiki secara deterministik; yang `tanpa_pasal`, `berat`, atau `gagal` sesudahnya
   barulah calonnya. (Jumlahnya baru diketahui sesudah langkah ini; `calon_belum_dicoba` di `/api/impor/ringkasan` menyebutnya.)
1. **Cek sambungan.** `window.LEXA_PANEN = { geminiCek: true }`. Hasil yang baik mencetak model, versi model, dan anggaran. Galat
   menyebut penyebabnya (kunci salah, model tak ada, kuota).
2. **Uji kering pada beberapa peraturan** (tak menulis pasal): `window.LEXA_PANEN = { geminiUji: ["/akn/id/act/uu/2019/24",
   "/akn/id/act/uu/2014/33", "/akn/id/act/pp/1961/3", "/akn/id/act/pp/2026/13"] }`. Keempatnya mewakili tiga kelompok
   (dua pindaian modern, satu ketikan lama, satu `berat`) dan semuanya ada di D1 produksi per 14 Oktober 2026.
   Tiap peraturan melaporkan keputusan, pasal terbaca dibanding tersimpan, mutu, halaman terbaca dari halaman PDF, token, dan
   kesesuaian dengan teks lama. Baca juga teksnya di R2 (`teks-ai/...`) dan bandingkan beberapa pasal dengan PDF-nya.
3. **Putuskan.** Layak dilanjutkan bila keputusan `dipakai`, `masalah` kosong, halaman lengkap, dan sampel pasal cocok dengan PDF.
   `kesesuaian_dengan_teks_lama` yang tinggi menandakan dua bacaan saling sepakat; yang rendah pada dokumen berlapisan teks rusak
   wajar, tetapi minta pemeriksaan manual.
4. **Baca sungguhan.** `window.LEXA_PANEN = { gemini: true, batas: 3 }`. Skrip mengantrekan kelompok kecil, menunggu Lexa
   menyelesaikannya, lalu lanjut sampai habis atau anggaran habis. Tanpa pembatas lain, hari pertama bisa menghabiskan seluruh
   anggaran harian. Untuk percobaan pertama turunkan `GEMINI_BATAS_HARIAN` (mis. `300000`, sekitar sepuluh peraturan menurut
   anggapan di bagian biaya) atau tekan Berhenti di kotak status (`lexaPanenBerhenti()`) setelah putaran pertama, lalu periksa
   hasilnya (langkah 5) sebelum melanjutkan. `geminiVonis: "tanpa_pasal"` menyaring; `ulangi: true` mencoba lagi yang pernah
   dicoba.
5. **Pantau.** `GET /api/impor/ringkasan` memuat blok `gemini` (anggaran hari ini, hitungan hasil). Di D1:
   `SELECT hasil, COUNT(*) FROM pembacaan_ai GROUP BY hasil` dan, untuk yang ditolak, `SELECT frbr_uri, catatan FROM pembacaan_ai
   WHERE hasil IN ('ditolak','gagal')`.

**Tanpa konsol (otomatis).** Setelah langkah 0 dan 1, tambahkan variabel `GEMINI_OTOMATIS` = `uji` di dashboard (lihat
[Gemini otomatis](#gemini-otomatis-di-cloudflare)). Sekitar satu jam kemudian delapan percobaan kering sudah tercatat; periksa
dengan kueri D1 di atas, lalu ubah menjadi `ya`. Mematikannya: hapus variabelnya.

Hentikan dan periksa bila: banyak `ditolak` dengan sebab yang sama (perintah perlu disesuaikan), banyak `gagal` bersebab
`RECITATION` (alihkan ke model lain atau potong per halaman), atau pasal hasil bacaan yang dicek manual ternyata keliru.

## Yang sengaja belum dibangun

* **Mengukur kata menempel dan salah baca halus.** Pengukur versi 4 melihat karakter rusak, pasal hilang, dan pembukaan tertelan,
  tetapi bukan `wilayahyurisdiksi` atau `evaiuasi` di dalam kalimat yang pasalnya lengkap: tanpa kamus, kata menempel tak bisa
  dibedakan dari kata panjang yang sah. Satu-satunya pengukur yang ada: `kesesuaian_dengan_teks_lama` pada uji kering Gemini
  (bacaan gambar dan lapisan teks yang saling berselisih). Pemisahan kata berbasis kamus dari korpus sendiri adalah jalan
  deterministik yang belum dicoba.
* **Merapikan teks `ringan` dan `bersih`.** Pembersih halaman dan pengurai deterministik menangani artefak struktural dengan bukti
  data (lihat [tinjauan-analisis-eksternal.md](tinjauan-analisis-eksternal.md)); yang tersisa adalah salah baca OCR, yang hanya
  bisa diperbaiki dengan membaca gambar lagi (opsi C dengan `geminiVonis: "ringan"`), dan itu perlu bukti mutu dari tahap uji.
* **Files API** untuk PDF di atas 14 MB, dan **Batch API** (biaya lebih rendah, hasil sampai 24 jam) bila volumenya membesar.
* **Dua bacaan saling memeriksa per pasal** (lapisan teks vs gambar) dengan antrean tinjau manual untuk yang berselisih.
* **AI Gateway** Cloudflare di depan Gemini (log, cache, batas laju): cukup mengisi `GEMINI_BASE_URL`, tanpa perubahan kode.
