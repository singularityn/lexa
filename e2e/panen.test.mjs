/**
 * Skrip panen BPK (scripts/bpk-console-harvest.js) dijalankan di Chromium terhadap Lexa sungguhan (pratinjau lokal) dan
 * situs BPK palsu: daftar, halaman rincian, dan PDF dilayani oleh page.route pada origin https://peraturan.bpk.go.id,
 * sedangkan Lexa dijangkau lewat alamat palsu yang diteruskan ke pratinjau. Yang diuji: penjelajahan daftar (jenis dari
 * /Jenis, halaman berikutnya, tautan ke Lexa), daftar kerja dari Lexa, pembacaan halaman rincian, pengunduhan PDF
 * (langsung dari daftar atau lewat halaman rincian), pengunggahan ke Lexa, dan sikap terhadap halaman tantangan, berkas
 * yang bukan PDF, naskah tanpa berkas, token salah, dan tombol berhenti.
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
/** Permintaan ke BPK palsu (jalur + kueri), berurutan, untuk memeriksa apa yang (tidak) dibuka skrip. */
let diminta;

beforeAll(async () => {
  ({ server, browser } = await mulaiPratinjau(PORT));
});
afterAll(async () => {
  await browser?.close();
  server?.kill();
});

const dokumen = (id, nomor, ubah = {}) => ({
  bpk_id: String(id),
  detail_url: `${BPK}/Details/${id}/pp-no-${nomor}-tahun-2025`,
  meta: { Judul: `Peraturan Pemerintah ${nomor}`, "Bentuk Singkat": "PP", Nomor: String(nomor), Tahun: "2025", Status: "Berlaku" },
  ...ubah,
});
/** Peraturan di Lexa yang belum punya tautan BPK (bpk_id kosong), seperti sebagian besar PP di produksi. */
const tanpaTautan = (nomor, tahun = 2024) => ({
  bpk_id: "",
  meta: { Judul: `Peraturan Pemerintah Nomor ${nomor} Tahun ${tahun} tentang Contoh ${nomor}`, "Bentuk Singkat": "PP", Nomor: String(nomor), Tahun: String(tahun), Status: "Berlaku" },
});

async function kirimManifest(daftar) {
  const res = await fetch(`${BASE}/api/impor/manifest`, { method: "POST", headers: adm, body: JSON.stringify({ versi: 1, dokumen: daftar }) });
  expect(res.status).toBe(200);
  return res.json();
}
const butuh = async (q = "?jenis=PP&batas=200") => (await (await fetch(`${BASE}/api/impor/butuh-teks${q}`, { headers: adm })).json()).daftar.map((d) => d.frbr_uri);
const status = async (uri) => (await fetch(`${BASE}/api/dokumen/status?uri=${encodeURIComponent(uri)}`)).json();
const detail = async (uri) => (await (await fetch(`${BASE}/api/laws/detail?uri=${encodeURIComponent(uri)}`)).json()).law;
const ringkasan = async () => (await (await fetch(`${BASE}/api/impor/ringkasan`, { headers: adm })).json()).per_jenis;

/** Halaman rincian BPK palsu: tabel metadata dan tautan unduhan. */
const rincian = (id, { tautan = true, tantangan = false, tabel = true } = {}) =>
  tantangan
    ? `<html><head><title>Just a moment...</title></head><body><div id="cf-chl-widget">Verify you are human</div><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>`
    : `<html><head><title>PP ${id}</title></head><body>
         ${tabel ? `<table><tr><th>Judul</th><td>Peraturan Pemerintah ${id}</td></tr><tr><th>Bentuk Singkat</th><td>PP</td></tr><tr><th>Status:</th><td>Berlaku</td></tr></table>` : "<p>Halaman yang tidak dikenali.</p>"}
         ${tautan ? `<a class="btn" href="/Download/${id}0/PP-${id}.pdf">Unduh</a><a href="/Home/Lain">Beranda</a>` : `<p>Tidak ada berkas.</p>`}
       </body></html>`;

