-- Migrasi 0001: skema inti Lexa.
-- Peraturan, pasal, relasi antar-peraturan, indeks pencarian teks penuh (FTS5),
-- serta status dan log sinkronisasi. (Direkonstruksi dari skema produksi; lihat
-- catatan di 0000_hapus_skema_lama.sql.)

-- Satu baris per peraturan. Kunci utama memakai URI gaya FRBR/Akoma Ntoso,
-- mis. /akn/id/act/uu/2003/13.
CREATE TABLE IF NOT EXISTS laws (
  frbr_uri          TEXT PRIMARY KEY,
  jenis             TEXT NOT NULL,        -- UU, PP, PERPRES, PERMEN, POJK, ...
  nomor             TEXT NOT NULL,
  tahun             INTEGER NOT NULL,
  judul             TEXT NOT NULL,
  tentang           TEXT,
  status            TEXT NOT NULL DEFAULT 'berlaku'
                      CHECK (status IN ('berlaku','dicabut','diubah')),
  tanggal_penetapan TEXT,
  tanggal_berlaku   TEXT,
  instansi          TEXT,
  bidang            TEXT,
  bpk_id            TEXT,                 -- ID dokumen di peraturan.bpk.go.id
  sumber_url        TEXT,
  r2_pdf_key        TEXT,                 -- kunci objek PDF di bucket R2
  r2_text_key       TEXT,                 -- kunci objek teks di bucket R2
  ringkasan         TEXT,
  jumlah_pasal      INTEGER NOT NULL DEFAULT 0,
  indexed_at        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Satu baris per pasal atau ayat.
CREATE TABLE IF NOT EXISTS articles (
  id          TEXT PRIMARY KEY,
  frbr_uri    TEXT NOT NULL REFERENCES laws(frbr_uri) ON DELETE CASCADE,
  nomor_pasal TEXT NOT NULL,
  ayat        TEXT,
  bab         TEXT,
  bagian      TEXT,
  judul       TEXT,
  isi         TEXT NOT NULL,
  urutan      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Hubungan antar-peraturan (mengubah, mencabut, dasar hukum, dan seterusnya).
CREATE TABLE IF NOT EXISTS relations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  from_uri     TEXT NOT NULL REFERENCES laws(frbr_uri) ON DELETE CASCADE,
  to_uri       TEXT NOT NULL,
  jenis_relasi TEXT NOT NULL
                 CHECK (jenis_relasi IN (
                   'mengubah','diubah_oleh','mencabut','dicabut_oleh',
                   'dasar_hukum','menjadi_dasar_hukum','melaksanakan','dilaksanakan_oleh','terkait'
                 )),
  keterangan   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (from_uri, to_uri, jenis_relasi)
);

-- Kursor sinkronisasi (mis. kunci "offset:UU") dan jejak eksekusi pekerjaan.
CREATE TABLE IF NOT EXISTS sync_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  job       TEXT NOT NULL,
  status    TEXT NOT NULL CHECK (status IN ('mulai','sukses','gagal')),
  detail    TEXT,
  jumlah    INTEGER NOT NULL DEFAULT 0,
  durasi_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indeks biasa
CREATE INDEX IF NOT EXISTS idx_laws_jenis_tahun ON laws (jenis, tahun DESC);
CREATE INDEX IF NOT EXISTS idx_laws_tahun       ON laws (tahun DESC);
CREATE INDEX IF NOT EXISTS idx_laws_status      ON laws (status);
CREATE INDEX IF NOT EXISTS idx_laws_instansi    ON laws (instansi);
CREATE INDEX IF NOT EXISTS idx_laws_bidang      ON laws (bidang, tahun DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_laws_citation ON laws (jenis, nomor, tahun);
CREATE INDEX IF NOT EXISTS idx_articles_law     ON articles (frbr_uri, urutan);
CREATE INDEX IF NOT EXISTS idx_articles_nomor   ON articles (frbr_uri, nomor_pasal);
CREATE INDEX IF NOT EXISTS idx_relations_from   ON relations (from_uri, jenis_relasi);
CREATE INDEX IF NOT EXISTS idx_relations_to     ON relations (to_uri, jenis_relasi);
CREATE INDEX IF NOT EXISTS idx_sync_log_created ON sync_log (created_at DESC);

-- Indeks teks penuh (FTS5) dengan konten eksternal: teks asli tetap di tabel
-- laws/articles, dan trigger di bawah menjaga keduanya tetap sinkron.
CREATE VIRTUAL TABLE IF NOT EXISTS laws_fts USING fts5(
  judul,
  tentang,
  ringkasan,
  content = 'laws',
  content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2 tokenchars ''-'''
);

CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
  isi,
  judul,
  content = 'articles',
  content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2 tokenchars ''-'''
);

CREATE TRIGGER IF NOT EXISTS laws_ai AFTER INSERT ON laws BEGIN
  INSERT INTO laws_fts (rowid, judul, tentang, ringkasan)
  VALUES (new.rowid, new.judul, new.tentang, new.ringkasan);
END;

CREATE TRIGGER IF NOT EXISTS laws_ad AFTER DELETE ON laws BEGIN
  INSERT INTO laws_fts (laws_fts, rowid, judul, tentang, ringkasan)
  VALUES ('delete', old.rowid, old.judul, old.tentang, old.ringkasan);
END;

CREATE TRIGGER IF NOT EXISTS laws_au AFTER UPDATE ON laws BEGIN
  INSERT INTO laws_fts (laws_fts, rowid, judul, tentang, ringkasan)
  VALUES ('delete', old.rowid, old.judul, old.tentang, old.ringkasan);
  INSERT INTO laws_fts (rowid, judul, tentang, ringkasan)
  VALUES (new.rowid, new.judul, new.tentang, new.ringkasan);
END;

CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts (rowid, isi, judul)
  VALUES (new.rowid, new.isi, new.judul);
END;

CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts (articles_fts, rowid, isi, judul)
  VALUES ('delete', old.rowid, old.isi, old.judul);
END;

CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
  INSERT INTO articles_fts (articles_fts, rowid, isi, judul)
  VALUES ('delete', old.rowid, old.isi, old.judul);
  INSERT INTO articles_fts (rowid, isi, judul)
  VALUES (new.rowid, new.isi, new.judul);
END;
