/**
 * Cakupan peraturan di seluruh aplikasi: hanya UUD, Tap MPR, UU (termasuk Perppu), dan PP yang dicari,
 * ditelusur, dan disajikan. Peraturan jenis lain yang sudah tersimpan di D1 (Perpres, Permen, POJK, ...)
 * hanya disembunyikan; tes ini memastikan setiap pintu keluar data menutupnya, dan bahwa melebarkan
 * cakupan lewat variabel CAKUPAN_JENIS membukanya kembali (sehingga penyaringannya yang terbukti bekerja,
 * bukan sekadar data uji yang kebetulan tidak cocok).
 *
 * Sisi masuk (cron, antrean, impor BPK) diuji bersama jalur pipeline-nya di test/integration/pipeline.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buatLingkungan, indeksSemua, json, KORPUS, panggil, RELASI_CIPTA_KERJA, sisipkan, sisipkanRelasi, sqliteAda,
  type Lingkungan, type PeraturanUji,
} from "./harness";
import type { BrowseResponse, LawDetailResponse, SearchResponse } from "../../src/shared/types";

/**
 * Peraturan di luar cakupan, memuat kata yang sama dengan korpus ("pesangon", "ketenagakerjaan"). Bentuk URI-nya
 * mengikuti produksi: Perpres bersegmen baku, sedangkan Permen ("permenkeu") dan POJK ("peraturan-ojk") bersegmen
 * tak baku sehingga hanya kolom `jenis` yang bisa menentukan cakupannya.
 */
const LUAR: PeraturanUji[] = [
  {
    uri: "/akn/id/act/perpres/2020/10", jenis: "PERPRES", nomor: "10", tahun: 2020,
    judul: "Pedoman Pemberian Pesangon Pegawai Lembaga", tentang: "Pesangon pegawai lembaga", bidang: "KETENAGAKERJAAN", bpkId: "9010",
    pasal: [{ nomor: "1", isi: "Pegawai lembaga yang diberhentikan berhak atas uang pesangon sesuai pedoman ini." }],
  },
  {
    uri: "/akn/id/act/permenkeu/2024/5", jenis: "PERMEN", nomor: "5", tahun: 2024,
    judul: "Tata Cara Pelaporan Pemutusan Hubungan Kerja", bidang: "KETENAGAKERJAAN",
    pasal: [{ nomor: "1", isi: "Pengusaha melaporkan pemutusan hubungan kerja dan pembayaran uang pesangon kepada dinas." }],
  },
  {
    uri: "/akn/id/act/peraturan-ojk/2019/1-pojk-04-2019", jenis: "POJK", nomor: "1-pojk-04-2019", tahun: 2019,
    judul: "Pesangon Pegawai Perusahaan Efek",
    pasal: [{ nomor: "1", isi: "Perusahaan efek membayar uang pesangon pegawai sesuai ketentuan." }],
  },
];
const URI_PERPRES = LUAR[0].uri;
const URI_PERMEN = LUAR[1].uri;
const BAWAAN = ["UUD", "TAP_MPR", "UU", "PERPPU", "PP"];
const URI_UU13 = "/akn/id/act/uu/2003/13";