/** Daftar jenis BPK palsu (/Jenis): tiga jenis dalam cakupan dengan jumlahnya, dan dua yang di luar cakupan. */
const HALAMAN_JENIS = `<html><body><h1>Jenis Peraturan</h1><ul>
  <li><a href="/Search?jenis=8">Undang-undang (UU) <span>1.950</span></a></li>
  <li><a href="/Search?jenis=9">Peraturan Pemerintah Pengganti Undang-Undang (Perpu) <span>170</span></a></li>
  <li><a href="/Search?jenis=10">Peraturan Pemerintah (PP) <span>4.991</span></a></li>
  <li><a href="/Search?jenis=13">Instruksi Presiden (Inpres) <span>700</span></a></li>
  <li><a href="/Search?jenis=245">Peraturan MPR <span>10</span></a></li>
</ul></body></html>`;

/** Kartu hasil pencarian BPK palsu. `pdf`: sertakan tautan unduhan pada kartu. */
const kartu = (id, nomor, { pdf = true, tahun = 2024 } = {}) =>
  `<div class="card"><a href="/Details/${id}/pp-no-${nomor}-tahun-${tahun}">PP No. ${nomor} Tahun ${tahun}</a><p>tentang Contoh ${nomor}</p>${pdf ? `<a href="/Download/${id}0/PP-${nomor}-${tahun}.pdf">Unduh</a>` : ""}</div>`;
const daftarHalaman = (isi, berikut = null, total = null) =>
  `<html><body>${total ? `<p>Menemukan ${total} peraturan dalam 0,002 detik</p>` : ""}<div class="hasil">${isi}</div>${berikut ? `<ul class="pagination"><li><a class="page-link" href="${berikut}" rel="next">›</a></li></ul>` : ""}</body></html>`;

