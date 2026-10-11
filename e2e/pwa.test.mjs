/**
 * Tes e2e PWA dan tampilan ponsel di Chromium sungguhan.
 *
 * Berbeda dari ui.test.mjs, di sini service worker DIIZINKAN (tes lain memblokirnya agar
 * deterministik). Yang diuji: dapat dipasang (manifest + service worker lolos pemeriksaan
 * Chrome), cangkang dan peraturan terbaca saat luring, ajakan pasang (Android, iOS, sudah
 * terpasang), dan bilah navigasi bawah.
 *
 *   npm run e2e
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { devices } from "playwright-core";
import { buatPerantara, mulaiPratinjau, pasangPengumpul, UU13, urlUU } from "./pembantu.mjs";

const PORT = 4790;
// Peramban memakai perantara agar jaringan bisa diputus untuk halaman DAN service worker (lihat buatPerantara).
const PORT_PERANTARA = 4792;
const BASE = `http://localhost:${PORT_PERANTARA}`;

let server;
let browser;
let perantara;

beforeAll(async () => {
  ({ server, browser } = await mulaiPratinjau(PORT, { LEXA_TANPA_CACHE_API: "1" }));
  perantara = await buatPerantara(PORT, PORT_PERANTARA);
});
afterAll(async () => {
  await browser?.close();
  perantara?.tutup();
  server?.kill();
});

/** Putus atau pulihkan jaringan: sambungan ke server (halaman + service worker) dan status online peramban. */
async function setLuring(ctx, nilai) {
  perantara.putus(nilai);
  await ctx.setOffline(nilai);
}

const PONSEL = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const { userAgent: UA_IPHONE, viewport: VIEWPORT_IPHONE, deviceScaleFactor: DPR_IPHONE } = devices["iPhone 13"];

/**
 * Jalankan satu tes dengan konteks baru dan pengumpul galat; galat konsol/jaringan harus kosong di akhir
 * kecuali tes menyatakan `luring` (permintaan yang gagal saat luring memang diharapkan).
 * @param {import("playwright-core").BrowserContextOptions & { luring?: boolean }} opsi
 * @param {(ctx: import("playwright-core").BrowserContext, page: import("playwright-core").Page) => Promise<void>} isi
 */
async function dengan(opsi, isi) {
  const { luring, ...konteks } = opsi;
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 }, ...konteks });
  const page = await ctx.newPage();
  /** @type {string[]} */
  const masalah = [];
  pasangPengumpul(page, masalah);
  try {
    await isi(ctx, page);
  } finally {
    perantara.putus(false);
    await ctx.close();
  }
  // Saat luring, permintaan gagal dan 503 "luring" buatan service worker (data belum tersimpan) memang diharapkan.
  const dipakai = luring ? masalah.filter((m) => !m.startsWith("[requestfailed]") && !m.startsWith("[http 503]") && !m.includes("ERR_INTERNET_DISCONNECTED")) : masalah;
  expect(dipakai, "galat konsol/jaringan").toEqual([]);
}

