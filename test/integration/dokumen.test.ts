/**
 * /api/dokumen/*: status berkas, teks hasil konversi, dan PDF dari R2 (termasuk
 * permintaan rentang byte yang dipakai penampil PDF).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buatLingkungan, json, KORPUS, panggil, sisipkan, sqliteAda, type Lingkungan } from "./harness";

const URI = "/akn/id/act/uu/2003/13";
const uriEnc = encodeURIComponent(URI);
const PDF = new TextEncoder().encode("%PDF-1.4 0123456789");

describe.skipIf(!sqliteAda)("dokumen", () => {
  let l: Lingkungan;
  beforeEach(async () => {
    l = buatLingkungan();
    await sisipkan(l, KORPUS);
  });
  afterEach(() => l.tutup());

  async function arsipkan(pdf = true, teks = true) {
    if (pdf) {
      await l.r2.put("pdf/uu13.pdf", PDF, { httpMetadata: { contentType: "application/pdf" } });
      await l.db.prepare(`UPDATE laws SET r2_pdf_key = 'pdf/uu13.pdf' WHERE frbr_uri = ?`).bind(URI).run();
    }
    if (teks) {
      await l.r2.put("teks/uu13.md", "# UU 13/2003\nPasal 1", { httpMetadata: { contentType: "text/markdown" } });
      await l.db.prepare(`UPDATE laws SET r2_text_key = 'teks/uu13.md' WHERE frbr_uri = ?`).bind(URI).run();
    }
  }

  describe("GET /api/dokumen/status", () => {
    it("peraturan tanpa arsip: tidak ada PDF/teks, tetap memberi tautan resmi BPK", async () => {
      expect(await json(await panggil(l, `/api/dokumen/status?uri=${uriEnc}`))).toEqual({
        uri: URI, ada_pdf: false, ada_teks: false, pdf_url: null, teks_url: null,
        bpk_url: "https://peraturan.bpk.go.id/Details/1001",
      });
    });

    it("peraturan dengan arsip: memberi tautan ke endpoint PDF dan teks", async () => {
      await arsipkan();
      expect(await json(await panggil(l, `/api/dokumen/status?uri=${uriEnc}`))).toMatchObject({
        ada_pdf: true, ada_teks: true,
        pdf_url: `/api/dokumen/pdf?uri=${uriEnc}`, teks_url: `/api/dokumen/teks?uri=${uriEnc}`,
      });
    });

    it("404 untuk peraturan yang tidak ada, 400 tanpa uri", async () => {
      expect((await panggil(l, "/api/dokumen/status?uri=/tidak/ada")).status).toBe(404);
      expect((await panggil(l, "/api/dokumen/status")).status).toBe(400);
    });
  });

  describe("GET /api/dokumen/pdf", () => {
    it("tanpa arsip: 404 pdf_belum_diarsipkan dengan jalan keluar ke BPK (bukan galat)", async () => {
      const res = await panggil(l, `/api/dokumen/pdf?uri=${uriEnc}`);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: "pdf_belum_diarsipkan", bpk_url: "https://peraturan.bpk.go.id/Details/1001" });
    });

    it("GET biasa: 200 utuh (bukan 206) dengan header unduhan dan cache permanen", async () => {
      await arsipkan();
      const res = await panggil(l, `/api/dokumen/pdf?uri=${uriEnc}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      expect(res.headers.get("content-disposition")).toBe('inline; filename="UU-13-2003.pdf"');
      expect(res.headers.get("accept-ranges")).toBe("bytes");
      expect(res.headers.get("content-length")).toBe(String(PDF.byteLength));
      expect(res.headers.get("content-range")).toBeNull();
      expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
    });

    it("permintaan rentang byte dijawab 206 dengan Content-Range yang benar", async () => {
      await arsipkan();
      const res = await panggil(l, `/api/dokumen/pdf?uri=${uriEnc}`, { headers: { range: "bytes=0-3" } });
      expect(res.status).toBe(206);
      expect(res.headers.get("content-range")).toBe(`bytes 0-3/${PDF.byteLength}`);
      expect(res.headers.get("content-length")).toBe("4");
      expect(await res.text()).toBe("%PDF");

      const akhir = await panggil(l, `/api/dokumen/pdf?uri=${uriEnc}`, { headers: { range: "bytes=-3" } });
      expect(akhir.status).toBe(206);
      expect(await akhir.text()).toBe("789");
    });

    it("kunci tercatat tetapi objek hilang dari R2 -> 502 berkas_hilang", async () => {
      await arsipkan();
      l.r2.objek.clear();
      const res = await panggil(l, `/api/dokumen/pdf?uri=${uriEnc}`);
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ error: "berkas_hilang" });
    });

    it("404 untuk peraturan yang tidak ada, 400 tanpa uri", async () => {
      expect((await panggil(l, "/api/dokumen/pdf?uri=/tidak/ada")).status).toBe(404);
      expect((await panggil(l, "/api/dokumen/pdf")).status).toBe(400);
    });
  });

  describe("GET /api/dokumen/teks", () => {
    it("menyajikan teks hasil konversi sebagai text/plain UTF-8", async () => {
      await arsipkan();
      const res = await panggil(l, `/api/dokumen/teks?uri=${uriEnc}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
      expect(await res.text()).toBe("# UU 13/2003\nPasal 1");
    });

    it("tanpa teks: 404 teks_belum_ada; objek hilang: 502", async () => {
      const tanpa = await panggil(l, `/api/dokumen/teks?uri=${uriEnc}`);
      expect(tanpa.status).toBe(404);
      expect(await tanpa.json()).toMatchObject({ error: "teks_belum_ada" });

      await arsipkan(false, true);
      l.r2.objek.clear();
      expect((await panggil(l, `/api/dokumen/teks?uri=${uriEnc}`)).status).toBe(502);
    });
  });
});
