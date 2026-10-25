/**
 * Penampil PDF (tab "PDF" di halaman peraturan) di Chromium sungguhan, dengan PDF.js asli dari public/vendor/pdfjs dan PDF
 * contoh yang dibangkitkan tes (e2e/pdf-contoh.mjs) lalu diunggah lewat PUT /api/impor/pdf seperti hasil panen BPK.
 *
 * Yang diuji: halaman tergambar (bukan kanvas kosong), lapisan teks, navigasi, zoom (tombol, cubitan dua jari, ketuk dua kali,
 * Ctrl + roda; titik yang dilihat tetap di tempatnya), pencarian di dalam PDF dan penandaannya, lembar "Pasal" dengan halaman dari
 * server yang DIPERIKSA terhadap teks PDF, "Lihat di PDF" pada pasal, layar penuh (termasuk tombol Kembali), halaman gelap, halaman
 * terakhir diingat, PDF hasil pindaian, PDF rusak, peraturan tanpa PDF, layar ponsel, dan bersihnya konsol dari galat/pelanggaran
 * CSP (strict: tanpa eval, tanpa WebAssembly, tanpa gaya sebaris).
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

/**
 * 12 halaman: Pasal 1 di halaman 1, Pasal 82 di 6, Pasal 156 di 9, dan penjelasan di 12 yang memakai ulang "Pasal 82". Pasal 77 dan 79
 * (yang ada di Lexa) sengaja tak ada di PDF-nya.
 */
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
  // 429 pada "Minta PDF ini" sengaja dipicu satu tes.
  pasangPengumpul(page, masalah, { izinkanStatus: ["/api/dokumen/minta"] });
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

const tabPdf = (uri = UU13, ekstra = "") => `${BASE}${urlUU(uri, `&tab=pdf${ekstra}`)}`;
const masukanHalaman = () => page.locator(".pdf-hal-input");
const halamanEl = (n) => page.locator(`.pdf-halaman[data-halaman="${n}"]`);

/** Kanvas halaman `n` berisi sesuatu selain putih polos (halaman benar-benar digambar). */
async function kanvasTerisi(n) {
  const kanvas = page.locator(`.pdf-halaman[data-halaman="${n}"] canvas`);
  await kanvas.waitFor({ timeout: 20_000 });
  return page.waitForFunction(
    (no) => {
      const c = document.querySelector(`.pdf-halaman[data-halaman="${no}"] canvas`);
      if (!c || !c.width) return false;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 200 && d[i + 3] > 0) return true;
      return false;
    },
    n,
    { timeout: 20_000 },
  );
}

/** Buka tab PDF dan tunggu sampai `jumlah` halaman terdaftar dan halaman pertama tergambar. */
async function bukaPdf(jumlah = 12, uri = UU13, ekstra = "") {
  await page.goto(tabPdf(uri, ekstra), { waitUntil: "networkidle" });
  await page.locator(".pdf-hal-total", { hasText: `/ ${jumlah}` }).waitFor({ timeout: 20_000 });
}

/** Jarak puncak halaman `n` dari puncak penggulir (piksel). */
const jarakPuncak = (n) =>
  page.evaluate((no) => {
    const g = document.querySelector(".pdf-gulir").getBoundingClientRect();
    return document.querySelector(`.pdf-halaman[data-halaman="${no}"]`).getBoundingClientRect().top - g.top;
  }, n);

/** Lebar halaman yang sebenarnya (tak ikut diskalakan oleh cubitan yang sedang berlangsung, yang hanya transform CSS). */
const lebarHalaman = (n = 1) => halamanEl(n).evaluate((el) => el.offsetWidth);

/** Buka menu "⋯" lalu pilih barisnya. */
async function pilihDiMenu(nama) {
  await page.getByRole("button", { name: "Menu PDF" }).click();
  await page.locator("dialog.lembar-aksi").getByText(nama, { exact: true }).click();
}

