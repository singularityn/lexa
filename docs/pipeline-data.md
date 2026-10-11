# Pipeline data: katalog, isi, dan akses pasal.id

Dokumen ini menjelaskan bagaimana UUD, Tap MPR, UU, Perppu, dan PP masuk ke D1, apa yang menjaga datanya, bagaimana
memeriksanya di produksi, dan **temuan 11 Oktober 2026: pasal.id berhenti memberi teks pasal lewat API**, yang
menentukan seberapa lengkap isi Lexa bisa menjadi. Kodenya ada di `src/worker/lib/` (`katalog`, `isi`, `tik`,
`cadangan`, `akses`, `hapus`, `pemeliharaan`, `diagnosa`), tesnya di `test/integration/`.

## Alur singkat

```
daftar /laws (50 per halaman)  ──►  katalog: baris `laws` berstatus 'menunggu' (metadata saja)
                                         │
                       isi_giliran: terverifikasi dulu, UUD < Tap MPR < UU < Perppu < PP, terbaru dulu
                                         ▼
detail /laws/<uri>  ──►  respons mentah diarsipkan di R2 (mentah/<uri>.json.gz)  ──►  diuraikan  ──►  pasal di D1
                                                                                                  └─► teks di R2 + vektor di Vectorize
```

Prinsipnya "daftar dulu, isi kemudian": daftar peraturan murah (satu permintaan untuk 50 peraturan) dan terbuka,
sedangkan detail adalah permintaan yang paling dibatasi pasal.id. Peraturan yang detailnya tak kunjung berhasil tetap
tercatat dan bisa dicari lewat judulnya.

## Komponen

**Katalog** (`lib/katalog.ts`). Tiap `SIKLUS_HARI` = 3 hari, `/laws?type=<jenis>` disapu halaman demi halaman untuk
UUD, TAP_MPR, UU, PERPPU, lalu PP (UUD dan Tap MPR dulu: sedikit, dan yang paling dicari). pasal.id membatasi `limit`
pada 50 walau diminta 100; kursor (`katalog_offset:<jenis>`) maju sebanyak yang benar-benar diterima dan hanya sesudah
halamannya tersimpan, jadi 429 di tengah jalan tidak melewatkan apa pun. Peraturan baru masuk `INSERT OR IGNORE`
dengan status 'menunggu'; yang sudah ada hanya diperbarui metadatanya (isi tak pernah tertimpa). Kode filter `type`
untuk UUD dan TAP_MPR belum terbukti di pasal.id, yang mengabaikan filter tak dikenal dan menjawab SEMUA peraturan; sapuan
memeriksa bahwa halaman pertama memuat jenis yang diminta dan mencatat hasilnya di `katalog_dukungan:<jenis>`. Hasil
pemeriksaan 11 Okt 2026: **`type=UUD` dikenali** (5 dokumen, semua terverifikasi, mis. `/akn/id/act/uud/1945/perubahan-4`
dengan nomor "1945/P4"); `TAP_MPR` baru diketahui dari sapuan.

**Antrean isi** (`lib/isi.ts`, kolom `laws.isi_*` dari migrasi 0005 dan 0006).

| `isi_status` | Arti |
|---|---|
| `menunggu` | isi perlu diambil dari pasal.id (`isi_arsip = 0`) atau cukup diuraikan ulang dari arsip (`isi_arsip = 1`) |
| `lengkap` | pasal tersimpan |
| `kosong` | sumber menjawab tanpa pasal (mis. naskah pindaian); dicoba lagi tiap 30 hari |
| `gagal` | galat berulang (5 percobaan; 404 cukup 2); dicoba lagi tiap 3 hari |

Urutan pengambilan (`isi_giliran`, kecil lebih dulu): terverifikasi pasal.id (`content_verified`) sebelum yang tidak,
lalu UUD, Tap MPR, UU, Perppu, PP, lalu tahun terbaru; kegagalan menambah 1 miliar sehingga yang gagal antre paling
belakang. Rumusnya ada dua kali (TypeScript `hitungGiliran` dan SQL `SQL_GILIRAN`), dijaga sama oleh tes.

Dua penjaga data: penyimpanan **tidak pernah mengganti pasal yang tersimpan dengan hasil yang lebih sedikit atau
kosong** (respons terpotong dari sumber tak boleh menghapus naskah yang baik; ekstraksi PDF pun begitu), dan respons
mentah diarsipkan sebelum diuraikan sehingga perbaikan pengurai cukup menguraikan ulang arsip, tanpa jatah pasal.id
(`{"ulang_arsip": true}`, sampai 15 peraturan per tik).