beforeEach(async () => {
  const reset = await fetch(`${BASE}/__dev/reset`, { method: "POST" });
  expect(reset.status).toBe(204);
  diminta = [];
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

/**
 * Pasang BPK palsu. `halaman` memetakan "jalur" atau "jalur?kueri" ke { tipe, isi, status } (atau fungsi yang
 * mengembalikannya); kunci dengan kueri didahulukan.
 */
async function pasangBpk(halaman, mulai = "/") {
  await page.route(`${BPK}/**`, (route) => {
    const u = new URL(route.request().url());
    diminta.push(u.pathname + u.search);
    let h = halaman[u.pathname + u.search] ?? halaman[u.pathname];
    if (typeof h === "function") h = h(u);
    if (!h) return route.fulfill({ status: 404, contentType: "text/html", body: "tidak ada" });
    return route.fulfill({ status: h.status ?? 200, contentType: h.tipe ?? "text/html", body: h.isi, headers: h.header ?? {} });
  });
  await page.goto(`${BPK}${mulai}`);
  await page.addScriptTag({ content: "window.LEXA_PANEN_OTOMATIS = false;" });
  await page.addScriptTag({ content: SKRIP });
}
/** Opsi bawaan uji: tanpa jeda (jeda minimum situs sungguhan 2 detik dilewati lewat _jedaMin) dan tanpa kotak status. */
const jalankan = (opsi) => page.evaluate((o) => window.lexaPanenBpk(o), { lexa: LEXA, token: TOKEN, jeda: 1, _jedaMin: 0, _jedaUlang: 5, papan: false, ...opsi });

describe("skrip panen BPK: panen PDF", () => {
  it("mengambil PDF dari halaman rincian dan mengunggahnya; naskah yang di BPK tanpa berkas ditandai dan tak diminta lagi", async () => {
    await kirimManifest([dokumen(555, 99), dokumen(556, 98)]);
    expect((await butuh()).sort()).toEqual(["/akn/id/act/pp/2025/98", "/akn/id/act/pp/2025/99"]);
    await pasangBpk({
      "/Details/555/pp-no-99-tahun-2025": { isi: rincian(555) },
      "/Details/556/pp-no-98-tahun-2025": { isi: rincian(556, { tautan: false }) },
      "/Download/5550/PP-555.pdf": { tipe: "application/pdf", isi: PDF },
    });
    const hasil = await jalankan({ batas: 10 });
    expect(hasil.ringkas).toMatchObject({ diproses: 2, diunggah: 1, tanpaBerkas: 1, gagal: 0 });
    expect(hasil.hasil.find((b) => b.uri.endsWith("/99"))).toMatchObject({ hasil: expect.stringContaining("diunggah"), ukuran: PDF.length });
    expect(hasil.hasil.find((b) => b.uri.endsWith("/98")).hasil).toBe("tanpa berkas di BPK");

    expect(await butuh()).toEqual([]); // yang tanpa berkas tak diminta lagi
    expect(await butuh("?jenis=PP&semua=1")).toEqual(["/akn/id/act/pp/2025/98"]);
    expect((await status("/akn/id/act/pp/2025/99")).ada_pdf).toBe(true);
  });

  it("halaman rincian yang tak dikenali (tanpa tabel metadata dan tanpa tautan) dihitung gagal, bukan 'tanpa berkas'", async () => {
    await kirimManifest([dokumen(557, 97)]);
    await pasangBpk({ "/Details/557/pp-no-97-tahun-2025": { isi: rincian(557, { tautan: false, tabel: false }) } });
    const hasil = await jalankan({});
    expect(hasil.ringkas).toMatchObject({ diproses: 1, gagal: 1, tanpaBerkas: 0 });
    expect(hasil.hasil[0].hasil).toContain("tautan PDF tak ditemukan");
  });

  it("memperbarui metadata dari halaman rincian (judul resmi, status) untuk peraturan yang dipanen", async () => {
    await kirimManifest([tanpaTautan(555, 2025)]);
    await kirimManifest([{ bpk_id: "555", detail_url: `${BPK}/Details/555/pp-no-555-tahun-2025`, meta: { Judul: "Peraturan Pemerintah Nomor 555 Tahun 2025", "Bentuk Singkat": "PP", Nomor: "555", Tahun: "2025", Status: "Berlaku" } }]);
    const rinci = `<html><body><table>
      <tr><th>Judul</th><td>Peraturan Pemerintah Nomor 555 Tahun 2025 tentang Perizinan Berusaha</td></tr><tr><th>Bentuk Singkat</th><td>PP</td></tr>
      <tr><th>Nomor</th><td>555</td></tr><tr><th>Tahun</th><td>2025</td></tr><tr><th>Status</th><td>Dicabut</td></tr><tr><th>Bidang</th><td>PERIZINAN</td></tr></table>
      <a href="/Download/5550/PP-555.pdf">Unduh</a></body></html>`;
    await pasangBpk({ "/Details/555/pp-no-555-tahun-2025": { isi: rinci }, "/Download/5550/PP-555.pdf": { tipe: "application/pdf", isi: PDF } });
    const hasil = await jalankan({});
    expect(hasil.ringkas).toMatchObject({ diunggah: 1, gagal: 0 });
    expect(await detail("/akn/id/act/pp/2025/555")).toMatchObject({ judul: "Peraturan Pemerintah Nomor 555 Tahun 2025 tentang Perizinan Berusaha", status: "dicabut", bidang: "PERIZINAN", bpk_id: "555" });
  });

  it("mode kering mengunduh tetapi tidak mengunggah dan tidak menulis metadata", async () => {
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
    expect(hasil.ringkas).toMatchObject({ gagal: 5, diunggah: 0, berhentiKarena: "5 kegagalan beruntun" });
    expect((await butuh()).length).toBe(6); // tak ada yang terunggah
  });

  it("respons 503 sementara diulang, lalu berhasil; respons 403 langsung dianggap tantangan", async () => {
    await kirimManifest([dokumen(555, 99), dokumen(556, 98)]);
    let percobaan = 0;
    await pasangBpk({
      "/Details/555/pp-no-99-tahun-2025": () => (++percobaan < 3 ? { status: 503, isi: "sibuk" } : { isi: rincian(555) }),
      "/Download/5550/PP-555.pdf": { tipe: "application/pdf", isi: PDF },
      "/Details/556/pp-no-98-tahun-2025": { status: 403, isi: "<html>Access denied</html>" },
    });
    const hasil = await jalankan({ batas: 10 });
    expect(percobaan).toBe(3);
    expect(hasil.hasil.find((b) => b.uri.endsWith("/99")).hasil).toContain("diunggah");
    expect(hasil.hasil.find((b) => b.uri.endsWith("/98")).hasil).toContain("tantangan_cloudflare");
  });

  it("peraturan tanpa tautan BPK dilewati, bukan digagalkan", async () => {
    await kirimManifest([tanpaTautan(5, 2025)]);
    await pasangBpk({});
    const hasil = await jalankan({});
    expect(hasil.hasil[0].hasil).toContain("lewati");
    expect(hasil.ringkas).toMatchObject({ dilewati: 1, gagal: 0 });
  });

  it("terus: true memproses putaran demi putaran sampai daftar kerja habis", async () => {
    await kirimManifest([1, 2, 3, 4, 5].map((n) => dokumen(700 + n, 20 + n)));
    const halaman = {};
    for (const n of [1, 2, 3, 4, 5]) {
      halaman[`/Details/70${n}/pp-no-${20 + n}-tahun-2025`] = { isi: rincian(700 + n) };
      halaman[`/Download/70${n}0/PP-70${n}.pdf`] = { tipe: "application/pdf", isi: PDF };
    }
    await pasangBpk(halaman);
    const hasil = await jalankan({ batas: 2, terus: true });
    expect(hasil.ringkas).toMatchObject({ diproses: 5, diunggah: 5, gagal: 0, berhentiKarena: "daftar kerja habis" });
    expect(await butuh()).toEqual([]);
  });

  it("tanpa terus, satu putaran saja", async () => {
    await kirimManifest([1, 2, 3].map((n) => dokumen(700 + n, 20 + n)));
    const halaman = {};
    for (const n of [1, 2, 3]) {
      halaman[`/Details/70${n}/pp-no-${20 + n}-tahun-2025`] = { isi: rincian(700 + n) };
      halaman[`/Download/70${n}0/PP-70${n}.pdf`] = { tipe: "application/pdf", isi: PDF };
    }
    await pasangBpk(halaman);
    const hasil = await jalankan({ batas: 2 });
    expect(hasil.ringkas).toMatchObject({ diproses: 2, diunggah: 2 });
    expect((await butuh()).length).toBe(1);
  });

  it("tombol berhenti menghentikan putaran di antara dua peraturan", async () => {
    await kirimManifest([1, 2, 3, 4].map((n) => dokumen(700 + n, 20 + n)));
    const halaman = {};
    for (const n of [1, 2, 3, 4]) {
      halaman[`/Details/70${n}/pp-no-${20 + n}-tahun-2025`] = { isi: rincian(700 + n) };
      halaman[`/Download/70${n}0/PP-70${n}.pdf`] = { tipe: "application/pdf", isi: PDF };
    }
    await pasangBpk(halaman);
    // Berhenti segera sesudah peraturan pertama diunggah.
    await page.evaluate(() => {
      const asli = window.fetch;
      window.fetch = async (...a) => {
        const res = await asli(...a);
        if (String(a[0]).includes("/api/impor/pdf")) window.lexaPanenBerhenti();
        return res;
      };
    });
    const hasil = await jalankan({ batas: 10, jeda: 50 });
    expect(hasil.ringkas.diunggah).toBe(1);
    expect(hasil.ringkas.berhentiKarena).toBe("dihentikan");
    expect((await butuh()).length).toBe(3);
  });

  it("token salah: galat jelas sejak awal, sebelum menyentuh BPK", async () => {
    await kirimManifest([dokumen(555, 99)]);
    await pasangBpk({});
    const galat = await page.evaluate(() => window.lexaPanenBpk({ lexa: "https://lexa.test", token: "salah", papan: false }).then(() => null, (e) => e.message));
    expect(galat).toContain("Lexa 401");
    expect(diminta).toEqual(["/"]); // hanya halaman awal yang dibuka pengujinya
  });

  it("Lexa tak terjangkau (alamat salah): galat yang menyebut CORS dan alamat", async () => {
    await pasangBpk({});
    await page.route("https://lexa-salah.test/**", (route) => route.abort());
    const galat = await page.evaluate(() => window.lexaPanenBpk({ lexa: "https://lexa-salah.test", token: "x", papan: false }).then(() => null, (e) => e.message));
    expect(galat).toContain("Lexa tak terjangkau");
  });
});

describe("skrip panen BPK: penjelajahan daftar", () => {
  /** BPK palsu dengan daftar PP dua halaman: kartu 701-704 di halaman 1-2, kartu 705 (PP 99/2024) tak ada di Lexa. */
  const bpkDaftar = (tambahan = {}) => ({
    "/Jenis": { isi: HALAMAN_JENIS },
    "/Search?jenis=10": { isi: daftarHalaman(kartu(701, 1) + kartu(702, 2), "/Search?jenis=10&page=2", "4.991") },
    "/Search?jenis=10&page=2": { isi: daftarHalaman(kartu(703, 3) + kartu(704, 4, { pdf: false }) + kartu(705, 99), null) }, // tanpa tautan halaman berikutnya
    "/Search?jenis=10&page=3": { isi: "<html><body><p>Tidak ada hasil.</p></body></html>" },
    "/Search?jenis=8": { isi: daftarHalaman("") },
    "/Search?jenis=9": { isi: daftarHalaman("") },
    "/Details/704/pp-no-4-tahun-2024": { isi: rincian(704) },
    ...[1, 2, 3, 99].reduce((h, n, i) => ({ ...h, [`/Download/70${[1, 2, 3, 5][i]}0/PP-${n}-2024.pdf`]: { tipe: "application/pdf", isi: PDF } }), {}),
    "/Download/7040/PP-704.pdf": { tipe: "application/pdf", isi: PDF },
    ...tambahan,
  });

  it("jenis dalam cakupan dicari dari /Jenis, daftar dijelajahi halaman demi halaman, entri ditautkan, lalu PDF diunduh langsung dari daftar", async () => {
    await kirimManifest([1, 2, 3, 4].map((n) => tanpaTautan(n)));
    expect(await butuh()).toHaveLength(4);
    await pasangBpk(bpkDaftar());
    const hasil = await jalankan({ jelajah: true, batas: 10 });

    // Penjelajahan: lima entri PP; empat sudah ada di Lexa, PP 99/2024 dibuat. UU dan Perppu kosong; Inpres dan Peraturan MPR tak disentuh.
    expect(hasil.jelajah).toMatchObject({ entri: 5, ditautkan: 4, dibuat: 1, tidak_ada: 0, tidak_dikenali: 0, berhentiKarena: "" });
    expect(hasil.jelajah.daftar.map((d) => d.kode)).toEqual(["PERPPU", "UU", "PP"]);
    expect(hasil.jelajah.daftar.find((d) => d.kode === "PP")).toMatchObject({ halaman: 2, entri: 5, total: 4991 }); // "Menemukan 4.991 peraturan"
    expect(diminta.some((d) => d.includes("jenis=13") || d.includes("jenis=245"))).toBe(false);

    // Panen: 701-703 dan 99 (705) lewat tautan langsung di daftar, 704 (tanpa tautan di kartu) lewat halaman rinciannya.
    expect(hasil.ringkas).toMatchObject({ diproses: 5, diunggah: 5, gagal: 0 });
    expect(diminta.filter((d) => d.startsWith("/Details/"))).toEqual(["/Details/704/pp-no-4-tahun-2024"]);
    expect(await butuh()).toEqual([]);
    for (const n of [1, 2, 3, 4]) expect((await status(`/akn/id/act/pp/2024/${n}`)).ada_pdf).toBe(true);
    expect((await status("/akn/id/act/pp/2024/99")).ada_pdf).toBe(true);
    expect(await detail("/akn/id/act/pp/2024/99")).toMatchObject({ bpk_id: "705", sumber_url: `${BPK}/Details/705/pp-no-99-tahun-2024` });
    expect(await detail("/akn/id/act/pp/2024/1")).toMatchObject({ bpk_id: "701", sumber_url: `${BPK}/Details/701/pp-no-1-tahun-2024` });
  });

  it("hanyaJelajah menautkan tanpa memanen PDF; yang baru bertaut muncul di daftar kerja dengan alamat BPK", async () => {
    await kirimManifest([1, 2, 3, 4].map((n) => tanpaTautan(n)));
    const sebelum = (await ringkasan()).find((r) => r.jenis === "PP"); // data awal pratinjau sudah memuat satu PP
    await pasangBpk(bpkDaftar());
    const hasil = await jalankan({ hanyaJelajah: true, buat: false });
    expect(hasil.ringkas).toBeNull();
    expect(hasil.jelajah).toMatchObject({ entri: 5, ditautkan: 4, dibuat: 0, tidak_ada: 1 }); // PP 99/2024 tak dibuat
    expect(hasil.jelajah.contoh.tidak_ada).toEqual([expect.objectContaining({ id: "705", sitasi: "PP 99/2024" })]);
    const kerja = await (await fetch(`${BASE}/api/impor/butuh-teks?jenis=PP`, { headers: adm })).json();
    expect(kerja.tanpa_bpk).toBe(0);
    expect(kerja.daftar.map((d) => d.detail_url).sort()).toEqual([1, 2, 3, 4].map((n) => `${BPK}/Details/70${n}/pp-no-${n}-tahun-2024`));
    const sesudah = (await ringkasan()).find((r) => r.jenis === "PP");
    expect(sesudah).toMatchObject({ total: sebelum.total, bertaut_bpk: sebelum.bertaut_bpk + 4, ber_pdf: sebelum.ber_pdf });
  });

  it("kering: menjelajah dan menghitung, tetapi tidak menulis apa pun ke Lexa", async () => {
    await kirimManifest([1, 2, 3, 4].map((n) => tanpaTautan(n)));
    const sebelum = (await ringkasan()).find((r) => r.jenis === "PP");
    await pasangBpk(bpkDaftar());
    const hasil = await jalankan({ jelajah: true, kering: true, hanyaJelajah: true });
    expect(hasil.jelajah).toMatchObject({ entri: 5, ditautkan: 0, dibuat: 0 });
    expect((await ringkasan()).find((r) => r.jenis === "PP")).toEqual(sebelum);
  });

  it("halamanMaks membatasi penjelajahan; halamanAwal melanjutkan dari halaman tertentu", async () => {
    await kirimManifest([1, 2, 3, 4].map((n) => tanpaTautan(n)));
    await pasangBpk(bpkDaftar());
    const satu = await jalankan({ hanyaJelajah: true, awal: [`${BPK}/Search?jenis=10`], halamanMaks: 1 });
    expect(satu.jelajah).toMatchObject({ halaman: 1, entri: 2, ditautkan: 2 });
    const lanjut = await jalankan({ hanyaJelajah: true, awal: [`${BPK}/Search?jenis=10`], halamanAwal: 2 });
    expect(lanjut.jelajah).toMatchObject({ halaman: 1, entri: 3, ditautkan: 2, dibuat: 1 });
  });

  it("awal: alamat daftar yang diberikan sendiri; daftar yang mengulang halaman yang sama berhenti di sana", async () => {
    await kirimManifest([tanpaTautan(1), tanpaTautan(2)]);
    const sama = { isi: daftarHalaman(kartu(701, 1) + kartu(702, 2)) }; // server mengabaikan parameter page
    await pasangBpk({ "/Search?jenis=10": sama, "/Search?jenis=10&page=2": sama, "/Search?jenis=10&page=3": sama });
    const hasil = await jalankan({ hanyaJelajah: true, awal: `${BPK}/Search?jenis=10` });
    expect(hasil.jelajah).toMatchObject({ halaman: 1, entri: 2, ditautkan: 2 });
    expect(diminta.filter((d) => d.startsWith("/Search"))).toEqual(["/Search?jenis=10", "/Search?jenis=10&page=2"]);
  });

  it("dari halaman daftar yang sedang dibuka bila /Jenis dan beranda tak memuat jenis", async () => {
    await kirimManifest([tanpaTautan(1), tanpaTautan(2)]);
    await pasangBpk({ "/Search?jenis=10": { isi: daftarHalaman(kartu(701, 1) + kartu(702, 2)) }, "/Search?jenis=10&page=2": { isi: "<html><body>kosong</body></html>" } }, "/Search?jenis=10");
    const hasil = await jalankan({ hanyaJelajah: true });
    expect(hasil.jelajah.daftar.map((d) => d.nama)).toEqual(["halaman ini"]);
    expect(hasil.jelajah).toMatchObject({ entri: 2, ditautkan: 2 });
  });

  it("daftar jenis tak ditemukan: dilaporkan jelas, tanpa menulis apa pun", async () => {
    await pasangBpk({ "/Jenis": { isi: "<html><body>Halaman berubah</body></html>" } });
    const hasil = await jalankan({ hanyaJelajah: true });
    expect(hasil.jelajah).toMatchObject({ entri: 0, berhentiKarena: "daftar jenis tak ditemukan" });
  });

  it("entri yang tak dikenali, ambigu, atau di luar cakupan dilaporkan sebagai contoh dan tidak menggagalkan yang lain", async () => {
    await kirimManifest([tanpaTautan(1)]);
    const aneh = `<div class="card"><a href="/Details/801/selengkapnya">Selengkapnya</a></div>
                  <div class="card"><a href="/Details/802/perpres-no-5-tahun-2020">Perpres No. 5 Tahun 2020</a></div>`;
    await pasangBpk({ "/Jenis": { isi: HALAMAN_JENIS }, "/Search?jenis=10": { isi: daftarHalaman(kartu(701, 1) + aneh) }, "/Search?jenis=10&page=2": { isi: "<html></html>" }, "/Search?jenis=8": { isi: "<html></html>" }, "/Search?jenis=9": { isi: "<html></html>" } });
    const hasil = await jalankan({ hanyaJelajah: true });
    expect(hasil.jelajah).toMatchObject({ ditautkan: 1, tidak_dikenali: 1, luar_cakupan: 1 });
    expect(hasil.jelajah.contoh.tidak_dikenali).toEqual([expect.objectContaining({ id: "801", teks: "Selengkapnya" })]);
  });

  it("tantangan Cloudflare di tengah penjelajahan menghentikannya dengan sebab yang jelas", async () => {
    await kirimManifest([tanpaTautan(1), tanpaTautan(2)]);
    await pasangBpk({
      "/Jenis": { isi: HALAMAN_JENIS },
      "/Search?jenis=10": { isi: daftarHalaman(kartu(701, 1) + kartu(702, 2), "/Search?jenis=10&page=2") },
      "/Search?jenis=10&page=2": { status: 403, isi: "<html>Just a moment...</html>" },
      "/Search?jenis=8": { isi: "<html></html>" }, "/Search?jenis=9": { isi: "<html></html>" },
    });
    const hasil = await jalankan({ hanyaJelajah: true });
    expect(hasil.jelajah.berhentiKarena).toContain("tantangan_cloudflare");
    expect(hasil.jelajah).toMatchObject({ ditautkan: 2 }); // yang sudah dijelajahi tetap tersimpan
  });
});

describe("skrip panen BPK: analisis halaman (periksa)", () => {
  it("halaman rincian: tabel metadata dan tautan PDF", async () => {
    await pasangBpk({ "/Details/555/x": { isi: rincian(555) }, "/Download/5550/PP-555.pdf": { tipe: "application/pdf", isi: PDF } });
    await page.goto(`${BPK}/Details/555/x`);
    await page.addScriptTag({ content: "window.LEXA_PANEN_OTOMATIS = false;" });
    await page.addScriptTag({ content: SKRIP });
    const r = await page.evaluate(() => window.lexaPanenBpk({ periksa: true }));
    expect(r.meta).toEqual({ Judul: "Peraturan Pemerintah 555", "Bentuk Singkat": "PP", Status: "Berlaku" }); // titik dua di ujung label dibuang
    expect(r.tautanPdf).toEqual([{ url: `${BPK}/Download/5550/PP-555.pdf`, teks: "Unduh", skor: 3 }]);
    expect(r.tautanUnduh.map((t) => t.href)).toEqual(["/Download/5550/PP-555.pdf"]);
    expect(r.jumlahEntri).toBe(0);
  });

  it("halaman daftar: entri, tautan halaman berikutnya, dan tautan jenis", async () => {
    await pasangBpk({ "/Jenis": { isi: HALAMAN_JENIS }, "/Search?jenis=10": { isi: daftarHalaman(kartu(701, 1) + kartu(704, 4, { pdf: false }), "/Search?jenis=10&page=2", "462") } });
    await page.goto(`${BPK}/Search?jenis=10`);
    await page.addScriptTag({ content: "window.LEXA_PANEN_OTOMATIS = false;" });
    await page.addScriptTag({ content: SKRIP });
    const r = await page.evaluate(() => window.lexaPanenBpk({ periksa: true }));
    expect(r.jumlahEntri).toBe(2);
    expect(r.entri[0]).toMatchObject({ bpk_id: "701", slug: "pp-no-1-tahun-2024", teks: "PP No. 1 Tahun 2024", pdf_url: `${BPK}/Download/7010/PP-1-2024.pdf` });
    expect(r.entri[0].konteks).toContain("tentang Contoh 1");
    expect(r.entri[1].pdf_url).toBeNull();
    expect(r.halaman).toMatchObject({ nomor: 1, total: 462, relNext: true, berikut: `${BPK}/Search?jenis=10&page=2` });
  });

  it("pembantu: pemilihan jenis, nama jenis tanpa jumlah, dan halaman berikutnya tanpa tautan 'next' menaikkan parameter page", async () => {
    await pasangBpk({ "/Jenis": { isi: HALAMAN_JENIS } });
    const r = await page.evaluate(() => {
      const b = window.lexaPanenBpkBantu;
      const doc = new DOMParser().parseFromString(
        `<ul><li><a href="/Search?jenis=8">Undang-undang (UU) 1.950</a></li><li><a href="/Search?jenis=7">Undang-Undang Dasar (UUD)</a></li>
         <li><a href="/Search?jenis=6">Ketetapan MPR (TAP MPR) 41</a></li><li><a href="/Search?jenis=9">Peraturan Pemerintah Pengganti Undang-Undang (Perpu)</a></li>
         <li><a href="/Search?jenis=10">Peraturan Pemerintah (PP)</a></li><li><a href="/Search?jenis=11">Peraturan Presiden (Perpres)</a></li></ul>`, "text/html");
      return {
        jenis: b.temukanJenis(doc, "https://peraturan.bpk.go.id/Jenis").map((j) => [j.kode, j.url]),
        nama: b.namaJenis("Peraturan Pemerintah (PP) 4.991"),
        berikut: b.halamanBerikut(new DOMParser().parseFromString("<p>tanpa tautan</p>", "text/html"), "https://peraturan.bpk.go.id/Search?jenis=10&page=7", 7),
        halaman: b.nomorHalaman("https://peraturan.bpk.go.id/Search?jenis=10&page=7"),
      };
    });
    expect(r.jenis).toEqual([
      ["UUD", `${BPK}/Search?jenis=7`], ["TAP_MPR", `${BPK}/Search?jenis=6`], ["PERPPU", `${BPK}/Search?jenis=9`], ["UU", `${BPK}/Search?jenis=8`], ["PP", `${BPK}/Search?jenis=10`],
    ]);
    expect(r.nama).toBe("peraturan pemerintah (pp)");
    expect(r.berikut).toBe(`${BPK}/Search?jenis=10&page=8`);
    expect(r.halaman).toBe(7);
  });
});
