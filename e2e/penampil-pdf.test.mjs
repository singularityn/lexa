/**
 * Penampil PDF (tab "PDF" di halaman peraturan) di Chromium sungguhan, dengan PDF.js asli dari public/vendor/pdfjs dan PDF
 * contoh yang dibangkitkan tes (e2e/pdf-contoh.mjs) lalu diunggah lewat PUT /api/impor/pdf seperti hasil panen BPK.
 *
 * Yang diuji: halaman tergambar (bukan kanvas kosong), lapisan teks, navigasi dan zoom, "Lihat di PDF" pada pasal (halaman
 * dicari di teks PDF; penjelasan tidak menggeser), PDF hasil pindaian, PDF rusak, peraturan tanpa PDF, layar ponsel, dan
 * bersihnya konsol dari galat/pelanggaran CSP (strict: tanpa eval, tanpa WebAssembly, tanpa gaya sebaris).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mulaiPratinjau, pasangPengumpul, UU13, urlUU } from "./pembantu.mjs";
import { buatPdf } from "./pdf-contoh.mjs";

const PORT = 4797;
const BASE = `http://localhost:${PORT}`;
const TOKEN = "token-admin-uji";
const UU27 = "/akn/id/act/uu/2022/27";

let server;
let browser;
beforeAll(async () => {
  ({ server, browser } = await mulaiPratinjau(PORT));
});
afterAll(async () => {
  await browser?.close();
  server?.kill();
});

/** 12 halaman: Pasal 1 di halaman 1, Pasal 82 di 6, Pasal 156 di 9, dan penjelasan di 12 yang memakai ulang "Pasal 82". */
function naskah() {
  const halaman = Array.from({ length: 12 }, (_, i) => [`Halaman isi ${i + 1}`, "Teks pengisi."]);
  halaman[0] = ["UNDANG-UNDANG CONTOH", "", "Pasal 1", "Ketentuan umum."];
  halaman[5] = ["Pasal 82", "Pekerja perempuan berhak memperoleh istirahat."];
  halaman[8] = ["Pasal 156", "Dalam hal terjadi pemutusan hubungan kerja."];
  halaman[11] = ["PENJELASAN", "Pasal 82", "Cukup jelas."];
  return halaman;
}

async function unggah(uri, pdf) {
  const res = await fetch(`${BASE}/api/impor/pdf?uri=${encodeURIComponent(uri)}`, { method: "PUT", headers: { "x-admin-token": TOKEN }, body: pdf });
  expect(res.status, await res.clone().text()).toBe(200);
}

let ctx;
let page;
let masalah;

async function bukaKonteks(opsi = {}) {
  masalah = [];
  ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"], ...opsi });
  page = await ctx.newPage();
  pasangPengumpul(page, masalah);
}

beforeEach(async () => {
  const reset = await fetch(`${BASE}/__dev/reset`, { method: "POST" });
  expect(reset.status).toBe(204);
  await bukaKonteks();
});
afterEach(async () => {
  await ctx.close();
  expect(masalah, "galat konsol/jaringan").toEqual([]);
});

const tabPdf = (uri = UU13) => `${BASE}${urlUU(uri, "&tab=pdf")}`;
const masukanHalaman = () => page.locator(".pdf-hal-input");

/** Kanvas halaman `n` berisi sesuatu selain putih polos (halaman benar-benar digambar). */
async function kanvasTerisi(n) {
  const kanvas = page.locator(`.pdf-halaman[data-halaman="${n}"] canvas`);
  await kanvas.waitFor({ timeout: 20_000 });
  return page.waitForFunction((no) => {
    const c = document.querySelector(`.pdf-halaman[data-halaman="${no}"] canvas`);
    if (!c || !c.width) return false;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 200 && d[i + 3] > 0) return true;
    return false;
  }, n, { timeout: 20_000 });
}

