/**
 * Titik masuk Worker Lexa.
 *
 * Satu Worker mengerjakan tiga peran:
 *   - `fetch`     : melayani /api/* (sisanya jatuh ke static assets SPA)
 *   - `scheduled` : Cron per menit (tik: kosongkan daftar hapus, sapu katalog, ambil isi peraturan) dan harian
 *                   (pemeliharaan)
 *   - `queue`     : konsumer antrean untuk pekerjaan yang tak menyentuh pasal.id (indeks vektor, ringkasan AI,
 *                   ekstraksi PDF) dan rantai tik cadangan bila Cron per menit tak berjalan
 */

import { Hono } from "hono";
import { api } from "./routes/api";
import { impor } from "./routes/impor";
import { dokumen } from "./routes/dokumen";
import { fitur } from "./routes/fitur";
import { auth } from "./routes/auth";
import { tanya } from "./routes/tanya";
import { koleksi } from "./routes/koleksi";
import { layaniPeraturan } from "./lib/pratinjau";
import { PasalClient } from "./lib/pasal";
import { bacaCakupan, klausaCakupan } from "../shared/cakupan";
import { prosesPesanIngest, type KonteksIngest, type PesanIngest } from "./lib/ingest";
import { jalankanTik } from "./lib/tik";
import { catatDenyut } from "./lib/keadaan";
import { CRON_HARIAN } from "./lib/jadwal";
import { cadanganAktif, generasiSah, sambungTik, semaiTik } from "./lib/cadangan";
import { jalankanPemeliharaan } from "./lib/pemeliharaan";

const app = new Hono<{ Bindings: Env }>();

/** Semai rantai tik cadangan dari permintaan HTTP biasa, paling sering sekali semenit per isolat (lib/cadangan.ts). */
let semaiTerakhir = 0;

app.use("*", async (c, next) => {
  await next();
  if (cadanganAktif(c.env) && Date.now() - semaiTerakhir >= 60_000) {
    semaiTerakhir = Date.now();
    try {
      c.executionCtx.waitUntil(
        semaiTik(c.env.DB, c.env.INGEST_QUEUE).catch((e) => console.error("Lexa: semai tik gagal", e)),
      );
    } catch {
      // Tanpa ExecutionContext (pratinjau lokal): tidak ada yang disemai.
    }
  }
  // Header keamanan dasar. CSP sengaja ketat: aplikasi ini tidak memuat aset
  // pihak ketiga sama sekali.
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Frame-Options", "DENY");
});

// Rute spesifik didaftarkan lebih dulu: `api` menangkap semua sisa rute
// dengan handler 404-nya, jadi apa pun setelahnya tidak akan pernah tercapai.
app.route("/api/impor", impor);
app.route("/api/dokumen", dokumen);
app.route("/api/auth", auth);
app.route("/api/tanya", tanya);
app.route("/api/koleksi", koleksi);
app.route("/api", fitur);
app.route("/api", api);

// --- Halaman peraturan: cangkang SPA dengan pratinjau tautan (WhatsApp, Telegram, mesin pencari) ---
// Termasuk run_worker_first di wrangler.jsonc; lihat lib/pratinjau.ts.
app.get("/peraturan", (c) => layaniPeraturan(c.req.raw, c.env));

// --- robots.txt & sitemap: halaman peraturan sangat layak diindeks mesin cari ---
app.get("/robots.txt", (c) => {
  const asal = new URL(c.req.url).origin;
  return c.text(
    `User-agent: *\nAllow: /\nDisallow: /api/admin/\n\nSitemap: ${asal}/sitemap.xml\n`,
  );
});

