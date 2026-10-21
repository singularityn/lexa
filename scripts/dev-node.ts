/**
 * Pratinjau lokal Lexa di Node, tanpa akun Cloudflare dan tanpa wrangler.
 *
 * Menjalankan Worker ASLI (src/worker/index.ts) bersama antarmuka (public/) di
 * atas SQLite sungguhan (node:sqlite) dengan migrasi produksi apa adanya. Binding
 * lain berupa tiruan (lihat test/integration/harness.ts): KV, R2, Queue, Workers
 * AI, dan Vectorize. Akibatnya pencarian makna dan jawaban Tanya Lexa di sini
 * hanya peragaan; kualitasnya tidak mewakili produksi.
 *
 *   npm run dev:node            # http://localhost:8787
 *   PORT=3000 npm run dev:node
 *   LEXA_DATA_NYATA=.dev/data-nyata.json npm run dev:node   # salinan data produksi, lihat muatDataNyata
 *
 * Aturan routing meniru wrangler.jsonc: /api/*, /robots.txt, /sitemap.xml, dan
 * /peraturan dilayani Worker; selainnya aset statis dengan fallback SPA. Header dari
 * public/_headers (termasuk CSP) diterapkan agar pelanggarannya terlihat di sini.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import worker from "../src/worker/index";
import { buatLingkungan, indeksSemua, jalankanAntrean, masukSebagai, sisipkan, sisipkanRelasi, TOKEN_ADMIN, type Lingkungan } from "../test/integration/harness";
import { isiDataContoh, jawabanContoh, PERATURAN_CONTOH } from "./dev-seed";

const PORT = Number(process.env.PORT ?? 8787);
const AKAR_PUBLIK = resolve("public");

const PDF_CONTOH = new TextEncoder().encode(
  "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n" +
    "4 0 obj<</Length 48>>stream\nBT /F1 18 Tf 20 70 Td (Contoh PDF Lexa) Tj ET\nendstream endobj\n" +
    "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

/**
 * Gemini palsu untuk pratinjau dan tes e2e: permintaan ke alamat ini dijawab di sini, tanpa jaringan. Hanya meniru bentuk jawaban
 * generateContent (teks, token, versi model); mutunya tak mewakili Gemini sungguhan. `modeGemini` diubah lewat POST /__dev/gemini.
 */
const ALAMAT_GEMINI_PALSU = "https://gemini.pratinjau.test/v1beta";
/** Model cadangan palsu (GEMINI_MODEL_CADANGAN di `siapkan`); model utamanya `gemini-pratinjau`. */
const MODEL_CADANGAN_PALSU = "gemini-cadangan";
/**
 * ok = semua model menjawab; kunci = kunci ditolak (400); kuota = semua model 429; sibuk = model utama 503 "high demand" dan
 * cadangan menjawab; sibuk-semua = semua model 503; kuota-utama = model utama 429 dan cadangan menjawab.
 */
type ModeGemini = "ok" | "kunci" | "kuota" | "sibuk" | "sibuk-semua" | "kuota-utama";
const MODE_GEMINI: readonly ModeGemini[] = ["ok", "kunci", "kuota", "sibuk", "sibuk-semua", "kuota-utama"];
let modeGemini: ModeGemini = "ok";
/** Bila diisi, hanya sekian permintaan berikutnya yang gagal menurut `modeGemini`; sesudahnya kembali `ok` (galat sementara yang reda). */
let sisaGagalGemini: number | null = null;
/** Header `retry-after` (detik) pada jawaban 429; tes mengubahnya lewat `retryAfter=` untuk memeriksa lama tunggu skrip panen. */
let retryAfterGemini = 30;
/** Permintaan yang sampai ke Gemini palsu sejak pratinjau disiapkan (tes memastikan tak ada permintaan baru sesudah tombol Berhenti). */
let permintaanGemini = 0;
const NASKAH_GEMINI_PALSU = [
  "=== HALAMAN 1 ===", "BAB I", "KETENTUAN UMUM", "Pasal 1",
  "Dalam peraturan ini yang dimaksud dengan pindaian adalah dokumen yang dibaca sebagai gambar halaman.",
  "Pasal 2", "(1) Setiap orang wajib menjaga keaslian dokumen yang dipindai.",
  "(2) Pembacaan otomatis harus diperiksa terhadap naskah asli sebelum dikutip.",
  "Pasal 3", "Ketentuan lebih lanjut diatur dengan Peraturan Menteri.",
].join("\n");

