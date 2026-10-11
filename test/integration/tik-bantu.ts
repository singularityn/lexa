/**
 * Pembantu bersama tes tik, katalog, isi, dan antrean: waktu tetap, keadaan awal yang membuat tik fokus pada satu
 * langkah, dan penyisipan baris katalog berstatus tertentu.
 */
import { konteksIngestUji, type Lingkungan } from "./harness";
import { jalankanTik } from "../../src/worker/lib/tik";
import { KUNCI_DIAG, PEMERIKSAAN } from "../../src/worker/lib/diagnosa";
import { hitungGiliran } from "../../src/worker/lib/isi";
import { JENIS_KATALOG } from "../../src/worker/lib/katalog";

export const WAKTU = Date.parse("2026-10-11T12:00:00Z");
export const menit = (n: number) => WAKTU + n * 60_000;

export const tik = (l: Lingkungan, sekarang = WAKTU, pasalSiap = true) =>
  jalankanTik(konteksIngestUji(l), { pasalSiap, sekarang });

/** Semua pemeriksaan diagnosis dianggap selesai, supaya anggaran permintaan tik dipakai langkah yang diuji. */
export async function tanamSemuaDiagnosa(l: Lingkungan) {
  for (const p of PEMERIKSAAN) {
    await l.db.prepare(`INSERT OR IGNORE INTO sync_state (key, value) VALUES (?, '{}')`).bind(KUNCI_DIAG + p.kunci).run();
  }
}

/** Semua jenis katalog dianggap baru selesai disapu, jadi tik tidak menyapu apa pun. */
export async function tanamKatalogSelesai(l: Lingkungan, sekarang = WAKTU) {
  for (const j of JENIS_KATALOG) {
    await l.db
      .prepare(`INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)`)
      .bind(`katalog_selesai:${j}`, new Date(sekarang).toISOString())
      .run();
  }
}

export interface BarisAntre {
  uri: string;
  jenis?: string;
  tahun?: number;
  nomor?: string;
  judul?: string;
  status?: "menunggu" | "lengkap" | "kosong" | "gagal";
  verifikasi?: boolean | null;
  jumlahPasal?: number;
  arsip?: boolean;
  giliran?: number;
  percobaan?: number;
}

/** Sisipkan peraturan dengan status isi tertentu (seperti hasil katalog atau pengambilan sebelumnya). */
export async function sisipkanAntre(l: Lingkungan, daftar: BarisAntre[]) {
  for (const b of daftar) {
    const jenis = b.jenis ?? "UU";
    const tahun = b.tahun ?? 2000;
    const [, , , , , t, n] = b.uri.split("/");
    await l.db
      .prepare(
        `INSERT INTO laws (frbr_uri, jenis, nomor, tahun, judul, jumlah_pasal, isi_status, isi_giliran, isi_diverifikasi, isi_arsip, isi_percobaan)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        b.uri, jenis, b.nomor ?? n ?? "1", tahun || Number(t), b.judul ?? `Peraturan ${b.uri}`, b.jumlahPasal ?? 0,
        b.status ?? "menunggu", b.giliran ?? hitungGiliran(jenis, tahun, b.verifikasi ?? null),
        b.verifikasi === undefined || b.verifikasi === null ? null : b.verifikasi ? 1 : 0, b.arsip ? 1 : 0, b.percobaan ?? 0,
      )
      .run();
  }
}

export const baris = async <T = Record<string, unknown>>(l: Lingkungan, sql: string, ...nilai: unknown[]) =>
  (await l.db.prepare(sql).bind(...nilai).all<T>()).results;

export const satu = async <T = Record<string, unknown>>(l: Lingkungan, sql: string, ...nilai: unknown[]) =>
  l.db.prepare(sql).bind(...nilai).first<T>();

export const hitungBaris = async (l: Lingkungan, tabel: string, kondisi = "1") =>
  (await l.db.prepare(`SELECT COUNT(*) AS n FROM ${tabel} WHERE ${kondisi}`).first<{ n: number }>())?.n ?? 0;
