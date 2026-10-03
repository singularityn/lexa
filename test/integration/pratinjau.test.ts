/**
 * Pratinjau tautan halaman peraturan (GET /peraturan?uri=…): Worker menyajikan cangkang SPA
 * (public/index.html sungguhan lewat ASSETS tiruan) dengan judul, deskripsi, dan gambar yang
 * disuntikkan dari data peraturan, supaya WhatsApp, Telegram, dan mesin pencari yang tidak
 * menjalankan JavaScript menampilkan sesuatu yang berarti. Apa pun yang gagal harus menghasilkan
 * cangkang biasa, tidak pernah galat.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pratinjauPeraturan } from "../../public/js/format.js";
import { perayapPratinjau, suntikPratinjau } from "../../src/worker/lib/pratinjau";
import { ASAL, buatLingkungan, panggil, sisipkan, sqliteAda, type Lingkungan } from "./harness";

const CANGKANG = readFileSync("public/index.html", "utf8");

/** Isi atribut `content` dari tag meta (nama atau property) di HTML; null bila tidak ada. */
function meta(html: string, kunci: string): string | null {
  const m = new RegExp(`<meta (?:name|property)="${kunci}" content="([^"]*)">`).exec(html);
  return m ? m[1] : null;
}

/** Pembaca tautan yang tidak menjalankan JavaScript (kartu pratinjau WhatsApp). */
const UA_PERAYAP = "WhatsApp/2.24.20.85 A";
const UA_PERAMBAN = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

const UU13 = {
  uri: "/akn/id/act/uu/2003/13", jenis: "UU", nomor: "13", tahun: 2003,
  judul: "Undang-Undang Republik Indonesia Nomor 13 Tahun 2003 tentang Ketenagakerjaan",
};

