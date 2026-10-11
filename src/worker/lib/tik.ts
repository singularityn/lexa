/**
 * Tik: pekerjaan latar yang dijalankan Cron per menit (atau rantai pesan antrean bila Cron itu tak sehat, lihat
 * lib/cadangan.ts).
 *
 * Satu tik mengerjakan sedikit hal lalu selesai. Kecilnya pekerjaan per tik disengaja: laju pasal.id-lah yang
 * membatasi seluruh pipeline (di produksi 429 sudah datang setelah belasan permintaan), jadi daripada memborong
 * sekali jalan lalu kehilangan kemajuan, tik terus maju selangkah dan berhenti begitu pasal.id minta jeda. Jeda itu
 * disimpan di D1 (lib/keadaan.ts) dan dipatuhi semua tik berikutnya.
 *
 * Urutan kerja: kosongkan daftar hapus, lalu (bila pasal.id boleh dihubungi) diagnosis, katalog, dan pengambilan isi
 * dengan anggaran bersama MAKS_PANGGILAN_PASAL permintaan; penguraian ulang dari arsip tak memakai pasal.id dan jalan
 * terus walau pasal.id sedang dijeda.
 *
 * Tik yang tak punya pekerjaan tidak menulis apa pun ke D1 (hanya beberapa pembacaan murah), sehingga Cron per menit
 * tidak memakan kuota tulis.
 */

import { adaYangDihapus, kosongkanDaftarHapus } from "./hapus";
import { jalankanDiagnosa, KUNCI_DIAG, PEMERIKSAAN } from "./diagnosa";
import { bacaKeadaanKatalog, jenisJatuhTempo, sapuHalaman, type HasilKatalog } from "./katalog";
import { langkahIsi, type LaporanIsi } from "./isi";
import {
  ambilPinjaman, bacaState, catatLogBerjeda, jedaPasalSampai, lepasPinjaman, tambahStatistik, tulisState, tundaPasal,
} from "./keadaan";
import { PasalApiError, PasalRateLimitError } from "./pasal";
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
  katalog?: HasilKatalog[];
  isi?: LaporanIsi;
  jedaPasalSampai?: string;
  /** Galat pasal.id selain batas laju (5xx, jaringan): tik berhenti memakai pasal.id dan mencobanya lagi sebentar lagi. */
  galatPasal?: string;
}

const PINJAMAN_TIK = "tik";
/** Pinjaman dilepas lebih awal bila tik selesai; angka ini hanya batas bila tik mati di tengah jalan. */
const PINJAMAN_DETIK = 240;
const KUNCI_HAPUS_TUNDA = "hapus_tunda_sampai";
const JEDA_HAPUS_GAGAL_MS = 10 * 60_000;
/** Permintaan ke pasal.id per tik, dibagi antara diagnosis, katalog (100 peraturan per permintaan), dan detail. */
export const MAKS_PANGGILAN_PASAL = 3;
/** Peraturan yang diuraikan ulang dari arsip per tik (R2 dan D1 saja; murah). */
const MAKS_URAI_PER_TIK = 15;
const BATAS_WAKTU_MS = 25_000;
/** Jeda sesudah galat pasal.id yang bukan batas laju, dan sesudah token ditolak (401/403). */
const JEDA_GALAT_MS = 2 * 60_000;
const JEDA_DITOLAK_MS = 30 * 60_000;
const SELANG_LOG_MS = 30 * 60_000;

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

/** Ada peraturan berstatus 'menunggu' dengan penanda arsip `arsip` (0: perlu diambil, 1: cukup diuraikan ulang). */
async function adaAntrean(db: D1Database, arsip: 0 | 1): Promise<boolean> {
  const baris = await db
    .prepare(`SELECT 1 AS ada FROM laws WHERE isi_status = 'menunggu' AND isi_arsip = ? LIMIT 1`)
    .bind(arsip)
    .first();
  return baris !== null;
}

