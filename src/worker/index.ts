/**
 * Titik masuk Worker Lexa.
 *
 * Satu Worker mengerjakan tiga peran:
 *   - `fetch`     : melayani /api/* (sisanya jatuh ke static assets SPA)
 *   - `scheduled` : Cron harian, pemeliharaan (lib/pemeliharaan.ts), dan Cron 15 menit: Gemini otomatis (lib/geminiOtomatis.ts; mati
 *                   kecuali variabel GEMINI_OTOMATIS dipasang) serta uraian ulang otomatis (lib/uraianUlang.ts)
 *   - `queue`     : konsumer antrean ingest: ekstraksi PDF hasil panen BPK, indeks vektor, dan ringkasan AI
 *
 * Worker tidak pernah menghubungi sumber data peraturan mana pun: data datang dari panen BPK yang dijalankan di
 * peramban pengelola (scripts/bpk-console-harvest.js) dan masuk lewat /api/impor/*.
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
import { bacaCakupan, klausaCakupan } from "../shared/cakupan";
import { buatKonteksIngest, catatGalatGeminiSementara, prosesPesanIngest, type PesanIngest } from "./lib/ingest";
import { GalatGemini } from "./lib/gemini";
import { catatDenyut } from "./lib/keadaan";
import { CRON_GEMINI, CRON_HARIAN } from "./lib/jadwal";
import { jalankanGeminiOtomatis } from "./lib/geminiOtomatis";
import { jalankanUraianUlang } from "./lib/uraianUlang";
import { jalankanPemeliharaan } from "./lib/pemeliharaan";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  await next();
  // Header keamanan dasar. CSP sengaja ketat: aplikasi ini tidak memuat aset
  // pihak ketiga sama sekali.
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Frame-Options", "DENY");
  // HSTS hanya bermakna lewat HTTPS (peramban mengabaikannya di HTTP biasa, mis. pratinjau lokal). Tanpa "preload":
  // *.workers.dev berada di TLD .dev, yang sudah dipaksa HTTPS oleh daftar preload peramban.
  if (c.req.url.startsWith("https:")) c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
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

/**
 * Pesan pembacaan Gemini memakan menit per PDF, sedangkan satu pemanggilan konsumer dibatasi 15 menit waktu dinding. Pesan Gemini
 * baru tak dimulai sesudah sekian lama sejak batch dimulai (yang tersisa ditunda: dikirim ulang untuk pemanggilan berikutnya).
 * Pesan yang sudah dimulai punya tenggatnya sendiri (TENGGAT_PESAN_MS, 7 menit, ditambah panggilan yang masih berjalan paling lama
 * 3 menit), jadi yang terburuk 4 + 7 + 3 = 14 menit: di bawah 15.
 */
const BATAS_GILIRAN_GEMINI_MS = 4 * 60_000;

/**
 * Menunda pesan yang tak sempat dikerjakan di giliran ini: dikirim ulang sebagai pesan baru (dengan jeda), lalu yang lama diakui.
 * Bukan `retry()`: tiap `retry()` menghabiskan satu dari `max_retries` pesan itu, jadi pesan di ujung batch besar (pembacaan sungguhan
 * mengantrekan sampai 20 peraturan, dan tiap pembacaan memakan menit) jatuh ke DLQ hanya karena menunggu giliran. Bila pengiriman
 * ulang gagal, jatuh ke `retry()`.
 */
async function tundaPesan(env: Env, pesan: Message<PesanIngest>, detik: number) {
  try {
    await env.INGEST_QUEUE.send(pesan.body, { delaySeconds: detik });
    pesan.ack();
  } catch (e) {
    console.error("Lexa: pesan tak bisa dikirim ulang, memakai retry", e);
    pesan.retry({ delaySeconds: detik });
  }
}

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    // Pemicu 15 menit: Gemini otomatis (mati kecuali GEMINI_OTOMATIS dipasang, dan kembali seketika bila mati) dan uraian ulang otomatis
    // peraturan berversi pengurai lama (nyala bawaan, tak mengerjakan apa pun bila tak ada yang usang). Saling bebas.
    if (event.cron === CRON_GEMINI) {
      ctx.waitUntil(
        jalankanGeminiOtomatis(env).then(
          (h) => (h.dikerjakan ? console.log("Lexa: Gemini otomatis mengantrekan", h.mode, h.diantrekan.length) : undefined),
          (e) => console.error("Lexa: Gemini otomatis gagal", e),
        ),
      );
      ctx.waitUntil(
        jalankanUraianUlang(env).then(
          (h) => (h.dikerjakan ? console.log("Lexa: uraian ulang otomatis mengantrekan", h.diantrekan.length, "usang tersisa", h.tersisa) : undefined),
          (e) => console.error("Lexa: uraian ulang otomatis gagal", e),
        ),
      );
      return;
    }
    // Pemicu lain yang dikenal hanya pemeliharaan harian. Pemicu yang tak dikenal (sisa konfigurasi lama di dashboard) tidak
    // mengerjakan apa pun, supaya pemicu yang salah pasang tak menjalankan pemeliharaan berulang-ulang.
    if (event.cron !== CRON_HARIAN) {
      console.log("Lexa: pemicu Cron tak dikenal diabaikan:", event.cron);
      return;
    }
    // Jejak bahwa pemicu ini berjalan; kegagalan mencatat tak boleh menghentikan pekerjaannya.
    ctx.waitUntil(catatDenyut(env.DB, event.cron).catch((e) => console.error("Lexa: denyut gagal dicatat", e)));
    ctx.waitUntil(
      jalankanPemeliharaan({ db: env.DB, docs: env.DOCS, vectorize: env.VECTORIZE }).catch((e) => console.error("Lexa: pemeliharaan gagal", e)),
    );
  },

  async queue(batch: MessageBatch<PesanIngest>, env: Env) {
    const ctx = buatKonteksIngest(env);
    const mulai = Date.now();

    // Diproses berurutan, bukan paralel: pengindeksan memanggil Workers AI, dan paralel menembus batas lajunya.
    for (const pesan of batch.messages) {
      const gemini = pesan.body?.tipe === "ekstrak_pdf" && pesan.body.pembaca === "gemini";
      if (gemini && Date.now() - mulai > BATAS_GILIRAN_GEMINI_MS) {
        await tundaPesan(env, pesan, 30);
        continue;
      }
      try {
        await prosesPesanIngest(ctx, pesan.body);
        pesan.ack();
      } catch (e) {
        console.error("Lexa: ingest gagal", pesan.body, e);
        // retry() memakai backoff bawaan Queues; setelah max_retries pesan jatuh ke lexa-ingest-dlq untuk diperiksa manual.
        // Kuota atau gangguan Gemini membawa jeda yang disarankan (Retry-After): mengulang seketika hanya menghabiskan percobaan.
        const jeda = e instanceof GalatGemini ? e.jedaDetik : undefined;
        if (e instanceof GalatGemini && e.sementara) await catatGalatGeminiSementara(ctx, e, (pesan.body as { frbr_uri?: string } | undefined)?.frbr_uri ?? null);
        if (jeda) pesan.retry({ delaySeconds: Math.min(jeda, 3600) });
        else pesan.retry();
      }
    }
  },
} satisfies ExportedHandler<Env, PesanIngest>;
