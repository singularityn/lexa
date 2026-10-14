-- Migrasi 0008: catatan pembacaan PDF oleh AI (Gemini).
--
-- Konversi bawaan (Workers AI toMarkdown) hanya membaca lapisan teks sebuah PDF. Pindaian tanpa lapisan teks, atau dengan
-- lapisan teks yang rusak, tak menghasilkan pasal. Untuk peraturan semacam itu, Lexa dapat meminta Gemini membaca halaman PDF
-- sebagai gambar (POST /api/impor/ekstrak-ulang { gemini: true }). Satu baris per peraturan: hasil percobaan terakhir.
--
--   dipakai        teks Gemini lolos pemeriksaan dan menggantikan pasal yang tersimpan
--   dipertahankan  teks Gemini lolos pemeriksaan, tetapi pasal yang tersimpan lebih utuh sehingga tidak diganti
--   ditolak        teks Gemini tak lolos pemeriksaan (halaman terlewat, pengulangan, terlalu banyak [tidak terbaca], ...)
--   gagal          Gemini menolak atau tak dapat membacanya (diblokir, PDF terlalu besar, kunci tak sah, ...)
--   digantikan     teks Gemini pernah dipakai, lalu pasalnya digantikan konversi PDF yang lebih baru (antarmuka tak lagi
--                  menyebutnya bacaan AI); baris dipertahankan supaya peraturan ini tak dibaca ulang dengan biaya baru
--   uji            percobaan kering (POST /api/impor/gemini-uji): tak menulis pasal; tak menggugurkan baris lain
--
-- Hanya menambah tabel; kode menahan galatnya bila migrasi belum diterapkan (jalur Gemini saja yang tak tercatat).

CREATE TABLE IF NOT EXISTS pembacaan_ai (
  frbr_uri     TEXT PRIMARY KEY REFERENCES laws(frbr_uri) ON DELETE CASCADE,
  hasil        TEXT NOT NULL CHECK (hasil IN ('dipakai','dipertahankan','ditolak','gagal','digantikan','uji')),
  model        TEXT,
  catatan      TEXT,
  halaman      INTEGER NOT NULL DEFAULT 0,
  putaran      INTEGER NOT NULL DEFAULT 0,
  token_masuk  INTEGER NOT NULL DEFAULT 0,
  token_keluar INTEGER NOT NULL DEFAULT 0,
  token_pikir  INTEGER NOT NULL DEFAULT 0,
  durasi_ms    INTEGER,
  vonis_baru   TEXT,
  pasal_baru   INTEGER NOT NULL DEFAULT 0,
  percobaan    INTEGER NOT NULL DEFAULT 1,
  dicoba_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pembacaan_ai_hasil ON pembacaan_ai (hasil);
