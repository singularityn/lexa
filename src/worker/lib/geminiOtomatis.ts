/**
 * Gemini otomatis: Cron mengantrekan pembacaan PDF peraturan, sedikit demi sedikit, tanpa peramban dan tanpa admin yang menjaga
 * konsol. Semuanya berjalan di Cloudflare dengan secret `GEMINI_API` milik Worker ini.
 *
 * Alur yang dituju (panen BPK -> PDF di R2 -> Gemini membaca dan mengekstrak pasal -> tampil di Lexa): PDF hasil panen langsung
 * diekstrak konversi bawaan supaya peraturannya segera bisa dibaca, lalu Cron ini menggantikannya dengan bacaan Gemini, satu putaran
 * demi satu putaran, sampai semua PDF dibaca.
 *
 * Mati kecuali variabel `GEMINI_OTOMATIS` dipasang (dashboard > Settings > Variables and Secrets):
 *   - `uji` : percobaan kering. Gemini membaca beberapa peraturan yang teksnya bermasalah (vonis tanpa_pasal, berat, gagal) dan
 *             hasilnya hanya dicatat di `pembacaan_ai` (hasil `uji`, dengan ringkasan keputusan di kolom `catatan`) dan arsip R2
 *             `teks-ai/`; tak ada pasal yang ditulis. Berhenti sendiri setelah `GEMINI_OTOMATIS_UJI_MAKS` percobaan (bawaan 8), supaya
 *             biaya uji terbatas dan hasilnya sempat diperiksa.
 *   - `ya`  : membaca sungguhan, SEMUA peraturan ber-PDF yang belum pernah dibaca Gemini (semua vonis), yang terburuk lebih dulu
 *             (tanpa_pasal, gagal, berat, ringan, bersih) lalu menurut prioritas panen. Hasil yang lolos pagar
 *             (`putuskanPenerimaanAi`) menggantikan pasal yang tersimpan. `GEMINI_OTOMATIS_VONIS` mempersempitnya.
 * Nilai lain, atau tak ada: tak mengerjakan apa pun (pemicunya langsung kembali tanpa menyentuh D1 maupun Gemini).
 *
 * Pemicu: Cron `CRON_GEMINI` (lib/jadwal.ts), tiap 15 menit. Satu putaran mengantrekan paling banyak `GEMINI_OTOMATIS_BATAS`
 * peraturan (bawaan 2 pada `uji` dan 5 pada `ya`, maksimum 20), dan putaran berikutnya menunggu sampai semuanya tercatat di
 * `pembacaan_ai` (atau 45 menit berlalu), jadi antrean tak menumpuk. Pagar biaya tetap yang sama: anggaran token harian
 * (`GEMINI_BATAS_HARIAN`), peraturan yang sudah pernah dicoba dilewati, dan satu peraturan satu pembacaan.
 *
 * Calon: peraturan ber-PDF, termasuk yang PDF-nya sudah di R2 tetapi belum sempat diekstrak (tanpa baris `ekstraksi_log`: dihitung
 * `tanpa_pasal`). Vonis itu menghitung pasal yang hilang dan pembukaan yang tertelan ke dalam pasal (lib/bpk.ts), jadi uraikan ulang
 * `usang` lebih dulu supaya vonis semua peraturan jujur sebelum Gemini dinyalakan.
 */

import { bacaCakupan, klausaCakupan } from "../../shared/cakupan";
import { bacaKonfigGemini, pemakaianHariIni } from "./gemini";
import type { PesanIngest } from "./ingest";
import { sqlPrioritas } from "./prioritas";

export type ModeOtomatis = "mati" | "uji" | "ya";

export interface KonfigOtomatis {
  mode: ModeOtomatis;
  /** Peraturan yang diantrekan tiap putaran Cron. */
  batas: number;
  /** Banyaknya percobaan kering sebelum mode `uji` berhenti sendiri. */
  ujiMaks: number;
  /** Vonis ekstraksi yang menjadi calon. */
  vonis: string[];
}