/** Tunggu service worker aktif dan mengendalikan halaman ini (clients.claim). */
async function tungguSW(page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

/** Kirim peristiwa beforeinstallprompt tiruan, seperti Chrome Android. */
async function tawarkanPasang(page, jawaban = "accepted") {
  await page.evaluate((hasil) => {
    const e = new Event("beforeinstallprompt", { cancelable: true });
    // @ts-ignore
    e.prompt = () => (window.__prompt = (window.__prompt ?? 0) + 1);
    // @ts-ignore
    e.userChoice = Promise.resolve({ outcome: hasil });
    window.dispatchEvent(e);
  }, jawaban);
}

describe("dapat dipasang", () => {
  it("manifest terbaca Chrome tanpa galat dan pemeriksaan pemasangan lolos setelah service worker aktif", async () => {
    await dengan({ serviceWorkers: "allow" }, async (ctx, page) => {
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      await tungguSW(page);
      const cdp = await ctx.newCDPSession(page);
      const { errors, data } = await cdp.send("Page.getAppManifest");
      expect(errors).toEqual([]);
      expect(JSON.parse(data)).toMatchObject({ display: "standalone", short_name: "Lexa", start_url: "/?sumber=pwa" });
      const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
      expect(installabilityErrors).toEqual([]);
    });
  });

  it("manifest dan ikon dilayani dengan tipe yang benar", async () => {
    const manifest = await fetch(`${BASE}/manifest.webmanifest`);
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get("content-type")).toContain("application/manifest+json");
    const { icons } = await manifest.json();
    for (const ikon of icons) {
      const res = await fetch(BASE + ikon.src);
      expect(res.status, ikon.src).toBe(200);
      expect(res.headers.get("content-type"), ikon.src).toBe(ikon.type);
    }
  });

  it("warna bilah status mengikuti tema yang dipilih di aplikasi, bukan hanya pengaturan sistem", async () => {
    await dengan({ colorScheme: "light" }, async (_ctx, page) => {
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      const warna = () => page.evaluate(() => document.head.querySelector('meta[name="theme-color"][data-dinamis]')?.getAttribute("content"));
      expect(await warna()).toBe("#f4ecda");
      await page.click("button[aria-label*='tema gelap']");
      expect(await warna()).toBe("#14130f");
      // Meta dinamis harus yang pertama agar dipakai peramban.
      expect(await page.evaluate(() => document.head.querySelector('meta[name="theme-color"]')?.hasAttribute("data-dinamis"))).toBe(true);
    });
  });
});

