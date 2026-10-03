# Menghubungkan repo GitHub ke Worker `lexa`

Panduan ini menghubungkan `singularityn/lexa` ke Worker `lexa` yang **sudah berjalan** di akun Cloudflare
lewat **Workers Builds** (integrasi Git bawaan Cloudflare: build dan deploy otomatis saat push, URL pratinjau
per branch/PR, dan check run di GitHub). Bagian dashboard hanya bisa dilakukan oleh pemilik akun.

## Mengapa tidak langsung "Connect"

Worker produksi dibuat dari kode yang tidak ada di Git. Repo ini adalah **rekonstruksinya**: kode aplikasi
identik byte-per-byte dengan produksi (terverifikasi lewat sourcemap), tetapi konfigurasinya
(`wrangler.jsonc`) disusun tanpa akses ke pengaturan live. Deploy pertama dari Git akan **menimpa
pengaturan Worker** dengan isi berkas itu. Jika ada yang tidak cocok, akibatnya bisa berupa binding yang
tercopot, variabel yang terhapus, cron yang hilang, atau aset statis yang lenyap. Karena itu urutannya:
**rekonsiliasi dulu, hubungkan dengan deploy dinonaktifkan, uji, baru aktifkan deploy.**

Pengaman bawaan: nama indeks Vectorize di `wrangler.jsonc` masih placeholder, jadi `wrangler deploy`
(tanpa `--dry-run`) akan ditolak sampai Anda melengkapinya.

## Tahap 0: Rekonsiliasi konfigurasi (±15 menit)

Cocokkan `wrangler.jsonc` dengan pengaturan live. Cara tercepat, dari mesin Anda:

```bash
mkdir /tmp/lexa-dash && cd /tmp/lexa-dash
npx wrangler login
npx wrangler init --from-dash lexa     # mengunduh kode dan konfigurasi Worker dari dashboard
```

Bandingkan berkas konfigurasi hasilnya dengan `wrangler.jsonc`. Bila perintah itu tidak tersedia di versi
Anda, ambil nilainya dari dashboard (Workers & Pages > `lexa` > Settings):

| Item | Lihat di | Isi di `wrangler.jsonc` |
|---|---|---|
| Nama indeks Vectorize | Settings > Bindings (`VECTORIZE`), atau `npx wrangler vectorize list` | `vectorize[0].index_name` (**wajib**; ini pengaman) |
| Nama queue dan pengaturan konsumer | Settings > Bindings (`INGEST_QUEUE`); Queues > queue > Settings | `queues.producers[0].queue`, `queues.consumers[0]` (batch, timeout, retries, concurrency, DLQ) |
| Jadwal cron | Settings > Trigger events | `triggers.crons` (kini `0 19 * * *`, diduga dari log) |
| Variabel teks | Settings > Variables and secrets | tambahkan ke `vars`: `EMBEDDING_MODEL`, `SUMMARY_MODEL`, `BPK_BASE`, `PASAL_API_BASE`, `SEARCH_CACHE_TTL`; setelah itu hapus `keep_vars` |
| Secret (hanya nama) | Settings > Variables and secrets | tidak masuk Git; **tidak terhapus oleh deploy**: `ADMIN_TOKEN`, `PASAL_API_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Compatibility date dan flags | Settings > Runtime | `compatibility_date` (kini `2026-08-05`, diperkirakan), `compatibility_flags` bila ada |
| **Aset statis (SPA)** | buka `https://<URL-worker>/` | lihat peringatan di bawah |
| Observability, placement, limits (CPU), custom domain/route | Settings | tambahkan bila diaktifkan |

### Peringatan: aset statis (SPA)

Komentar di `src/worker/index.ts` menyebut bahwa selain `/api/*`, permintaan "jatuh ke static assets SPA".
Kode frontend **tidak ada di repo ini**. Cara cek: buka alamat dasar Worker Anda (`https://<nama>.<subdomain>.workers.dev/`).

- Muncul halaman aplikasi: Worker memakai aset statis. Deploy dari Git **tanpa** blok `assets` akan
  menghapusnya dari versi baru. Jangan aktifkan deploy sebelum frontend masuk repo dan blok `assets` di
  `wrangler.jsonc` (sudah disiapkan sebagai komentar) diaktifkan dengan folder build yang benar.
  Kalau terlanjur terhapus: Deployments > pilih versi sebelumnya > Rollback.
- Muncul "404 Not Found" biasa: tidak ada aset statis, dan blok `assets` tidak perlu diaktifkan.

Setelah semuanya cocok: `grep -n "TODO" wrangler.jsonc` sebaiknya tidak menghasilkan apa pun, lalu commit.

## Tahap 1: Siapkan branch produksi

Repo ini awalnya kosong, sehingga branch yang pertama kali di-push (`claude/zealous-brown-63ek65`)
otomatis menjadi branch default di GitHub. Disarankan membuat `main` dari commit terbaru lalu menjadikannya
default (GitHub > Settings > Branches > Default branch), dan memakai `main` sebagai branch produksi.

## Tahap 2: Hubungkan repo (deploy masih dinonaktifkan)

1. Cloudflare dashboard > **Workers & Pages** > `lexa` > **Settings** > **Builds** > **Connect**.
2. Pilih **GitHub**. Pasang/otorisasi aplikasi **Cloudflare Workers & Pages** untuk akun `singularityn`,
   pilih repository `lexa` (cukup "Only select repositories").
