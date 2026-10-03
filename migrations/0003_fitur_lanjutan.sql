-- Migrasi 0003: fitur lanjutan.
-- Laporan kesalahan dari pengguna dan log pencarian (untuk saran ketik dan
-- analisis kueri tanpa hasil). (Direkonstruksi dari skema produksi; lihat
-- catatan di 0000_hapus_skema_lama.sql.)

CREATE TABLE IF NOT EXISTS laporan_kesalahan (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  frbr_uri   TEXT NOT NULL,
  jenis      TEXT NOT NULL
               CHECK (jenis IN ('teks_salah','metadata_salah','pasal_hilang','status_salah','pdf_rusak','lainnya')),
  keterangan TEXT NOT NULL,
  konteks    TEXT,
  status     TEXT NOT NULL DEFAULT 'baru'
               CHECK (status IN ('baru','diperiksa','diteruskan','ditutup')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_laporan_status ON laporan_kesalahan (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_laporan_uri    ON laporan_kesalahan (frbr_uri);

CREATE TABLE IF NOT EXISTS search_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  query        TEXT NOT NULL,
  jumlah_hasil INTEGER NOT NULL DEFAULT 0,
  mode         TEXT NOT NULL DEFAULT 'hybrid',
  durasi_ms    INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_search_log_created ON search_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_log_nihil   ON search_log (jumlah_hasil, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_log_query   ON search_log (query);
