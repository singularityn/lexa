/**
 * Tik: pekerjaan latar yang dijalankan Cron tiap menit.
 *
 * Satu tik mengerjakan sedikit hal lalu selesai. Kecilnya pekerjaan per tik disengaja: laju pasal.id-lah yang
 * membatasi seluruh pipeline (di produksi 429 sudah datang setelah belasan permintaan), jadi daripada memborong
 * sekali jalan lalu kehilangan kemajuan, tik terus maju selangkah dan berhenti begitu pasal.id minta jeda. Jeda itu
 * disimpan di D1 (lib/keadaan.ts) dan dipatuhi semua tik berikutnya.
 *
 * Tik yang tak punya pekerjaan tidak menulis apa pun ke D1, sehingga Cron per menit tidak memakan kuota tulis.
 */

import { adaYangDihapus, kosongkanDaftarHapus } from "./hapus";
import { jalankanDiagnosa, KUNCI_DIAG, PEMERIKSAAN } from "./diagnosa";
import { ambilPinjaman, bacaState, jedaPasalSampai, lepasPinjaman, tulisState, tundaPasal } from "./keadaan";
import type { KonteksIngest } from "./ingest";

export interface OpsiTik {
  /** Token pasal.id terpasang. Tanpa itu langkah yang memanggil pasal.id dilewati. */
  pasalSiap: boolean;
  sekarang?: number;
}

export interface LaporanTik {
  dilewati?: "sepi" | "tumpang_tindih";
  hapus?: { r2: number; vektor: number; dilepas: number; selesai: boolean };
  hapusGalat?: string;
  diagnosa?: string | null;
  jedaPasalSampai?: string;
}

const PINJAMAN_TIK = "tik";
/** Pinjaman dilepas lebih awal bila tik selesai; angka ini hanya batas bila tik mati di tengah jalan. */
const PINJAMAN_DETIK = 240;
const KUNCI_HAPUS_TUNDA = "hapus_tunda_sampai";
const JEDA_HAPUS_GAGAL_MS = 10 * 60_000;

async function catatLog(db: D1Database, job: string, status: "sukses" | "gagal", detail: string, jumlah = 0) {
  await db
    .prepare(`INSERT INTO sync_log (job, status, detail, jumlah) VALUES (?, ?, ?, ?)`)
    .bind(job, status, detail, jumlah)
    .run()
    .catch(() => {});
}

async function diagnosaTersisa(db: D1Database): Promise<boolean> {
  const baris = await db
    .prepare(`SELECT COUNT(*) AS n FROM sync_state WHERE key LIKE ?`)
    .bind(`${KUNCI_DIAG}%`)
    .first<{ n: number }>();
  return (baris?.n ?? 0) < PEMERIKSAAN.length;
}

export async function jalankanTik(ctx: KonteksIngest, opsi: OpsiTik): Promise<LaporanTik> {
  const sekarang = opsi.sekarang ?? Date.now();
  const laporan: LaporanTik = {};

  const hapusDitunda = (await bacaState(ctx.db, KUNCI_HAPUS_TUNDA)) ?? "";
  const bolehHapus = hapusDitunda <= new Date(sekarang).toISOString();
  const perluHapus = bolehHapus && (await adaYangDihapus(ctx.db));
  const jeda = opsi.pasalSiap ? await jedaPasalSampai(ctx.db, sekarang) : "token belum dipasang";
  const perluDiagnosa = !jeda && (await diagnosaTersisa(ctx.db));

  if (!perluHapus && !perluDiagnosa) {
    laporan.dilewati = "sepi";
    return laporan;
  }
  if (!(await ambilPinjaman(ctx.db, PINJAMAN_TIK, PINJAMAN_DETIK, sekarang))) {
    laporan.dilewati = "tumpang_tindih";
    return laporan;
  }

  try {
    if (perluHapus) {
      try {
        const hasil = await kosongkanDaftarHapus(ctx.db, ctx.docs, ctx.vectorize);
        laporan.hapus = hasil;
        await catatLog(
          ctx.db,
          "hapus_objek",
          "sukses",
          `${hasil.selesai ? "selesai; " : ""}R2 ${hasil.r2}, vektor ${hasil.vektor}${hasil.dilepas ? `, dilepas ${hasil.dilepas}` : ""}`,
          hasil.r2 + hasil.vektor,
        );
      } catch (e) {
        // Galat R2/Vectorize jarang dan biasanya sementara: tunda sepuluh menit, jangan memenuhi log tiap menit.
        laporan.hapusGalat = String(e).slice(0, 200);
        await tulisState(ctx.db, KUNCI_HAPUS_TUNDA, new Date(sekarang + JEDA_HAPUS_GAGAL_MS).toISOString());
        await catatLog(ctx.db, "hapus_objek", "gagal", `ditunda 10 menit: ${laporan.hapusGalat}`);
      }
    }

    if (perluDiagnosa) {
      const hasil = await jalankanDiagnosa(ctx.db, ctx.pasal);
      laporan.diagnosa = hasil.kunci;
      if (hasil.tundaMs !== undefined) {
        laporan.jedaPasalSampai = await tundaPasal(ctx.db, hasil.tundaMs, sekarang);
        await catatLog(ctx.db, "pasal_laju", "gagal", `diagnosis: pasal.id minta jeda sampai ${laporan.jedaPasalSampai}`);
      }
    }
  } finally {
    await lepasPinjaman(ctx.db, PINJAMAN_TIK);
  }
  return laporan;
}