**Tik** (`lib/tik.ts`). Satu tik mengerjakan sedikit hal lalu selesai: mengosongkan daftar hapus, lalu (bila pasal.id
boleh dihubungi) diagnosis, katalog, dan pengambilan isi dengan anggaran bersama **3 permintaan pasal.id per tik**.
Pinjaman `pinjaman:tik` (240 detik) mencegah dua tik berjalan bersamaan. Kena 429, tik menyimpan jeda
(`pasal_tunda_sampai`, dijepit 1 menit sampai 1 jam) yang dipatuhi semua tik berikutnya; `Retry-After` yang diminta
dicatat apa adanya di `sync_log` (`pasal_laju`). Tik tanpa kerja tidak menulis apa pun ke D1.

**Pemicu tik dan cadangannya** (`wrangler.jsonc`, `lib/cadangan.ts`). Cron `* * * * *` menjalankan tik dan Cron
`0 19 * * *` menjalankan pemeliharaan harian. **Pada 11 Okt 2026 Cron per menit terbukti tidak berjalan di produksi**
(kunci `denyut:* * * * *` tak pernah muncul berjam-jam sesudah deploy, sedangkan Cron harian berjalan); penyebabnya tak
terlihat dari luar Worker, jadi periksa dashboard (Worker `lexa` > Settings > Trigger events). Karena itu ada
cadangan: dengan `vars.TIK_CADANGAN = "antrean"`, rantai pesan `{ tipe: "tik", g }` di antrean `lexa-ingest`
menjalankan satu tik lalu mengirim pesan berikutnya (60 detik bila ada kerja, 5 menit bila sepi). Rantai hanya berlanjut
selama `denyut:* * * * *` tidak segar (lebih tua dari 12 menit), jadi bila Cron per menit pulih, rantai berhenti sendiri.
Penyemainya Cron harian dan permintaan HTTP biasa (paling banyak sekali semenit per isolat); satu rantai saja yang boleh
hidup (klaim atomik `tik_antre_sampai` dan generasi `tik_generasi` yang dibandingkan-dan-ditukar). Setelah deploy,
satu kunjungan ke situs cukup untuk memulai rantai.

**Daftar hapus** (`lib/hapus.ts`, tabel `daftar_hapus`). Objek R2 dan vektor Vectorize yang yatim (peraturan di luar
cakupan yang dihapus, pasal yang lenyap karena penggantian) dicatat sebagai batu nisan dan dikosongkan bertahap oleh tik:
500 kunci R2 dan 1.000 id vektor per tik. Barisnya baru dilepas sesudah objeknya terhapus.

**Pemeliharaan harian** (`lib/pemeliharaan.ts`): 'kosong' lebih dari 30 hari dan 'gagal' lebih dari 3 hari diantrekan
lagi (giliran dan percobaan diulang dari awal; hanya yang dalam cakupan), `sync_log` dipangkas 90 hari, dan statistik
harian 14 hari.

## Akses isi pasal.id (temuan 11 Okt 2026)

**Yang teramati di produksi.** Diagnosis (`sync_state` kunci `diag:*`) menemukan bahwa setiap `GET /laws/<uri>`
dijawab 200 hanya dengan

```json
{ "work": { "...metadata..." }, "content": "not_available_via_api", "content_note": "<154 huruf>" }
```

tanpa `articles` dan `relationships`, untuk UU 13/2003, 17/2023, 27/2009, dan 8/1981, terverifikasi (`content_verified`)
maupun tidak. Daftar `/laws` tetap normal (total 207.097 peraturan semua jenis, `limit` dibatasi 50). Tanpa penanganan
khusus, jawaban seperti itu terbaca sebagai "peraturan tanpa pasal" dan semua peraturan yang menunggu akan ditandai
'kosong'.

**Yang dikatakan pasal.id** (dari dokumentasi dan ketentuan publiknya, diperiksa lewat pencarian web karena situsnya tak
terjangkau dari lingkungan pengembangan): detail peraturan lewat REST API memerlukan masuk atau kunci API (token pribadi
gratis dari menu Akun, dikirim sebagai `Authorization: Bearer`); pembacaan teks lengkap dibatasi **300 per akun per hari
(reset 00.00 WIB)** dan kuota lebih besar diminta lewat halo@pasal.id; teks peraturan berstatus domain publik, tetapi
ketentuannya melarang mendistribusikan ulang basis data terstruktur secara keseluruhan dan melakukan scraping melebihi
batas laju. Batas 300 per hari itu disebut pada panduan server MCP dan plugin-nya (yang memakai OAuth atau token
pribadi); apakah REST API memakai batas yang sama tidak dinyatakan. Jadi penyebabnya salah satu dari:
token `PASAL_API_TOKEN` di Worker tidak (lagi) berhak atas teks lengkap (kedaluwarsa, dicabut, atau bukan token akun),
kuota baca harian akun sudah habis, atau pasal.id memang menarik teks dari REST API. Catatan sumbernya (`content_note`)
dicatat apa adanya di `sync_state` kunci `akses_isi` begitu Worker menemuinya.

