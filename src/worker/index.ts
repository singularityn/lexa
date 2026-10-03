/**
 * Titik masuk Worker Lexa.
 *
 * Satu Worker mengerjakan tiga peran:
 *   - `fetch`     : melayani /api/* (sisanya jatuh ke static assets SPA)
 *   - `scheduled` : Cron harian yang menjadwalkan sinkronisasi
 *   - `queue`     : konsumer antrean yang menarik & mengindeks tiap peraturan
 */

import { Hono } from "hono";
import { api } from "./routes/api";
import { impor } from "./routes/impor";
import { dokumen } from "./routes/dokumen";
import { fitur } from "./routes/fitur";
import { auth } from "./routes/auth";
import { tanya } from "./routes/tanya";
import { koleksi } from "./routes/koleksi";
import { PasalClient, PasalRateLimitError } from "./lib/pasal";
import {
  jadwalkanSinkronisasi,
  prosesPesanIngest,
  type KonteksIngest,
  type PesanIngest,
} from "./lib/ingest";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  await next();
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

// --- robots.txt & sitemap: halaman peraturan sangat layak diindeks mesin cari ---
app.get("/robots.txt", (c) => {
  const asal = new URL(c.req.url).origin;
  return c.text(
    `User-agent: *\nAllow: /\nDisallow: /api/admin/\n\nSitemap: ${asal}/sitemap.xml\n`,
  );
});

app.get("/sitemap.xml", async (c) => {
  const asal = new URL(c.req.url).origin;
  // Batas 5.000 URL per sitemap agar ukuran respons tetap wajar.
  const { results } = await c.env.DB.prepare(
    `SELECT frbr_uri, updated_at FROM laws ORDER BY tahun DESC LIMIT 5000`,
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
  };
}

export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (!env.PASAL_API_TOKEN) {
      console.warn("Lexa: PASAL_API_TOKEN belum diatur — sinkronisasi dilewati.");
      return;
    }
    ctx.waitUntil(
      jadwalkanSinkronisasi(konteksIngest(env)).catch((e) => {
        console.error("Lexa: sinkronisasi terjadwal gagal", e);
      }),
    );
  },

  async queue(batch: MessageBatch<PesanIngest>, env: Env) {
    const ctx = konteksIngest(env);

    // Diproses berurutan, bukan paralel: pasal.id membatasi endpoint detail di
    // 60 permintaan/menit, dan Promise.all atas satu batch akan menembusnya.
    for (let i = 0; i < batch.messages.length; i++) {
      const pesan = batch.messages[i];
      try {
        await prosesPesanIngest(ctx, pesan.body);
        pesan.ack();
      } catch (e) {
        if (e instanceof PasalRateLimitError) {
          // Sekali kena 429, sisa batch pasti kena hal yang sama. Kalau tiap
          // pesan dibiarkan gagal sendiri-sendiri dengan backoff bawaan, jatah
          // retry habis hanya untuk menunggu — dan pesan yang sebenarnya sehat
          // berakhir di dead-letter queue. Jadi seluruh sisa batch ditunda
          // sekaligus sampai jendela rate limit terbuka lagi.
          const tunda = Math.min(Math.max(Math.ceil(e.retryAfterMs / 1000), 60), 3600);
          for (let j = i; j < batch.messages.length; j++) {
            batch.messages[j].retry({ delaySeconds: tunda });
          }
          ctx.db
            .prepare(
              `INSERT INTO sync_log (job, status, detail, jumlah)
               VALUES ('antrean_ingest', 'gagal', ?, ?)`,
            )
            .bind(
              `rate limit pasal.id — ${batch.messages.length - i} pesan ditunda ${tunda} detik`,
              batch.messages.length - i,
            )
            .run()
            .catch(() => {});
          return;
        }

        console.error("Lexa: ingest gagal", pesan.body, e);
        // retry() memakai backoff bawaan Queues; setelah max_retries pesan
        // jatuh ke lexa-ingest-dlq untuk diperiksa manual.
        pesan.retry();
      }
    }
  },
} satisfies ExportedHandler<Env, PesanIngest>;
