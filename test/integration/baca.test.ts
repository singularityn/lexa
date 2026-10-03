/**
 * Endpoint baca: statistik, telusur berfaset, detail, saran ketik, bidang, graf
 * relasi, robots.txt, sitemap. Aplikasi asli berjalan di atas SQLite sungguhan
 * (migrasi produksi apa adanya), jadi SQL-nya ikut teruji.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buatLingkungan, indeksSemua, json, KORPUS, panggil, RELASI_CIPTA_KERJA, sisipkan,
  sisipkanRelasi, sqliteAda, type Lingkungan,
} from "./harness";

interface Hukum { frbr_uri: string; judul: string; jenis: string; tahun: number }
interface Telusur {
  laws: Hukum[]; total: number; page: number; per_page: number;
  facets: Record<"jenis" | "tahun" | "status", Array<{ value: string; count: number; label: string }>>;
}

describe.skipIf(!sqliteAda)("endpoint baca", () => {
  let l: Lingkungan;
  beforeEach(async () => {
    l = buatLingkungan();
    await sisipkan(l, KORPUS);
    await sisipkanRelasi(l, RELASI_CIPTA_KERJA);
  });
  afterEach(() => l.tutup());

  describe("GET /api/stats", () => {
    it("menghitung peraturan, pasal, dan peraturan yang sudah terindeks vektor", async () => {
      await indeksSemua(l);
      const b = await json<Record<string, unknown>>(await panggil(l, "/api/stats"));
      expect(b).toMatchObject({
        total_peraturan: 4,
        total_pasal: 5,
        terindeks_vektor: 4,
        per_jenis: [{ jenis: "UU", n: 3 }, { jenis: "PP", n: 1 }],
        sinkronisasi_terakhir: [],
      });
      expect((b.terbaru as unknown[]).length).toBe(4);
    });

    it("peraturan yang belum diindeks tidak dihitung terindeks", async () => {
      const b = await json<{ terindeks_vektor: number }>(await panggil(l, "/api/stats"));
      expect(b.terindeks_vektor).toBe(0);
    });
  });

  describe("GET /api/laws", () => {
    const ambil = async (qs = "") => json<Telusur>(await panggil(l, `/api/laws${qs}`));

    it("mengembalikan halaman pertama, total, dan facet", async () => {
      const b = await ambil("?per_page=2");
      expect(b).toMatchObject({ total: 4, page: 1, per_page: 2 });
      expect(b.laws).toHaveLength(2);
      expect(b.facets.jenis).toEqual([
        { value: "UU", count: 3, label: "UU" },
        { value: "PP", count: 1, label: "PP" },
      ]);
      expect(b.facets.status.map((f) => [f.value, f.count])).toEqual([["berlaku", 3], ["dicabut", 1]]);
      expect(b.facets.tahun.map((f) => f.value)).toEqual(["2023", "2021", "2020", "2003"]);
    });

    it("instansi yang tersimpan sebagai sisa data buruk dirapikan di telusur dan detail, tanpa mengubah isi tabel", async () => {
      await l.db.prepare(`UPDATE laws SET instansi = '[object Object]' WHERE frbr_uri = '/akn/id/act/uu/2003/13'`).run();
      await l.db.prepare(`UPDATE laws SET instansi = 'Indonesia, Pemerintah Pusat' WHERE frbr_uri = '/akn/id/act/uu/2020/11'`).run();
      const b = await ambil();
      const instansi = (uri: string) => (b.laws as Array<Hukum & { instansi: string | null }>).find((x) => x.frbr_uri === uri)?.instansi;
      expect(instansi("/akn/id/act/uu/2003/13")).toBeNull();
      expect(instansi("/akn/id/act/uu/2020/11")).toBe("Pemerintah Pusat");
      expect(instansi("/akn/id/act/pp/2021/35")).toBeNull(); // "Indonesia" saja tidak bermakna

      const detail = await json<{ law: { instansi: string | null } }>(await panggil(l, `/api/laws/detail?uri=${encodeURIComponent("/akn/id/act/uu/2020/11")}`));
      expect(detail.law.instansi).toBe("Pemerintah Pusat");
      const mentah = await l.db.prepare(`SELECT instansi FROM laws WHERE frbr_uri = '/akn/id/act/uu/2003/13'`).first<{ instansi: string }>();
      expect(mentah?.instansi).toBe("[object Object]");
    });

    it("urutan bawaan: tahun terbaru dulu", async () => {
      const b = await ambil();
      expect(b.laws.map((x) => x.tahun)).toEqual([2023, 2021, 2020, 2003]);
    });

    it("urut=tahun_asc dan urut=judul memakai daftar putih", async () => {
      expect((await ambil("?urut=tahun_asc")).laws.map((x) => x.tahun)).toEqual([2003, 2020, 2021, 2023]);
      const judul = (await ambil("?urut=judul")).laws.map((x) => x.judul);
      expect(judul[0]).toBe("Cipta Kerja");
      // Nilai urutan sembarang tidak pernah masuk ke SQL; jatuh ke urutan bawaan.
      const nakal = await ambil("?urut=judul;DROP TABLE laws");
      expect(nakal.laws.map((x) => x.tahun)).toEqual([2023, 2021, 2020, 2003]);
      expect((await ambil()).total).toBe(4);
    });

    it("halaman kedua berisi sisanya", async () => {
      const b = await ambil("?page=2&per_page=3");
      expect(b.laws).toHaveLength(1);
      expect(b.page).toBe(2);
    });

    it("per_page dibatasi 1..100 dan page minimal 1", async () => {
      expect((await ambil("?per_page=1000")).per_page).toBe(100);
      expect((await ambil("?per_page=-5")).per_page).toBe(1);
      expect((await ambil("?page=0")).page).toBe(1);
      expect((await ambil("?page=abc")).page).toBe(1);
    });

    it("menyaring menurut jenis (diulang atau dipisah koma), status, dan rentang tahun", async () => {
      expect((await ambil("?jenis=PP")).laws.map((x) => x.frbr_uri)).toEqual(["/akn/id/act/pp/2021/35"]);
      expect((await ambil("?jenis=UU&jenis=PP")).total).toBe(4);
      expect((await ambil("?jenis=UU,PP")).total).toBe(4);
      expect((await ambil("?status=dicabut")).laws.map((x) => x.frbr_uri)).toEqual(["/akn/id/act/uu/2020/11"]);
      expect((await ambil("?tahun_min=2020&tahun_max=2021")).total).toBe(2);
      expect((await ambil("?tahun_min=2021")).total).toBe(2);
    });

    it("filter bidang mencocokkan per bagian pada bidang gabungan", async () => {
      // UU 11/2020 bidangnya "EKONOMI - KETENAGAKERJAAN": harus ikut di kedua bidang.
      const naker = await ambil("?bidang=KETENAGAKERJAAN");
      expect(naker.laws.map((x) => x.frbr_uri).sort()).toEqual([
        "/akn/id/act/pp/2021/35", "/akn/id/act/uu/2003/13", "/akn/id/act/uu/2020/11",
      ]);
      const ekonomi = await ambil("?bidang=EKONOMI");
      expect(ekonomi.laws.map((x) => x.frbr_uri).sort()).toEqual(["/akn/id/act/uu/2020/11", "/akn/id/act/uu/2023/6"]);
    });

    it("filter bidang dengan nama panjang (pola LIKE D1 maksimal 50 byte) tetap bekerja, termasuk di tengah rangkaian", async () => {
      const panjang = "PEMBENTUKAN, PERUBAHAN, DAN PEMBUBARAN KOMISI / KOMITE / BADAN / DEWAN / STAF KHUSUS / TIM / PANITIA";
      await sisipkan(l, [
        { uri: "/akn/id/act/perpres/2020/1", jenis: "PERPRES", nomor: "1", tahun: 2020, judul: "Komisi Contoh", bidang: panjang },
        { uri: "/akn/id/act/perpres/2021/2", jenis: "PERPRES", nomor: "2", tahun: 2021, judul: "Lembaga Contoh", bidang: `ADMINISTRASI - ${panjang} - PEREKONOMIAN` },
        { uri: "/akn/id/act/perpres/2022/3", jenis: "PERPRES", nomor: "3", tahun: 2022, judul: "Lain", bidang: "PEREKONOMIAN" },
      ]);
      const res = await panggil(l, `/api/laws?bidang=${encodeURIComponent(panjang)}`);
      expect(res.status).toBe(200);
      const b = await json<Telusur>(res);
      expect(b.laws.map((x) => x.frbr_uri).sort()).toEqual(["/akn/id/act/perpres/2020/1", "/akn/id/act/perpres/2021/2"]);
      // Juga lewat pencarian kata kunci.
      const cari = await panggil(l, `/api/search?q=contoh&mode=keyword&bidang=${encodeURIComponent(panjang)}`);
      const hasil = await json<{ hits: Array<{ frbr_uri: string }> }>(cari);
      expect(new Set(hasil.hits.map((h) => h.frbr_uri))).toEqual(new Set(["/akn/id/act/perpres/2020/1", "/akn/id/act/perpres/2021/2"]));
    });

    it("karakter wildcard pada filter bidang adalah karakter biasa, bukan pola", async () => {
      const semua = await ambil("?bidang=%25");
      expect(semua.total).toBe(0);
      const garis = await ambil("?bidang=_");
      expect(garis.total).toBe(0);
    });

    it("daftar filter jenis yang sangat panjang tidak menjatuhkan permintaan", async () => {
      const banyak = Array.from({ length: 300 }, (_, i) => `JENIS${i}`).join(",");
      const res = await panggil(l, `/api/laws?jenis=UU,${banyak}`);
      expect(res.status).toBe(200);
    });

    it("nilai status yang tidak dikenal diabaikan, bukan menjadi filter kosong", async () => {
      expect((await ambil("?status=sembarang")).total).toBe(4);
    });

    it("facet mengikuti filter yang aktif", async () => {
      const b = await ambil("?status=dicabut&jenis=UU");
      expect(b.total).toBe(1);
      expect(b.facets.jenis).toEqual([{ value: "UU", count: 1, label: "UU" }]);
      expect(b.facets.tahun.map((f) => f.value)).toEqual(["2020"]);
    });

    it("dapat di-cache peramban 5 menit", async () => {
      const res = await panggil(l, "/api/laws");
      expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    });
  });

  describe("GET /api/laws/detail", () => {
    const detail = (uri: string) => panggil(l, `/api/laws/detail?uri=${encodeURIComponent(uri)}`);

    it("memuat peraturan, pasal terurut, relasi, dan tautan BPK", async () => {
      const res = await detail("/akn/id/act/uu/2003/13");
      expect(res.status).toBe(200);
      const b = await json<{
        law: Hukum & { bpk_id: string; jumlah_pasal: number };
        articles: Array<{ nomor_pasal: string; ayat: string | null; urutan: number }>;
        relations: unknown[];
        bpk_url: string | null;
      }>(res);
      expect(b.law).toMatchObject({ judul: "Ketenagakerjaan", jumlah_pasal: 2, bpk_id: "1001" });
      expect(b.articles.map((a) => [a.nomor_pasal, a.ayat])).toEqual([["82", "1"], ["156", "1"]]);
      expect(b.bpk_url).toBe("https://peraturan.bpk.go.id/Details/1001");
      expect(b.relations).toEqual([]);
      expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    });

    it("relasi menyertakan metadata peraturan tujuan (LEFT JOIN)", async () => {
      const b = await json<{ relations: Array<Record<string, unknown>> }>(await detail("/akn/id/act/uu/2020/11"));
      expect(b.relations).toEqual([
        {
          to_uri: "/akn/id/act/uu/2023/6", jenis_relasi: "dicabut_oleh", keterangan: "UU 6/2023",
          judul: expect.stringContaining("Cipta Kerja"), jenis: "UU", nomor: "6", tahun: 2023, status: "berlaku",
        },
      ]);
    });

    it("relasi ke peraturan yang belum ada di indeks tetap tampil, tanpa judul", async () => {
      await sisipkanRelasi(l, [{ dari: "/akn/id/act/uu/2003/13", ke: "/akn/id/act/pp/2099/1", jenis: "terkait" }]);
      const b = await json<{ relations: Array<Record<string, unknown>> }>(await detail("/akn/id/act/uu/2003/13"));
      expect(b.relations).toEqual([
        { to_uri: "/akn/id/act/pp/2099/1", jenis_relasi: "terkait", keterangan: null, judul: null, jenis: null, nomor: null, tahun: null, status: null },
      ]);
    });

    it("tautan BPK null bila bpk_id tidak diketahui", async () => {
      const b = await json<{ bpk_url: string | null }>(await detail("/akn/id/act/pp/2021/35"));
      expect(b.bpk_url).toBeNull();
    });

    it("404 untuk peraturan yang belum diindeks, 400 tanpa uri", async () => {
      const tidak = await detail("/akn/id/act/uu/1900/1");
      expect(tidak.status).toBe(404);
      expect(await tidak.json()).toMatchObject({ error: "tidak_ditemukan" });
      const kosong = await panggil(l, "/api/laws/detail");
      expect(kosong.status).toBe(400);
      expect(await kosong.json()).toMatchObject({ error: "uri_kosong" });
    });
  });

  describe("GET /api/suggest", () => {
    it("menyarankan peraturan menurut awalan judul", async () => {
      const b = await json<{ suggestions: Array<{ tipe: string; teks: string; uri: string | null }> }>(
        await panggil(l, "/api/suggest?q=ket"),
      );
      expect(b.suggestions).toEqual([
        { tipe: "peraturan", teks: "UU 13/2003 — Ketenagakerjaan", uri: "/akn/id/act/uu/2003/13" },
      ]);
    });

    it("kueri kurang dari dua karakter tidak menghasilkan saran", async () => {
      const b = await json<{ suggestions: unknown[] }>(await panggil(l, "/api/suggest?q=k"));
      expect(b.suggestions).toEqual([]);
    });

    // Bug v0.1 yang sudah diperbaiki: "%%" lolos pemeriksaan panjang, wildcard-nya dibuang, dan
    // sisanya menjadi pola "%" yang cocok dengan semua judul.
    it("kueri yang hanya berisi karakter wildcard tidak menghasilkan saran", async () => {
      for (const q of ["%25%25", "__", "%25_%25", "%25a"]) {
        const b = await json<{ suggestions: unknown[] }>(await panggil(l, `/api/suggest?q=${q}`));
        expect(b.suggestions, q).toEqual([]);
      }
    });

    it("wildcard di tengah kueri dibuang, bukan dijadikan pola", async () => {
      const b = await json<{ suggestions: Array<{ teks: string }> }>(await panggil(l, "/api/suggest?q=k%25et"));
      expect(b.suggestions.map((s) => s.teks)).toEqual(["UU 13/2003 — Ketenagakerjaan"]);
    });

    it("kueri yang lebih panjang dari pola LIKE yang diizinkan D1 dijawab kosong, bukan 500", async () => {
      const res = await panggil(l, `/api/suggest?q=${encodeURIComponent("ketenagakerjaan dan pemutusan hubungan kerja pekerja kontrak")}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ suggestions: [] });
    });

    it("kueri populer dari log pencarian ikut disarankan, hanya yang pernah ada hasilnya", async () => {
      await panggil(l, "/api/search?q=pesangon&mode=keyword");
      await panggil(l, "/api/search?q=pesawat+antariksa&mode=keyword"); // nihil
      const b = await json<{ suggestions: Array<{ tipe: string; teks: string }> }>(
        await panggil(l, "/api/suggest?q=pe"),
      );
      const kueri = b.suggestions.filter((s) => s.tipe === "kueri").map((s) => s.teks);
      expect(kueri).toEqual(["pesangon"]);
    });
  });

  describe("GET /api/bidang", () => {
    it("memecah bidang gabungan dan menghitung per bagian", async () => {
      const b = await json<{ bidang: Array<{ nama: string; jumlah: number; berlaku: number; tahun_terbaru: number }> }>(
        await panggil(l, "/api/bidang"),
      );
      expect(b.bidang).toEqual([
        { nama: "KETENAGAKERJAAN", jumlah: 3, berlaku: 2, tahun_terbaru: 2021 },
        { nama: "EKONOMI", jumlah: 2, berlaku: 1, tahun_terbaru: 2023 },
      ]);
    });
  });

  describe("GET /api/relasi/graf", () => {
    const graf = (qs: string) => panggil(l, `/api/relasi/graf?${qs}`);
    const uriCk = encodeURIComponent("/akn/id/act/uu/2020/11");

    it("memetakan simpul dan sisi dua arah dengan label sitasi", async () => {
      const b = await json<{
        pusat: string;
        simpul: Array<{ uri: string; label: string; jarak: number; ada_di_indeks: boolean; status: string | null }>;
        sisi: Array<{ dari: string; ke: string; jenis: string }>;
      }>(await graf(`uri=${uriCk}`));
      expect(b.pusat).toBe("/akn/id/act/uu/2020/11");
      expect(b.simpul).toEqual([
        { uri: "/akn/id/act/uu/2020/11", label: "UU 11/2020", jenis: "UU", tahun: 2020, status: "dicabut", ada_di_indeks: true, jarak: 0 },
        { uri: "/akn/id/act/uu/2023/6", label: "UU 6/2023", jenis: "UU", tahun: 2023, status: "berlaku", ada_di_indeks: true, jarak: 1 },
      ]);
      expect(b.sisi).toHaveLength(2);
    });

    it("simpul yang ditemukan lewat relasi masuk tetap berlabel sitasi (regresi label tertukar)", async () => {
      // PP 35/2021 hanya menjadi tujuan relasi dari UU 11/2020: ditemukan lewat sisi masuk.
      await sisipkanRelasi(l, [{ dari: "/akn/id/act/pp/2021/35", ke: "/akn/id/act/uu/2020/11", jenis: "melaksanakan" }]);
      const b = await json<{ simpul: Array<{ uri: string; label: string }> }>(await graf(`uri=${uriCk}`));
      expect(b.simpul.find((s) => s.uri === "/akn/id/act/pp/2021/35")?.label).toBe("PP 35/2021");
    });

    it("peraturan di luar indeks tetap menjadi simpul dengan label dari URI", async () => {
      await sisipkanRelasi(l, [{ dari: "/akn/id/act/uu/2003/13", ke: "/akn/id/act/pp/2099/1", jenis: "terkait" }]);
      const b = await json<{ simpul: Array<{ uri: string; label: string; ada_di_indeks: boolean; jenis: string | null }> }>(
        await graf(`uri=${encodeURIComponent("/akn/id/act/uu/2003/13")}`),
      );
      expect(b.simpul.find((s) => s.uri === "/akn/id/act/pp/2099/1")).toMatchObject({
        label: "pp/2099/1", ada_di_indeks: false, jenis: null,
      });
    });

    it("kedalaman 2 menjangkau tetangga dari tetangga; nilai di luar 1..2 dijepit", async () => {
      await sisipkanRelasi(l, [{ dari: "/akn/id/act/uu/2023/6", ke: "/akn/id/act/pp/2021/35", jenis: "melaksanakan" }]);
      const satu = await json<{ simpul: unknown[] }>(await graf(`uri=${uriCk}&kedalaman=1`));
      const dua = await json<{ simpul: Array<{ jarak: number }> }>(await graf(`uri=${uriCk}&kedalaman=2`));
      const tinggi = await json<{ simpul: unknown[] }>(await graf(`uri=${uriCk}&kedalaman=9`));
      expect(satu.simpul).toHaveLength(2);
      expect(dua.simpul).toHaveLength(3);
      expect(Math.max(...dua.simpul.map((s) => s.jarak))).toBe(2);
      expect(tinggi.simpul).toHaveLength(3);
    });

    it("peraturan dengan ratusan relasi tetap terbaca (D1 membatasi 100 parameter per kueri)", async () => {
      // UU yang banyak dirujuk, mis. UU Ketenagakerjaan: 250 peraturan melaksanakannya.
      await sisipkan(l, Array.from({ length: 250 }, (_, i) => ({
        uri: `/akn/id/act/pp/2000/${i + 1}`, jenis: "PP", nomor: String(i + 1), tahun: 2000, judul: `Pelaksana ${i + 1}`,
      })));
      await sisipkanRelasi(l, Array.from({ length: 250 }, (_, i) => ({
        dari: `/akn/id/act/pp/2000/${i + 1}`, ke: "/akn/id/act/uu/2003/13", jenis: "melaksanakan",
      })));
      for (const kedalaman of [1, 2]) {
        const res = await graf(`uri=${encodeURIComponent("/akn/id/act/uu/2003/13")}&kedalaman=${kedalaman}`);
        expect(res.status, `kedalaman ${kedalaman}`).toBe(200);
        const b = await json<{ simpul: Array<{ uri: string }>; sisi: Array<{ dari: string; ke: string }> }>(res);
        // Dibatasi 200 simpul agar respons dan jumlah kueri tetap wajar; pusat selalu ada.
        expect(b.simpul, `kedalaman ${kedalaman}`).toHaveLength(200);
        expect(b.simpul.some((n) => n.uri === "/akn/id/act/uu/2003/13")).toBe(true);
        // Setiap sisi yang dikembalikan menghubungkan dua simpul yang juga dikembalikan.
        const uri = new Set(b.simpul.map((n) => n.uri));
        expect(b.sisi.length).toBeGreaterThan(100);
        expect(b.sisi.every((e) => uri.has(e.dari) && uri.has(e.ke))).toBe(true);
      }
    });

    it("peraturan tanpa relasi hanya memuat dirinya sendiri; tanpa uri -> 400", async () => {
      const b = await json<{ simpul: unknown[]; sisi: unknown[] }>(
        await graf(`uri=${encodeURIComponent("/akn/id/act/pp/2021/35")}`),
      );
      expect(b.simpul).toHaveLength(1);
      expect(b.sisi).toEqual([]);
      expect((await graf("")).status).toBe(400);
    });
  });

  describe("ejaan URI PERPPU ('perpu' vs 'perppu')", () => {
    // Di produksi pasal.id menyimpan peraturannya sebagai .../perpu/2022/2 tetapi relasi ke sana
    // sebagai .../perppu/2022/2 (117 dari 124 relasi ke PERPPU menggantung karenanya).
    const PERPPU = "/akn/id/act/perpu/2022/2";
    const ALIAS = "/akn/id/act/perppu/2022/2";
    const UU13 = "/akn/id/act/uu/2003/13";

    beforeEach(async () => {
      await sisipkan(l, [{ uri: PERPPU, jenis: "PERPPU", nomor: "2", tahun: 2022, judul: "Cipta Kerja (Perppu)" }]);
      await sisipkanRelasi(l, [{ dari: UU13, ke: ALIAS, jenis: "diubah_oleh", keterangan: "PERPU No. 2 Tahun 2022" }]);
    });

    const detail = (uri: string) => panggil(l, `/api/laws/detail?uri=${encodeURIComponent(uri)}`);
    const graf = (uri: string, ekstra = "") => panggil(l, `/api/relasi/graf?uri=${encodeURIComponent(uri)}${ekstra}`);

    it("detail: relasi ke ejaan lain diselesaikan ke peraturan di indeks, lengkap dengan metadata", async () => {
      const b = await json<{ relations: Array<Record<string, unknown>> }>(await detail(UU13));
      expect(b.relations).toEqual([
        {
          to_uri: PERPPU, jenis_relasi: "diubah_oleh", keterangan: "PERPU No. 2 Tahun 2022",
          judul: "Cipta Kerja (Perppu)", jenis: "PERPPU", nomor: "2", tahun: 2022, status: "berlaku",
        },
      ]);
    });

    it("detail: urutan relasi tetap menurut jenis lalu tahun terbaru, juga setelah diperbaiki", async () => {
      await sisipkanRelasi(l, [
        { dari: UU13, ke: "/akn/id/act/uu/2020/11", jenis: "diubah_oleh" },
        { dari: UU13, ke: "/akn/id/act/pp/2099/1", jenis: "diubah_oleh" }, // belum di indeks: tanpa tahun, terakhir
        { dari: UU13, ke: "/akn/id/act/uu/2023/6", jenis: "mencabut" },
      ]);
      const b = await json<{ relations: Array<{ to_uri: string; jenis_relasi: string }> }>(await detail(UU13));
      expect(b.relations.map((r) => [r.jenis_relasi, r.to_uri])).toEqual([
        ["diubah_oleh", PERPPU], // 2022
        ["diubah_oleh", "/akn/id/act/uu/2020/11"], // 2020
        ["diubah_oleh", "/akn/id/act/pp/2099/1"], // tanpa tahun
        ["mencabut", "/akn/id/act/uu/2023/6"],
      ]);
    });

    it("detail: peraturan yang diminta dengan ejaan lain tetap ditemukan, dan URI di jawaban adalah yang di indeks", async () => {
      const res = await detail(ALIAS);
      expect(res.status).toBe(200);
      expect((await json<{ law: { frbr_uri: string } }>(res)).law.frbr_uri).toBe(PERPPU);
    });

    it("kebalikannya: peraturan tersimpan sebagai 'perppu', relasi menunjuk 'perpu'", async () => {
      await sisipkan(l, [{ uri: "/akn/id/act/perppu/2020/1", jenis: "PERPPU", nomor: "1", tahun: 2020, judul: "Kebijakan Keuangan" }]);
      await sisipkanRelasi(l, [{ dari: UU13, ke: "/akn/id/act/perpu/2020/1", jenis: "diubah_oleh" }]);
      const b = await json<{ relations: Array<{ to_uri: string; judul: string | null }> }>(await detail(UU13));
      expect(b.relations.find((r) => r.to_uri === "/akn/id/act/perppu/2020/1")?.judul).toBe("Kebijakan Keuangan");
      expect((await detail("/akn/id/act/perpu/2020/1")).status).toBe(200);
    });

    it("tidak mengarang: bila kedua ejaan tidak ada di indeks, relasi tetap menggantung dan 404 tetap 404", async () => {
      await sisipkanRelasi(l, [{ dari: UU13, ke: "/akn/id/act/perppu/1999/9", jenis: "diubah_oleh" }]);
      const b = await json<{ relations: Array<{ to_uri: string; judul: string | null }> }>(await detail(UU13));
      expect(b.relations.find((r) => r.to_uri === "/akn/id/act/perppu/1999/9")).toMatchObject({ judul: null });
      expect((await detail("/akn/id/act/perppu/1999/9")).status).toBe(404);
    });

    it("graf dari UU: simpul PERPPU memakai URI di indeks, berlabel sitasi, dan ada_di_indeks", async () => {
      const b = await json<{ simpul: Array<{ uri: string; label: string; ada_di_indeks: boolean }>; sisi: Array<{ dari: string; ke: string }> }>(
        await graf(UU13),
      );
      expect(b.simpul.find((x) => x.uri === PERPPU)).toMatchObject({ label: "PERPPU 2/2022", ada_di_indeks: true });
      expect(b.simpul.some((x) => x.uri === ALIAS)).toBe(false);
      expect(b.sisi).toEqual([{ dari: UU13, ke: PERPPU, jenis: "diubah_oleh" }]);
    });

    it("graf dari PERPPU: relasi masuk yang tersimpan dengan ejaan lain ikut ditemukan", async () => {
      for (const pusat of [PERPPU, ALIAS]) {
        const b = await json<{ pusat: string; simpul: Array<{ uri: string }>; sisi: Array<{ dari: string; ke: string }> }>(await graf(pusat));
        expect(b.pusat, pusat).toBe(PERPPU);
        expect(b.simpul.map((x) => x.uri).sort(), pusat).toEqual([PERPPU, UU13].sort());
        expect(b.sisi, pusat).toEqual([{ dari: UU13, ke: PERPPU, jenis: "diubah_oleh" }]);
      }
    });

    it("graf: relasi dua ejaan ke peraturan yang sama tidak menggandakan simpul maupun sisi", async () => {
      await sisipkanRelasi(l, [{ dari: UU13, ke: PERPPU, jenis: "diubah_oleh", keterangan: "ejaan yang benar" }]);
      const b = await json<{ simpul: Array<{ uri: string }>; sisi: unknown[] }>(await graf(UU13));
      expect(b.simpul.filter((x) => x.uri === PERPPU)).toHaveLength(1);
      expect(b.sisi).toHaveLength(1);
    });
  });

  describe("robots.txt dan sitemap.xml", () => {
    it("robots.txt melarang /api/admin/ dan menunjuk sitemap pada origin yang sama", async () => {
      const t = await (await panggil(l, "/robots.txt")).text();
      expect(t).toContain("Disallow: /api/admin/");
      expect(t).toContain("Sitemap: https://lexa.test/sitemap.xml");
    });

    it("sitemap memuat satu URL /peraturan?uri= per peraturan, tahun terbaru dulu", async () => {
      const res = await panggil(l, "/sitemap.xml");
      expect(res.headers.get("content-type")).toContain("application/xml");
      const xml = await res.text();
      const loc = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      expect(loc).toHaveLength(4);
      expect(loc[0]).toBe(`https://lexa.test/peraturan?uri=${encodeURIComponent("/akn/id/act/uu/2023/6")}`);
      expect(loc.at(-1)).toBe(`https://lexa.test/peraturan?uri=${encodeURIComponent("/akn/id/act/uu/2003/13")}`);
      expect(xml).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
    });
  });

  describe("lintas-rute", () => {
    it("semua respons memuat header keamanan dasar", async () => {
      for (const path of ["/api/stats", "/robots.txt", "/api/tidak-ada"]) {
        const res = await panggil(l, path);
        expect(res.headers.get("x-content-type-options"), path).toBe("nosniff");
        expect(res.headers.get("x-frame-options"), path).toBe("DENY");
        expect(res.headers.get("referrer-policy"), path).toBe("strict-origin-when-cross-origin");
      }
    });

    it("rute /api yang tidak dikenal dijawab 404 JSON", async () => {
      const res = await panggil(l, "/api/tidak-ada");
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "rute_tidak_ada", message: "Endpoint tidak dikenal." });
    });

    it("rute dengan garis miring penutup tidak sama dengan tanpa garis miring", async () => {
      // Hono dipakai dengan mode ketat; klien harus memanggil /api/tanya dan /api/koleksi persis.
      const post = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pertanyaan: "x" }) };
      expect((await panggil(l, "/api/tanya/", post)).status).toBe(404);
      expect((await panggil(l, "/api/koleksi/")).status).toBe(404);
      expect((await panggil(l, "/api/koleksi")).status).toBe(200);
    });
  });
});
