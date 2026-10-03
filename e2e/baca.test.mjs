/**
 * Tes ujung-ke-ujung halaman baca peraturan di Chromium sungguhan: header ringkas, lembar aksi,
 * daftar isi, pengaturan tampilan teks, aksi per pasal, dan tata letak layar lebar.
 *
 * Ponsel diuji dengan sentuhan (`tap`) dan layar sentuh sungguhan (`hasTouch`/`isMobile`),
 * karena sebagian perilaku bergantung pada `(hover: none)` dan `(pointer: coarse)`.
 *
 *   npm run e2e
 */
import { createRequire } from "node:module";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mulaiPratinjau, pasangPengumpul, UU13, urlUU } from "./pembantu.mjs";

const require = createRequire(import.meta.url);
const PORT = 4793;
const BASE = `http://localhost:${PORT}`;
const AXE = require.resolve("axe-core/axe.min.js");
const URI_BESAR = "/akn/id/act/uu/2099/1";

let server;
let browser;
/** @type {import("playwright-core").BrowserContext[]} */
let konteksDibuka = [];
/** @type {string[]} */
let masalah = [];

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

beforeEach(() => {
  masalah = [];
  konteksDibuka = [];
});

afterEach(async () => {
  for (const k of konteksDibuka) await k.close();
  expect(masalah, "galat konsol/jaringan").toEqual([]);
});

/**
 * Halaman baru di konteks baru. `hp`: layar sentuh 390×844 (bisa diubah lewat `lebar`/`tinggi`).
 * Service worker diblokir agar tes deterministik; perilakunya diuji di e2e/pwa.test.mjs.
 * @param {{ hp?: boolean, lebar?: number, tinggi?: number, tema?: "light" | "dark", bypassCSP?: boolean }} [opsi]
 */
async function halaman(opsi = {}) {
  const { hp = false, lebar = hp ? 390 : 1280, tinggi = hp ? 844 : 900, tema = "light", bypassCSP = false } = opsi;
  const konteks = await browser.newContext({
    serviceWorkers: "block",
    viewport: { width: lebar, height: tinggi },
    ...(hp ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}),
    permissions: ["clipboard-read", "clipboard-write"],
    colorScheme: tema,
    bypassCSP,
  });
  konteksDibuka.push(konteks);
  const p = await konteks.newPage();
  // Galat penantian muncul dengan lokasinya sebelum batas waktu tes (30 dtk) habis.
  p.setDefaultTimeout(8000);
  pasangPengumpul(p, masalah);
  return p;
}

/** Buka halaman peraturan dan tunggu pasalnya tergambar. */
async function bukaPeraturan(p, uri = UU13, ekstra = "") {
  await p.goto(BASE + urlUU(uri, ekstra), { waitUntil: "networkidle" });
  await p.waitForSelector(".pasal");
}

/** Tunggu animasi lembar selesai supaya posisi dan kontras terukur pada keadaan akhirnya. */
const tungguLembar = (p, selektor) => p.locator(selektor).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));

/** Pelanggaran axe yang serius/kritis di halaman saat ini. */
async function pelanggaranAxe(p) {
  await p.addScriptTag({ path: AXE });
  return p.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { resultTypes: ["violations"], rules: { "color-contrast": { enabled: true } } });
    return r.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({ id: v.id, bantuan: v.help, simpul: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
  });
}

/** Ubah jawaban detail peraturan sebelum sampai ke halaman (data uji tertentu tanpa menyentuh basis data). */
async function ubahDetail(p, ubah) {
  await p.route(
    (url) => url.pathname === "/api/laws/detail",
    async (route) => {
      const res = await route.fetch();
      const json = await res.json();
      ubah(json);
      await route.fulfill({ response: res, json });
    },
  );
}

const dalamLayar = (p, selektor) =>
  p.evaluate((s) => {
    const r = document.querySelector(s)?.getBoundingClientRect();
    return r ? { atas: r.top, bawah: r.bottom, tinggi: innerHeight } : null;
  }, selektor);