describe("tab PDF", () => {
  it("menampilkan PDF yang diarsipkan: jumlah halaman, halaman pertama tergambar, dan teksnya bisa dipilih", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await bukaPdf();
    await kanvasTerisi(1);
    expect(await page.locator(".pdf-halaman").count()).toBe(12);
    // Lapisan teks PDF.js: teksnya ada di DOM (untuk memilih, menyalin, dan pembaca layar) walau tak terlihat.
    await page.locator('.pdf-halaman[data-halaman="1"] .textLayer span', { hasText: "UNDANG-UNDANG CONTOH" }).waitFor();
    expect(await masukanHalaman().inputValue()).toBe("1");
    expect(await page.locator('[role="tab"][aria-selected="true"]').textContent()).toBe("PDF");
  });

  it("penampil mengisi layar di bawah tab yang lengket: halaman web digulir sampai bilah alatnya terlihat di bawah tab", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await bukaPdf();
    await kanvasTerisi(1);
    await page.waitForFunction(() => window.scrollY > 100, null, { timeout: 5000 });
    const { tab, penampil, tinggiLayar } = await page.evaluate(() => ({
      tab: document.querySelector(".tab-daftar").getBoundingClientRect(),
      penampil: document.querySelector(".penampil-pdf").getBoundingClientRect(),
      tinggiLayar: window.innerHeight,
    }));
    expect(penampil.top - tab.bottom).toBeLessThanOrEqual(10);
    expect(penampil.top).toBeGreaterThanOrEqual(tab.bottom - 1);
    // Seluruh penampil, bukan hanya bilah alatnya, ada di dalam layar.
    expect(penampil.bottom).toBeLessThanOrEqual(tinggiLayar + 1);
  });

  it("menu: Unduh PDF memakai nama berkas, Buka di tab baru menunjuk ke PDF-nya", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await bukaPdf();
    await page.getByRole("button", { name: "Menu PDF" }).click();
    const unduh = page.locator("dialog.lembar-aksi a", { hasText: "Unduh PDF" });
    expect(await unduh.getAttribute("href")).toBe(`/api/dokumen/pdf?uri=${encodeURIComponent(UU13)}`);
    expect(await unduh.getAttribute("download")).toBe("UU 13-2003.pdf");
    const baru = page.locator("dialog.lembar-aksi a", { hasText: "Buka di tab baru" });
    expect(await baru.getAttribute("href")).toBe(`/api/dokumen/pdf?uri=${encodeURIComponent(UU13)}`);
    expect(await baru.getAttribute("target")).toBe("_blank");
    // Di layar lebar zoom ada di bilah alat, bukan di menu.
    expect(await page.locator("dialog.lembar-aksi").getByText("Perbesar", { exact: true }).count()).toBe(0);
  });

  it("navigasi: ketik nomor halaman, tombol sebelum/berikut, dan halaman yang digulir menjadi halaman saat ini", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await bukaPdf();
    await masukanHalaman().fill("6");
    await masukanHalaman().press("Enter");
    await kanvasTerisi(6);
    expect(await masukanHalaman().inputValue()).toBe("6");
    // Halaman mendarat di puncak penggulir, tepat di bawah bilah alat: sedikit celah, tak tersembunyi, tak terlalu jauh.
    expect(Math.abs((await jarakPuncak(6)) - 6)).toBeLessThanOrEqual(2);

    await page.getByRole("button", { name: "Halaman berikutnya" }).click();
    expect(await masukanHalaman().inputValue()).toBe("7");
    await page.getByRole("button", { name: "Halaman sebelumnya" }).click();
    await page.getByRole("button", { name: "Halaman sebelumnya" }).click();
    expect(await masukanHalaman().inputValue()).toBe("5");

    // Di luar rentang dijepit; di halaman pertama tombol "sebelumnya" mati.
    await masukanHalaman().fill("99");
    await masukanHalaman().press("Enter");
    expect(await masukanHalaman().inputValue()).toBe("12");
    expect(await page.getByRole("button", { name: "Halaman berikutnya" }).isDisabled()).toBe(true);
    await masukanHalaman().fill("0");
    await masukanHalaman().press("Enter");
    expect(await masukanHalaman().inputValue()).toBe("1");
    expect(await page.getByRole("button", { name: "Halaman sebelumnya" }).isDisabled()).toBe(true);

    // Menggulir penggulir ke bawah mengganti halaman saat ini; tepi bawah halaman yang hampir lewat tak dihitung.
    await page.evaluate(() => {
      const g = document.querySelector(".pdf-gulir");
      g.scrollTop = document.querySelector('.pdf-halaman[data-halaman="4"]').offsetTop + 200;
    });
    await page.waitForFunction(() => document.querySelector(".pdf-hal-input").value === "4", null, { timeout: 5000 });
  });

  it("halaman terakhir pada naskah yang pendek tetap bisa dibuka (tak bisa digulir sampai puncak) dan tetap tercatat sebagai halaman saat ini", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await bukaPdf();
    await masukanHalaman().fill("12");
    await masukanHalaman().press("Enter");
    await kanvasTerisi(12);
    expect(await masukanHalaman().inputValue()).toBe("12");
    // Setelah itu gulir sendiri oleh pembaca kembali menentukan halaman saat ini.
    await page.evaluate(() => {
      const g = document.querySelector(".pdf-gulir");
      g.scrollTop = document.querySelector('.pdf-halaman[data-halaman="11"]').offsetTop;
    });
    await page.waitForFunction(() => document.querySelector(".pdf-hal-input").value === "11", null, { timeout: 5000 });
  });

  it("zoom: perbesar melebarkan halaman, perkecil menyempitkannya, 'Pas lebar' mengembalikannya, dan tombol mati di batas", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await bukaPdf();
    await kanvasTerisi(1);
    const awal = await lebarHalaman();
    expect(awal).toBeGreaterThan(300);
    await page.getByRole("button", { name: "Perbesar" }).click();
    expect(await lebarHalaman()).toBeGreaterThan(awal * 1.2);
    expect(await page.locator(".pdf-zoom").textContent()).toBe("125%");
    await page.getByRole("button", { name: "Pas lebar" }).click();
    expect(await lebarHalaman()).toBeCloseTo(awal, 0);
    for (let i = 0; i < 8; i++) await page.getByRole("button", { name: "Perkecil" }).click({ force: true });
    expect(await page.getByRole("button", { name: "Perkecil" }).isDisabled()).toBe(true);
    expect(await page.locator(".pdf-zoom").textContent()).toBe("50%");
    // Setelah diperbesar lagi, halaman digambar ulang dengan tajam (kanvasnya selebar halamannya).
    await page.getByRole("button", { name: "Pas lebar" }).click();
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Perbesar" }).click();
    await page.waitForFunction(
      () => {
        const c = document.querySelector('.pdf-halaman[data-halaman="1"] canvas');
        return c && c.width >= document.querySelector('.pdf-halaman[data-halaman="1"]').getBoundingClientRect().width;
      },
      null,
      { timeout: 15_000 },
    );
    // Batas atas: tombol "Perbesar" mati.
    for (let i = 0; i < 8; i++) await page.getByRole("button", { name: "Perbesar" }).click({ force: true });
    expect(await page.getByRole("button", { name: "Perbesar" }).isDisabled()).toBe(true);
    expect(await page.locator(".pdf-zoom").textContent()).toBe("400%");
  });

  it("zoom mempertahankan titik yang sedang dilihat: halaman dan letak di dalamnya tak bergeser walau halaman di atasnya ikut membesar", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await bukaPdf();
    await masukanHalaman().fill("8");
    await masukanHalaman().press("Enter");
    await kanvasTerisi(8);
    // Pusat penggulir berada di halaman 8; catat letaknya (pecahan tinggi halaman) sebelum dan sesudah diperbesar.
    const pecahan = () =>
      page.evaluate(() => {
        const g = document.querySelector(".pdf-gulir").getBoundingClientRect();
        const tengah = g.top + g.height / 2;
        for (const el of document.querySelectorAll(".pdf-halaman")) {
          const k = el.getBoundingClientRect();
          if (tengah >= k.top && tengah <= k.bottom) return { no: Number(el.dataset.halaman), pecahan: (tengah - k.top) / k.height };
        }
        return null;
      });
    const sebelum = await pecahan();
    expect(sebelum.no).toBe(8);
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Perbesar" }).click();
    const sesudah = await pecahan();
    expect(sesudah.no).toBe(8);
    expect(Math.abs(sesudah.pecahan - sebelum.pecahan)).toBeLessThan(0.02);
    expect(await masukanHalaman().inputValue()).toBe("8");
  });

  it("Ctrl + roda (cubitan di trackpad) memperbesar dengan titik penunjuk tetap di tempatnya, lalu halaman digambar ulang", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await bukaPdf();
    await kanvasTerisi(1);
    const awal = await lebarHalaman();
    const kotak = await page.locator(".pdf-gulir").boundingBox();
    await page.mouse.move(kotak.x + kotak.width / 2, kotak.y + 200);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -250);
    await page.keyboard.up("Control");
    // offsetWidth: ukuran sebenarnya (selama roda berputar, halaman hanya diskalakan lewat transform CSS).
    await page.waitForFunction((a) => document.querySelector('.pdf-halaman[data-halaman="1"]').offsetWidth > a * 1.3, awal, { timeout: 5000 });
    expect(Number((await page.locator(".pdf-zoom").textContent()).replace("%", ""))).toBeGreaterThan(130);
    // Roda biasa (tanpa Ctrl) tetap menggulir, bukan memperbesar.
    const zoom = await page.locator(".pdf-zoom").textContent();
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(300);
    expect(await page.locator(".pdf-zoom").textContent()).toBe(zoom);
    expect(await page.locator(".pdf-gulir").evaluate((g) => g.scrollTop)).toBeGreaterThan(100);
  });

  it("halaman jauh dari layar tak digambar, yang dilewati dilepas: memori ponsel terjaga pada naskah panjang", async () => {
    const panjang = Array.from({ length: 60 }, (_, i) => [`Halaman isi ${i + 1}`, "Teks pengisi."]);
    await unggah(UU13, buatPdf(panjang));
    await bukaPdf(60);
    await kanvasTerisi(1);
    expect(await page.locator(".pdf-halaman canvas").count()).toBeLessThan(8);
    await masukanHalaman().fill("50");
    await masukanHalaman().press("Enter");
    await kanvasTerisi(50);
    await page.waitForFunction(() => !document.querySelector('.pdf-halaman[data-halaman="1"] canvas'), null, { timeout: 10_000 });
    expect(await page.locator(".pdf-halaman canvas").count()).toBeLessThan(8);
  });

  it("halaman berukuran lain (lanskap) diskalakan ke lebar yang sama; halaman di atas layar yang berubah tinggi tak menggeser yang dibaca", async () => {
    // Halaman 1-2 potret, halaman 3 lanskap, halaman 4 potret.
    const campur = buatPdf([["Halaman 1"], ["Halaman 2"], ["Halaman 3 lanskap"], ["Halaman 4"]], { ukuran: [undefined, undefined, [842, 595]] });
    await unggah(UU13, campur);
    await bukaPdf(4);
    await kanvasTerisi(1);
    const ukuran = (n) => halamanEl(n).evaluate((el) => ({ l: el.offsetWidth, t: el.offsetHeight }));
    // Sebelum halaman 3 digambar, ia dianggap seukuran halaman pertama.
    expect((await ukuran(3)).t).toBe((await ukuran(1)).t);
    await masukanHalaman().fill("3");
    await masukanHalaman().press("Enter");
    await kanvasTerisi(3);
    const potret = await ukuran(1);
    const lanskap = await ukuran(3);
    expect(lanskap.l).toBe(potret.l);
    expect(lanskap.t).toBeCloseTo((potret.l * 595) / 842, -1);
    // Halaman 3 sudah di puncak penggulir dan tetap di sana setelah ukurannya dikoreksi; halaman 4 menyambung di bawahnya.
    expect(Math.abs((await jarakPuncak(3)) - 6)).toBeLessThanOrEqual(2);
    await masukanHalaman().fill("4");
    await masukanHalaman().press("Enter");
    await kanvasTerisi(4);
    expect(Math.abs((await jarakPuncak(4)) - 6)).toBeLessThanOrEqual(2);
    // Menggulir kembali ke halaman 1 lalu melompat ke 4 tak meninggalkan celah: tinggi halaman yang sudah dikoreksi tetap.
    expect((await ukuran(3)).t).toBe(lanskap.t);
  });
});