describe("tab PDF", () => {
  it("menampilkan PDF yang diarsipkan: jumlah halaman, halaman pertama tergambar, dan teksnya bisa dipilih", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await page.goto(tabPdf(), { waitUntil: "networkidle" });
    await page.locator(".pdf-hal-total", { hasText: "/ 12" }).waitFor({ timeout: 20_000 });
    await kanvasTerisi(1);
    expect(await page.locator(".pdf-halaman").count()).toBe(12);
    // Lapisan teks PDF.js: teksnya ada di DOM (untuk memilih, menyalin, dan pembaca layar) walau tak terlihat.
    await page.locator('.pdf-halaman[data-halaman="1"] .textLayer span', { hasText: "UNDANG-UNDANG CONTOH" }).waitFor();
    expect(await masukanHalaman().inputValue()).toBe("1");
    expect(await page.locator('[role="tab"][aria-selected="true"]').textContent()).toBe("PDF");
    // Tak ada mode lain yang ikut terbuka, dan tautan "Buka" menunjuk ke PDF-nya.
    expect(await page.locator(".pdf-bilah a").getAttribute("href")).toBe(`/api/dokumen/pdf?uri=${encodeURIComponent(UU13)}`);
  });

  it("navigasi: ketik nomor halaman, tombol sebelum/berikut, dan halaman yang digulir menjadi halaman saat ini", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await page.goto(tabPdf(), { waitUntil: "networkidle" });
    await page.locator(".pdf-hal-total", { hasText: "/ 12" }).waitFor({ timeout: 20_000 });
    await masukanHalaman().fill("6");
    await masukanHalaman().press("Enter");
    await kanvasTerisi(6);
    expect(await masukanHalaman().inputValue()).toBe("6");
    // Halaman mendarat tepat di bawah bilah alat lengket (bukan tersembunyi di baliknya, bukan terlalu jauh di bawahnya).
    const { atas, batas } = await page.evaluate(() => ({
      atas: document.querySelector('.pdf-halaman[data-halaman="6"]').getBoundingClientRect().top,
      batas: document.querySelector(".pdf-bilah").getBoundingClientRect().bottom + 8,
    }));
    expect(Math.abs(atas - batas)).toBeLessThanOrEqual(2);

    await page.getByRole("button", { name: "Halaman berikutnya" }).click();
    expect(await masukanHalaman().inputValue()).toBe("7");
    await page.getByRole("button", { name: "Halaman sebelumnya" }).click();
    await page.getByRole("button", { name: "Halaman sebelumnya" }).click();
    expect(await masukanHalaman().inputValue()).toBe("5");

    // Di luar rentang dijepit; di halaman pertama tombol "sebelumnya" mati.
    await masukanHalaman().fill("99");
    await masukanHalaman().press("Enter");
    expect(await masukanHalaman().inputValue()).toBe("12");
    await masukanHalaman().fill("0");
    await masukanHalaman().press("Enter");
    expect(await masukanHalaman().inputValue()).toBe("1");
    expect(await page.getByRole("button", { name: "Halaman sebelumnya" }).isDisabled()).toBe(true);

    // Menggulir halaman ke bawah mengganti halaman saat ini.
    await page.evaluate(() => document.querySelector('.pdf-halaman[data-halaman="4"]').scrollIntoView({ block: "center" }));
    await page.waitForFunction(() => document.querySelector(".pdf-hal-input").value === "4", null, { timeout: 5000 });
  });

  it("zoom: perbesar melebarkan halaman, perkecil menyempitkannya, 'Pas lebar' mengembalikannya, dan tombol mati di batas", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await page.goto(tabPdf(), { waitUntil: "networkidle" });
    await kanvasTerisi(1);
    const lebar = () => page.locator('.pdf-halaman[data-halaman="1"]').evaluate((el) => el.getBoundingClientRect().width);
    const awal = await lebar();
    expect(awal).toBeGreaterThan(300);
    await page.getByRole("button", { name: "Perbesar" }).click();
    expect(await lebar()).toBeGreaterThan(awal * 1.2);
    expect(await page.locator(".pdf-zoom").textContent()).toBe("125%");
    await page.getByRole("button", { name: "Pas lebar" }).click();
    expect(await lebar()).toBeCloseTo(awal, 0);
    for (let i = 0; i < 8; i++) await page.getByRole("button", { name: "Perkecil" }).click({ force: true });
    expect(await page.getByRole("button", { name: "Perkecil" }).isDisabled()).toBe(true);
    expect(await page.locator(".pdf-zoom").textContent()).toBe("50%");
    // Setelah diperbesar lagi, halaman digambar ulang dengan tajam (kanvasnya lebih besar dari semula).
    await page.getByRole("button", { name: "Pas lebar" }).click();
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Perbesar" }).click();
    await page.waitForFunction(() => {
      const c = document.querySelector('.pdf-halaman[data-halaman="1"] canvas');
      return c && c.width >= document.querySelector('.pdf-halaman[data-halaman="1"]').getBoundingClientRect().width;
    }, null, { timeout: 15_000 });
  });

  it("halaman jauh dari layar tak digambar, yang dilewati dilepas: memori ponsel terjaga pada naskah panjang", async () => {
    const panjang = Array.from({ length: 60 }, (_, i) => [`Halaman isi ${i + 1}`, "Teks pengisi."]);
    await unggah(UU13, buatPdf(panjang));
    await page.goto(tabPdf(), { waitUntil: "networkidle" });
    await page.locator(".pdf-hal-total", { hasText: "/ 60" }).waitFor({ timeout: 20_000 });
    await kanvasTerisi(1);
    expect(await page.locator(".pdf-halaman canvas").count()).toBeLessThan(8);
    await masukanHalaman().fill("50");
    await masukanHalaman().press("Enter");
    await kanvasTerisi(50);
    await page.waitForFunction(() => !document.querySelector('.pdf-halaman[data-halaman="1"] canvas'), null, { timeout: 10_000 });
    expect(await page.locator(".pdf-halaman canvas").count()).toBeLessThan(8);
  });
});

