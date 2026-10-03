-- Migrasi 0004: akun pengguna (login Google), koleksi, dan riwayat percakapan
-- tanya-jawab. Memuat data pribadi (email, nama, foto), jadi perlakukan sesuai
-- kebijakan privasi. (Direkonstruksi dari skema produksi; lihat catatan di
-- 0000_hapus_skema_lama.sql.)

CREATE TABLE IF NOT EXISTS pengguna (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL,
  nama           TEXT,
  foto_url       TEXT,
  dibuat_pada    TEXT NOT NULL DEFAULT (datetime('now')),
  terakhir_masuk TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pengguna_email ON pengguna (email);

CREATE TABLE IF NOT EXISTS koleksi (
  pengguna_id   TEXT NOT NULL REFERENCES pengguna(id) ON DELETE CASCADE,
  frbr_uri      TEXT NOT NULL,
  sitasi        TEXT NOT NULL,
  judul         TEXT NOT NULL,
  catatan       TEXT,
  disimpan_pada TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (pengguna_id, frbr_uri)
);

CREATE INDEX IF NOT EXISTS idx_koleksi_pengguna ON koleksi (pengguna_id, disimpan_pada DESC);

CREATE TABLE IF NOT EXISTS percakapan (
  id          TEXT PRIMARY KEY,
  pengguna_id TEXT REFERENCES pengguna(id) ON DELETE CASCADE,
  judul       TEXT,
  dibuat_pada TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pesan (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  percakapan_id TEXT NOT NULL REFERENCES percakapan(id) ON DELETE CASCADE,
  peran         TEXT NOT NULL CHECK (peran IN ('pengguna', 'asisten')),
  isi           TEXT NOT NULL,
  sitasi        TEXT,
  dibuat_pada   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pesan_percakapan ON pesan (percakapan_id, id);
