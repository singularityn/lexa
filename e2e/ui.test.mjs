/**
 * Tes ujung-ke-ujung antarmuka di Chromium sungguhan.
 *
 * Menjalankan pratinjau lokal (scripts/dev-node.ts: Worker asli + SQLite sungguhan,
 * AI/Vectorize/KV/R2/Queue tiruan) lalu mengendalikan peramban terhadapnya.
 *
 *   npm run e2e                       # butuh Chromium (npx playwright-core install chromium)
 *   CHROMIUM_PATH=/path/ke/chrome npm run e2e
 *
 * Tiap tes memakai konteks peramban baru; data server dikembalikan ke awal sebelum
 * setiap berkas tes dan setelah tes yang mengubahnya.
 */
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const PORT = 4789;
const BASE = `http://localhost:${PORT}`;
const UU13 = "/akn/id/act/uu/2003/13";
const urlUU = (uri, ekstra = "") => `/peraturan?uri=${encodeURIComponent(uri)}${ekstra}`;

let server;
let browser;

async function reset() {
  const res = await fetch(`${BASE}/__dev/reset`, { method: "POST" });
  if (res.status !== 204) throw new Error(`reset gagal: ${res.status}`);
}

beforeAll(async () => {
  execFileSync("npm", ["run", "build:dev", "--silent"], { stdio: "inherit" });
  server = spawn(process.execPath, [".dev/dev-node.mjs"], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((selesai, gagal) => {
    const batas = setTimeout(() => gagal(new Error("server pratinjau tidak siap dalam 60 detik")), 60_000);
    server.stdout.on("data", (d) => {
      if (String(d).includes("berjalan di")) {
        clearTimeout(batas);
        selesai();
      }
    });
    server.on("exit", (kode) => gagal(new Error(`server pratinjau berhenti (kode ${kode})`)));
  });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
});

afterAll(async () => {
  await browser?.close();
  server?.kill();
});

/** @type {import("playwright-core").BrowserContext} */
let ctx;
/** @type {import("playwright-core").Page} */
let page;
/** @type {string[]} */
let masalah;

beforeEach(async () => {
  masalah = [];
  ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  page = await ctx.newPage();
  page.on("console", (m) => {
    // Peramban mencatat setiap respons 4xx/5xx sebagai galat konsol; statusnya diperiksa di penangan "response".
    if (["error", "warning"].includes(m.type()) && !m.text().startsWith("Failed to load resource")) masalah.push(`[${m.type()}] ${m.text()}`);
  });
  page.on("pageerror", (e) => masalah.push(`[pageerror] ${e.message}`));
  page.on("requestfailed", (r) => {
    // Permintaan basi yang sengaja dibatalkan aplikasi (AbortController) bukan kegagalan.
    if (r.failure()?.errorText !== "net::ERR_ABORTED") masalah.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on("response", (r) => {
    // 404 pada detail dan 429/503 pada tanya sengaja terjadi di beberapa skenario; yang lain berarti ada yang rusak.
    if (r.status() >= 400 && !r.url().includes("/api/laws/detail") && !r.url().includes("/api/tanya")) masalah.push(`[http ${r.status()}] ${r.url()}`);
  });
});

afterEach(async () => {
  await ctx.close();
  // Setiap tes harus bersih dari galat konsol, pelanggaran CSP, dan permintaan gagal.
  expect(masalah, "galat konsol/jaringan").toEqual([]);
});

describe("halaman dasar", () => {
  const halaman = [
    ["/", "Temukan pasal yang Anda cari"],
    ["/cari?q=pesangon", "Hasil pencarian"],
    ["/telusuri", "Telusuri peraturan"],
    [urlUU(UU13), "Ketenagakerjaan"],
    ["/tanya", "Tanya Lexa"],
    ["/koleksi", "Koleksi"],
    ["/akun", "Akun"],
    ["/tentang", "Tentang Lexa"],
    ["/status", "Status data"],
    ["/halaman-yang-tidak-ada", "Halaman tidak ditemukan"],
  ];

  it.each(halaman)("%s memuat tanpa galat dan menampilkan judulnya", async (path, judul) => {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.locator("h1").first().waitFor({ state: "attached" });
    expect(await page.locator("h1, h2").allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining(judul)]));
  });

  it("memuat ulang langsung pada rute dalam (fallback SPA) dan judul dokumen mengikuti halaman", async () => {
    await page.goto(BASE + "/tentang", { waitUntil: "networkidle" });
    expect(await page.title()).toBe("Tentang Lexa · Lexa");
  });

  it("berkas statis yang tidak ada dijawab 404, bukan HTML SPA", async () => {
    const res = await fetch(`${BASE}/js/tidak-ada.js`);
    expect(res.status).toBe(404);
  });

  it("header keamanan dan CSP terpasang pada halaman statis", async () => {
    const res = await fetch(BASE + "/");
    expect(res.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("pencarian", () => {
  it("saran ketik -> pilih dengan papan ketik -> membuka peraturan tanpa memuat ulang halaman", async () => {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.evaluate(() => { window.__tanda = "spa"; });
    await page.fill("main input[type=search]", "ket");
    await page.waitForSelector(".saran:not(.sembunyi) li");
    expect(await page.locator(".saran li").allTextContents()).toEqual([expect.stringContaining("UU 13/2003 — Ketenagakerjaan")]);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/peraturan\?uri=/);
    await page.waitForSelector("h1.judul-peraturan");
    expect(await page.textContent("h1.judul-peraturan")).toBe("Ketenagakerjaan");
    expect(await page.evaluate(() => window.__tanda)).toBe("spa");
  });

  it("hasil memuat cuplikan bertanda, tautan ke pasal, dan menyimpan kueri di URL", async () => {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.fill("main input[type=search]", "pesangon");
    await page.press("main input[type=search]", "Enter");
    await page.waitForSelector(".daftar-hasil .hasil");
    expect(page.url()).toContain("/cari?q=pesangon");
    expect((await page.locator(".hasil-cuplikan mark").count())).toBeGreaterThan(0);
    const href = await page.locator(".hasil-judul a").first().getAttribute("href");
    expect(href).toMatch(/^\/peraturan\?uri=.*&q=pesangon#pasal-/);
  });

  it("sitasi 'UU 13/2003' menempatkan peraturannya di urutan pertama", async () => {
    await page.goto(BASE + "/cari?q=" + encodeURIComponent("UU 13/2003"), { waitUntil: "networkidle" });
    await page.waitForSelector(".daftar-hasil .hasil");
    expect(await page.locator(".hasil").first().locator(".hasil-sitasi").textContent()).toBe("UU 13/2003");
    expect(await page.locator(".hasil").first().locator(".sumber-chip").allTextContents()).toContain("Sitasi");
  });

  it("mengganti mode dan filter memperbarui URL dan hasil", async () => {
    await page.goto(BASE + "/cari?q=" + encodeURIComponent("cipta kerja") + "&mode=keyword", { waitUntil: "networkidle" });
    await page.waitForSelector(".daftar-hasil .hasil");
    const semua = await page.locator(".daftar-hasil .hasil").count();

    await page.check("input[name=status][value=dicabut]");
    await page.waitForFunction(() => location.search.includes("status=dicabut"));
    await page.waitForFunction((n) => document.querySelectorAll(".daftar-hasil .hasil").length < n, semua);
    const lencana = await page.locator(".daftar-hasil .hasil .lencana-status, .daftar-hasil .hasil .lencana-dicabut").count();
    expect(lencana).toBe(await page.locator(".daftar-hasil .hasil").count());

    await page.click("label:has-text('Makna')");
    await page.waitForFunction(() => location.search.includes("mode=semantic"));
    // Dimuat ulang dengan URL itu, keadaan yang sama pulih.
    await page.reload({ waitUntil: "networkidle" });
    expect(await page.isChecked("input[name=status][value=dicabut]")).toBe(true);
    expect(await page.isChecked("input[name=mode-cari][value=semantic]")).toBe(true);
  });

  it("kueri tanpa hasil memberi jalan keluar, bukan halaman kosong", async () => {
    await page.goto(BASE + "/cari?q=pesawat+antariksa&mode=keyword", { waitUntil: "networkidle" });
    await page.waitForSelector(".kosong");
    expect(await page.textContent(".kosong")).toContain("Tidak ada hasil");
    expect(await page.locator(".kosong a, .kosong button").count()).toBeGreaterThanOrEqual(2);
  });

  it("karakter berbahaya pada kueri ditampilkan sebagai teks, tidak dieksekusi", async () => {
    await page.goto(BASE + "/cari?q=" + encodeURIComponent("<img src=x onerror=window.__xss=1>"), { waitUntil: "networkidle" });
    await page.waitForSelector(".ringkas-hasil, .kosong");
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(await page.locator("main img").count()).toBe(0);
  });

  it("telusuri: filter jenis, urutan, dan tautan halaman bekerja", async () => {
    await page.goto(BASE + "/telusuri", { waitUntil: "networkidle" });
    await page.waitForSelector(".daftar-hasil .hasil");
    expect(await page.textContent(".ringkas-hasil")).toBe("11 peraturan");
    await page.check("input[name=jenis][value=PP]");
    await page.waitForFunction(() => document.querySelectorAll(".daftar-hasil .hasil").length === 1);
    expect(page.url()).toContain("jenis=PP");
    await page.uncheck("input[name=jenis][value=PP]");
    await page.selectOption("select[aria-label=Urutkan]", "tahun_asc");
    await page.waitForFunction(() => location.search.includes("urut=tahun_asc"));
    await page.waitForFunction(() => document.querySelectorAll(".daftar-hasil .hasil").length === 11);
    expect(await page.locator(".daftar-hasil .hasil-sitasi").first().textContent()).toBe("UU 1/1974");
  });
});

describe("halaman peraturan", () => {
  it("menampilkan metadata, pasal berayat, dan tanda 'dicabut' beserta peraturan penggantinya", async () => {
    await page.goto(BASE + urlUU("/akn/id/act/uu/2020/11"), { waitUntil: "networkidle" });
    await page.waitForSelector(".peringatan-dicabut");
    expect(await page.textContent(".peringatan-dicabut")).toContain("UU 6/2023");
    await page.click(".peringatan-dicabut a");
    await page.waitForURL(/uu%2F2023%2F6/);
    await page.waitForFunction(() => document.querySelector("h1.judul-peraturan")?.textContent?.startsWith("Penetapan"));
    expect(await page.locator(".peringatan").count()).toBe(0); // UU 6/2023 berlaku
  });

  it("tautan ke pasal menggulir dan menyorot ayat yang dituju", async () => {
    await page.goto(BASE + urlUU(UU13, "&q=pesangon#pasal-156-ayat-1"), { waitUntil: "networkidle" });
    await page.waitForSelector("#pasal-156-ayat-1");
    await page.waitForFunction(() => document.querySelector("#pasal-156-ayat-1")?.classList.contains("disorot") || document.querySelector("#pasal-156-ayat-1:target"));
    expect(await page.locator("#pasal-156-ayat-1 mark").count()).toBeGreaterThan(0);
    const dalamLayar = await page.evaluate(() => {
      const r = document.querySelector("#pasal-156-ayat-1").getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight;
    });
    expect(dalamLayar).toBe(true);
  });

  it("cari di dalam peraturan menyaring pasal dan menandai kata", async () => {
    await page.goto(BASE + urlUU(UU13), { waitUntil: "networkidle" });
    await page.waitForSelector(".pasal");
    const total = await page.locator(".pasal").count();
    await page.fill(".cari-dalam input", "melahirkan");
    await page.waitForFunction(() => document.querySelectorAll(".pasal:not(.tidak-cocok)").length === 1);
    expect(await page.locator(".pasal:not(.tidak-cocok) mark").count()).toBeGreaterThan(0);
    expect(await page.textContent(".cari-dalam [role=status]")).toContain("1 pasal");
    await page.fill(".cari-dalam input", "");
    await page.waitForFunction((n) => document.querySelectorAll(".pasal:not(.tidak-cocok)").length === n, total);
  });

  it("tab Relasi dan Naskah dapat dicapai dengan papan ketik dan tersimpan di URL", async () => {
    await page.goto(BASE + urlUU(UU13), { waitUntil: "networkidle" });
    await page.focus("#tab-isi");
    await page.keyboard.press("ArrowRight");
    await page.waitForSelector("#panel-relasi:not([hidden])");
    expect(page.url()).toContain("tab=relasi");
    await page.waitForSelector("svg.grafik");
    await page.keyboard.press("ArrowRight");
    await page.waitForSelector("#panel-naskah:not([hidden])");
    expect(await page.textContent("#panel-naskah")).toContain("Naskah resmi");
    await page.reload({ waitUntil: "networkidle" });
    expect(await page.getAttribute("#tab-naskah", "aria-selected")).toBe("true");
  });

  it("tab Naskah: PDF yang diarsipkan terbuka, teks hasil konversi dimuat dengan peringatan", async () => {
    await page.goto(BASE + urlUU(UU13, "&tab=naskah"), { waitUntil: "networkidle" });
    await page.waitForSelector("#panel-naskah a:has-text('Buka PDF')");
    const href = await page.getAttribute("#panel-naskah a:has-text('Buka PDF')", "href");
    const res = await fetch(BASE + href);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    await page.click("button:has-text('Lihat teks hasil konversi')");
    await page.waitForSelector("pre.teks-naskah");
    expect(await page.textContent("#panel-naskah")).toContain("hasil konversi otomatis");
  });

  it("peta relasi menggambar simpul dan sisi, dan klik simpul membuka peraturan itu", async () => {
    await page.goto(BASE + urlUU(UU13, "&tab=relasi"), { waitUntil: "networkidle" });
    await page.waitForSelector("svg.grafik .simpul");
    expect(await page.locator("svg.grafik .simpul.pusat").count()).toBe(1);
    expect(await page.locator("svg.grafik .simpul.luar").count()).toBe(1); // peraturan di luar indeks
    await page.locator("svg.grafik a").first().click();
    await page.waitForURL(/\/peraturan\?uri=/);
    expect(page.url()).not.toContain("uu%2F2003%2F13&");
  });

  it("dialog laporan: terkirim dan tercatat di server", async () => {
    await page.goto(BASE + urlUU(UU13), { waitUntil: "networkidle" });
    await page.waitForSelector(".pasal");
    await page.click(".aksi-bar button:has-text('Laporkan kesalahan')");
    await page.waitForSelector("dialog[open]");
    await page.selectOption("dialog select", "teks_salah");
    await page.fill("dialog textarea", "Pasal 82 ayat (1) salah ketik");
    await page.click("dialog button[type=submit]");
    await page.waitForFunction(() => !document.querySelector("dialog[open]"));
    expect(await page.locator(".toast").allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining("Terima kasih")]));
    const lapor = await (await fetch(`${BASE}/api/admin/laporan`, { headers: { "x-admin-token": "token-admin-uji" } })).json();
    expect(lapor.laporan[0]).toMatchObject({ frbr_uri: UU13, jenis: "teks_salah", keterangan: "Pasal 82 ayat (1) salah ketik" });
    await reset();
  });

  it("peraturan yang tidak ada di indeks: halaman penjelasan dengan jalan keluar", async () => {
    await page.goto(BASE + urlUU("/akn/id/act/uu/1999/99"), { waitUntil: "networkidle" });
    await page.waitForSelector(".kosong");
    expect(await page.textContent(".kosong")).toContain("belum ada di indeks Lexa");
    expect(await page.locator(".kosong a").count()).toBeGreaterThanOrEqual(2);
  });

  it("menyalin sitasi ke papan klip", async () => {
    await page.goto(BASE + urlUU(UU13), { waitUntil: "networkidle" });
    await page.waitForSelector(".pasal");
    await page.click("button:has-text('Salin sitasi')");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("UU 13/2003");
    await page.hover("#pasal-82");
    await page.click("#pasal-82 button[aria-label='Salin sitasi Pasal 82']");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("UU 13/2003 Pasal 82");
  });
});

describe("koleksi dan akun", () => {
  it("tamu: simpan -> badge header -> catatan bertahan setelah muat ulang -> lepas", async () => {
    await page.goto(BASE + urlUU(UU13), { waitUntil: "networkidle" });
    await page.click(".aksi-bar button:has-text('Simpan')");
    await page.waitForSelector(".toast");
    expect(await page.textContent(".lencana-jumlah")).toBe("1");
    expect(await page.getAttribute(".aksi-bar button[aria-pressed]", "aria-pressed")).toBe("true");

    await page.click("a[data-nav='/koleksi']");
    await page.waitForSelector(".entri-koleksi textarea");
    await page.fill(".entri-koleksi textarea", "Catatan uji");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("lexa:koleksi:v1"))[0].catatan === "Catatan uji");
    await page.reload({ waitUntil: "networkidle" });
    expect(await page.inputValue(".entri-koleksi textarea")).toBe("Catatan uji");

    await page.click(".entri-koleksi button:has-text('Lepas')");
    await page.waitForSelector(".kosong");
    expect(await page.textContent(".kosong")).toContain("Koleksi masih kosong");
  });

  it("masuk: koleksi tamu digabung ke akun, tersimpan di server, dan hilang dari perangkat", async () => {
    await reset();
    // Tamu menyimpan dua peraturan.
    await page.goto(BASE + urlUU(UU13), { waitUntil: "networkidle" });
    await page.click(".aksi-bar button:has-text('Simpan')");
    await page.goto(BASE + urlUU("/akn/id/act/uu/2022/27"), { waitUntil: "networkidle" });
    await page.click(".aksi-bar button:has-text('Simpan')");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("lexa:koleksi:v1")).length === 2);

    // Masuk (pratinjau mengganti Google dengan pengguna uji).
    await page.goto(BASE + "/akun", { waitUntil: "networkidle" });
    await page.click("a:has-text('Masuk dengan Google')");
    await page.waitForURL(/\/koleksi/);
    await page.waitForSelector(".entri-koleksi");
    expect(await page.locator(".entri-koleksi").count()).toBe(2);
    expect(await page.locator(".toast").allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining("2 peraturan dari perangkat ini digabung")]));
    expect(await page.evaluate(() => localStorage.getItem("lexa:koleksi:v1"))).toBeNull();

    // Catatan disimpan di server, bukan di perangkat.
    await page.fill(".entri-koleksi >> nth=0 >> textarea", "catatan akun");
    await page.waitForTimeout(1100);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".entri-koleksi");
    expect(await page.locator(".entri-koleksi textarea").evaluateAll((t) => t.map((x) => x.value))).toContain("catatan akun");

    // Halaman akun: profil dan ubah nama.
    await page.goto(BASE + "/akun", { waitUntil: "networkidle" });
    expect(await page.textContent(".profil-kepala")).toContain("penguji@lexa.test");
    await page.fill("#akun-nama", "Nama Baru Uji");
    await page.click("button:has-text('Simpan perubahan')");
    await page.waitForFunction(() => document.querySelector(".profil-kepala")?.textContent?.includes("Nama Baru Uji"));

    // Keluar: koleksi akun tidak lagi terlihat di perangkat ini.
    await page.click("button:has-text('Keluar')");
    await page.waitForURL(BASE + "/");
    await page.goto(BASE + "/koleksi", { waitUntil: "networkidle" });
    await page.waitForSelector(".kosong");
    expect(await page.textContent("a[data-nav='/akun']")).toContain("Masuk");
    await reset();
  });
});