describe("service worker dan luring", () => {
  it("terpasang, menyimpan cangkang, lalu halaman dan peraturan yang pernah dibuka tetap terbaca tanpa jaringan", async () => {
    await dengan({ serviceWorkers: "allow", luring: true }, async (ctx, page) => {
      await page.goto(BASE + urlUU(UU13), { waitUntil: "networkidle" });
      await tungguSW(page);
      const cache = await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("lexa-")));
      expect(cache.some((k) => k.startsWith("lexa-cangkang-"))).toBe(true);

      // Muat ulang agar halaman dikendalikan service worker: panggilan API-nya kini ikut tersimpan.
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("heading", { level: 1 }).filter({ hasText: "Ketenagakerjaan" }).waitFor();

      await setLuring(ctx, true);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { level: 1 }).filter({ hasText: "Ketenagakerjaan" }).waitFor();
      expect(await page.locator(".pita-luring").isVisible()).toBe(true);
      // Pasal ikut tampil dari salinan, dan pengguna diberi tahu bahwa ini salinan.
      expect(await page.locator(".pasal").count()).toBeGreaterThan(0);
      await page.locator(".toast", { hasText: "salinan" }).waitFor();

      // Halaman yang belum pernah dibuka: cangkang tetap tampil, isinya menjelaskan sedang luring (bukan layar putih).
      await page.goto(BASE + "/telusuri", { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { level: 1, name: "Telusuri peraturan" }).waitFor();
      await page.locator(".galat", { hasText: "luring" }).waitFor();

      // Kembali daring: ribbon hilang dan data hidup kembali.
      await setLuring(ctx, false);
      await page.reload({ waitUntil: "networkidle" });
      await page.locator(".daftar-hasil .hasil").first().waitFor();
      expect(await page.locator(".pita-luring").isVisible()).toBe(false);
    });
  });

  it("simpan untuk luring: peraturan yang disimpan tetap terbaca walau cache baca sudah terkuras; yang hanya pernah dibuka tidak", async () => {
    await dengan({ serviceWorkers: "allow", luring: true, ...PONSEL }, async (ctx, page) => {
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      await tungguSW(page);
      await page.reload({ waitUntil: "networkidle" }); // dikendalikan service worker: panggilan API ikut tercatat

      // UU 11/2020 hanya dibuka; UU 13/2003 dibuka lalu disimpan untuk luring.
      await page.goto(BASE + urlUU("/akn/id/act/uu/2020/11"), { waitUntil: "networkidle" });
      await page.locator(".pasal").first().waitFor();
      await page.goto(BASE + urlUU(UU13), { waitUntil: "networkidle" });
      await page.locator(".pasal").first().waitFor();
      await page.locator(".tombol-lainnya").tap();
      await page.locator("dialog.lembar-aksi .aksi-baris", { hasText: "Simpan untuk dibaca luring" }).tap();
      await page.locator(".toast", { hasText: "Tersimpan untuk dibaca luring" }).waitFor();

      // Kuras cache baca (80 entri) dengan alamat baru; simpanan pengguna tidak ikut terbuang.
      await page.evaluate(async () => {
        for (let i = 1; i <= 90; i++) await fetch(`/api/laws?page=${i}&per_page=1`);
      });
      // Pemangkasan berjalan di latar belakang service worker; tunggu sampai batas 80 entri tercapai.
      await page.waitForFunction(async () => (await (await caches.open("lexa-baca-v1")).keys()).length <= 80);
      const uu11Masihdiingat = await page.evaluate(
        async (u) => Boolean(await (await caches.open("lexa-baca-v1")).match(u)),
        `${BASE}/api/laws/detail?uri=${encodeURIComponent("/akn/id/act/uu/2020/11")}`,
      );
      expect(uu11Masihdiingat, "UU 11/2020 (hanya dibuka) sudah terbuang dari cache baca").toBe(false);

      await setLuring(ctx, true);
      await page.goto(BASE + urlUU(UU13), { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { level: 1 }).filter({ hasText: "Ketenagakerjaan" }).waitFor();
      expect(await page.locator(".pasal").count()).toBeGreaterThan(0);
      await page.locator(".toast", { hasText: "salinan" }).waitFor();
      expect(await page.locator(".meta-baris .lencana-luring").isVisible()).toBe(true);

      await page.goto(BASE + urlUU("/akn/id/act/uu/2020/11"), { waitUntil: "domcontentloaded" });
      await page.locator(".galat", { hasText: "luring" }).waitFor();
      expect(await page.locator(".pasal").count()).toBe(0);

      // Kembali daring: simpanan diperbarui oleh jawaban jaringan, lalu dihapus dari lembar Lainnya.
      await setLuring(ctx, false);
      await page.goto(BASE + urlUU(UU13), { waitUntil: "networkidle" });
      await page.locator(".pasal").first().waitFor();
      await page.locator(".tombol-lainnya").tap();
      await page.locator("dialog.lembar-aksi .aksi-baris", { hasText: "Hapus dari simpanan luring" }).tap();
      await page.locator(".toast", { hasText: "Dihapus dari simpanan luring" }).waitFor();
      expect(await page.evaluate(async () => (await (await caches.open("lexa-simpan-v1")).keys()).length)).toBe(0);
    });
  });

  it("navigasi luring sebelum aplikasi pernah terpasang tidak berakhir pada halaman galat peramban", async () => {
    await dengan({ serviceWorkers: "allow", luring: true }, async (ctx, page) => {
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      await tungguSW(page);
      await setLuring(ctx, true);
      // Tidak ada kunjungan terkendali sebelumnya, tetapi cangkang sudah di-precache saat install.
      await page.goto(BASE + "/tentang", { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { level: 1, name: "Tentang Lexa" }).waitFor();
    });
  });

  it("versi baru yang mengambil alih halaman terbuka ditawarkan lewat tombol Muat ulang, bukan dipaksa", async () => {
    await dengan({ serviceWorkers: "allow" }, async (_ctx, page) => {
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      await tungguSW(page);
      await page.reload({ waitUntil: "networkidle" }); // kini halaman sudah dikendalikan sejak awal
      await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event("controllerchange")));
      const toast = page.locator(".toast", { hasText: "versi baru" });
      await toast.waitFor();
      expect(await toast.locator("button").textContent()).toBe("Muat ulang");
    });
  });

  it("pemasangan pertama (belum ada pengendali sebelumnya) tidak memunculkan pemberitahuan versi baru", async () => {
    await dengan({ serviceWorkers: "allow" }, async (_ctx, page) => {
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      await tungguSW(page);
      await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event("controllerchange")));
      await page.waitForTimeout(300);
      expect(await page.locator(".toast", { hasText: "versi baru" }).count()).toBe(0);
    });
  });

  it("pita luring tampil saat jaringan putus dan hilang saat pulih (tanpa service worker pun)", async () => {
    await dengan({ luring: true }, async (ctx, page) => {
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      expect(await page.locator(".pita-luring").isVisible()).toBe(false);
      await setLuring(ctx, true);
      await page.locator(".pita-luring").waitFor({ state: "visible" });
      await setLuring(ctx, false);
      await page.locator(".pita-luring").waitFor({ state: "hidden" });
    });
  });
});

