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
dicatat apa adanya di `sync_log` (`pasal_laju`). Yang teramati pada 11 Okt 2026: 429 dengan `Retry-After: 3600` datang
sesudah ±20-26 permintaan dalam beberapa menit (daftar maupun detail), jadi pasal.id tampaknya membatasi sekitar 20-25
permintaan per jam; katalog pun maju ±20 halaman (±1.000 peraturan) per jam. Tik tanpa kerja tidak menulis apa pun ke D1.

**Pemicu tik dan cadangannya** (`wrangler.jsonc`, `lib/cadangan.ts`). Cron `* * * * *` menjalankan tik dan Cron
`0 19 * * *` menjalankan pemeliharaan harian. **Pada 11 Okt 2026 Cron per menit baru berjalan sekitar 17:40 UTC**, berjam-jam
sesudah ditambahkan (kunci `denyut:* * * * *` baru muncul saat itu, sedangkan Cron harian berjalan sejak awal); penyebabnya
tak terlihat dari luar Worker (periksa dashboard: Worker `lexa` > Settings > Trigger events). Karena pemicunya tak bisa
dijamin, ada cadangan: dengan `vars.TIK_CADANGAN = "antrean"`, rantai pesan `{ tipe: "tik", g }` di antrean `lexa-ingest`
menjalankan satu tik lalu mengirim pesan berikutnya (60 detik bila ada kerja, 5 menit bila sepi). Rantai hanya berlanjut
selama `denyut:* * * * *` tidak segar (lebih tua dari 12 menit), jadi bila Cron per menit pulih, rantai berhenti sendiri.
Penyemainya Cron harian dan permintaan HTTP biasa (paling banyak sekali semenit per isolat); satu rantai saja yang boleh
hidup (klaim atomik `tik_antre_sampai` dan generasi `tik_generasi` yang dibandingkan-dan-ditukar). Setelah deploy,
satu kunjungan ke situs cukup untuk memulai rantai.

**Daftar hapus** (`lib/hapus.ts`, tabel `daftar_hapus`). Objek R2 dan vektor Vectorize yang yatim (peraturan di luar
cakupan yang dihapus, pasal yang lenyap karena penggantian) dicatat sebagai batu nisan dan dikosongkan bertahap oleh tik:
500 kunci R2 dan 1.000 id vektor per tik. Barisnya baru dilepas sesudah objeknya terhapus.

**Pemeliharaan harian** (`lib/pemeliharaan.ts`): 'kosong' lebih dari 30 hari dan 'gagal' lebih dari 3 hari diantrekan
lagi (giliran dan percobaan diulang dari awal; hanya yang dalam cakupan); **peraturan 'lengkap' yang nomor pasalnya
bercelah diantrekan untuk diambil ulang** (terparah dulu, paling banyak 150 sehari, giliran sebelum peraturan baru, hanya
yang belum pernah diambil pipeline ini yaitu `isi_arsip = 0`, bukan peraturan perubahan, tidak baru dicoba dalam 14 hari,
dan tidak selama akses isi dibatasi); `sync_log` dipangkas 90 hari, dan statistik harian 14 hari. Teks yang sudah
tersimpan tetap terbaca selama antre, dan hasil pengambilan ulang hanya menggantikannya bila pasalnya tidak berkurang.
Peraturan berpasal yang pengambilan ulangnya gagal terus kembali 'lengkap' (bukan 'kosong' atau 'gagal'). Di `/status`,
"Berisi pasal" menghitung peraturan yang punya pasal tersimpan apa pun statusnya, dan "Menunggu" ikut menghitung yang teksnya
sedang diambil ulang.

## Akses isi pasal.id (temuan 11 Okt 2026)

**Yang teramati di produksi.** Diagnosis (`sync_state` kunci `diag:*`) menemukan bahwa setiap `GET /laws/<uri>`
dijawab 200 hanya dengan

```json
{ "work": { "...metadata..." }, "content": "not_available_via_api", "content_note": "<154 huruf>" }
```

tanpa `articles` dan `relationships`, untuk UU 13/2003, 17/2023, 27/2009, 8/1981, dan PP 56/2009, terverifikasi
(`content_verified`) maupun tidak. Catatan pasal.id (`content_note`), apa adanya:

> Pasal.id's API provides discovery metadata only. Read the text at the linked pasal.id page, or connect an AI assistant
> via MCP: https://pasal.id/hubungkan

Jadi ini **kebijakan API pasal.id, bukan masalah token atau kuota Lexa**: memperbarui `PASAL_API_TOKEN` tidak akan
mengembalikan teksnya. Daftar `/laws` tetap normal (total 207.097 peraturan semua jenis, `limit` dibatasi 50; `type=UUD`
dikenali dengan 5 dokumen, `type=TAP_MPR` dengan 39) dan menjadi sumber katalog. Tanpa penanganan khusus, jawaban seperti itu
terbaca sebagai "peraturan tanpa pasal" dan semua peraturan yang menunggu akan ditandai 'kosong'.

**Yang dikatakan pasal.id** (dokumentasi dan ketentuan publiknya, diperiksa lewat pencarian web karena situsnya tak
terjangkau dari lingkungan pengembangan): teks peraturan berstatus domain publik, tetapi ketentuannya melarang
mendistribusikan ulang basis data terstruktur secara keseluruhan dan melakukan scraping melebihi batas laju; membaca teks
lewat halaman webnya atau lewat server MCP-nya (OAuth atau token pribadi, pembacaan teks lengkap dibatasi 300 per akun per
hari), dan kuota atau akses data lebih besar diminta lewat halo@pasal.id. Lexa **sengaja tidak** menarik halaman web atau
server MCP pasal.id secara massal: keduanya dirancang untuk pembaca dan asisten AI, bukan untuk penyalinan basis data.

**Yang dilakukan pipeline** (`lib/akses.ts`). Jawaban tanpa `articles` dengan `content`/`content_note` **bukan**
peraturan 'kosong': peraturannya dibiarkan 'menunggu' (percobaan tak bertambah), jawabannya tidak diarsipkan, dan
keadaannya dicatat di `akses_isi` (`sejak`, `terakhir`, `periksa_lagi`, `catatan`, `pemeriksaan`). Untuk membedakan
pembatasan menyeluruh dari peraturan yang memang tanpa naskah, satu peraturan yang naskahnya sudah tersimpan diminta ulang
sebagai pembanding (diundi): tanpa pasal pula berarti pembatasan menyeluruh; berpasal berarti akses baik dan peraturan yang
diminta menjadi 'kosong' dengan catatan sumber. Selama dibatasi, pengambilan detail dijeda 30 menit (10 menit bila
pemeriksaan gagal) sementara katalog dan penguraian ulang arsip jalan terus. Sesudah jeda, satu permintaan pembanding
memutuskan: masih terbatas (jeda diperbarui), atau pulih (`akses_isi` dihapus dan antrean langsung dilanjutkan di tik yang
sama). Keadaannya tampil di halaman `/status` (panel "Kelengkapan isi") dan `GET /api/stats` (`isi.akses`). Karena antrean
katalog bisa berjam-jam sebelum detail pertama diminta, tik yang menemui peraturan menunggu dengan keadaan akses yang belum
diketahui lebih dulu menjalankan **pemeriksaan awal** (satu permintaan pembanding, memakai satu dari tiga jatah tik; diulang
paling cepat tiap 6 jam bila akses baik; `sync_state` kunci `akses_diperiksa`), sehingga `/status` jujur sejak tik pertama.
Pemeriksaan ini murah (satu permintaan per 30 menit saat terbatas) dan menjaga agar pipeline pulih sendiri bila pasal.id
suatu hari memberi teks lagi.

**Jalur untuk melengkapi teks** (lihat juga "Yang belum ada" di README):

1. **Panen BPK dari peramban Anda** (bagian berikutnya): naskah resmi dari peraturan.bpk.go.id, diekstrak Lexa menjadi pasal.
   Ini jalur yang sudah dirancang sejak awal dan sah: situs itu di balik Cloudflare managed challenge sehingga hanya
   sesi peramban manusia yang bisa mengambilnya, dan Worker tidak pernah menghubunginya.
2. **Minta akses data ke pasal.id** (halo@pasal.id), mis. API khusus atau berkas data untuk Lexa; contoh surat di bawah.
3. **Menunggu**: bila pasal.id kembali memberi teks lewat API, pipeline melanjutkan sendiri dalam 30 menit.

