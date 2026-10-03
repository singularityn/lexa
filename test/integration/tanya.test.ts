/**
 * POST /api/tanya: jawaban hanya boleh bersandar pada pasal yang ditemukan di
 * indeks, sitasi dikembalikan terpisah, dan pemanggilan model dibatasi.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buatLingkungan, indeksSemua, json, kirim, KORPUS, masukSebagai, panggil, sisipkan, sqliteAda,
  type Lingkungan,
} from "./harness";

const PERTANYAAN = "Berapa lama cuti melahirkan bagi pekerja perempuan?";
const JAWABAN = "Menurut UU 13/2003 Pasal 82 ayat (1), pekerja perempuan berhak atas istirahat 1,5 bulan sebelum dan sesudah melahirkan.";

interface Balasan {
  jawaban?: string;
  sitasi: Array<{ frbr_uri: string; sitasi: string; nomor_pasal: string | null; ayat: string | null; status: string }>;
  cukup_dasar: boolean;
  percakapan_id?: string | null;
  error?: string;
  message?: string;
}

describe.skipIf(!sqliteAda)("POST /api/tanya", () => {
  let l: Lingkungan;
  beforeEach(async () => {
    l = buatLingkungan();
    await sisipkan(l, KORPUS);
    await indeksSemua(l);
    l.ai.jawaban = JAWABAN;
  });
  afterEach(() => l.tutup());

  const tanya = (pertanyaan: unknown, header: Record<string, string> = {}, ekstra: object = {}) =>
    panggil(l, "/api/tanya", kirim("POST", { pertanyaan, ...ekstra }, header));

  describe("jawaban yang berdasar", () => {
    it("mengembalikan jawaban model beserta sitasi pasal yang menjadi dasarnya", async () => {
      const res = await tanya(PERTANYAAN);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const b = await json<Balasan>(res);
      expect(b).toMatchObject({ jawaban: JAWABAN, cukup_dasar: true, percakapan_id: null });
      expect(b.sitasi.length).toBeGreaterThan(0);
      expect(b.sitasi).toContainEqual({
        frbr_uri: "/akn/id/act/uu/2003/13", sitasi: "UU 13/2003", judul: "Ketenagakerjaan",
        nomor_pasal: "82", ayat: "1", status: "berlaku",
      });
    });

    it("prompt memuat aturan mutlak dan teks pasal yang ditemukan, bukan hanya cuplikan", async () => {
      await tanya(PERTANYAAN);
      expect(l.ai.panggilanObrolan).toHaveLength(1);
      const { model, masukan } = l.ai.panggilanObrolan[0];
      const pesan = (masukan as { messages: Array<{ role: string; content: string }> }).messages;
      expect(model).toBe("@cf/uji/teks");
      expect(pesan.map((m) => m.role)).toEqual(["system", "user"]);
      expect(pesan[0].content).toContain("ATURAN MUTLAK");
      expect(pesan[0].content).toContain("JANGAN menebak");
      expect(pesan[0].content).toContain("bukan penasihat hukum");
      expect(pesan[1].content).toContain(`Pertanyaan: ${PERTANYAAN}`);
      expect(pesan[1].content).toContain("### UU 13/2003 Pasal 82 ayat (1)");
      expect(pesan[1].content).toContain("1,5 bulan sebelum saatnya melahirkan anak dan 1,5 bulan sesudah melahirkan");
    });

    it("pasal dari peraturan yang dicabut ditandai agar model memperingatkan pembaca", async () => {
      await tanya("Apa pengertian cipta kerja?");
      const konteks = (l.ai.panggilanObrolan[0].masukan as { messages: Array<{ content: string }> }).messages[1].content;
      expect(konteks).toContain("### UU 11/2020 Pasal 1 [PERHATIAN: peraturan ini berstatus dicabut]");
    });

    it("sitasi memuat status peraturan agar antarmuka dapat menandainya", async () => {
      const b = await json<Balasan>(await tanya("Apa pengertian cipta kerja?"));
      expect(b.sitasi.find((s) => s.frbr_uri === "/akn/id/act/uu/2020/11")?.status).toBe("dicabut");
    });

    it("tamu tidak meninggalkan jejak percakapan di server", async () => {
      await tanya(PERTANYAAN);
      expect((await l.db.prepare(`SELECT COUNT(*) AS n FROM percakapan`).first<{ n: number }>())?.n).toBe(0);
      expect((await l.db.prepare(`SELECT COUNT(*) AS n FROM pesan`).first<{ n: number }>())?.n).toBe(0);
    });
  });

  describe("pengguna yang masuk", () => {
    it("pertanyaan pertama membuat percakapan; lanjutan menambah pesan ke percakapan yang sama", async () => {
      const { cookie } = await masukSebagai(l);
      const pertama = await json<Balasan>(await tanya(PERTANYAAN, { cookie }));
      expect(pertama.percakapan_id).toMatch(/^[0-9a-f-]{36}$/);

      const kedua = await json<Balasan>(
        await tanya("Bagaimana dengan pesangon?", { cookie }, { percakapan_id: pertama.percakapan_id }),
      );
      expect(kedua.percakapan_id).toBe(pertama.percakapan_id);

      const percakapan = await l.db.prepare(`SELECT id, pengguna_id, judul FROM percakapan`).all();
      expect(percakapan.results).toEqual([{ id: pertama.percakapan_id, pengguna_id: "u1", judul: PERTANYAAN }]);

      const pesan = await l.db.prepare(`SELECT peran, isi, sitasi FROM pesan ORDER BY id`).all<{ peran: string; isi: string; sitasi: string | null }>();
      expect(pesan.results.map((p) => p.peran)).toEqual(["pengguna", "asisten", "pengguna", "asisten"]);
      expect(pesan.results[0]).toMatchObject({ isi: PERTANYAAN, sitasi: null });
      expect(JSON.parse(pesan.results[1].sitasi!)).toEqual(pertama.sitasi);
    });

    it("judul percakapan dipotong 120 karakter", async () => {
      const { cookie } = await masukSebagai(l);
      await tanya(`pemutusan hubungan kerja ${"x".repeat(200)}`.slice(0, 400), { cookie });
      const r = await l.db.prepare(`SELECT judul FROM percakapan`).first<{ judul: string }>();
      expect(r?.judul.length).toBe(120);
    });

    it("sesi kedaluwarsa diperlakukan sebagai tamu", async () => {
      const b = await json<Balasan>(await tanya(PERTANYAAN, { cookie: "lexa_sesi=tidak-ada" }));
      expect(b.percakapan_id).toBeNull();
    });
  });

  describe("menolak menjawab bila dasarnya tidak ada", () => {
    it("indeks kosong: model tidak dipanggil sama sekali", async () => {
      const kosong = buatLingkungan();
      kosong.ai.jawaban = JAWABAN;
      const res = await panggil(kosong, "/api/tanya", kirim("POST", { pertanyaan: PERTANYAAN }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ sitasi: [], cukup_dasar: false, jawaban: expect.stringContaining("belum menemukan pasal") });
      expect(kosong.ai.panggilanObrolan).toHaveLength(0);
      kosong.tutup();
    });

    it("hanya ada judul peraturan tanpa pasal: tidak cukup dasar, model tidak dipanggil", async () => {
      const tanpaPasal = buatLingkungan();
      await sisipkan(tanpaPasal, KORPUS.map((p) => ({ ...p, pasal: [] })));
      await indeksSemua(tanpaPasal);
      const b = await json<Balasan>(await panggil(tanpaPasal, "/api/tanya", kirim("POST", { pertanyaan: "ketenagakerjaan" })));
      expect(b.cukup_dasar).toBe(false);
      expect(tanpaPasal.ai.panggilanObrolan).toHaveLength(0);
      tanpaPasal.tutup();
    });

    it("pencarian makna gagal dan kata kunci tidak cocok: menolak menjawab, tidak 500", async () => {
      l.ai.galat = new Error("Workers AI mati");
      const res = await tanya(PERTANYAAN);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ cukup_dasar: false, sitasi: [] });
    });
  });

  describe("ambang relevansi", () => {
    it("hanya pasal berperingkat atas yang menjadi dasar; yang skornya di bawah ambang disaring", async () => {
      const lx = buatLingkungan();
      lx.ai.jawaban = JAWABAN;
      await sisipkan(lx, [
        ...[1, 2, 3].map((i) => ({ uri: `/akn/id/act/uu/2001/${i}`, jenis: "UU", nomor: String(i), tahun: 2001, judul: `Peraturan kosong ${i}` })),
        {
          uri: "/akn/id/act/uu/2002/9", jenis: "UU", nomor: "9", tahun: 2002, judul: "Uji Ambang",
          pasal: Array.from({ length: 9 }, (_, i) => ({ nomor: String(i + 1), isi: `Isi pasal nomor ${i + 1}.` })),
        },
      ]);
      // Vectorize palsu dengan urutan tetap: tiga hit tingkat peraturan lebih dulu (tidak bisa
      // jadi dasar jawaban), lalu sembilan pasal. Skor vektor 0,8/(60+peringkat): pasal ke-1..3
      // ada di atas 0,012, pasal ke-4 dan seterusnya di bawahnya.
      lx.vektor.query = async () => {
        const ids = [
          ...[1, 2, 3].map((i) => `/akn/id/act/uu/2001/${i}`),
          ...Array.from({ length: 9 }, (_, i) => `/akn/id/act/uu/2002/9#pasal-${i + 1}`),
        ];
        const matches = ids.map((id) => ({ id, score: 0.9, metadata: { frbr_uri: id.split("#")[0] } }));
        return { matches, count: matches.length };
      };

      const res = await panggil(lx, "/api/tanya", kirim("POST", { pertanyaan: "zzz qqq xxx" }));
      const b = await json<Balasan>(res);
      expect(b.sitasi.map((s) => s.nomor_pasal)).toEqual(["1", "2", "3"]);
      const konteks = (lx.ai.panggilanObrolan[0].masukan as { messages: Array<{ content: string }> }).messages[1].content;
      expect(konteks).toContain("Pasal 3");
      expect(konteks).not.toContain("Pasal 4");
      lx.tutup();
    });
  });

  describe("kegagalan model", () => {
    it("galat model -> 503 model_gagal, sitasi tetap dikembalikan, dan dicatat di sync_log", async () => {
      l.ai.galatObrolan = new Error("model usang melewati tanggal deprecation");
      const res = await tanya(PERTANYAAN);
      expect(res.status).toBe(503);
      const b = await json<Balasan>(res);
      expect(b).toMatchObject({ error: "model_gagal", cukup_dasar: true });
      expect(b.sitasi.length).toBeGreaterThan(0);
      expect(b.jawaban).toBeUndefined();
      const log = await l.db.prepare(`SELECT job, status, detail FROM sync_log`).all<{ job: string; status: string; detail: string }>();
      expect(log.results).toHaveLength(1);
      expect(log.results[0]).toMatchObject({ job: "asisten", status: "gagal" });
      expect(log.results[0].detail).toContain("@cf/uji/teks");
      expect(log.results[0].detail).toContain("deprecation");
    });

    it("jawaban kosong dari model -> 503 jawaban_kosong dengan sitasi", async () => {
      l.ai.jawaban = "   ";
      const res = await tanya(PERTANYAAN);
      expect(res.status).toBe(503);
      const b = await json<Balasan>(res);
      expect(b).toMatchObject({ error: "jawaban_kosong", cukup_dasar: true });
      expect(b.sitasi.length).toBeGreaterThan(0);
    });

    it("jawaban yang gagal tidak disimpan sebagai riwayat", async () => {
      const { cookie } = await masukSebagai(l);
      l.ai.galatObrolan = new Error("mati");
      await tanya(PERTANYAAN, { cookie });
      expect((await l.db.prepare(`SELECT COUNT(*) AS n FROM pesan`).first<{ n: number }>())?.n).toBe(0);
    });
  });

  describe("validasi", () => {
    it("pertanyaan kosong, spasi, atau bukan JSON -> 400 kosong", async () => {
      for (const p of ["", "   ", undefined]) {
        const res = await tanya(p);
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: "kosong" });
      }
      const rusak = await panggil(l, "/api/tanya", { method: "POST", body: "bukan json" });
      expect(rusak.status).toBe(400);
    });

    it("lebih dari 500 karakter -> 400 terlalu_panjang; tepat 500 diterima", async () => {
      const panjang = await tanya("a".repeat(501));
      expect(panjang.status).toBe(400);
      expect(await panjang.json()).toMatchObject({ error: "terlalu_panjang" });
      expect((await tanya("pemutusan hubungan kerja ".repeat(20).slice(0, 500))).status).toBe(200);
    });

    it("pertanyaan yang ditolak tidak menghabiskan jatah laju", async () => {
      for (let i = 0; i < 30; i++) await tanya("", { "cf-connecting-ip": "5.5.5.5" });
      expect((await tanya(PERTANYAAN, { "cf-connecting-ip": "5.5.5.5" })).status).toBe(200);
    });
  });

  describe("pembatas laju", () => {
    const dariIp = (ip: string) => tanya(PERTANYAAN, { "cf-connecting-ip": ip });

    it("20 pertanyaan per alamat per jendela; ke-21 ditolak 429 tanpa memanggil model", async () => {
      for (let i = 1; i <= 20; i++) expect((await dariIp("1.2.3.4")).status, `ke-${i}`).toBe(200);
      const ditolak = await dariIp("1.2.3.4");
      expect(ditolak.status).toBe(429);
      expect(await ditolak.json()).toMatchObject({ error: "terlalu_sering" });
      expect(l.ai.panggilanObrolan).toHaveLength(20);
    });

    it("alamat lain tidak terpengaruh", async () => {
      for (let i = 0; i < 20; i++) await dariIp("1.2.3.4");
      expect((await dariIp("1.2.3.4")).status).toBe(429);
      expect((await dariIp("4.3.2.1")).status).toBe(200);
    });

    it("jatah dipulihkan setelah jendela 5 menit berakhir", async () => {
      for (let i = 0; i < 20; i++) await dariIp("1.2.3.4");
      expect((await dariIp("1.2.3.4")).status).toBe(429);
      const entri = l.kv.isi.get("tanya:1.2.3.4")!;
      entri.kedaluwarsa = Date.now() - 1; // jendela berlalu
      expect((await dariIp("1.2.3.4")).status).toBe(200);
    });
  });
});
