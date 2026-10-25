-- Migrasi 0010: permintaan PDF dari pembaca.
--
-- Peraturan tanpa PDF di Lexa menawarkan tombol "Minta PDF ini" (POST /api/dokumen/minta). Permintaan dicatat di sini, satu baris
-- per peraturan dengan jumlah peminatnya, dan didahulukan di antrean panen (GET /api/impor/butuh-teks), sehingga PDF yang paling
-- dicari pembaca yang pertama dipanen dari BPK. Baris tak dihapus saat PDF-nya masuk (tak berpengaruh: antrean hanya memuat yang
-- belum ber-PDF), dan tak berelasi ke `laws` agar tak menghalangi pembersihan peraturan.
--
-- Tabel baru saja (kode lama mengabaikannya): terapkan SEBELUM men-deploy kode yang menulisnya.
CREATE TABLE IF NOT EXISTS permintaan_pdf (
  frbr_uri  TEXT PRIMARY KEY,
  jumlah    INTEGER NOT NULL DEFAULT 1,
  pertama   TEXT NOT NULL DEFAULT (datetime('now')),
  terakhir  TEXT NOT NULL DEFAULT (datetime('now'))
);