3. Isi pengaturan build:

   | Kolom | Nilai |
   |---|---|
   | Production branch | `main` |
   | Root directory | `/` |
   | Build command | `npm run check` (typecheck + tes; dependensi dipasang otomatis dari `package-lock.json`) |
   | **Deploy command (sementara)** | `npx wrangler deploy --dry-run` |
   | Build non-production branches | aktif |

   Memakai `--dry-run` membuat setiap build memverifikasi konfigurasi dan bundel tanpa mengubah Worker produksi.
4. Nama Worker di dashboard (`lexa`) harus sama persis dengan `name` di `wrangler.jsonc`; kalau tidak, build gagal.

## Tahap 3: Uji tanpa risiko

1. Push satu commit kecil ke branch uji dan buka pull request. Anda akan melihat check run **Workers
   Builds: lexa** di GitHub dan komentar berisi URL pratinjau.
2. Pada log build, pastikan `npm run check` lolos dan daftar binding hasil `--dry-run` sama dengan yang ada
   di dashboard (D1, KV, R2, AI, Vectorize, Queue).
3. Di URL pratinjau, coba `/api/stats`, `/api/search?q=pesangon`, `/api/laws?per_page=5`, dan `/robots.txt`.

> Pratinjau memakai **resource produksi yang sama** (D1, KV, R2, Queue) kecuali Anda mengatur isolasi
> resource di pengaturan Previews. Cron dan konsumer antrean tidak berjalan di pratinjau. Hindari memicu
> endpoint penulisan (`/api/admin/*`, `/api/impor/*`) dari pratinjau.

## Tahap 4: Aktifkan deploy

Setelah Tahap 0 selesai dan pratinjau sehat:

1. Ubah **Deploy command** menjadi `npx wrangler deploy`.
2. Push ke `main` atau tekan **Retry build** pada build terakhir.
3. Verifikasi (daftar periksa di bawah). Siapkan rollback sebelum mulai.

### Daftar periksa pasca-deploy pertama

| Periksa | Di mana | Harapan |
|---|---|---|
| Versi aktif | Deployments | versi baru bersumber GitHub, aktif |
| Binding | Settings > Bindings | `DB`, `CACHE`, `DOCS`, `AI`, `VECTORIZE`, `INGEST_QUEUE` utuh |
| Variabel | Settings > Variables and secrets | kelima variabel teks dan keempat secret masih ada |
| Cron | Settings > Trigger events | `0 19 * * *` (atau jadwal live Anda) |
| Konsumer antrean | Queues > queue ingest | terhubung ke `lexa`, DLQ sesuai |
| Aset statis (bila ada) | buka `/` | aplikasi tampil |
| API | `/api/stats`, `/api/search?q=pesangon`, `/robots.txt`, `/sitemap.xml` | 200 dengan data |
| Token admin | `GET /api/admin/cek-token` dengan header `x-admin-token` | `secret_terpasang: true`, `cocok: true` |
| Cron berjalan | D1: `SELECT * FROM sync_log ORDER BY id DESC LIMIT 5;` | entri `jadwal_sinkronisasi` baru sekitar 19:00 UTC |

### Rollback

Dashboard > `lexa` > **Deployments** > pilih versi sebelumnya > **Rollback** (atau `npx wrangler rollback`).
Rollback mengembalikan kode dan konfigurasi Worker, **bukan** data D1 maupun migrasi yang sudah diterapkan.

## Migrasi D1 dan pipeline

Jangan menjalankan migrasi dari build. Terapkan secara sengaja sebelum men-deploy kode yang membutuhkannya:
`npm run d1:migrate:remote`. Rancang migrasi agar kompatibel mundur (tambah dulu, hapus kemudian), supaya
rollback kode tetap aman. Sebelum migrasi besar, catat bookmark D1 Time Travel.

## Rahasia

Rahasia tidak pernah masuk Git. Karena deploy dilakukan oleh Workers Builds di sisi Cloudflare, GitHub
Actions **tidak** membutuhkan token Cloudflare; CI di repo ini (`.github/workflows/ci.yml`) hanya
menjalankan typecheck, tes, bundling, dan migrasi pada D1 kosong.

## Jebakan yang perlu diingat

- Nama Worker di dashboard harus sama dengan `name` di `wrangler.jsonc`.
- Variabel yang hanya ada di dashboard dihapus oleh deploy kecuali tercantum di `vars` atau `keep_vars` aktif.
- Deploy tanpa blok `assets` menghapus aset statis dari versi baru.
- `wrangler.jsonc` adalah sumber kebenaran: setelan yang diubah manual di dashboard akan tertimpa deploy
  berikutnya. Ubah lewat Git.
- Memutus koneksi: Settings > Builds > Disconnect. Worker tetap berjalan dengan versi terakhir.

## Alternatif: deploy lewat GitHub Actions

Bila Anda memilih tidak memakai Workers Builds, tambahkan secret repo `CLOUDFLARE_API_TOKEN` dan
`CLOUDFLARE_ACCOUNT_ID` lalu langkah deploy dengan `cloudflare/wrangler-action`. Itu sengaja tidak
dikonfigurasi di sini karena butuh token berhak tulis ke akun Anda.