describe("zoom dengan sentuhan (ponsel)", () => {
  const ponsel = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  let cdp;

  beforeEach(async () => {
    await ctx.close();
    await bukaKonteks(ponsel);
    cdp = await ctx.newCDPSession(page);
  });

  const sentuh = (tipe, titik) => cdp.send("Input.dispatchTouchEvent", { type: tipe, touchPoints: titik.map(([x, y], id) => ({ x, y, id })) });

  it("cubitan dua jari memperbesar selama bergerak (hanya skala CSS), lalu halaman digambar ulang di ukuran barunya dan titik di antara jari tetap di tempatnya", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await bukaPdf();
    await kanvasTerisi(1);
    const awal = await lebarHalaman();
    const gulirAwal = await page.locator(".pdf-gulir").evaluate((g) => g.getBoundingClientRect());
    const y = gulirAwal.top + 250;
    await sentuh("touchStart", [[150, y], [240, y]]);
    await sentuh("touchMove", [[120, y], [270, y]]);
    await sentuh("touchMove", [[90, y], [300, y]]);
    // Selama cubitan: isi diskalakan lewat CSS, ukuran sebenarnya halaman belum berubah.
    expect(await page.locator(".pdf-lapis").evaluate((el) => el.style.transform)).toContain("scale(");
    expect(await lebarHalaman()).toBeCloseTo(awal, 0);
    await sentuh("touchEnd", []);
    await page.waitForFunction((a) => document.querySelector('.pdf-halaman[data-halaman="1"]').getBoundingClientRect().width > a * 1.8, awal, { timeout: 5000 });
    expect(await page.locator(".pdf-lapis").evaluate((el) => el.style.transform)).toBe("");
    // Digambar ulang di ukuran baru: kanvasnya setajam halamannya.
    await page.waitForFunction(
      () => {
        const c = document.querySelector('.pdf-halaman[data-halaman="1"] canvas');
        return c && c.width >= document.querySelector('.pdf-halaman[data-halaman="1"]').getBoundingClientRect().width;
      },
      null,
      { timeout: 15_000 },
    );
  });

  it("cubitan dijepit di batas zoom, dan cubitan perkecil tak membuat halaman lebih sempit dari batas", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await bukaPdf();
    await kanvasTerisi(1);
    const awal = await lebarHalaman();
    const y = 400;
    await sentuh("touchStart", [[195, y - 5], [195, y + 5]]);
    await sentuh("touchMove", [[195, y - 400], [195, y + 400]]);
    await sentuh("touchEnd", []);
    await page.waitForFunction((a) => document.querySelector('.pdf-halaman[data-halaman="1"]').getBoundingClientRect().width > a * 3.9, awal, { timeout: 5000 });
    expect(await lebarHalaman()).toBeLessThanOrEqual(awal * 4 + 2);
    await sentuh("touchStart", [[100, y], [290, y]]);
    await sentuh("touchMove", [[194, y], [196, y]]);
    await sentuh("touchEnd", []);
    await page.waitForFunction((a) => document.querySelector('.pdf-halaman[data-halaman="1"]').getBoundingClientRect().width < a * 0.6, awal, { timeout: 5000 });
    expect(await lebarHalaman()).toBeGreaterThanOrEqual(awal * 0.5 - 2);
  });

  it("ketuk dua kali memperbesar dua kali lipat di titik yang diketuk; ketuk dua kali lagi kembali ke pas lebar", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await bukaPdf();
    await kanvasTerisi(1);
    const awal = await lebarHalaman();
    const kotak = await page.locator(".pdf-gulir").boundingBox();
    const x = kotak.x + kotak.width / 2;
    const y = kotak.y + 200;
    await page.touchscreen.tap(x, y);
    await page.touchscreen.tap(x, y);
    await page.waitForFunction((a) => document.querySelector('.pdf-halaman[data-halaman="1"]').getBoundingClientRect().width > a * 1.9, awal, { timeout: 5000 });
    await page.waitForTimeout(450);
    await page.touchscreen.tap(x, y);
    await page.touchscreen.tap(x, y);
    await page.waitForFunction((a) => Math.abs(document.querySelector('.pdf-halaman[data-halaman="1"]').getBoundingClientRect().width - a) < 2, awal, { timeout: 5000 });
  });

  it("satu ketukan atau gulir satu jari tak mengubah zoom; menggulir tetap berjalan", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await bukaPdf();
    await kanvasTerisi(1);
    const awal = await lebarHalaman();
    const kotak = await page.locator(".pdf-gulir").boundingBox();
    await page.touchscreen.tap(kotak.x + 100, kotak.y + 300);
    await page.waitForTimeout(500);
    expect(await lebarHalaman()).toBeCloseTo(awal, 0);
    await sentuh("touchStart", [[200, 600]]);
    for (let i = 1; i <= 6; i++) await sentuh("touchMove", [[200, 600 - i * 60]]);
    await sentuh("touchEnd", []);
    await page.waitForFunction(() => document.querySelector(".pdf-gulir").scrollTop > 100, null, { timeout: 5000 });
    expect(await lebarHalaman()).toBeCloseTo(awal, 0);
  });
});

describe("cari di PDF", () => {
  /** "alpha" di halaman 2 dan 9, "satu" dan "dua" berurutan di dua baris halaman 4. */
  function naskahCari() {
    const halaman = Array.from({ length: 12 }, (_, i) => [`Halaman isi ${i + 1}`, "Teks pengisi."]);
    halaman[1] = ["Pasal 2", "Kata alpha di halaman dua."];
    halaman[3] = ["Pasal 3", "Tanggal satu", "kata dua berikutnya."];
    halaman[8] = ["Pasal 9", "ALPHA di halaman sembilan."];
    return halaman;
  }
  const hitung = () => page.locator(".pdf-cari-hitung");
  const kotakCari = () => page.locator(".pdf-cari-input");
  const sorotan = (nama) =>
    page.evaluate((n) => {
      const h = CSS.highlights.get(n);
      return h ? [...h].map((r) => r.toString()) : [];
    }, nama);

  async function cari(kueri) {
    await page.getByRole("button", { name: "Cari di PDF" }).click();
    await kotakCari().fill(kueri);
  }

  it("Ctrl+F di penampil membuka pencarian PDF (bukan pencarian peramban) dan Esc menutupnya", async () => {
    await unggah(UU13, buatPdf(naskahCari()));
    await bukaPdf();
    await page.locator(".pdf-gulir").focus();
    await page.keyboard.press("Control+f");
    await page.locator(".pdf-cari").waitFor({ state: "visible" });
    expect(await page.evaluate(() => document.activeElement?.classList.contains("pdf-cari-input"))).toBe(true);
    await page.keyboard.press("Escape");
    await page.locator(".pdf-cari").waitFor({ state: "hidden" });
    expect(await page.getByRole("button", { name: "Cari di PDF" }).getAttribute("aria-expanded")).toBe("false");
    // Fokus kembali ke penggulir supaya tombol panah dan PageUp tetap menggulir.
    expect(await page.evaluate(() => document.activeElement?.classList.contains("pdf-gulir"))).toBe(true);
  });

  it("menemukan semua kecocokan, tak peduli huruf besar-kecil, membuka yang pertama, dan menandainya di halaman", async () => {
    await unggah(UU13, buatPdf(naskahCari()));
    await bukaPdf();
    await cari("alpha");
    await page.waitForFunction(() => document.querySelector(".pdf-cari-hitung")?.textContent === "1 / 2", null, { timeout: 15_000 });
    expect(await masukanHalaman().inputValue()).toBe("2");
    await kanvasTerisi(2);
    await page.waitForFunction(() => (CSS.highlights.get("pdf-cari-aktif")?.size ?? 0) === 1, null, { timeout: 5000 });
    expect(await sorotan("pdf-cari-aktif")).toEqual(["alpha"]);
    // Kecocokan yang aktif terlihat di layar, bukan tersembunyi di bawah bilah alat.
    const { atas, bawah, tinggiGulir } = await page.evaluate(() => {
      const g = document.querySelector(".pdf-gulir").getBoundingClientRect();
      const span = [...document.querySelectorAll('.pdf-halaman[data-halaman="2"] .textLayer span')].find((s) => s.textContent.includes("alpha"));
      const k = span.getBoundingClientRect();
      return { atas: k.top - g.top, bawah: g.bottom - k.bottom, tinggiGulir: g.height };
    });
    expect(atas).toBeGreaterThan(0);
    expect(bawah).toBeGreaterThan(0);
    expect(tinggiGulir).toBeGreaterThan(300);
  });

  it("Enter dan tombol maju/mundur berpindah antar hasil (melingkar), Shift+Enter mundur; halaman saat ini mengikuti", async () => {
    await unggah(UU13, buatPdf(naskahCari()));
    await bukaPdf();
    await cari("alpha");
    await page.waitForFunction(() => document.querySelector(".pdf-cari-hitung")?.textContent === "1 / 2", null, { timeout: 15_000 });
    await kotakCari().press("Enter");
    expect(await hitung().textContent()).toBe("2 / 2");
    await page.waitForFunction(() => document.querySelector(".pdf-hal-input").value === "9", null, { timeout: 5000 });
    await kanvasTerisi(9);
    await page.waitForFunction(() => (CSS.highlights.get("pdf-cari-aktif")?.size ?? 0) === 1, null, { timeout: 5000 });
    expect(await sorotan("pdf-cari-aktif")).toEqual(["ALPHA"]);
    await kotakCari().press("Enter");
    expect(await hitung().textContent()).toBe("1 / 2");
    await kotakCari().press("Shift+Enter");
    expect(await hitung().textContent()).toBe("2 / 2");
    await page.getByRole("button", { name: "Hasil sebelumnya" }).click();
    expect(await hitung().textContent()).toBe("1 / 2");
    await page.getByRole("button", { name: "Hasil berikutnya" }).click();
    expect(await hitung().textContent()).toBe("2 / 2");
  });

  it("mencari dari halaman yang sedang dibaca: hasil pertama pada atau sesudahnya yang dibuka lebih dulu, bukan yang pertama di naskah", async () => {
    await unggah(UU13, buatPdf(naskahCari()));
    await bukaPdf();
    await masukanHalaman().fill("5");
    await masukanHalaman().press("Enter");
    await cari("alpha");
    await page.waitForFunction(() => document.querySelector(".pdf-cari-hitung")?.textContent === "2 / 2", null, { timeout: 15_000 });
    expect(await masukanHalaman().inputValue()).toBe("9");
  });

  it("frasa yang terpotong baris tetap ditemukan, dan penandanya mencakup kedua baris", async () => {
    await unggah(UU13, buatPdf(naskahCari()));
    await bukaPdf();
    await cari("satu kata dua");
    await page.waitForFunction(() => document.querySelector(".pdf-cari-hitung")?.textContent === "1 / 1", null, { timeout: 15_000 });
    expect(await masukanHalaman().inputValue()).toBe("4");
    await kanvasTerisi(4);
    await page.waitForFunction(() => (CSS.highlights.get("pdf-cari-aktif")?.size ?? 0) === 1, null, { timeout: 5000 });
    const [teks] = await sorotan("pdf-cari-aktif");
    expect(teks).toContain("satu");
    expect(teks).toContain("kata dua");
  });

  it("tak ada hasil, kueri terlalu pendek, dan kueri kosong dikatakan dengan jelas; menutup membersihkan penanda", async () => {
    await unggah(UU13, buatPdf(naskahCari()));
    await bukaPdf();
    await cari("zzzzqqq");
    await page.waitForFunction(() => document.querySelector(".pdf-cari-hitung")?.textContent === "Tidak ditemukan", null, { timeout: 15_000 });
    expect(await page.getByRole("button", { name: "Hasil berikutnya" }).isDisabled()).toBe(true);
    await kotakCari().fill("a");
    await page.waitForFunction(() => document.querySelector(".pdf-cari-hitung")?.textContent === "Ketik minimal 2 huruf", null, { timeout: 5000 });
    await kotakCari().fill("");
    await page.waitForFunction(() => document.querySelector(".pdf-cari-hitung")?.textContent === "", null, { timeout: 5000 });
    await kotakCari().fill("alpha");
    await page.waitForFunction(() => (CSS.highlights.get("pdf-cari-aktif")?.size ?? 0) === 1, null, { timeout: 15_000 });
    await page.getByRole("button", { name: "Tutup pencarian" }).click();
    expect(await sorotan("pdf-cari-aktif")).toEqual([]);
    expect(await sorotan("pdf-cari")).toEqual([]);
  });

  it("mengetik kueri baru mengganti hasil lama: hasil akhir hanya milik kueri terakhir", async () => {
    await unggah(UU13, buatPdf(naskahCari()));
    await bukaPdf();
    await page.getByRole("button", { name: "Cari di PDF" }).click();
    await kotakCari().pressSequentially("teks pengisi", { delay: 5 });
    await kotakCari().fill("alpha");
    await page.waitForFunction(() => document.querySelector(".pdf-cari-hitung")?.textContent === "1 / 2", null, { timeout: 15_000 });
    await page.waitForTimeout(800);
    expect(await hitung().textContent()).toBe("1 / 2");
  });

  it("diperbesar saat ada hasil: penanda dipasang ulang pada lapisan teks yang baru", async () => {
    await unggah(UU13, buatPdf(naskahCari()));
    await bukaPdf();
    await cari("alpha");
    await page.waitForFunction(() => (CSS.highlights.get("pdf-cari-aktif")?.size ?? 0) === 1, null, { timeout: 15_000 });
    await page.getByRole("button", { name: "Perbesar" }).click();
    await page.getByRole("button", { name: "Perbesar" }).click();
    await page.waitForFunction(
      () => {
        const h = CSS.highlights.get("pdf-cari-aktif");
        if (!h || h.size !== 1) return false;
        const r = [...h][0];
        return r.startContainer.isConnected && r.toString() === "alpha";
      },
      null,
      { timeout: 15_000 },
    );
  });

  it("PDF hasil pindaian: dikatakan terus terang bahwa isinya tak bisa dicari", async () => {
    await unggah(UU13, buatPdf(naskahCari(), { tanpaTeks: true }));
    await bukaPdf();
    await cari("alpha");
    await page.waitForFunction(() => document.querySelector(".pdf-cari-hitung")?.textContent === "PDF ini hasil pindaian: isinya tak bisa dicari.", null, { timeout: 15_000 });
  });
});