describe("Tanya Lexa", () => {
  it("mengirim pertanyaan dan menampilkan jawaban dengan dasar hukum yang bisa dibuka", async () => {
    await reset();
    await page.goto(BASE + "/tanya", { waitUntil: "networkidle" });
    await page.click("button.chip:has-text('cuti melahirkan')");
    await page.press("#pertanyaan", "Enter");
    await page.waitForSelector(".gelembung.asisten .dasar-hukum");
    expect(await page.textContent(".gelembung.pengguna")).toContain("cuti melahirkan");
    const tautan = await page.locator(".dasar-hukum a").first().getAttribute("href");
    expect(tautan).toMatch(/^\/peraturan\?uri=.*#pasal-/);
    expect(await page.locator("#contoh-tanya.sembunyi").count()).toBe(1);
    await page.click("button:has-text('Percakapan baru')");
    expect(await page.locator(".gelembung").count()).toBe(0);
  });

  it("pertanyaan kosong tidak dikirim; penghitung karakter bekerja", async () => {
    await page.goto(BASE + "/tanya", { waitUntil: "networkidle" });
    await page.press("#pertanyaan", "Enter");
    expect(await page.locator(".gelembung").count()).toBe(0);
    await page.fill("#pertanyaan", "abc");
    expect(await page.textContent(".penghitung")).toBe("3/500");
  });

  it("kena batas laju: pesan ramah tanpa memutus halaman", async () => {
    await reset();
    await page.goto(BASE + "/tanya", { waitUntil: "networkidle" });
    // Habiskan jatah 20 pertanyaan dari alamat yang sama lewat API.
    for (let i = 0; i < 20; i++) {
      await page.request.post(`${BASE}/api/tanya`, { data: { pertanyaan: "pesangon pekerja" } });
    }
    await page.fill("#pertanyaan", "pesangon pekerja");
    await page.press("#pertanyaan", "Enter");
    await page.waitForSelector(".gelembung.asisten.galat-jawaban");
    expect(await page.textContent(".gelembung.galat-jawaban")).toContain("Terlalu banyak pertanyaan");
    await reset();
  });
});

describe("tampilan dan aksesibilitas", () => {
  it("tema gelap dapat dipilih dan bertahan setelah muat ulang", async () => {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.click("button[aria-label*='tema gelap']");
    expect(await page.evaluate(() => document.documentElement.dataset.tema)).toBe("gelap");
    await page.reload({ waitUntil: "networkidle" });
    expect(await page.evaluate(() => document.documentElement.dataset.tema)).toBe("gelap");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(17, 20, 27)");
  });

  it("pintasan '/' memfokuskan kotak cari; tautan 'Lewati ke konten' ada", async () => {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.keyboard.press("/");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("type"))).toBe("search");
    expect(await page.locator("a.lewati[href='#konten']").count()).toBe(1);
  });

  it("setelah berpindah halaman, fokus berpindah ke konten dan judul halaman diumumkan", async () => {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.click("a[data-nav='/tentang']");
    await page.waitForSelector("article.prosa");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("konten");
    expect(await page.textContent("[aria-live=polite].sr-only")).toBe("Tentang Lexa");
  });

  it("tampilan ponsel: tanpa gulir horizontal di semua halaman utama, menu dapat dibuka", async () => {
    const hp = await browser.newContext({ viewport: { width: 375, height: 800 } });
    const p = await hp.newPage();
    const galat = [];
    p.on("console", (m) => m.type() === "error" && galat.push(m.text()));
    for (const path of ["/", "/cari?q=pesangon", "/telusuri", urlUU(UU13), urlUU(UU13, "&tab=relasi"), "/tanya", "/koleksi", "/tentang", "/status"]) {
      await p.goto(BASE + path, { waitUntil: "networkidle" });
      expect(await p.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(375);
    }
    await p.click(".tombol-menu");
    expect(await p.locator(".nav.terbuka").count()).toBe(1);
    expect(galat).toEqual([]);
    await hp.close();
  });

  describe("axe-core: tidak ada pelanggaran serius/kritis", () => {
    const halaman = [
      ["beranda", "/"],
      ["hasil pencarian", "/cari?q=pesangon"],
      ["telusuri", "/telusuri"],
      ["peraturan", urlUU(UU13)],
      ["peraturan (relasi)", urlUU(UU13, "&tab=relasi")],
      ["tanya", "/tanya"],
      ["koleksi", "/koleksi"],
      ["akun", "/akun"],
      ["tentang", "/tentang"],
      ["status", "/status"],
    ];
    const axePath = require.resolve("axe-core/axe.min.js");

    for (const tema of ["terang", "gelap"]) {
      it.each(halaman)(`%s (tema ${tema})`, async (_nama, path) => {
        // bypassCSP hanya agar axe bisa disuntikkan; aplikasinya sendiri diuji dengan CSP aktif di tes lain.
        const konteks = await browser.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true, colorScheme: tema === "gelap" ? "dark" : "light" });
        const p = await konteks.newPage();
        await p.goto(BASE + path, { waitUntil: "networkidle" });
        await p.waitForTimeout(300);
        await p.addScriptTag({ path: axePath });
        const hasil = await p.evaluate(async () => {
          // eslint-disable-next-line no-undef
          const r = await axe.run(document, { resultTypes: ["violations"], rules: { "color-contrast": { enabled: true } } });
          return r.violations
            .filter((v) => v.impact === "serious" || v.impact === "critical")
            .map((v) => ({ id: v.id, impact: v.impact, bantuan: v.help, simpul: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
        });
        await konteks.close();
        expect(hasil).toEqual([]);
      });
    }
  });
});