**Yang dilakukan pipeline** (`lib/akses.ts`). Jawaban tanpa `articles` dengan `content`/`content_note` **bukan**
peraturan 'kosong': peraturannya dibiarkan 'menunggu' (percobaan tak bertambah), jawabannya tidak diarsipkan, dan
keadaannya dicatat di `akses_isi` (`sejak`, `terakhir`, `periksa_lagi`, `catatan`, `pemeriksaan`). Untuk membedakan
pembatasan menyeluruh dari peraturan yang memang tanpa naskah, satu peraturan yang naskahnya sudah tersimpan diminta ulang
sebagai pembanding: tanpa pasal pula berarti pembatasan menyeluruh; berpasal berarti akses baik dan peraturan yang
diminta menjadi 'kosong' dengan catatan sumber. Selama dibatasi, pengambilan detail dijeda 30 menit (10 menit bila
pemeriksaan gagal) sementara katalog dan penguraian ulang arsip jalan terus. Sesudah jeda, satu permintaan pembanding
memutuskan: masih terbatas (jeda diperbarui), atau pulih (`akses_isi` dihapus dan antrean langsung dilanjutkan di tik yang
sama). Tanpa pembanding, peraturan terdepan yang berpasal membuktikan pulihnya akses. Keadaannya tampil di halaman
`/status` (panel "Kelengkapan isi") dan `GET /api/stats` (`isi.akses`).

**Yang perlu Anda lakukan.**

1. Pastikan `PASAL_API_TOKEN` adalah token pribadi yang masih berlaku: masuk ke pasal.id, menu **Akun > Akses API &
   MCP**, buat token baru bila perlu, lalu pasang sebagai secret Worker (`npx wrangler secret put PASAL_API_TOKEN`,
   jangan lewat pipa; atau dashboard > Settings > Variables and secrets). Dalam 30 menit pipeline memeriksanya dan
   melanjutkan sendiri. Lihat `sync_state.akses_isi.catatan` untuk bunyi catatan pasal.id yang sebenarnya.
2. Bila catatannya menyebut kuota atau akun: 300 pembacaan per hari berarti sekitar 13 hari untuk satu putaran atas
   ±3.900 peraturan, lebih lama bila katalog menambah PP yang belum tersimpan. Minta kuota lebih besar ke halo@pasal.id;
   contoh surat di bawah.
3. Bila pasal.id memang menutup teks dari API, jalur lain yang sah ada di "Yang belum ada" pada README: skrip panen BPK
   (dijalankan dari peramban Anda di situs BPK, mengirim ke `/api/impor/*`) dan ekstraksi PDF resmi. Peraturan yang
   sudah punya teks di D1 (53.119 baris pasal pada 11 Okt 2026) tidak terganggu.

> Yth. tim pasal.id, kami membangun Lexa (pencarian dan bacaan peraturan perundang-undangan Indonesia, Worker Cloudflare)
> yang bersumber dari pasal.id untuk UUD, Tap MPR, UU, Perppu, dan PP (±3.900 peraturan, ±53.000 baris pasal). Pada 11
> Oktober 2026 `GET /laws/<uri>` dengan token kami menjawab `content: "not_available_via_api"` tanpa `articles`. Mohon konfirmasi
> apakah token kami (akun: …) masih berhak atas teks lengkap, dan apakah tersedia kuota baca yang lebih besar atau berkas
> data untuk keperluan ini. Pengambilan kami sudah dibatasi (3 permintaan per menit, patuh pada Retry-After) dan kami
> mencantumkan pasal.id sebagai sumber. Terima kasih.

## Mengendalikan pipeline

`POST /api/admin/sync` dengan header `x-admin-token`:

| Badan | Efek |
|---|---|
| `{"tik": true}` | jalankan satu tik sekarang dan kembalikan laporannya (apa yang dikerjakan atau mengapa tidak) |
| `{"uri": "/akn/id/act/uu/2003/13"}` | dahulukan satu peraturan (giliran 0); bila belum ada di D1, diambil sekarang (503 `akses_terbatas` bila pasal.id tak memberi naskah) |
| `{"jenis": ["UU"]}` | mulai sapuan katalog ulang untuk jenis itu |
| `{"perbaiki_celah": true}` | dahulukan pengambilan ulang peraturan yang nomor pasalnya bercelah (terparah dulu) |
| `{"ulang_arsip": true}` | uraikan ulang semua peraturan yang responsnya sudah diarsipkan, tanpa pasal.id |
| `{"ringkas_kosong": true}` | susun ringkasan AI untuk yang belum punya |

## Memeriksa produksi

D1 (dashboard > D1 > `lexa-db` > Console, atau `npx wrangler d1 execute lexa-db --remote --command "..."`):