describe.skipIf(!sqliteAda)("pratinjau tautan /peraturan", () => {
  let l: Lingkungan;
  beforeEach(async () => {
    l = buatLingkungan();
    await sisipkan(l, [UU13]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    l.tutup();
  });

  /** Secara bawaan sebagai perayap pratinjau; pembaca biasa diuji terpisah. */
  const ambil = async (qs: string, init: RequestInit = {}, ua = UA_PERAYAP) => {
    const res = await panggil(l, `/peraturan${qs}`, { ...init, headers: { "user-agent": ua, ...(init.headers as Record<string, string> | undefined) } });
    return { res, html: await res.text() };
  };
  const tautan = (uri: string) => `?uri=${encodeURIComponent(uri)}`;

  describe("peraturan yang ada", () => {
    it("menyuntikkan judul, deskripsi, dan tag Open Graph ke cangkang", async () => {
      const { res, html } = await ambil(tautan(UU13.uri));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(html).toContain("<title>UU 13/2003 Ketenagakerjaan · Lexa</title>");
      expect(meta(html, "og:title")).toBe("UU 13/2003 Ketenagakerjaan");
      const deskripsi = "Undang-Undang Nomor 13 Tahun 2003 tentang Ketenagakerjaan.";
      expect(meta(html, "description")).toBe(deskripsi);
      expect(meta(html, "og:description")).toBe(deskripsi);
      expect(meta(html, "og:site_name")).toBe("Lexa");
      expect(meta(html, "og:type")).toBe("website");
      expect(meta(html, "twitter:card")).toBe("summary_large_image");
    });

    it("alamat dan gambar bersifat mutlak, mengikuti asal permintaan, dengan ukuran gambar", async () => {
      const { html } = await ambil(tautan(UU13.uri));
      const url = `${ASAL}/peraturan?uri=${encodeURIComponent(UU13.uri)}`;
      expect(meta(html, "og:url")).toBe(url);
      expect(html).toContain(`<link rel="canonical" href="${url}">`);
      expect(meta(html, "og:image")).toBe(`${ASAL}/og/lexa.png`);
      expect(meta(html, "og:image:width")).toBe("1200");
      expect(meta(html, "og:image:height")).toBe("630");
      expect(meta(html, "og:image:alt")).toContain("Lexa");
    });

    it("sama dengan yang dibuat antarmuka (satu fungsi, public/js/format.js)", async () => {
      const { html } = await ambil(tautan(UU13.uri));
      const harapan = pratinjauPeraturan({ ...UU13, status: "berlaku", ringkasan: null });
      expect(meta(html, "og:title")).toBe(harapan.judul);
      expect(meta(html, "description")).toBe(harapan.deskripsi);
    });

    it("memakai ringkasan peraturan bila ada, dipotong 180 karakter", async () => {
      const panjang = "Mengatur hubungan kerja antara pekerja dan pengusaha. ".repeat(10);
      await l.db.prepare("UPDATE laws SET ringkasan = ? WHERE frbr_uri = ?").bind(panjang, UU13.uri).run();
      const { html } = await ambil(tautan(UU13.uri));
      const d = meta(html, "og:description") as string;
      expect(d.startsWith("Mengatur hubungan kerja")).toBe(true);
      expect(d.length).toBe(180);
    });

    it("peraturan yang dicabut atau diubah diawali statusnya agar tidak terbaca masih berlaku", async () => {
      await sisipkan(l, [
        { ...UU13, uri: "/akn/id/act/uu/2020/11", nomor: "11", tahun: 2020, judul: "Cipta Kerja", status: "dicabut" },
        { ...UU13, uri: "/akn/id/act/uu/2019/9", nomor: "9", tahun: 2019, judul: "Contoh", status: "diubah" },
      ]);
      expect(meta((await ambil(tautan("/akn/id/act/uu/2020/11"))).html, "og:description")).toBe("Dicabut. Undang-Undang Nomor 11 Tahun 2020 tentang Cipta Kerja.");
      expect(meta((await ambil(tautan("/akn/id/act/uu/2019/9"))).html, "og:description")).toMatch(/^Diubah\. /);
      expect(meta((await ambil(tautan(UU13.uri))).html, "og:description")).not.toMatch(/^(Dicabut|Diubah)/);
    });

    it("ejaan lain URI PERPPU menemukan peraturannya, dan alamat kanoniknya memakai ejaan yang tersimpan", async () => {
      await sisipkan(l, [{ uri: "/akn/id/act/perpu/2022/2", jenis: "PERPPU", nomor: "2", tahun: 2022, judul: "Cipta Kerja" }]);
      const { html } = await ambil(tautan("/akn/id/act/perppu/2022/2"));
      expect(meta(html, "og:title")).toContain("2/2022");
      expect(meta(html, "og:url")).toBe(`${ASAL}/peraturan?uri=${encodeURIComponent("/akn/id/act/perpu/2022/2")}`);
    });

    it("bagian lain cangkang tidak berubah: badan halaman identik dan skrip tetap dimuat", async () => {
      const { html } = await ambil(tautan(UU13.uri));
      const badan = (s: string) => s.slice(s.indexOf("<body"));
      expect(badan(html)).toBe(badan(CANGKANG));
      expect(html).toContain('<script type="module" src="/js/main.js"></script>');
      expect(html.match(/<meta name="viewport"/g)).toHaveLength(1);
      expect(html.match(/<title>/g)).toHaveLength(1);
      expect(html.match(/property="og:title"/g)).toHaveLength(1);
    });

    it("header aset dipertahankan (CSP), ETag dan panjang dibuang, dan selalu divalidasi", async () => {
      const { res } = await ambil(tautan(UU13.uri));
      expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      // Penanda milik salinan aset aslinya tidak berlaku untuk isi yang berbeda.
      for (const nama of ["etag", "content-length", "last-modified", "cf-cache-status"]) expect(res.headers.get(nama), nama).toBeNull();
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(res.headers.get("vary")).toContain("User-Agent");
    });

    it("permintaan bersyarat peramban tidak diteruskan ke aset (bukan salinan aset aslinya)", async () => {
      const kirim = vi.spyOn(l.env.ASSETS, "fetch");
      const { res, html } = await ambil(tautan(UU13.uri), { headers: { "if-none-match": '"aset-uji"' } });
      expect(res.status).toBe(200);
      expect(html).toContain("og:image");
      const diminta = kirim.mock.calls[0][0] as Request;
      expect(diminta.headers.get("if-none-match")).toBeNull();
      expect(new URL(diminta.url).pathname).toBe("/");
    });

    it("HEAD menjawab header yang sama tanpa badan", async () => {
      const res = await panggil(l, `/peraturan${tautan(UU13.uri)}`, { method: "HEAD", headers: { "user-agent": UA_PERAYAP } });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toBe("");
    });
  });

  describe("pembaca biasa mendapat cangkang langsung, tanpa menyentuh D1", () => {
    it.each([
      ["peramban Android", UA_PERAMBAN],
      ["tanpa User-Agent", ""],
      ["curl", "curl/8.5.0"],
    ])("%s", async (_nama, ua) => {
      const prepare = vi.spyOn(l.env.DB, "prepare");
      const { res, html } = await ambil(tautan(UU13.uri), {}, ua);
      expect(res.status).toBe(200);
      expect(html).toBe(CANGKANG);
      expect(res.headers.get("etag")).toBe('"aset-uji"'); // ETag aset asli utuh, jadi peramban bisa memvalidasi (304)
      expect(prepare).not.toHaveBeenCalled();
      expect(res.headers.get("vary")).toContain("User-Agent"); // isi bergantung pada pembacanya
    });

    it("header bersyarat peramban diteruskan ke aset (ETag/304 tetap bekerja) dan jalurnya cangkang", async () => {
      const kirim = vi.spyOn(l.env.ASSETS, "fetch");
      await ambil(tautan(UU13.uri), { headers: { "if-none-match": '"aset-uji"' } }, UA_PERAMBAN);
      const diminta = kirim.mock.calls[0][0] as Request;
      expect(diminta.headers.get("if-none-match")).toBe('"aset-uji"');
      expect(new URL(diminta.url).pathname).toBe("/");
    });
  });

  describe("perayapPratinjau (User-Agent)", () => {
    it.each([
      "WhatsApp/2.24.20.85 A",
      "WhatsApp/2.2420.7 i",
      "TelegramBot (like TwitterBot)",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "facebookexternalhit/1.1 Facebot Twitterbot/1.0", // iMessage dan Messenger
      "Twitterbot/1.0",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
      "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
      "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1)",
      "Mozilla/5.0 (compatible; SkypeUriPreview Preview/0.5)",
      "Viber",
    ])("mengenali %s", (ua) => {
      expect(perayapPratinjau(ua)).toBe(true);
    });

    it.each([
      UA_PERAMBAN,
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
      "curl/8.5.0",
      "",
      null,
    ])("tidak mengenali pembaca biasa: %s", (ua) => {
      expect(perayapPratinjau(ua)).toBe(false);
    });
  });

  describe("keamanan isi", () => {
    it("tanda kutip, kurung sudut, dan & di judul dan ringkasan dilolos: tidak ada tag atau atribut yang lepas", async () => {
      const jahat = '"><script>alert(1)</script><img src=x onerror=alert(2)> & \'ok\'';
      await sisipkan(l, [{ uri: "/akn/id/act/uu/2024/1", jenis: "UU", nomor: "1", tahun: 2024, judul: `Undang-Undang Nomor 1 Tahun 2024 tentang ${jahat}` }]);
      await l.db.prepare("UPDATE laws SET ringkasan = ? WHERE frbr_uri = ?").bind(jahat, "/akn/id/act/uu/2024/1").run();
      const { html } = await ambil(tautan("/akn/id/act/uu/2024/1"));
      expect(html).not.toContain("<script>alert");
      expect(html).not.toContain("<img src=x");
      expect(html).not.toContain('onerror=alert(2)>');
      expect(html).toContain("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
      // Setelah dibongkar, atribut content tidak pecah: hanya satu og:description dan satu title.
      expect(html.match(/property="og:description"/g)).toHaveLength(1);
      expect(html.match(/<title>/g)).toHaveLength(1);
      expect(html.match(/<script/g)).toHaveLength((CANGKANG.match(/<script/g) ?? []).length);
    });

    it("pola pengganti String.replace ($&, $1, $$) di judul tampil apa adanya", async () => {
      await sisipkan(l, [{ uri: "/akn/id/act/uu/2024/2", jenis: "UU", nomor: "2", tahun: 2024, judul: "Undang-Undang Nomor 2 Tahun 2024 tentang Pajak $& Bea $1 dan $$ Cukai" }]);
      const { html } = await ambil(tautan("/akn/id/act/uu/2024/2"));
      // "&" tetap dilolos menjadi "&amp;"; yang diuji: "$&" tidak diganti dengan teks yang cocok dan "$$" tidak menyusut.
      expect(meta(html, "og:title")).toBe("UU 2/2024 Pajak $&amp; Bea $1 dan $$ Cukai");
      expect(html).toContain("<title>UU 2/2024 Pajak $&amp; Bea $1 dan $$ Cukai · Lexa</title>");
      expect(html).not.toContain("<title><title>");
    });
  });

  describe("selalu jatuh ke cangkang biasa", () => {
    const biasa = (html: string) => {
      expect(html).toBe(CANGKANG);
    };

    it("peraturan tidak ada di indeks", async () => {
      const { res, html } = await ambil(tautan("/akn/id/act/uu/1999/99"));
      expect(res.status).toBe(200);
      biasa(html);
    });

    it("tanpa parameter uri", async () => {
      biasa((await ambil("")).html);
      biasa((await ambil("?q=pesangon")).html);
    });

    it("uri bukan FRBR atau terlalu panjang: tidak menyentuh D1 sama sekali", async () => {
      const prepare = vi.spyOn(l.env.DB, "prepare");
      biasa((await ambil("?uri=https://contoh.test/jahat")).html);
      biasa((await ambil(tautan("' OR 1=1 --"))).html);
      biasa((await ambil(tautan(`/akn/id/act/uu/2003/${"1".repeat(300)}`))).html);
      expect(prepare).not.toHaveBeenCalled();
    });

    it("D1 galat: cangkang biasa dengan status 200 (bukan 500), galatnya dicatat", async () => {
      const catat = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(l.env.DB, "prepare").mockImplementation(() => {
        throw new Error("D1 tidak tersedia");
      });
      const { res, html } = await ambil(tautan(UU13.uri));
      expect(res.status).toBe(200);
      biasa(html);
      expect(catat).toHaveBeenCalled();
    });

    it("cangkang berubah bentuk (tag yang harus diganti hilang): disajikan apa adanya, tidak separuh benar", async () => {
      const catat = vi.spyOn(console, "error").mockImplementation(() => {});
      const ubah = (h: string) => h.replace('<meta property="og:title"', '<meta property="og:judul"');
      l.aset.gantiCangkang = ubah;
      const { res, html } = await ambil(tautan(UU13.uri));
      expect(res.status).toBe(200);
      expect(html).toBe(ubah(CANGKANG));
      expect(html).not.toContain("og:image");
      expect(catat).toHaveBeenCalled();
    });
  });

  describe("suntikPratinjau (fungsi murni)", () => {
    const isi = { judul: "UU 1/2000 Contoh", deskripsi: "Deskripsi contoh.", url: "https://x.test/peraturan?uri=%2Fakn", gambar: "https://x.test/og/lexa.png" };

    it("index.html sungguhan memuat semua tag yang diganti (penjaga bila index.html diubah)", () => {
      const hasil = suntikPratinjau(CANGKANG, isi);
      expect(hasil).not.toBeNull();
      expect(hasil).toContain("<title>UU 1/2000 Contoh · Lexa</title>");
    });

    it.each([
      ["title", CANGKANG.replace(/<title>[\s\S]*?<\/title>/, "")],
      ["meta description", CANGKANG.replace(/<meta name="description"[^>]*>/, "")],
      ["og:title", CANGKANG.replace(/<meta property="og:title"[^>]*>/, "")],
      ["og:description", CANGKANG.replace(/<meta property="og:description"[^>]*>/, "")],
      ["penutup head", CANGKANG.replace("</head>", "")],
    ])("mengembalikan null bila %s tidak ada", (_nama, html) => {
      expect(suntikPratinjau(html, isi)).toBeNull();
    });
  });
});