describe("ajakan memasang ke layar utama", () => {
  it("Android/Chrome: spanduk muncul saat peramban menawarkan pemasangan, tombol Pasang memicu dialog bawaan", async () => {
    await dengan(PONSEL, async (_ctx, page) => {
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      expect(await page.locator(".ajakan-pasang").isVisible()).toBe(false);
      await tawarkanPasang(page);
      await page.locator(".ajakan-pasang").waitFor({ state: "visible" });
      await page.getByRole("button", { name: "Pasang", exact: true }).click();
      expect(await page.evaluate(() => window.__prompt)).toBe(1);
      await page.locator(".ajakan-pasang").waitFor({ state: "hidden" });
    });
  });

  it("'Nanti' menyembunyikan spanduk dan tidak menanyakan lagi pada kunjungan berikutnya", async () => {
    await dengan(PONSEL, async (_ctx, page) => {
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      await tawarkanPasang(page);
      await page.getByRole("button", { name: "Nanti" }).click();
      await page.locator(".ajakan-pasang").waitFor({ state: "hidden" });
      await page.reload({ waitUntil: "networkidle" });
      await tawarkanPasang(page);
      await page.waitForTimeout(250);
      expect(await page.locator(".ajakan-pasang").isVisible()).toBe(false);
    });
  });

  it("menolak dialog pasang bawaan juga menunda spanduk", async () => {
    await dengan(PONSEL, async (_ctx, page) => {
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      await tawarkanPasang(page, "dismissed");
      await page.getByRole("button", { name: "Pasang", exact: true }).click();
      await page.locator(".ajakan-pasang").waitFor({ state: "hidden" });
      expect(await page.evaluate(() => localStorage.getItem("lexa:pasang:tunda"))).toMatch(/^\d+$/);
    });
  });

  it("iOS Safari: tidak ada tombol Pasang, melainkan langkah Bagikan > Tambahkan ke Layar Utama", async () => {
    await dengan({ userAgent: UA_IPHONE, viewport: VIEWPORT_IPHONE, deviceScaleFactor: DPR_IPHONE, hasTouch: true, isMobile: true }, async (_ctx, page) => {
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      const spanduk = page.locator(".ajakan-pasang");
      await spanduk.waitFor({ state: "visible" });
      expect(await spanduk.locator(".langkah-ios li").allTextContents()).toEqual([expect.stringContaining("Bagikan"), expect.stringContaining("Tambahkan ke Layar Utama")]);
      expect(await spanduk.getByRole("button", { name: "Pasang", exact: true }).count()).toBe(0);
    });
  });

  it("sudah dibuka dari layar utama (standalone): tidak ada spanduk, dan muncul tombol kembali di halaman dalam", async () => {
    await dengan(PONSEL, async (_ctx, page) => {
      await page.addInitScript(() => {
        const asli = window.matchMedia.bind(window);
        window.matchMedia = (q) =>
          q.includes("display-mode: standalone")
            ? /** @type {MediaQueryList} */ ({ matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })
            : asli(q);
      });
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      await tawarkanPasang(page);
      await page.waitForTimeout(250);
      expect(await page.locator(".ajakan-pasang").isVisible()).toBe(false);
      expect(await page.locator(".tombol-kembali").isVisible()).toBe(false); // halaman puncak

      await page.click(".nav-bawah a[href='/telusuri']");
      await page.locator(".daftar-hasil .hasil").first().waitFor();
      await page.locator(".daftar-hasil .hasil a").first().click();
      await page.locator(".tombol-kembali").waitFor({ state: "visible" });
      await page.click(".tombol-kembali");
      await page.waitForURL(/\/telusuri/);
      expect(await page.locator(".tombol-kembali").isVisible()).toBe(false);
    });
  });

  it("halaman Akun selalu menjelaskan cara memasang, juga setelah spanduk ditunda", async () => {
    await dengan(PONSEL, async (_ctx, page) => {
      await page.goto(BASE + "/akun", { waitUntil: "networkidle" });
      const kartu = page.locator(".kartu", { hasText: "Pasang di layar utama" });
      await kartu.waitFor();
      expect(await kartu.textContent()).toContain("Pasang aplikasi");
      await tawarkanPasang(page);
      await kartu.getByRole("button", { name: "Pasang Lexa" }).waitFor();
    });
  });
});

