/**
 * Uraian ulang otomatis: Cron mengantrekan peraturan yang pasalnya terakhir diurai dengan versi pengurai lama (`VERSI_PARSER`),
 * sedikit demi sedikit, supaya setiap perbaikan pengurai sampai ke seluruh korpus tanpa pengelola menjalankan skrip konsol
 * (mode `usang` di /api/impor/ekstrak-ulang melakukan hal yang sama atas permintaan).
 *
 * Yang dikerjakan tiap pesan: `ekstrakPdf` mode `dari_teks`, yaitu menguraikan arsip teks yang sudah ada di R2. Tanpa konversi PDF,
 * tanpa Workers AI untuk naskah yang sama; pasal yang hasilnya identik tak ditulis ulang dan tak diindeks ulang (hanya `halaman`
 * yang dilengkapi), jadi biayanya hanya baca-tulis D1 dalam jumlah kecil.
 *
 * Aman dinyalakan terus: tak ada yang usang berarti satu kueri murah tiap 15 menit. Dimatikan dengan `URAIAN_ULANG_OTOMATIS=mati`.
 *
 * Pagar: `URAIAN_ULANG_BATAS` peraturan per putaran (bawaan 20, 1-100) menurut urutan alamat dengan kursor di KV. Peraturan yang gagal
 * diurai tetap berstatus usang dan tak boleh diulang tiap 15 menit selamanya, jadi sesudah kursor mencapai ujung, siklus baru dimulai
 * paling cepat `JEDA_SIKLUS_MS` (6 jam) sesudah siklus sebelumnya dimulai.
 */

import { bacaCakupan, klausaCakupan } from "../../shared/cakupan";
import { VERSI_PARSER } from "./bpk";
import type { PesanIngest } from "./ingest";

export const BATAS_URAIAN_BAWAAN = 20;
export const BATAS_URAIAN_MAKS = 100;
/** Siklus baru (mengulang dari awal peraturan yang masih usang) paling cepat sekian lama sesudah siklus sebelumnya dimulai. */
export const JEDA_SIKLUS_MS = 6 * 3600_000;
export const KUNCI_KURSOR_URAIAN = "uraian-ulang:kursor";

interface KursorUraian {
  /** Alamat peraturan terakhir yang diantrekan pada siklus ini ("" = awal). */
  kursor: string;
  /** Kapan siklus ini dimulai (ms). */
  mulai: number;
}

export type HasilUraianUlang = { dikerjakan: false; alasan: string } | { dikerjakan: true; diantrekan: string[]; tersisa: number };

const tanpa = (alasan: string): HasilUraianUlang => ({ dikerjakan: false, alasan });

const MATI = new Set(["mati", "off", "0", "false", "tidak"]);

export function bacaBatasUraian(nilai: string | undefined): number {
  const n = Number.parseInt((nilai ?? "").trim(), 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), BATAS_URAIAN_MAKS) : BATAS_URAIAN_BAWAAN;
}

async function bacaKursor(kv: KVNamespace, sekarang: number): Promise<KursorUraian> {
  try {
    const k = JSON.parse((await kv.get(KUNCI_KURSOR_URAIAN)) ?? "null") as Partial<KursorUraian> | null;
    if (k && typeof k.kursor === "string" && typeof k.mulai === "number") return { kursor: k.kursor, mulai: k.mulai };
  } catch {
    /* kursor rusak: mulai dari awal */
  }
  return { kursor: "", mulai: sekarang };
}

/** Satu putaran Cron. Tak melempar untuk keadaan biasa; hasilnya menyebut alasan bila tak ada yang dikerjakan. */
export async function jalankanUraianUlang(env: Env, sekarang = Date.now()): Promise<HasilUraianUlang> {
  if (MATI.has((env.URAIAN_ULANG_OTOMATIS ?? "").trim().toLowerCase())) return tanpa("mati");

  const dalam = klausaCakupan(bacaCakupan(env.CAKUPAN_JENIS), "l.jenis");
  const dasar = `FROM laws l JOIN ekstraksi_log e ON e.frbr_uri = l.frbr_uri
                  WHERE ${dalam} AND l.r2_pdf_key IS NOT NULL AND e.vonis <> 'gagal' AND e.versi_parser < ?`;
  const ambil = (setelah: string, batas: number) =>
    env.DB
      .prepare(`SELECT l.frbr_uri, l.r2_pdf_key ${dasar} AND l.frbr_uri > ? ORDER BY l.frbr_uri LIMIT ?`)
      .bind(VERSI_PARSER, setelah, batas)
      .all<{ frbr_uri: string; r2_pdf_key: string }>();

  let k = await bacaKursor(env.CACHE, sekarang);
  const batas = bacaBatasUraian(env.URAIAN_ULANG_BATAS);
  let { results } = await ambil(k.kursor, batas);

  if (!results.length) {
    // Ujung daftar. Tak ada yang usang sama sekali: tak ada yang perlu dilakukan (kursor dibersihkan supaya tak menggantung).
    // Kalau masih ada, sisanya baru diulang pada siklus berikutnya, bukan terus-menerus.
    if (k.kursor === "") return tanpa("tidak ada yang usang");
    const sisa = await env.DB.prepare(`SELECT COUNT(*) AS n ${dasar}`).bind(VERSI_PARSER).first<{ n: number }>();
    if (!sisa?.n) {
      await env.CACHE.delete(KUNCI_KURSOR_URAIAN).catch(() => {});
      return tanpa("tidak ada yang usang");
    }
    if (sekarang - k.mulai < JEDA_SIKLUS_MS) return tanpa("siklus ini selesai; yang masih usang diulang pada siklus berikutnya");
    k = { kursor: "", mulai: sekarang };
    ({ results } = await ambil("", batas));
    if (!results.length) {
      await env.CACHE.put(KUNCI_KURSOR_URAIAN, JSON.stringify(k), { expirationTtl: 30 * 86400 }).catch(() => {});
      return tanpa("tidak ada yang usang");
    }
  }

  await env.INGEST_QUEUE.sendBatch(
    results.map((r) => ({ body: { tipe: "ekstrak_pdf", frbr_uri: r.frbr_uri, r2_key: r.r2_pdf_key, dari_teks: true } satisfies PesanIngest })),
  );
  const uris = results.map((r) => r.frbr_uri);
  await env.CACHE.put(KUNCI_KURSOR_URAIAN, JSON.stringify({ kursor: uris[uris.length - 1], mulai: k.mulai } satisfies KursorUraian), { expirationTtl: 30 * 86400 }).catch(() => {});

  const sisa = await env.DB.prepare(`SELECT COUNT(*) AS n ${dasar}`).bind(VERSI_PARSER).first<{ n: number }>();
  await env.DB
    .prepare(`INSERT INTO sync_log (job, status, detail, jumlah) VALUES ('uraian_ulang', 'sukses', ?, ?)`)
    .bind(`pengurai v${VERSI_PARSER}: ${uris.slice(0, 3).join(", ")}${uris.length > 3 ? ", ..." : ""} (usang tersisa ${sisa?.n ?? "?"})`.slice(0, 300), uris.length)
    .run()
    .catch(() => {});
  return { dikerjakan: true, diantrekan: uris, tersisa: sisa?.n ?? 0 };
}
