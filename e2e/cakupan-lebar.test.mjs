/**
 * Cakupan dilebarkan lewat variabel CAKUPAN_JENIS (di produksi: vars di wrangler.jsonc): jenis tambahan
 * muncul kembali di seluruh antarmuka, termasuk label khusus yang dijaga untuk jenis itu (POJK bernomor slug).
 * Cakupan bawaan diuji di e2e/ui.test.mjs. Server pratinjau terpisah dengan data contoh yang sama, termasuk
 * satu Perpres contoh yang di cakupan bawaan tersembunyi.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mulaiPratinjau, pasangPengumpul, urlUU } from "./pembantu.mjs";

const PORT = 4795;
const BASE = `http://localhost:${PORT}`;

let server;
let browser;
let ctx;
let page;
let masalah;

beforeAll(async () => {
  ({ server, browser } = await mulaiPratinjau(PORT, { CAKUPAN_JENIS: "UU,PERPPU,PP,PERPRES,POJK" }));
});
afterAll(async () => {
  await browser?.close();
  server?.kill();
});
beforeEach(async () => {
  masalah = [];
  ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  page = await ctx.newPage();
  pasangPengumpul(page, masalah);
});
afterEach(async () => {
  await ctx.close();
  expect(masalah, "galat konsol/jaringan").toEqual([]);
});

async function reset() {
  const res = await fetch(`${BASE}/__dev/reset`, { method: "POST" });
  if (res.status !== 204) throw new Error(`reset gagal: ${res.status}`);
}

describe("cakupan dilebarkan", () => {
  it("peraturan yang disembunyikan di cakupan bawaan tampil: telusur, facet, detail, dan pernyataan cakupan", async () => {
    await page.goto(BASE + "/telusuri", { waitUntil: "networkidle" });
    await page.waitForSelector(".daftar-hasil .hasil");
    expect(await page.textContent(".ringkas-hasil")).toBe("11 peraturan");
    expect(await page.locator(".daftar-hasil").textContent()).toContain("Pengadaan Barang/Jasa Pemerintah");
    expect(await page.locator("input[name=jenis]").evaluateAll((els) => els.map((e) => e.value).sort())).toEqual(["PERPRES", "PP", "UU"]);
    expect(await page.textContent("main")).toContain("Cakupan saat ini: UU, PERPPU, PP, PERPRES, dan POJK.");

    await page.goto(BASE + urlUU("/akn/id/act/perpres/2018/16"), { waitUntil: "networkidle" });
    await page.waitForSelector("main h1");
    expect(await page.textContent("main h1")).toContain("Pengadaan Barang/Jasa Pemerintah");
  });

  it("POJK lama (nomor slug) tampil dengan penomoran resmi dan ditemukan lewat penomoran itu", async () => {
    await reset();
    const pojk = (bpk_id, sektor) => ({
      bpk_id,
      meta: { Judul: `Peraturan OJK Nomor 48/POJK.${sektor}/2016 tentang Tata Cara Contoh`, "Bentuk Singkat": "POJK", Nomor: `48-pojk-${sektor}-2016`, Tahun: "2016", Status: "Berlaku" },
      relasi: [],
    });
    const res = await fetch(`${BASE}/api/impor/manifest`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": "token-admin-uji" },
      body: JSON.stringify({ versi: 1, dokumen: [pojk("9601", "03"), pojk("9602", "04")] }),
    });
    expect(res.status).toBe(200);

    // Penomoran resmi menemukan tepat satu sektor, dengan label resmi (bukan "48-pojk-04-2016/2016").
    await page.goto(BASE + "/cari?q=" + encodeURIComponent("POJK 48/POJK.04/2016") + "&mode=keyword", { waitUntil: "networkidle" });
    await page.waitForSelector(".daftar-hasil .hasil");
    const pertama = page.locator(".hasil").first();
    expect(await pertama.locator(".hasil-sitasi").textContent()).toBe("POJK 48/POJK.04/2016");
    expect(await pertama.locator(".sumber-chip").allTextContents()).toContain("Sitasi");
    expect(await page.locator(".hasil .sumber-chip", { hasText: "Sitasi" }).count()).toBe(1);

    // Tanpa sektor: kedua POJK bernomor 48 tahun 2016 ditemukan sebagai sitasi.
    await page.goto(BASE + "/cari?q=" + encodeURIComponent("Peraturan OJK Nomor 48 Tahun 2016") + "&mode=keyword", { waitUntil: "networkidle" });
    await page.waitForSelector(".daftar-hasil .hasil");
    const label = await page.locator(".hasil", { has: page.locator(".sumber-chip", { hasText: "Sitasi" }) }).locator(".hasil-sitasi").allTextContents();
    expect(label.sort()).toEqual(["POJK 48/POJK.03/2016", "POJK 48/POJK.04/2016"]);

    // Halaman detail memakai label yang sama pada tombol salin sitasi dan judul halaman.
    await page.goto(BASE + urlUU("/akn/id/act/pojk/2016/48-pojk-04-2016"), { waitUntil: "networkidle" });
    await page.waitForSelector("main h1");
    expect(await page.textContent("main")).toContain("POJK 48/POJK.04/2016");
    expect(await page.textContent("main")).not.toContain("48-pojk-04-2016");
    await reset();
  });
});
