/**
 * Skrip panen BPK (scripts/bpk-console-harvest.js) dijalankan di Chromium terhadap Lexa sungguhan (pratinjau lokal) dan
 * situs BPK palsu: halaman rincian dan PDF dilayani oleh page.route pada origin https://peraturan.bpk.go.id, sedangkan
 * Lexa dijangkau lewat alamat palsu yang diteruskan ke pratinjau. Yang diuji: daftar kerja dari Lexa, pembacaan halaman
 * rincian, pengunduhan PDF, pengunggahan ke Lexa, dan sikap terhadap halaman tantangan dan berkas yang bukan PDF.
 */
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mulaiPratinjau } from "./pembantu.mjs";

const PORT = 4796;
const BASE = `http://localhost:${PORT}`;
const LEXA = "https://lexa.test";
const BPK = "https://peraturan.bpk.go.id";
const TOKEN = "token-admin-uji";
const SKRIP = readFileSync("scripts/bpk-console-harvest.js", "utf8");
const adm = { "x-admin-token": TOKEN, "content-type": "application/json" };
const PDF = "%PDF-1.4\n%palsu untuk tes\n";

let server;
let browser;
let ctx;
let page;

beforeAll(async () => {
  ({ server, browser } = await mulaiPratinjau(PORT));
});
afterAll(async () => {
  await browser?.close();
  server?.kill();
});

const dokumen = (id, nomor) => ({
  bpk_id: String(id),
  detail_url: `${BPK}/Details/${id}/pp-no-${nomor}-tahun-2025`,
  meta: { Judul: `Peraturan Pemerintah ${nomor}`, "Bentuk Singkat": "PP", Nomor: String(nomor), Tahun: "2025", Status: "Berlaku" },
});

async function kirimManifest(daftar) {
  const res = await fetch(`${BASE}/api/impor/manifest`, { method: "POST", headers: adm, body: JSON.stringify({ versi: 1, dokumen: daftar }) });
  expect(res.status).toBe(200);
}
const butuh = async () => (await (await fetch(`${BASE}/api/impor/butuh-teks?jenis=PP`, { headers: adm })).json()).daftar.map((d) => d.frbr_uri);

/** Halaman rincian BPK palsu: tabel metadata dan tautan unduhan. */
const rincian = (id, { tautan = true, tantangan = false } = {}) =>
  tantangan
    ? `<html><head><title>Just a moment...</title></head><body><div id="cf-chl-widget">Verify you are human</div><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>`
    : `<html><head><title>PP ${id}</title></head><body>
         <table><tr><th>Judul</th><td>Peraturan Pemerintah ${id}</td></tr><tr><th>Bentuk Singkat</th><td>PP</td></tr><tr><th>Status:</th><td>Berlaku</td></tr></table>
         ${tautan ? `<a class="btn" href="/Download/${id}0/PP-${id}.pdf">Unduh</a><a href="/Home/Lain">Beranda</a>` : `<p>Tidak ada berkas.</p>`}
       </body></html>`;

beforeEach(async () => {
  const reset = await fetch(`${BASE}/__dev/reset`, { method: "POST" });
  expect(reset.status).toBe(204);
  ctx = await browser.newContext();
  page = await ctx.newPage();
  await page.route(`${LEXA}/**`, async (route) => {
    const res = await route.fetch({ url: route.request().url().replace(LEXA, BASE) });
    await route.fulfill({ response: res });
  });
});
afterEach(async () => {
  await ctx.close();
});

/** Pasang BPK palsu: `halaman` memetakan jalur ke { tipe, isi, status }. */
async function pasangBpk(halaman) {
  await page.route(`${BPK}/**`, (route) => {
    const jalur = new URL(route.request().url()).pathname;
    const h = halaman[jalur];
    if (!h) return route.fulfill({ status: 404, contentType: "text/html", body: "tidak ada" });
    return route.fulfill({ status: h.status ?? 200, contentType: h.tipe ?? "text/html", body: h.isi });
  });
  await page.goto(`${BPK}/`);
  await page.addScriptTag({ content: "window.LEXA_PANEN_OTOMATIS = false;" });
  await page.addScriptTag({ content: SKRIP });
}
const jalankan = (opsi) => page.evaluate((o) => window.lexaPanenBpk(o), { lexa: LEXA, token: TOKEN, jeda: 2000, ...opsi });

