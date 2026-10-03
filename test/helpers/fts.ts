/**
 * Pembantu untuk menguji ekspresi MATCH terhadap FTS5 SUNGGUHAN (SQLite bawaan
 * Node), dengan tokenizer yang sama seperti tabel `laws_fts` dan `articles_fts`.
 *
 * Mengapa perlu: ekspresi yang salah sintaks hanya terlihat saat dieksekusi,
 * dan di produksi galatnya ditelan (`.catch(() => [])`), jadi jalur kata kunci
 * berubah kosong tanpa jejak.
 */
import { createRequire } from "node:module";

type Db = {
  exec(sql: string): void;
  prepare(sql: string): { all(...params: unknown[]): Record<string, unknown>[] };
  close(): void;
};

export interface IndeksUji {
  /** Jalankan MATCH; mengembalikan jumlah baris, atau melempar galat SQLite. */
  cocok(ekspresi: string): number;
  tutup(): void;
}

/** Buat indeks FTS5 kecil; mengembalikan null bila FTS5 tidak tersedia di Node ini. */
export function bukaIndeksUji(dokumen: string[]): IndeksUji | null {
  // Modul bawaan (node:sqlite) tidak bergantung pada lokasi berkas, jadi basis
  // path-nya bebas; ini menghindari ketergantungan pada tipe ImportMeta.url.
  const require = createRequire("file:///tes.js");
  let db: Db;
  try {
    const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (p: string) => Db };
    db = new DatabaseSync(":memory:");
    db.exec(
      `CREATE VIRTUAL TABLE t USING fts5(isi, tokenize = 'unicode61 remove_diacritics 2 tokenchars ''-''')`,
    );
  } catch {
    return null;
  }
  for (const d of dokumen) db.exec(`INSERT INTO t(isi) VALUES ('${d.replace(/'/g, "''")}')`);
  return {
    cocok(ekspresi: string) {
      const baris = db.prepare("SELECT COUNT(*) AS n FROM t WHERE t MATCH ?").all(ekspresi);
      return Number(baris[0]?.n ?? 0);
    },
    tutup() {
      db.close();
    },
  };
}
