/**
 * Halaman PDF tempat tiap pasal dimulai (migrasi 0009, lib/petaHalaman.ts): disimpan saat ekstraksi, dilengkapi pada uraian ulang
 * naskah yang sama tanpa menulis ulang barisnya, dan dibawa oleh /api/laws/detail. Pipeline dasarnya diuji di pipeline.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VERSI_PARSER } from "../../src/worker/lib/bpk";
import { baris, buatLingkungan, jalankanAntrean, json, panggil, satu, sisipkan, sqliteAda, type Lingkungan } from "./harness";

const URI = "/akn/id/act/pp/2025/99";
const KUNCI_PDF = "pdf/akn/id/act/pp/2025/99.pdf";
const KUNCI_MD = "teks/akn/id/act/pp/2025/99.md";
const PDF = new TextEncoder().encode("%PDF-1.4\n...isi pdf palsu...");

const P = (n: number) => `\n\n\n\n### Page ${n}\n`;

/** Konversi bawaan: halaman 1 tanpa penanda, kepala cetak di awal halaman berikutnya, Penjelasan di halaman terakhir. */
const NASKAH = [
  "BAB I\nKETENTUAN UMUM\nPasal 1\nSampah rumah tangga adalah sampah dari kegiatan sehari-hari.",
  `${P(2)}PRESIDEN\nREPUBLIK INDONESIA- 2 -Pasal 2\n(1) Setiap orang wajib memilah sampah.\n(2) Pemerintah daerah menyediakan fasilitas pengelolaan sampah.`,
  `${P(3)}Pasal 3\nKetentuan lebih lanjut diatur dengan Peraturan Menteri.`,
  `${P(4)}PENJELASAN\nATAS PERATURAN PEMERINTAH\nI. UMUM\nSampah menimbulkan masalah.\nII. PASAL DEMI PASAL\nPasal 1\nCukup jelas.\nPasal 2\nCukup jelas.`,
].join("");

const pesan = (ubah: Record<string, unknown> = {}) => ({ tipe: "ekstrak_pdf", frbr_uri: URI, r2_key: KUNCI_PDF, ...ubah });

