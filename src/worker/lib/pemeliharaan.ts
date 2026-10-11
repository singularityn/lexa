/**
 * Pemeliharaan harian (pemicu Cron harian, 02:00 WIB): hal yang perlu terjadi sesekali, bukan tiap menit.
 *
 *  - Peraturan 'kosong' (sumber menjawab tanpa pasal) dicoba lagi sebulan sekali: pasal.id bisa menambahkan isinya.
 *  - Peraturan 'gagal' (galat berulang) dicoba lagi tiap beberapa hari: gangguannya mungkin sudah lewat.
 *  - Catatan lama dipangkas: sync_log 90 hari, statistik harian 14 hari.
 * Sapuan katalog tidak dijadwalkan di sini: tik sendiri menyapu ulang tiap SIKLUS_HARI hari (lib/katalog.ts).
 */

import { klausaCakupan } from "../../shared/cakupan";
import { SQL_GILIRAN } from "./isi";
import type { KonteksIngest } from "./ingest";

export const ULANG_KOSONG_HARI = 30;
export const ULANG_GAGAL_HARI = 3;
export const SIMPAN_LOG_HARI = 90;
export const SIMPAN_STATISTIK_HARI = 14;

export interface LaporanPemeliharaan {
  kosongDiulang: number;
  gagalDiulang: number;
  logDipangkas: number;
}

export async function jalankanPemeliharaan(ctx: KonteksIngest): Promise<LaporanPemeliharaan> {
  const dalam = klausaCakupan(ctx.cakupan, "jenis");
  const antrekan = (status: string, hari: number) =>
    ctx.db
      .prepare(
        `UPDATE laws SET isi_status = 'menunggu', isi_percobaan = 0, isi_giliran = ${SQL_GILIRAN}
          WHERE isi_status = ? AND ${dalam}
            AND (isi_dicoba_at IS NULL OR isi_dicoba_at < datetime('now', ?))`,
      )
      .bind(status, `-${hari} days`)
      .run();

  const kosong = await antrekan("kosong", ULANG_KOSONG_HARI);
  const gagal = await antrekan("gagal", ULANG_GAGAL_HARI);
  const log = await ctx.db
    .prepare(`DELETE FROM sync_log WHERE created_at < datetime('now', ?)`)
    .bind(`-${SIMPAN_LOG_HARI} days`)
    .run();
  await ctx.db
    .prepare(`DELETE FROM sync_state WHERE key LIKE 'statistik:%' AND key < ?`)
    .bind(`statistik:${new Date(Date.now() - SIMPAN_STATISTIK_HARI * 86_400_000).toISOString().slice(0, 10)}`)
    .run();

  const laporan = {
    kosongDiulang: kosong.meta?.changes ?? 0,
    gagalDiulang: gagal.meta?.changes ?? 0,
    logDipangkas: log.meta?.changes ?? 0,
  };
  await ctx.db
    .prepare(`INSERT INTO sync_log (job, status, detail, jumlah) VALUES ('pemeliharaan', 'sukses', ?, ?)`)
    .bind(
      `diantrekan ulang: ${laporan.kosongDiulang} kosong, ${laporan.gagalDiulang} gagal; log dipangkas ${laporan.logDipangkas}`,
      laporan.kosongDiulang + laporan.gagalDiulang,
    )
    .run()
    .catch(() => {});
  return laporan;
}
