/**
 * Katalog: daftar lengkap peraturan dalam cakupan, dipisahkan dari pengambilan isinya.
 *
 * Sapuan lama mengantrekan peraturan satu per satu dan baru menyimpannya setelah detailnya berhasil diambil, padahal
 * detail adalah permintaan yang paling dibatasi pasal.id. Akibatnya peraturan yang detailnya tak kunjung berhasil
 * tak pernah tercatat sama sekali (di produksi 1.750 dari ≥5.000 PP). Kini daftar (50-100 peraturan per permintaan)
 * lebih dulu menyimpan seluruh metadata sebagai baris `laws` berstatus 'menunggu' (isi_status), sehingga katalog
 * lengkap dalam hitungan jam, dan pengambilan isi (lib/isi.ts) mengisinya belakangan menurut urutan prioritas.
 *
 * Sapuan penuh diulang tiap `SIKLUS_HARI` hari untuk menangkap peraturan baru dan perubahan status. Kemajuannya
 * (kursor offset per jenis) disimpan di sync_state dan hanya maju sesudah halamannya tersimpan, jadi 429 di tengah
 * jalan tidak melewatkan apa pun.
 */

import { dalamCakupan } from "../../shared/cakupan";
import { PasalApiError } from "./pasal";
import { tulisState } from "./keadaan";
import { hitungGiliran } from "./isi";
import type { KonteksIngest } from "./ingest";

export const SIKLUS_HARI = 3;
/** Diminta sebanyak mungkin (klien membatasi 100). pasal.id kini hanya memberi 50; offset berikutnya dihitung dari jumlah yang diterima. */
const UKURAN_HALAMAN = 100;

/**
 * Jenis yang disapu, berurutan menurut kepentingan: UUD dan Tap MPR dulu (sedikit, satu permintaan masing-masing, dan
 * yang paling dicari), lalu UU, Perppu, PP. UU, PERPPU, dan PP adalah kode filter `type` yang terbukti di pasal.id.
 * UUD dan TAP_MPR belum terbukti: pasal.id mengabaikan diam-diam filter yang tak dikenal dan menjawab SEMUA peraturan,
 * jadi sapuan memeriksa bahwa halaman pertama memang berisi jenis yang diminta, dan bila tidak, mencatat "tidak
 * didukung" dan mencoba lagi pada siklus berikutnya.
 */
export const JENIS_KATALOG = ["UUD", "TAP_MPR", "UU", "PERPPU", "PP"] as const;
const JENIS_TERBUKTI = new Set(["UU", "PERPPU", "PP"]);

export interface HasilKatalog {
  jenis: string;
  diperiksa: number;
  disimpan: number;
  selesai: boolean;
  /** Filter `type` tak dikenal pasal.id (halaman memuat jenis lain), atau ditolak dengan galat 4xx. */
  tidakDidukung?: boolean;
}

const KUNCI = {
  offset: (j: string) => `katalog_offset:${j}`,
  selesai: (j: string) => `katalog_selesai:${j}`,
  total: (j: string) => `katalog_total:${j}`,
  dukungan: (j: string) => `katalog_dukungan:${j}`,
};

/** Jenis yang jatuh tempo disapu: sapuan sedang berjalan, belum pernah selesai, atau terakhir selesai lebih dari satu siklus. */
export function jenisJatuhTempo(
  keadaan: Map<string, string>,
  cakupan: readonly string[],
  sekarang: number,
): string | null {
  for (const jenis of JENIS_KATALOG) {
    if (!dalamCakupan(cakupan, jenis)) continue;
    const offset = Number(keadaan.get(KUNCI.offset(jenis)) ?? 0);
    const selesai = keadaan.get(KUNCI.selesai(jenis));
    const tempo = selesai ? Date.parse(selesai) + SIKLUS_HARI * 86_400_000 : 0;
    if (offset > 0 || !selesai || tempo <= sekarang) return jenis;
  }
  return null;
}

/** Semua kunci katalog sekaligus, satu kueri. */
export async function bacaKeadaanKatalog(db: D1Database): Promise<Map<string, string>> {
  const { results } = await db
    .prepare(`SELECT key, value FROM sync_state WHERE key LIKE 'katalog_%'`)
    .all<{ key: string; value: string }>();
  return new Map(results.map((r) => [r.key, r.value]));
}

/**
 * Sapu satu halaman katalog untuk `jenis`. Melempar PasalRateLimitError bila kena batas laju (kursor tidak bergerak).
 */
