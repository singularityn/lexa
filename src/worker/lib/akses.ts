/**
 * Akses isi pasal.id: kapan pasal.id memberi naskah peraturan dan kapan tidak.
 *
 * Pada 11 Oktober 2026 diagnosis produksi (lib/diagnosa.ts) menemukan bahwa setiap detail `/laws/<uri>` dijawab 200
 * dengan `{ work, content: "not_available_via_api", content_note }` tanpa `articles`, untuk peraturan terverifikasi
 * maupun tidak. Catatan pasal.id sendiri (content_note, apa adanya): "Pasal.id's API provides discovery metadata only.
 * Read the text at the linked pasal.id page, or connect an AI assistant via MCP: https://pasal.id/hubungkan". Jadi
 * ini kebijakan API-nya, bukan masalah token atau kuota Lexa; daftar `/laws` tetap terbuka.
 *
 * Pembatasan itu bukan isi peraturan, jadi pipeline tidak boleh memperlakukannya sebagai peraturan tanpa pasal
 * ('kosong' lalu baru dicoba lagi sebulan kemudian) ataupun mengarsipkan jawabannya (arsip kosong yang diuraikan
 * ulang selamanya). Sebagai gantinya keadaannya dicatat di `sync_state` ("akses_isi"), pengambilan detail dijeda
 * sambil katalog jalan terus, dan satu pemeriksaan berkala memutuskan kapan pengambilan boleh dilanjutkan.
 *
 * Pembatasan hanya dipastikan dengan pembanding: satu peraturan yang naskahnya sudah tersimpan diminta ulang. Bila
 * pembanding itu pun tanpa pasal, pembatasan berlaku menyeluruh. Bila pembanding berpasal, akses baik dan peraturan
 * yang diminta memang tak punya naskah.
 */

import { adaSimpulPasal, catatanAksesTerbatas, type PasalClient } from "./pasal";
import { bacaState, tulisState } from "./keadaan";

export const KUNCI_AKSES = "akses_isi";
/** Kapan akses isi terakhir diperiksa dengan kepastian (pembatasan atau akses baik); mencegah pemeriksaan awal tiap tik. */
export const KUNCI_DIPERIKSA = "akses_diperiksa";
/** Selang pemeriksaan awal bila akses ternyata baik. */
export const SELANG_PERIKSA_AWAL_MS = 6 * 3_600_000;
/** Selang antarpemeriksaan selama akses terbatas. */
export const JEDA_PERIKSA_MS = 30 * 60_000;
/** Selang bila pemeriksaan sendiri gagal (jaringan, 5xx): lebih pendek, karena belum ada kepastian apa pun. */
export const JEDA_PERIKSA_GALAT_MS = 10 * 60_000;

export interface KeadaanAkses {
  /** Pertama kali pembatasan terlihat (ISO). */
  sejak: string;
  /** Pemeriksaan terakhir yang masih menemukan pembatasan (ISO). */
  terakhir: string;
  /** Pengambilan detail dijeda sampai saat ini (ISO). */
  periksa_lagi: string;
  /** Catatan pasal.id apa adanya (`content` dan `content_note`), paling banyak 500 huruf. */
  catatan: string;
  /** Berapa kali pembatasan terkonfirmasi sejak `sejak`. */
  pemeriksaan: number;
}

/** Uraikan nilai `akses_isi` di sync_state; null bila kosong atau rusak. */
export function uraiAkses(nilai: string | null | undefined): KeadaanAkses | null {
  if (!nilai) return null;
  try {
    const o = JSON.parse(nilai) as Partial<KeadaanAkses>;
    if (typeof o.sejak !== "string" || typeof o.periksa_lagi !== "string") return null;
    return {
      sejak: o.sejak,
      terakhir: typeof o.terakhir === "string" ? o.terakhir : o.sejak,
      periksa_lagi: o.periksa_lagi,
      catatan: typeof o.catatan === "string" ? o.catatan : "",
      pemeriksaan: typeof o.pemeriksaan === "number" ? o.pemeriksaan : 1,
    };
  } catch {
    return null;
  }
}

export async function bacaAkses(db: D1Database): Promise<KeadaanAkses | null> {
  return uraiAkses(await bacaState(db, KUNCI_AKSES));
}

