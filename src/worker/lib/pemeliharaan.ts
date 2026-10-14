/**
 * Pemeliharaan harian (pemicu Cron harian, 02:00 WIB): hal yang perlu terjadi sesekali. Satu-satunya pekerjaan
 * terjadwal Lexa; data peraturan sendiri datang dari panen BPK lewat /api/impor/*, bukan dari Cron.
 *
 *  - Kosongkan daftar hapus: berkas R2 dan vektor yang sudah tak punya baris di D1 (lib/hapus.ts), dalam batas waktu.
 *  - Pangkas catatan lama: sync_log sesudah SIMPAN_LOG_HARI hari.
 *  - Buang sisa keadaan pekerjaan sumber lama (katalog, jeda, akses, tik, statistik harian) dari sync_state; tak ada
 *    kode yang membacanya lagi.
 *
 * Satu baris sync_log ('pemeliharaan') ditulis hanya bila ada yang dikerjakan, supaya hari yang sepi tak menambah log.
 */

import { CRON_HARIAN } from "./jadwal";
import { kosongkanDaftarHapus } from "./hapus";

export const SIMPAN_LOG_HARI = 90;
/** Lama paling banyak pengosongan daftar hapus dalam sekali pemeliharaan; sisanya menunggu hari berikutnya. */
export const BATAS_HAPUS_MS = 8 * 60_000;

export interface KonteksPemeliharaan {
  db: D1Database;
  docs: R2Bucket;
  vectorize: VectorizeIndex;
}

export interface LaporanPemeliharaan {
  hapus: { r2: number; vektor: number; dilepas: number; selesai: boolean };
  /** Pengosongan daftar hapus berhenti oleh galat R2/Vectorize; kemajuan sebelumnya tetap sah dan dilanjutkan besok. */
  hapusGalat?: string;
  logDipangkas: number;
  kunciLamaDibuang: number;
}

/**
 * Kunci sync_state milik pekerjaan sumber lama. Pola GLOB (huruf besar-kecil dibedakan; "_" dan ":" literal). Denyut
 * Cron harian (`denyut:${CRON_HARIAN}`) dikecualikan: halaman status menampilkannya.
 */
const POLA_KUNCI_LAMA = [
  "katalog_*", "diag:*", "diagisi:*", "statistik:*", "log:*", "pinjaman:*", "offset:*", "tik_*", "denyut:*",
] as const;
const KUNCI_LAMA = ["akses_isi", "akses_diperiksa", "pasal_tunda_sampai", "jenis_awal"] as const;

async function buangKunciLama(db: D1Database): Promise<number> {
  const hasil = await db
    .prepare(
      `DELETE FROM sync_state
        WHERE (${POLA_KUNCI_LAMA.map(() => "key GLOB ?").join(" OR ")} OR key IN (${KUNCI_LAMA.map(() => "?").join(",")}))
          AND key <> ?`,
    )
    .bind(...POLA_KUNCI_LAMA, ...KUNCI_LAMA, `denyut:${CRON_HARIAN}`)
    .run();
  return hasil.meta?.changes ?? 0;
}

export async function jalankanPemeliharaan(ctx: KonteksPemeliharaan): Promise<LaporanPemeliharaan> {
  const laporan: LaporanPemeliharaan = { hapus: { r2: 0, vektor: 0, dilepas: 0, selesai: true }, logDipangkas: 0, kunciLamaDibuang: 0 };

  // Daftar hapus: putaran demi putaran sampai kosong atau waktu habis. Putaran tanpa kemajuan juga menghentikan lingkaran.
  const mulai = Date.now();
  try {
    while (Date.now() - mulai < BATAS_HAPUS_MS) {
      const putaran = await kosongkanDaftarHapus(ctx.db, ctx.docs, ctx.vectorize);
      laporan.hapus.r2 += putaran.r2;
      laporan.hapus.vektor += putaran.vektor;
      laporan.hapus.dilepas += putaran.dilepas;
      laporan.hapus.selesai = putaran.selesai;
      if (putaran.selesai || putaran.r2 + putaran.vektor + putaran.dilepas === 0) break;
    }
  } catch (e) {
    laporan.hapus.selesai = false;
    laporan.hapusGalat = String(e).slice(0, 200);
    console.error("Lexa: pengosongan daftar hapus gagal", e);
  }

  const log = await ctx.db
    .prepare(`DELETE FROM sync_log WHERE created_at < datetime('now', ?)`)
    .bind(`-${SIMPAN_LOG_HARI} days`)
    .run();
  laporan.logDipangkas = log.meta?.changes ?? 0;
  laporan.kunciLamaDibuang = await buangKunciLama(ctx.db);

  const objek = laporan.hapus.r2 + laporan.hapus.vektor + laporan.hapus.dilepas;
  if (objek + laporan.logDipangkas + laporan.kunciLamaDibuang > 0 || laporan.hapusGalat) {
    const rincian = [
      `R2 ${laporan.hapus.r2}, vektor ${laporan.hapus.vektor}${laporan.hapus.dilepas ? `, dilepas ${laporan.hapus.dilepas}` : ""}${laporan.hapus.selesai ? "" : " (belum selesai)"}`,
      `log dipangkas ${laporan.logDipangkas}`,
      laporan.kunciLamaDibuang ? `keadaan lama dibuang ${laporan.kunciLamaDibuang}` : null,
      laporan.hapusGalat ? `galat: ${laporan.hapusGalat}` : null,
    ].filter(Boolean).join("; ");
    await ctx.db
      .prepare(`INSERT INTO sync_log (job, status, detail, jumlah) VALUES ('pemeliharaan', ?, ?, ?)`)
      .bind(laporan.hapusGalat ? "gagal" : "sukses", rincian, objek)
      .run()
      .catch(() => {});
  }
  return laporan;
}