describe("lembar Pasal dan lompat ke pasal", () => {
  const bukaLembarPasal = async () => {
    await page.getByRole("button", { name: "Pasal", exact: true }).click();
    await page.locator("dialog.lembar-pasal-pdf").waitFor({ state: "visible" });
  };

  it("daftar menurut BAB memuat nomor halaman dari server; memilih pasal membuka halamannya, terbukti dari teks PDF", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await bukaPdf();
    await bukaLembarPasal();
    const ringkas = (await page.locator("dialog.lembar-pasal-pdf .rentang-pasal").allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
    expect(ringkas).toEqual(["Pasal 1 · hal. 1", "Pasal 77–82 · hal. 3–6", "Pasal 156 · hal. 9"]);
    await page.locator("dialog.lembar-pasal-pdf details.grup-bab summary", { hasText: "Bab XII" }).click();
    const chip = page.locator("dialog.lembar-pasal-pdf button.chip-pasal", { hasText: "156" });
    expect(await chip.getAttribute("aria-label")).toBe("Pasal 156, halaman 9");
    await chip.click();
    await page.locator("dialog.lembar-pasal-pdf").waitFor({ state: "detached" });
    await page.waitForFunction(() => document.querySelector(".pdf-hal-input")?.value === "9", null, { timeout: 20_000 });
    await kanvasTerisi(9);
    await page.locator(".toast", { hasText: "Pasal 156 dimulai di halaman 9 PDF." }).waitFor();
  });

  it("ketik nomor pasal: halaman dari server dipakai bila judulnya memang tampak di sana", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await bukaPdf();
    await bukaLembarPasal();
    await page.locator("#pdf-lompat-nomor").fill("Pasal 82");
    await page.getByRole("button", { name: "Buka", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".pdf-hal-input")?.value === "6", null, { timeout: 20_000 });
    await page.locator(".toast", { hasText: "Pasal 82 dimulai di halaman 6 PDF." }).waitFor();
  });

  it("halaman dari server meleset satu halaman: dikoreksi oleh teks PDF (judul di halaman berikutnya)", async () => {
    // Pasal 156 di halaman 10, padahal server mengatakan 9.
    const geser = naskah();
    geser[8] = ["Halaman isi 9", "Teks pengisi."];
    geser[9] = ["Pasal 156", "Dalam hal terjadi pemutusan hubungan kerja."];
    await unggah(UU13, buatPdf(geser));
    await bukaPdf();
    await bukaLembarPasal();
    await page.locator("#pdf-lompat-nomor").fill("156");
    await page.getByRole("button", { name: "Buka", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".pdf-hal-input")?.value === "10", null, { timeout: 20_000 });
    await page.locator(".toast", { hasText: "Pasal 156 dimulai di halaman 10 PDF." }).waitFor();
  });

  it("halaman dari server jauh meleset: dicari di teks PDF dari awal", async () => {
    const jauh = naskah();
    jauh[8] = ["Halaman isi 9", "Teks pengisi."];
    jauh[10] = ["Pasal 156", "Dalam hal terjadi pemutusan hubungan kerja."];
    await unggah(UU13, buatPdf(jauh));
    await bukaPdf();
    await bukaLembarPasal();
    await page.locator("#pdf-lompat-nomor").fill("156");
    await page.getByRole("button", { name: "Buka", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".pdf-hal-input")?.value === "11", null, { timeout: 20_000 });
    await page.locator(".toast", { hasText: "Pasal 156 dimulai di halaman 11 PDF." }).waitFor();
  });

  it("pasal yang tak ada di Lexa tetap dicari di teks PDF (mungkin terlewat oleh ekstraksi)", async () => {
    const lengkap = naskah();
    lengkap[4] = ["Pasal 45A", "Isi pasal sisipan."];
    await unggah(UU13, buatPdf(lengkap));
    await bukaPdf();
    await bukaLembarPasal();
    await page.locator("#pdf-lompat-nomor").fill("45a");
    await page.getByRole("button", { name: "Buka", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".pdf-hal-input")?.value === "5", null, { timeout: 20_000 });
    await page.locator(".toast", { hasText: "Pasal 45A dimulai di halaman 5 PDF." }).waitFor();
  });

  it("judul pasal tak terbaca di PDF tetapi server menyebut halamannya: dibuka di sana dengan catatan, bukan menyatakan 'tidak ada'", async () => {
    // Pasal 77 ada di Lexa (halaman 3 menurut server) tetapi tak ada judulnya di PDF ini.
    await unggah(UU13, buatPdf(naskah()));
    await bukaPdf();
    await bukaLembarPasal();
    await page.locator("#pdf-lompat-nomor").fill("77");
    await page.getByRole("button", { name: "Buka", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".pdf-hal-input")?.value === "3", null, { timeout: 30_000 });
    await page.locator(".toast", { hasText: "Pasal 77 dibuka di halaman 3 menurut indeks Lexa; periksa judulnya di halaman itu." }).waitFor();
  });

  it("pasal yang tak ada di mana pun: dikatakan terus terang, PDF tetap di tempatnya", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await bukaPdf();
    await bukaLembarPasal();
    await page.locator("#pdf-lompat-nomor").fill("999");
    await page.getByRole("button", { name: "Buka", exact: true }).click();
    await page.locator(".toast", { hasText: "Pasal 999 tidak ditemukan di teks PDF" }).waitFor({ timeout: 30_000 });
    expect(await masukanHalaman().inputValue()).toBe("1");
  });

  it("PDF pindaian dengan halaman dari server: dibuka di halaman itu dengan catatan; tanpa halaman dari server: dikatakan tak bisa dicari", async () => {
    await unggah(UU13, buatPdf(naskah(), { tanpaTeks: true }));
    await bukaPdf();
    await bukaLembarPasal();
    await page.locator("#pdf-lompat-nomor").fill("156");
    await page.getByRole("button", { name: "Buka", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".pdf-hal-input")?.value === "9", null, { timeout: 20_000 });
    await page.locator(".toast", { hasText: "Pasal 156 dibuka di halaman 9 menurut indeks Lexa" }).waitFor();
    await bukaLembarPasal();
    await page.locator("#pdf-lompat-nomor").fill("888");
    await page.getByRole("button", { name: "Buka", exact: true }).click();
    await page.locator(".toast", { hasText: "hasil pindaian tanpa lapisan teks" }).waitFor({ timeout: 20_000 });
  });

  it("peraturan yang pasalnya belum tersimpan di Lexa: lembar tetap berguna (kolom nomor), tanpa daftar", async () => {
    const uri = "/akn/id/act/pp/2030/77";
    const manifest = await fetch(`${BASE}/api/impor/manifest`, {
      method: "POST",
      headers: { "x-admin-token": TOKEN, "content-type": "application/json" },
      body: JSON.stringify({ versi: 1, dokumen: [{ bpk_id: "7777", meta: { Judul: "Peraturan Pemerintah Nomor 77 Tahun 2030 tentang Contoh", "Bentuk Singkat": "PP", Nomor: "77", Tahun: "2030", Status: "Berlaku" } }] }),
    });
    expect(manifest.status).toBe(200);
    await unggah(uri, buatPdf(naskah()));
    await bukaPdf(12, uri);
    await bukaLembarPasal();
    expect(await page.locator("dialog.lembar-pasal-pdf").getByText("Lexa belum menyimpan pasal peraturan ini").count()).toBe(1);
    await page.locator("#pdf-lompat-nomor").fill("82");
    await page.getByRole("button", { name: "Buka", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".pdf-hal-input")?.value === "6", null, { timeout: 20_000 });
  });
});

