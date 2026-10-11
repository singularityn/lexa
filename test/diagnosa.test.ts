import { describe, expect, it } from "vitest";
import { bentukSingkat, ringkasDaftar, ringkasDetail } from "../src/worker/lib/diagnosa";
import { bacaRetryAfter } from "../src/worker/lib/pasal";

let nomorSimpul = 100;
const simpul = (tipe: string, nomor: string | null, isi: string, induk: number | null, urut: number, id = ++nomorSimpul) => ({
  id, type: tipe, number: nomor, heading: null, content: isi, parent_id: induk, sort_order: urut,
});

describe("bentukSingkat", () => {
  it("mempertahankan skalar pendek dan mengganti teks panjang dengan panjangnya", () => {
    const teksPanjang = "x".repeat(200);
    expect(bentukSingkat({ a: 1, b: "pendek", c: teksPanjang, d: null, e: true })).toEqual({
      a: 1, b: "pendek", c: "<teks 200 huruf>", d: null, e: true,
    });
  });

  it("meringkas larik panjang dan objek yang dalam, tanpa pernah membawa teks peraturan", () => {
    const hasil = bentukSingkat({ daftar: [1, 2, 3, 4, 5], dalam: { a: { b: { c: { d: 1 } } } } }) as Record<string, unknown>;
    expect(hasil.daftar).toEqual([1, 2, 3, "…2 lagi"]);
    expect(JSON.stringify(hasil.dalam)).toContain("<objek 1 kunci>");
  });
});

describe("ringkasDetail", () => {
  /** Pola yang ditemukan di produksi: pasal berayat tanpa isi, pasal tunggal berisi. */
  const pohon = [
    simpul("bab", "I", "", null, 1, 1),
    simpul("pasal", "1", "Ketentuan umum.", 1, 2, 2),
    simpul("pasal", "2", "", 1, 3, 3),
    simpul("ayat", "1", "", 3, 4, 4),
    simpul("ayat", "2", "", 3, 5, 5),
    simpul("pasal", "3", "", 1, 6, 6),
    simpul("ayat", "1", "Isi ayat tiga.", 6, 7, 7),
    simpul("ayat", "2", "Isi ayat dua.", 999, 8, 8), // yatim: induknya tidak ada di respons
  ];
  const ringkas = ringkasDetail({ work: { id: 1, title: "UU contoh" }, articles: pohon, detail_access: "partial", relationships: [] });

  it("menghitung simpul menurut tipe dan menurut ada tidaknya isi", () => {
    expect(ringkas.jumlah_simpul).toBe(8);
    expect(ringkas.tipe).toEqual({ ayat: 4, pasal: 3, bab: 1 });
    expect(ringkas.tipe_berisi).toEqual({ ayat: 2, pasal: 1 });
  });

  it("melaporkan simpul yatim, yang dulu lenyap tanpa jejak karena penelusuran hanya dari akar", () => {
    expect(ringkas.yatim).toBe(1);
    expect(ringkas.akar).toBe(1);
  });

  it("memisahkan pasal tanpa teks sama sekali dari pasal yang isinya ada di ayat", () => {
    expect(ringkas.pasal).toMatchObject({
      total: 3,
      berisi_sendiri: 1,
      berisi_dengan_keturunan: 2,
      tanpa_teks_sama_sekali: 1,
      kosong_punya_ayat: 1,
      contoh_tanpa_teks: ["2"],
      contoh_berisi: ["1", "3"],
    });
    expect(ringkas.ayat).toMatchObject({ total: 4, berisi: 2 });
  });

  it("mencatat detail_access dan nama field simpul, untuk menemukan field isi yang tak dikenal", () => {
    expect(ringkas.detail_access).toBe("partial");
    expect(Object.keys(ringkas.kunci_simpul as object)).toEqual(
      expect.arrayContaining(["id", "type", "number", "content", "parent_id", "sort_order"]),
    );
  });

  it("contoh bentuk simpul tidak memuat teks panjang", () => {
    const panjang = "teks hukum yang panjang ".repeat(20);
    const r = ringkasDetail({ articles: [simpul("pasal", "1", panjang, null, 1, 1)] });
    const contoh = JSON.stringify(r.contoh_pasal_berisi);
    expect(contoh).not.toContain("teks hukum");
    expect(contoh).toContain("<teks");
  });

  it("nomor pasal berhuruf dibaca angkanya (12A menjadi 12), dan respons kosong atau aneh tidak melempar galat", () => {
    expect((ringkasDetail({ articles: [simpul("pasal", "12A", "x", null, 1, 1)] }).pasal as { nomor_maks: number }).nomor_maks).toBe(12);
    expect(() => ringkasDetail(null)).not.toThrow();
    expect(() => ringkasDetail("bukan objek")).not.toThrow();
    expect(ringkasDetail({}).jumlah_simpul).toBe(0);
  });

  it("articles yang dibungkus objek (mis. paginasi) tetap terbaca dan pembungkusnya dilaporkan", () => {
    const r = ringkasDetail({ articles: { items: [simpul("pasal", "1", "x", null, 1, 1)], has_more: true, next: "abc" } });
    expect(r.articles_pembungkus).toBe("objek.items");
    expect(r.articles_skalar).toEqual({ has_more: true, next: "abc" });
    expect(r.jumlah_simpul).toBe(1);
  });
});

describe("ringkasDaftar", () => {
  it("melaporkan total, sebaran jenis dan verifikasi, serta contoh satu item", () => {
    const r = ringkasDaftar({
      total: 5000, limit: 100, offset: 0,
      laws: [
        { id: 1, frbr_uri: "/akn/id/act/pp/2020/1", title: "A", type: "PP", year: 2020, status: "berlaku", content_verified: true },
        { id: 2, frbr_uri: "/akn/id/act/pp/1950/2", title: "B", type: "PP", year: 1950, status: "berlaku", content_verified: false },
        { id: 3, frbr_uri: "/akn/id/act/uu/1999/3", title: "C", type: "UU", year: 1999, status: "dicabut" },
      ],
    });
    expect(r.skalar_atas).toEqual({ total: 5000, limit: 100, offset: 0 });
    expect(r.jenis).toEqual({ PP: 2, UU: 1 });
    expect(r.terverifikasi).toEqual({ true: 1, false: 1, "(tidak ada)": 1 });
    expect(r.tahun).toEqual({ minimum: 1950, maksimum: 2020 });
    expect(r.jumlah).toBe(3);
  });
});

describe("bacaRetryAfter", () => {
  it("membaca detik, tanggal HTTP, dan nilai yang tak terbaca", () => {
    expect(bacaRetryAfter("120")).toBe(120_000);
    expect(bacaRetryAfter("0")).toBe(0);
    expect(bacaRetryAfter(null)).toBe(60_000);
    expect(bacaRetryAfter("")).toBe(60_000);
    expect(bacaRetryAfter("segera")).toBe(60_000);
    expect(bacaRetryAfter("-5")).toBe(60_000);
    const sekarang = Date.parse("2026-10-11T12:00:00Z");
    expect(bacaRetryAfter("Sun, 11 Oct 2026 12:02:00 GMT", sekarang)).toBe(120_000);
    expect(bacaRetryAfter("Sun, 11 Oct 2026 11:00:00 GMT", sekarang)).toBe(0);
  });
});