describe.skipIf(!sqliteAda)("cakupan peraturan", () => {
  let l: Lingkungan;

  /** Cakupan dilebarkan seperti yang akan dilakukan bila suatu hari diperluas. */
  const lebarkan = () => {
    l.env.CAKUPAN_JENIS = "UU,PERPPU,PP,PERPRES,PERMEN,POJK";
  };

  beforeEach(async () => {
    l = buatLingkungan();
    await sisipkan(l, [...KORPUS, ...LUAR]);
    // Vektor peraturan di luar cakupan sudah ada di produksi (diindeks sebelum cakupan dibatasi). indeksVektor kini
    // menolak peraturan semacam itu, jadi di sini diindeks dengan cakupan dilebarkan, lalu cakupan dikembalikan.
    lebarkan();
    await indeksSemua(l, [...KORPUS, ...LUAR].map((p) => p.uri));
    l.env.CAKUPAN_JENIS = undefined;
  });
  afterEach(() => l.tutup());
  const ambil = <T = Record<string, unknown>>(path: string) => panggil(l, path).then((r) => json<T>(r));
  const cari = (qs: string) => ambil<SearchResponse>(`/api/search?${qs}`);
  const jenisHasil = (b: SearchResponse) => new Set(b.hits.map((h) => h.jenis));

  describe("pencarian", () => {
    it("kata kunci: peraturan di luar cakupan tidak muncul walau memuat kata yang dicari", async () => {
      const b = await cari("q=pesangon&mode=keyword");
      expect(b.hits.length).toBeGreaterThan(0);
      expect(jenisHasil(b)).toEqual(new Set(["UU", "PP"]));
    });

    it("bukti penyaringannya yang bekerja: dengan cakupan dilebarkan, peraturan yang sama muncul", async () => {
      lebarkan();
      const b = await cari("q=pesangon&mode=keyword");
      expect(jenisHasil(b)).toEqual(new Set(["UU", "PP", "PERPRES", "PERMEN", "POJK"]));
    });

    it("makna dan gabungan: vektor peraturan di luar cakupan disaring, di semua mode", async () => {
      const kueri = "uang pesangon pegawai lembaga diberhentikan pedoman";
      lebarkan();
      // Tanpa penyaringan, kueri ini memang membawa Perpres ke hasil makna (jika tidak, tes ini hampa).
      expect((await cari(`q=${encodeURIComponent(kueri)}&mode=semantic`)).hits.some((h) => h.jenis === "PERPRES")).toBe(true);

      l.env.CAKUPAN_JENIS = undefined;
      for (const mode of ["semantic", "hybrid", "keyword"]) {
        const b = await cari(`q=${encodeURIComponent(kueri)}&mode=${mode}`);
        expect(b.hits.length, mode).toBeGreaterThan(0);
        for (const h of b.hits) expect(["UU", "PP"], `${mode}: ${h.frbr_uri}`).toContain(h.jenis);
      }
    });

    it("penyaringan vektor tidak bergantung pada metadata: id vektor saja cukup (metadata terindeks tidak memuat frbr_uri)", async () => {
      for (const v of l.vektor.simpan.values()) delete v.metadata.frbr_uri;
      const b = await cari(`q=${encodeURIComponent("uang pesangon pegawai lembaga diberhentikan pedoman")}&mode=semantic`);
      expect(b.hits.length).toBeGreaterThan(0);
      for (const h of b.hits) expect(["UU", "PP"], h.frbr_uri).toContain(h.jenis);
    });

    it("penyaringan di SQL: kandidat kata kunci di luar cakupan tidak menutupi yang dalam cakupan saat batas hasil kecil", async () => {
      // Empat Perpres yang jauh lebih kuat menurut BM25 (kata langka di judul dan pasal pendek) memenuhi seluruh
      // jatah kandidat (3 per daftar pada limit=1); satu PP memuat kata itu sekali di pasal panjang. Tanpa penyaringan
      // di SQL, PP itu bahkan tidak pernah menjadi kandidat.
      await sisipkan(l, [
        ...[1, 2, 3, 4].map((n) => ({
          uri: `/akn/id/act/perpres/2021/${n}`, jenis: "PERPRES", nomor: String(n), tahun: 2021, judul: "zxqterm zxqterm zxqterm",
          pasal: [{ nomor: "1", isi: "zxqterm zxqterm zxqterm zxqterm." }],
        })),
        {
          uri: "/akn/id/act/pp/2021/90", jenis: "PP", nomor: "90", tahun: 2021, judul: "Peraturan Biasa",
          pasal: [{ nomor: "1", isi: "Ketentuan umum mengenai berbagai hal yang cukup panjang, dan di dalamnya disebut zxqterm satu kali saja di antara banyak kata lain yang tidak berhubungan sama sekali dengan pokok pembicaraan." }],
        },
      ]);
      const b = await cari("q=zxqterm&mode=keyword&limit=1");
      expect(b.hits.map((h) => h.frbr_uri)).toEqual(["/akn/id/act/pp/2021/90"]);
    });

    it("kandidat vektor di luar cakupan di urutan teratas tidak mengurangi isi halaman hasil (hasil tetap penuh)", async () => {
      // Urutan Vectorize dikendalikan: tiga vektor peraturan di luar cakupan paling mirip, disusul vektor dalam cakupan.
      const luar = [...l.vektor.simpan.entries()].filter(([id]) => LUAR.some((p) => id.startsWith(p.uri))).slice(0, 3);
      const dalam = [...l.vektor.simpan.entries()].filter(([id]) => KORPUS.some((p) => id.startsWith(p.uri)));
      expect(luar).toHaveLength(3);
      expect(dalam.length).toBeGreaterThanOrEqual(5);
      const urut = [...luar, ...dalam].map(([id, v], i) => ({ id, score: 1 - i * 0.01, metadata: v.metadata }));
      l.vektor.query = async (_q: number[], opsi?: { topK?: number }) => {
        const matches = urut.slice(0, opsi?.topK ?? 10);
        return { matches, count: matches.length };
      };
      const b = await cari("q=kata+apa+saja&mode=semantic&limit=3");
      expect(b.hits).toHaveLength(3);
      for (const h of b.hits) expect(["UU", "PP"], h.frbr_uri).toContain(h.jenis);
    });

    it("sitasi ke jenis di luar cakupan dikabarkan dan tidak dicari; peraturan dalam cakupan yang menyebutnya tetap bisa muncul", async () => {
      for (const kueri of ["Perpres 10/2020", "Peraturan Presiden Nomor 10 Tahun 2020", "Permen 5/2024", "POJK 1/POJK.04/2019"]) {
        const b = await cari(`q=${encodeURIComponent(kueri)}&mode=keyword`);
        expect(b.di_luar_cakupan, kueri).toBeTruthy();
        expect(b.hits.filter((h) => h.sources.includes("sitasi")), kueri).toEqual([]);
        for (const h of b.hits) expect(["UU", "PP"], `${kueri}: ${h.frbr_uri}`).toContain(h.jenis);
      }
      expect((await cari("q=Perpres+10%2F2020&mode=keyword")).di_luar_cakupan).toEqual({ jenis: "PERPRES", cakupan: BAWAAN });
      expect((await cari("q=Permen+5%2F2024&mode=keyword")).di_luar_cakupan?.jenis).toBe("PERMEN");
    });

    it("sitasi ke jenis dalam cakupan tidak diberi penanda, dan dengan cakupan dilebarkan sitasi Perpres menemukan peraturannya", async () => {
      const dalam = await cari("q=UU+13%2F2003&mode=keyword");
      expect(dalam.di_luar_cakupan).toBeUndefined();
      expect(dalam.hits[0]).toMatchObject({ frbr_uri: URI_UU13, sources: expect.arrayContaining(["sitasi"]) });

      lebarkan();
      const luas = await cari("q=Perpres+10%2F2020&mode=keyword");
      expect(luas.di_luar_cakupan).toBeUndefined();
      expect(luas.hits[0]).toMatchObject({ frbr_uri: URI_PERPRES, sources: expect.arrayContaining(["sitasi"]) });
    });

    it("kueri tanpa sitasi tidak diberi penanda", async () => {
      expect((await cari("q=pesangon&mode=keyword")).di_luar_cakupan).toBeUndefined();
    });

    it("filter jenis dari pengguna tidak bisa membuka peraturan di luar cakupan", async () => {
      for (const mode of ["keyword", "semantic", "hybrid"]) {
        const b = await cari(`q=pesangon&mode=${mode}&jenis=PERPRES,POJK,PERMEN`);
        expect(b.hits, mode).toEqual([]);
      }
      // Irisan: jenis dalam cakupan tetap bekerja, dan yang di luar cakupan di dalam daftar yang sama diabaikan.
      const campur = await cari("q=pesangon&mode=keyword&jenis=PP,PERPRES");
      expect(jenisHasil(campur)).toEqual(new Set(["PP"]));
    });

    it("cache tidak melintasi cakupan: hasil dari cakupan lama tidak disajikan sesudah cakupan berubah", async () => {
      const sempit = await cari("q=pesangon&mode=keyword");
      expect((await cari("q=pesangon&mode=keyword")).cached).toBe(true); // cache bekerja pada cakupan yang sama
      lebarkan();
      const luas = await cari("q=pesangon&mode=keyword");
      expect(luas.cached).toBe(false);
      expect(luas.hits.length).toBeGreaterThan(sempit.hits.length);
      l.env.CAKUPAN_JENIS = undefined;
      expect((await cari("q=pesangon&mode=keyword")).hits.map((h) => h.frbr_uri)).toEqual(sempit.hits.map((h) => h.frbr_uri));
    });

    it("nilai CAKUPAN_JENIS yang rusak jatuh ke bawaan, tidak menyembunyikan semuanya maupun membuka semuanya", async () => {
      l.env.CAKUPAN_JENIS = "UU;;DROP";
      const b = await cari("q=pesangon&mode=keyword");
      expect(jenisHasil(b)).toEqual(new Set(["UU", "PP"]));
    });
  });

  describe("telusur (GET /api/laws)", () => {
    it("daftar, total, dan seluruh facet hanya memuat peraturan dalam cakupan", async () => {
      const b = await ambil<BrowseResponse>("/api/laws");
      expect(b.total).toBe(KORPUS.length);
      expect(b.laws.map((x) => x.jenis).sort()).toEqual(["PP", "UU", "UU", "UU"]);
      expect(b.facets.jenis.map((f) => f.value).sort()).toEqual(["PP", "UU"]);
      expect(b.facets.tahun.reduce((n, f) => n + f.count, 0)).toBe(KORPUS.length);
      expect(b.facets.status.reduce((n, f) => n + f.count, 0)).toBe(KORPUS.length);
      expect(b.di_luar_cakupan).toBeUndefined();
      expect(b.cakupan).toEqual(BAWAAN);
    });

    it("menyaring menurut jenis di luar cakupan: kosong, dengan penjelasan", async () => {
      const b = await ambil<BrowseResponse>("/api/laws?jenis=PERPRES");
      expect(b).toMatchObject({ total: 0, laws: [], di_luar_cakupan: ["PERPRES"] });
      const campur = await ambil<BrowseResponse>("/api/laws?jenis=PP,POJK");
      expect(campur.laws.map((x) => x.frbr_uri)).toEqual(["/akn/id/act/pp/2021/35"]);
      expect(campur.di_luar_cakupan).toEqual(["POJK"]);
    });

    it("filter bidang dan tahun tidak membuka peraturan di luar cakupan", async () => {
      const b = await ambil<BrowseResponse>("/api/laws?bidang=KETENAGAKERJAAN");
      expect(b.laws.map((x) => x.jenis).sort()).toEqual(["PP", "UU", "UU"]);
      // Satu-satunya peraturan bertahun 2024 ke atas adalah Permen 5/2024, yang tersembunyi.
      expect((await ambil<BrowseResponse>("/api/laws?tahun_min=2024")).total).toBe(0);
    });

    it("dengan cakupan dilebarkan, semuanya muncul kembali", async () => {
      lebarkan();
      const b = await ambil<BrowseResponse>("/api/laws");
      expect(b.total).toBe(KORPUS.length + LUAR.length);
      expect(b.facets.jenis.map((f) => f.value).sort()).toEqual(["PERMEN", "PERPRES", "POJK", "PP", "UU"]);
    });
  });

  describe("detail peraturan (GET /api/laws/detail)", () => {
    const detail = (uri: string) => panggil(l, `/api/laws/detail?uri=${encodeURIComponent(uri)}`);

    it("peraturan di luar cakupan menjawab 404 di_luar_cakupan beserta daftar cakupannya, walau barisnya ada di D1", async () => {
      expect((await l.db.prepare("SELECT COUNT(*) AS n FROM laws WHERE frbr_uri = ?").bind(URI_PERPRES).first<{ n: number }>())?.n).toBe(1);
      const res = await detail(URI_PERPRES);
      expect(res.status).toBe(404);
      const b = await json<{ error: string; message: string; cakupan: string[] }>(res);
      expect(b.error).toBe("di_luar_cakupan");
      expect(b.cakupan).toEqual(BAWAAN);
      expect(b.message).toContain("PERPRES 10/2020");
    });

    it("peraturan yang tidak ada tetap tidak_ditemukan (bedanya dengan di luar cakupan)", async () => {
      const res = await detail("/akn/id/act/uu/1999/99");
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: "tidak_ditemukan" });
    });

    it("peraturan dalam cakupan tetap tampil; relasi ke peraturan di luar cakupan disembunyikan", async () => {
      await sisipkanRelasi(l, [
        ...RELASI_CIPTA_KERJA,
        { dari: URI_UU13, ke: URI_PERPRES, jenis: "terkait", keterangan: "Perpres 10/2020" },
        { dari: URI_UU13, ke: URI_PERMEN, jenis: "terkait", keterangan: "Permen 5/2024 (segmen tak baku, barisnya ada)" },
        { dari: URI_UU13, ke: "/akn/id/act/permen/2099/1", jenis: "terkait", keterangan: "belum ada di indeks" },
        { dari: URI_UU13, ke: "/akn/id/act/uu/2020/11", jenis: "diubah_oleh", keterangan: "UU 11/2020" },
        { dari: URI_UU13, ke: "/akn/id/act/uu/1999/99", jenis: "terkait", keterangan: "belum ter-ingest" },
      ]);
      const b = await json<LawDetailResponse>(await detail(URI_UU13));
      expect(b.law.frbr_uri).toBe(URI_UU13);
      const tujuan = b.relations.map((r) => r.to_uri);
      expect(tujuan).toContain("/akn/id/act/uu/2020/11");
      // Yang dalam cakupan tetapi belum ter-ingest tetap tampil (tanpa judul).
      expect(b.relations.find((r) => r.to_uri === "/akn/id/act/uu/1999/99")).toMatchObject({ judul: null });
      expect(tujuan).not.toContain(URI_PERPRES);
      expect(tujuan).not.toContain(URI_PERMEN); // segmen tak baku: dinilai dari kolom jenis barisnya
      expect(tujuan).not.toContain("/akn/id/act/permen/2099/1"); // belum ter-ingest, tetapi jelas Permen
    });

    it("dengan cakupan dilebarkan, peraturan dan relasinya tampil, juga yang segmen URI-nya tak baku", async () => {
      await sisipkanRelasi(l, [
        { dari: URI_UU13, ke: URI_PERPRES, jenis: "terkait", keterangan: "Perpres 10/2020" },
        { dari: URI_UU13, ke: URI_PERMEN, jenis: "terkait", keterangan: "Permen 5/2024" },
      ]);
      lebarkan();
      expect((await detail(URI_PERPRES)).status).toBe(200);
      expect((await detail(URI_PERMEN)).status).toBe(200);
      const tujuan = (await json<LawDetailResponse>(await detail(URI_UU13))).relations.map((r) => r.to_uri);
      expect(tujuan).toContain(URI_PERPRES);
      expect(tujuan).toContain(URI_PERMEN);
    });
  });

  describe("saran ketik (GET /api/suggest)", () => {
    it("tidak menyarankan peraturan di luar cakupan", async () => {
      const saran = async () => (await ambil<{ suggestions: Array<{ uri: string | null }> }>("/api/suggest?q=Pesangon")).suggestions;
      expect((await saran()).map((s) => s.uri)).not.toContain(URI_PERPRES);
      lebarkan();
      expect((await saran()).map((s) => s.uri)).toContain(URI_PERPRES);
    });
  });

  describe("statistik (GET /api/stats)", () => {
    it("menghitung hanya yang dalam cakupan, dan menyebutkan cakupannya", async () => {
      const b = await ambil<{
        cakupan: string[]; total_peraturan: number; total_pasal: number;
        per_jenis: Array<{ jenis: string; n: number }>; terbaru: Array<{ jenis: string }>;
      }>("/api/stats");
      expect(b.cakupan).toEqual(BAWAAN);
      expect(b.total_peraturan).toBe(KORPUS.length);
      expect(b.total_pasal).toBe(KORPUS.reduce((n, p) => n + (p.pasal?.length ?? 0), 0));
      expect(b.per_jenis.map((x) => x.jenis).sort()).toEqual(["PP", "UU"]);
      for (const r of b.terbaru) expect(["UU", "PP"]).toContain(r.jenis);
    });

    it("dengan cakupan dilebarkan, hitungannya ikut melebar dan cakupan yang dilaporkan berubah", async () => {
      lebarkan();
      const b = await ambil<{ cakupan: string[]; total_peraturan: number }>("/api/stats");
      expect(b.total_peraturan).toBe(KORPUS.length + LUAR.length);
      expect(b.cakupan).toContain("PERPRES");
    });
  });

  describe("bidang hukum (GET /api/bidang)", () => {
    const naker = async () =>
      (await ambil<{ bidang: Array<{ nama: string; jumlah: number }> }>("/api/bidang")).bidang.find((b) => b.nama === "KETENAGAKERJAAN")?.jumlah;

    it("tidak menghitung peraturan di luar cakupan", async () => {
      // UU 13/2003, PP 35/2021, dan UU 11/2020 ("EKONOMI - KETENAGAKERJAAN"); bukan Perpres dan Permen.
      expect(await naker()).toBe(3);
      lebarkan();
      expect(await naker()).toBe(5);
    });
  });

  describe("peta relasi (GET /api/relasi/graf)", () => {
    const graf = (uri: string, ekstra = "") =>
      ambil<{ pusat: string; simpul: Array<{ uri: string }>; sisi: Array<{ dari: string; ke: string }> }>(`/api/relasi/graf?uri=${encodeURIComponent(uri)}${ekstra}`);

    beforeEach(async () => {
      await sisipkanRelasi(l, [
        ...RELASI_CIPTA_KERJA,
        { dari: URI_UU13, ke: "/akn/id/act/uu/2020/11", jenis: "diubah_oleh" },
        { dari: URI_UU13, ke: URI_PERPRES, jenis: "terkait" },
        { dari: URI_PERPRES, ke: "/akn/id/act/pp/2021/35", jenis: "melaksanakan" }, // masuk dari peraturan tersembunyi
        { dari: URI_PERMEN, ke: URI_UU13, jenis: "melaksanakan" }, // segmen tak baku: kolom jenis yang menentukan
      ]);
    });

    it("tidak menggambar simpul maupun sisi ke peraturan di luar cakupan, juga pada kedalaman 2", async () => {
      for (const kedalaman of ["", "&kedalaman=2"]) {
        const b = await graf("/akn/id/act/uu/2020/11", kedalaman);
        const uris = new Set(b.simpul.map((s) => s.uri));
        expect(uris.has(URI_PERPRES), kedalaman).toBe(false);
        expect(uris.has(URI_PERMEN), kedalaman).toBe(false);
        for (const s of b.sisi) {
          expect(uris.has(s.dari) && uris.has(s.ke), kedalaman).toBe(true);
        }
      }
      const pusat = await graf(URI_UU13, "&kedalaman=2");
      expect(pusat.simpul.map((s) => s.uri).sort()).toEqual([URI_UU13, "/akn/id/act/uu/2020/11", "/akn/id/act/uu/2023/6"].sort());
    });

    it("pusat di luar cakupan menjawab 404 di_luar_cakupan", async () => {
      const res = await panggil(l, `/api/relasi/graf?uri=${encodeURIComponent(URI_PERPRES)}`);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: "di_luar_cakupan" });
    });

    it("pusat dengan segmen URI tak baku di luar cakupan juga menjawab 404", async () => {
      const res = await panggil(l, `/api/relasi/graf?uri=${encodeURIComponent(URI_PERMEN)}`);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: "di_luar_cakupan" });
    });

    it("dengan cakupan dilebarkan, simpul dan sisi itu muncul, juga yang segmen URI-nya tak baku", async () => {
      lebarkan();
      const b = await graf(URI_UU13);
      expect(b.simpul.map((s) => s.uri)).toContain(URI_PERPRES);
      expect(b.simpul.map((s) => s.uri)).toContain(URI_PERMEN);
    });
  });

  describe("sitemap.xml", () => {
    it("hanya memuat peraturan dalam cakupan", async () => {
      const xml = await (await panggil(l, "/sitemap.xml")).text();
      expect(xml).toContain(encodeURIComponent(URI_UU13));
      expect(xml).not.toContain(encodeURIComponent(URI_PERPRES));
      expect(xml.match(/<url>/g)).toHaveLength(KORPUS.length);
      lebarkan();
      expect((await (await panggil(l, "/sitemap.xml")).text()).match(/<url>/g)).toHaveLength(KORPUS.length + LUAR.length);
    });
  });

  describe("dokumen (R2)", () => {
    it("berkas peraturan di luar cakupan tidak disajikan, yang dalam cakupan tetap", async () => {
      for (const [uri, kunci] of [[URI_UU13, "pdf/uu13.pdf"], [URI_PERPRES, "pdf/perpres10.pdf"]] as const) {
        await l.r2.put(kunci, new TextEncoder().encode("%PDF-1.4 uji"));
        await l.db.prepare("UPDATE laws SET r2_pdf_key = ?, r2_text_key = ? WHERE frbr_uri = ?").bind(kunci, kunci.replace("pdf", "teks"), uri).run();
        await l.r2.put(kunci.replace("pdf", "teks"), "teks uji");
      }
      const q = (uri: string) => encodeURIComponent(uri);
      for (const rute of ["status", "pdf", "teks"]) {
        expect((await panggil(l, `/api/dokumen/${rute}?uri=${q(URI_UU13)}`)).status, `${rute} dalam cakupan`).toBe(200);
        expect((await panggil(l, `/api/dokumen/${rute}?uri=${q(URI_PERPRES)}`)).status, `${rute} di luar cakupan`).toBe(404);
      }
    });
  });

  describe("pratinjau tautan (GET /peraturan)", () => {
    const UA_PERAYAP = "WhatsApp/2.24.20.85 A";
    const html = async (uri: string) =>
      (await panggil(l, `/peraturan?uri=${encodeURIComponent(uri)}`, { headers: { "user-agent": UA_PERAYAP } })).text();

    it("peraturan di luar cakupan mendapat cangkang biasa tanpa judul dan gambar pratinjau miliknya", async () => {
      const luar = await html(URI_PERPRES);
      expect(luar).not.toContain("Pesangon Pegawai Lembaga");
      expect(luar).not.toContain('property="og:image"');
      expect(await html(URI_UU13)).toContain("Ketenagakerjaan");
    });
  });

  describe("tanya jawab (POST /api/tanya)", () => {
    it("hanya bersandar pada pasal dalam cakupan", async () => {
      const res = await panggil(l, "/api/tanya", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pertanyaan: "Apa kewajiban pembayaran uang pesangon pegawai lembaga menurut pedoman?" }),
      });
      const b = await json<{ sitasi: Array<{ frbr_uri: string }> }>(res);
      for (const s of b.sitasi) expect(s.frbr_uri).not.toBe(URI_PERPRES);
      expect(l.ai.panggilanObrolan.every((p) => !JSON.stringify(p.masukan).includes("sesuai pedoman ini"))).toBe(true);
    });
  });
});