function jawabGeminiPalsu(alamat: string, init?: RequestInit): Response {
  const galat = (status: number, pesan: string, header: Record<string, string> = {}) =>
    new Response(JSON.stringify({ error: { code: status, message: pesan, status: "GALAT" } }), { status, headers: header });
  permintaanGemini++;
  const cadangan = /\/models\/([^:/]+):/.exec(alamat)?.[1] === MODEL_CADANGAN_PALSU;
  const penuh = () => galat(503, "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.");
  const habis = () => galat(429, "Resource has been exhausted (e.g. check quota).", { "retry-after": String(retryAfterGemini) });
  const gagal =
    modeGemini === "kunci" ? galat(400, "API key not valid. Please pass a valid API key.")
    : modeGemini === "kuota" ? habis()
    : modeGemini === "kuota-utama" && !cadangan ? habis()
    : modeGemini === "sibuk" && !cadangan ? penuh()
    : modeGemini === "sibuk-semua" ? penuh()
    : null;
  if (gagal) {
    if (sisaGagalGemini !== null && --sisaGagalGemini <= 0) {
      modeGemini = "ok";
      sisaGagalGemini = null;
    }
    return gagal;
  }
  const sebaris = String(init?.body ?? "").includes("inlineData");
  const teks = sebaris ? NASKAH_GEMINI_PALSU : "siap";
  const masuk = sebaris ? 2400 : 10;
  const keluar = sebaris ? 310 : 2;
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: teks }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: masuk, candidatesTokenCount: keluar, totalTokenCount: masuk + keluar },
      modelVersion: cadangan ? "gemini-cadangan-001" : "gemini-pratinjau-001",
    }),
    { status: 200 },
  );
}

const fetchAsli = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const alamat = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return alamat.startsWith(ALAMAT_GEMINI_PALSU) ? jawabGeminiPalsu(alamat, init) : fetchAsli(input, init);
}) as typeof fetch;

const DATA_NYATA = process.env.LEXA_DATA_NYATA;
// Hanya untuk tes e2e service worker: tanpa ini jawaban API yang masih "segar" menurut cache HTTP peramban
// dilayani tanpa menyentuh jaringan, sehingga jalur cadangan service worker saat luring tak teruji.
const TANPA_CACHE_API = process.env.LEXA_TANPA_CACHE_API === "1";

/**
 * Muat salinan baris produksi (laws, articles, relations) dari berkas JSON lokal, supaya tampilan
 * dinilai dengan judul, pasal, dan relasi yang sungguhan. Berkasnya tidak boleh masuk Git (.dev/
 * sudah diabaikan). Format: {"laws": [...], "articles": [...], "relations": [...]} dengan nama
 * kolom persis seperti tabelnya.
 */
async function muatDataNyata(l: Lingkungan, berkas: string): Promise<string[]> {
  const data = JSON.parse(new TextDecoder().decode(await readFile(berkas))) as Record<"laws" | "articles" | "relations", Array<Record<string, unknown>>>;
  const ada = new Set((data.laws ?? []).map((b) => String(b.frbr_uri)));
  for (const tabel of ["laws", "articles", "relations"] as const) {
    for (const baris of data[tabel] ?? []) {
      // Kunci asing: pasal dan relasi hanya boleh bersumber dari peraturan yang ikut dimuat.
      if (tabel === "articles" && !ada.has(String(baris.frbr_uri))) continue;
      if (tabel === "relations" && !ada.has(String(baris.from_uri))) continue;
      const kolom = Object.keys(baris);
      await l.db
        .prepare(`INSERT OR IGNORE INTO ${tabel} (${kolom.join(",")}) VALUES (${kolom.map(() => "?").join(",")})`)
        .bind(...kolom.map((k) => baris[k]))
        .run();
    }
  }
  return [...new Set((data.articles ?? []).map((a) => String(a.frbr_uri)))];
}