export async function jalankanTik(ctx: KonteksIngest, opsi: OpsiTik): Promise<LaporanTik> {
  const sekarang = opsi.sekarang ?? Date.now();
  const laporan: LaporanTik = {};
  const iso = new Date(sekarang).toISOString();

  // Keputusan murah lebih dulu: bila tak ada kerja, tik selesai tanpa menulis apa pun.
  const hapusDitunda = (await bacaState(ctx.db, KUNCI_HAPUS_TUNDA)) ?? "";
  const perluHapus = hapusDitunda <= iso && (await adaYangDihapus(ctx.db));
  const jeda = opsi.pasalSiap ? await jedaPasalSampai(ctx.db, sekarang) : "token belum dipasang";
  const bolehPasal = !jeda;
  const [keadaanKatalog, adaAmbil, adaUrai, perluDiagnosa] = await Promise.all([
    bolehPasal ? bacaKeadaanKatalog(ctx.db) : Promise.resolve(new Map<string, string>()),
    bolehPasal ? adaAntrean(ctx.db, 0) : Promise.resolve(false),
    adaAntrean(ctx.db, 1),
    bolehPasal ? diagnosaTersisa(ctx.db) : Promise.resolve(false),
  ]);
  const perluKatalog = bolehPasal && jenisJatuhTempo(keadaanKatalog, ctx.cakupan, sekarang) !== null;

  if (!perluHapus && !perluDiagnosa && !perluKatalog && !adaAmbil && !adaUrai) {
    laporan.dilewati = "sepi";
    return laporan;
  }
  if (!(await ambilPinjaman(ctx.db, PINJAMAN_TIK, PINJAMAN_DETIK, sekarang))) {
    laporan.dilewati = "tumpang_tindih";
    return laporan;
  }

  const hari = iso.slice(0, 10);
  /** Tanggapi galat dari pasal.id: simpan jedanya dan beri tahu pemanggil agar berhenti memakai pasal.id. */
  const tanganiGalatPasal = async (e: unknown): Promise<boolean> => {
    if (e instanceof PasalRateLimitError) {
      laporan.jedaPasalSampai = await tundaPasal(ctx.db, e.retryAfterMs, sekarang);
      await tambahStatistik(ctx.db, hari, { batas_laju: 1 });
      await catatLogBerjeda(
        ctx.db, "pasal_laju", "gagal", `pasal.id minta jeda sampai ${laporan.jedaPasalSampai}`, 0, SELANG_LOG_MS, sekarang,
      );
      return true;
    }
    if (e instanceof PasalApiError && (e.status === 401 || e.status === 403)) {
      laporan.jedaPasalSampai = await tundaPasal(ctx.db, JEDA_DITOLAK_MS, sekarang);
      laporan.galatPasal = `HTTP ${e.status}`;
      await catatLogBerjeda(
        ctx.db, "pasal_laju", "gagal", `token pasal.id ditolak (HTTP ${e.status}); dijeda 30 menit`, 0, SELANG_LOG_MS, sekarang,
      );
      return true;
    }
    // Gangguan lain (5xx, jaringan): jangan menghantam API yang sedang bermasalah; coba lagi sebentar lagi.
    laporan.jedaPasalSampai = await tundaPasal(ctx.db, JEDA_GALAT_MS, sekarang);
    laporan.galatPasal = String(e).slice(0, 200);
    await catatLogBerjeda(ctx.db, "pasal_laju", "gagal", `galat pasal.id: ${laporan.galatPasal}`, 0, SELANG_LOG_MS, sekarang);
    return true;
  };

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

    let sisa = bolehPasal ? MAKS_PANGGILAN_PASAL : 0;
    let pasalMasihBoleh = bolehPasal;

    if (pasalMasihBoleh && perluDiagnosa && sisa > 0) {
      const hasil = await jalankanDiagnosa(ctx.db, ctx.pasal);
      if (hasil.tundaMs !== undefined) {
        await tanganiGalatPasal(new PasalRateLimitError(hasil.tundaMs));
        pasalMasihBoleh = false;
      } else {
        laporan.diagnosa = hasil.kunci;
        sisa--;
      }
    }

    // Katalog lebih dulu dari isi: satu permintaan menyimpan metadata 100 peraturan, dan baris itulah yang diisi sesudahnya.
    let keadaan = keadaanKatalog;
    while (pasalMasihBoleh && sisa > 0) {
      const jenis = jenisJatuhTempo(keadaan, ctx.cakupan, sekarang);
      if (!jenis) break;
      try {
        const hasil = await sapuHalaman(ctx, jenis, Number(keadaan.get(`katalog_offset:${jenis}`) ?? 0), sekarang);
        (laporan.katalog ??= []).push(hasil);
        await tambahStatistik(ctx.db, hari, { katalog: hasil.diperiksa, katalog_disimpan: hasil.disimpan });
        sisa--;
        keadaan = await bacaKeadaanKatalog(ctx.db);
      } catch (e) {
        pasalMasihBoleh = !(await tanganiGalatPasal(e));
      }
    }

    // Isi: detail dari pasal.id sebanyak anggaran yang tersisa, dan arsip yang diuraikan ulang tanpa pasal.id.
    if (adaAmbil || adaUrai) {
      const isi = await langkahIsi(ctx, {
        maksAmbil: pasalMasihBoleh ? sisa : 0,
        maksUrai: MAKS_URAI_PER_TIK,
        batasMs: BATAS_WAKTU_MS,
      });
      laporan.isi = isi;
      await tambahStatistik(ctx.db, hari, {
        diambil: isi.diambil, diurai: isi.diurai, lengkap: isi.lengkap, kosong: isi.kosong,
        dipertahankan: isi.dipertahankan, gagal: isi.gagal,
      });
      if (isi.tundaMs !== undefined) await tanganiGalatPasal(new PasalRateLimitError(isi.tundaMs));
      else if (isi.ditolak !== undefined) await tanganiGalatPasal(new PasalApiError(isi.ditolak, "token ditolak"));
      if (isi.diambil + isi.diurai > 0) {
        await catatLogBerjeda(
          ctx.db, "isi_peraturan", "sukses",
          `diambil ${isi.diambil}, diuraikan ulang ${isi.diurai}: lengkap ${isi.lengkap}, kosong ${isi.kosong}, dipertahankan ${isi.dipertahankan}, gagal ${isi.gagal}`,
          isi.lengkap, SELANG_LOG_MS, sekarang,
        );
      }
    }
  } finally {
    await lepasPinjaman(ctx.db, PINJAMAN_TIK);
  }
  return laporan;
}
