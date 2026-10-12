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

Teks UUD, Tap MPR, UU, Perppu, dan PP yang belum ada hanya bisa datang dari naskah resmi BPK. Seluruh peraturan.bpk.go.id
di balik Cloudflare managed challenge dan Worker Lexa tidak pernah menghubunginya, jadi pengambilannya dikerjakan **dari
peramban Anda sendiri** oleh `scripts/bpk-console-harvest.js`, yang berbicara dengan Lexa lewat `/api/impor/*` (header
`x-admin-token`, secret `ADMIN_TOKEN`; origin BPK diizinkan CORS).

### Mengapa dua tahap

Daftar kerja (`GET /api/impor/butuh-teks`) hanya bisa menyebut peraturan yang alamatnya di BPK diketahui. Keadaan produksi
12 Okt 2026:

| Jenis | Baris | Punya `bpk_id` | Alamat sumber lain | Tanpa pasal |
|---|---:|---:|---|---:|
| PP | 5.011 | **3** | peraturan.go.id 1.442; pasal.id 220; BPK 88; **kosong 3.261** | 3.502 |
| UU | 1.950 | 1.361 | peraturan.go.id 481; pasal.id 89 | 158 |
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
| `GET /api/impor/butuh-teks?batas=50&jenis=UU,PP&celah=1&semua=1` | daftar kerja: peraturan tanpa teks dan tanpa PDF; yang bertaut BPK didahulukan, lalu menurut `isi_giliran`. Menjawab `total`, `tanpa_bpk`, `tanpa_berkas`. `celah=1` menyertakan teks yang baru sebagian; `semua=1` menyertakan yang ditandai tanpa berkas |
| `GET /api/impor/ringkasan` | per jenis: `total`, `bertaut_bpk`, `ber_pdf`, `berpasal`, `pdf_belum_berpasal`, `perlu_pdf`; plus `tanpa_berkas` |
| `POST /api/impor/tautan` | `{ tautan: [{ url, teks, slug?, konteks?, uri? }], buat? }` (maks 200). Jawabannya memuat status tiap entri: `ditautkan`, `sudah`, `dibuat`, `tidak_ada`, `luar_cakupan`, `tidak_dikenali`, `ambigu`, `bentrok`, `gagal`. `uri` memetakan manual ke peraturan Lexa (mis. UUD 1945 ke `/akn/id/act/uud/1945/original`) |
| `POST /api/impor/manifest` | metadata + relasi halaman rincian. Dicocokkan menurut sitasi, bukan URI turunan; `lexa_uri` mengikat dokumen ke satu peraturan (hanya memperbarui; ditolak bila sitasinya tak cocok) |
| `PUT /api/impor/pdf?uri=` | berkas PDF; ke R2 `pdf/…`, lalu diantrekan `ekstrak_pdf` |
| `POST /api/impor/tanpa-berkas` | `{ uris: [...] }`: peraturan yang di BPK tak punya berkas (naskah lama hanya metadata); tak muncul lagi di daftar kerja |
| `POST /api/impor/ekstrak-ulang` | `{ uri?, batas?, jenis? }`: antrekan ulang ekstraksi PDF yang tersimpan tetapi belum berpasal (mis. setelah pengurai diperbaiki) |

Beberapa hal yang dijaga di sisi server karena data produksi menuntutnya:

- **Pencocokan menurut sitasi**, bukan teks nomor atau URI: "01" = "1" (PP 1/2022 ada dua baris), "perpu" = "perppu" (URI
  produksi memakai keduanya, sedangkan indeks unik `(jenis, nomor, tahun)` tak memeriksa URI), dan Tap MPR "XVI/MPR/1998" =
  "XVI-MPR-1998" = "xvi-mpr-1998" (tiga baris untuk satu ketetapan). Sebelumnya manifest dengan URI turunan yang berbeda dari
  yang tersimpan melanggar indeks unik dan menggagalkan SELURUH kiriman (batch D1 atomik); kini kegagalan satu dokumen
  terpisah dari yang lain.
- **Jenis tak pernah ditukar**: BPK pernah menamai Perppu 7/1964 "uu-no-7-tahun-1964". Bila slug dan teks tautan menunjuk
  dua peraturan yang berbeda, data Lexa yang memutuskan; bila dua-duanya ada di Lexa, hasilnya `ambigu` dan tak ada yang ditulis.