interface EnvOtomatis {
  GEMINI_OTOMATIS?: string;
  GEMINI_OTOMATIS_BATAS?: string;
  GEMINI_OTOMATIS_UJI_MAKS?: string;
  GEMINI_OTOMATIS_VONIS?: string;
}

/** Peraturan per putaran: percobaan kering cukup sedikit; pembacaan sungguhan harus mengejar ribuan peraturan. */
export const BATAS_OTOMATIS_BAWAAN = 2;
export const BATAS_YA_BAWAAN = 5;
export const BATAS_OTOMATIS_MAKS = 20;
export const UJI_OTOMATIS_BAWAAN = 8;
const VONIS_SAH = ["tanpa_pasal", "berat", "gagal", "ringan", "bersih"];
/** Percobaan kering: hanya yang teksnya bermasalah (contoh paling berguna, dan biayanya terbatas). */
const VONIS_BAWAAN_UJI = ["tanpa_pasal", "berat", "gagal"];
/** Pembacaan sungguhan: semuanya. Urutan pembacaannya menurut `URUTAN_TERBURUK`, bukan urutan di sini. */
const VONIS_BAWAAN_YA = ["tanpa_pasal", "gagal", "berat", "ringan", "bersih"];

/** Putaran yang tak kunjung selesai dianggap macet sesudah ini, supaya satu pesan yang hilang tak menghentikan semuanya. */
export const MAKS_UMUR_PUTARAN_MS = 45 * 60_000;
export const KUNCI_PUTARAN = "gemini:otomatis:putaran";

const bulat = (nilai: string | undefined, bawaan: number, min: number, maks: number) => {
  const n = Number.parseInt((nilai ?? "").trim(), 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), maks) : bawaan;
};

export function bacaKonfigOtomatis(env: EnvOtomatis): KonfigOtomatis {
  const mentah = (env.GEMINI_OTOMATIS ?? "").trim().toLowerCase();
  const mode: ModeOtomatis = ["ya", "1", "true", "aktif", "on"].includes(mentah) ? "ya" : ["uji", "kering", "dry"].includes(mentah) ? "uji" : "mati";
  const diminta = (env.GEMINI_OTOMATIS_VONIS ?? "").split(",").map((v) => v.trim()).filter((v) => VONIS_SAH.includes(v));
  return {
    mode,
    batas: bulat(env.GEMINI_OTOMATIS_BATAS, mode === "ya" ? BATAS_YA_BAWAAN : BATAS_OTOMATIS_BAWAAN, 1, BATAS_OTOMATIS_MAKS),
    ujiMaks: bulat(env.GEMINI_OTOMATIS_UJI_MAKS, UJI_OTOMATIS_BAWAAN, 1, 50),
    vonis: diminta.length ? diminta : mode === "ya" ? VONIS_BAWAAN_YA : VONIS_BAWAAN_UJI,
  };
}

/**
 * Pembacaan sungguhan mendahulukan teks yang paling rusak: bila anggaran harian habis sebelum semuanya terbaca, yang tersisa adalah
 * teks yang sudah baik. Peraturan tanpa baris `ekstraksi_log` (PDF sudah di R2, ekstraksi belum jalan atau gagal sebelum mencatat)
 * dihitung `tanpa_pasal`.
 */
const URUTAN_TERBURUK = `CASE COALESCE(e.vonis, 'tanpa_pasal') WHEN 'tanpa_pasal' THEN 0 WHEN 'gagal' THEN 1 WHEN 'berat' THEN 2 WHEN 'ringan' THEN 3 ELSE 4 END`;

/**
 * Bagian FROM/WHERE calon yang dipakai Cron dan ringkasan, supaya hitungan yang dilaporkan sama dengan yang akan dikerjakan.
 * Mode `uji` tak mengulang peraturan yang sudah punya catatan apa pun; mode `ya` hanya melewati yang sudah dicoba sungguhan.
 */
