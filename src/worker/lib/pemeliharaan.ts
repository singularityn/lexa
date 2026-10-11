/**
 * Pemeliharaan harian (pemicu Cron harian, 02:00 WIB): hal yang perlu terjadi sesekali, bukan tiap menit.
 *
 *  - Peraturan 'kosong' (sumber menjawab tanpa pasal) dicoba lagi sebulan sekali: pasal.id bisa menambahkan isinya.
 *  - Peraturan 'gagal' (galat berulang) dicoba lagi tiap beberapa hari: gangguannya mungkin sudah lewat.
 *  - Peraturan 'lengkap' yang nomor pasalnya bercelah (ekstraksi lama menghilangkan pasal berayat) diantrekan untuk
 *    diambil ulang, terparah dulu, paling banyak CELAH_PER_HARI sehari dan hanya bila akses isi pasal.id sedang baik.
 *  - Catatan lama dipangkas: sync_log 90 hari, statistik harian 14 hari.
 * Sapuan katalog tidak dijadwalkan di sini: tik sendiri menyapu ulang tiap SIKLUS_HARI hari (lib/katalog.ts).
 */

import { klausaCakupan } from "../../shared/cakupan";
import { bacaAkses } from "./akses";
import { SQL_GILIRAN } from "./isi";
import type { KonteksIngest } from "./ingest";

export const ULANG_KOSONG_HARI = 30;
export const ULANG_GAGAL_HARI = 3;
export const SIMPAN_LOG_HARI = 90;
export const SIMPAN_STATISTIK_HARI = 14;
/** Peraturan bercelah yang diantrekan untuk diambil ulang per hari: separuh dari kuota baca teks lengkap pasal.id (300). */
export const CELAH_PER_HARI = 150;
/** Peraturan yang baru dicoba (dan gagal) tak diantrekan lagi sebagai peraturan bercelah sebelum sekian hari. */
export const ULANG_CELAH_HARI = 14;
/** Giliran peraturan bercelah: sebelum semua peraturan baru (giliran >= 100 juta), terparah paling depan. */
const GILIRAN_CELAH = 1_000_000;

export interface LaporanPemeliharaan {
  kosongDiulang: number;
  gagalDiulang: number;
  celahDiantrekan: number;
  logDipangkas: number;
}

/**
 * Antrekan peraturan 'lengkap' yang nomor pasalnya bercelah (nomor tertinggi dikurangi jumlah nomor berbeda, sedikitnya
 * dua) untuk diambil ulang, terparah dulu. Hanya yang belum pernah diambil oleh pipeline ini (`isi_arsip = 0`: pengambilan
 * yang berhasil mengarsipkan responsnya), jadi yang celahnya ternyata wajar tak diantrekan berulang; peraturan perubahan
 * dilewati (ia mengutip nomor peraturan lain); yang baru dicoba dalam ULANG_CELAH_HARI hari dilewati. Penyimpanan tak
 * pernah mengganti dengan hasil yang lebih sedikit, jadi mengambil ulang tak merugikan. Tidak dilakukan selama akses isi
 * dibatasi: peraturannya cuma menumpuk di antrean.
 */
async function antrekanCelah(ctx: KonteksIngest): Promise<number> {
  if (await bacaAkses(ctx.db)) return 0;
  const { results } = await ctx.db
    .prepare(
      `SELECT a.frbr_uri AS frbr_uri, MAX(CAST(a.nomor_pasal AS INTEGER)) - COUNT(DISTINCT a.nomor_pasal) AS hilang
         FROM articles a JOIN laws l ON l.frbr_uri = a.frbr_uri
        WHERE a.nomor_pasal GLOB '[0-9]*' AND l.isi_status = 'lengkap' AND l.isi_arsip = 0
          AND ${klausaCakupan(ctx.cakupan, "l.jenis")}
          AND lower(l.judul) NOT LIKE '%perubahan%'
          AND (l.isi_dicoba_at IS NULL OR l.isi_dicoba_at < datetime('now', ?))
        GROUP BY a.frbr_uri
       HAVING hilang >= 2
        ORDER BY hilang DESC
        LIMIT ?`,
    )
    .bind(`-${ULANG_CELAH_HARI} days`, CELAH_PER_HARI)
    .all<{ frbr_uri: string; hilang: number }>();
  const ubah = results.map((r, i) =>
    ctx.db
      .prepare(`UPDATE laws SET isi_status = 'menunggu', isi_percobaan = 0, isi_giliran = ? WHERE frbr_uri = ?`)
      .bind(GILIRAN_CELAH + i, r.frbr_uri),
  );
  for (let i = 0; i < ubah.length; i += 50) await ctx.db.batch(ubah.slice(i, i + 50));
  return results.length;
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
  const celah = await antrekanCelah(ctx);
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
    celahDiantrekan: celah,
    logDipangkas: log.meta?.changes ?? 0,
  };
  await ctx.db
    .prepare(`INSERT INTO sync_log (job, status, detail, jumlah) VALUES ('pemeliharaan', 'sukses', ?, ?)`)
    .bind(
      `diantrekan ulang: ${laporan.kosongDiulang} kosong, ${laporan.gagalDiulang} gagal, ${laporan.celahDiantrekan} bercelah; log dipangkas ${laporan.logDipangkas}`,
      laporan.kosongDiulang + laporan.gagalDiulang + laporan.celahDiantrekan,
    )
    .run()
    .catch(() => {});
  return laporan;
}