```sql
-- Pemicu dan keadaan pipeline: denyut Cron, rantai cadangan, jeda pasal.id, akses isi, kemajuan katalog
SELECT key, substr(value, 1, 160) AS nilai, updated_at FROM sync_state
 WHERE key LIKE 'denyut:%' OR key LIKE 'katalog_%' OR key IN ('akses_isi', 'pasal_tunda_sampai', 'tik_antre_sampai', 'tik_generasi')
 ORDER BY key;
-- Kelengkapan isi per jenis
SELECT jenis, isi_status, COUNT(*) AS peraturan, SUM(jumlah_pasal) AS pasal FROM laws GROUP BY 1, 2 ORDER BY 1, 2;
-- Kejadian terakhir (batas laju, akses isi, pembersihan, pengambilan isi, pemeliharaan)
SELECT job, status, detail, created_at FROM sync_log ORDER BY id DESC LIMIT 20;
-- Hitungan harian: katalog, diambil, diurai, lengkap, kosong, batas_laju, akses_terbatas
SELECT key, value FROM sync_state WHERE key LIKE 'statistik:%' ORDER BY key DESC LIMIT 3;
-- Sisa pembersihan R2 dan Vectorize
SELECT jenis_objek, COUNT(*) FROM daftar_hapus GROUP BY 1;
-- Bentuk respons nyata (diag:* dari pemeriksaan, diagisi:* dari delapan peraturan pertama yang berisi naskah)
SELECT key, substr(value, 1, 400) FROM sync_state WHERE key LIKE 'diag%';
```

## Tindakan produksi 11 Okt 2026

Atas permintaan pemilik (cakupan UUD, Tap MPR, UU, Perppu, PP; data di luar cakupan dihapus):

- Migrasi 0005 dan 0006 diterapkan dan tercatat di `d1_migrations`; `isi_status` diisi dari data yang ada (3.456
  'lengkap', 414 'menunggu').
- 2.131 peraturan di luar cakupan (PERPRES, POJK, PERMEN, dll.) dan 15.457 baris pasalnya dihapus dari D1 beserta
  relasinya; setelahnya D1 memuat 3.870 peraturan dalam cakupan (UU 1.950, PP 1.750, Perppu 168, Tap MPR 2) dengan 53.119
  baris pasal. Objek yatim dicatat di `daftar_hapus` (6.393 berkas R2 dan 21.128 vektor) dan dikosongkan bertahap oleh tik.
- Pada tahap ini katalog belum menyapu semuanya: UU di daftar pasal.id berjumlah 1.901 dan PP jauh lebih banyak
  daripada 1.750 tersimpan (kursor lama `offset:PP` menandakan ±5.000), jadi jumlah peraturan akan naik, dengan status
  'menunggu', begitu katalog selesai.

## Ekstraksi pasal: yang diketahui dan yang belum

Sebelum temuan akses di atas, data produksi menunjukkan pola tersimpan sebagian: UU 17/2023 (458 pasal) hanya 59 baris,
UU 27/2009 (408 pasal) hanya Pasal 1 dan 400-408, KUHAP 39 dari 286; polanya selalu pasal yang punya ayat lenyap. Ukuran
luasnya (11 Okt 2026, atas 3.456 peraturan 'lengkap'; celah = nomor pasal tertinggi dikurangi jumlah nomor berbeda):
**2.190 peraturan bercelah dengan perkiraan 63.888 pasal hilang, 574 di antaranya dengan celah lebih dari 20 nomor**
(UU perubahan mengutip nomor peraturan lain sehingga sebagian celah wajar). Halaman baca kini memberi tahu pembaca bila
penomoran pasal bercelah ("Teks peraturan ini tampaknya belum lengkap", `celahNomorPasal` di `public/js/format.js`),
sehingga teks yang tersimpan sebagian tak terbaca sebagai teks utuh.
Pengurai sudah diperbaiki untuk dua bentuk yang masuk akal (simpul yatim dijadikan akar, dan ayat/butir bersaudara pasal
dipasang ke pasal di depannya; `ratakanPohonPasal` di `lib/pasal.ts`), dengan tes, tetapi **bentuk respons nyata belum
pernah terlihat** karena pasal.id sudah menutup teksnya sebelum diagnosis sempat membacanya. Begitu pasal.id memberi naskah
lagi, delapan peraturan pertama meninggalkan ringkasan struktur responsnya di `sync_state` kunci `diagisi:*` (tipe simpul,
pasal tanpa teks, simpul yatim, nama field), tanpa permintaan tambahan. Dari situ pengurai bisa dibuktikan atau
diperbaiki, lalu `{"perbaiki_celah": true}` mengantrekan peraturan yang tersimpan sebagian untuk diambil ulang. Karena
setiap respons diarsipkan, perbaikan berikutnya cukup `{"ulang_arsip": true}`.