export function sqlCalon(cakupanEnv: string | undefined, vonis: string[], mode: ModeOtomatis): string {
  const dalam = klausaCakupan(bacaCakupan(cakupanEnv), "l.jenis");
  const belum =
    mode === "uji"
      ? "NOT EXISTS (SELECT 1 FROM pembacaan_ai p WHERE p.frbr_uri = l.frbr_uri)"
      : "NOT EXISTS (SELECT 1 FROM pembacaan_ai p WHERE p.frbr_uri = l.frbr_uri AND p.hasil <> 'uji')";
  return `FROM laws l LEFT JOIN ekstraksi_log e ON e.frbr_uri = l.frbr_uri
           WHERE ${dalam} AND l.r2_pdf_key IS NOT NULL AND COALESCE(e.vonis, 'tanpa_pasal') IN (${vonis.map(() => "?").join(",")}) AND ${belum}`;
}

/** Putaran Cron terakhir yang mengantrekan pekerjaan (disimpan di KV). */
export interface PutaranOtomatis {
  waktu: number;
  mode: ModeOtomatis;
  uris: string[];
}

export type HasilOtomatis = { dikerjakan: false; alasan: string } | { dikerjakan: true; mode: ModeOtomatis; diantrekan: string[] };

const tanpa = (alasan: string): HasilOtomatis => ({ dikerjakan: false, alasan });

/** Waktu dalam bentuk kolom `datetime('now')` SQLite (UTC, "YYYY-MM-DD HH:MM:SS"), supaya dapat dibandingkan sebagai teks. */
const waktuSqlite = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

async function bacaPutaran(kv: KVNamespace): Promise<PutaranOtomatis | null> {
  try {
    const p = JSON.parse((await kv.get(KUNCI_PUTARAN)) ?? "null") as PutaranOtomatis | null;
    return p && Array.isArray(p.uris) && typeof p.waktu === "number" ? p : null;
  } catch {
    return null;
  }
}

/**
 * Berapa peraturan ber-PDF yang belum pernah dibaca Gemini sungguhan (percobaan kering tak dihitung), menurut vonis ekstraksinya.
 * `calon` memakai vonis yang berlaku untuk mode `ya`; `bermasalah` hanya yang teksnya jelas rusak (tanpa_pasal, berat, gagal).
 */
export async function hitungBelumDibaca(db: D1Database, cakupanEnv: string | undefined, vonis: string[] = VONIS_BAWAAN_YA) {
  const { results } = await db
    .prepare(`SELECT COALESCE(e.vonis, 'tanpa_pasal') AS vonis, COUNT(*) AS n ${sqlCalon(cakupanEnv, VONIS_SAH, "ya")} GROUP BY 1`)
    .bind(...VONIS_SAH)
    .all<{ vonis: string; n: number }>();
  const perVonis: Record<string, number> = Object.fromEntries(results.map((r) => [r.vonis, r.n]));
  const jumlah = (daftar: string[]) => daftar.reduce((a, v) => a + (perVonis[v] ?? 0), 0);
  return { per_vonis: perVonis, calon: jumlah(vonis), bermasalah: jumlah(VONIS_BAWAAN_UJI), semua: jumlah(VONIS_SAH) };
}

/** Status untuk /api/impor/ringkasan: pengaturan yang berlaku dan putaran terakhir. */
export async function statusOtomatis(env: EnvOtomatis & { CACHE: KVNamespace }) {
  const k = bacaKonfigOtomatis(env);
  const putaran = await bacaPutaran(env.CACHE);
  return {
    mode: k.mode,
    batas: k.batas,
    uji_maks: k.ujiMaks,
    vonis: k.vonis,
    putaran_terakhir: putaran ? { pada: new Date(putaran.waktu).toISOString(), mode: putaran.mode, jumlah: putaran.uris.length } : null,
  };
}