describe("Lihat di PDF (pasal ke halaman)", () => {
  it("dari pasal di tab Isi: tab PDF terbuka tepat di halaman pasal itu, dicari di teks PDF", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await page.goto(`${BASE}${urlUU(UU13)}`, { waitUntil: "networkidle" });
    const pasal = page.locator("article.pasal", { hasText: "Pasal 156" });
    await pasal.hover();
    await pasal.locator("button.pasal-pdf").click();
    await page.locator('[role="tab"][aria-selected="true"]', { hasText: "PDF" }).waitFor();
    await page.waitForFunction(() => document.querySelector(".pdf-hal-input")?.value === "9", null, { timeout: 20_000 });
    await kanvasTerisi(9);
    await page.locator(".toast", { hasText: "Pasal 156 dimulai di halaman 9 PDF" }).waitFor();
  });

  it("penjelasan memakai ulang nomor pasal tetapi tak menggeser: Pasal 82 tetap di halaman 6, bukan 12", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await page.goto(`${BASE}${urlUU(UU13)}`, { waitUntil: "networkidle" });
    const pasal = page.locator("article.pasal", { hasText: "Pasal 82" }).first();
    await pasal.hover();
    await pasal.locator("button.pasal-pdf").click();
    await page.waitForFunction(() => document.querySelector(".pdf-hal-input")?.value === "6", null, { timeout: 20_000 });
    await page.locator(".toast", { hasText: "Pasal 82 dimulai di halaman 6 PDF" }).waitFor();
  });

  it("pasal yang tak ada di teks PDF: dikatakan terus terang, dan PDF tetap terbuka di halaman pertama", async () => {
    await unggah(UU13, buatPdf(naskah().map((h) => h.map((b) => b.replace("Pasal 156", "Ketentuan 156")))));
    await page.goto(`${BASE}${urlUU(UU13)}`, { waitUntil: "networkidle" });
    const pasal = page.locator("article.pasal", { hasText: "Pasal 156" });
    await pasal.hover();
    await pasal.locator("button.pasal-pdf").click();
    await page.locator(".toast", { hasText: "Pasal 156 tidak ditemukan di teks PDF" }).waitFor({ timeout: 20_000 });
    expect(await masukanHalaman().inputValue()).toBe("1");
  });

  it("PDF hasil pindaian (tanpa lapisan teks): halamannya tetap tergambar, pencarian pasal mengakui keterbatasannya", async () => {
    await unggah(UU13, buatPdf(naskah(), { tanpaTeks: true }));
    await page.goto(`${BASE}${urlUU(UU13)}`, { waitUntil: "networkidle" });
    const pasal = page.locator("article.pasal", { hasText: "Pasal 156" });
    await pasal.hover();
    await pasal.locator("button.pasal-pdf").click();
    await page.locator(".toast", { hasText: "hasil pindaian tanpa lapisan teks" }).waitFor({ timeout: 20_000 });
    await kanvasTerisi(1);
  });

  it("peraturan tanpa PDF: tombol 'Lihat di PDF' tak tampil, dan tab PDF menjelaskan serta menunjuk ke naskah resmi", async () => {
    await page.goto(`${BASE}${urlUU(UU27)}`, { waitUntil: "networkidle" });
    await page.locator("article.pasal").first().waitFor();
    expect(await page.locator("button.pasal-pdf:visible").count()).toBe(0);
    await page.getByRole("tab", { name: "PDF" }).click();
    await page.getByRole("heading", { name: "PDF belum diarsipkan di Lexa" }).waitFor();
    expect(await page.locator(".penampil-pdf").count()).toBe(0);
  });

  it("di layar sentuh: 'Lihat di PDF' ada di lembar aksi pasal", async () => {
    await ctx.close();
    await bukaKonteks({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await unggah(UU13, buatPdf(naskah()));
    await page.goto(`${BASE}${urlUU(UU13)}`, { waitUntil: "networkidle" });
    const pasal = page.locator("article.pasal", { hasText: "Pasal 156" });
    await pasal.locator(".pasal-lainnya").click();
    await page.getByRole("button", { name: /Lihat di PDF/ }).click();
    await page.waitForFunction(() => document.querySelector(".pdf-hal-input")?.value === "9", null, { timeout: 20_000 });
    await kanvasTerisi(9);
    // Ponsel: tak ada gulir ke samping pada halaman, dan bilah alat muat (bisa digulir sendiri bila perlu).
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

describe("layar sempit", () => {
  for (const lebar of [360, 390]) {
    it(`${lebar}px: bilah alat muat utuh (tak terpotong), halaman tak meluber, dan lompat ke halaman mendarat di bawah bilah`, async () => {
      await ctx.close();
      await bukaKonteks({ viewport: { width: lebar, height: 800 }, isMobile: true, hasTouch: true });
      await unggah(UU13, buatPdf(naskah()));
      await page.goto(tabPdf(), { waitUntil: "networkidle" });
      await page.locator(".pdf-hal-total", { hasText: "/ 12" }).waitFor({ timeout: 20_000 });
      const bilah = await page.locator(".pdf-bilah").evaluate((el) => ({ isi: el.scrollWidth, tampak: el.clientWidth }));
      expect(bilah.isi).toBeLessThanOrEqual(bilah.tampak + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // Semua kontrol penting terlihat di layar.
      for (const nama of ["Halaman sebelumnya", "Halaman berikutnya", "Perkecil", "Perbesar", "Pas lebar", "Buka PDF di tab baru"]) {
        const kotak = await page.getByRole(nama.startsWith("Buka") ? "link" : "button", { name: nama }).boundingBox();
        expect(kotak, nama).not.toBeNull();
        expect(kotak.x + kotak.width, nama).toBeLessThanOrEqual(lebar);
      }
      await masukanHalaman().fill("9");
      await masukanHalaman().press("Enter");
      await kanvasTerisi(9);
      const { atas, batasBilah } = await page.evaluate(() => ({
        atas: document.querySelector('.pdf-halaman[data-halaman="9"]').getBoundingClientRect().top,
        batasBilah: document.querySelector(".pdf-bilah").getBoundingClientRect().bottom + 8,
      }));
      expect(Math.abs(atas - batasBilah)).toBeLessThanOrEqual(2);
    });
  }
});

describe("galat dan keadaan khusus", () => {
  it("berkas yang bukan PDF sungguhan: pesan jelas dan tombol 'Coba lagi', bukan halaman kosong", async () => {
    await unggah(UU27, Buffer.from("%PDF-1.4\nini bukan PDF yang utuh\n"));
    await page.goto(tabPdf(UU27), { waitUntil: "networkidle" });
    await page.locator(".pdf-status-galat").waitFor({ timeout: 20_000 });
    expect(await page.locator(".pdf-status-galat").textContent()).toMatch(/rusak|tidak bisa dimuat/);
    expect(await page.getByRole("button", { name: "Coba lagi" }).count()).toBe(1);
    expect(await page.locator(".pdf-halaman").count()).toBe(0);
  });

  it("peraturan dengan PDF dan pasal: pindah tab dan kembali tak memuat ulang PDF (penampil dibuat sekali)", async () => {
    await unggah(UU13, buatPdf(naskah()));
    const permintaan = [];
    page.on("request", (r) => { if (r.url().includes("/api/dokumen/pdf")) permintaan.push(r.url()); });
    await page.goto(tabPdf(), { waitUntil: "networkidle" });
    await kanvasTerisi(1);
    const jumlah = permintaan.length;
    await page.getByRole("tab", { name: "Isi" }).click();
    await page.getByRole("tab", { name: "PDF" }).click();
    await kanvasTerisi(1);
    expect(permintaan.length).toBe(jumlah);
  });

  it("PDF.js tidak dimuat sebelum tab PDF atau 'Lihat di PDF' dipakai (2,3 MB tak boleh membebani pembaca biasa)", async () => {
    await unggah(UU13, buatPdf(naskah()));
    const berkas = [];
    page.on("request", (r) => { if (r.url().includes("/vendor/pdfjs/")) berkas.push(r.url()); });
    await page.goto(`${BASE}${urlUU(UU13)}`, { waitUntil: "networkidle" });
    await page.locator("article.pasal").first().waitFor();
    expect(berkas).toEqual([]);
    await page.getByRole("tab", { name: "PDF" }).click();
    await kanvasTerisi(1);
    expect(berkas.some((u) => u.endsWith("pdf.min.mjs"))).toBe(true);
    expect(berkas.some((u) => u.endsWith("pdf.worker.min.mjs"))).toBe(true);
  });

  it("pindah ke peraturan lain membuang penampil: tak ada kanvas atau permintaan PDF yang tertinggal", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await page.goto(tabPdf(), { waitUntil: "networkidle" });
    await kanvasTerisi(1);
    await page.goto(`${BASE}${urlUU(UU27)}`, { waitUntil: "networkidle" });
    expect(await page.locator(".penampil-pdf, .pdf-halaman").count()).toBe(0);
  });
});
