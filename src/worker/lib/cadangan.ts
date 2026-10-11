/**
 * Cadangan tik lewat antrean, untuk saat Cron per menit tidak berjalan.
 *
 * Sesudah deploy yang menambahkan pemicu per menit, di produksi tidak satu pun tik berjalan berjam-jam kemudian
 * (jejak "denyut:* * * * *" di sync_state tak pernah muncul), sedangkan pemicu harian terbukti berjalan. Dari luar
 * Worker penyebabnya tak terlihat, dan pipeline tak boleh bergantung pada satu pemicu yang tak bisa diperiksa.
 *
 * Cadangannya rantai pesan: pesan `{ tipe: "tik", g }` di antrean ingest menjalankan satu tik, lalu mengirim pesan
 * berikutnya dengan penundaan (60 detik bila ada kerja, 5 menit bila sepi). Rantai hanya dimulai ("disemai") dan
 * hanya berlanjut selama denyut Cron per menit tidak sehat, jadi bila pemicu itu bekerja, rantai berhenti sendiri
 * dan tak menggandakan tik. Penyemai: pemicu harian, dan permintaan HTTP biasa (dibatasi sekali semenit per isolat).
 *
 * Satu rantai saja yang boleh hidup, walau Queues mengantarkan pesan lebih dari sekali dan pesan bisa terlambat:
 *  - menyemai hanya bila kunci `tik_antre_sampai` kedaluwarsa (klaim atomik), dan rantai yang putus karena pesan
 *    hilang pulih sendiri sesudah kunci itu kedaluwarsa;
 *  - tiap pesan membawa generasi `g`; hanya pesan yang generasinya sama dengan `tik_generasi` di D1 yang bekerja dan
 *    melanjutkan rantai (perbandingan-dan-tukar), sehingga pesan ganda atau basi dibuang tanpa melanjutkan apa pun.
 *
 * Aktif hanya bila `vars.TIK_CADANGAN` = "antrean" (wrangler.jsonc); tes dan pratinjau lokal tidak mengaktifkannya.
 */

import { CRON_MENIT } from "./jadwal";
import { bacaState, tulisState } from "./keadaan";

/** Denyut Cron per menit ditulis tiap lima menit; lebih tua dari ini berarti pemicunya tak berjalan. */
const BATAS_SEHAT_MS = 12 * 60_000;
export const KUNCI_ANTRE = "tik_antre_sampai";
export const KUNCI_GENERASI = "tik_generasi";

export const cadanganAktif = (env: { TIK_CADANGAN?: string }) => env.TIK_CADANGAN === "antrean";

/** Cron per menit berjalan baru-baru ini. */
export async function cronMenitSehat(db: D1Database, sekarang = Date.now()): Promise<boolean> {
  const denyut = await bacaState(db, `denyut:${CRON_MENIT}`);
  return denyut !== null && Date.parse(denyut) > sekarang - BATAS_SEHAT_MS;
}

/**
 * Mulai rantai bila Cron per menit tak sehat dan belum ada pesan yang beredar. Mengembalikan apakah pesan dikirim.
 * Klaimnya satu pernyataan atomik: dua penyemai serentak tidak mengirim dua pesan.
 */
export async function semaiTik(db: D1Database, antrean: Queue<unknown>, sekarang = Date.now()): Promise<boolean> {
  if (await cronMenitSehat(db, sekarang)) return false;
  const hasil = await db
    .prepare(
      `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
           WHERE sync_state.value < ?`,
    )
    .bind(KUNCI_ANTRE, new Date(sekarang + 150_000).toISOString(), new Date(sekarang).toISOString())
    .run();
  if (!(hasil.meta?.changes ?? 0)) return false;
  await tulisState(db, KUNCI_GENERASI, String(sekarang));
  await antrean.send({ tipe: "tik", g: sekarang }, { delaySeconds: 5 });
  return true;
}

/** Pesan tik ini masih generasi yang sah. Pesan tanpa generasi (dikirim tangan) selalu sah. */
export async function generasiSah(db: D1Database, g: number | undefined): Promise<boolean> {
  if (g === undefined) return true;
  const sekarang = await bacaState(db, KUNCI_GENERASI);
  return sekarang === null || sekarang === String(g);
}

/**
 * Dipanggil konsumer sesudah mengerjakan tik: kirim pesan berikutnya bila Cron per menit masih tak sehat dan pesan ini
 * masih generasi yang sah. `adaKerja` menentukan jarak: tik berikutnya dalam semenit bila ada kerja, lima menit bila
 * sepi. Mengembalikan apakah rantai berlanjut.
 */
export async function sambungTik(
  db: D1Database,
  antrean: Queue<unknown>,
  g: number | undefined,
  adaKerja: boolean,
  sekarang = Date.now(),
): Promise<boolean> {
  if (await cronMenitSehat(db, sekarang)) {
    await tulisState(db, KUNCI_ANTRE, "");
    return false;
  }
  const baru = Math.max(sekarang, (g ?? 0) + 1);
  const tukar = await db
    .prepare(`UPDATE sync_state SET value = ?, updated_at = datetime('now') WHERE key = ? AND (value = ? OR ?)`)
    .bind(String(baru), KUNCI_GENERASI, String(g ?? ""), g === undefined ? 1 : 0)
    .run();
  if (g !== undefined && !(tukar.meta?.changes ?? 0)) return false; // sudah dilanjutkan pesan lain
  if (g === undefined) await tulisState(db, KUNCI_GENERASI, String(baru));
  const tunda = adaKerja ? 60 : 300;
  await tulisState(db, KUNCI_ANTRE, new Date(sekarang + (tunda + 90) * 1000).toISOString());
  await antrean.send({ tipe: "tik", g: baru }, { delaySeconds: tunda });
  return true;
}
