/**
 * GET /api/search di atas FTS5 sungguhan. Sisi vektor memakai embedding
 * deterministik palsu, jadi urutan hasil vektor tidak diasersikan di sini
 * (kualitas semantik hanya bisa dinilai pada Workers AI asli); yang diuji:
 * penggabungan sumber, filter, cache, log, dan ketahanan terhadap kegagalan.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buatLingkungan, indeksSemua, json, KORPUS, panggil, sisipkan, sqliteAda, type Lingkungan,
} from "./harness";
import type { SearchHit, SearchResponse } from "../../src/shared/types";

describe.skipIf(!sqliteAda)("GET /api/search", () => {
  let l: Lingkungan;
  beforeEach(async () => {
    l = buatLingkungan();
    await sisipkan(l, KORPUS);
    await indeksSemua(l);
  });
  afterEach(() => l.tutup());

  const cari = async (qs: string) => json<SearchResponse>(await panggil(l, `/api/search?${qs}`));
  const q = (teks: string, ekstra = "") => `q=${encodeURIComponent(teks)}${ekstra ? `&${ekstra}` : ""}`;
  const uris = (hits: SearchHit[]) => hits.map((h) => h.article_id ?? h.frbr_uri);

  describe("mode keyword (FTS5)", () => {
    it("menemukan pasal, memberi <mark> pada cuplikan, dan hanya bersumber fts", async () => {
      const b = await cari(q("pesangon", "mode=keyword"));
      expect(b.mode).toBe("keyword");
      expect(uris(b.hits).sort()).toEqual([
        "/akn/id/act/pp/2021/35#pasal-40-ayat-1",
        "/akn/id/act/uu/2003/13#pasal-156-ayat-1",
      ]);
      for (const h of b.hits) {
        expect(h.sources).toEqual(["fts"]);
        expect(h.snippet).toContain("<mark>");
        expect(h.score).toBeGreaterThan(0);
      }
      expect(b.expanded_terms).toEqual(expect.arrayContaining(["pesangon", "kompensasi"]));
    });

    it("sinonim menjembatani kosakata awam dan teks resmi ('cuti melahirkan' -> Pasal 82)", async () => {
      const b = await cari(q("cuti melahirkan", "mode=keyword"));
      expect(b.hits[0]).toMatchObject({
        article_id: "/akn/id/act/uu/2003/13#pasal-82-ayat-1", nomor_pasal: "82", ayat: "1", jenis: "UU", nomor: "13",
      });
    });

    it("mencocokkan judul peraturan, bukan hanya isi pasal", async () => {
      const b = await cari(q("Ketenagakerjaan", "mode=keyword"));
      expect(b.hits.some((h) => h.article_id === null && h.frbr_uri === "/akn/id/act/uu/2003/13")).toBe(true);
    });

    it("kueri tanpa kecocokan -> hasil kosong, bukan galat", async () => {
      const res = await panggil(l, `/api/search?${q("pesawat antariksa", "mode=keyword")}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ hits: [], total: 0 });
    });

    it("kueri berisi karakter sintaks FTS5 tidak menjatuhkan permintaan", async () => {
      for (const teks of ['"', "pesangon AND", "NEAR(", "a:b", "*", "pesangon)", "'; DROP TABLE laws; --"]) {
        const res = await panggil(l, `/api/search?${q(teks, "mode=keyword")}`);
        expect(res.status, teks).toBe(200);
      }
      expect((await json<{ total_peraturan: number }>(await panggil(l, "/api/stats"))).total_peraturan).toBe(4);
    });

    // Bug v0.1 yang sudah diperbaiki: ekspresi FTS5 tidak dikutip, sehingga "undang-undang"
    // terbaca sebagai "undang" dikurangi kolom "undang" dan galatnya ditelan. Hasilnya nihil
    // padahal judul UU 6/2023 memuat kata itu. Kata bertanda hubung sangat lazim di teks hukum.
    it("kata bertanda hubung ditemukan ('undang-undang')", async () => {
      const b = await cari(q("Pengganti Undang-Undang", "mode=keyword"));
      expect(b.hits.some((h) => h.frbr_uri === "/akn/id/act/uu/2023/6")).toBe(true);
    });

    it("kueri dengan tanda hubung tetap menghasilkan hasil FTS pada mode gabungan", async () => {
      const b = await cari(q("cipta kerja menjadi undang-undang"));
      expect(b.hits.some((h) => h.sources.includes("fts"))).toBe(true);
    });
  });

  describe("sitasi", () => {
    it("'UU 13/2003' menempatkan peraturan itu di peringkat teratas dengan sumber sitasi", async () => {
      const b = await cari(q("UU 13/2003"));
      expect(b.hits[0]).toMatchObject({ frbr_uri: "/akn/id/act/uu/2003/13", article_id: null });
      expect(b.hits[0].sources).toContain("sitasi");
      // Bobot sitasi jauh di atas sumber lain: tidak ada hasil yang boleh menggesernya.
      expect(b.hits[0].score).toBeGreaterThan(10 * b.hits[1].score);
    });

    it("sitasi dikenali pada semua mode, termasuk keyword dan semantic", async () => {
      for (const mode of ["keyword", "semantic", "hybrid"]) {
        const b = await cari(q("PP 35/2021", `mode=${mode}`));
        expect(b.hits[0], mode).toMatchObject({ frbr_uri: "/akn/id/act/pp/2021/35", article_id: null });
        expect(b.hits[0].sources, mode).toContain("sitasi");
      }
    });

    it("sitasi mengikuti filter: status=dicabut menyingkirkan peraturan yang berlaku", async () => {
      const b = await cari(q("UU 13/2003", "mode=keyword&status=dicabut"));
      expect(b.hits.some((h) => h.frbr_uri === "/akn/id/act/uu/2003/13")).toBe(false);
    });
  });

  describe("mode hybrid dan semantic", () => {
    it("hybrid menggabungkan fts dan vektor; pasal yang cocok di keduanya mendapat skor lebih tinggi", async () => {
      const b = await cari(q("cuti melahirkan"));
      expect(b.mode).toBe("hybrid");
      expect(b.hits[0]).toMatchObject({ article_id: "/akn/id/act/uu/2003/13#pasal-82-ayat-1" });
      expect(b.hits[0].sources.sort()).toEqual(["fts", "vector"]);
      expect(new Set(b.hits.flatMap((h) => h.sources))).toEqual(new Set(["fts", "vector"]));
      // Terurut menurun menurut skor.
      const skor = b.hits.map((h) => h.score);
      expect(skor).toEqual([...skor].sort((a, c) => c - a));
    });

    it("semantic hanya memakai vektor", async () => {
      const b = await cari(q("uang pesangon pekerja", "mode=semantic"));
      expect(b.mode).toBe("semantic");
      expect(b.hits.length).toBeGreaterThan(0);
      for (const h of b.hits) expect(h.sources).toEqual(["vector"]);
    });

    it("mode yang tidak dikenal jatuh ke hybrid", async () => {
      expect((await cari(q("pesangon", "mode=ngawur"))).mode).toBe("hybrid");
    });

    it("filter jenis diteruskan ke Vectorize sebagai filter metadata", async () => {
      const b = await cari(q("pemutusan hubungan kerja", "mode=semantic&jenis=PP"));
      expect(b.hits.length).toBeGreaterThan(0);
      for (const h of b.hits) expect(h.jenis).toBe("PP");
    });

    it("hit level pasal memuat potongan cuplikan walau tanpa FTS", async () => {
      const b = await cari(q("uang pesangon pekerja", "mode=semantic"));
      const pasal = b.hits.find((h) => h.article_id);
      expect(pasal?.snippet).toBeTruthy();
      expect(pasal?.snippet).not.toContain("<mark>");
    });
  });

  describe("filter", () => {
    it("status=dicabut hanya mengembalikan peraturan yang dicabut", async () => {
      const b = await cari(q("cipta kerja", "mode=keyword&status=dicabut"));
      expect(b.hits.length).toBeGreaterThan(0);
      for (const h of b.hits) expect(h.status).toBe("dicabut");
    });

    it("jenis dan rentang tahun dapat digabung", async () => {
      const b = await cari(q("pemutusan hubungan kerja", "mode=keyword&jenis=UU&tahun_max=2010"));
      expect(b.hits.length).toBeGreaterThan(0);
      for (const h of b.hits) {
        expect(h.jenis).toBe("UU");
        expect(h.tahun).toBeLessThanOrEqual(2010);
      }
    });

    it("filter bidang mencocokkan per bagian bidang gabungan", async () => {
      const b = await cari(q("cipta kerja", "mode=keyword&bidang=EKONOMI"));
      expect(new Set(b.hits.map((h) => h.frbr_uri))).toEqual(
        new Set(["/akn/id/act/uu/2020/11", "/akn/id/act/uu/2023/6"]),
      );
    });

    it("limit membatasi jumlah hasil", async () => {
      const b = await cari(q("pemutusan hubungan kerja", "mode=keyword&limit=1"));
      expect(b.hits).toHaveLength(1);
    });
  });

  describe("validasi", () => {
    it("q kosong atau hanya spasi -> 400", async () => {
      for (const qs of ["q=", "q=%20%20", ""]) {
        const res = await panggil(l, `/api/search?${qs}`);
        expect(res.status, qs).toBe(400);
        expect(await res.json()).toMatchObject({ error: "kueri_kosong" });
      }
    });

    it("q lebih dari 300 karakter -> 400", async () => {
      const res = await panggil(l, `/api/search?q=${"a".repeat(301)}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "kueri_terlalu_panjang" });
      expect((await panggil(l, `/api/search?q=${"a".repeat(300)}`)).status).toBe(200);
    });

    it("kueri yang seluruhnya kata henti tidak menghasilkan apa pun pada mode keyword", async () => {
      const b = await cari(q("yang dan di", "mode=keyword"));
      expect(b).toMatchObject({ hits: [], total: 0 });
    });
  });

  describe("cache dan log", () => {
    it("hasil yang ada isinya di-cache di KV; panggilan kedua bertanda cached", async () => {
      const pertama = await cari(q("pesangon", "mode=keyword"));
      expect(pertama.cached).toBe(false);
      const kunci = [...l.kv.isi.keys()].filter((k) => k.startsWith("cari:v2:"));
      expect(kunci).toHaveLength(1);
      const kedua = await cari(q("pesangon", "mode=keyword"));
      expect(kedua.cached).toBe(true);
      expect(kedua.hits).toEqual(pertama.hits);
    });

    it("hasil kosong tidak di-cache (biasanya tanda indeks belum lengkap)", async () => {
      await cari(q("pesawat antariksa", "mode=keyword"));
      expect([...l.kv.isi.keys()].filter((k) => k.startsWith("cari:"))).toEqual([]);
    });

    it("filter ikut membentuk kunci cache: filter berbeda tidak saling menimpa", async () => {
      const semua = await cari(q("cipta kerja", "mode=keyword"));
      const dicabut = await cari(q("cipta kerja", "mode=keyword&status=dicabut"));
      expect(dicabut.cached).toBe(false);
      expect(dicabut.hits.length).toBeLessThan(semua.hits.length);
    });

    it("tiap pencarian dicatat di search_log, termasuk yang nihil", async () => {
      await cari(q("pesangon", "mode=keyword"));
      await cari(q("pesawat antariksa", "mode=keyword"));
      const { results } = await l.db.prepare(`SELECT query, jumlah_hasil, mode FROM search_log ORDER BY id`).all();
      expect(results).toEqual([
        { query: "pesangon", jumlah_hasil: 2, mode: "keyword" },
        { query: "pesawat antariksa", jumlah_hasil: 0, mode: "keyword" },
      ]);
    });

    it("kegagalan menulis log tidak memengaruhi respons", async () => {
      l.sqlite.exec("DROP TABLE search_log");
      const res = await panggil(l, `/api/search?${q("pesangon", "mode=keyword")}`);
      expect(res.status).toBe(200);
    });
  });

  describe("id vektor yang tidak sah sebagai id pasal", () => {
    const UU13 = "/akn/id/act/uu/2003/13";
    /** Vectorize palsu yang mengembalikan id sesuai urutan yang diberikan, apa pun kuerinya. */
    function vektorTetap(ids: string[]) {
      l.vektor.query = async () => {
        const matches = ids.map((id) => ({ id, score: 0.9, metadata: { frbr_uri: id.split("#")[0] } }));
        return { matches, count: matches.length };
      };
    }

    it("potongan lanjutan pasal panjang (~n) dipetakan ke pasalnya dan digabung dengan potongan pertama", async () => {
      vektorTetap([`${UU13}#pasal-156-ayat-1~1`, `${UU13}#pasal-156-ayat-1`, `${UU13}#pasal-156-ayat-1~2`]);
      const b = await cari(q("apa saja", "mode=semantic"));
      expect(b.hits).toHaveLength(1);
      expect(b.hits[0]).toMatchObject({ article_id: `${UU13}#pasal-156-ayat-1`, nomor_pasal: "156", ayat: "1" });
      expect(JSON.stringify(b.hits)).not.toContain("~");
    });

    it("hanya potongan lanjutan yang muncul (induk tidak): tetap menjadi pasal induknya", async () => {
      vektorTetap([`${UU13}#pasal-82-ayat-1~3`]);
      const b = await cari(q("apa saja", "mode=semantic"));
      expect(b.hits[0]).toMatchObject({ article_id: `${UU13}#pasal-82-ayat-1`, nomor_pasal: "82" });
    });

    it("id kembar yang sah dari ingest (...~2) ada di tabel articles, jadi dibiarkan", async () => {
      await l.db
        .prepare(`INSERT INTO articles (id, frbr_uri, nomor_pasal, ayat, isi, urutan) VALUES (?,?,?,?,?,?)`)
        .bind(`${UU13}#pasal-82-ayat-1~2`, UU13, "82", "1", "Pasal 82 ayat (1) kembar karena nomor berulang.", 99)
        .run();
      vektorTetap([`${UU13}#pasal-82-ayat-1~2`, `${UU13}#pasal-82-ayat-1`]);
      const b = await cari(q("apa saja", "mode=semantic"));
      expect(b.hits.map((h) => h.article_id)).toEqual([`${UU13}#pasal-82-ayat-1~2`, `${UU13}#pasal-82-ayat-1`]);
    });

    it("vektor yatim (pasalnya sudah diganti) turun menjadi hasil tingkat peraturan, tanpa pasal fiktif", async () => {
      vektorTetap([`${UU13}#pasal-999`, `${UU13}#pasal-998~1`, `${UU13}#pasal-156-ayat-1`]);
      const b = await cari(q("apa saja", "mode=semantic"));
      const lawLevel = b.hits.filter((h) => h.article_id === null);
      expect(lawLevel).toHaveLength(1); // dua yatim digabung menjadi satu hasil peraturan
      expect(lawLevel[0]).toMatchObject({ frbr_uri: UU13, nomor_pasal: null, ayat: null });
      expect(b.hits.some((h) => h.article_id === `${UU13}#pasal-156-ayat-1`)).toBe(true);
      expect(b.hits.some((h) => h.nomor_pasal === null && h.article_id !== null)).toBe(false);
    });

    it("ratusan potongan sekaligus tidak melampaui batas parameter D1", async () => {
      vektorTetap(Array.from({ length: 150 }, (_, i) => `${UU13}#pasal-156-ayat-1~${i + 1}`));
      const res = await panggil(l, `/api/search?${q("apa saja", "mode=semantic")}`);
      expect(res.status).toBe(200);
      const b = (await res.json()) as SearchResponse;
      expect(b.hits).toHaveLength(1);
      expect(b.hits[0].article_id).toBe(`${UU13}#pasal-156-ayat-1`);
    });

    it("Tanya Lexa memperoleh teks pasal penuh walau Vectorize hanya menemukan potongan lanjutan", async () => {
      vektorTetap([`${UU13}#pasal-156-ayat-1~1`]);
      l.ai.jawaban = "Jawaban uji.";
      const res = await panggil(l, "/api/tanya", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pertanyaan: "apa saja" }) });
      const b = (await res.json()) as { sitasi: Array<{ nomor_pasal: string | null }> };
      expect(b.sitasi.map((x) => x.nomor_pasal)).toEqual(["156"]);
      const prompt = (l.ai.panggilanObrolan[0].masukan as { messages: Array<{ content: string }> }).messages[1].content;
      expect(prompt).toContain("### UU 13/2003 Pasal 156 ayat (1)");
    });
  });

  describe("ketahanan", () => {
    it("Workers AI gagal: hybrid tetap mengembalikan hasil FTS", async () => {
      l.ai.galat = new Error("AI mati");
      const res = await panggil(l, `/api/search?${q("pesangon")}`);
      expect(res.status).toBe(200);
      const b = (await res.json()) as SearchResponse;
      expect(b.hits.length).toBeGreaterThan(0);
      for (const h of b.hits) expect(h.sources).toEqual(["fts"]);
    });

    it("Workers AI gagal: semantic mengembalikan daftar kosong, bukan 500", async () => {
      l.ai.galat = new Error("AI mati");
      const res = await panggil(l, `/api/search?${q("pesangon", "mode=semantic")}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ hits: [], total: 0 });
    });

    it("kandidat vektor yatim (peraturannya sudah dihapus) disaring dari hasil", async () => {
      await l.db.prepare(`DELETE FROM laws WHERE frbr_uri = ?`).bind("/akn/id/act/pp/2021/35").run();
      const b = await cari(q("pemutusan hubungan kerja", "mode=semantic"));
      expect(b.hits.some((h) => h.frbr_uri === "/akn/id/act/pp/2021/35")).toBe(false);
    });
  });
});