/** Catat (atau perbarui) pembatasan: `sejak` dipertahankan, pemeriksaan berikut dijadwalkan `jedaMs` lagi. */
export async function tandaiAksesTerbatas(
  db: D1Database,
  catatan: string,
  sekarang: number,
  jedaMs = JEDA_PERIKSA_MS,
): Promise<KeadaanAkses> {
  const lama = await bacaAkses(db);
  const baru: KeadaanAkses = {
    sejak: lama?.sejak ?? new Date(sekarang).toISOString(),
    terakhir: new Date(sekarang).toISOString(),
    periksa_lagi: new Date(sekarang + jedaMs).toISOString(),
    catatan: (catatan || lama?.catatan || "").slice(0, 500),
    pemeriksaan: (lama?.pemeriksaan ?? 0) + 1,
  };
  await tulisState(db, KUNCI_AKSES, JSON.stringify(baru));
  return baru;
}

/** Tunda pemeriksaan berikut tanpa mengubah catatan (pemeriksaan gagal, bukan terjawab). */
export async function tundaPeriksaAkses(db: D1Database, sekarang: number, jedaMs = JEDA_PERIKSA_GALAT_MS): Promise<void> {
  const lama = await bacaAkses(db);
  if (!lama) return;
  await tulisState(db, KUNCI_AKSES, JSON.stringify({ ...lama, periksa_lagi: new Date(sekarang + jedaMs).toISOString() }));
}

/** Hapus catatan pembatasan. Mengembalikan apakah ada yang dihapus. */
export async function tandaiAksesPulih(db: D1Database): Promise<boolean> {
  const hasil = await db.prepare(`DELETE FROM sync_state WHERE key = ?`).bind(KUNCI_AKSES).run();
  return (hasil.meta?.changes ?? 0) > 0;
}

export type PutusanAkses = "terbatas" | "baik" | "tak_diketahui";

/**
 * Putuskan apakah pasal.id memberi naskah, dengan meminta ulang satu peraturan yang naskahnya sudah tersimpan (bukan
 * yang sedang diantre: peraturan berstatus 'lengkap' tak pernah ada di antrean). Tanpa pembanding (belum ada
 * peraturan berpasal di D1) hasilnya "tak_diketahui". Galat dari pasal.id (batas laju, token ditolak, 5xx) dilempar
 * ke pemanggil, yang tahu cara menanganinya. Pembandingnya diundi: pembanding yang hilang di sumber (404) tak boleh
 * mengunci pemeriksaan selamanya.
 */
export async function periksaAkses(
  db: D1Database,
  pasal: PasalClient,
): Promise<{ putusan: PutusanAkses; uri?: string; catatan?: string }> {
  const pembanding = await db
    .prepare(
      `SELECT frbr_uri FROM laws
        WHERE isi_status = 'lengkap' AND jumlah_pasal BETWEEN 3 AND 80
        ORDER BY RANDOM() LIMIT 1`,
    )
    .first<{ frbr_uri: string }>();
  if (!pembanding) return { putusan: "tak_diketahui" };
  const mentah = await pasal.getLawMentah(pembanding.frbr_uri);
  if (adaSimpulPasal(mentah)) return { putusan: "baik", uri: pembanding.frbr_uri };
  return { putusan: "terbatas", uri: pembanding.frbr_uri, catatan: catatanAksesTerbatas(mentah) ?? undefined };
}

/**
 * Pemeriksaan awal: bila antrean punya peraturan menunggu tetapi keadaan akses belum diketahui (belum ada `akses_isi`)
 * dan belum diperiksa dalam SELANG_PERIKSA_AWAL_MS, satu permintaan pembanding memutuskannya. Tanpa ini pembatasan baru
 * terlihat saat pengambilan detail pertama, yang di belakang antrean katalog bisa berjam-jam, dan /status tak jujur selama
 * itu. Mengembalikan putusannya, atau "dilewati" bila belum waktunya. Galat pasal.id dilempar ke pemanggil.
 */
export async function periksaAksesAwal(
  db: D1Database,
  pasal: PasalClient,
  sekarang: number,
): Promise<PutusanAkses | "dilewati"> {
  const terakhir = await bacaState(db, KUNCI_DIPERIKSA);
  if (terakhir && Date.parse(terakhir) > sekarang - SELANG_PERIKSA_AWAL_MS) return "dilewati";
  const hasil = await periksaAkses(db, pasal);
  if (hasil.putusan === "terbatas") await tandaiAksesTerbatas(db, hasil.catatan ?? "", sekarang);
  if (hasil.putusan !== "tak_diketahui") await tulisState(db, KUNCI_DIPERIKSA, new Date(sekarang).toISOString());
  return hasil.putusan;
}