describe("skrip panen BPK", () => {
  it("mengambil PDF dari halaman rincian dan mengunggahnya: yang berhasil hilang dari daftar kerja, yang tanpa tautan dicatat gagal", async () => {
    await kirimManifest([dokumen(555, 99), dokumen(556, 98)]);
    expect((await butuh()).sort()).toEqual(["/akn/id/act/pp/2025/98", "/akn/id/act/pp/2025/99"]);
    await pasangBpk({
      "/Details/555/pp-no-99-tahun-2025": { isi: rincian(555) },
      "/Details/556/pp-no-98-tahun-2025": { isi: rincian(556, { tautan: false }) },
      "/Download/5550/PP-555.pdf": { tipe: "application/pdf", isi: PDF },
    });
    const hasil = await jalankan({ batas: 10 });
    expect(hasil.ringkas).toMatchObject({ diproses: 2, diunggah: 1, gagal: 1 });
    expect(hasil.hasil.find((b) => b.uri.endsWith("/99"))).toMatchObject({ hasil: expect.stringContaining("diunggah"), ukuran: PDF.length });
    expect(hasil.hasil.find((b) => b.uri.endsWith("/98")).hasil).toContain("tautan PDF tak ditemukan");

    expect(await butuh()).toEqual(["/akn/id/act/pp/2025/98"]);
    const status = await (await fetch(`${BASE}/api/dokumen/status?uri=${encodeURIComponent("/akn/id/act/pp/2025/99")}`)).json();
    expect(status.ada_pdf).toBe(true);
  });

  it("mode kering mengunduh tetapi tidak mengunggah", async () => {
    await kirimManifest([dokumen(555, 99)]);
    await pasangBpk({
      "/Details/555/pp-no-99-tahun-2025": { isi: rincian(555) },
      "/Download/5550/PP-555.pdf": { tipe: "application/pdf", isi: PDF },
    });
    const hasil = await jalankan({ kering: true });
    expect(hasil.ringkas).toMatchObject({ diproses: 1, kering: 1, diunggah: 0 });
    expect(await butuh()).toEqual(["/akn/id/act/pp/2025/99"]); // masih menunggu
  });

  it("halaman tantangan Cloudflare dan berkas yang bukan PDF dikenali; sesudah lima kegagalan beruntun putaran berhenti", async () => {
    await kirimManifest([1, 2, 3, 4, 5, 6].map((n) => dokumen(600 + n, 10 + n)));
    const halaman = { "/Download/6010/PP-601.pdf": { tipe: "text/html", isi: "<html>Just a moment...</html>" } };
    halaman["/Details/601/pp-no-11-tahun-2025"] = { isi: rincian(601) }; // tautan ada, tetapi yang terunduh halaman tantangan
    for (const n of [2, 3, 4, 5, 6]) halaman[`/Details/60${n}/pp-no-${10 + n}-tahun-2025`] = { isi: rincian(600 + n, { tantangan: true }) };
    await pasangBpk(halaman);
    const hasil = await jalankan({ batas: 10 });
    expect(hasil.hasil).toHaveLength(5); // berhenti sesudah lima kegagalan beruntun
    expect(hasil.hasil[0].hasil).toContain("bukan PDF");
    expect(hasil.hasil[1].hasil).toContain("tantangan_cloudflare");
    expect(hasil.ringkas).toMatchObject({ gagal: 5, diunggah: 0 });
    expect((await butuh()).length).toBe(6); // tak ada yang terunggah
  });

  it("peraturan tanpa tautan BPK dilewati, bukan digagalkan", async () => {
    // Manifest tanpa detail_url dan bpk_id: baris tanpa alamat BPK.
    await kirimManifest([{ bpk_id: "", meta: { Judul: "Peraturan Pemerintah 5", "Bentuk Singkat": "PP", Nomor: "5", Tahun: "2025", Status: "Berlaku" } }]);
    await pasangBpk({});
    const hasil = await jalankan({});
    expect(hasil.hasil[0].hasil).toContain("lewati");
    expect(hasil.ringkas).toMatchObject({ dilewati: 1, gagal: 0 });
  });

  it("mode periksa mencetak tabel metadata dan tautan PDF halaman yang sedang dibuka", async () => {
    await pasangBpk({ "/Details/555/x": { isi: rincian(555) }, "/Download/5550/PP-555.pdf": { tipe: "application/pdf", isi: PDF } });
    await page.goto(`${BPK}/Details/555/x`);
    await page.addScriptTag({ content: "window.LEXA_PANEN_OTOMATIS = false;" });
    await page.addScriptTag({ content: SKRIP });
    const r = await page.evaluate(() => window.lexaPanenBpk({ periksa: true }));
    expect(r.meta).toEqual({ Judul: "Peraturan Pemerintah 555", "Bentuk Singkat": "PP", Status: "Berlaku" }); // titik dua di ujung label dibuang
    expect(r.tautanPdf).toEqual([{ url: `${BPK}/Download/5550/PP-555.pdf`, teks: "Unduh", skor: 3 }]);
    expect(r.tautanUnduh.map((t) => t.href)).toEqual(["/Download/5550/PP-555.pdf"]);
  });
});
