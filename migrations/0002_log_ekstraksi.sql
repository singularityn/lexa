-- Migrasi 0002: log kualitas ekstraksi PDF -> pasal.
-- Satu baris per peraturan; "vonis" merangkum mutu hasil ekstraksi teks.
-- (Direkonstruksi dari skema produksi; lihat catatan di 0000_hapus_skema_lama.sql.)

CREATE TABLE IF NOT EXISTS ekstraksi_log (
  frbr_uri           TEXT PRIMARY KEY REFERENCES laws(frbr_uri) ON DELETE CASCADE,
  r2_pdf_key         TEXT,
  ukuran_pdf         INTEGER NOT NULL DEFAULT 0,
  panjang_teks       INTEGER NOT NULL DEFAULT 0,
  jumlah_pasal       INTEGER NOT NULL DEFAULT 0,
  jumlah_ayat        INTEGER NOT NULL DEFAULT 0,
  pasal_tertinggi    INTEGER NOT NULL DEFAULT 0,
  celah_pasal        INTEGER NOT NULL DEFAULT 0,
  angka_tercemar     INTEGER NOT NULL DEFAULT 0,
  simbol_liar        INTEGER NOT NULL DEFAULT 0,
  artefak_halaman    INTEGER NOT NULL DEFAULT 0,
  kerusakan_per_1000 REAL NOT NULL DEFAULT 0,
  -- bersih: < 0,5 indikator kerusakan per 1.000 karakter; ringan: 0,5-2;
  -- berat: >= 2; tanpa_pasal: teks terbaca tetapi tidak ada pasal terdeteksi;
  -- gagal: konversi PDF gagal sama sekali.
  vonis              TEXT NOT NULL
                       CHECK (vonis IN ('bersih','ringan','berat','tanpa_pasal','gagal')),
  durasi_ms          INTEGER,
  catatan            TEXT,
  tahun_dokumen      INTEGER,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ekstraksi_tahun ON ekstraksi_log (tahun_dokumen);
CREATE INDEX IF NOT EXISTS idx_ekstraksi_vonis ON ekstraksi_log (vonis);
