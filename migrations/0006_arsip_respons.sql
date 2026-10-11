-- Migrasi 0006: penanda arsip respons pasal.id, dan indeks antrean yang membedakan "perlu diambil" dari "cukup diuraikan ulang".
--
-- Jatah permintaan ke pasal.id-lah yang membatasi pipeline (di produksi 429 datang setelah belasan permintaan),
-- sedangkan pengolahan di Worker murah. Karena itu respons detail disimpan apa adanya di R2 (mentah/<uri>.json.gz)
-- dan penanda isi_arsip = 1 menandakan arsipnya ada. Peraturan yang berstatus 'menunggu' dengan isi_arsip = 1 cukup
-- diuraikan ulang dari arsip (tanpa menghubungi pasal.id), mis. sesudah pengurai pasal diperbaiki; yang isi_arsip = 0
-- harus diambil dari pasal.id.

ALTER TABLE laws ADD COLUMN isi_arsip INTEGER NOT NULL DEFAULT 0;

-- Satu indeks sebagian melayani kedua pertanyaan ("yang berikutnya diambil", "yang berikutnya diuraikan ulang"),
-- masing-masing membaca satu sampai beberapa baris. Jangan menambah indeks lain yang diawali isi_status: perencana
-- kueri lalu memilihnya dan mengurutkan semua baris "menunggu" di tabel sementara.
DROP INDEX IF EXISTS idx_laws_isi_antre;
CREATE INDEX IF NOT EXISTS idx_laws_isi_antre ON laws (isi_arsip, isi_giliran) WHERE isi_status = 'menunggu';
