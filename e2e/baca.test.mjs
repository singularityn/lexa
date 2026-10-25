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
    expect(letak.tab, "tab Teks/PDF/Relasi/Info harus sudah terlihat").toBeLessThan(letak.tinggi * 0.75);
    expect(letak.pasal, "pasal pertama harus sudah mulai terlihat").toBeLessThan(letak.tinggi);

    const terlihat = (await p.locator(".aksi-bar > .tombol:visible").allInnerTexts()).map((t) => t.trim());
    expect(terlihat).toEqual(["Simpan", "Sitasi", "Lainnya"]);
    // Tiga tombol utama muat sebaris tanpa isi yang meluap dari tombolnya.
    const meluap = await p.locator(".aksi-bar > .tombol:visible").evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).length);
    expect(meluap).toBe(0);
    expect(await p.locator(".remah").count(), "tak ada remah roti: sidebar dan bilah bawah sudah menunjukkan tempat Anda").toBe(0);
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  it("tab Info memuat ringkasan, metadata, dan sumber naskah; tak ada akordeon yang menahan isi di bawah tombol", async () => {
    const p = await halaman({ hp: true });
    await bukaPeraturan(p);
    expect(await p.locator(".info-peraturan, .ringkasan-ai").count(), "ringkasan dan metadata tak memakan tempat di atas teks").toBe(0);
    await p.locator("#tab-info").tap();
    await p.locator("#panel-info:not([hidden]) .metadata").waitFor();
    const teks = await p.locator("#panel-info .metadata").innerText();
    expect(teks).toContain("13 / 2003");
    expect(teks).toContain("Undang-Undang");
    expect(await p.locator("#panel-info .ringkasan-ai").count()).toBe(1);
    expect(await p.locator("#panel-info").getByRole("link", { name: "Naskah resmi (BPK)" }).count()).toBe(1);
    // Tautan lama ke tab Naskah bermuara di Info.
    await p.goto(BASE + urlUU(UU13, "&tab=naskah"), { waitUntil: "networkidle" });
    expect(await p.locator('[role="tab"][aria-selected="true"]').textContent()).toBe("Info");
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
    await p.locator("#tab-info").tap();
    await p.waitForSelector("#panel-info:not([hidden])");
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
      json.penjelasan = []; // data lama: penjelasan hanya tersimpan sebagai pasal kembar
      const babAkhir = json.articles.at(-1).bab;
      const kembar = (nomor, isi) => ({ ...json.articles.find((a) => a.nomor_pasal === nomor), id: `${UU13}#pasal-${nomor}~2`, ayat: null, bab: babAkhir, isi, urutan: 100 + Number(nomor) });
      json.articles.push(kembar("1", "Cukup jelas."), kembar("77", "Yang dimaksud dengan waktu kerja adalah jam kerja."), kembar("156", "Cukup jelas."));
    });
    await bukaPeraturan(p);

    expect(await p.locator(".meta-baris").innerText()).toContain("5 pasal");
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

  it("rujukan ke pasal lain di peraturan yang sama menjadi tautan; rujukan ke peraturan lain atau pasal yang tak ada tidak", async () => {
    const p = await halaman({ hp: true });
    await ubahDetail(p, (json) => {
      json.articles.find((a) => a.nomor_pasal === "79").isi =
        "Cuti sebagaimana dimaksud dalam Pasal 82 ayat (1) dan Pasal 156 mengikuti Pasal 77 Undang-Undang Nomor 1 Tahun 1974, serta Pasal 999 dan Pasal 77 ayat (2) Undang-Undang ini.";
    });
    await bukaPeraturan(p);
    const tautan = p.locator("#pasal-79 a.rujukan");
    expect(await tautan.allTextContents()).toEqual(["Pasal 82 ayat (1)", "Pasal 156", "Pasal 77 ayat (2)"]);
    expect(await tautan.evaluateAll((els) => els.map((el) => el.getAttribute("href")))).toEqual(["#pasal-82-ayat-1", "#pasal-156", "#pasal-77-ayat-2"]);
    // Teks di sekitarnya utuh, dan rujukan luar tetap teks biasa.
    expect(await p.locator("#pasal-79 .ayat .isi").textContent()).toContain("Pasal 77 Undang-Undang Nomor 1 Tahun 1974, serta Pasal 999 dan ");

    await p.evaluate(() => { window.__tanda = "spa"; });
    await tautan.nth(0).tap();
    await p.waitForFunction(() => location.hash === "#pasal-82-ayat-1");
    await p.waitForFunction(() => {
      const r = document.getElementById("pasal-82-ayat-1")?.getBoundingClientRect();
      return r && r.top >= 56 && r.top < innerHeight * 0.6;
    });
    expect(await p.evaluate(() => window.__tanda), "tautan jangkar tidak memuat ulang halaman").toBe("spa");
  });

  it("peraturan perubahan tidak menautkan rujukan: 'Pasal N' di dalamnya menunjuk pasal peraturan yang diubah", async () => {
    const p = await halaman({ hp: true });
    await ubahDetail(p, (json) => {
      json.law.judul = "Undang-Undang Republik Indonesia Nomor 13 Tahun 2003 tentang Perubahan Atas Undang-Undang Nomor 7 Tahun 1992 tentang Perbankan";
      json.articles.find((a) => a.nomor_pasal === "79").isi = "Ketentuan Pasal 82 ayat (1) dan Pasal 156 diubah sehingga berbunyi sebagai berikut.";
    });
    await bukaPeraturan(p);
    expect(await p.locator("#pasal-79 .ayat .isi").textContent()).toContain("Ketentuan Pasal 82 ayat (1) dan Pasal 156 diubah");
    expect(await p.locator(".isi-baca a.rujukan").count()).toBe(0);
  });

  for (const tema of ["terang", "gelap"]) {
    it(`axe: tautan rujukan di dalam teks dapat dibedakan tanpa warna (tema ${tema})`, async () => {
      const p = await halaman({ hp: true, tema: tema === "gelap" ? "dark" : "light", bypassCSP: true });
      await ubahDetail(p, (json) => {
        json.articles.find((a) => a.nomor_pasal === "79").isi = "Cuti sebagaimana dimaksud dalam Pasal 82 ayat (1) dan Pasal 156 tetap berlaku.";
      });
      await bukaPeraturan(p);
      expect(await p.locator("#pasal-79 a.rujukan").count()).toBe(2);
      expect(await pelanggaranAxe(p)).toEqual([]);
    });
  }

  it("lanjutkan membaca: pasal terakhir dibaca disimpan di perangkat dan ditawarkan pada kunjungan berikutnya", async () => {
    const p = await halaman({ hp: true });
    await reset();
    expect((await fetch(`${BASE}/__dev/peraturan-besar?pasal=400`, { method: "POST" })).status).toBe(201);
    await bukaPeraturan(p, URI_BESAR);
    const posisi = () => p.evaluate(() => JSON.parse(localStorage.getItem("lexa:riwayat:v1") ?? "{}").posisi ?? []);
    expect(await p.locator(".lanjut-baca").count(), "belum pernah dibaca").toBe(0);

    // Gulir di dekat puncak tidak dicatat; gulir jauh dicatat setelah berhenti.
    await p.evaluate(() => window.scrollTo(0, 120));
    await p.waitForTimeout(800);
    expect(await posisi()).toEqual([]);
    await p.evaluate(() => window.scrollTo(0, 6000));
    await p.waitForFunction(() => (JSON.parse(localStorage.getItem("lexa:riwayat:v1") ?? "{}").posisi ?? []).length === 1);
    const [simpanan] = await posisi();
    expect(simpanan.uri).toBe(URI_BESAR);
    expect(simpanan.nama).toMatch(/^Pasal \d+$/);
    expect(Number(simpanan.nama.replace("Pasal ", ""))).toBeGreaterThan(10);

    // Kunjungan berikutnya menawarkan; "Lanjutkan" menggulir ke pasal itu dan menutup tawaran.
    await p.goto(BASE + urlUU(URI_BESAR), { waitUntil: "networkidle" });
    await p.waitForSelector(".pasal");
    const kartu = p.locator(".lanjut-baca");
    expect(await kartu.innerText()).toContain(simpanan.nama);
    await kartu.getByRole("button", { name: "Lanjutkan", exact: true }).tap();
    await p.waitForFunction((j) => location.hash === `#${j}`, simpanan.jangkar);
    await p.waitForFunction((j) => {
      const r = document.getElementById(j)?.getBoundingClientRect();
      return r && r.top >= 56 && r.top < innerHeight * 0.6;
    }, simpanan.jangkar);
    expect(await p.locator(".lanjut-baca").count()).toBe(0);

    // Tidak ditawarkan bila pembaca datang membawa tujuan sendiri: tautan ke pasal atau hasil pencarian.
    await p.goto(BASE + urlUU(URI_BESAR, "#pasal-5"), { waitUntil: "networkidle" });
    await p.waitForSelector(".pasal");
    expect(await p.locator(".lanjut-baca").count()).toBe(0);
    await p.goto(BASE + urlUU(URI_BESAR, "&q=ketentuan"), { waitUntil: "networkidle" });
    await p.waitForSelector(".pasal");
    expect(await p.locator(".lanjut-baca").count()).toBe(0);
    await reset();
  });

  it("tawaran lanjutkan membaca dapat ditutup dan tidak muncul untuk peraturan lain", async () => {
    const p = await halaman({ hp: true });
    await reset();
    expect((await fetch(`${BASE}/__dev/peraturan-besar?pasal=400`, { method: "POST" })).status).toBe(201);
    await p.addInitScript((uri) => {
      if (!localStorage.getItem("lexa:riwayat:v1")) localStorage.setItem("lexa:riwayat:v1", JSON.stringify({ posisi: [{ uri, jangkar: "pasal-60", nama: "Pasal 60", waktu: 1 }] }));
    }, URI_BESAR);
    await bukaPeraturan(p, URI_BESAR);
    const kartu = p.locator(".lanjut-baca");
    expect(await kartu.innerText()).toContain("Pasal 60");
    await kartu.getByRole("button", { name: "Tutup tawaran lanjutkan membaca" }).tap();
    expect(await p.locator(".lanjut-baca").count()).toBe(0);
    // UU 13/2003 tidak punya posisi tersimpan.
    await p.goto(BASE + urlUU(UU13), { waitUntil: "networkidle" });
    await p.waitForSelector(".pasal");
    expect(await p.locator(".lanjut-baca").count()).toBe(0);
    await reset();
  });

  it("membuka peraturan tanpa menggulir lalu pergi tidak menimpa posisi yang tersimpan", async () => {
    const p = await halaman({ hp: true });
    await reset();
    expect((await fetch(`${BASE}/__dev/peraturan-besar?pasal=400`, { method: "POST" })).status).toBe(201);
    await p.addInitScript((uri) => {
      if (!localStorage.getItem("lexa:riwayat:v1")) localStorage.setItem("lexa:riwayat:v1", JSON.stringify({ posisi: [{ uri, jangkar: "pasal-60", nama: "Pasal 60", waktu: 1 }] }));
    }, URI_BESAR);
    await bukaPeraturan(p, URI_BESAR);
    await p.locator(".nav-bawah a[href='/telusuri']").tap();
    await p.waitForSelector(".daftar-hasil .hasil");
    const posisi = await p.evaluate(() => JSON.parse(localStorage.getItem("lexa:riwayat:v1") ?? "{}").posisi);
    expect(posisi).toEqual([{ uri: URI_BESAR, jangkar: "pasal-60", nama: "Pasal 60", waktu: 1 }]);
    await reset();
  });

  it("posisi di awal peraturan (tiga pasal pertama) tidak ditawarkan", async () => {
    const p = await halaman({ hp: true });
    await reset();
    expect((await fetch(`${BASE}/__dev/peraturan-besar?pasal=400`, { method: "POST" })).status).toBe(201);
    await p.addInitScript((uri) => {
      if (!localStorage.getItem("lexa:riwayat:v1")) localStorage.setItem("lexa:riwayat:v1", JSON.stringify({ posisi: [{ uri, jangkar: "pasal-2", nama: "Pasal 2", waktu: 1 }] }));
    }, URI_BESAR);
    await bukaPeraturan(p, URI_BESAR);
    expect(await p.locator(".lanjut-baca").count()).toBe(0);
    await reset();
  });

  it("Bagikan: lembar bagikan perangkat menerima sitasi dan tautan, untuk peraturan maupun pasal", async () => {
    const p = await halaman({ hp: true });
    await p.addInitScript(() => {
      navigator.share = async (data) => {
        (window.__bagikan ??= []).push(data);
      };
    });
    await bukaPeraturan(p);
    await p.locator(".tombol-lainnya").tap();
    await p.locator("dialog.lembar-aksi .aksi-baris", { hasText: "Bagikan…" }).tap();
    await p.waitForFunction(() => window.__bagikan?.length === 1);
    const [peraturan] = await p.evaluate(() => window.__bagikan);
    expect(peraturan.text).toBe("UU 13/2003 tentang Ketenagakerjaan");
    expect(peraturan.url).toMatch(/^http:\/\/localhost:\d+\/peraturan\?uri=.*uu%2F2003%2F13$/);

    await p.locator("#pasal-82 .pasal-lainnya").tap();
    await p.locator("dialog.lembar-aksi .aksi-baris", { hasText: "Bagikan pasal ini" }).tap();
    await p.waitForFunction(() => window.__bagikan?.length === 2);
    const pasal = (await p.evaluate(() => window.__bagikan))[1];
    expect(pasal.text).toMatch(/^UU 13\/2003 Pasal 82: \(1\) Pekerja perempuan berhak memperoleh istirahat/);
    expect(pasal.text.length, "cuplikan dipotong, bukan seluruh pasal").toBeLessThan(230);
    expect(pasal.url).toMatch(/#pasal-82$/);
  });

  it("Bagikan: dibatalkan pengguna bukan galat; gagal sungguhan memberi tahu; tanpa dukungan perangkat tombolnya tidak ada", async () => {
    const p = await halaman({ hp: true });
    await p.addInitScript(() => {
      let panggilan = 0;
      navigator.share = async () => {
        panggilan++;
        throw panggilan === 1 ? new DOMException("dibatalkan", "AbortError") : new DOMException("ditolak", "NotAllowedError");
      };
    });
    await bukaPeraturan(p);
    const bagikan = async () => {
      await p.locator(".tombol-lainnya").tap();
      await p.locator("dialog.lembar-aksi .aksi-baris", { hasText: "Bagikan…" }).tap();
      await p.waitForFunction(() => !document.querySelector("dialog.lembar"));
    };
    await bagikan();
    await p.waitForTimeout(150);
    expect(await p.locator(".toast").count(), "batal tanpa pesan").toBe(0);
    await bagikan();
    await p.locator(".toast", { hasText: "Berbagi gagal" }).waitFor();

    const tanpa = await halaman({ hp: true });
    await tanpa.addInitScript(() => {
      delete Navigator.prototype.share;
      delete navigator.share;
    });
    await bukaPeraturan(tanpa);
    await tanpa.locator(".tombol-lainnya").tap();
    await tanpa.locator("dialog.lembar-aksi").waitFor();
    expect(await tanpa.locator("dialog.lembar-aksi .aksi-baris", { hasText: "Bagikan" }).count()).toBe(0);
    expect(await tanpa.locator("dialog.lembar-aksi .aksi-baris", { hasText: "Salin tautan" }).count()).toBe(1);
  });

  it("'Cetak atau simpan PDF' membuka dialog cetak peramban", async () => {
    const p = await halaman({ hp: true });
    await p.addInitScript(() => {
      window.print = () => {
        window.__cetak = (window.__cetak ?? 0) + 1;
      };
    });
    await bukaPeraturan(p);
    await p.locator(".tombol-lainnya").tap();
    await p.locator("dialog.lembar-aksi .aksi-baris", { hasText: "Cetak atau simpan PDF" }).tap();
    await p.waitForFunction(() => window.__cetak === 1);
  });

  it("tandai pasal: tersimpan di koleksi perangkat, tampil di Koleksi, membuka pasalnya, dan bisa dilepas", async () => {
    const p = await halaman({ hp: true });
    await bukaPeraturan(p);
    const tombol = p.locator("#pasal-82 .pasal-alat > .tombol[aria-pressed]");
    expect(await tombol.getAttribute("aria-pressed")).toBe("false");
    expect(await tombol.locator(".sr-only").textContent()).toBe("Simpan ke koleksi: UU 13/2003 Pasal 82");
    const kotak = await tombol.boundingBox();
    expect(Math.min(kotak.width, kotak.height), "target ketuk minimal 36px").toBeGreaterThanOrEqual(36);

    await tombol.tap();
    await p.locator(".toast", { hasText: "Disimpan di perangkat ini." }).waitFor();
    expect(await tombol.getAttribute("aria-pressed")).toBe("true");
    const tersimpan = await p.evaluate(() => JSON.parse(localStorage.getItem("lexa:koleksi:v1") ?? "[]"));
    expect(tersimpan).toHaveLength(1);
    expect(tersimpan[0]).toMatchObject({ uri: `${UU13}#pasal-82`, sitasi: "UU 13/2003 Pasal 82", judul: "Ketenagakerjaan" });
    // Pasal lain dan peraturannya sendiri tidak ikut tertanda.
    expect(await p.locator("#pasal-77 .pasal-alat > .tombol[aria-pressed]").getAttribute("aria-pressed")).toBe("false");
    expect((await p.locator(".aksi-bar > .tombol:visible").first().innerText()).trim()).toBe("Simpan");

    await p.locator(".nav-bawah a[href='/koleksi']").tap();
    const entri = p.locator(".entri-koleksi");
    await entri.waitFor();
    expect(await entri.locator("a.sitasi").textContent()).toBe("UU 13/2003 Pasal 82");
    expect(await entri.locator(".lencana-pasal").textContent()).toBe("Pasal");
    expect(await entri.locator("a.sitasi").getAttribute("href")).toBe(`/peraturan?uri=${encodeURIComponent(UU13)}#pasal-82`);

    await entri.locator("a.sitasi").tap();
    await p.waitForSelector("#pasal-82");
    await p.waitForFunction(() => location.hash === "#pasal-82");
    await p.waitForFunction(() => {
      const r = document.getElementById("pasal-82")?.getBoundingClientRect();
      return r && r.top >= 56 && r.top < innerHeight * 0.6;
    });
    expect(await p.locator("#pasal-82 .pasal-alat > .tombol[aria-pressed]").getAttribute("aria-pressed")).toBe("true");

    // Dilepas dari Koleksi: tandanya hilang di pasal.
    await p.locator(".nav-bawah a[href='/koleksi']").tap();
    await p.locator(".entri-koleksi button", { hasText: "Lepas" }).tap();
    await p.waitForSelector(".kosong");
    await p.goBack();
    await p.waitForSelector("#pasal-82");
    expect(await p.locator("#pasal-82 .pasal-alat > .tombol[aria-pressed]").getAttribute("aria-pressed")).toBe("false");
  });

  it("simpan untuk luring: lencana di peraturan, daftar dan penghapusan di Akun, penanda di Koleksi", async () => {
    const p = await halaman({ hp: true });
    await bukaPeraturan(p);
    expect(await p.locator(".lencana-luring").first().isVisible()).toBe(false);

    await p.locator(".tombol-lainnya").tap();
    await p.locator("dialog.lembar-aksi .aksi-baris", { hasText: "Simpan untuk dibaca luring" }).tap();
    await p.locator(".toast", { hasText: "Tersimpan untuk dibaca luring" }).waitFor();
    await p.locator(".meta-baris .lencana-luring").waitFor({ state: "visible" });
    const kunci = await p.evaluate(async () => (await (await caches.open("lexa-simpan-v1")).keys()).map((r) => new URL(r.url).pathname).sort());
    expect(kunci).toEqual(["/api/dokumen/status", "/api/laws/detail", "/api/relasi/graf"]);

    // Lembar Lainnya kini menawarkan penghapusan.
    await p.locator(".tombol-lainnya").tap();
    expect(await p.locator("dialog.lembar-aksi .aksi-baris", { hasText: "Hapus dari simpanan luring" }).count()).toBe(1);
    await p.keyboard.press("Escape");
    await p.waitForFunction(() => !document.querySelector("dialog.lembar"));

    // Koleksi: peraturan dan pasalnya diberi penanda "Tersedia luring".
    await p.locator(".aksi-bar > .tombol").first().tap(); // Simpan peraturan
    await p.locator("#pasal-82 .pasal-alat > .tombol[aria-pressed]").tap();
    await p.locator(".nav-bawah a[href='/koleksi']").tap();
    await p.locator(".entri-koleksi").first().waitFor();
    expect(await p.locator(".entri-koleksi .lencana-luring").count()).toBe(2);

    // Akun: kartu simpanan dengan judul dan ukuran; dihapus dari sana.
    await p.locator(".nav-bawah a[href='/akun']").tap();
    const baris = p.locator(".daftar-luring li");
    await baris.first().waitFor();
    expect(await baris.count()).toBe(1);
    expect(await baris.first().innerText()).toContain("UU 13/2003");
    expect(await baris.first().innerText()).toMatch(/\d+ (B|KB)/);
    expect(await p.locator(".daftar-luring").locator("xpath=preceding-sibling::p[1]").textContent()).toMatch(/^1 peraturan tersimpan di perangkat ini \(\d+ (B|KB)\)/);
    await baris.first().getByRole("button", { name: /Hapus UU 13\/2003/ }).tap();
    await p.waitForFunction(() => document.querySelectorAll(".daftar-luring li").length === 0);
    expect(await p.evaluate(async () => (await (await caches.open("lexa-simpan-v1")).keys()).length)).toBe(0);
    expect(await p.locator(".nav-bawah a[href='/akun']").count()).toBe(1);
  });

  it("beranda: peraturan yang sudah dibaca cukup jauh dibuka langsung di pasal terakhir yang dibaca", async () => {
    const p = await halaman({ hp: true });
    await p.addInitScript((uri) => {
      if (!localStorage.getItem("lexa:riwayat:v1")) {
        localStorage.setItem(
          "lexa:riwayat:v1",
          JSON.stringify({
            dilihat: [{ uri, sitasi: "UU 13/2003", judul: "Ketenagakerjaan", waktu: 2 }, { uri: "/akn/id/act/uu/2020/11", sitasi: "UU 11/2020", judul: "Cipta Kerja", waktu: 1 }],
            posisi: [{ uri, jangkar: "pasal-82", nama: "Pasal 82", waktu: 2 }],
          }),
        );
      }
    }, UU13);
    await p.goto(BASE + "/", { waitUntil: "networkidle" });
    const entri = p.locator("#h-dilihat ~ .daftar-ringkas li");
    expect(await entri.count()).toBe(2);
    expect(await entri.nth(0).innerText()).toContain("lanjut di Pasal 82");
    expect(await entri.nth(0).locator("a").getAttribute("href")).toBe(`/peraturan?uri=${encodeURIComponent(UU13)}#pasal-82`);
    expect(await entri.nth(1).innerText()).not.toContain("lanjut di");
    expect(await entri.nth(1).locator("a").getAttribute("href")).toBe(`/peraturan?uri=${encodeURIComponent("/akn/id/act/uu/2020/11")}`);
    await entri.nth(0).locator("a").tap();
    await p.waitForSelector("#pasal-82");
    await p.waitForFunction(() => location.hash === "#pasal-82");
  });

  it("penjelasan umum yang terbawa di teks pasal terakhir dipisah menjadi bagiannya sendiri", async () => {
    const p = await halaman({ hp: true });
    await ubahDetail(p, (json) => {
      json.penjelasan = []; // data lama: Penjelasan Umum terbawa di teks pasal terakhir
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
    expect(await p.locator(".meta-baris").innerText()).toContain("5 pasal");

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
    await p.locator("#tab-info").tap();
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
    // Membuka PDF di halaman pasal ini ada di kepala pasal ("hal. N"), bukan di lembar ini.
    expect((await lembar.locator(".aksi-baris .aksi-teks > span:first-child").allTextContents())).toEqual([
      "Salin teks pasal", "Salin kutipan lengkap", "Salin pasal beserta penjelasannya", "Salin sitasi", "Salin tautan ke pasal ini", "Laporkan kesalahan",
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
    for (const tab of ["", "&tab=pdf", "&tab=relasi", "&tab=info"]) {
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

      await p.locator("#tab-info").tap();
      await periksa("tab Info");
      await p.locator("#tab-isi").tap();

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

describe("penjelasan resmi di bawah pasal (tabel penjelasan)", () => {
  it("Penjelasan Umum: lipatan tertutup di awal teks, dibuka dengan ketukan; tautan langsung membukanya", async () => {
    const p = await halaman({ hp: true });
    await bukaPeraturan(p);
    const umum = p.locator("details#penjelasan-umum");
    expect(await umum.locator("summary").textContent()).toBe("Penjelasan Umum");
    expect(await umum.evaluate((el) => el.open)).toBe(false);
    expect(await p.evaluate(() => document.querySelector("#penjelasan-umum").compareDocumentPosition(document.querySelector(".pasal")) & Node.DOCUMENT_POSITION_FOLLOWING), "di atas pasal pertama").toBeTruthy();
    expect(await umum.locator(".penjelasan-isi").isVisible()).toBe(false);
    await umum.locator("summary").tap();
    expect(await umum.locator(".penjelasan-isi").isVisible()).toBe(true);
    expect(await umum.locator(".penjelasan-isi").innerText()).toContain("Pembangunan ketenagakerjaan merupakan bagian integral");
    expect(await umum.locator(".penjelasan-isi p").count(), "dua paragraf").toBe(2);

    await p.goto(BASE + urlUU(UU13) + "#penjelasan-umum", { waitUntil: "networkidle" });
    await p.waitForSelector(".pasal");
    expect(await p.locator("details#penjelasan-umum").evaluate((el) => el.open)).toBe(true);
  });

  it("penjelasan sebuah pasal ada di bawah pasalnya sebagai lipatan; label ayat dan huruf ditata sebagai label", async () => {
    const p = await halaman({ hp: true });
    await bukaPeraturan(p);
    const pasal = p.locator("#pasal-82");
    const lipatan = pasal.locator("details.penjelasan");
    expect(await lipatan.count()).toBe(1);
    expect(await lipatan.locator("summary").textContent()).toBe("Penjelasan");
    expect(await lipatan.evaluate((el) => el.open)).toBe(false);
    expect(await pasal.evaluate((el) => el.lastElementChild.classList.contains("penjelasan")), "tepat di bawah teks pasal").toBe(true);
    await lipatan.locator("summary").tap();
    expect(await lipatan.locator(".label-bagian").allTextContents()).toEqual(["Ayat (1)", "Ayat (2)"]);
    expect(await lipatan.locator(".penjelasan-isi").innerText()).toContain("Yang dimaksud dengan “istirahat” adalah masa pekerja perempuan tidak bekerja karena persalinan");
    // Pasal 77: label bersarang (Ayat (2) > Huruf a/b).
    await p.locator("#pasal-77 details.penjelasan summary").tap();
    expect(await p.locator("#pasal-77 details.penjelasan .label-bagian").allTextContents()).toEqual(["Ayat (1)", "Ayat (2)", "Huruf a", "Huruf b"]);
  });

  it("penjelasan yang hanya 'Cukup jelas' menjadi penanda kecil tanpa lipatan; pasal tanpa penjelasan tak punya apa pun", async () => {
    const p = await halaman({ hp: true });
    await bukaPeraturan(p);
    for (const id of ["pasal-1", "pasal-156"]) {
      expect(await p.locator(`#${id} .penjelasan-ringkas`).textContent(), id).toBe("Penjelasan: cukup jelas");
      expect(await p.locator(`#${id} details`).count(), id).toBe(0);
    }
    expect(await p.locator("#pasal-79 .penjelasan, #pasal-79 .penjelasan-ringkas").count()).toBe(0);
  });

  it("peraturan tanpa penjelasan tersimpan: tak ada elemen penjelasan, dan kepala tidak menyebut penjelasannya", async () => {
    const p = await halaman({ hp: true });
    await ubahDetail(p, (json) => {
      json.penjelasan = [];
    });
    await bukaPeraturan(p);
    expect(await p.locator(".penjelasan, .penjelasan-ringkas, #penjelasan-umum").count()).toBe(0);
    expect(await p.locator(".meta-baris").innerText()).not.toContain("penjelasannya");
    // Jawaban lama yang tersimpan di perangkat tidak memuat `penjelasan` sama sekali.
    const lama = await halaman({ hp: true });
    await ubahDetail(lama, (json) => {
      delete json.penjelasan;
    });
    await bukaPeraturan(lama);
    expect(await lama.locator(".penjelasan, .penjelasan-ringkas").count()).toBe(0);
  });

  it("pencarian di dalam peraturan menemukan istilah yang hanya ada di penjelasan, dan membuka lipatannya", async () => {
    const p = await halaman();
    await bukaPeraturan(p);
    expect(await p.locator("#pasal-77 details.penjelasan").evaluate((el) => el.open)).toBe(false);
    await p.fill(".cari-dalam input", "dihitung di luar waktu istirahat");
    await p.waitForFunction(() => document.querySelectorAll(".pasal:not(.tidak-cocok)").length === 1);
    expect(await p.locator(".pasal:not(.tidak-cocok) h3").textContent()).toBe("Pasal 77");
    expect(await p.locator("#pasal-77 details.penjelasan").evaluate((el) => el.open), "lipatan yang memuat istilah terbuka").toBe(true);
    expect(await p.locator("#pasal-77 details.penjelasan mark").first().isVisible()).toBe(true);
  });

  it("salin kutipan lengkap dan salin pasal beserta penjelasannya (lembar aksi di ponsel)", async () => {
    const p = await halaman({ hp: true });
    await bukaPeraturan(p);
    await p.locator("#pasal-82 .pasal-lainnya").tap();
    await p.locator("dialog.lembar-aksi .aksi-baris", { hasText: "Salin kutipan lengkap" }).tap();
    await p.waitForFunction(() => !document.querySelector("dialog.lembar"));
    const kutipan = await p.evaluate(() => navigator.clipboard.readText());
    expect(kutipan.startsWith("Pasal 82 Undang-Undang Nomor 13 Tahun 2003 tentang Ketenagakerjaan\n\n(1) Pekerja perempuan berhak memperoleh istirahat")).toBe(true);
    expect(kutipan).toContain("(2) Pekerja perempuan yang mengalami keguguran");
    expect(kutipan).toMatch(/\n\nhttp:\/\/localhost:\d+\/peraturan\?uri=.*#pasal-82$/);
    expect(kutipan).not.toContain("Penjelasan");

    await p.locator("#pasal-82 .pasal-lainnya").tap();
    await p.locator("dialog.lembar-aksi .aksi-baris", { hasText: "Salin pasal beserta penjelasannya" }).tap();
    await p.waitForFunction(() => !document.querySelector("dialog.lembar"));
    const lengkap = await p.evaluate(() => navigator.clipboard.readText());
    expect(lengkap.startsWith(kutipan + "\n\nPenjelasan Pasal 82:\nAyat (1)\nYang dimaksud dengan “istirahat”")).toBe(true);
    expect(lengkap.endsWith("Ayat (2)\nCukup jelas.")).toBe(true);

    // Pasal yang penjelasannya hanya "Cukup jelas" atau tak ada tidak menawarkan salinan beserta penjelasan.
    for (const id of ["pasal-1", "pasal-79"]) {
      await p.locator(`#${id} .pasal-lainnya`).tap();
      expect(await p.locator("dialog.lembar-aksi .aksi-baris", { hasText: "Salin pasal beserta penjelasannya" }).count(), id).toBe(0);
      expect(await p.locator("dialog.lembar-aksi .aksi-baris", { hasText: "Salin kutipan lengkap" }).count(), id).toBe(1);
      await p.keyboard.press("Escape");
      await p.waitForFunction(() => !document.querySelector("dialog.lembar"));
    }
  });

  it("layar lebar: ikon 'Salin kutipan lengkap' ada di baris aksi pasal dan menyalin kutipannya", async () => {
    const p = await halaman();
    await bukaPeraturan(p);
    await p.hover("#pasal-156");
    const tombol = p.locator('#pasal-156 .pasal-aksi button[aria-label="Salin kutipan lengkap Pasal 156"]');
    expect(await tombol.getAttribute("title")).toContain("kutipan lengkap");
    await tombol.click();
    const kutipan = await p.evaluate(() => navigator.clipboard.readText());
    expect(kutipan.startsWith("Pasal 156 Undang-Undang Nomor 13 Tahun 2003 tentang Ketenagakerjaan\n\n(1) Dalam hal terjadi pemutusan hubungan kerja")).toBe(true);
    expect(kutipan.endsWith("#pasal-156")).toBe(true);
  });

  for (const tema of ["terang", "gelap"]) {
    it(`axe: lipatan penjelasan terbuka lolos (tema ${tema})`, async () => {
      const p = await halaman({ tema: tema === "gelap" ? "dark" : "light", bypassCSP: true });
      await bukaPeraturan(p);
      await p.locator("details#penjelasan-umum summary").click();
      await p.locator("#pasal-82 details.penjelasan summary").click();
      expect(await pelanggaranAxe(p)).toEqual([]);
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
    // Di layar lebar pun hanya tiga aksi di bilah (yang paling sering dipakai); sisanya satu lembar "Lainnya".
    expect((await p.locator(".aksi-bar .tombol:visible").allInnerTexts()).map((t) => t.trim()).join("|")).toBe("Simpan|Salin sitasi|Lainnya");
  });

  it("cetak: hanya judul dan teks seluruh pasal, tanpa navigasi, tombol, atau daftar isi", async () => {
    const p = await halaman();
    await reset();
    expect((await fetch(`${BASE}/__dev/peraturan-besar?pasal=400`, { method: "POST" })).status).toBe(201);
    await bukaPeraturan(p, URI_BESAR);
    await p.emulateMedia({ media: "print" });
    const gaya = await p.evaluate(() => {
      const d = (s) => getComputedStyle(document.querySelector(s)).display;
      return {
        header: d("#app > header"), aksi: d(".aksi-bar"), tab: d(".tab-daftar"), rel: d(".rel-daftar-isi"), alat: d(".alat-baca"), nav: d(".nav-bawah"),
        judul: d("h1.judul-peraturan"), pasal: d(".pasal"), cv: getComputedStyle(document.querySelector(".pasal")).contentVisibility,
        latar: getComputedStyle(document.body).backgroundColor, lebarTeks: document.querySelector(".isi-peraturan").getBoundingClientRect().width,
        lebarHalaman: innerWidth,
      };
    });
    for (const k of ["header", "aksi", "tab", "rel", "alat", "nav"]) expect(gaya[k], k).toBe("none");
    expect(gaya.judul).not.toBe("none");
    expect(gaya.pasal).not.toBe("none");
    expect(gaya.cv, "pasal di luar layar tetap tercetak").toBe("visible");
    expect(gaya.latar).toBe("rgb(255, 255, 255)");
    expect(gaya.lebarTeks, "teks memakai lebar halaman, bukan kolom 72ch").toBeGreaterThan(gaya.lebarHalaman * 0.9);

    // Seluruh 200 pasal masuk PDF: jumlah halaman jauh di atas satu layar.
    const pdf = await p.pdf({ format: "A4" });
    const jumlahHalaman = (pdf.toString("latin1").match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;
    expect(jumlahHalaman, `halaman PDF: ${jumlahHalaman}`).toBeGreaterThanOrEqual(8);
    await reset();
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
