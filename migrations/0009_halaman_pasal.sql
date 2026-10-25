-- Migrasi 0009: nomor halaman PDF tempat tiap pasal dimulai.
--
-- Konversi PDF dan bacaan Gemini menyisipkan penanda "### Page n" di batas halaman, yang dulu dibuang pengurai. Kini nomornya
-- dipulihkan (lib/petaHalaman.ts) dan disimpan per baris pasal, supaya antarmuka bisa membuka halaman PDF sebuah pasal seketika,
-- juga pada PDF pindaian yang tak punya lapisan teks untuk dipindai di peramban. Null = halaman tak diketahui (naskah lama tanpa
-- penanda halaman); baris terisi lewat uraian ulang `usang` (VERSI_PARSER 5).
--
-- Menambah kolom saja (kode lama mengabaikannya): terapkan SEBELUM men-deploy kode yang menulisnya.
ALTER TABLE articles ADD COLUMN halaman INTEGER;

-- Indeks teks penuh hanya memuat `isi` dan `judul`. Pemicu lama berjalan pada setiap UPDATE, jadi mengisi `halaman` pada puluhan ribu
-- baris akan membangun ulang entri FTS yang tak berubah. Dibatasi pada kolom yang memang diindeks.
DROP TRIGGER IF EXISTS articles_au;
CREATE TRIGGER articles_au AFTER UPDATE OF isi, judul ON articles BEGIN
  INSERT INTO articles_fts (articles_fts, rowid, isi, judul)
  VALUES ('delete', old.rowid, old.isi, old.judul);
  INSERT INTO articles_fts (rowid, isi, judul)
  VALUES (new.rowid, new.isi, new.judul);
END;