- **Tautan yang keliru berarti PDF yang keliru**, dan PDF yang keliru menimpa pasal yang benar. Karena itu teks kartu hasil
  hanya dipakai untuk tahun Tap MPR, bukan untuk mengenali sitasi.
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
| `jeda` | jeda minimum antarpermintaan ke BPK, ms (4000; minimum 2000, jangan dikecilkan) |
| `kering` | tidak menulis apa pun ke Lexa |
| `rincian` | buka halaman rincian walau tautan PDF langsung dari daftar diketahui (metadata ikut diperbarui; dua kali lipat permintaan) |
| `periksa` | hanya menganalisis halaman yang sedang dibuka dan mencetaknya |
| `papan` | `false`: tanpa kotak status |

### Bila tidak berjalan seperti yang diharapkan

Skrip ditulis menurut susunan BPK yang diketahui (alamat `/Details/<id>/<slug>` dan `/Download/<id>/<berkas>`, daftar
`/Search?jenis=<n>&page=<n>`) dan **belum pernah dijalankan pada situs sungguhan** (situs itu tak terjangkau dari lingkungan
pengembangan). Yang berguna dikirim balik:

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
| `tantangan_cloudflare` | sesi BPK kedaluwarsa atau diblokir; muat ulang tab, selesaikan tantangan, jalankan lagi |
| `yang terunduh bukan PDF` | idem (halaman tantangan menggantikan berkasnya) |
| `tautan PDF tak ditemukan di halaman rincian` | halaman tak berformat yang dikenal (tanpa tabel metadata maupun tautan unduhan); jalankan `periksa` di halaman itu |
| `5 kegagalan beruntun` | skrip berhenti sendiri; periksa sesi BPK |

### Biaya dan batas

- **Waktu**: ±4-6 detik per PDF (jeda yang sopan), jadi 3.900 peraturan memakan ±5-7 jam; dibagi beberapa sesi dengan `batas` dan
  `terus`. Penjelajahan PP sendiri ±250-500 permintaan.
- **R2**: PDF disimpan di `pdf/…` (rata-rata mungkin ratusan KB; 3.900 berkas bisa beberapa GB).
- **D1**: tiap peraturan menulis puluhan baris pasal ditambah indeks FTS; bila akun Anda di paket gratis (100.000 baris tulis
  per hari), bagi panen ke beberapa hari.
- **Workers AI**: konversi PDF, penyematan semua pasal (bge-m3), dan ringkasan tiap peraturan memakai kuota neuron harian;
  pesan antrean yang kehabisan kuota diulang otomatis. Pantau di `/status` dan `sync_log` (`ekstrak_pdf`).
- **PDF hasil pindaian** (tanpa lapisan teks) menghasilkan `tanpa_pasal` di `ekstraksi_log`; mereka tetap tersimpan dan terbaca
  di tab PDF, tetapi pasalnya menunggu OCR (lihat analisis lanjutan). Setelah pengurai pasal diperbaiki, antrekan ulang dengan
  `POST /api/impor/ekstrak-ulang`.

### Memantau dan memeriksa

```sql
-- Kemajuan per jenis (atau GET /api/impor/ringkasan)
SELECT jenis, COUNT(*) AS total, SUM(bpk_id IS NOT NULL AND bpk_id <> '') AS bertaut_bpk,
       SUM(r2_pdf_key IS NOT NULL) AS ber_pdf, SUM(jumlah_pasal > 0) AS berpasal
  FROM laws GROUP BY jenis;
-- Hasil ekstraksi PDF terakhir
SELECT vonis, COUNT(*) FROM ekstraksi_log GROUP BY vonis;
SELECT job, status, detail, jumlah, created_at FROM sync_log WHERE job LIKE 'impor_bpk%' OR job = 'ekstrak_pdf' ORDER BY id DESC LIMIT 20;
-- Penanda tanpa berkas
SELECT COUNT(*) FROM sync_state WHERE key LIKE 'bpk_tanpa_berkas:%';
-- Duplikat data (satu peraturan, beberapa baris): Tap MPR ditulis tiga cara, PP "01" dan "1"
SELECT frbr_uri, nomor, tahun, jumlah_pasal FROM laws WHERE jenis = 'TAP_MPR' ORDER BY tahun, lower(nomor);
```

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