async function siapkan(): Promise<Lingkungan> {
  const l = buatLingkungan();
  // Binding ASSETS (dipakai /peraturan untuk pratinjau tautan) menyajikan cangkang yang sama dengan jalur statis di bawah.
  l.aset.gantiCangkang = (html) => html.replace("</body>", `${PITA}</body>`);
  // Kunci tiruan agar tombol "Masuk dengan Google" tampil; alurnya dialihkan ke /__dev/masuk (lihat bawah).
  Object.assign(l.env, { GOOGLE_CLIENT_ID: "pratinjau-lokal", GOOGLE_CLIENT_SECRET: "pratinjau-lokal" });
  // Gemini palsu (lihat atas): kunci dan alamat tiruan supaya jalur pembacaan PDF pindaian bisa dicoba tanpa jaringan.
  Object.assign(l.env, { GEMINI_API: "kunci-pratinjau", GEMINI_MODEL: "gemini-pratinjau", GEMINI_MODEL_CADANGAN: MODEL_CADANGAN_PALSU, GEMINI_BASE_URL: ALAMAT_GEMINI_PALSU });
  modeGemini = "ok";
  sisaGagalGemini = null;
  retryAfterGemini = 30;
  permintaanGemini = 0;
  // Cakupan peraturan sama dengan produksi (bawaan di src/shared/cakupan.ts). CAKUPAN_JENIS melebarkannya, mis. untuk
  // melihat salinan data produksi yang memuat Perpres atau POJK: CAKUPAN_JENIS=UU,PERPPU,PP,PERPRES npm run dev:node.
  if (process.env.CAKUPAN_JENIS) l.env.CAKUPAN_JENIS = process.env.CAKUPAN_JENIS;
  l.ai.jawaban = (masukan) => jawabanContoh(masukan.messages.at(-1)?.content ?? "");
  if (DATA_NYATA) {
    await indeksSemua(l, await muatDataNyata(l, DATA_NYATA));
  } else {
    await isiDataContoh(l, sisipkan, sisipkanRelasi);
    await indeksSemua(l, PERATURAN_CONTOH.map((p) => p.uri));
  }

  // Satu peraturan lengkap dengan arsip PDF dan teks, untuk memperagakan tab Naskah.
  const uri = "/akn/id/act/uu/2003/13";
  await l.r2.put("pdf/akn/id/act/uu/2003/13.pdf", PDF_CONTOH, { httpMetadata: { contentType: "application/pdf" } });
  await l.r2.put("teks/akn/id/act/uu/2003/13.md", "# UU 13/2003\n\nContoh teks hasil konversi.\n\nPasal 82\n(1) Pekerja perempuan berhak …", {
    httpMetadata: { contentType: "text/markdown" },
  });
  await l.db
    .prepare(`UPDATE laws SET r2_pdf_key = 'pdf/akn/id/act/uu/2003/13.pdf', r2_text_key = 'teks/akn/id/act/uu/2003/13.md' WHERE frbr_uri = ?`)
    .bind(uri)
    .run();
  // Satu baris log ekstraksi berversi pengurai lama (0), supaya ekstrak-ulang mode `usang` punya sesuatu untuk diantrekan.
  await l.db
    .prepare(
      `INSERT INTO ekstraksi_log (frbr_uri, r2_pdf_key, vonis, versi_parser)
       SELECT frbr_uri, 'pdf/akn/id/act/uu/2003/13.pdf', 'bersih', 0 FROM laws WHERE frbr_uri = ?`,
    )
    .bind(uri)
    .run();
  await l.db.prepare(`INSERT INTO sync_log (job, status, detail, jumlah, durasi_ms) VALUES ('jadwal_sinkronisasi','sukses','diperiksa 11',11,420)`).run();
  await l.db.prepare(`INSERT INTO sync_log (job, status, detail, jumlah) VALUES ('ekstrak_pdf','gagal','tidak ada pasal terdeteksi',0)`).run();
  return l;
}

const TIPE: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/** Header global dari public/_headers (hanya blok `/*`, cukup untuk pratinjau). */
async function bacaHeaderStatik(): Promise<Record<string, string>> {
  const hasil: Record<string, string> = {};
  try {
    const teks = new TextDecoder().decode(await readFile(join(AKAR_PUBLIK, "_headers")));
    let aktif = false;
    for (const baris of teks.split("\n")) {
      if (!baris.trim() || baris.trim().startsWith("#")) continue;
      if (!/^\s/.test(baris)) {
        aktif = baris.trim() === "/*";
        continue;
      }
      if (!aktif) continue;
      const i = baris.indexOf(":");
      if (i > 0) hasil[baris.slice(0, i).trim()] = baris.slice(i + 1).trim();
    }
  } catch {
    // tanpa _headers pun pratinjau tetap jalan
  }
  return hasil;
}

