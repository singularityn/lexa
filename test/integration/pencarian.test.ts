/**
 * GET /api/search di atas FTS5 sungguhan. Sisi vektor memakai embedding
 * deterministik palsu, jadi urutan hasil vektor tidak diasersikan di sini
 * (kualitas semantik hanya bisa dinilai pada Workers AI asli); yang diuji:
 * penggabungan sumber, filter, cache, log, dan ketahanan terhadap kegagalan.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buatLingkungan, indeksSemua, json, KORPUS, panggil, sisipkan, sqliteAda, type Lingkungan, type PeraturanUji,
} from "./harness";
import type { SearchHit, SearchResponse } from "../../src/shared/types";
import { bacaCakupan } from "../../src/shared/cakupan";
import { cari as cariLangsung } from "../../src/worker/lib/search";

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

  describe("nomor pasal hasil OCR", () => {
    it('hasil pasal "1O" ditampilkan sebagai Pasal 10, sedangkan id (tautan) tetap id aslinya', async () => {
      await sisipkan(l, [{ uri: "/akn/id/act/uu/2023/99", jenis: "UU", nomor: "99", tahun: 2023, judul: "Contoh OCR", pasal: [{ nomor: "1O", ayat: "1", isi: "Setiap orang wajib menjaga kebersihan lingkungan pasar tradisional." }] }]);
      const b = await cari(q("kebersihan lingkungan pasar", "mode=keyword"));
      const h = b.hits.find((x) => x.frbr_uri === "/akn/id/act/uu/2023/99");
      expect(h).toMatchObject({ article_id: "/akn/id/act/uu/2023/99#pasal-1O-ayat-1", nomor_pasal: "10", ayat: "1" });
    });
  });

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

  describe("relevansi: kata yang diketik di atas sinonim, ejaan, dan pencarian longgar", () => {
    it("dokumen yang memuat kata yang diketik mengalahkan dokumen yang hanya memuat sinonimnya", async () => {
      // Kasus nyata di produksi: "pesangon" menempatkan Perpres tentang "uang kompensasi" anggota KPU di atas
      // UU Ketenagakerjaan karena "kompensasi" (sinonim) muncul di judul dan tentang-nya. Di sini berupa PP
      // karena Perpres di luar cakupan; yang diuji adalah urutan hasil, bukan jenisnya.
      await sisipkan(l, [
        {
          uri: "/akn/id/act/pp/2015/22", jenis: "PP", nomor: "22", tahun: 2015,
          judul: "Pemberian Uang Kompensasi Bagi Ketua dan Anggota Komisi Pemilihan Umum", tentang: "Uang kompensasi anggota komisi",
          pasal: [{ nomor: "1", isi: "Uang kompensasi diberikan sekali kepada anggota komisi. Kompensasi dibayarkan dari anggaran." }],
        },
      ]);
      const b = await cari(q("pesangon", "mode=keyword"));
      const urutan = uris(b.hits);
      const literal = ["/akn/id/act/uu/2003/13#pasal-156-ayat-1", "/akn/id/act/pp/2021/35#pasal-40-ayat-1"];
      const sinonim = urutan.findIndex((u) => u.startsWith("/akn/id/act/pp/2015/22"));
      expect(sinonim, "yang hanya bersinonim tetap ditemukan").toBeGreaterThanOrEqual(0);
      for (const u of literal) expect(urutan.indexOf(u), u).toBeLessThan(sinonim);
    });

    it("ejaan resmi terbaru ditemukan dari ejaan lama: 'perlindungan' menemukan 'Pelindungan Data Pribadi' di peringkat pertama", async () => {
      await sisipkan(l, [
        { uri: "/akn/id/act/uu/2022/27", jenis: "UU", nomor: "27", tahun: 2022, judul: "Pelindungan Data Pribadi", tentang: "Pelindungan data pribadi" },
        { uri: "/akn/id/act/uu/1999/8", jenis: "UU", nomor: "8", tahun: 1999, judul: "Perlindungan Konsumen", tentang: "Perlindungan konsumen",
          pasal: [{ nomor: "4", isi: "Hak konsumen adalah hak atas data pribadi dan perlindungan." }] },
      ]);
      const b = await cari(q("perlindungan data pribadi", "mode=keyword"));
      expect(b.hits.map((h) => h.frbr_uri)).toContain("/akn/id/act/uu/2022/27");
      expect(b.hits[0].frbr_uri).toBe("/akn/id/act/uu/2022/27");
    });

    it("kalimat yang tak punya satu pasal pun memuat semua katanya tetap menemukan pasal yang tepat, dan ditandai longgar", async () => {
      const b = await cari(q("berapa lama cuti melahirkan bagi pekerja perempuan", "mode=keyword"));
      expect(uris(b.hits)).toContain("/akn/id/act/uu/2003/13#pasal-82-ayat-1");
      expect(b.longgar).toEqual({ penuh: 0 });
    });

    it("pencarian dua kata yang tidak ada tidak dilonggarkan (awalan 'selam' tidak boleh menemukan 'selama')", async () => {
      const b = await cari(q("kapal selam", "mode=keyword"));
      expect(b.hits).toEqual([]);
      expect(b.longgar).toBeUndefined();
    });

    it("longgar tidak dijalankan bila pencarian ketat sudah menemukan cukup hasil", async () => {
      await sisipkan(l, [1, 2, 3].map((n) => ({
        uri: `/akn/id/act/pp/2020/${n}`, jenis: "PP", nomor: String(n), tahun: 2020, judul: `Peraturan Malam ${n}`,
        pasal: [{ nomor: "1", isi: "Pekerja perempuan dilarang bekerja pada malam hari tanpa pengawalan." }],
      })));
      const b = await cari(q("pekerja perempuan malam", "mode=keyword"));
      expect(b.longgar).toBeUndefined();
      expect(b.hits.length).toBeGreaterThanOrEqual(3);
    });

    it("hasil yang memuat semua kata tetap di depan hasil yang memuat sebagian, dan jumlahnya dilaporkan", async () => {
      // Kata karangan agar tidak bersinggungan dengan sinonim atau awalan mana pun.
      await sisipkan(l, [
        { uri: "/akn/id/act/pp/2020/71", jenis: "PP", nomor: "71", tahun: 2020, judul: "Satwa Satu", pasal: [{ nomor: "1", isi: "Harimau, gajah, dan badak dilindungi." }] },
        { uri: "/akn/id/act/pp/2020/72", jenis: "PP", nomor: "72", tahun: 2020, judul: "Satwa Dua", pasal: [{ nomor: "1", isi: "Harimau dan gajah tidak boleh diburu." }] },
        { uri: "/akn/id/act/pp/2020/73", jenis: "PP", nomor: "73", tahun: 2020, judul: "Satwa Tiga", pasal: [{ nomor: "1", isi: "Gajah dan badak dikelola kawasan konservasi." }] },
      ]);
      const b = await cari(q("harimau gajah badak", "mode=keyword"));
      expect(b.longgar).toEqual({ penuh: 1 });
      expect(uris(b.hits)).toEqual([
        "/akn/id/act/pp/2020/71#pasal-1", // memuat ketiganya
        expect.stringMatching(/pp\/2020\/7[23]#pasal-1/),
        expect.stringMatching(/pp\/2020\/7[23]#pasal-1/),
      ]);
    });

    it("longgar bekerja juga pada mode gabungan (hybrid), tanpa menggeser sitasi", async () => {
      const b = await cari(q("berapa lama cuti melahirkan bagi pekerja perempuan"));
      expect(b.longgar).toBeDefined();
      const sitasi = await cari(q("UU 13/2003"));
      expect(sitasi.hits[0].frbr_uri).toBe("/akn/id/act/uu/2003/13");
    });

    it("sumber hasil tetap 'fts' (pembobotan harfiah/sinonim/longgar tidak bocor ke antarmuka)", async () => {
      const b = await cari(q("pesangon", "mode=keyword"));
      for (const h of b.hits) expect(h.sources).toEqual(["fts"]);
    });
  });

  describe("tingkat judul: peraturan yang namanya memuat kata kunci di atas pasal", () => {
    const UU32 = "/akn/id/act/uu/2014/32";
    const PP27 = "/akn/id/act/pp/2021/27";
    const PP62 = "/akn/id/act/pp/2002/62";
    const UU31 = "/akn/id/act/uu/2004/31";
    const UU62 = "/akn/id/act/uu/1962/1";
    const PP19 = "/akn/id/act/pp/2019/5";

    /** Judul dan keadaan data produksi untuk kata "kelautan" (D1, 12 Oktober 2026). */
    const KELAUTAN: PeraturanUji[] = [
      {
        uri: UU32, jenis: "UU", nomor: "32", tahun: 2014, status: "diubah",
        judul: "Undang-Undang Nomor 32 Tahun 2014 tentang Kelautan", tentang: "PERIKANAN DAN KELAUTAN", bidang: "PERIKANAN DAN KELAUTAN",
        pasal: [{ nomor: "1", isi: "Kelautan adalah hal yang berkaitan dengan laut dan atau aktivitas masyarakat di wilayah laut." }],
      },
      {
        uri: PP27, jenis: "PP", nomor: "27", tahun: 2021, status: "dicabut",
        judul: "Peraturan Pemerintah Nomor 27 Tahun 2021 tentang PENYELENGGARAAN BIDANG KELAUTAN DAN PERIKANAN",
      },
      {
        uri: PP62, jenis: "PP", nomor: "62", tahun: 2002,
        judul: "Peraturan Pemerintah Nomor 62 Tahun 2002 tentang TARIF ATAS JENIS PENERIMAAN NEGARA BUKAN PAJAK YANG BERLAKU PADA DEPARTEMEN KELAUTAN DAN PERIKANAN",
      },
      {
        // Hanya bidangnya yang kelautan; judulnya tidak. Pasalnya menyebut kata itu berulang-ulang.
        uri: UU31, jenis: "UU", nomor: "31", tahun: 2004, status: "diubah",
        judul: "Undang-Undang Nomor 31 Tahun 2004 tentang PERIKANAN", tentang: "PERIKANAN DAN KELAUTAN", bidang: "PERIKANAN DAN KELAUTAN",
        pasal: [
          { nomor: "2", isi: "Pengelolaan perikanan dilakukan berdasarkan kebijakan kelautan dan kelautan nasional." },
          { nomor: "3", isi: "Menteri yang membidangi kelautan menetapkan kebijakan kelautan, kelautan dan perikanan." },
          { nomor: "4", isi: "Kelautan, kelautan, dan kelautan menjadi dasar penetapan wilayah pengelolaan perikanan." },
        ],
      },
      {
        // "laut" saja, bukan "kelautan".
        uri: UU62, jenis: "UU", nomor: "1", tahun: 1962, status: "dicabut",
        judul: "Undang-Undang Nomor 1 Tahun 1962 tentang Karantina Laut", tentang: "PERIKANAN DAN KELAUTAN", bidang: "PERIKANAN DAN KELAUTAN",
      },
      {
        uri: PP19, jenis: "PP", nomor: "5", tahun: 2019, judul: "Peraturan Pemerintah Nomor 5 Tahun 2019 tentang Pengelolaan Pesisir",
        pasal: [
          { nomor: "7", isi: "Pengelolaan pesisir selaras dengan kebijakan kelautan nasional dan kelautan regional." },
          { nomor: "8", isi: "Kelautan menjadi bagian perencanaan ruang pesisir, kelautan, dan pulau-pulau kecil." },
        ],
      },
    ];

    beforeEach(async () => {
      await sisipkan(l, KELAUTAN);
      await indeksSemua(l, KELAUTAN.map((p) => p.uri));
    });

    const cocok = (hits: SearchHit[]) => hits.filter((h) => h.cocok_judul).map((h) => h.frbr_uri);

    it('"kelautan": peraturan berjudul Kelautan di peringkat pertama, bukan pasal yang menyebutnya (keluhan pengguna)', async () => {
      for (const mode of ["hybrid", "keyword"]) {
        const b = await cari(q("kelautan", `mode=${mode}`));
        // UU 32/2014 persis "Kelautan"; PP 27/2021 pokoknya 4 kata; PP tarif PNBP pokoknya 10 kata.
        expect(b.hits.slice(0, 3).map((h) => h.frbr_uri), mode).toEqual([UU32, PP27, PP62]);
        for (const h of b.hits.slice(0, 3)) expect(h, mode).toMatchObject({ article_id: null, cocok_judul: true });
      }
    });

    it("semua peraturan tingkat judul mendahului semua hasil lain, dan hasil pasal tetap tampil di bawahnya", async () => {
      const b = await cari(q("kelautan"));
      const terakhirJudul = b.hits.map((h) => h.cocok_judul === true).lastIndexOf(true);
      expect(terakhirJudul).toBe(2);
      expect(b.hits.slice(terakhirJudul + 1).some((h) => h.cocok_judul)).toBe(false);
      // Pasal yang menyebut kata itu masih ada, di bawah.
      const pasal = b.hits.filter((h) => h.article_id !== null);
      expect(pasal.length).toBeGreaterThan(0);
      expect(pasal.some((h) => h.frbr_uri === UU31)).toBe(true);
      expect(pasal.some((h) => h.frbr_uri === PP19)).toBe(true);
      for (const h of pasal) expect(h.cocok_judul).toBeUndefined();
    });

    it("peraturan yang hanya bidangnya (tentang) atau kata dasarnya yang cocok bukan tingkat judul", async () => {
      const b = await cari(q("kelautan"));
      expect(cocok(b.hits)).toEqual([UU32, PP27, PP62]);
      expect(cocok(b.hits)).not.toContain(UU31);
      expect(cocok(b.hits)).not.toContain(UU62);
      // Tetap ditemukan di tingkat bawah: UU Perikanan (bidang dan pasalnya) tidak hilang.
      expect(b.hits.some((h) => h.frbr_uri === UU31 && h.article_id === null)).toBe(true);
    });

    it("tanpa judul yang cocok, urutan lama (fusi) tidak berubah dan tidak ada penanda", async () => {
      const b = await cari(q("pesangon"));
      expect(b.hits.length).toBeGreaterThan(0);
      for (const h of b.hits) expect(h.cocok_judul).toBeUndefined();
    });

    it("mode semantic tidak memakai tingkat judul (pengguna sengaja mencari makna)", async () => {
      const b = await cari(q("kelautan", "mode=semantic"));
      for (const h of b.hits) expect(h.cocok_judul).toBeUndefined();
    });

    it("filter status dan jenis berlaku pada tingkat judul", async () => {
      expect(cocok((await cari(q("kelautan", "mode=keyword&status=berlaku"))).hits)).toEqual([PP62]);
      expect(cocok((await cari(q("kelautan", "mode=keyword&jenis=UU"))).hits)).toEqual([UU32]);
      expect(cocok((await cari(q("kelautan", "mode=keyword&tahun_max=2010"))).hits)).toEqual([PP62]);
    });

    it("petunjuk jenis di kueri ('pp kelautan', 'uu kelautan') membatasi tingkat judul pada jenis itu", async () => {
      expect(cocok((await cari(q("pp kelautan", "mode=keyword"))).hits)).toEqual([PP27, PP62]);
      expect(cocok((await cari(q("uu kelautan", "mode=keyword"))).hits)).toEqual([UU32]);
      expect(cocok((await cari(q("PERPPU kelautan", "mode=keyword"))).hits)).toEqual([]);
    });

    it("kata jenis yang berdiri sendiri bukan petunjuk: 'pp' saja tidak menyaring apa pun dan tidak menjatuhkan pencarian", async () => {
      const res = await panggil(l, `/api/search?${q("pp", "mode=keyword")}`);
      expect(res.status).toBe(200);
    });

    it("kata di bagian depan judul ('peraturan pemerintah') tidak meloloskan PP biasa; hanya judul yang menyebutnya di pokoknya", async () => {
      const b = await cari(q("peraturan pemerintah", "mode=keyword"));
      // Penetapan Perppu menjadi UU memuat kata itu di pokoknya ("Penetapan Peraturan Pemerintah Pengganti ...").
      expect(cocok(b.hits)).toEqual(["/akn/id/act/uu/2023/6"]);
      for (const uri of [PP27, PP62, "/akn/id/act/pp/2021/35"]) expect(cocok(b.hits)).not.toContain(uri);
    });

    it("beberapa kata: semuanya harus ada di judul; 'kelautan perikanan' tidak meloloskan judul yang hanya satu kata", async () => {
      const b = await cari(q("kelautan perikanan", "mode=keyword"));
      expect(cocok(b.hits)).toEqual([PP27, PP62]);
    });

    it("kueri berbentuk sitasi tidak memakai tingkat judul", async () => {
      const b = await cari(q("UU 32/2014"));
      expect(b.hits[0]).toMatchObject({ frbr_uri: UU32, article_id: null });
      expect(b.hits[0].sources).toContain("sitasi");
      for (const h of b.hits) expect(h.cocok_judul).toBeUndefined();
    });

    it("peraturan di luar cakupan tidak muncul di tingkat judul", async () => {
      await sisipkan(l, [{ uri: "/akn/id/act/perpres/2020/1", jenis: "PERPRES", nomor: "1", tahun: 2020, judul: "Peraturan Presiden Nomor 1 Tahun 2020 tentang Kelautan" }]);
      const b = await cari(q("kelautan", "mode=keyword"));
      expect(b.hits.some((h) => h.frbr_uri === "/akn/id/act/perpres/2020/1")).toBe(false);
      const luas = await cari(q("kelautan", "mode=keyword&jenis=PERPRES"));
      expect(luas.hits.some((h) => h.frbr_uri === "/akn/id/act/perpres/2020/1")).toBe(false);
    });

    it("jatah halaman: judul yang terlalu banyak tidak menghabiskan halaman, pasal yang memuat kata itu tetap tampil", async () => {
      await sisipkan(
        l,
        Array.from({ length: 30 }, (_, i) => ({
          uri: `/akn/id/act/pp/2010/${100 + i}`, jenis: "PP", nomor: String(100 + i), tahun: 2010,
          judul: `Peraturan Pemerintah Nomor ${100 + i} Tahun 2010 tentang Kelautan Daerah Kelompok ${i + 1}`,
        })),
      );
      const b = await cari(q("kelautan", "mode=keyword&limit=20"));
      expect(b.hits).toHaveLength(20);
      expect(b.hits.filter((h) => h.cocok_judul)).toHaveLength(15);
      expect(b.hits.slice(0, 15).every((h) => h.cocok_judul === true)).toBe(true);
      expect(b.hits.slice(15).some((h) => h.article_id !== null)).toBe(true);
      // UU 32/2014 persis "Kelautan" tetap yang pertama di antara semuanya.
      expect(b.hits[0].frbr_uri).toBe(UU32);
      // Halaman yang lebih besar memuat lebih banyak judul.
      const besar = await cari(q("kelautan", "mode=keyword&limit=50"));
      expect(besar.hits.filter((h) => h.cocok_judul)).toHaveLength(33);
    });

    it("prioritasJudul: false mematikan tingkat judul (dipakai Tanya Lexa, yang hanya memakai pasal)", async () => {
      const ctx = {
        db: l.env.DB, ai: l.env.AI, vectorize: l.env.VECTORIZE, cache: l.env.CACHE, embeddingModel: l.env.EMBEDDING_MODEL,
        cacheTtl: 3600, cakupan: bacaCakupan(l.env.CAKUPAN_JENIS),
      };
      const nyala = await cariLangsung(ctx, { query: "kelautan", limit: 12 });
      const mati = await cariLangsung(ctx, { query: "kelautan", limit: 12, prioritasJudul: false });
      expect(nyala.hits.some((h) => h.cocok_judul)).toBe(true);
      expect(mati.hits.some((h) => h.cocok_judul)).toBe(false);
      // Hasil yang sama tetap ditemukan; hanya urutan tingkatnya yang tidak berlaku.
      expect(new Set(mati.hits.map((h) => h.article_id ?? h.frbr_uri))).toEqual(new Set(nyala.hits.map((h) => h.article_id ?? h.frbr_uri)));
    });

    it("kata yang ada di lebih dari seratus judul: yang berjudul persis kata itu tidak terpotong sebelum dinilai", async () => {
      // 110 judul panjang yang menyebut kata itu berulang kali (BM25 menyukainya), di samping UU 31/2004 yang berjudul
      // persis "PERIKANAN" (sudah ada di korpus).
      await sisipkan(
        l,
        Array.from({ length: 110 }, (_, i) => ({
          uri: `/akn/id/act/pp/2011/${200 + i}`, jenis: "PP", nomor: String(200 + i), tahun: 2011,
          judul: `Peraturan Pemerintah Nomor ${200 + i} Tahun 2011 tentang Perusahaan Perikanan Negara Perikanan Daerah Perikanan Cabang ${i + 1}`,
        })),
      );
      const b = await cari(q("perikanan", "mode=keyword&limit=5"));
      expect(b.hits[0]).toMatchObject({ frbr_uri: UU31, article_id: null, cocok_judul: true });
    });

    it("cuplikan peraturan tingkat judul menandai kata yang diketik pada judulnya", async () => {
      const b = await cari(q("kelautan", "mode=keyword"));
      expect(b.hits[0].snippet).toContain("<mark>Kelautan</mark>");
    });

    it("judul yang hanya rujukan (sumber katalog tak memberi pokok) tidak lolos oleh kata bidangnya", async () => {
      await sisipkan(l, [{ uri: "/akn/id/act/uu/1981/7", jenis: "UU", nomor: "7", tahun: 1981, judul: "Undang-Undang Nomor 7 Tahun 1981", tentang: "KETENAGAKERJAAN" }]);
      const b = await cari(q("ketenagakerjaan", "mode=keyword"));
      expect(cocok(b.hits)).not.toContain("/akn/id/act/uu/1981/7");
      // Tetap ditemukan lewat tingkat bawah (kolom tentang).
      expect(b.hits.some((h) => h.frbr_uri === "/akn/id/act/uu/1981/7")).toBe(true);
    });

    it("kueri 'constructor' (nama properti bawaan Object) tidak menjatuhkan pencarian", async () => {
      const res = await panggil(l, `/api/search?${q("constructor")}`);
      expect(res.status).toBe(200);
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

  describe("sitasi bentuk alami dan nomor POJK bersufiks", () => {
    // Logika sitasi POJK dan Permen tetap dijaga walau keduanya kini di luar cakupan bawaan: cakupan dilebarkan
    // lewat variabel CAKUPAN_JENIS, sama seperti yang akan dilakukan bila suatu hari cakupan diperluas.
    beforeEach(() => {
      l.env.CAKUPAN_JENIS = "UU,PERPPU,PP,PERMEN,POJK";
    });

    const pojk = (nomor: string, tahun: number, judul = "Peraturan Badan") => ({
      uri: `/akn/id/act/peraturan-ojk/${tahun}/${nomor}`, jenis: "POJK", nomor, tahun, judul: `${judul} Nomor ${nomor} Tahun ${tahun}`,
    });

    beforeEach(async () => {
      await sisipkan(l, [
        // Data produksi: 422 dari 547 POJK bernomor slug seperti ini.
        pojk("1-pojk-03-2019", 2019),
        pojk("1-pojk-04-2019", 2019),
        pojk("1-pojk-05-2019", 2019),
        pojk("10-pojk-03-2019", 2019), // awalan "1" tetapi bukan "1-": tidak boleh ikut
        pojk("11-pojk-03-2019", 2019),
        pojk("1-pojk-03-2020", 2020), // tahun lain
        pojk("23", 2023),
        {
          uri: "/akn/id/act/perppu/2022/2", jenis: "PERPPU", nomor: "2", tahun: 2022,
          judul: "Peraturan Pemerintah Pengganti Undang-Undang Nomor 2 Tahun 2022 tentang Cipta Kerja",
        },
        // Umpan: UU bernomor dan bertahun sama dengan PERPPU di atas.
        { uri: "/akn/id/act/uu/2022/2", jenis: "UU", nomor: "2", tahun: 2022, judul: "Umpan Undang-Undang Nomor 2 Tahun 2022" },
        { uri: "/akn/id/act/permen/2025/29", jenis: "PERMEN", nomor: "29", tahun: 2025, judul: "Peraturan Menteri Nomor 29 Tahun 2025 tentang Pedoman Umum" },
      ]);
    });

    const sitasiSaja = (hits: SearchHit[]) => hits.filter((h) => h.sources.includes("sitasi")).map((h) => h.frbr_uri);

    it("nama panjang dan bentuk resmi menemukan peraturannya di peringkat pertama", async () => {
      for (const [kueri, uri] of [
        ["Peraturan Pemerintah Nomor 35 Tahun 2021", "/akn/id/act/pp/2021/35"],
        ["Peraturan Pemerintah Republik Indonesia Nomor 35 Tahun 2021 tentang PKWT", "/akn/id/act/pp/2021/35"],
        ["Undang-Undang Republik Indonesia Nomor 13 Tahun 2003", "/akn/id/act/uu/2003/13"],
        ["Undang Undang No 13 tahun 2003", "/akn/id/act/uu/2003/13"],
        ["UU RI No. 13 Tahun 2003", "/akn/id/act/uu/2003/13"],
        ["Peraturan Menteri Kesehatan Nomor 29 Tahun 2025", "/akn/id/act/permen/2025/29"],
        ["Peraturan Otoritas Jasa Keuangan Nomor 23 Tahun 2023", "/akn/id/act/peraturan-ojk/2023/23"],
      ] as const) {
        const b = await cari(q(kueri, "mode=keyword"));
        expect(b.hits[0], kueri).toMatchObject({ frbr_uri: uri, article_id: null });
        expect(b.hits[0].sources, kueri).toContain("sitasi");
      }
    });

    it("Peraturan Pemerintah Pengganti Undang-Undang menemukan PERPPU, bukan UU bernomor dan bertahun sama", async () => {
      for (const kueri of ["Peraturan Pemerintah Pengganti Undang-Undang Nomor 2 Tahun 2022", "Perpu 2/2022", "Perppu No. 2 Tahun 2022"]) {
        const b = await cari(q(kueri, "mode=keyword"));
        expect(sitasiSaja(b.hits), kueri).toEqual(["/akn/id/act/perppu/2022/2"]);
        expect(b.hits[0].frbr_uri, kueri).toBe("/akn/id/act/perppu/2022/2");
      }
    });

    it("POJK bernomor slug ditemukan lewat nomor-tahun, dan tidak menyeret nomor berawalan angka yang sama", async () => {
      const b = await cari(q("POJK Nomor 1 Tahun 2019", "mode=keyword"));
      // Semua sektor nomor 1 tahun 2019, terurut menurut nomor; bukan 10-/11-, bukan tahun lain.
      expect(sitasiSaja(b.hits)).toEqual([
        "/akn/id/act/peraturan-ojk/2019/1-pojk-03-2019",
        "/akn/id/act/peraturan-ojk/2019/1-pojk-04-2019",
        "/akn/id/act/peraturan-ojk/2019/1-pojk-05-2019",
      ]);
    });

    it("penomoran resmi 'n/POJK.ss/tahun' menemukan tepat satu sektor", async () => {
      for (const kueri of ["POJK 1/POJK.04/2019", "1/POJK.04/2019", "Peraturan OJK Nomor 1/POJK.04/2019 tentang apa saja"]) {
        const b = await cari(q(kueri, "mode=keyword"));
        expect(sitasiSaja(b.hits), kueri).toEqual(["/akn/id/act/peraturan-ojk/2019/1-pojk-04-2019"]);
        expect(b.hits[0].frbr_uri, kueri).toBe("/akn/id/act/peraturan-ojk/2019/1-pojk-04-2019");
      }
    });

    it("POJK dengan nomor polos tetap ditemukan, dan filter status tetap berlaku pada sitasi POJK", async () => {
      expect(sitasiSaja((await cari(q("POJK 23/2023", "mode=keyword"))).hits)).toEqual(["/akn/id/act/peraturan-ojk/2023/23"]);
      await l.db.prepare("UPDATE laws SET status = 'dicabut' WHERE frbr_uri LIKE '%1-pojk-04-2019'").run();
      const b = await cari(q("POJK Nomor 1 Tahun 2019", "mode=keyword&status=berlaku"));
      expect(sitasiSaja(b.hits)).toEqual([
        "/akn/id/act/peraturan-ojk/2019/1-pojk-03-2019",
        "/akn/id/act/peraturan-ojk/2019/1-pojk-05-2019",
      ]);
    });

    it("sitasi yang tidak ada di basis data tidak menghasilkan hasil sitasi", async () => {
      expect(sitasiSaja((await cari(q("POJK 99/POJK.04/2019", "mode=keyword"))).hits)).toEqual([]);
      expect(sitasiSaja((await cari(q("Peraturan Pemerintah Nomor 999 Tahun 2021", "mode=keyword"))).hits)).toEqual([]);
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
      const kunci = [...l.kv.isi.keys()].filter((k) => k.startsWith("cari:v5:"));
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