describe("Lihat di PDF (pasal ke halaman)", () => {
  it("dari pasal di tab Isi: tab PDF terbuka tepat di halaman pasal itu", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await page.goto(`${BASE}${urlUU(UU13)}`, { waitUntil: "networkidle" });
    const pasal = page.locator("article.pasal", { hasText: "Pasal 156" });
    await pasal.hover();
    await pasal.locator("button.pasal-pdf").click();
    await page.locator('[role="tab"][aria-selected="true"]', { hasText: "PDF" }).waitFor();
    await page.waitForFunction(() => document.querySelector(".pdf-hal-input")?.value === "9", null, { timeout: 20_000 });
    await kanvasTerisi(9);
    await page.locator(".toast", { hasText: "Pasal 156 dimulai di halaman 9 PDF" }).waitFor();
    expect(Math.abs((await jarakPuncak(9)) - 6)).toBeLessThanOrEqual(3);
  });

  it("hasil pencarian: tautan 'hal. N' membuka tab PDF langsung di halaman pasal itu, dan alamatnya mencatat halaman itu", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await page.goto(`${BASE}/cari?q=pesangon`, { waitUntil: "networkidle" });
    await page.waitForSelector(".daftar-hasil .hasil");
    const kartu = page.locator(".hasil", { hasText: "Pasal 156" }).first();
    const tautan = kartu.locator("a.hasil-pdf");
    expect(await tautan.textContent()).toBe("hal. 9");
    expect(await tautan.getAttribute("aria-label")).toBe("Buka halaman 9 PDF");
    // Tautan kartu sendiri tetap menuju pasalnya di tab Teks.
    expect(await kartu.locator(".hasil-judul a").getAttribute("href")).toMatch(/#pasal-156/);
    await tautan.click();
    await page.waitForURL(/tab=pdf/);
    await page.waitForFunction(() => document.querySelector(".pdf-hal-input")?.value === "9", null, { timeout: 20_000 });
    await kanvasTerisi(9);
    expect(page.url()).toContain("hal=9");
  });

  it("penjelasan memakai ulang nomor pasal tetapi tak menggeser: Pasal 82 tetap di halaman 6, bukan 12 (juga tanpa halaman dari server)", async () => {
    // UU 27/2022 tak punya halaman dari server: yang dipakai pemindaian teks PDF, yang berhenti di judul penjelasan.
    const halaman = Array.from({ length: 12 }, (_, i) => [`Halaman isi ${i + 1}`, "Teks pengisi."]);
    halaman[5] = ["Pasal 20", "Pengendali Data Pribadi wajib memiliki dasar pemrosesan."];
    halaman[11] = ["PENJELASAN", "Pasal 20", "Cukup jelas."];
    await unggah(UU27, buatPdf(halaman));
    await page.goto(`${BASE}${urlUU(UU27)}`, { waitUntil: "networkidle" });
    const pasal = page.locator("article.pasal", { hasText: "Pasal 20" }).first();
    await pasal.hover();
    await pasal.locator("button.pasal-pdf").click();
    await page.waitForFunction(() => document.querySelector(".pdf-hal-input")?.value === "6", null, { timeout: 20_000 });
    await page.locator(".toast", { hasText: "Pasal 20 dimulai di halaman 6 PDF" }).waitFor();
  });

  it("pasal yang tak ada di teks PDF dan tanpa halaman dari server: dikatakan terus terang, dan PDF tetap terbuka di halaman pertama", async () => {
    const halaman = Array.from({ length: 12 }, (_, i) => [`Halaman isi ${i + 1}`, "Teks pengisi."]);
    await unggah(UU27, buatPdf(halaman));
    await page.goto(`${BASE}${urlUU(UU27)}`, { waitUntil: "networkidle" });
    const pasal = page.locator("article.pasal", { hasText: "Pasal 20" }).first();
    await pasal.hover();
    await pasal.locator("button.pasal-pdf").click();
    await page.locator(".toast", { hasText: "Pasal 20 tidak ditemukan di teks PDF" }).waitFor({ timeout: 20_000 });
    expect(await masukanHalaman().inputValue()).toBe("1");
  });

  it("PDF hasil pindaian (tanpa lapisan teks) dan tanpa halaman dari server: halamannya tetap tergambar, pencarian pasal mengakui keterbatasannya", async () => {
    await unggah(UU27, buatPdf(naskah(), { tanpaTeks: true }));
    await page.goto(`${BASE}${urlUU(UU27)}`, { waitUntil: "networkidle" });
    const pasal = page.locator("article.pasal", { hasText: "Pasal 20" }).first();
    await pasal.hover();
    await pasal.locator("button.pasal-pdf").click();
    await page.locator(".toast", { hasText: "hasil pindaian tanpa lapisan teks" }).waitFor({ timeout: 20_000 });
    await kanvasTerisi(1);
  });

  it("peraturan tanpa PDF: tombol 'hal. N' tak tampil, dan tab PDF menjelaskan, menunjuk ke naskah resmi, dan menawarkan 'Minta PDF ini'", async () => {
    await page.goto(`${BASE}${urlUU(UU27)}`, { waitUntil: "networkidle" });
    await page.locator("article.pasal").first().waitFor();
    expect(await page.locator("button.pasal-pdf:visible").count()).toBe(0);
    await page.getByRole("tab", { name: "PDF" }).click();
    await page.getByRole("heading", { name: "PDF belum diarsipkan di Lexa" }).waitFor();
    expect(await page.locator(".penampil-pdf").count()).toBe(0);
    expect(await page.getByRole("link", { name: "Buka naskah resmi (BPK)" }).count()).toBe(1);
    expect(await page.getByRole("button", { name: "Minta PDF ini" }).count()).toBe(1);
  });

  it("'Minta PDF ini' mencatat permintaan di server (didahulukan di antrean panen), berubah menjadi 'Sudah diminta', dan diingat setelah dimuat ulang", async () => {
    const adm = { "x-admin-token": TOKEN };
    await page.goto(tabPdf(UU27), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Minta PDF ini" }).click();
    await page.locator(".toast", { hasText: "permintaan Anda dicatat" }).waitFor();
    const tombol = page.getByRole("button", { name: "Sudah diminta" });
    await tombol.waitFor();
    expect(await tombol.isDisabled()).toBe(true);
    expect(await page.locator(".minta-pdf").textContent()).toContain("didahulukan");
    const ringkasan = await (await fetch(`${BASE}/api/impor/ringkasan`, { headers: adm })).json();
    expect(ringkasan.diminta_pdf).toBe(1);
    const antrean = await (await fetch(`${BASE}/api/impor/butuh-teks`, { headers: adm })).json();
    expect(antrean.daftar[0]).toMatchObject({ frbr_uri: UU27, diminta: 1 });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Sudah diminta" }).waitFor();
    // Permintaan ulang dari alamat yang sama tak menggandakan hitungan.
    const lagi = await fetch(`${BASE}/api/dokumen/minta`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uri: UU27 }) });
    expect(lagi.status).toBe(200);
    expect((await (await fetch(`${BASE}/api/impor/ringkasan`, { headers: adm })).json()).diminta_pdf).toBe(1);
  });

  it("'Minta PDF ini' yang ditolak server (terlalu sering) dikatakan, dan tombolnya bisa dicoba lagi", async () => {
    await page.route((url) => url.pathname === "/api/dokumen/minta", (route) =>
      route.fulfill({ status: 429, json: { error: "terlalu_sering", message: "Terlalu banyak permintaan dalam satu jam. Coba lagi nanti." } }),
    );
    await page.goto(tabPdf(UU27), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Minta PDF ini" }).click();
    await page.locator(".toast", { hasText: "Terlalu banyak permintaan dalam satu jam" }).waitFor();
    expect(await page.getByRole("button", { name: "Minta PDF ini" }).isDisabled()).toBe(false);
  });

  it("peraturan yang teksnya belum diekstrak tetapi PDF-nya ada: tab PDF terbuka sendiri; dengan ?tab=isi tetap di tab Teks", async () => {
    const uri = "/akn/id/act/pp/2030/77";
    const manifest = await fetch(`${BASE}/api/impor/manifest`, {
      method: "POST",
      headers: { "x-admin-token": TOKEN, "content-type": "application/json" },
      body: JSON.stringify({ versi: 1, dokumen: [{ bpk_id: "7777", meta: { Judul: "Peraturan Pemerintah Nomor 77 Tahun 2030 tentang Contoh", "Bentuk Singkat": "PP", Nomor: "77", Tahun: "2030", Status: "Berlaku" } }] }),
    });
    expect(manifest.status).toBe(200);
    await unggah(uri, buatPdf(naskah()));
    await page.goto(`${BASE}${urlUU(uri)}`, { waitUntil: "networkidle" });
    await page.locator(".pdf-hal-total", { hasText: "/ 12" }).waitFor({ timeout: 20_000 });
    expect(await page.locator('[role="tab"][aria-selected="true"]').textContent()).toBe("PDF");
    // Pilihan pembaca (juga lewat alamat) tak ditimpa.
    await page.goto(`${BASE}${urlUU(uri, "&tab=isi")}`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Teks pasal belum tersedia di Lexa");
    expect(await page.locator('[role="tab"][aria-selected="true"]').textContent()).toBe("Teks");
    // Dan pembaca yang berpindah tab sendiri sebelum status PDF tiba tak dipaksa pindah: peraturan tanpa PDF tetap di Teks.
    await page.goto(`${BASE}${urlUU(UU27)}`, { waitUntil: "networkidle" });
    expect(await page.locator('[role="tab"][aria-selected="true"]').textContent()).toBe("Teks");
  });

  it("di layar sentuh: tombol 'hal. N' pada pasal selalu terlihat (tanpa disorot), cukup besar untuk diketuk, dan membuka PDF di halaman itu", async () => {
    await ctx.close();
    await bukaKonteks({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await unggah(UU13, buatPdf(naskah()));
    await page.goto(`${BASE}${urlUU(UU13)}`, { waitUntil: "networkidle" });
    const pasal = page.locator("article.pasal", { hasText: "Pasal 156" });
    const chip = pasal.locator("button.pasal-pdf");
    await chip.waitFor({ state: "visible" });
    expect(await chip.textContent()).toBe("hal. 9");
    expect((await chip.boundingBox()).height).toBeGreaterThanOrEqual(32);
    // Lembar aksi pasal tak lagi memuat "Lihat di PDF": jalan masuknya satu, dan selalu tampak.
    await pasal.locator(".pasal-lainnya").tap();
    expect(await page.getByRole("button", { name: /Lihat di PDF/ }).count()).toBe(0);
    await page.keyboard.press("Escape");
    await page.locator("dialog[open]").waitFor({ state: "detached" });
    await chip.tap();
    await page.waitForFunction(() => document.querySelector(".pdf-hal-input")?.value === "9", null, { timeout: 20_000 });
    await kanvasTerisi(9);
    // Ponsel: tak ada gulir ke samping pada halaman web.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

describe("Periksa pasal (judul pasal di PDF dibandingkan dengan teks di Lexa)", () => {
  /** UU 13/2003 di data awal pratinjau menyimpan batang tubuh Pasal 1, 77, 79, 82, dan 156. */
  const hasil = () => page.locator("dialog.lembar-periksa .pdf-periksa-hasil");
  async function periksa() {
    await pilihDiMenu("Periksa pasal");
    await hasil().waitFor({ state: "visible", timeout: 30_000 });
    return (await hasil().textContent()).replace(/\s+/g, " ");
  }
  /** 12 halaman yang judul pasalnya persis sama dengan Lexa; penjelasan di halaman 12 memuat ulang Pasal 82 dan menambah Pasal 999. */
  function naskahSelaras() {
    const h = Array.from({ length: 12 }, (_, i) => [`Halaman isi ${i + 1}`, "Teks pengisi."]);
    h[0] = ["UNDANG-UNDANG CONTOH", "", "Pasal 1", "Ketentuan umum."];
    h[2] = ["Pasal 77", "Waktu kerja."];
    h[3] = ["Pasal 79", "Waktu istirahat."];
    h[5] = ["Pasal 82", "Pekerja perempuan berhak memperoleh istirahat."];
    h[8] = ["Pasal 156", "Dalam hal terjadi pemutusan hubungan kerja."];
    h[11] = ["PENJELASAN", "Pasal 82", "Cukup jelas.", "Pasal 999", "Cukup jelas."];
    return h;
  }

  it("selaras: nomor pasal di PDF dan di Lexa sama; penjelasan tidak dihitung (Pasal 999 hanya ada di penjelasan)", async () => {
    await unggah(UU13, buatPdf(naskahSelaras()));
    await bukaPdf();
    const teks = await periksa();
    expect(teks).toContain("PDF memuat 5 judul pasal; Lexa memuat 5 pasal, 5 di antaranya bernomor sama.");
    expect(teks).toContain("Semua nomor pasal selaras.");
    expect(teks).toContain("bagian penjelasan tidak dihitung");
    expect(await page.locator(".pdf-nomor").count()).toBe(0);
    // Hasil yang sama tersedia lagi seketika bila lembarnya dibuka ulang (indeks tersimpan, tak memindai ulang).
    await page.getByRole("button", { name: "Tutup", exact: true }).first().click();
    await page.locator("dialog.lembar-periksa").waitFor({ state: "detached" });
    expect(await periksa()).toContain("Semua nomor pasal selaras.");
  });

  it("pasal di PDF yang tak ada di Lexa dibuka dari daftar: urut alami, dan ketukan membuka halamannya", async () => {
    const halaman = naskahSelaras();
    halaman[1] = ["Pasal 10", "Isi pasal sepuluh."];
    halaman[4] = ["Pasal 45A", "Isi pasal sisipan."];
    await unggah(UU13, buatPdf(halaman));
    await bukaPdf();
    const teks = await periksa();
    expect(teks).toContain("PDF memuat 7 judul pasal; Lexa memuat 5 pasal, 5 di antaranya bernomor sama.");
    expect(teks).toContain("Ada di PDF, tidak ada di Lexa (2)");
    expect(await page.locator("button.pdf-nomor").allTextContents()).toEqual(["10", "45A"]);
    await page.locator("button.pdf-nomor", { hasText: "45A" }).click();
    await page.waitForFunction(() => document.querySelector(".pdf-hal-input")?.value === "5", null, { timeout: 10_000 });
    await kanvasTerisi(5);
  });

  it("pasal di Lexa yang judulnya tak tampak di PDF dilaporkan tanpa tombol (tak ada halaman untuk dibuka)", async () => {
    const halaman = naskahSelaras().map((hal) => hal.map((b) => b.replace("Pasal 156", "Ketentuan 156").replace("Pasal 79", "Ketentuan 79")));
    await unggah(UU13, buatPdf(halaman));
    await bukaPdf();
    const teks = await periksa();
    expect(teks).toContain("PDF memuat 3 judul pasal; Lexa memuat 5 pasal, 3 di antaranya bernomor sama.");
    expect(teks).toContain("Ada di Lexa, judulnya tak tampak di PDF (2)");
    expect(await page.locator(".pdf-nomor-polos").allTextContents()).toEqual(["79", "156"]);
    expect(await page.locator("button.pdf-nomor").count()).toBe(0);
  });

  it("PDF hasil pindaian: dikatakan terus terang bahwa pemeriksaan tak bisa dilakukan", async () => {
    await unggah(UU13, buatPdf(naskahSelaras(), { tanpaTeks: true }));
    await bukaPdf();
    expect(await periksa()).toContain("PDF ini hasil pindaian tanpa lapisan teks");
    expect(await page.locator(".pdf-nomor").count()).toBe(0);
  });

  it("peraturan yang pasalnya belum tersimpan di Lexa: PDF memuat N judul pasal, tanpa memperinci semuanya sebagai 'terlewat'", async () => {
    const uri = "/akn/id/act/pp/2030/77";
    const manifest = await fetch(`${BASE}/api/impor/manifest`, {
      method: "POST",
      headers: { "x-admin-token": TOKEN, "content-type": "application/json" },
      body: JSON.stringify({ versi: 1, dokumen: [{ bpk_id: "7777", meta: { Judul: "Peraturan Pemerintah Nomor 77 Tahun 2030 tentang Contoh", "Bentuk Singkat": "PP", Nomor: "77", Tahun: "2030", Status: "Berlaku" } }] }),
    });
    expect(manifest.status).toBe(200);
    await unggah(uri, buatPdf(naskahSelaras()));
    await bukaPdf(12, uri);
    const teks = await periksa();
    expect(teks).toContain("PDF memuat 5 judul pasal; Lexa belum menyimpan pasal peraturan ini.");
    expect(await page.locator(".pdf-nomor").count()).toBe(0);
  });

  it("dibatalkan sebelum satu halaman pun terbaca: hasilnya diberi tanda; memeriksa lagi sesudahnya memberi hasil utuh", async () => {
    await unggah(UU13, buatPdf(naskahSelaras()));
    await bukaPdf();
    await page.getByRole("button", { name: "Menu PDF" }).click();
    // Lembar dibuka dan dibatalkan pada detik yang sama, sebelum halaman pertama sempat dibaca.
    await page.evaluate(() => {
      for (const b of document.querySelectorAll("dialog.lembar-aksi button.aksi-baris")) {
        if (b.textContent.includes("Periksa pasal")) b.click();
      }
      document.querySelector("dialog.lembar-periksa .lembar-kaki button").click();
    });
    await hasil().waitFor({ state: "visible", timeout: 30_000 });
    expect((await hasil().textContent()).replace(/\s+/g, " ")).toContain("Pemeriksaan dibatalkan sebelum ada judul pasal yang terbaca.");
    await page.getByRole("button", { name: "Tutup", exact: true }).first().click();
    await page.locator("dialog.lembar-periksa").waitFor({ state: "detached" });
    const utuh = await periksa();
    expect(utuh).toContain("PDF memuat 5 judul pasal");
    expect(utuh).not.toContain("dibatalkan");
  });

  it("lembar ditutup sebelum selesai lalu dibuka lagi: pemindaian dilanjutkan dan hasilnya utuh", async () => {
    const panjang = Array.from({ length: 80 }, (_, i) => [`Pasal ${200 + i}`, "Teks pengisi."]);
    await unggah(UU13, buatPdf(panjang));
    await bukaPdf(80);
    await pilihDiMenu("Periksa pasal");
    await page.locator("dialog.lembar-periksa").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.locator("dialog.lembar-periksa").waitFor({ state: "detached" });
    const utuh = await periksa();
    expect(utuh).toContain("PDF memuat 80 judul pasal");
  });

  it("di ponsel 360 px: hasil dengan banyak nomor tidak meluber dan setiap nomor cukup besar untuk diketuk", async () => {
    await ctx.close();
    await bukaKonteks({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
    const halaman = naskahSelaras();
    halaman[1] = Array.from({ length: 25 }, (_, i) => `Pasal ${300 + i}`);
    await unggah(UU13, buatPdf(halaman));
    await bukaPdf();
    await periksa();
    expect(await page.locator("button.pdf-nomor").count()).toBe(25);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const lembar = await page.locator("dialog.lembar-periksa").boundingBox();
    expect(lembar.x).toBeGreaterThanOrEqual(0);
    expect(lembar.x + lembar.width).toBeLessThanOrEqual(360 + 1);
    const kotak = await page.locator("button.pdf-nomor").first().boundingBox();
    expect(kotak.height).toBeGreaterThanOrEqual(32);
  });
});

describe("layar penuh, halaman gelap, dan halaman terakhir dibaca", () => {
  it("layar penuh menutup seluruh jendela, Esc dan tombol Kembali menutupnya (tanpa meninggalkan peraturan), dan halaman tetap di tempatnya", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await bukaPdf();
    await masukanHalaman().fill("6");
    await masukanHalaman().press("Enter");
    await kanvasTerisi(6);
    const url = page.url();
    await page.getByRole("button", { name: "Layar penuh" }).click();
    const kotak = await page.locator(".penampil-pdf").boundingBox();
    expect(kotak).toMatchObject({ x: 0, y: 0, width: 1280, height: 900 });
    expect(await page.evaluate(() => document.documentElement.classList.contains("pdf-penuh"))).toBe(true);
    expect(await page.getByRole("button", { name: "Keluar dari layar penuh" }).getAttribute("aria-pressed")).toBe("true");
    expect(await masukanHalaman().inputValue()).toBe("6");
    // Esc keluar.
    await page.locator(".pdf-gulir").focus();
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".penampil-pdf").classList.contains("layar-penuh"));
    expect(await page.evaluate(() => document.documentElement.classList.contains("pdf-penuh"))).toBe(false);
    // Tombol Kembali peramban pun keluar dari layar penuh, bukan meninggalkan peraturan.
    await page.getByRole("button", { name: "Layar penuh" }).click();
    await page.waitForFunction(() => document.querySelector(".penampil-pdf").classList.contains("layar-penuh"));
    await page.goBack();
    await page.waitForFunction(() => !document.querySelector(".penampil-pdf").classList.contains("layar-penuh"));
    expect(page.url().split("&hal=")[0]).toBe(url.split("&hal=")[0]);
    expect(await page.locator(".penampil-pdf").count()).toBe(1);
    expect(await masukanHalaman().inputValue()).toBe("6");
    // Keluar lewat tombolnya sendiri tak meninggalkan entri riwayat berlebih: Kembali sesudahnya langsung meninggalkan peraturan.
    await page.getByRole("button", { name: "Layar penuh" }).click();
    await page.getByRole("button", { name: "Keluar dari layar penuh" }).click();
    await page.waitForFunction(() => !document.querySelector(".penampil-pdf").classList.contains("layar-penuh"));
    await page.waitForTimeout(200);
    await page.goBack();
    expect(page.url()).toBe("about:blank");
  });

  it("halaman gelap membalik warna halaman (bukan lapisan teksnya), dan pilihannya diingat", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await bukaPdf();
    await kanvasTerisi(1);
    expect(await page.locator('.pdf-halaman[data-halaman="1"] canvas').evaluate((c) => getComputedStyle(c).filter)).toBe("none");
    await pilihDiMenu("Halaman gelap");
    expect(await page.locator(".penampil-pdf").evaluate((el) => el.classList.contains("pdf-gelap"))).toBe(true);
    expect(await page.locator('.pdf-halaman[data-halaman="1"] canvas').evaluate((c) => getComputedStyle(c).filter)).toContain("invert");
    expect(await page.locator('.pdf-halaman[data-halaman="1"] .textLayer').evaluate((c) => getComputedStyle(c).filter)).toBe("none");
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".pdf-hal-total", { hasText: "/ 12" }).waitFor({ timeout: 20_000 });
    expect(await page.locator(".penampil-pdf").evaluate((el) => el.classList.contains("pdf-gelap"))).toBe(true);
    await page.getByRole("button", { name: "Menu PDF" }).click();
    await page.locator("dialog.lembar-aksi").getByText("Halaman terang", { exact: true }).click();
    expect(await page.locator(".penampil-pdf").evaluate((el) => el.classList.contains("pdf-gelap"))).toBe(false);
  });

  it("halaman terakhir dibaca diingat per PDF: dibuka lagi di sana dengan tawaran 'Dari awal'; alamat dengan halaman tertentu didahulukan", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await bukaPdf();
    await masukanHalaman().fill("7");
    await masukanHalaman().press("Enter");
    await kanvasTerisi(7);
    await page.waitForTimeout(900);
    await page.goto(tabPdf(), { waitUntil: "networkidle" });
    await page.locator(".pdf-hal-total", { hasText: "/ 12" }).waitFor({ timeout: 20_000 });
    await page.locator(".toast", { hasText: "Dilanjutkan dari halaman 7." }).waitFor();
    expect(await masukanHalaman().inputValue()).toBe("7");
    await page.getByRole("button", { name: "Dari awal" }).click();
    expect(await masukanHalaman().inputValue()).toBe("1");
    // Alamat dengan halaman: itu yang dibuka, tanpa tawaran.
    await page.goto(tabPdf(UU13, "&hal=3"), { waitUntil: "networkidle" });
    await page.locator(".pdf-hal-total", { hasText: "/ 12" }).waitFor({ timeout: 20_000 });
    expect(await masukanHalaman().inputValue()).toBe("3");
    expect(await page.locator(".toast", { hasText: "Dilanjutkan" }).count()).toBe(0);
  });

  it("alamat mengikuti halaman yang dibaca (tab=pdf&hal=N), supaya tautan yang dibagikan atau dimuat ulang kembali ke halaman itu", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await bukaPdf();
    await masukanHalaman().fill("6");
    await masukanHalaman().press("Enter");
    await page.waitForFunction(() => location.search.includes("hal=6"), null, { timeout: 5000 });
    expect(page.url()).toContain("tab=pdf");
    await masukanHalaman().fill("1");
    await masukanHalaman().press("Enter");
    await page.waitForFunction(() => !location.search.includes("hal="), null, { timeout: 5000 });
  });
});

describe("layar sempit", () => {
  for (const lebar of [360, 390]) {
    it(`${lebar}px: bilah alat muat utuh (tak terpotong), halaman tak meluber, dan lompat ke halaman mendarat di puncak penggulir`, async () => {
      await ctx.close();
      await bukaKonteks({ viewport: { width: lebar, height: 800 }, isMobile: true, hasTouch: true });
      await unggah(UU13, buatPdf(naskah()));
      await bukaPdf();
      const bilah = await page.locator(".pdf-bilah").evaluate((el) => ({ isi: el.scrollWidth, tampak: el.clientWidth }));
      expect(bilah.isi).toBeLessThanOrEqual(bilah.tampak + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // Kontrol penting terlihat di layar; tombol halaman dan zoom pindah ke menu (cubitan dan gulir menggantikannya).
      for (const nama of ["Pasal", "Cari di PDF", "Layar penuh", "Menu PDF"]) {
        const kotak = await page.getByRole("button", { name: nama, exact: true }).boundingBox();
        expect(kotak, nama).not.toBeNull();
        expect(kotak.x + kotak.width, nama).toBeLessThanOrEqual(lebar);
        expect(kotak.height, nama).toBeGreaterThanOrEqual(34);
      }
      for (const nama of ["Halaman sebelumnya", "Halaman berikutnya", "Perkecil", "Perbesar", "Pas lebar"]) {
        expect(await page.getByRole("button", { name: nama }).isHidden(), nama).toBe(true);
      }
      await masukanHalaman().fill("9");
      await masukanHalaman().press("Enter");
      await kanvasTerisi(9);
      expect(Math.abs((await jarakPuncak(9)) - 6)).toBeLessThanOrEqual(2);
      // Zoom tetap bisa dipakai dari menu.
      const awal = await lebarHalaman(9);
      await pilihDiMenu("Perbesar");
      expect(await lebarHalaman(9)).toBeGreaterThan(awal * 1.2);
      await pilihDiMenu("Pas lebar");
      expect(await lebarHalaman(9)).toBeCloseTo(awal, 0);
    });
  }

  it("kotak cari, daftar pasal, dan layar penuh bisa dipakai tanpa meluber di 360px", async () => {
    await ctx.close();
    await bukaKonteks({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
    await unggah(UU13, buatPdf(naskah()));
    await bukaPdf();
    await page.getByRole("button", { name: "Cari di PDF" }).click();
    const cari = await page.locator(".pdf-cari").evaluate((el) => ({ isi: el.scrollWidth, tampak: el.clientWidth }));
    expect(cari.isi).toBeLessThanOrEqual(cari.tampak + 1);
    await page.locator(".pdf-cari-input").fill("pekerja");
    await page.waitForFunction(() => document.querySelector(".pdf-cari-hitung")?.textContent === "1 / 1", null, { timeout: 15_000 });
    await page.getByRole("button", { name: "Tutup pencarian" }).click();
    await page.getByRole("button", { name: "Layar penuh" }).click();
    const kotak = await page.locator(".penampil-pdf").boundingBox();
    expect(kotak).toMatchObject({ x: 0, y: 0, width: 360, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

describe("galat dan keadaan khusus", () => {
  it("berkas yang bukan PDF sungguhan: pesan jelas dan tombol 'Coba lagi', bukan halaman kosong", async () => {
    await unggah(UU27, Buffer.from("%PDF-1.4\nini bukan PDF yang utuh\n"));
    await page.goto(tabPdf(UU27), { waitUntil: "networkidle" });
    await page.locator(".pdf-status-galat").waitFor({ timeout: 20_000 });
    expect(await page.locator(".pdf-status-galat").textContent()).toMatch(/rusak|tidak bisa dimuat/);
    expect(await page.getByRole("button", { name: "Coba lagi" }).count()).toBe(1);
    expect(await page.locator(".pdf-halaman").count()).toBe(0);
    // Kontrol yang tak berguna tanpa dokumen tetap mati.
    expect(await page.getByRole("button", { name: "Cari di PDF" }).isDisabled()).toBe(true);
    expect(await masukanHalaman().isDisabled()).toBe(true);
  });

  it("peraturan dengan PDF dan pasal: pindah tab dan kembali tak memuat ulang PDF (penampil dibuat sekali)", async () => {
    await unggah(UU13, buatPdf(naskah()));
    const permintaan = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/dokumen/pdf")) permintaan.push(r.url());
    });
    await page.goto(tabPdf(), { waitUntil: "networkidle" });
    await kanvasTerisi(1);
    const jumlah = permintaan.length;
    await page.getByRole("tab", { name: "Teks" }).click();
    await page.getByRole("tab", { name: "PDF" }).click();
    await kanvasTerisi(1);
    expect(permintaan.length).toBe(jumlah);
  });

  it("PDF.js tidak dimuat sebelum tab PDF atau 'Lihat di PDF' dipakai (2,3 MB tak boleh membebani pembaca biasa)", async () => {
    await unggah(UU13, buatPdf(naskah()));
    const berkas = [];
    page.on("request", (r) => {
      if (r.url().includes("/vendor/pdfjs/")) berkas.push(r.url());
    });
    await page.goto(`${BASE}${urlUU(UU13)}`, { waitUntil: "networkidle" });
    await page.locator("article.pasal").first().waitFor();
    expect(berkas).toEqual([]);
    await page.getByRole("tab", { name: "PDF" }).click();
    await kanvasTerisi(1);
    expect(berkas.some((u) => u.endsWith("pdf.min.mjs"))).toBe(true);
    expect(berkas.some((u) => u.endsWith("pdf.worker.min.mjs"))).toBe(true);
  });

  it("pindah halaman di dalam aplikasi membuang penampil: tak ada kanvas, penanda pencarian, atau kelas layar penuh yang tertinggal", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await bukaPdf();
    await kanvasTerisi(1);
    await page.getByRole("button", { name: "Cari di PDF" }).click();
    await page.locator(".pdf-cari-input").fill("pasal");
    await page.waitForFunction(() => (CSS.highlights.get("pdf-cari-aktif")?.size ?? 0) === 1, null, { timeout: 15_000 });
    await page.getByRole("link", { name: "Telusuri" }).first().click();
    await page.waitForFunction(() => location.pathname === "/telusuri" && !document.querySelector(".penampil-pdf"), null, { timeout: 10_000 });
    expect(await page.locator(".penampil-pdf, .pdf-halaman").count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.classList.contains("pdf-penuh"))).toBe(false);
    expect(await page.evaluate(() => (CSS.highlights.get("pdf-cari-aktif")?.size ?? 0) + (CSS.highlights.get("pdf-cari")?.size ?? 0))).toBe(0);
  });

  it("pindah ke peraturan lain (muat penuh) tak meninggalkan penampil", async () => {
    await unggah(UU13, buatPdf(naskah()));
    await bukaPdf();
    await kanvasTerisi(1);
    await page.goto(`${BASE}${urlUU(UU27)}`, { waitUntil: "networkidle" });
    expect(await page.locator(".penampil-pdf, .pdf-halaman").count()).toBe(0);
  });
});
