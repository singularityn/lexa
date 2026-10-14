-- Migrasi 0007: Penjelasan peraturan per pasal, dan versi pengurai pada log ekstraksi.
--
-- Penjelasan ("Penjelasan Umum" dan "Pasal demi pasal") dulu terbuang atau, lebih buruk, tersimpan sebagai pasal kembar di
-- ujung peraturan. Kini diurai terpisah (lib/penjelasan.ts) dan disimpan di tabel sendiri, supaya bisa ditampilkan tepat di
-- bawah pasal yang dijelaskannya tanpa ikut masuk ke indeks pencarian, vektor, maupun hitungan pasal.
--   nomor_pasal : seperti articles.nomor_pasal ("5", "12A", "II"); 'Umum' untuk Penjelasan Umum.
--   urutan      : 0 untuk Penjelasan Umum, lalu urutan kemunculan di naskah.
--
-- versi_parser mencatat versi pengurai (VERSI_PARSER di lib/bpk.ts) yang menghasilkan pasal tersimpan. Baris yang sudah ada
-- bernilai 0, jadi semuanya ditawarkan ke ekstrak-ulang mode `usang` (POST /api/impor/ekstrak-ulang {"usang": true}),
-- yang menguraikan ulang arsip teksnya di R2 tanpa konversi PDF.
--
-- Kompatibel mundur: kode yang belum mengenal tabel dan kolom ini tetap berjalan, dan kode baru menahan galat bila
-- migrasi belum diterapkan (penjelasan tidak disimpan, ekstrak-ulang `usang` menjawab 503 dengan petunjuk).

CREATE TABLE IF NOT EXISTS penjelasan (
  frbr_uri    TEXT NOT NULL REFERENCES laws(frbr_uri) ON DELETE CASCADE,
  nomor_pasal TEXT NOT NULL,
  isi         TEXT NOT NULL,
  urutan      INTEGER NOT NULL,
  PRIMARY KEY (frbr_uri, nomor_pasal)
) WITHOUT ROWID;

ALTER TABLE ekstraksi_log ADD COLUMN versi_parser INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ekstraksi_versi ON ekstraksi_log (versi_parser);
