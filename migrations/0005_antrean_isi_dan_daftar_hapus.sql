-- Migrasi 0005: pelacak isi peraturan, daftar hapus objek di luar D1, dan pemicu FTS yang lebih hemat.
--
-- Sebelumnya antrean pekerjaan hanya ada di Cloudflare Queues: pesan yang kena batas laju pasal.id habis jatah
-- percobaannya lalu terbuang ke dead-letter queue, dan peraturan yang memang tak punya isi diambil ulang tanpa akhir
-- (di produksi 414 peraturan "menunggu isi" menahan sapuan sejak 8 Okt 2026). Kini setiap peraturan membawa
-- statusnya sendiri di tabel laws, dan Cron per menit mengerjakannya satu per satu dengan jeda yang dipatuhi.
--
-- Skema ini kompatibel mundur: semua kolom baru punya nilai bawaan, jadi kode lama tetap bisa menulis ke laws.

-- ---------------------------------------------------------------------------
-- Pemicu FTS. laws_au sebelumnya menyala pada SETIAP UPDATE laws dan menulis ulang entri indeks teks penuh walau
-- kolom yang berubah (jumlah_pasal, indexed_at, kolom isi_* di bawah) tidak ada di indeks. Kini hanya untuk kolom
-- yang memang diindeks (judul, tentang, ringkasan), sehingga pencatatan kemajuan tak menambah beban tulis FTS.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS laws_au;
CREATE TRIGGER laws_au AFTER UPDATE OF judul, tentang, ringkasan ON laws BEGIN
  INSERT INTO laws_fts (laws_fts, rowid, judul, tentang, ringkasan)
  VALUES ('delete', old.rowid, old.judul, old.tentang, old.ringkasan);
  INSERT INTO laws_fts (rowid, judul, tentang, ringkasan)
  VALUES (new.rowid, new.judul, new.tentang, new.ringkasan);
END;

-- ---------------------------------------------------------------------------
-- Pelacak isi per peraturan.
--   isi_status       menunggu : isinya belum diambil (atau perlu diambil ulang)
--                    lengkap  : pasal tersimpan dari sumber
--                    kosong   : sumber menjawab tanpa pasal (dicoba ulang jarang)
--                    gagal    : galat berulang, perlu diperiksa manual
--   isi_giliran      urutan pengambilan: kecil dikerjakan dulu (lihat src/worker/lib/isi.ts, hitungGiliran)
--   isi_percobaan    jumlah percobaan yang belum berhasil sejak terakhir sukses
--   isi_dicoba_at    percobaan terakhir; isi_diambil_at: pengambilan berhasil terakhir
--   isi_diverifikasi bendera content_verified dari daftar pasal.id (1/0), NULL bila belum diketahui
--   isi_akses        nilai detail_access dari respons detail pasal.id (diagnosis)
--   isi_catatan      catatan singkat bila hasilnya janggal (mis. ringkasan struktur pohon yang tak menghasilkan pasal)
-- ---------------------------------------------------------------------------
ALTER TABLE laws ADD COLUMN isi_status       TEXT    NOT NULL DEFAULT 'menunggu';
ALTER TABLE laws ADD COLUMN isi_giliran      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE laws ADD COLUMN isi_percobaan    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE laws ADD COLUMN isi_dicoba_at    TEXT;
ALTER TABLE laws ADD COLUMN isi_diambil_at   TEXT;
ALTER TABLE laws ADD COLUMN isi_diverifikasi INTEGER;
ALTER TABLE laws ADD COLUMN isi_akses        TEXT;
ALTER TABLE laws ADD COLUMN isi_catatan      TEXT;

-- Baris yang sudah punya pasal dianggap lengkap sampai terbukti sebaliknya; sisanya menunggu. Rumus giliran sama
-- dengan hitungGiliran() di kode untuk peraturan yang belum diketahui bendera verifikasinya:
-- 100.000.000 (belum terverifikasi) + peringkat jenis * 10.000.000 + (9999 - tahun) * 1.000.
UPDATE laws SET isi_status = 'lengkap', isi_diambil_at = updated_at WHERE jumlah_pasal > 0;
UPDATE laws SET isi_giliran = 100000000
  + (CASE jenis WHEN 'UUD' THEN 0 WHEN 'TAP_MPR' THEN 1 WHEN 'UU' THEN 2 WHEN 'PERPPU' THEN 3 WHEN 'PP' THEN 4 ELSE 9 END) * 10000000
  + (9999 - tahun) * 1000
 WHERE isi_status = 'menunggu';

-- Indeks sebagian: memilih peraturan berikutnya membaca satu baris, bukan memindai tabel pada setiap menit.
-- Jangan menambah indeks lain yang diawali isi_status: dengan keduanya, perencana kueri memilih indeks biasa lalu
-- mengurutkan semua baris "menunggu" di tabel sementara (diperiksa dengan EXPLAIN QUERY PLAN di produksi).
CREATE INDEX IF NOT EXISTS idx_laws_isi_antre ON laws (isi_giliran) WHERE isi_status = 'menunggu';
-- "Peraturan terbaru" di beranda dan halaman status mengurutkan menurut created_at.
CREATE INDEX IF NOT EXISTS idx_laws_dibuat ON laws (created_at DESC);

-- ---------------------------------------------------------------------------
-- Daftar hapus. Menghapus peraturan dari D1 (mis. jenis di luar cakupan) tidak menghapus berkas teks di R2 maupun
-- vektornya di Vectorize, yang hanya bisa dijangkau lewat binding Worker. Kuncinya dicatat di sini lebih dulu,
-- lalu Cron per menit mengosongkannya sedikit demi sedikit dan menghapus barisnya setelah berhasil.
--   jenis_objek 'r2'     : kunci objek di bucket DOCS
--   jenis_objek 'vektor' : id vektor di indeks VECTORIZE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daftar_hapus (
  jenis_objek TEXT NOT NULL CHECK (jenis_objek IN ('r2', 'vektor')),
  kunci       TEXT NOT NULL,
  dibuat_pada TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (jenis_objek, kunci)
) WITHOUT ROWID;
