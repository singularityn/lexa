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
import { createRequire } from "node:module";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mulaiPratinjau, pasangPengumpul, UU13, urlUU } from "./pembantu.mjs";

const require = createRequire(import.meta.url);
const PORT = 4789;
const BASE = `http://localhost:${PORT}`;

let server;
let browser;

async function reset() {
  const res = await fetch(`${BASE}/__dev/reset`, { method: "POST" });
  if (res.status !== 204) throw new Error(`reset gagal: ${res.status}`);
}

beforeAll(async () => {
  ({ server, browser } = await mulaiPratinjau(PORT));
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
  // Service worker diblokir di sini supaya tes lain deterministik (route(), data yang di-reset, dst.);
  // perilakunya diuji khusus di e2e/pwa.test.mjs.
  ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  page = await ctx.newPage();
  pasangPengumpul(page, masalah);
});

afterEach(async () => {
  await ctx.close();
  // Setiap tes harus bersih dari galat konsol, pelanggaran CSP, dan permintaan gagal.
  expect(masalah, "galat konsol/jaringan").toEqual([]);
});

describe("halaman dasar", () => {
  const halaman = [
    ["/", "Cari peraturan Indonesia"],
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

  it("jalur yang tidak cocok dengan aset menyajikan cangkang SPA (200), kecuali /api yang dijawab 404 JSON", async () => {
    // Sama dengan Cloudflare saat run_worker_first berupa daftar rute: tidak ada pembedaan
    // navigasi vs subresource, jadi berkas yang salah ketik pun dijawab index.html.
    const asing = await fetch(`${BASE}/js/tidak-ada.js`);
    expect(asing.status).toBe(200);
    expect(asing.headers.get("content-type")).toContain("text/html");
    const api = await fetch(`${BASE}/api/tidak-ada`);
    expect(api.status).toBe(404);
    expect(api.headers.get("content-type")).toContain("application/json");
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

  it("peraturan yang judulnya memuat kata kunci dikelompokkan di atas pasal, dengan judul kelompok yang jelas", async () => {
    await page.goto(BASE + "/cari?q=" + encodeURIComponent("perkawinan"), { waitUntil: "networkidle" });
    await page.waitForSelector(".daftar-hasil .hasil");
    const kelompok = page.locator(".kelompok-hasil h2");
    expect(await kelompok.allTextContents()).toEqual(["Peraturan yang judulnya memuat “perkawinan”", "Pasal dan hasil lainnya"]);
    expect(await page.locator(".kelompok-hasil .kelompok-jumlah").allTextContents()).toEqual(["2"]);
    // Urutan di DOM: judul kelompok pertama, dua peraturan (UU 1/1974 yang pokoknya persis di depan perubahannya), lalu judul kedua.
    const urutan = await page.locator(".daftar-hasil > li").evaluateAll((li) =>
      li.map((x) => (x.classList.contains("kelompok-hasil") ? "#" : x.querySelector(".hasil-pasal") ? "pasal" : "peraturan")),
    );
    expect(urutan.slice(0, 4)).toEqual(["#", "peraturan", "peraturan", "#"]);
    expect(urutan.slice(4).every((x) => x === "pasal" || x === "peraturan")).toBe(true);
    expect(await page.locator(".hasil").first().locator(".hasil-sitasi").textContent()).toBe("UU 1/1974");
    // Pemisah bukan kartu hasil dan bukan sasaran tab.
    expect(await page.locator(".kelompok-hasil.hasil").count()).toBe(0);
    expect(await page.locator(".kelompok-hasil a, .kelompok-hasil button").count()).toBe(0);
  });

  it("tanpa peraturan berjudul cocok (kata hanya ada di isi pasal), daftar hasilnya polos tanpa judul kelompok", async () => {
    await page.goto(BASE + "/cari?q=pesangon", { waitUntil: "networkidle" });
    await page.waitForSelector(".daftar-hasil .hasil");
    expect(await page.locator(".kelompok-hasil").count()).toBe(0);
  });

  it("kartu hasil: judul hanya topiknya (huruf dirapikan), tanpa lencana jenis, dan seluruh kartu bisa diketuk", async () => {
    await reset();
    const res = await fetch(`${BASE}/api/impor/manifest`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": "token-admin-uji" },
      body: JSON.stringify({
        versi: 1,
        dokumen: [{ bpk_id: "7001", meta: { Judul: "Peraturan Pemerintah Nomor 85 Tahun 2013 tentang TATA CARA HUBUNGAN ANTAR LEMBAGA BADAN PENYELENGGARA", "Bentuk Singkat": "PP", Nomor: "85", Tahun: "2013", Status: "Berlaku" }, relasi: [] }],
      }),
    });
    expect(res.status).toBe(200);
    await page.goto(BASE + "/telusuri?jenis=PP", { waitUntil: "networkidle" });
    const kartu = page.locator(".hasil", { hasText: "PP 85/2013" });
    await kartu.waitFor();
    expect(await kartu.locator(".hasil-judul").textContent()).toBe("Tata Cara Hubungan Antar Lembaga Badan Penyelenggara");
    expect(await kartu.locator(".lencana-jenis").count()).toBe(0);
    // Tautan judul dibentangkan ke seluruh kartu: mengetuk bagian kosong kartu membuka peraturannya.
    const kotak = await kartu.boundingBox();
    await page.mouse.click(kotak.x + kotak.width / 2, kotak.y + kotak.height - 6);
    await page.waitForURL(/\/peraturan\?uri=/);
    await reset();
  });

  it("kalimat yang tak memuat semua katanya di satu pasal tetap menemukan pasalnya, dengan catatan terus terang", async () => {
    await page.goto(BASE + "/cari?q=" + encodeURIComponent("berapa lama cuti melahirkan bagi pekerja perempuan") + "&mode=keyword", { waitUntil: "networkidle" });
    await page.waitForSelector(".daftar-hasil .hasil");
    expect(await page.locator(".catatan-hasil").textContent()).toContain("sebagian kata");
    expect(await page.locator(".hasil-pasal").first().textContent()).toContain("Pasal");
    // Pencarian biasa tidak menampilkan catatan itu.
    await page.goto(BASE + "/cari?q=pesangon&mode=keyword", { waitUntil: "networkidle" });
    await page.waitForSelector(".daftar-hasil .hasil");
    expect(await page.locator(".catatan-hasil").count()).toBe(0);
  });

  it("riwayat: kata yang dicari dan peraturan yang dibuka muncul di beranda, dan hanya di perangkat ini", async () => {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    expect(await page.locator(".contoh").count(), "tanpa baris Coba/Terakhir").toBe(0);
    expect(await page.locator("#h-dilihat").count()).toBe(0);

    await page.goto(BASE + "/cari?q=pesangon", { waitUntil: "networkidle" });
    await page.waitForSelector(".daftar-hasil .hasil");
    const dibuka = await page.locator(".hasil .hasil-sitasi").first().textContent();
    await page.locator(".hasil-judul a").first().click();
    await page.waitForSelector("h1.judul-peraturan");

    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    // Pencarian terakhir tidak lagi berupa baris chip di beranda: ia muncul di daftar saran saat kotak cari difokuskan.
    expect(await page.locator(".contoh").count()).toBe(0);
    await page.focus("main input[type=search]");
    await page.waitForSelector("main .saran:not(.sembunyi) li[role=option]");
    expect(await page.locator("main .saran li[role=option]").allTextContents()).toEqual(["pesangon", "Hapus semua riwayat pencarian"]);
    expect(await page.locator("#h-dilihat").textContent()).toBe("Terakhir dilihat");
    expect(await page.locator(".bagian:has(#h-dilihat) .sitasi").first().textContent()).toBe(dibuka);

    // Riwayat bisa dihapus dari halaman Akun, dan beranda kembali ke keadaan awal.
    await page.goto(BASE + "/akun", { waitUntil: "networkidle" });
    await page.click("button:has-text('Hapus riwayat di perangkat ini')");
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    expect(await page.locator(".contoh").count()).toBe(0);
    expect(await page.locator("#h-dilihat").count()).toBe(0);
    await page.focus("main input[type=search]");
    expect(await page.locator("main .saran li").count()).toBe(0);
  });

  it("mengganti mode dan filter memperbarui URL dan hasil", async () => {
    await page.goto(BASE + "/cari?q=" + encodeURIComponent("cipta kerja") + "&mode=keyword", { waitUntil: "networkidle" });
    await page.waitForSelector(".daftar-hasil .hasil");
    const semua = await page.locator(".daftar-hasil .hasil").count();

    // Tahan jawaban API supaya keadaan "memuat" (daftar sementara kosong) selalu teramati: syarat
    // tunggu harus menunggu keadaan AKHIR, bukan sekadar "jumlah hasil berkurang". Tanpa ini tes
    // lolos atau gagal bergantung pada kecepatan server (CI run #17).
    const tahan = async (route) => {
      await new Promise((selesai) => setTimeout(selesai, 400));
      await route.continue();
    };
    await page.route((url) => url.pathname === "/api/search", tahan);
    await page.check("input[name=status][value=dicabut]");
    await page.waitForFunction(() => location.search.includes("status=dicabut"));
    await page.waitForFunction((n) => {
      const jumlah = document.querySelectorAll(".daftar-hasil .hasil").length;
      return !document.querySelector(".daftar-kerangka") && jumlah > 0 && jumlah < n;
    }, semua);
    await page.unroute((url) => url.pathname === "/api/search", tahan).catch(() => {});
    const jumlah = await page.locator(".daftar-hasil .hasil").count();
    expect(jumlah).toBeGreaterThan(0);
    const lencana = await page.locator(".daftar-hasil .hasil .lencana-status, .daftar-hasil .hasil .lencana-dicabut").count();
    expect(lencana).toBe(jumlah);

    await page.click("label:has-text('Makna')");
    await page.waitForFunction(() => location.search.includes("mode=semantic"));
    // Dimuat ulang dengan URL itu, keadaan yang sama pulih.
    await page.reload({ waitUntil: "networkidle" });
    expect(await page.isChecked("input[name=status][value=dicabut]")).toBe(true);
    expect(await page.isChecked("input[name=mode-cari][value=semantic]")).toBe(true);
  });

  it("selama memuat hanya kerangka yang tampil, dan kerangka tidak dihitung sebagai hasil", async () => {
    await page.goto(BASE + "/cari?q=" + encodeURIComponent("cipta kerja") + "&mode=keyword", { waitUntil: "networkidle" });
    await page.waitForSelector(".daftar-hasil .hasil");
    // Tahan jawaban API supaya keadaan "memuat" bisa diamati (bukan balapan).
    await page.route((url) => url.pathname === "/api/search", async (route) => {
      await new Promise((selesai) => setTimeout(selesai, 800));
      await route.continue();
    });
    await page.check("input[name=status][value=dicabut]");
    await page.waitForSelector("[aria-label='Memuat hasil']");
    expect(await page.locator(".daftar-hasil .hasil").count()).toBe(0);
    expect(await page.locator(".daftar-kerangka .hasil-kerangka").count()).toBe(4);
    await page.waitForSelector(".daftar-hasil .hasil");
    expect(await page.locator("[aria-label='Memuat hasil']").count()).toBe(0);
    expect(await page.locator(".daftar-kerangka").count()).toBe(0);
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
    // 10 peraturan contoh dalam cakupan (sebelas tersimpan: satu Perpres sengaja di luar cakupan).
    expect(await page.textContent(".ringkas-hasil")).toBe("10 peraturan");
    await page.check("input[name=jenis][value=PP]");
    await page.waitForFunction(() => document.querySelectorAll(".daftar-hasil .hasil").length === 1);
    expect(page.url()).toContain("jenis=PP");
    await page.uncheck("input[name=jenis][value=PP]");
    await page.selectOption("select[aria-label=Urutkan]", "tahun_asc");
    await page.waitForFunction(() => location.search.includes("urut=tahun_asc"));
    await page.waitForFunction(() => document.querySelectorAll(".daftar-hasil .hasil").length === 10);
    expect(await page.locator(".daftar-hasil .hasil-sitasi").first().textContent()).toBe("UU 1/1974");
  });
});

describe("telusur dengan banyak data", () => {
  const impor = (dokumen) =>
    fetch(`${BASE}/api/impor/manifest`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": "token-admin-uji" },
      body: JSON.stringify({ versi: 1, dokumen }),
    });

  it("paginasi memakai tautan nyata, menandai halaman aktif, dan bisa dibuka langsung", async () => {
    await reset();
    // 31 Perppu: bersama 10 peraturan contoh dalam cakupan menjadi 41 (tiga halaman: 20, 20, 1). Peraturan contoh
    // ke-11 (Perpres) di luar cakupan dan tidak ikut terhitung.
    const dokumen = Array.from({ length: 31 }, (_, i) => ({
      bpk_id: String(9000 + i),
      meta: { Judul: `Peraturan Contoh ${i + 1}`, "Bentuk Singkat": "PERPPU", Nomor: String(i + 1), Tahun: "2024", Status: "Berlaku" },
      relasi: [],
    }));
    expect((await impor(dokumen)).status).toBe(200);

    await page.goto(BASE + "/telusuri", { waitUntil: "networkidle" });
    await page.waitForSelector("nav.paginasi");
    expect(await page.textContent(".ringkas-hasil")).toBe("41 peraturan");
    expect(await page.locator(".daftar-hasil .hasil").count()).toBe(20);
    expect(await page.textContent("nav.paginasi a[aria-current=page]")).toBe("1");

    await page.click("nav.paginasi a[rel=next]");
    await page.waitForURL(/page=2/);
    await page.waitForFunction(() => document.querySelector("nav.paginasi a[aria-current=page]")?.textContent === "2");
    expect(await page.locator(".daftar-hasil .hasil").count()).toBe(20);

    // Halaman terakhir dibuka langsung lewat URL; tombol "Berikutnya" nonaktif.
    await page.goto(BASE + "/telusuri?page=3", { waitUntil: "networkidle" });
    await page.waitForSelector("nav.paginasi");
    expect(await page.locator(".daftar-hasil .hasil").count()).toBe(1);
    expect(await page.locator("nav.paginasi a[rel=next]").count()).toBe(0);

    // Mengubah filter kembali ke halaman pertama.
    await page.check("input[name=jenis][value=PERPPU]");
    await page.waitForFunction(() => document.querySelector(".ringkas-hasil")?.textContent === "31 peraturan");
    expect(page.url()).not.toContain("page=");
    expect(await page.locator(".daftar-hasil .hasil").count()).toBe(20);
    await reset();
  });

  it("di ponsel panel filter tertutup sampai tombol Filter ditekan", async () => {
    const hp = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const p = await hp.newPage();
    await p.goto(BASE + "/telusuri", { waitUntil: "networkidle" });
    expect(await p.locator(".filter-isi").isVisible()).toBe(false);
    await p.click(".filter-toggle");
    expect(await p.locator(".filter-isi").isVisible()).toBe(true);
    expect(await p.getAttribute(".filter-toggle", "aria-expanded")).toBe("true");
    await p.check("input[name=status][value=dicabut]");
    await p.waitForFunction(() => location.search.includes("status=dicabut"));
    expect(await p.textContent(".filter-toggle .lencana-jumlah")).toBe("1");
    await hp.close();
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

  it("tab PDF, Relasi, dan Naskah dapat dicapai dengan papan ketik dan tersimpan di URL", async () => {
    await page.goto(BASE + urlUU(UU13), { waitUntil: "networkidle" });
    await page.focus("#tab-isi");
    await page.keyboard.press("ArrowRight");
    await page.waitForSelector("#panel-pdf:not([hidden])");
    expect(page.url()).toContain("tab=pdf");
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
    // Di layar lebar daftar isi adalah <dialog open> permanen di samping teks; yang dituju dialog laporan.
    await page.waitForSelector("dialog.dialog-laporan[open]");
    await page.selectOption("dialog.dialog-laporan select", "teks_salah");
    await page.fill("dialog.dialog-laporan textarea", "Pasal 82 ayat (1) salah ketik");
    await page.click("dialog.dialog-laporan button[type=submit]");
    await page.waitForFunction(() => !document.querySelector("dialog.dialog-laporan"));
    expect(await page.locator(".toast").allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining("Terima kasih")]));
    const lapor = await (await fetch(`${BASE}/api/admin/laporan`, { headers: { "x-admin-token": "token-admin-uji" } })).json();
    expect(lapor.laporan[0]).toMatchObject({ frbr_uri: UU13, jenis: "teks_salah", keterangan: "Pasal 82 ayat (1) salah ketik" });
    await reset();
  });

  it("peraturan dengan ribuan baris pasal tetap responsif (UU Cipta Kerja asli: 1.305 baris)", async () => {
    await reset();
    expect((await fetch(`${BASE}/__dev/peraturan-besar?pasal=3000`, { method: "POST" })).status).toBe(201);
    const uri = "/akn/id/act/uu/2099/1";

    const mulai = Date.now();
    await page.goto(BASE + urlUU(uri), { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelectorAll(".pasal").length >= 1500);
    const muat = Date.now() - mulai;
    expect(muat, `memuat 3000 baris: ${muat} ms`).toBeLessThan(6000);
    expect(await page.locator(".pasal").count()).toBe(1500); // dua ayat per pasal
    expect(await page.locator("h2.bab").count()).toBe(30);

    // Mencari di dalam peraturan tetap cepat dan benar.
    const awal = Date.now();
    await page.fill(".cari-dalam input", "nomor 2999");
    await page.waitForFunction(() => document.querySelectorAll(".pasal:not(.tidak-cocok)").length === 1);
    const saring = Date.now() - awal;
    expect(saring, `menyaring: ${saring} ms`).toBeLessThan(3000);

    // Loncat ke pasal di tengah daftar lewat jangkar (muat penuh dari halaman lain, bukan sekadar ganti hash).
    await page.goto(BASE + "/tentang", { waitUntil: "domcontentloaded" });
    await page.goto(BASE + urlUU(uri, "#pasal-900-ayat-2"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#pasal-900-ayat-2");
    await page.waitForFunction(() => {
      const r = document.querySelector("#pasal-900-ayat-2")?.getBoundingClientRect();
      return r && r.top >= 0 && r.bottom <= innerHeight;
    });
    await reset();
  });

  it("peraturan yang tidak ada di indeks: halaman penjelasan dengan jalan keluar", async () => {
    await page.goto(BASE + urlUU("/akn/id/act/uu/1999/99"), { waitUntil: "networkidle" });
    await page.waitForSelector(".kosong");
    expect(await page.textContent(".kosong")).toContain("belum ada di indeks Lexa");
    expect(await page.locator(".kosong a").count()).toBeGreaterThanOrEqual(2);
  });

  it("pratinjau tautan: tanpa JavaScript (seperti perayap WhatsApp/Telegram), judul, deskripsi, dan gambar sudah ada", async () => {
    const polos = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block", userAgent: "WhatsApp/2.24.20.85 A" });
    try {
      const p = await polos.newPage();
      await p.goto(BASE + urlUU(UU13), { waitUntil: "load" });
      const isi = (kunci) => p.locator(`meta[name="${kunci}"], meta[property="${kunci}"]`).first().getAttribute("content");
      expect(await p.title()).toBe("UU 13/2003 Ketenagakerjaan · Lexa");
      expect(await isi("og:title")).toBe("UU 13/2003 Ketenagakerjaan");
      // Data contoh memuat ringkasan UU 13/2003, dan itulah yang dipakai sebagai deskripsi.
      expect(await isi("og:description")).toMatch(/^Mengatur hubungan kerja/);
      expect(await isi("description")).toBe(await isi("og:description"));
      expect(await isi("og:url")).toBe(`${BASE}${urlUU(UU13)}`);
      expect(await isi("twitter:card")).toBe("summary_large_image");
      const gambar = await isi("og:image");
      expect(gambar).toBe(`${BASE}/og/lexa.png`);
      const res = await fetch(gambar);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
    } finally {
      await polos.close();
    }
    // Pembaca biasa langsung menerima cangkang (tanpa pencarian D1); judulnya disetel JavaScript setelah dimuat.
    const biasa = await (await fetch(`${BASE}${urlUU(UU13)}`, { headers: { "user-agent": "Mozilla/5.0 (Linux; Android 14) Chrome/130.0.0.0 Mobile Safari/537.36" } })).text();
    expect(biasa).toContain("<title>Lexa: cari peraturan perundang-undangan Indonesia</title>");
    expect(biasa).not.toContain("og:image");
    // Rute lain tetap membawa pratinjau umum situs.
    const beranda = await (await fetch(`${BASE}/`)).text();
    expect(beranda).toContain('<meta property="og:title" content="Lexa: cari peraturan perundang-undangan Indonesia">');
    expect(beranda).not.toContain("og:image");
  });

  it("peraturan yang tidak ada di indeks tidak mendapat pratinjau khusus (cangkang biasa)", async () => {
    const html = await (await fetch(`${BASE}${urlUU("/akn/id/act/uu/1999/99")}`, { headers: { "user-agent": "TelegramBot (like TwitterBot)" } })).text();
    expect(html).toContain("<title>Lexa: cari peraturan perundang-undangan Indonesia</title>");
    expect(html).not.toContain("og:image");
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
  it("jawaban status sesi yang rusak (badan kosong, HTML, atau null) diperlakukan sebagai tamu, tanpa galat halaman", async () => {
    // Regresi CI: respons 2xx yang badannya tak terbaca dulu dikembalikan sebagai null,
    // `sesi.data` menjadi null, dan penggambar header meledak ("Cannot destructure ... 'sesi.data'").
    let jawab = { status: 200, contentType: "application/json", body: "" };
    await page.route((url) => url.pathname === "/api/auth/status", (route) => route.fulfill(jawab));
    for (const rusak of [
      { status: 200, contentType: "application/json", body: "" },
      { status: 200, contentType: "text/html", body: "<html><body>Bad gateway</body></html>" },
      { status: 200, contentType: "application/json", body: "null" },
    ]) {
      jawab = rusak;
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      await page.waitForSelector("h1");
      expect(await page.locator(".nav-akun").textContent(), `header untuk badan ${JSON.stringify(rusak.body)}`).toContain("Masuk");
      await page.goto(BASE + "/akun", { waitUntil: "networkidle" });
      await page.waitForFunction(() => document.querySelector("main")?.textContent?.includes("sebagai tamu"));
      await page.goto(BASE + "/koleksi", { waitUntil: "networkidle" });
      await page.waitForSelector("main h1");
    }
  });

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

  it("bantuan masuk: alamat pengalihan Google yang harus didaftarkan tampil persis dan bisa disalin (anti redirect_uri_mismatch)", async () => {
    await page.goto(BASE + "/akun", { waitUntil: "networkidle" });
    const bantuan = page.locator("details.bantuan-masuk");
    // Tertutup secara bawaan: pengunjung biasa tak perlu melihatnya.
    expect(await bantuan.evaluate((d) => d.open)).toBe(false);
    expect(await bantuan.locator("summary").textContent()).toContain("redirect_uri_mismatch");
    await bantuan.locator("summary").click();
    const uri = await bantuan.locator("code.uri-callback").textContent();
    expect(uri).toBe(`${BASE}/api/auth/google/callback`);
    await bantuan.locator("button:has-text('Salin')").click();
    await page.locator(".toast", { hasText: "Alamat disalin." }).waitFor();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(uri);
    // Tak ada yang meluap di layar sempit.
    await page.setViewportSize({ width: 360, height: 740 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  it("kembali dari Google dengan galat: pesan yang sesuai tampil di halaman Akun", async () => {
    for (const [galat, teks] of [["ditolak", "Masuk dibatalkan"], ["google", "Google mengembalikan galat"]]) {
      await page.goto(`${BASE}/akun?galat=${galat}`, { waitUntil: "networkidle" });
      expect(await page.locator(".peringatan, .catatan-hasil, [role=alert]").first().textContent()).toContain(teks);
    }
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
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(20, 19, 15)");
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

  it("tampilan ponsel: tanpa gulir horizontal di semua halaman utama; navigasi utama ada di bilah bawah", async () => {
    const hp = await browser.newContext({ serviceWorkers: "block", viewport: { width: 375, height: 800 } });
    const p = await hp.newPage();
    const galat = [];
    p.on("console", (m) => m.type() === "error" && galat.push(m.text()));
    for (const path of ["/", "/cari?q=pesangon", "/telusuri", urlUU(UU13), urlUU(UU13, "&tab=relasi"), "/tanya", "/koleksi", "/tentang", "/status"]) {
      await p.goto(BASE + path, { waitUntil: "networkidle" });
      expect(await p.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(375);
    }
    // Menu hamburger digantikan bilah navigasi bawah (terjangkau ibu jari); keduanya tidak tampil bersamaan.
    expect(await p.locator(".tombol-menu").isVisible()).toBe(false);
    expect(await p.locator(".nav-bawah").isVisible()).toBe(true);
    expect(await p.locator(".nav-bawah .tab-label").allTextContents()).toEqual(["Cari", "Telusuri", "Tanya", "Koleksi", "Masuk"]);
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

    // Tampilan ponsel (bilah bawah, kartu ringkas, lembar filter) diperiksa terpisah dari tata letak desktop.
    for (const tema of ["terang", "gelap"]) {
      it(`ponsel: beranda, hasil, telusuri, tanya, akun, dan lembar filter (tema ${tema})`, async () => {
        const konteks = await browser.newContext({
          serviceWorkers: "block", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, bypassCSP: true,
          colorScheme: tema === "gelap" ? "dark" : "light",
        });
        const p = await konteks.newPage();
        const laporan = [];
        for (const path of ["/", "/cari?q=pesangon", "/telusuri", "/tanya", "/akun", "/koleksi"]) {
          await p.goto(BASE + path, { waitUntil: "networkidle" });
          await p.waitForTimeout(250);
          await p.addScriptTag({ path: axePath });
          const hasil = await p.evaluate(async () => {
            // eslint-disable-next-line no-undef
            const r = await axe.run(document, { resultTypes: ["violations"], rules: { "color-contrast": { enabled: true } } });
            return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => ({ id: v.id, bantuan: v.help, simpul: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
          });
          if (hasil.length) laporan.push({ path, hasil });
        }
        // Lembar filter terbuka (dialog modal): isinya sendiri harus lolos.
        await p.goto(BASE + "/cari?q=pesangon", { waitUntil: "networkidle" });
        await p.addScriptTag({ path: axePath });
        await p.click(".filter-toggle");
        await p.locator("dialog.filter-isi").evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
        const lembar = await p.evaluate(async () => {
          // eslint-disable-next-line no-undef
          const r = await axe.run(document, { resultTypes: ["violations"], rules: { "color-contrast": { enabled: true } } });
          return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => ({ id: v.id, bantuan: v.help, simpul: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
        });
        if (lembar.length) laporan.push({ path: "lembar filter", hasil: lembar });
        await konteks.close();
        expect(laporan).toEqual([]);
      });
    }

    for (const tema of ["terang", "gelap"]) {
      it.each(halaman)(`%s (tema ${tema})`, async (_nama, path) => {
        // bypassCSP hanya agar axe bisa disuntikkan; aplikasinya sendiri diuji dengan CSP aktif di tes lain.
        const konteks = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 }, bypassCSP: true, colorScheme: tema === "gelap" ? "dark" : "light" });
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

describe("cakupan peraturan (UUD, Tap MPR, UU, Perppu, PP)", () => {
  // Server pratinjau menyimpan satu Perpres contoh (metadata saja) yang sengaja di luar cakupan, seperti
  // baris Perpres, Permen, dan POJK di produksi: ada di D1, tidak tampil di mana pun.
  const URI_PERPRES = "/akn/id/act/perpres/2018/16";
  const JUDUL_PERPRES = "Pengadaan Barang/Jasa Pemerintah";
  const CAKUPAN = "UUD, TAP MPR, UU, PERPPU, dan PP";

  it("beranda, telusur, status, dan tentang menyebutkan cakupannya", async () => {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector(".info-indeks")?.textContent);
    expect(await page.textContent(".info-indeks")).toContain(`Cakupan saat ini: ${CAKUPAN}.`);

    await page.goto(BASE + "/telusuri", { waitUntil: "networkidle" });
    await page.waitForSelector(".daftar-hasil .hasil");
    expect(await page.textContent("main")).toContain(`Cakupan saat ini: ${CAKUPAN}.`);

    await page.goto(BASE + "/status", { waitUntil: "networkidle" });
    await page.waitForSelector(".statistik");
    expect(await page.textContent("main")).toContain(`Cakupan Lexa saat ini: ${CAKUPAN}.`);

    await page.goto(BASE + "/tentang", { waitUntil: "networkidle" });
    expect(await page.textContent("main")).toContain("Cakupan dibatasi.");
  });

  it("peraturan di luar cakupan tidak ada di telusur: bukan di daftar, bukan di facet, bukan di jumlah", async () => {
    await page.goto(BASE + "/telusuri", { waitUntil: "networkidle" });
    await page.waitForSelector(".daftar-hasil .hasil");
    expect(await page.textContent(".ringkas-hasil")).toBe("10 peraturan");
    expect(await page.locator(".daftar-hasil").textContent()).not.toContain(JUDUL_PERPRES);
    const jenis = await page.locator("input[name=jenis]").evaluateAll((els) => els.map((e) => e.value).sort());
    expect(jenis).toEqual(["PP", "UU"]);
    // Statistik di beranda dan status pun tidak menghitungnya.
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector(".info-indeks")?.textContent);
    expect(await page.textContent(".info-indeks")).toMatch(/^10 peraturan /);
  });

  it("pencarian tidak menemukannya, dan sitasi ke jenisnya dijelaskan terus terang", async () => {
    await page.goto(BASE + "/cari?q=" + encodeURIComponent(JUDUL_PERPRES) + "&mode=keyword", { waitUntil: "networkidle" });
    await page.waitForSelector(".ringkas-hasil");
    // Hasil pencarian kata bisa memuat peraturan lain yang mirip; yang tak boleh ada adalah tautan ke Perpres itu.
    expect(await page.locator(`.daftar-hasil a[href*="perpres"]`).count()).toBe(0);

    await page.goto(BASE + "/cari?q=" + encodeURIComponent("Perpres 16/2018") + "&mode=keyword", { waitUntil: "networkidle" });
    await page.waitForSelector(".catatan-hasil");
    const catatan = await page.textContent(".catatan-hasil");
    expect(catatan).toContain("Lexa belum memuat peraturan jenis PERPRES");
    expect(catatan).toContain(CAKUPAN);
    expect(await page.locator(".hasil .sumber-chip", { hasText: "Sitasi" }).count()).toBe(0);
    expect(await page.locator(`.daftar-hasil a[href*="perpres"]`).count()).toBe(0);

    // Sitasi ke jenis yang dimuat tidak diberi catatan itu.
    await page.goto(BASE + "/cari?q=" + encodeURIComponent("UU 13/2003") + "&mode=keyword", { waitUntil: "networkidle" });
    await page.waitForSelector(".daftar-hasil .hasil");
    expect(await page.locator(".catatan-hasil", { hasText: "belum memuat" }).count()).toBe(0);
  });

  it("tautan langsung ke peraturan di luar cakupan menjelaskan cakupan, bukan 'belum ada di indeks'", async () => {
    await page.goto(BASE + urlUU(URI_PERPRES), { waitUntil: "networkidle" });
    await page.waitForSelector("main h1");
    expect(await page.textContent("main h1")).toBe("Peraturan ini di luar cakupan Lexa");
    const isi = await page.textContent("main");
    expect(isi).toContain(`Untuk saat ini Lexa hanya memuat ${CAKUPAN}.`);
    expect(isi).not.toContain("belum ada di indeks");
    expect(await page.title()).toContain("Peraturan di luar cakupan");
    expect(await page.locator("main a[href='https://peraturan.bpk.go.id']").count()).toBe(1);
    // Tidak pernah mencatatnya sebagai peraturan yang dilihat.
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    expect(await page.locator("#h-dilihat").count()).toBe(0);
  });

  it("tautan telusur lama dengan jenis di luar cakupan dijelaskan, bukan sekadar kosong", async () => {
    await page.goto(BASE + "/telusuri?jenis=PERPRES", { waitUntil: "networkidle" });
    await page.waitForSelector(".kosong h2");
    expect(await page.textContent(".kosong h2")).toBe("Jenis PERPRES belum dimuat Lexa");
    expect(await page.textContent(".kosong")).toContain(`Untuk saat ini Lexa hanya memuat ${CAKUPAN}.`);
  });

  it("peta sitemap dan pratinjau tautan tidak menyinggung peraturan di luar cakupan", async () => {
    const xml = await (await fetch(`${BASE}/sitemap.xml`)).text();
    expect(xml).toContain(encodeURIComponent(UU13));
    expect(xml).not.toContain(encodeURIComponent(URI_PERPRES));

    const html = await (await fetch(`${BASE}${urlUU(URI_PERPRES)}`, { headers: { "user-agent": "WhatsApp/2.24.20.85 A" } })).text();
    expect(html).not.toContain(JUDUL_PERPRES);
    expect(html).not.toContain('property="og:image"');
  });

  it("impor BPK menolak jenis di luar cakupan dan menyebutkan alasannya", async () => {
    await reset();
    const res = await fetch(`${BASE}/api/impor/manifest`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": "token-admin-uji" },
      body: JSON.stringify({
        versi: 1,
        dokumen: [
          { bpk_id: "9701", meta: { Judul: "Peraturan Menteri Contoh", "Bentuk Singkat": "PERMEN", Nomor: "1", Tahun: "2024", Status: "Berlaku" }, relasi: [] },
          { bpk_id: "9702", meta: { Judul: "Peraturan Pemerintah Contoh", "Bentuk Singkat": "PP", Nomor: "1", Tahun: "2024", Status: "Berlaku" }, relasi: [] },
        ],
      }),
    });
    const b = await res.json();
    expect(b.diterima).toBe(1);
    expect(b.ditolak).toEqual([{ bpk_id: "9701", alasan: expect.stringContaining("di luar cakupan (PERMEN)") }]);
    await reset();
  });
});

describe("status: kelengkapan isi", () => {
  it("menampilkan kemajuan isi per jenis dalam urutan pengambilan, tanpa peringatan bila akses baik", async () => {
    await page.goto(BASE + "/status", { waitUntil: "networkidle" });
    await page.waitForSelector("#judul-kelengkapan");
    const jenis = await page.locator("section[aria-labelledby=judul-kelengkapan] tbody tr td:first-child").allTextContents();
    expect(jenis).toEqual(["UUD", "TAP MPR", "UU", "PERPPU", "PP"]);
    const meter = page.locator("section[aria-labelledby=judul-kelengkapan] [role=progressbar]");
    expect(Number(await meter.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(0);
    expect(await page.textContent("section[aria-labelledby=judul-kelengkapan]")).toMatch(/\d+ dari \d+\s*peraturan sudah punya teks pasal/);
    expect(await page.locator("section[aria-labelledby=judul-kelengkapan] .peringatan").count()).toBe(0);
  });

  it("memperingatkan terus terang bila pasal.id tidak memberi isi, dengan catatan sumber dan kapan diperiksa lagi", async () => {
    const nyata = await (await fetch(`${BASE}/api/stats`)).json();
    nyata.isi.akses = {
      sejak: "2026-10-11T16:18:00.000Z",
      terakhir: "2026-10-11T17:20:00.000Z",
      periksa_lagi: "2026-10-11T17:50:00.000Z",
      catatan: "not_available_via_api — Teks lengkap hanya untuk pemakai yang masuk.",
    };
    nyata.isi.pasal_dijeda_sampai = "2026-10-11T18:00:00.000Z";
    await page.route((url) => url.pathname === "/api/stats", (route) => route.fulfill({ json: nyata }));
    await page.goto(BASE + "/status", { waitUntil: "networkidle" });
    await page.waitForSelector("#judul-kelengkapan");
    const panel = page.locator("section[aria-labelledby=judul-kelengkapan]");
    expect(await panel.locator("[role=alert]").textContent()).toContain("pasal.id sedang tidak memberi isi peraturan.");
    const teks = await panel.textContent();
    expect(teks).toContain("Catatan pasal.id: not_available_via_api — Teks lengkap hanya untuk pemakai yang masuk.");
    expect(teks).toContain("diperiksa lagi");
    expect(teks).toContain("pasal.id meminta jeda");
  });
});

describe("halaman peraturan: teks yang tersimpan sebagian", () => {
  const detail = async () => (await (await fetch(`${BASE}/api/laws/detail?uri=${encodeURIComponent(UU13)}`)).json());
  const artikel = (nomor) => ({ id: `${UU13}#pasal-${nomor}`, frbr_uri: UU13, nomor_pasal: String(nomor), ayat: null, bab: null, bagian: null, judul: null, isi: `Isi pasal ${nomor}.`, urutan: nomor });

  it("memberi tahu pembaca bila nomor pasal bercelah, dengan contoh nomor dan tautan ke naskah di sumber", async () => {
    const d = await detail();
    d.articles = [1, 2, 3, 40, 41, 42, 90].map(artikel);
    d.law.sumber_url = "https://peraturan.go.id/id/uu-no-13-tahun-2003";
    d.bpk_url = null;
    await page.route((url) => url.pathname === "/api/laws/detail", (route) => route.fulfill({ json: d }));
    await page.goto(BASE + urlUU(UU13), { waitUntil: "networkidle" });
    await page.waitForSelector(".isi-peraturan");
    // Lencana di kepala halaman (tidak mendorong teks), penjelasannya di akhir teks.
    const lencana = page.locator(".meta-baris button", { hasText: "Teks belum lengkap" });
    expect(await lencana.count()).toBe(1);
    await lencana.click();
    const catatan = page.locator("#catatan-celah");
    expect(await catatan.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })).toBe(true);
    expect(await catatan.textContent()).toContain("Teks peraturan ini tampaknya belum lengkap.");
    expect(await catatan.textContent()).toContain("Nomor pasal berhenti di 90, tetapi 83 nomor di antaranya tidak ada di Lexa (mis. Pasal 4, 5, 6, 7)");
    expect(await catatan.locator("a").getAttribute("href")).toBe("https://peraturan.go.id/id/uu-no-13-tahun-2003");
  });

  it("peraturan dengan penomoran utuh tidak diberi peringatan", async () => {
    const d = await detail();
    d.articles = [1, 2, 3, 4, 5, 6].map(artikel);
    await page.route((url) => url.pathname === "/api/laws/detail", (route) => route.fulfill({ json: d }));
    await page.goto(BASE + urlUU(UU13), { waitUntil: "networkidle" });
    await page.waitForSelector(".isi-peraturan");
    expect(await page.locator("#catatan-celah").count()).toBe(0);
    expect(await page.locator(".meta-baris button", { hasText: "Teks belum lengkap" }).count()).toBe(0);
  });

  it("peraturan yang pasalnya belum diambil menjelaskan keadaannya dan menautkan sumber (hanya http/https)", async () => {
    const d = await detail();
    d.articles = [];
    d.bpk_url = null;
    d.law.sumber_url = "javascript:alert(1)";
    await page.route((url) => url.pathname === "/api/laws/detail", (route) => route.fulfill({ json: d }));
    await page.goto(BASE + urlUU(UU13), { waitUntil: "networkidle" });
    await page.waitForSelector("text=Teks pasal belum tersedia di Lexa");
    expect(await page.textContent("main")).toContain("pasal-pasalnya belum berhasil diambil");
    expect(await page.locator("main a[href^='javascript:']").count()).toBe(0);

    d.law.sumber_url = "https://peraturan.go.id/id/uu-no-13-tahun-2003";
    await page.goto(BASE + "/tentang", { waitUntil: "networkidle" });
    await page.goto(BASE + urlUU(UU13), { waitUntil: "networkidle" });
    await page.waitForSelector("text=Teks pasal belum tersedia di Lexa");
    expect(await page.locator("main a", { hasText: "Buka naskah di sumber" }).getAttribute("href")).toBe("https://peraturan.go.id/id/uu-no-13-tahun-2003");
  });
});