describe.skipIf(!sqliteAda)("halaman PDF tiap pasal", () => {
  let l: Lingkungan;
  beforeEach(async () => {
    l = buatLingkungan();
    await sisipkan(l, [{ uri: URI, jenis: "PP", nomor: "99", tahun: 2025, judul: "Pengelolaan Sampah", bpkId: "555" }]);
    await l.db.prepare(`UPDATE laws SET r2_pdf_key = ? WHERE frbr_uri = ?`).bind(KUNCI_PDF, URI).run();
    l.r2.objek.set(KUNCI_PDF, { bytes: PDF });
    l.ai.markdown.set("99.pdf", NASKAH);
    l.ai.jawaban = "Ringkasan AI.";
  });
  afterEach(() => l.tutup());

  const ekstrak = (ubah: Record<string, unknown> = {}) => jalankanAntrean(l, [pesan(ubah)]);
  const halamanTersimpan = () => baris<{ nomor_pasal: string; ayat: string | null; halaman: number | null }>(l, `SELECT nomor_pasal, ayat, halaman FROM articles ORDER BY urutan`);

  it("ekstraksi menyimpan halaman tiap pasal: ayat satu pasal sehalaman, halaman pertama tanpa penanda adalah 1, Penjelasan tak menggeser", async () => {
    expect(await ekstrak()).toEqual({ diakui: 1, diulang: [] });
    expect(await halamanTersimpan()).toEqual([
      { nomor_pasal: "1", ayat: null, halaman: 1 },
      { nomor_pasal: "2", ayat: "1", halaman: 2 },
      { nomor_pasal: "2", ayat: "2", halaman: 2 },
      { nomor_pasal: "3", ayat: null, halaman: 3 },
    ]);
  });

  it("naskah tanpa penanda halaman: halamannya null, bukan 1", async () => {
    l.ai.markdown.set("99.pdf", "Pasal 1\nIsi satu yang cukup panjang.\nPasal 2\nIsi dua yang cukup panjang.");
    await ekstrak();
    expect(await halamanTersimpan()).toEqual([
      { nomor_pasal: "1", ayat: null, halaman: null },
      { nomor_pasal: "2", ayat: null, halaman: null },
    ]);
  });

  it("GET /api/laws/detail membawa halaman tiap baris pasal", async () => {
    await ekstrak();
    const d = await json<{ articles: Array<{ nomor_pasal: string; ayat: string | null; halaman: number | null }> }>(
      await panggil(l, `/api/laws/detail?uri=${encodeURIComponent(URI)}`),
    );
    expect(d.articles.map((a) => [a.nomor_pasal, a.ayat, a.halaman])).toEqual([["1", null, 1], ["2", "1", 2], ["2", "2", 2], ["3", null, 3]]);
  });

  it("uraian ulang naskah yang sama melengkapi halaman TANPA menulis ulang baris: rowid tetap, tak ada pesan indeks vektor baru", async () => {
    await ekstrak();
    await l.db.prepare(`UPDATE articles SET halaman = NULL`).run();
    await l.db.prepare(`UPDATE ekstraksi_log SET versi_parser = ?`).bind(VERSI_PARSER - 1).run();
    const rowidSebelum = await baris<{ rowid: number }>(l, `SELECT rowid FROM articles ORDER BY urutan`);
    const vektorSebelum = l.vektor.simpan.size;

    expect(await ekstrak({ dari_teks: true })).toEqual({ diakui: 1, diulang: [] });

    expect((await halamanTersimpan()).map((r) => r.halaman)).toEqual([1, 2, 2, 3]);
    expect(await baris(l, `SELECT rowid FROM articles ORDER BY urutan`)).toEqual(rowidSebelum);
    expect(l.vektor.simpan.size).toBe(vektorSebelum);
    expect(await satu(l, `SELECT versi_parser FROM ekstraksi_log`)).toEqual({ versi_parser: VERSI_PARSER });
  });

  it("halaman yang sudah benar tak ditulis lagi: tak ada UPDATE sama sekali pada uraian ulang yang tak berselisih", async () => {
    await ekstrak();
    const sql: string[] = [];
    const asli = l.db.prepare.bind(l.db);
    l.db.prepare = (s: string) => {
      sql.push(s);
      return asli(s);
    };
    await ekstrak({ dari_teks: true });
    expect(sql.filter((s) => /UPDATE articles/.test(s))).toEqual([]);
    expect(sql.filter((s) => /INSERT INTO articles/.test(s))).toEqual([]);
    expect((await halamanTersimpan()).map((r) => r.halaman)).toEqual([1, 2, 2, 3]);
  });

  it("halaman yang berselisih diperbarui satu per satu, hanya yang berbeda", async () => {
    await ekstrak();
    await l.db.prepare(`UPDATE articles SET halaman = 7 WHERE nomor_pasal = '3'`).run();
    const sql: string[] = [];
    const asli = l.db.prepare.bind(l.db);
    l.db.prepare = (s: string) => {
      sql.push(s);
      return asli(s);
    };
    await ekstrak({ dari_teks: true });
    expect(sql.filter((s) => /UPDATE articles SET halaman/.test(s))).toHaveLength(1);
    expect((await halamanTersimpan()).map((r) => r.halaman)).toEqual([1, 2, 2, 3]);
  });

  it("pemicu indeks teks penuh hanya berjalan bila isi atau judul berubah: mengisi halaman tak membangun ulang FTS", async () => {
    const pemicu = await satu<{ sql: string }>(l, `SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'articles_au'`);
    expect(pemicu?.sql).toMatch(/AFTER UPDATE OF isi, judul ON articles/);
    await ekstrak();
    await l.db.prepare(`UPDATE articles SET halaman = 99`).run();
    const cocok = await baris(l, `SELECT rowid FROM articles_fts WHERE articles_fts MATCH 'memilah'`);
    expect(cocok).toHaveLength(1);
    // Mengubah isi tetap memperbarui indeks.
    await l.db.prepare(`UPDATE articles SET isi = 'Setiap orang wajib mendaur ulang.' WHERE ayat = '1'`).run();
    expect(await baris(l, `SELECT rowid FROM articles_fts WHERE articles_fts MATCH 'memilah'`)).toHaveLength(0);
    expect(await baris(l, `SELECT rowid FROM articles_fts WHERE articles_fts MATCH 'mendaur'`)).toHaveLength(1);
  });

  it("migrasi 0009 belum diterapkan: detail tetap tampil (tanpa halaman), tak galat", async () => {
    await ekstrak();
    await l.db.exec(`ALTER TABLE articles DROP COLUMN halaman`);
    const res = await panggil(l, `/api/laws/detail?uri=${encodeURIComponent(URI)}`);
    expect(res.status).toBe(200);
    const d = await json<{ articles: Array<{ nomor_pasal: string; halaman?: number | null }> }>(res);
    expect(d.articles).toHaveLength(4);
    expect(d.articles.every((a) => a.halaman === undefined)).toBe(true);
  });

  it("arsip teks tersimpan utuh dengan penanda halaman, sumber uraian ulang berikutnya", async () => {
    await ekstrak();
    const arsip = await l.r2.get(KUNCI_MD);
    expect(await arsip?.text()).toContain("### Page 3");
  });
});
