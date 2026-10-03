-- Migrasi 0000: pada basis data produksi, migrasi ini menghapus skema percobaan
-- awal sebelum 0001 diterapkan. Isi aslinya tidak tersedia, dan pada basis data
-- baru memang tidak ada yang perlu dihapus.
--
-- CATATAN PENTING tentang berkas di folder ini
-- Kelima migrasi (0000..0004) DIREKONSTRUKSI pada 3 Okt 2026 dari skema produksi
-- (tabel sqlite_master pada D1 `lexa-db`), karena berkas aslinya tidak ada di Git.
-- Pembagian pernyataan ke dalam lima berkas adalah perkiraan; yang dijamin sama
-- adalah skema akhirnya.
--
-- Nama berkas SENGAJA sama dengan yang tercatat di tabel d1_migrations produksi
-- (0000_hapus_skema_lama, 0001_initial_schema, 0002_log_ekstraksi,
-- 0003_fitur_lanjutan, 0004_akun). Dengan begitu `wrangler d1 migrations apply
-- --remote` menganggapnya sudah diterapkan di produksi dan tidak
-- menjalankannya lagi. Pada basis data baru (lokal atau staging), urutan
-- 0000..0004 menghasilkan skema yang sama dengan produksi.
--
-- Migrasi berikutnya: beri nomor 0005 dan seterusnya, jangan mengubah berkas ini.

DROP TABLE IF EXISTS _lexa_skema_lama;
