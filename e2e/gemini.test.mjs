/**
 * Skrip panen BPK, opsi Gemini (geminiCek, geminiUji, gemini), dijalankan di Chromium terhadap Lexa sungguhan (pratinjau
 * lokal) dengan Gemini palsu (scripts/dev-node.ts: permintaan ke gemini.pratinjau.test dijawab di proses itu, tanpa
 * jaringan), serta catatan "dibaca AI" di halaman peraturan. Antrean pratinjau tidak berjalan sendiri: tes mengerjakannya lewat
 * POST /__dev/antrean, seperti konsumer Cloudflare Queues di produksi.
 */
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mulaiPratinjau, pasangPengumpul, UU13, urlUU } from "./pembantu.mjs";

const PORT = 4798;
const BASE = `http://localhost:${PORT}`;
const LEXA = "https://lexa.test";
const BPK = "https://peraturan.bpk.go.id";
const TOKEN = "token-admin-uji";
const SKRIP = readFileSync("scripts/bpk-console-harvest.js", "utf8");
const adm = { "x-admin-token": TOKEN, "content-type": "application/json" };
const PDF = "%PDF-1.4\n<< /Type /Page >>\n%%EOF\n";
const PP = "/akn/id/act/pp/2025/77";

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

beforeEach(async () => {
  expect((await fetch(`${BASE}/__dev/reset`, { method: "POST" })).status).toBe(204);
  ctx = await browser.newContext();
  page = await ctx.newPage();
  // Lexa dijangkau lewat alamat palsu yang diteruskan ke pratinjau; BPK tak disentuh opsi Gemini, jadi halamannya kosong.
  await page.route(`${LEXA}/**`, async (route) => {
    const res = await route.fetch({ url: route.request().url().replace(LEXA, BASE) });
    await route.fulfill({ response: res });
  });
  await page.route(`${BPK}/**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>BPK palsu</body></html>" }));
  await page.goto(`${BPK}/`);
  await page.addScriptTag({ content: "window.LEXA_PANEN_OTOMATIS = false;" });
  await page.addScriptTag({ content: SKRIP });
});
afterEach(async () => {
  await ctx.close();
});

/** Opsi bawaan uji: tanpa kotak status, jeda pemeriksaan singkat. */
const jalankan = (opsi) => page.evaluate((o) => window.lexaPanenBpk(o), { lexa: LEXA, token: TOKEN, papan: false, _jedaGemini: 20, ...opsi });
const galatDari = (opsi) => page.evaluate((o) => window.lexaPanenBpk(o).then(() => null, (e) => e.message), { lexa: LEXA, token: TOKEN, papan: false, ...opsi });
const modeGemini = (mode) => fetch(`${BASE}/__dev/gemini?mode=${mode}`, { method: "POST" });
const kerjakanAntrean = () => fetch(`${BASE}/__dev/antrean`, { method: "POST" }).then((r) => r.json());
const detail = async (uri) => (await fetch(`${BASE}/api/laws/detail?uri=${encodeURIComponent(uri)}`)).json();
const ringkasanGemini = async () => (await (await fetch(`${BASE}/api/impor/ringkasan`, { headers: adm })).json()).gemini;

/** Jalankan `janji` sambil mengerjakan antrean pratinjau terus-menerus, lalu sekali lagi sesudahnya. */
async function denganAntrean(janji) {
  let selesai = false;
  const kuras = (async () => {
    while (!selesai) {
      await kerjakanAntrean();
      await new Promise((ok) => setTimeout(ok, 40));
    }
  })();
  try {
    return await janji;
  } finally {
    selesai = true;
    await kuras;
  }
}

/** Peraturan yang PDF-nya sudah diunggah tetapi konversi bawaan tak menghasilkan teks (Workers AI palsu mengembalikan kosong). */
async function peraturanTanpaTeks() {
  const manifest = await fetch(`${BASE}/api/impor/manifest`, {
    method: "POST",
    headers: adm,
    body: JSON.stringify({
      versi: 1,
      dokumen: [{ bpk_id: "7700", detail_url: `${BPK}/Details/7700/pp-no-77-tahun-2025`, meta: { Judul: "Peraturan Pemerintah Nomor 77 Tahun 2025 tentang Pindaian", "Bentuk Singkat": "PP", Nomor: "77", Tahun: "2025", Status: "Berlaku" } }],
    }),
  });
  expect(manifest.status).toBe(200);
  const unggah = await fetch(`${BASE}/api/impor/pdf?uri=${encodeURIComponent(PP)}`, { method: "PUT", headers: { "x-admin-token": TOKEN, "content-type": "application/pdf" }, body: PDF });
  expect(unggah.status).toBe(200);
  await kerjakanAntrean();
  const status = await (await fetch(`${BASE}/api/dokumen/status?uri=${encodeURIComponent(PP)}`)).json();
  expect(status.ada_pdf).toBe(true);
}

describe("skrip panen BPK: geminiCek", () => {
  it("mencetak model, versi model, anggaran hari ini, dan pengaturan yang berlaku (termasuk batas halaman); tak menyentuh BPK", async () => {
    const konsol = [];
    page.on("console", (m) => konsol.push(m.text()));
    const hasil = await jalankan({ geminiCek: true });
    expect(hasil.geminiCek).toMatchObject({
      tersedia: true, model: "gemini-pratinjau", versi_model: "gemini-pratinjau-001", alamat: "gemini.pratinjau.test", balasan: "siap",
      anggaran: { terpakai: 12, batas: 5_000_000 }, berpikir: null, halaman_per_panggilan: 4, paralel: 3, halaman_maks: 120,
    });
    // Di awal setiap jalan skrip mencetak keadaan Gemini di Lexa: terpasang, otomatis menyala atau tidak, dan berapa PDF yang belum dibaca.
    expect(konsol.find((t) => t.includes("] Gemini: "))).toMatch(
      /Gemini: terpasang \(gemini-pratinjau\); membaca otomatis: mati; PDF belum dibaca Gemini: \d+ \(\d+ bermasalah\); anggaran token hari ini 0 dari 5\.000\.000\./,
    );
    const baris = konsol.find((t) => t.includes("Gemini siap"));
    expect(baris).toContain("model gemini-pratinjau (versi gemini-pratinjau-001)");
    expect(baris).toContain("anggaran token hari ini 12 dari 5.000.000");
    expect(baris).toContain("pengaturan: berpikir bawaan model, 4 halaman per panggilan, 3 paralel, PDF lebih dari 120 halaman ditolak");
    expect(baris).not.toMatch(/undefined|null|NaN/); // pratinjau lokal tanpa pusat data: bagian lokasi dilewati, bukan dicetak kosong
    expect(hasil.geminiCek.lokasi_worker).toEqual({ colo: null, placement: null });
    expect((await ringkasanGemini()).anggaran.terpakai).toBe(12);
  });

  it("kunci ditolak: galat yang menyebut penyebabnya, bukan diam", async () => {
    await modeGemini("kunci");
    const galat = await galatDari({ geminiCek: true });
    expect(galat).toContain("Lexa 502");
    expect(galat).toContain("Gemini menolak kunci");
  });

  it("kuota habis: galat yang menyebutnya", async () => {
    await modeGemini("kuota");
    expect(await galatDari({ geminiCek: true })).toContain("Kuota atau laju Gemini habis");
  });

  it("token admin salah: berhenti sejak awal (401)", async () => {
    const galat = await page.evaluate((o) => window.lexaPanenBpk(o).then(() => null, (e) => e.message), { lexa: LEXA, token: "salah", geminiCek: true, papan: false });
    expect(galat).toContain("401");
  });
});

describe("skrip panen BPK: geminiUji (percobaan kering)", () => {
  it("melaporkan keputusan, pasal, dan token untuk tiap peraturan tanpa menyimpan pasal; yang tak dikenal dilaporkan dan tak menghentikan", async () => {
    const sebelum = await detail(UU13);
    const hasil = await jalankan({ geminiUji: [UU13, "/akn/id/act/pp/2025/9999"] });
    expect(hasil.geminiUji).toHaveLength(2);
    expect(hasil.geminiUji[0]).toMatchObject({
      uri: UU13, model: "gemini-pratinjau-001", halaman: 1, halaman_pdf: 1, putaran: 1, masalah: [],
      token: { masuk: 2400, keluar: 310, total: 2710 },
      hasil: { nomor_pasal_berbeda: 3, vonis: "bersih" },
      // UU 13/2003 contoh punya lima nomor pasal (1, 77, 79, 82, 156); bacaan palsu hanya tiga (1, 2, 3). Nomor tersimpan dibandingkan
      // menurut himpunan dengan pencilan dibuang (156 tak punya tetangga): 77, 79, dan 82 hilang dari bacaan baru, jadi dipertahankan.
      tersimpan: { nomor_pasal_berbeda: 5, vonis: "bersih" },
      hilang_dari_tersimpan: { hilang: 3, dasar: 4 },
      keputusan: { hasil: "dipertahankan", alasan: "dipertahankan: 3 dari 4 nomor pasal tersimpan tidak ada pada hasil Gemini" },
      arsip: "teks-ai/akn/id/act/uu/2003/13.md",
    });
    expect(hasil.geminiUji[1]).toEqual({ uri: "/akn/id/act/pp/2025/9999", galat: expect.stringContaining("Lexa 404") });

    // Tak ada yang tersimpan: pasal sama, tanpa catatan bacaan AI.
    const sesudah = await detail(UU13);
    expect(sesudah.articles).toEqual(sebelum.articles);
    expect(sesudah.pembaca_ai).toBeNull();
    expect((await ringkasanGemini()).pembacaan).toEqual({ uji: 1 });
  });
});

describe("skrip panen BPK: gemini (membaca sungguhan)", () => {
  it("mengantrekan peraturan tanpa teks, menunggu antrean menyelesaikannya, lalu berhenti bila tak ada lagi", async () => {
    await peraturanTanpaTeks();
    const hasil = await denganAntrean(jalankan({ gemini: true, batas: 3 }));
    expect(hasil.gemini).toEqual({ diantrekan: 1, selesai: 1, belumDicoba: 1, berhentiKarena: "tidak ada lagi yang diantrekan" });

    const d = await detail(PP);
    expect(d.articles.map((a) => [a.nomor_pasal, a.ayat])).toEqual([["1", null], ["2", "1"], ["2", "2"], ["3", null]]);
    expect(d.articles[0].isi).toContain("pindaian adalah dokumen");
    expect(d.pembaca_ai).toEqual({ model: "gemini-pratinjau-001" });
    expect((await ringkasanGemini()).pembacaan).toEqual({ dipakai: 1 });
  });

  it("antrean yang tak berjalan: berhenti dengan penjelasan, bukan menunggu selamanya; yang diantrekan tetap menunggu", async () => {
    await peraturanTanpaTeks();
    const hasil = await jalankan({ gemini: true, batas: 3, _maksTungguGemini: 150 });
    expect(hasil.gemini).toMatchObject({ diantrekan: 1, selesai: 0, berhentiKarena: expect.stringContaining("belum selesai dibaca") });
    expect((await detail(PP)).articles).toEqual([]);
    // Dikerjakan belakangan, hasilnya tetap sah.
    await kerjakanAntrean();
    expect((await detail(PP)).articles).toHaveLength(4);
  });

  it("kunci ditolak di tengah jalan: berhenti sebelum mengantrekan apa pun (geminiCek dijalankan lebih dulu)", async () => {
    await peraturanTanpaTeks();
    await modeGemini("kunci");
    const galat = await galatDari({ gemini: true });
    expect(galat).toContain("Gemini menolak kunci");
    expect((await detail(PP)).articles).toEqual([]);
    expect(await kerjakanAntrean()).toMatchObject({ pesan: 0 });
  });

  it("tak ada peraturan yang layak: selesai tanpa mengantrekan apa pun", async () => {
    const hasil = await jalankan({ gemini: true });
    expect(hasil.gemini).toMatchObject({ diantrekan: 0, selesai: 0, berhentiKarena: "tidak ada lagi yang diantrekan" });
  });
});

describe("catatan 'dibaca AI' di halaman peraturan", () => {
  it("muncul hanya pada peraturan yang pasalnya dibaca Gemini, dan menunjuk PDF asli", async () => {
    await peraturanTanpaTeks();
    await denganAntrean(jalankan({ gemini: true, batas: 3 }));

    const p = await ctx.newPage();
    const masalah = [];
    pasangPengumpul(p, masalah);
    await p.goto(BASE + urlUU(PP), { waitUntil: "networkidle" });
    await p.waitForSelector(".pasal");
    const catatan = p.locator(".peringatan-info", { hasText: "Teks dibaca otomatis dari PDF dengan AI" });
    await catatan.waitFor();
    expect(await catatan.innerText()).toContain("Teks dibaca otomatis dari PDF dengan AI");
    expect(await catatan.innerText()).toContain("gemini-pratinjau-001");
    expect(await catatan.innerText()).toContain("Bandingkan dengan PDF asli");

    await p.goto(BASE + urlUU(UU13), { waitUntil: "networkidle" });
    await p.waitForSelector(".pasal");
    expect(await p.getByText("Teks dibaca otomatis dari PDF dengan AI").count()).toBe(0);
    expect(masalah).toEqual([]);
  });
});