/**
 * Satu putaran Cron: antrekan calon berikutnya bila mode menyala, kunci ada, anggaran hari ini tersisa, dan putaran sebelumnya
 * sudah selesai. Tak melempar untuk keadaan biasa; hasilnya menyebut alasan bila tak ada yang dikerjakan.
 */
export async function jalankanGeminiOtomatis(env: Env, sekarang = Date.now()): Promise<HasilOtomatis> {
  const o = bacaKonfigOtomatis(env);
  if (o.mode === "mati") return tanpa("mati");
  const k = bacaKonfigGemini(env);
  if (!k) return tanpa("secret GEMINI_API belum dipasang");

  if ((await pemakaianHariIni(env.CACHE)) >= k.anggaranHarian) return tanpa("anggaran token hari ini habis");

  // Putaran sebelumnya: tunggu sampai semua pesannya tercatat, kecuali sudah terlalu lama.
  const sebelumnya = await bacaPutaran(env.CACHE);
  if (sebelumnya && sebelumnya.uris.length && sekarang - sebelumnya.waktu < MAKS_UMUR_PUTARAN_MS) {
    const { results } = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM pembacaan_ai WHERE frbr_uri IN (${sebelumnya.uris.map(() => "?").join(",")}) AND dicoba_at >= ?`)
      .bind(...sebelumnya.uris, waktuSqlite(sebelumnya.waktu))
      .all<{ n: number }>();
    if ((results[0]?.n ?? 0) < sebelumnya.uris.length) return tanpa("putaran sebelumnya masih berjalan");
  }

  let jumlah = o.batas;
  if (o.mode === "uji") {
    const sudah = await env.DB.prepare(`SELECT COUNT(*) AS n FROM pembacaan_ai WHERE hasil = 'uji'`).first<{ n: number }>();
    jumlah = Math.min(jumlah, o.ujiMaks - (sudah?.n ?? 0));
    if (jumlah <= 0) return tanpa(`uji otomatis selesai (${o.ujiMaks} percobaan): periksa hasilnya di pembacaan_ai, lalu setel GEMINI_OTOMATIS=ya`);
  }

  // Percobaan kering mengambil contoh yang paling dicari (UU dan PP terbaru lebih dulu); pembacaan sungguhan mendahulukan teks yang
  // paling rusak, lalu prioritas yang sama.
  const urutan = o.mode === "ya" ? `${URUTAN_TERBURUK}, ${sqlPrioritas("l.")}` : sqlPrioritas("l.");
  const { results } = await env.DB
    .prepare(`SELECT l.frbr_uri, l.r2_pdf_key ${sqlCalon(env.CAKUPAN_JENIS, o.vonis, o.mode)} ORDER BY ${urutan}, l.frbr_uri LIMIT ?`)
    .bind(...o.vonis, jumlah)
    .all<{ frbr_uri: string; r2_pdf_key: string }>();
  if (!results.length) return tanpa("tidak ada calon");

  await env.INGEST_QUEUE.sendBatch(
    results.map((r) => ({
      body: {
        tipe: "ekstrak_pdf", frbr_uri: r.frbr_uri, r2_key: r.r2_pdf_key, pembaca: "gemini", otomatis: true, ...(o.mode === "uji" ? { uji: true } : {}),
      } satisfies PesanIngest,
    })),
  );
  const uris = results.map((r) => r.frbr_uri);
  const putaran: PutaranOtomatis = { waktu: sekarang, mode: o.mode, uris };
  await env.CACHE.put(KUNCI_PUTARAN, JSON.stringify(putaran), { expirationTtl: 2 * 3600 }).catch(() => {});
  await env.DB
    .prepare(`INSERT INTO sync_log (job, status, detail, jumlah) VALUES ('gemini_otomatis', 'sukses', ?, ?)`)
    .bind(`${o.mode}: ${uris.slice(0, 5).join(", ")}${uris.length > 5 ? ", ..." : ""}`.slice(0, 300), uris.length)
    .run()
    .catch(() => {});
  return { dikerjakan: true, mode: o.mode, diantrekan: uris };
}