export async function sapuHalaman(
  ctx: KonteksIngest,
  jenis: string,
  offset: number,
  sekarang: number,
): Promise<HasilKatalog> {
  let hasil;
  try {
    hasil = await ctx.pasal.listLaws({ jenis, offset, limit: UKURAN_HALAMAN });
  } catch (e) {
    // Kode jenis yang belum terbukti boleh ditolak dengan 4xx; itu jawaban, bukan gangguan.
    if (!JENIS_TERBUKTI.has(jenis) && e instanceof PasalApiError && e.status >= 400 && e.status < 500 && e.status !== 429) {
      await tulisState(ctx.db, KUNCI.dukungan(jenis), `tidak: HTTP ${e.status}`);
      await tulisState(ctx.db, KUNCI.selesai(jenis), new Date(sekarang).toISOString());
      await tulisState(ctx.db, KUNCI.offset(jenis), "0");
      return { jenis, diperiksa: 0, disimpan: 0, selesai: true, tidakDidukung: true };
    }
    throw e;
  }

  const sesuai = hasil.laws.filter((l) => l.jenis === jenis).length;
  const tidakDidukung = !JENIS_TERBUKTI.has(jenis) && hasil.laws.length > 0 && sesuai === 0;

  const pernyataan: D1PreparedStatement[] = [];
  for (const law of hasil.laws) {
    // Filter yang diabaikan menjawab peraturan dari jenis apa pun; yang di luar cakupan tak boleh masuk.
    if (!dalamCakupan(ctx.cakupan, law.jenis)) continue;
    const terverifikasi = hasil.terverifikasi.get(law.frbr_uri) ?? null;
    pernyataan.push(
      ctx.db
        .prepare(
          // OR IGNORE: kutipan (jenis, nomor, tahun) yang sama dengan baris lain berbeda frbr_uri (mis. ejaan perpu/perppu
          // dari impor BPK) melanggar indeks unik; satu baris begitu tak boleh membatalkan seluruh halaman.
          `INSERT OR IGNORE INTO laws (
             frbr_uri, jenis, nomor, tahun, judul, tentang, status, tanggal_penetapan, tanggal_berlaku,
             instansi, bidang, bpk_id, sumber_url, jumlah_pasal, isi_status, isi_giliran, isi_diverifikasi, updated_at
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,'menunggu',?,?, datetime('now'))
           ON CONFLICT(frbr_uri) DO UPDATE SET
             judul = excluded.judul,
             tentang = COALESCE(excluded.tentang, laws.tentang),
             status = excluded.status,
             tanggal_penetapan = COALESCE(excluded.tanggal_penetapan, laws.tanggal_penetapan),
             tanggal_berlaku = COALESCE(excluded.tanggal_berlaku, laws.tanggal_berlaku),
             instansi = COALESCE(excluded.instansi, laws.instansi),
             bidang = COALESCE(excluded.bidang, laws.bidang),
             bpk_id = COALESCE(excluded.bpk_id, laws.bpk_id),
             sumber_url = COALESCE(excluded.sumber_url, laws.sumber_url),
             isi_diverifikasi = COALESCE(excluded.isi_diverifikasi, laws.isi_diverifikasi),
             -- Peraturan yang tadinya kosong atau gagal dan kini terverifikasi pasal.id kemungkinan sudah punya isi: diambil
             -- lagi, dengan giliran dihitung ulang. Perubahan status (berlaku, diubah, dicabut) hanya memperbarui metadata:
             -- naskahnya tak ikut berubah, dan mengambil ulang tiap perubahan status menguras jatah pasal.id.
             isi_status = CASE WHEN laws.isi_status IN ('kosong', 'gagal') AND excluded.isi_diverifikasi = 1
                                    AND COALESCE(laws.isi_diverifikasi, 0) <> 1
                               THEN 'menunggu' ELSE laws.isi_status END,
             isi_percobaan = CASE WHEN laws.isi_status IN ('kosong', 'gagal') AND excluded.isi_diverifikasi = 1
                                       AND COALESCE(laws.isi_diverifikasi, 0) <> 1
                                  THEN 0 ELSE laws.isi_percobaan END,
             isi_giliran = CASE WHEN laws.isi_status = 'menunggu'
                                     OR (laws.isi_status IN ('kosong', 'gagal') AND excluded.isi_diverifikasi = 1
                                         AND COALESCE(laws.isi_diverifikasi, 0) <> 1)
                                THEN excluded.isi_giliran ELSE laws.isi_giliran END,
             updated_at = datetime('now')
           -- Tanpa perubahan apa pun tidak ada yang ditulis: sapuan ulang atas ribuan peraturan yang sama tak memakan
           -- kuota tulis dan tak menyentuh indeks teks penuh.
           WHERE laws.judul IS NOT excluded.judul
              OR laws.status IS NOT excluded.status
              OR laws.isi_diverifikasi IS NOT COALESCE(excluded.isi_diverifikasi, laws.isi_diverifikasi)
              OR laws.instansi IS NOT COALESCE(excluded.instansi, laws.instansi)
              OR laws.tanggal_penetapan IS NOT COALESCE(excluded.tanggal_penetapan, laws.tanggal_penetapan)`,
        )
        .bind(
          law.frbr_uri, law.jenis, law.nomor, law.tahun, law.judul, law.tentang, law.status,
          law.tanggal_penetapan, law.tanggal_berlaku, law.instansi, law.bidang, law.bpk_id, law.sumber_url,
          hitungGiliran(law.jenis, law.tahun, terverifikasi),
          terverifikasi === null ? null : terverifikasi ? 1 : 0,
        ),
    );
  }

  let disimpan = 0;
  if (pernyataan.length) {
    const hasilBatch = await ctx.db.batch(pernyataan);
    disimpan = hasilBatch.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
  }

  // Kursor maju hanya sesudah halamannya tersimpan.
  const selesai = tidakDidukung || !hasil.hasMore;
  if (selesai) {
    await tulisState(ctx.db, KUNCI.offset(jenis), "0");
    await tulisState(ctx.db, KUNCI.selesai(jenis), new Date(sekarang).toISOString());
    await tulisState(ctx.db, KUNCI.total(jenis), String(tidakDidukung ? 0 : hasil.total));
    if (!JENIS_TERBUKTI.has(jenis)) {
      await tulisState(ctx.db, KUNCI.dukungan(jenis), tidakDidukung ? "tidak: filter diabaikan" : "ya");
    }
  } else {
    await tulisState(ctx.db, KUNCI.offset(jenis), String(hasil.offsetBerikut));
    await tulisState(ctx.db, KUNCI.total(jenis), String(hasil.total));
  }

  return { jenis, diperiksa: hasil.laws.length, disimpan, selesai, ...(tidakDidukung ? { tidakDidukung } : {}) };
}
