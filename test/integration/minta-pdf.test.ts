/**
 * "Minta PDF ini": pembaca meminta PDF peraturan yang belum diarsipkan (POST /api/dokumen/minta). Permintaan dicatat per peraturan,
 * dibatasi per alamat, dan didahulukan di antrean panen (GET /api/impor/butuh-teks), supaya PDF yang paling dicari yang pertama
 * dipanen dari BPK oleh pengelola.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buatLingkungan, json, kirim, panggil, sisipkan, sqliteAda, TOKEN_ADMIN, type Lingkungan, type PeraturanUji } from "./harness";

const adm = { "x-admin-token": TOKEN_ADMIN };
const pp = (nomor: number, ubah: Partial<PeraturanUji> = {}): PeraturanUji => ({
  uri: `/akn/id/act/pp/2020/${nomor}`, jenis: "PP", nomor: String(nomor), tahun: 2020, judul: `PP ${nomor}/2020 tentang Contoh`, ...ubah,
});

describe.skipIf(!sqliteAda)("minta PDF", () => {
  let l: Lingkungan;
  beforeEach(() => {
    l = buatLingkungan();
  });
  afterEach(() => l.tutup());

  const minta = (uri: unknown, ip = "1.1.1.1") => panggil(l, "/api/dokumen/minta", kirim("POST", { uri }, { "cf-connecting-ip": ip }));
  const baris = async () => (await l.db.prepare(`SELECT frbr_uri, jumlah FROM permintaan_pdf ORDER BY frbr_uri`).all()).results;
  const antrean = async (q = "") =>
    json<{ daftar: Array<{ frbr_uri: string; diminta: number }>; total: number; diminta_pembaca: number }>(await panggil(l, `/api/impor/butuh-teks${q}`, { headers: adm }));

  describe("POST /api/dokumen/minta", () => {
    it("mencatat permintaan peraturan yang belum ber-PDF", async () => {
      await sisipkan(l, [pp(1)]);
      const res = await minta(pp(1).uri);
      expect(res.status).toBe(201);
      expect(await json(res)).toEqual({ status: "tercatat" });
      expect(await baris()).toEqual([{ frbr_uri: pp(1).uri, jumlah: 1 }]);
    });

    it("alamat yang berbeda menambah hitungan; alamat yang sama hanya dihitung sekali per peraturan (jawaban 200 'ulang')", async () => {
      await sisipkan(l, [pp(1), pp(2)]);
      await minta(pp(1).uri, "1.1.1.1");
      await minta(pp(1).uri, "2.2.2.2");
      const ulang = await minta(pp(1).uri, "1.1.1.1");
      expect(ulang.status).toBe(200);
      expect(await json(ulang)).toEqual({ status: "tercatat", ulang: true });
      // Peraturan lain dari alamat yang sama tetap dihitung.
      expect((await minta(pp(2).uri, "1.1.1.1")).status).toBe(201);
      expect(await baris()).toEqual([
        { frbr_uri: pp(1).uri, jumlah: 2 },
        { frbr_uri: pp(2).uri, jumlah: 1 },
      ]);
    });

    it("peraturan yang sudah ber-PDF tak dicatat: jawabannya menunjuk ke PDF-nya", async () => {
      await sisipkan(l, [pp(1)]);
      await l.db.prepare(`UPDATE laws SET r2_pdf_key = 'pdf/x.pdf' WHERE frbr_uri = ?`).bind(pp(1).uri).run();
      const res = await minta(pp(1).uri);
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual({ status: "sudah_ada", pdf_url: `/api/dokumen/pdf?uri=${encodeURIComponent(pp(1).uri)}` });
      expect(await baris()).toEqual([]);
    });

    it("peraturan yang tak ada (404), uri kosong atau bukan teks (400), dan jenis di luar cakupan (404) ditolak tanpa mencatat", async () => {
      await sisipkan(l, [{ uri: "/akn/id/act/perpres/2020/1", jenis: "PERPRES", nomor: "1", tahun: 2020, judul: "Perpres 1/2020" }]);
      expect((await minta("/akn/id/act/pp/1999/99")).status).toBe(404);
      expect((await minta("")).status).toBe(400);
      expect((await minta(42)).status).toBe(400);
      expect((await minta(undefined)).status).toBe(400);
      expect((await minta("/akn/id/act/perpres/2020/1")).status).toBe(404);
      expect((await panggil(l, "/api/dokumen/minta", { method: "POST", body: "bukan json" })).status).toBe(400);
      expect(await baris()).toEqual([]);
    });

    it("dibatasi 30 peraturan berbeda per jam per alamat (ke-31 ditolak 429, alamat lain tak terpengaruh)", async () => {
      await sisipkan(l, Array.from({ length: 32 }, (_, i) => pp(i + 1)));
      for (let i = 1; i <= 30; i++) expect((await minta(pp(i).uri)).status, `ke-${i}`).toBe(201);
      const ke31 = await minta(pp(31).uri);
      expect(ke31.status).toBe(429);
      expect((await json<{ error: string }>(ke31)).error).toBe("terlalu_sering");
      expect((await minta(pp(31).uri, "9.9.9.9")).status).toBe(201);
      // Permintaan ulang untuk peraturan yang sudah dihitung dijawab tanpa mengurangi jatah.
      expect((await minta(pp(1).uri)).status).toBe(200);
      const b = await baris();
      expect(b.find((r) => r.frbr_uri === pp(31).uri)?.jumlah, "hanya dari alamat lain").toBe(1);
      expect(b.some((r) => r.frbr_uri === pp(32).uri)).toBe(false);
    });

    it("penyimpanan KV yang gagal tak membatalkan pencatatan", async () => {
      await sisipkan(l, [pp(1)]);
      const asli = l.env.CACHE.put.bind(l.env.CACHE);
      l.env.CACHE.put = (async () => {
        throw new Error("KV mati");
      }) as never;
      const res = await minta(pp(1).uri);
      l.env.CACHE.put = asli;
      expect(res.status).toBe(201);
      expect(await baris()).toEqual([{ frbr_uri: pp(1).uri, jumlah: 1 }]);
    });
  });

  describe("antrean panen (GET /api/impor/butuh-teks)", () => {
    it("peraturan yang diminta didahulukan, yang paling banyak peminatnya lebih dulu, dan membawa jumlah peminatnya", async () => {
      await sisipkan(l, [pp(1), pp(2), pp(3), { ...pp(4), jenis: "UU", uri: "/akn/id/act/uu/2020/4" }]);
      // Urutan bawaan: UU dulu, lalu PP menurut URI. Permintaan membalikkannya.
      expect((await antrean()).daftar.map((d) => d.frbr_uri)).toEqual(["/akn/id/act/uu/2020/4", pp(1).uri, pp(2).uri, pp(3).uri]);
      await minta(pp(3).uri, "1.1.1.1");
      await minta(pp(2).uri, "1.1.1.1");
      await minta(pp(2).uri, "2.2.2.2");
      const a = await antrean();
      expect(a.daftar.map((d) => [d.frbr_uri, d.diminta])).toEqual([
        [pp(2).uri, 2],
        [pp(3).uri, 1],
        ["/akn/id/act/uu/2020/4", 0],
        [pp(1).uri, 0],
      ]);
      expect(a.diminta_pembaca).toBe(2);
      expect(a.total).toBe(4);
    });

    it("peraturan yang sudah berpasal dari teks lama tetap masuk antrean bila diminta, walau tanpa ?lama=1; yang tak diminta tidak", async () => {
      await sisipkan(l, [pp(1, { pasal: [{ nomor: "1", isi: "Isi lama." }] }), pp(2, { pasal: [{ nomor: "1", isi: "Isi lama." }] })]);
      expect((await antrean()).daftar).toEqual([]);
      await minta(pp(2).uri);
      expect((await antrean()).daftar.map((d) => d.frbr_uri)).toEqual([pp(2).uri]);
      expect((await antrean("?lama=1")).daftar.map((d) => d.frbr_uri)).toEqual([pp(2).uri, pp(1).uri]);
    });

    it("PDF yang akhirnya diunggah menghapusnya dari antrean; jumlah diminta_pembaca ikut turun", async () => {
      await sisipkan(l, [pp(1)]);
      await minta(pp(1).uri);
      expect((await antrean()).diminta_pembaca).toBe(1);
      const unggah = await panggil(l, `/api/impor/pdf?uri=${encodeURIComponent(pp(1).uri)}`, { method: "PUT", headers: adm, body: new TextEncoder().encode("%PDF-1.4\nisi") });
      expect(unggah.status).toBe(200);
      const a = await antrean();
      expect(a.daftar).toEqual([]);
      expect(a.diminta_pembaca).toBe(0);
    });

    it("permintaan atas peraturan yang ditandai 'tanpa berkas' tak mengembalikannya ke antrean (kecuali ?semua=1)", async () => {
      await sisipkan(l, [pp(1)]);
      await minta(pp(1).uri);
      await panggil(l, "/api/impor/tanpa-berkas", kirim("POST", { uris: [pp(1).uri] }, adm));
      expect((await antrean()).daftar).toEqual([]);
      expect((await antrean("?semua=1")).daftar.map((d) => d.frbr_uri)).toEqual([pp(1).uri]);
    });

    it("tabel permintaan belum ada (migrasi 0010 belum diterapkan): antrean tetap bekerja seperti semula", async () => {
      await sisipkan(l, [pp(1), pp(2)]);
      l.sqlite.exec("DROP TABLE permintaan_pdf");
      const res = await panggil(l, "/api/impor/butuh-teks", { headers: adm });
      expect(res.status).toBe(200);
      const a = await json<{ daftar: Array<{ frbr_uri: string; diminta: number }>; diminta_pembaca: number }>(res);
      expect(a.daftar.map((d) => [d.frbr_uri, d.diminta])).toEqual([[pp(1).uri, 0], [pp(2).uri, 0]]);
      expect(a.diminta_pembaca).toBe(0);
    });
  });

  describe("GET /api/impor/ringkasan", () => {
    const diminta = async () => (await json<{ diminta_pdf: number }>(await panggil(l, "/api/impor/ringkasan", { headers: adm }))).diminta_pdf;

    it("menghitung peraturan yang diminta dan belum ber-PDF", async () => {
      await sisipkan(l, [pp(1), pp(2)]);
      expect(await diminta()).toBe(0);
      await minta(pp(1).uri);
      await minta(pp(2).uri);
      expect(await diminta()).toBe(2);
      await l.db.prepare(`UPDATE laws SET r2_pdf_key = 'pdf/x.pdf' WHERE frbr_uri = ?`).bind(pp(1).uri).run();
      expect(await diminta()).toBe(1);
    });

    it("tanpa tabelnya: nol, bukan galat", async () => {
      l.sqlite.exec("DROP TABLE permintaan_pdf");
      expect(await diminta()).toBe(0);
    });
  });
});