app.get("/sitemap.xml", async (c) => {
  const asal = new URL(c.req.url).origin;
  // Batas protokol sitemap: 50.000 URL per berkas (produksi memuat 3.542 peraturan dalam cakupan pada 4 Okt 2026).
  // Bila peraturan melampauinya, ganti dengan indeks sitemap. Hanya yang dalam cakupan: halaman peraturan di
  // luarnya menjawab "di luar cakupan" dan tidak layak diindeks mesin pencari.
  const { results } = await c.env.DB.prepare(
    `SELECT frbr_uri, updated_at FROM laws WHERE ${klausaCakupan(bacaCakupan(c.env.CAKUPAN_JENIS), "jenis")}
      ORDER BY tahun DESC LIMIT 50000`,
  ).all<{ frbr_uri: string; updated_at: string }>();

  const entri = results
    .map(
      (r) =>
        `  <url><loc>${asal}/peraturan?uri=${encodeURIComponent(r.frbr_uri)}</loc>` +
        `<lastmod>${r.updated_at.slice(0, 10)}</lastmod></url>`,
    )
    .join("\n");

  return c.body(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entri}\n</urlset>`,
    200,
    { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  );
});

function konteksIngest(env: Env): KonteksIngest {
  return {
    db: env.DB,
    vectorize: env.VECTORIZE,
    ai: env.AI,
    docs: env.DOCS,
    queue: env.INGEST_QUEUE,
    pasal: new PasalClient({ base: env.PASAL_API_BASE, token: env.PASAL_API_TOKEN }),
    embeddingModel: env.EMBEDDING_MODEL,
    summaryModel: env.SUMMARY_MODEL,
    cakupan: bacaCakupan(env.CAKUPAN_JENIS),
  };
}

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    // Jejak bahwa pemicu ini berjalan; kegagalan mencatat tak boleh menghentikan pekerjaannya.
    ctx.waitUntil(catatDenyut(env.DB, event.cron).catch((e) => console.error("Lexa: denyut gagal dicatat", e)));
    const konteks = konteksIngest(env);

    // Dua pemicu di wrangler.jsonc: harian (pemeliharaan) dan per menit (tik). Yang tak dikenal dianggap tik.
    if (event.cron === CRON_HARIAN) {
      ctx.waitUntil(
        (async () => {
          await jalankanPemeliharaan(konteks).catch((e) => console.error("Lexa: pemeliharaan gagal", e));
          if (cadanganAktif(env)) await semaiTik(env.DB, env.INGEST_QUEUE).catch((e) => console.error("Lexa: semai tik gagal", e));
        })(),
      );
      return;
    }
    ctx.waitUntil(
      jalankanTik(konteks, { pasalSiap: Boolean(env.PASAL_API_TOKEN) }).catch((e) => {
        console.error("Lexa: tik gagal", e);
      }),
    );
  },

  async queue(batch: MessageBatch<PesanIngest>, env: Env) {
    const ctx = konteksIngest(env);
    let tikDikerjakan = false;

    // Diproses berurutan, bukan paralel: pengindeksan memanggil Workers AI, dan paralel menembus batas lajunya.
    for (const pesan of batch.messages) {
      const badan = pesan.body;

      if (badan.tipe === "tik") {
        // Rantai cadangan (lib/cadangan.ts). Satu tik per batch cukup; pesan ganda atau basi dibuang.
        if (!tikDikerjakan && (await generasiSah(env.DB, badan.g).catch(() => true))) {
          tikDikerjakan = true;
          try {
            const laporan = await jalankanTik(ctx, { pasalSiap: Boolean(env.PASAL_API_TOKEN) });
            await catatDenyut(env.DB, "antrean").catch(() => {});
            await sambungTik(env.DB, env.INGEST_QUEUE, badan.g, laporan.dilewati !== "sepi");
          } catch (e) {
            console.error("Lexa: tik antrean gagal", e);
            pesan.retry({ delaySeconds: 60 });
            continue;
          }
        }
        pesan.ack();
        continue;
      }

      try {
        await prosesPesanIngest(ctx, badan);
        pesan.ack();
      } catch (e) {
        console.error("Lexa: ingest gagal", badan, e);
        // retry() memakai backoff bawaan Queues; setelah max_retries pesan jatuh ke lexa-ingest-dlq untuk diperiksa manual.
        pesan.retry();
      }
    }
  },
} satisfies ExportedHandler<Env, PesanIngest>;