describe("ponsel: halaman baca", () => {
  it("header ringkas: tab dan awal teks terlihat tanpa menggulir, aksi sekunder dipindah ke 'Lainnya'", async () => {
    const p = await halaman({ hp: true });
    await bukaPeraturan(p);

    const letak = await p.evaluate(() => ({
      tab: document.querySelector(".tab-daftar").getBoundingClientRect().top,
      pasal: document.querySelector(".pasal").getBoundingClientRect().top,
      tinggi: innerHeight,
    }));
    expect(letak.tab, "tab Isi/Relasi/Naskah harus sudah terlihat").toBeLessThan(letak.tinggi * 0.75);
    expect(letak.pasal, "pasal pertama harus sudah mulai terlihat").toBeLessThan(letak.tinggi);

    const terlihat = (await p.locator(".aksi-bar > .tombol:visible").allInnerTexts()).map((t) => t.trim());
    expect(terlihat).toEqual(["Simpan", "Sitasi", "Lainnya"]);
    // Tiga tombol utama muat sebaris tanpa isi yang meluap dari tombolnya.
    const meluap = await p.locator(".aksi-bar > .tombol:visible").evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).length);
    expect(meluap).toBe(0);
    expect(await p.locator(".remah").isVisible(), "remah roti tidak memakan tempat di ponsel").toBe(false);
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  it("'Informasi peraturan' tertutup dulu, dibuka dengan ketukan, dan memuat metadata", async () => {
    const p = await halaman({ hp: true });
    await bukaPeraturan(p);
    expect(await p.locator(".info-peraturan").evaluate((el) => el.open)).toBe(false);
    expect(await p.locator(".info-peraturan .metadata").isVisible()).toBe(false);
    await p.locator(".info-peraturan > summary").tap();
    await p.locator(".info-peraturan .metadata").waitFor();
    const teks = await p.locator(".info-peraturan .metadata").innerText();
    expect(teks).toContain("13 / 2003");
    expect(teks).toContain("Undang-Undang");
  });

  it("lembar 'Lainnya' naik dari bawah, menyalin tautan, dan Esc mengembalikan fokus ke tombolnya", async () => {
    const p = await halaman({ hp: true });
    await bukaPeraturan(p);
    const pemicu = p.locator(".tombol-lainnya");
    await pemicu.tap();
    const lembar = p.locator("dialog.lembar-aksi[open]");
    await lembar.waitFor();
    await tungguLembar(p, "dialog.lembar-aksi");

    const kotak = await lembar.boundingBox();
    expect(kotak.width).toBeCloseTo(390, 0);
    expect(Math.round(kotak.y + kotak.height), "menempel di dasar layar").toBe(844);
    expect(await lembar.locator("h2").textContent()).toBe("UU 13/2003");
    const baris = await lembar.locator(".aksi-baris").allInnerTexts();
    expect(baris.join("|")).toContain("Salin tautan");
    expect(baris.join("|")).toContain("Naskah resmi (BPK)");
    expect(baris.join("|")).toContain("Laporkan kesalahan");
    // Halaman di belakang lembar modal tidak ikut tergulir.
    expect(await p.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");

    await p.keyboard.press("Escape");
    await p.waitForFunction(() => !document.querySelector("dialog.lembar"));
    expect(await p.evaluate(() => document.activeElement?.classList.contains("tombol-lainnya"))).toBe(true);
    expect(await p.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");

    await pemicu.tap();
    await p.locator("dialog.lembar-aksi .aksi-baris", { hasText: "Salin tautan" }).tap();
    await p.waitForFunction(() => !document.querySelector("dialog.lembar"));
    expect(await p.locator(".toast").allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining("Tautan disalin")]));
    const tersalin = await p.evaluate(() => navigator.clipboard.readText());
    expect(tersalin.startsWith(`${BASE}/peraturan?uri=`)).toBe(true);
    expect(tersalin).toContain("uu%2F2003%2F13");
  });

  it("menutup lembar dengan mengetuk latar di luarnya", async () => {
    const p = await halaman({ hp: true });
    await bukaPeraturan(p);
    await p.locator(".tombol-lainnya").tap();
    await p.locator("dialog.lembar-aksi[open]").waitFor();
    await p.touchscreen.tap(195, 60); // di atas lembar: latar redup
    await p.waitForFunction(() => !document.querySelector("dialog.lembar"));
  });

  it("lapor kesalahan lewat lembar 'Lainnya' tercatat di server", async () => {
    const p = await halaman({ hp: true });
    await bukaPeraturan(p);
    await p.locator(".tombol-lainnya").tap();
    await p.locator("dialog.lembar-aksi .aksi-baris", { hasText: "Laporkan kesalahan" }).tap();
    await p.waitForSelector("dialog.dialog-laporan[open]");
    await p.selectOption("dialog.dialog-laporan select", "status_salah");
    await p.fill("dialog.dialog-laporan textarea", "Status seharusnya diubah");
    await p.locator("dialog.dialog-laporan button[type=submit]").tap();
    await p.waitForFunction(() => !document.querySelector("dialog.dialog-laporan"));
    const lapor = await (await fetch(`${BASE}/api/admin/laporan`, { headers: { "x-admin-token": "token-admin-uji" } })).json();
    expect(lapor.laporan[0]).toMatchObject({ frbr_uri: UU13, jenis: "status_salah", keterangan: "Status seharusnya diubah" });
    await reset();
  });

  it("daftar isi: lembar berisi BAB dan rentang pasalnya, ketuk pasal menutup lembar dan menggulir ke sana", async () => {
    const p = await halaman({ hp: true });
    await bukaPeraturan(p);
    const pemicu = p.locator(".tombol-daftar-isi");
    expect(await pemicu.getAttribute("aria-expanded")).toBe("false");
    await pemicu.tap();
    const lembar = p.locator("dialog.daftar-isi[open]");
    await lembar.waitFor();
    await tungguLembar(p, "dialog.daftar-isi");
    expect(await pemicu.getAttribute("aria-expanded")).toBe("true");

    const bab = lembar.locator(".grup-bab");
    expect(await bab.count()).toBe(3);
    expect(await bab.nth(0).locator("summary").innerText()).toMatch(/Bab I\b[\s\S]*Pasal 1$/);
    expect(await bab.nth(1).locator(".rentang-pasal").textContent()).toBe("Pasal 77–82");
    expect(await bab.nth(2).locator(".rentang-pasal").textContent()).toBe("Pasal 156");
    // Nomor pasal baru terlihat setelah BAB dibuka.
    expect(await lembar.locator(".kisi-pasal a:visible").count()).toBe(0);
    await bab.nth(1).locator("summary").tap();
    expect(await lembar.locator(".kisi-pasal a:visible").allTextContents()).toEqual(["77", "79", "82"]);

    await lembar.locator(".kisi-pasal a", { hasText: "82" }).tap();
    await p.waitForFunction(() => !document.querySelector("dialog.daftar-isi[open]"));
    await p.waitForFunction(() => location.hash === "#pasal-82");
    await p.waitForFunction(() => {
      const r = document.querySelector("#pasal-82")?.getBoundingClientRect();
      return r && r.top >= 56 && r.top < innerHeight * 0.5;
    });
    expect(await pemicu.getAttribute("aria-expanded")).toBe("false");
  });

  it("'Lompat ke pasal': nomor yang ada menggulir ke pasalnya, yang tidak ada memberi pesan dan lembar tetap terbuka", async () => {
    const p = await halaman({ hp: true });
    await bukaPeraturan(p);
    await p.locator(".tombol-daftar-isi").tap();
    const lembar = p.locator("dialog.daftar-isi[open]");
    await lembar.waitFor();

    await lembar.locator("input[name=nomor-pasal]").fill("999");
    await lembar.locator("input[name=nomor-pasal]").press("Enter");
    expect(await lembar.locator(".lompat-pasal [role=status]").textContent()).toBe("Pasal 999 tidak ada di peraturan ini.");
    expect(await p.locator("dialog.daftar-isi[open]").count()).toBe(1);
    await lembar.locator("input[name=nomor-pasal]").fill("99");
    expect(await lembar.locator(".lompat-pasal [role=status]").textContent(), "pesan hilang saat mengetik lagi").toBe("");

    // "Pasal 156 " dengan spasi dan huruf besar kecil tetap dikenali.
    await lembar.locator("input[name=nomor-pasal]").fill(" Pasal 156 ");
    await lembar.locator("button[type=submit]").tap();
    await p.waitForFunction(() => !document.querySelector("dialog.daftar-isi[open]"));
    await p.waitForFunction(() => location.hash === "#pasal-156");
    await p.waitForFunction(() => {
      const r = document.querySelector("#pasal-156")?.getBoundingClientRect();
      return r && r.top >= 56 && r.top < innerHeight * 0.6;
    });
  });

  it("tombol mengambang 'Daftar isi' muncul setelah bilah alat tergulir lewat dan hilang di tab lain", async () => {
    const p = await halaman({ hp: true });
    await reset();
    expect((await fetch(`${BASE}/__dev/peraturan-besar?pasal=400`, { method: "POST" })).status).toBe(201);
    await bukaPeraturan(p, URI_BESAR);

    const fab = p.locator(".fab-daftar-isi");
    expect(await fab.isVisible(), "belum terlihat di puncak halaman").toBe(false);
    await p.evaluate(() => window.scrollTo(0, 2500));
    await fab.waitFor({ state: "visible" });

    // Tidak menimpa bilah navigasi bawah.
    const [kotakFab, kotakNav] = await Promise.all([fab.boundingBox(), p.locator(".nav-bawah").boundingBox()]);
    expect(kotakFab.y + kotakFab.height).toBeLessThanOrEqual(kotakNav.y);

    await fab.tap();
    await p.locator("dialog.daftar-isi[open]").waitFor();
    expect(await p.locator("dialog.daftar-isi .grup-bab").count()).toBe(4); // 400 baris = 200 pasal, 50 pasal per BAB
    await p.keyboard.press("Escape");
    await p.waitForFunction(() => !document.querySelector("dialog.daftar-isi[open]"));

    // Di tab Relasi tombol tidak berarti.
    await p.locator("#tab-relasi").tap();
    await p.waitForSelector("#panel-relasi:not([hidden])");
    await fab.waitFor({ state: "hidden" });
    await p.locator("#tab-isi").tap();
    await fab.waitFor({ state: "visible" });
    await reset();
  });

  it("tab menempel di bawah header saat menggulir sehingga berpindah bagian tanpa kembali ke atas", async () => {
    const p = await halaman({ hp: true });
    await reset();
    expect((await fetch(`${BASE}/__dev/peraturan-besar?pasal=200`, { method: "POST" })).status).toBe(201);
    await bukaPeraturan(p, URI_BESAR);
    await p.evaluate(() => window.scrollTo(0, 1800));
    await p.waitForTimeout(100);
    const { tab, header } = await p.evaluate(() => ({
      tab: document.querySelector(".tab-daftar").getBoundingClientRect().top,
      header: document.querySelector("#app > header").getBoundingClientRect().bottom,
    }));
    expect(Math.abs(tab - header), `tab ${tab}, header ${header}`).toBeLessThanOrEqual(1.5);
    await p.locator("#tab-naskah").tap();
    await p.waitForSelector("#panel-naskah:not([hidden])");
    await reset();
  });

  it("teks pasal ditata ulang: butir bersusun dengan indentasi menggantung, tanpa gulir mendatar walau ada rangkaian panjang tanpa spasi", async () => {
    const p = await halaman({ hp: true, lebar: 320, tinggi: 640 });
    const panjang = "https://contoh.go.id/" + "a".repeat(180);
    await ubahDetail(p, (json) => {
      json.articles = json.articles.filter((a) => a.nomor_pasal === "82");
      json.articles[0].ayat = null;
      json.articles[0].isi = `Pengusaha wajib :\n1. memberi tahu ${panjang} ;\n2. membayar upah, yaitu :\na. upah pokok ;\nb. tunjangan tetap ;\n3. menaati peraturan.`;
    });
    await bukaPeraturan(p);
    const butir = p.locator("#pasal-82 .butir");
    expect(await butir.count()).toBe(5);
    expect(await butir.nth(0).locator(".no").textContent()).toBe("1.");
    expect(await butir.nth(2).evaluate((el) => el.classList.contains("butir-2")), "a. berada satu tingkat di dalam 2.").toBe(true);
    expect(await butir.nth(2).locator(".no").textContent()).toBe("a.");
    // Indentasi menggantung: teks di kanan penanda, bukan di bawahnya.
    const { noKanan, isiKiri } = await butir.nth(0).evaluate((el) => ({
      noKanan: el.querySelector(".no").getBoundingClientRect().right,
      isiKiri: el.querySelector(".isi").getBoundingClientRect().left,
    }));
    expect(isiKiri).toBeGreaterThanOrEqual(noKanan - 1);
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });

  it("Penjelasan (nomor pasal yang berulang) punya judul sendiri, tidak ikut dihitung sebagai pasal, dan punya kelompok sendiri di daftar isi", async () => {
    const p = await halaman({ hp: true });
    await ubahDetail(p, (json) => {
      const babAkhir = json.articles.at(-1).bab;
      const kembar = (nomor, isi) => ({ ...json.articles.find((a) => a.nomor_pasal === nomor), id: `${UU13}#pasal-${nomor}~2`, ayat: null, bab: babAkhir, isi, urutan: 100 + Number(nomor) });
      json.articles.push(kembar("1", "Cukup jelas."), kembar("77", "Yang dimaksud dengan waktu kerja adalah jam kerja."), kembar("156", "Cukup jelas."));
    });
    await bukaPeraturan(p);

    expect(await p.locator(".meta-baris").innerText()).toContain("5 pasal dan penjelasannya");
    const judulBab = await p.locator("h2.bab").allTextContents();
    expect(judulBab).toHaveLength(4);
    expect(judulBab.at(-1)).toBe("Penjelasan");
    expect(await p.locator('[id="pasal-1"] h3').textContent()).toBe("Pasal 1");
    expect(await p.locator('[id="pasal-1~2"] h3').textContent()).toBe("Penjelasan Pasal 1");
    expect(await p.evaluate(() => {
      const id = [...document.querySelectorAll("[id]")].map((e) => e.id);
      return id.length - new Set(id).size;
    }), "tidak ada id kembar di dokumen").toBe(0);

    await p.locator(".tombol-daftar-isi").tap();
    const bab = p.locator("dialog.daftar-isi .grup-bab");
    expect(await bab.count()).toBe(4);
    expect(await bab.nth(3).locator(".nama-bab").textContent()).toBe("Penjelasan");
    expect(await bab.nth(3).locator(".rentang-pasal").textContent()).toBe("Pasal 1–156");
    await bab.nth(3).locator("summary").tap();
    await bab.nth(3).locator(".kisi-pasal a", { hasText: /^156$/ }).tap();
    await p.waitForFunction(() => location.hash === "#pasal-156~2");
    await p.waitForFunction(() => {
      // Pasal terakhir halaman tidak bisa digulir sampai ke atas layar; cukup terlihat di atas bilah bawah.
      const r = document.getElementById("pasal-156~2")?.getBoundingClientRect();
      return r && r.top > 56 && r.top < innerHeight - 100;
    });

    // "Lompat ke pasal" menuju batang tubuh lebih dulu.
    await p.locator(".tombol-daftar-isi").tap();
    await p.locator("dialog.daftar-isi input[name=nomor-pasal]").fill("77");
    await p.locator("dialog.daftar-isi button[type=submit]").tap();
    await p.waitForFunction(() => location.hash === "#pasal-77");

    // Salinan teks penjelasan memakai sitasi penjelasan, bukan sitasi pasalnya.
    await p.locator('[id="pasal-1~2"] .pasal-lainnya').tap();
    await p.locator("dialog.lembar-aksi .aksi-baris", { hasText: "Salin teks pasal" }).tap();
    await p.waitForFunction(() => !document.querySelector("dialog.lembar"));
    expect(await p.evaluate(() => navigator.clipboard.readText())).toBe("UU 13/2003 Penjelasan Pasal 1\nCukup jelas.");
  });

  it("penjelasan umum yang terbawa di teks pasal terakhir dipisah menjadi bagiannya sendiri", async () => {
    const p = await halaman({ hp: true });
    await ubahDetail(p, (json) => {
      json.articles.at(-1).isi +=
        "\nDisahkan di Jakarta\npada tanggal 25 Maret 2003\n\n\n### Page 80\nPRESIDEN\nREPUBLIK INDONESIAPENJELASAN\nATAS\nUNDANG-UNDANG REPUBLIK INDONESIA\nNOMOR 13 TAHUN 2003\nTENTANG\nKETENAGAKERJAAN\nI. UMUM\nPembangunan ketenagakerjaan adalah bagian dari pembangunan nasional.\nII. PASAL DEMI PASAL";
    });
    await bukaPeraturan(p);

    const umum = p.locator('[id="penjelasan-umum"]');
    expect(await umum.locator("h3").textContent()).toBe("Penjelasan Umum");
    // textContent, bukan innerText: pasal di luar layar memakai content-visibility: auto, yang membuat innerText kosong.
    expect(await umum.textContent()).toContain("Pembangunan ketenagakerjaan adalah bagian dari pembangunan nasional.");
    expect(await umum.textContent(), "kepala naskah dan judul bagian tidak ikut tampil").not.toMatch(/PENJELASAN\s*ATAS|PASAL DEMI PASAL/);
    const pasal156 = await p.locator("#pasal-156").textContent();
    expect(pasal156).toContain("Disahkan di Jakarta");
    expect(pasal156, "naskah penjelasan tidak lagi menempel di pasalnya").not.toMatch(/PENJELASAN|UMUM|Page 80/);
    expect(await p.locator("h2.bab").allTextContents()).toContain("Penjelasan");
    expect(await p.locator(".meta-baris").innerText()).toContain("5 pasal dan penjelasannya");

    await p.locator(".tombol-daftar-isi").tap();
    const terakhir = p.locator("dialog.daftar-isi .grup-bab").last();
    expect(await terakhir.locator(".nama-bab").textContent()).toBe("Penjelasan");
    expect(await terakhir.locator(".rentang-pasal").textContent()).toBe("Umum");
    await terakhir.locator("summary").tap();
    await terakhir.locator(".kisi-pasal a", { hasText: "Umum" }).tap();
    await p.waitForFunction(() => location.hash === "#penjelasan-umum");
  });

  it("ringkasan panjang dipotong empat baris dan dibuka dengan 'Selengkapnya'", async () => {
    const p = await halaman({ hp: true });
    const kalimat = "Undang-undang ini mengatur hubungan kerja, pengupahan, perlindungan, dan pemutusan hubungan kerja. ";
    await ubahDetail(p, (json) => {
      json.law.ringkasan = kalimat.repeat(6).trim();
    });
    await bukaPeraturan(p);
    const tombol = p.locator(".ringkasan-ai .tombol-teks");
    expect(await tombol.textContent()).toBe("Selengkapnya");
    expect(await tombol.getAttribute("aria-expanded")).toBe("false");
    const tinggiPotong = await p.locator(".ringkasan-ai p").evaluate((el) => el.getBoundingClientRect().height);
    await tombol.tap();
    expect(await tombol.textContent()).toBe("Lebih sedikit");
    expect(await tombol.getAttribute("aria-expanded")).toBe("true");
    const tinggiPenuh = await p.locator(".ringkasan-ai p").evaluate((el) => el.getBoundingClientRect().height);
    expect(tinggiPenuh).toBeGreaterThan(tinggiPotong * 1.4);
    await tombol.tap();
    expect(await p.locator(".ringkasan-ai p.terpotong").count()).toBe(1);
  });

  it("tampilan teks: ukuran dan jenis huruf berlaku seketika, tersimpan, dan bertahan setelah muat ulang", async () => {
    const p = await halaman({ hp: true });
    await bukaPeraturan(p);
    const ukuranHuruf = () => p.locator(".isi-baca .isi-peraturan").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const keluarga = () => p.locator(".isi-baca .isi-peraturan").evaluate((el) => getComputedStyle(el).fontFamily);
    expect(await p.locator(".isi-baca .isi-peraturan").getAttribute("data-ukuran")).toBe("1");
    expect(await p.locator(".isi-baca .isi-peraturan").getAttribute("data-huruf")).toBe("serif");
    const awal = await ukuranHuruf();
    const keluargaAwal = await keluarga();

    await p.getByRole("button", { name: "Tampilan teks" }).tap();
    const lembar = p.locator("dialog.lembar-tampilan[open]");
    await lembar.waitFor();
    await lembar.locator("input[type=range]").fill("3");
    expect(await lembar.locator(".nilai-ukuran").textContent()).toBe("Lebih besar");
    expect(await p.locator(".isi-baca .isi-peraturan").getAttribute("data-ukuran")).toBe("3");
    expect(await ukuranHuruf()).toBeGreaterThan(awal * 1.15);
    await lembar.getByLabel("Tanpa kaki (bersih)").check();
    expect(await p.locator(".isi-baca .isi-peraturan").getAttribute("data-huruf")).toBe("sans");
    expect(await keluarga()).not.toBe(keluargaAwal);
    expect(JSON.parse(await p.evaluate(() => localStorage.getItem("lexa:baca:v1")))).toEqual({ ukuran: 3, huruf: "sans" });
    await p.keyboard.press("Escape");
    await p.waitForFunction(() => !document.querySelector("dialog.lembar"));

    await p.reload({ waitUntil: "networkidle" });
    await p.waitForSelector(".pasal");
    expect(await p.locator(".isi-baca .isi-peraturan").getAttribute("data-ukuran")).toBe("3");
    expect(await p.locator(".isi-baca .isi-peraturan").getAttribute("data-huruf")).toBe("sans");
    await p.getByRole("button", { name: "Tampilan teks" }).tap();
    expect(await p.locator("dialog.lembar-tampilan input[type=range]").inputValue()).toBe("3");
    expect(await p.locator("dialog.lembar-tampilan input[type=radio]:checked").getAttribute("value")).toBe("sans");
  });

  it("preferensi tampilan yang rusak di penyimpanan diabaikan, bukan membuat halaman galat", async () => {
    const p = await halaman({ hp: true });
    await p.addInitScript(() => localStorage.setItem("lexa:baca:v1", '{"ukuran":99,"huruf":"komik"}'));
    await bukaPeraturan(p);
    expect(await p.locator(".isi-baca .isi-peraturan").getAttribute("data-ukuran")).toBe("1");
    expect(await p.locator(".isi-baca .isi-peraturan").getAttribute("data-huruf")).toBe("serif");
  });

  it("di layar sentuh tiap pasal punya satu tombol aksi yang membuka lembar: salin teks, sitasi, tautan, lapor", async () => {
    const p = await halaman({ hp: true });
    await bukaPeraturan(p);
    expect(await p.locator("#pasal-82 .pasal-aksi").isVisible(), "tiga ikon hover tidak dipakai di layar sentuh").toBe(false);
    const lainnya = p.locator("#pasal-82 .pasal-lainnya");
    expect(await lainnya.isVisible()).toBe(true);
    const kotak = await lainnya.boundingBox();
    expect(Math.min(kotak.width, kotak.height), "target ketuk minimal 36px").toBeGreaterThanOrEqual(36);

    await lainnya.tap();
    const lembar = p.locator("dialog.lembar-aksi[open]");
    await lembar.waitFor();
    expect(await lembar.locator("h2").textContent()).toBe("UU 13/2003 Pasal 82");
    expect((await lembar.locator(".aksi-baris .aksi-teks > span:first-child").allTextContents())).toEqual([
      "Salin teks pasal", "Salin sitasi", "Salin tautan ke pasal ini", "Laporkan kesalahan",
    ]);
    await lembar.locator(".aksi-baris", { hasText: "Salin teks pasal" }).tap();
    await p.waitForFunction(() => !document.querySelector("dialog.lembar"));
    const teks = await p.evaluate(() => navigator.clipboard.readText());
    expect(teks.startsWith("UU 13/2003 Pasal 82\n(1) Pekerja perempuan berhak memperoleh istirahat")).toBe(true);
    expect(teks).toContain("(2) Pekerja perempuan yang mengalami keguguran");

    await lainnya.tap();
    await p.locator("dialog.lembar-aksi .aksi-baris", { hasText: "Salin tautan ke pasal ini" }).tap();
    await p.waitForFunction(() => !document.querySelector("dialog.lembar"));
    expect(await p.evaluate(() => navigator.clipboard.readText())).toMatch(/^http:\/\/localhost:\d+\/peraturan\?uri=.*#pasal-82$/);
  });

  it("tanpa gulir mendatar pada layar sangat sempit (320px) di semua tab", async () => {
    const p = await halaman({ hp: true, lebar: 320, tinggi: 640 });
    for (const tab of ["", "&tab=relasi", "&tab=naskah"]) {
      await p.goto(BASE + urlUU(UU13, tab), { waitUntil: "networkidle" });
      await p.waitForTimeout(150);
      expect(await p.evaluate(() => document.documentElement.scrollWidth), tab || "isi").toBeLessThanOrEqual(320);
    }
  });

  for (const tema of ["terang", "gelap"]) {
    it(`axe: halaman baca dan semua lembarnya lolos (tema ${tema})`, async () => {
      const p = await halaman({ hp: true, tema: tema === "gelap" ? "dark" : "light", bypassCSP: true });
      await bukaPeraturan(p);
      const laporan = [];
      const periksa = async (nama) => {
        const hasil = await pelanggaranAxe(p);
        if (hasil.length) laporan.push({ nama, hasil });
      };
      await periksa("halaman");

      await p.locator(".info-peraturan > summary").tap();
      await periksa("informasi terbuka");

      await p.locator(".tombol-lainnya").tap();
      await tungguLembar(p, "dialog.lembar-aksi");
      await periksa("lembar Lainnya");
      await p.keyboard.press("Escape");
      await p.waitForFunction(() => !document.querySelector("dialog.lembar"));

      await p.locator(".tombol-daftar-isi").tap();
      await tungguLembar(p, "dialog.daftar-isi");
      await p.locator("dialog.daftar-isi .grup-bab summary").nth(1).tap();
      await periksa("daftar isi");
      await p.keyboard.press("Escape");
      await p.waitForFunction(() => !document.querySelector("dialog.daftar-isi[open]"));

      await p.getByRole("button", { name: "Tampilan teks" }).tap();
      await tungguLembar(p, "dialog.lembar-tampilan");
      await periksa("tampilan teks");
      await p.keyboard.press("Escape");
      await p.waitForFunction(() => !document.querySelector("dialog.lembar"));

      await p.locator("#pasal-82 .pasal-lainnya").tap();
      await tungguLembar(p, "dialog.lembar-aksi");
      await periksa("lembar pasal");
      await p.keyboard.press("Escape");
      await p.waitForFunction(() => !document.querySelector("dialog.lembar"));

      expect(laporan).toEqual([]);
    });
  }
});

describe("layar lebar: halaman baca", () => {
  it("daftar isi menjadi kolom lengket di samping teks, bukan lembar; tombol lembar tidak tampil", async () => {
    const p = await halaman();
    await reset();
    expect((await fetch(`${BASE}/__dev/peraturan-besar?pasal=400`, { method: "POST" })).status).toBe(201);
    await bukaPeraturan(p, URI_BESAR);

    const rel = p.locator(".rel-daftar-isi");
    expect(await rel.isVisible()).toBe(true);
    const dialog = p.locator("dialog.daftar-isi");
    expect(await dialog.evaluate((el) => el.open && !el.matches(":modal"))).toBe(true);
    expect(await p.locator(".tombol-daftar-isi").isVisible()).toBe(false);
    expect(await p.evaluate(() => getComputedStyle(document.body).overflow), "kolom biasa tidak mengunci gulir halaman").not.toBe("hidden");

    // Kolom ada di kiri teks dan tidak menutupinya.
    const [kotakRel, kotakTeks] = await Promise.all([rel.boundingBox(), p.locator(".baca-utama").boundingBox()]);
    expect(kotakRel.x + kotakRel.width).toBeLessThanOrEqual(kotakTeks.x);

    // Lengket: tetap terlihat saat teks digulir jauh, dan tombol mengambang tidak muncul.
    await p.evaluate(() => window.scrollTo(0, 4000));
    await p.waitForTimeout(150);
    const atas = (await rel.boundingBox()).y;
    expect(atas).toBeGreaterThanOrEqual(0);
    expect(atas).toBeLessThan(200);
    expect(await p.locator(".fab-daftar-isi").isVisible()).toBe(false);

    // Memilih pasal dari kolom menggulir ke sana dan membiarkan kolom tetap terbuka.
    await dialog.locator(".grup-bab summary").nth(1).click();
    await dialog.locator(".kisi-pasal a", { hasText: /^75$/ }).click();
    await p.waitForFunction(() => location.hash === "#pasal-75");
    await p.waitForFunction(() => {
      const r = document.querySelector("#pasal-75")?.getBoundingClientRect();
      return r && r.top >= 100 && r.top < innerHeight * 0.5;
    });
    expect(await dialog.evaluate((el) => el.open)).toBe(true);
    await reset();
  });

  it("lebar layar berubah: di bawah 1100px kolom menjadi lembar, di atasnya kembali menjadi kolom", async () => {
    const p = await halaman();
    await bukaPeraturan(p);
    const dialog = p.locator("dialog.daftar-isi");
    expect(await dialog.evaluate((el) => el.open)).toBe(true);

    await p.setViewportSize({ width: 900, height: 800 });
    await p.waitForFunction(() => !document.querySelector("dialog.daftar-isi").open);
    expect(await p.locator(".tombol-daftar-isi").isVisible()).toBe(true);
    await p.locator(".tombol-daftar-isi").click();
    await p.locator("dialog.daftar-isi[open]").waitFor();
    expect(await dialog.evaluate((el) => el.matches(":modal"))).toBe(true);
    await p.keyboard.press("Escape");
    await p.waitForFunction(() => !document.querySelector("dialog.daftar-isi").open);

    await p.setViewportSize({ width: 1280, height: 900 });
    await p.waitForFunction(() => document.querySelector("dialog.daftar-isi").open);
    expect(await dialog.evaluate((el) => !el.matches(":modal"))).toBe(true);
    expect(await p.locator(".tombol-daftar-isi").isVisible()).toBe(false);
  });

  it("aksi pasal muncul saat disorot dengan penunjuk halus; tombol lembar untuk layar sentuh tersembunyi", async () => {
    const p = await halaman();
    await bukaPeraturan(p);
    const aksi = p.locator("#pasal-82 .pasal-aksi");
    expect(await aksi.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
    await p.hover("#pasal-82");
    await p.waitForFunction(() => getComputedStyle(document.querySelector("#pasal-82 .pasal-aksi")).opacity === "1");
    expect(await p.locator("#pasal-82 .pasal-lainnya").isVisible()).toBe(false);
    expect(await p.locator(".tombol-lainnya").isVisible()).toBe(false);
    // Semua aksi peraturan berjajar di layar lebar.
    expect((await p.locator(".aksi-bar .tombol:visible").allInnerTexts()).map((t) => t.trim()).join("|")).toBe(
      "Simpan|Salin sitasi|Salin tautan|Naskah resmi (BPK)|PDF|Laporkan kesalahan",
    );
  });

  it("pencarian di dalam peraturan tetap bekerja dan hasilnya tidak menyentuh daftar isi", async () => {
    const p = await halaman();
    await bukaPeraturan(p);
    await p.fill(".cari-dalam input", "pesangon");
    await p.waitForFunction(() => document.querySelectorAll(".pasal:not(.tidak-cocok)").length === 1);
    expect(await p.locator("dialog.daftar-isi .grup-bab").count()).toBe(3);
    expect(await p.locator(".pasal:not(.tidak-cocok) h3").textContent()).toBe("Pasal 156");
  });

  for (const tema of ["terang", "gelap"]) {
    it(`axe: halaman baca dengan kolom daftar isi lolos (tema ${tema})`, async () => {
      const p = await halaman({ tema: tema === "gelap" ? "dark" : "light", bypassCSP: true });
      await bukaPeraturan(p);
      await p.locator("dialog.daftar-isi .grup-bab summary").nth(1).click();
      expect(await pelanggaranAxe(p)).toEqual([]);
    });
  }
});