describe("tampilan ponsel", () => {
  it("bilah navigasi bawah melayang tepat di atas dasar layar, menandai halaman aktif, dan hamburger tidak ada", async () => {
    await dengan(PONSEL, async (_ctx, page) => {
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      const nav = page.locator(".nav-bawah");
      await nav.waitFor();
      const kotak = await nav.boundingBox();
      // Kapsul mengambang: tepinya 14 px di atas dasar layar (ditambah area aman, nol di peramban ini).
      expect(Math.round(kotak.y + kotak.height)).toBe(844 - 14);
      expect(await page.locator(".tombol-menu").isVisible()).toBe(false);
      expect(await nav.locator("a[aria-current=page]").textContent()).toContain("Cari");

      await nav.getByRole("link", { name: "Telusuri" }).click();
      await page.waitForURL(/\/telusuri/);
      expect(await nav.locator("a[aria-current=page]").textContent()).toContain("Telusuri");

      await page.goto(BASE + urlUU(UU13), { waitUntil: "networkidle" });
      expect(await nav.locator("a[aria-current=page]").textContent()).toContain("Telusuri"); // peraturan dianggap bagian dari Telusuri

      await nav.getByRole("link", { name: "Tanya" }).click();
      await page.waitForURL(/\/tanya/);
      expect(await nav.locator("a[aria-current=page]").textContent()).toContain("Tanya");
    });
  });

  it("sasaran ketuk memenuhi 44px dan teks tidak memicu zoom otomatis iOS (input >= 16px)", async () => {
    await dengan(PONSEL, async (_ctx, page) => {
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      for (const tab of await page.locator(".nav-bawah a").all()) {
        const kotak = await tab.boundingBox();
        expect(kotak.height, await tab.textContent()).toBeGreaterThanOrEqual(44);
        expect(kotak.width).toBeGreaterThanOrEqual(44);
      }
      const ukuranFont = await page.locator("main input[type=search]").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(ukuranFont).toBeGreaterThanOrEqual(16);
      await page.goto(BASE + "/tanya", { waitUntil: "networkidle" });
      expect(await page.locator("textarea").evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    });
  });

  it("bilah bawah menyingkir selama mengetik (papan ketik terbuka) dan kembali setelahnya", async () => {
    await dengan(PONSEL, async (_ctx, page) => {
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      const nav = page.locator(".nav-bawah");
      expect(await nav.isVisible()).toBe(true);
      await page.focus("main input[type=search]");
      await nav.waitFor({ state: "hidden" });
      await page.evaluate(() => /** @type {HTMLElement} */ (document.activeElement)?.blur());
      await nav.waitFor({ state: "visible" });
    });
  });

  it("konten terakhir tidak tertutup bilah bawah: footer dapat digulir sepenuhnya ke atas bilah", async () => {
    await dengan(PONSEL, async (_ctx, page) => {
      await page.goto(BASE + "/tentang", { waitUntil: "networkidle" });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const footer = await page.locator(".footer").boundingBox();
      const nav = await page.locator(".nav-bawah").boundingBox();
      // Dasar footer (termasuk bantalannya) berhenti di atas bilah, sehingga tautan terakhir bisa diketuk.
      const terakhir = await page.locator(".footer nav a").last().boundingBox();
      expect(terakhir.y + terakhir.height).toBeLessThanOrEqual(nav.y);
      expect(footer.y + footer.height).toBeGreaterThanOrEqual(nav.y);
    });
  });

  it("header ramping satu baris; kotak cari di header hanya di halaman yang tidak punya kotak cari sendiri", async () => {
    await dengan(PONSEL, async (_ctx, page) => {
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      expect(await page.locator(".header-cari").isVisible()).toBe(false);
      expect((await page.locator(".header").boundingBox()).height).toBeLessThanOrEqual(64);
      await page.goto(BASE + "/tentang", { waitUntil: "networkidle" });
      expect(await page.locator(".header-cari").isVisible()).toBe(true);
      expect((await page.locator(".header").boundingBox()).height).toBeLessThanOrEqual(64);
    });
  });

  it("filter di ponsel: lembar modal dari bawah, Esc menutup, mode dan filter aktif tampil sebagai chip yang bisa dilepas", async () => {
    await dengan(PONSEL, async (_ctx, page) => {
      await page.goto(BASE + "/cari?q=cipta+kerja&mode=keyword", { waitUntil: "networkidle" });
      await page.waitForSelector(".daftar-hasil .hasil");
      const lembar = page.locator("dialog.filter-isi");
      expect(await lembar.isVisible()).toBe(false);
      // Mode selain Otomatis tidak tersembunyi di dalam lembar: ia tampil sebagai chip.
      expect(await page.locator(".chip-filter").allTextContents()).toEqual(["Cara: Kata persis"]);

      await page.click(".filter-toggle");
      await lembar.waitFor({ state: "visible" });
      // Ukur setelah animasi naik selesai.
      await lembar.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      const kotak = await lembar.boundingBox();
      expect(Math.round(kotak.y + kotak.height)).toBe(844);
      expect(await lembar.evaluate((el) => el.matches(":modal"))).toBe(true);
      expect(await lembar.locator("input[name=mode-cari]").count()).toBe(3);
      expect(await page.getAttribute(".filter-toggle", "aria-expanded")).toBe("true");

      await page.keyboard.press("Escape");
      await lembar.waitFor({ state: "hidden" });
      // Peristiwa "close" dialog tiba satu giliran setelah dialog menghilang.
      await page.waitForFunction(() => document.querySelector(".filter-toggle")?.getAttribute("aria-expanded") === "false");

      // Klik pada latar di atas lembar juga menutupnya.
      await page.click(".filter-toggle");
      await lembar.waitFor({ state: "visible" });
      await page.mouse.click(195, 40);
      await lembar.waitFor({ state: "hidden" });

      await page.click(".filter-toggle");
      await page.check("input[name=status][value=dicabut]");
      await page.waitForFunction(() => location.search.includes("status=dicabut"));
      await page.click(".lembar-kaki .tombol");
      await lembar.waitFor({ state: "hidden" });
      expect(await page.locator(".chip-filter").allTextContents()).toEqual(["Cara: Kata persis", "Dicabut"]);
      expect(await page.textContent(".filter-toggle .lencana-jumlah")).toBe("2");

      // Melepas chip memperbarui hasil dan URL.
      await page.click("button[aria-label='Lepas filter Dicabut']");
      await page.waitForFunction(() => !location.search.includes("status="));
      await page.click("button[aria-label='Lepas filter Cara: Kata persis']");
      await page.waitForFunction(() => !location.search.includes("mode="));
      expect(await page.locator(".chip-filter").count()).toBe(0);
      expect(await page.isChecked("input[name=mode-cari][value=hybrid]")).toBe(true);
    });
  });

  it("status: 'Berlaku' menyusut menjadi titik hijau di kartu ponsel (tetap terbaca pembaca layar); 'Dicabut' tetap berteks", async () => {
    await dengan(PONSEL, async (_ctx, page) => {
      await page.goto(BASE + "/cari?q=pesangon&mode=keyword", { waitUntil: "networkidle" });
      await page.waitForSelector(".daftar-hasil .hasil");
      const berlaku = page.locator(".hasil .lencana-berlaku").first();
      expect(await berlaku.getAttribute("title")).toBe("Berlaku");
      expect((await berlaku.locator(".teks-status").boundingBox()).width).toBeLessThanOrEqual(1);
      expect(await berlaku.locator(".teks-status").textContent()).toBe("Berlaku");

      await page.goto(BASE + "/cari?q=cipta+kerja&mode=keyword&status=dicabut", { waitUntil: "networkidle" });
      await page.waitForSelector(".daftar-hasil .hasil");
      expect((await page.locator(".hasil .lencana-dicabut .teks-status").first().boundingBox()).width).toBeGreaterThan(30);
    });
  });

  it("Tanya: kotak tulis menempel tepat di atas bilah bawah, dan turun ke dasar layar saat papan ketik terbuka", async () => {
    await dengan(PONSEL, async (_ctx, page) => {
      await page.goto(BASE + "/tanya", { waitUntil: "networkidle" });
      const form = page.locator("form.form-tanya");
      const nav = page.locator(".nav-bawah");
      const kotakForm = await form.boundingBox();
      const kotakNav = await nav.boundingBox();
      expect(kotakForm.y + kotakForm.height).toBeLessThanOrEqual(kotakNav.y + 1);
      expect(kotakForm.y + kotakForm.height).toBeGreaterThanOrEqual(kotakNav.y - 24);
      // Tidak ada footer di halaman obrolan.
      expect(await page.locator(".footer").isVisible()).toBe(false);

      await page.focus("#pertanyaan");
      await nav.waitFor({ state: "hidden" });
      const fokus = await form.boundingBox();
      expect(fokus.y + fokus.height).toBeGreaterThan(844 - 24);
      expect(fokus.y + fokus.height).toBeLessThanOrEqual(844);
    });
  });

  it("Tanya: mengirim pertanyaan dari ponsel menampilkan jawaban dengan dasar hukum, kotak tulis tetap terjangkau", async () => {
    await dengan(PONSEL, async (_ctx, page) => {
      await page.goto(BASE + "/tanya", { waitUntil: "networkidle" });
      await page.fill("#pertanyaan", "Berapa lama cuti melahirkan?");
      await page.click("button.tombol-kirim");
      await page.waitForSelector(".gelembung.asisten .dasar-hukum");
      expect(await page.locator(".gelembung.pengguna").textContent()).toBe("Berapa lama cuti melahirkan?");
      expect(await page.locator("form.form-tanya").isVisible()).toBe(true);
    });
  });

  it("layar lebar memakai navigasi atas dan tanpa bilah bawah", async () => {
    await dengan({}, async (_ctx, page) => {
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      expect(await page.locator(".nav-bawah").isVisible()).toBe(false);
      expect(await page.locator("#nav-utama").isVisible()).toBe(true);
    });
  });

  it("lencana jumlah koleksi tampil di tab Koleksi setelah menyimpan peraturan", async () => {
    await dengan(PONSEL, async (_ctx, page) => {
      await page.goto(BASE + urlUU(UU13), { waitUntil: "networkidle" });
      expect(await page.locator(".nav-bawah .lencana-jumlah").isVisible()).toBe(false);
      await page.getByRole("button", { name: "Simpan", exact: true }).first().click();
      await page.locator(".nav-bawah .lencana-jumlah").waitFor({ state: "visible" });
      expect(await page.locator(".nav-bawah .lencana-jumlah").textContent()).toBe("1");
    });
  });

  it("tanpa gulir horizontal pada lebar 320px di halaman-halaman utama", async () => {
    await dengan({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true }, async (_ctx, page) => {
      for (const path of ["/", "/cari?q=pesangon", "/telusuri", urlUU(UU13), "/tanya", "/koleksi", "/akun", "/tentang", "/status"]) {
        await page.goto(BASE + path, { waitUntil: "networkidle" });
        expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(320);
      }
    });
  });
});