Peraturan yang sudah punya teks di D1 (53.119 baris pasal pada 11 Okt 2026) tidak terganggu, dan halaman bacanya menautkan
naskah di sumbernya (BPK, atau halaman pasal.id) untuk peraturan yang teksnya belum ada.

> Yth. tim pasal.id, kami membangun Lexa (pencarian dan bacaan peraturan perundang-undangan Indonesia, Worker Cloudflare)
> yang memakai daftar peraturan pasal.id untuk UUD, Tap MPR, UU, Perppu, dan PP (±3.900 peraturan; sebelumnya ±53.000
> baris pasal juga dari API Anda). Pada 11 Oktober 2026 `GET /laws/<uri>` menjawab `content: "not_available_via_api"`
> dengan catatan bahwa API hanya untuk metadata. Apakah ada jalur resmi untuk mengambil teks pasal secara terstruktur untuk
> kebutuhan ini (API untuk mitra, kuota khusus, atau berkas data), dengan pencantuman pasal.id sebagai sumber? Pengambilan kami
> dibatasi (3 permintaan per menit, patuh pada Retry-After) dan kami tidak mendistribusikan ulang basis data Anda. Terima kasih.

## Panen BPK (melengkapi teks)

Kodenya: `GET /api/impor/butuh-teks` (daftar kerja), `PUT /api/impor/pdf` (unggah PDF), dan `scripts/bpk-console-harvest.js`
(dijalankan di konsol peramban pada situs BPK). Alurnya:

1. Buka https://peraturan.bpk.go.id/ di peramban, selesaikan tantangan Cloudflare bila muncul, buka DevTools > Console.
2. Setel opsi uji lebih dulu, lalu tempel isi `scripts/bpk-console-harvest.js`:
   `window.LEXA_PANEN = { batas: 3, kering: true }` (mengunduh PDF tanpa mengunggah). Isi alamat Lexa dan `ADMIN_TOKEN` pada
   kotak dialog (tidak disimpan di mana pun).
3. Bila tautan PDF tak ditemukan, buka satu halaman rincian peraturan di BPK dan jalankan `window.LEXA_PANEN = { periksa: true }`
   sebelum menempel skrip: ia mencetak tabel metadata dan semua tautan unduhan halaman itu (kirim hasilnya agar pemilih di skrip
   disesuaikan; skrip ditulis menurut susunan halaman BPK yang diketahui dan **belum pernah dijalankan pada situs sungguhan**).
4. Jalankan sungguhan (tanpa `kering`, `batas` sampai 200): skrip memproses satu peraturan per ±4-6 detik, berhenti sendiri
   sesudah 5 kegagalan beruntun (sesi kedaluwarsa), dan mencetak ringkasan. Jalankan lagi untuk melanjutkan; yang PDF-nya sudah
   terunggah tidak muncul lagi.
5. Lexa mengekstrak PDF menjadi pasal di latar belakang (`ekstrak_pdf`: Workers AI `toMarkdown`, lalu pengurai pasal dengan
   penilaian mutu); hasil yang lebih sedikit dari pasal yang sudah tersimpan tidak menggantikannya. Pantau di `/status` dan
   `sync_log` (`ekstrak_pdf`).

Daftar kerja diurutkan: yang berbpk_id lebih dulu, lalu menurut `isi_giliran` (UUD, Tap MPR, UU, Perppu, PP; terbaru dulu).
Jawabannya memuat `total` dan `tanpa_bpk`: peraturan baru dari katalog pasal.id umumnya hanya punya tautan pasal.id atau
peraturan.go.id, bukan BPK, sehingga tak bisa dipanen oleh skrip ini; jumlahnya terlihat di `tanpa_bpk`. `?celah=1` menyertakan
peraturan yang teksnya baru sebagian (nomor pasal bercelah), `?jenis=UU,PP` menyaring.

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
diperbaiki. Peraturan yang tersimpan sebagian diantrekan sendiri oleh pemeliharaan harian (150 sehari; `{"perbaiki_celah":
true}` melakukannya sekarang dan tanpa batas harian). Karena setiap respons diarsipkan, perbaikan pengurai berikutnya cukup
`{"ulang_arsip": true}`.