const PITA = DATA_NYATA
  ? '<div class="pita-dev" role="note">Pratinjau lokal · salinan data produksi, hanya untuk dinilai</div>'
  : '<div class="pita-dev" role="note">Pratinjau lokal · data contoh, bukan naskah resmi</div>';

async function main() {
  let l = await siapkan();
  const headerStatik = await bacaHeaderStatik();
  const tugas: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => void tugas.push(p),
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `localhost:${PORT}`}`);
      // Pratinjau saja: "Masuk dengan Google" diganti masuk instan sebagai pengguna uji,
      // supaya alur akun dan sinkronisasi koleksi bisa dicoba tanpa Google.
      if (url.pathname === "/api/auth/google") {
        res.writeHead(302, { location: `/__dev/masuk${url.search}` });
        res.end();
        return;
      }
      // Pratinjau saja: kembalikan semua data ke keadaan awal (dipakai tes e2e).
      if (url.pathname === "/__dev/reset" && req.method === "POST") {
        l.tutup();
        l = await siapkan();
        res.writeHead(204);
        res.end();
        return;
      }
      // Pratinjau saja: kerjakan semua pesan antrean yang menunggu (di produksi dikerjakan konsumer Cloudflare Queues).
      if (url.pathname === "/__dev/antrean" && req.method === "POST") {
        let hasil = { diakui: 0, diulang: 0, pesan: 0 };
        for (let putaran = 0; putaran < 10; putaran++) {
          const pesan = l.antrean.kuras();
          if (!pesan.length) break;
          const r = await jalankanAntrean(l, pesan);
          hasil = { diakui: hasil.diakui + r.diakui, diulang: hasil.diulang + r.diulang.length, pesan: hasil.pesan + pesan.length };
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(hasil));
        return;
      }
      // Pratinjau saja: ubah perilaku Gemini palsu (lihat ModeGemini). `berapa=N`: hanya N jawaban galat berikutnya, lalu kembali ok;
      // `retryAfter=S`: detik pada header retry-after jawaban 429. GET: keadaan sekarang dan jumlah permintaan yang sudah diterima.
      if (url.pathname === "/__dev/gemini" && (req.method === "POST" || req.method === "GET")) {
        if (req.method === "POST") {
          const mode = url.searchParams.get("mode");
          const berapa = Number.parseInt(url.searchParams.get("berapa") ?? "", 10);
          const tunggu = Number.parseInt(url.searchParams.get("retryAfter") ?? "", 10);
          if (MODE_GEMINI.includes(mode as ModeGemini)) {
            modeGemini = mode as ModeGemini;
            sisaGagalGemini = Number.isFinite(berapa) && berapa > 0 ? berapa : null;
          }
          if (Number.isFinite(tunggu) && tunggu > 0) retryAfterGemini = tunggu;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ mode: modeGemini, sisa_gagal: sisaGagalGemini, retry_after: retryAfterGemini, permintaan: permintaanGemini }));
        return;
      }
      // Pratinjau saja: buat peraturan sintetis dengan banyak pasal untuk menguji kinerja halaman detail.
      if (url.pathname === "/__dev/peraturan-besar" && req.method === "POST") {
        const jumlah = Math.min(Math.max(Number(url.searchParams.get("pasal")) || 1500, 1), 5000);
        const uri = "/akn/id/act/uu/2099/1";
        await sisipkan(l, [
          {
            uri, jenis: "UU", nomor: "1", tahun: 2099, judul: "Peraturan Sintetis Sangat Panjang (uji kinerja)", bidang: "UJI",
            pasal: Array.from({ length: jumlah }, (_, i) => ({
              nomor: String(Math.floor(i / 2) + 1),
              ayat: String((i % 2) + 1),
              bab: `BAB ${Math.floor(i / 100) + 1} KETENTUAN BAGIAN ${Math.floor(i / 100) + 1}`,
              isi: `Ketentuan nomor ${i + 1}: setiap orang wajib mematuhi ketentuan sebagaimana dimaksud dalam undang-undang ini, kecuali ditentukan lain oleh peraturan perundang-undangan.`,
            })),
          },
        ]);
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ uri, jumlah }));
        return;
      }
      if (url.pathname === "/__dev/masuk") {
        const { cookie } = await masukSebagai(l, { id: "pengguna-uji", email: "penguji@lexa.test", nama: "Penguji Lexa", idSesi: "sesi-pratinjau" });
        const kembali = url.searchParams.get("kembali") ?? "/akun";
        res.writeHead(302, {
          location: kembali.startsWith("/") && !kembali.startsWith("//") ? kembali : "/akun",
          "set-cookie": `${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
        });
        res.end();
        return;
      }
      const keWorker = url.pathname.startsWith("/api/") || ["/robots.txt", "/sitemap.xml", "/peraturan"].includes(url.pathname);

      if (keWorker) {
        const potongan: Uint8Array[] = [];
        await new Promise<void>((selesai, gagal) => {
          req.on("data", (c) => potongan.push(c));
          req.on("end", () => selesai());
          req.on("error", gagal);
        });
        const panjang = potongan.reduce((n, c) => n + c.byteLength, 0);
        const badan = new Uint8Array(panjang);
        let posisi = 0;
        for (const c of potongan) {
          badan.set(c, posisi);
          posisi += c.byteLength;
        }

        const header = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) header.set(k, Array.isArray(v) ? v.join(", ") : v);
        header.set("cf-connecting-ip", req.socket.remoteAddress ?? "127.0.0.1");
        const metode = req.method ?? "GET";
        const tanpaBadan = metode === "GET" || metode === "HEAD" || panjang === 0;
        const respons = await worker.fetch(new Request(url, { method: metode, headers: header, body: tanpaBadan ? undefined : badan }), l.env, ctx);
        await Promise.allSettled(tugas.splice(0));

        const keluar: Record<string, string | string[]> = {};
        respons.headers.forEach((v, k) => {
          if (k !== "set-cookie") keluar[k] = v;
        });
        if (TANPA_CACHE_API && url.pathname.startsWith("/api/")) keluar["cache-control"] = "no-store";
        const cookie = respons.headers.getSetCookie();
        if (cookie.length) keluar["set-cookie"] = cookie;
        res.writeHead(respons.status, keluar);
        res.end(new Uint8Array(await respons.arrayBuffer()));
        return;
      }

      // Aset statis dengan fallback SPA (not_found_handling: single-page-application).
      const bersih = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
      let berkas = join(AKAR_PUBLIK, bersih);
      if (!berkas.startsWith(AKAR_PUBLIK)) {
        res.writeHead(403);
        res.end("Dilarang");
        return;
      }
      let ada = await stat(berkas).then((s) => s.isFile()).catch(() => false);
      if (!ada) {
        // Persis seperti Cloudflare bila run_worker_first berupa daftar rute: jalur yang tidak
        // cocok dengan aset apa pun (termasuk berkas yang salah ketik, mis. /js/nggak.js)
        // menyajikan index.html dengan status 200. Perilaku ini diverifikasi di workerd.
        berkas = join(AKAR_PUBLIK, "index.html");
        ada = true;
      }
      let isi = await readFile(berkas);
      const jenis = TIPE[extname(berkas)] ?? "application/octet-stream";
      if (berkas.endsWith("index.html")) {
        isi = new TextEncoder().encode(new TextDecoder().decode(isi).replace("</body>", `${PITA}</body>`));
      }
      res.writeHead(200, { "content-type": jenis, "cache-control": "no-cache", ...headerStatik });
      res.end(isi);
    } catch (e) {
      console.error(e);
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("Galat server pratinjau");
    }
  });

  server.listen(PORT, () => {
    process.stdout.write(
      `\nLexa (pratinjau lokal) berjalan di http://localhost:${PORT}\n` +
        `  - Worker asli + SQLite sungguhan; AI, Vectorize, KV, R2, Queue berupa tiruan\n` +
        `  - ${DATA_NYATA ? `Salinan data produksi dari ${DATA_NYATA}` : `Data contoh: ${PERATURAN_CONTOH.length} peraturan (bukan naskah resmi)`}\n` +
        `  - Token admin lokal: ${TOKEN_ADMIN}\n` +
        `  - Tekan Ctrl+C untuk berhenti\n\n`,
    );
  });
  const berhenti = () => {
    server.close();
    l.tutup();
    process.exit(0);
  };
  process.on("SIGINT", berhenti);
  process.on("SIGTERM", berhenti);
}

main();
