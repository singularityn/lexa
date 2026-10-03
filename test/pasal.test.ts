import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PasalApiError,
  PasalClient,
  PasalRateLimitError,
  petakanJenisRelasi,
  petakanLaw,
  petakanSimpul,
  ratakanPohonPasal,
  urlBpk,
  type SimpulPasal,
} from "../src/worker/lib/pasal";

const simpul = (n: Partial<SimpulPasal> & { id: number; type: string }): SimpulPasal => ({
  number: null,
  heading: null,
  content: null,
  parent_id: null,
  sort_order: 0,
  ...n,
});

describe("petakanLaw", () => {
  it("menerima nama field alternatif dari API", () => {
    const law = petakanLaw({
      frbr_uri: "/akn/id/act/uu/2003/13",
      title: "UU Ketenagakerjaan",
      type: "uu",
      number: "13",
      year: 2003,
      status: "Dicabut",
    });
    expect(law).toMatchObject({
      frbr_uri: "/akn/id/act/uu/2003/13",
      jenis: "UU",
      nomor: "13",
      tahun: 2003,
      judul: "UU Ketenagakerjaan",
      status: "dicabut",
      jumlah_pasal: 0,
    });
  });

  it("menolak data tanpa URI atau tanpa judul", () => {
    expect(petakanLaw({ title: "Tanpa URI" })).toBeNull();
    expect(petakanLaw({ frbr_uri: "/akn/id/act/uu/2003/13" })).toBeNull();
  });
});

describe("petakanJenisRelasi", () => {
  it("menormalkan label bebas ke enum skema D1", () => {
    expect(petakanJenisRelasi("mengubah")).toBe("mengubah");
    expect(petakanJenisRelasi("Diubah Oleh")).toBe("diubah_oleh");
    expect(petakanJenisRelasi("Mencabut")).toBe("mencabut");
    expect(petakanJenisRelasi("dasar-hukum")).toBe("dasar_hukum");
  });

  it("memakai 'terkait' bila tidak dikenal", () => {
    expect(petakanJenisRelasi("tidak ada")).toBe("terkait");
    expect(petakanJenisRelasi(undefined)).toBe("terkait");
  });
});

describe("petakanSimpul", () => {
  it("menerima nama field alternatif dan menormalkan tipe", () => {
    expect(petakanSimpul({ id: "7", tipe: " Pasal ", nomor: "3", isi: "x", parentId: 1, urutan: 2 })).toEqual({
      id: 7, type: "pasal", number: "3", heading: null, content: "x", parent_id: 1, sort_order: 2,
    });
  });

  it("menolak simpul tanpa id numerik", () => {
    expect(petakanSimpul({ type: "pasal" })).toBeNull();
  });
});

describe("ratakanPohonPasal", () => {
  const uri = "/akn/id/act/uu/2025/15";

  it("meratakan pohon: kerangka jadi konteks, pasal berayat dipecah per ayat, butir digabung", () => {
    const baris = ratakanPohonPasal(
      [
        simpul({ id: 1, type: "bab", number: "I", heading: "KETENTUAN UMUM", sort_order: 1 }),
        simpul({ id: 2, type: "pasal", number: "1", content: "Definisi.", parent_id: 1, sort_order: 1 }),
        simpul({ id: 3, type: "pasal", number: "2", heading: "Hak", content: "Pengantar.", parent_id: 1, sort_order: 2 }),
        simpul({ id: 4, type: "ayat", number: "1", content: "Ayat satu.", parent_id: 3, sort_order: 1 }),
        simpul({ id: 5, type: "ayat", number: "2", content: "Ayat dua:", parent_id: 3, sort_order: 2 }),
        simpul({ id: 6, type: "huruf", number: "a", content: "butir a", parent_id: 5, sort_order: 1 }),
        simpul({ id: 7, type: "bab", number: "II", heading: "SANKSI", sort_order: 2 }),
        simpul({ id: 8, type: "pasal", number: "3", content: "Sanksi.", parent_id: 7, sort_order: 1 }),
        simpul({ id: 9, type: "pasal", number: "4", content: null, parent_id: 7, sort_order: 2 }),
      ],
      uri,
    );

    expect(baris.map((b) => b.id)).toEqual([
      `${uri}#pasal-1`,
      `${uri}#pasal-2-ayat-1`,
      `${uri}#pasal-2-ayat-2`,
      `${uri}#pasal-3`,
    ]);
    expect(baris.map((b) => b.urutan)).toEqual([0, 1, 2, 3]);
    expect(baris[0].bab).toBe("BAB I KETENTUAN UMUM");
    expect(baris[3].bab).toBe("BAB II SANKSI");
    // Kalimat pengantar pasal menempel pada ayat (1); butir huruf menempel pada induknya.
    expect(baris[1].isi).toBe("Hak\nPengantar.\nAyat satu.");
    expect(baris[2].isi).toBe("Ayat dua:\n(a) butir a");
    // Pasal tanpa isi (Pasal 4) tidak menjadi baris kosong.
    expect(baris.some((b) => b.nomor_pasal === "4")).toBe(false);
  });

  it("jaring pengaman: pasal berayat kosong tidak lenyap bila masih ada isi di bawahnya", () => {
    // Regresi nyata di produksi: UU 15/2025 kehilangan pasal yang simpul ayatnya kosong.
    const baris = ratakanPohonPasal(
      [
        simpul({ id: 1, type: "pasal", number: "6" }),
        simpul({ id: 2, type: "ayat", number: "1", content: null, parent_id: 1 }),
        simpul({ id: 3, type: "huruf", content: "butir x", parent_id: 1 }),
      ],
      uri,
    );
    expect(baris).toHaveLength(1);
    expect(baris[0]).toMatchObject({ id: `${uri}#pasal-6`, nomor_pasal: "6", ayat: null, isi: "butir x" });
  });

  it("melewati simpul tingkat atas yang bukan norma (mis. 'menimbang')", () => {
    const baris = ratakanPohonPasal(
      [
        simpul({ id: 1, type: "menimbang", content: "bahwa ..." }),
        simpul({ id: 2, type: "pasal", number: "1", content: "Isi." }),
      ],
      uri,
    );
    expect(baris.map((b) => b.nomor_pasal)).toEqual(["1"]);
  });
});

describe("PasalClient", () => {
  const panggilan: Array<{ url: URL; auth?: string; cf?: unknown }> = [];

  // `bentukDetail` bersifat private static (ingatan bentuk URL yang berhasil),
  // jadi harus direset antar tes agar tidak saling memengaruhi.
  const resetIngatan = () => {
    (PasalClient as unknown as { bentukDetail: string | null }).bentukDetail = null;
  };

  function stubFetch(handler: (url: URL) => Response) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string, init?: { headers?: Record<string, string>; cf?: unknown }) => {
        const url = new URL(String(input));
        panggilan.push({ url, auth: init?.headers?.Authorization, cf: init?.cf });
        return handler(url);
      }),
    );
  }

  const klien = () => new PasalClient({ base: "https://pasal.test/api/", token: "TKN" });
  const daftarSatu = () =>
    Response.json({
      data: [{ id: 7, frbr_uri: "/akn/id/act/uu/2000/1", title: "Satu", type: "UU", number: "1", year: 2000 }],
      total: 3,
    });

  beforeEach(() => {
    panggilan.length = 0;
    resetIngatan();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listLaws memakai limit/offset dan nama filter API (type, year), bukan page/per_page", async () => {
    stubFetch(() => daftarSatu());
    await klien().listLaws({ jenis: "UU", tahun: 2000, status: "berlaku", offset: 100, limit: 500 });

    const { url, auth, cf } = panggilan[0];
    expect(url.origin + url.pathname).toBe("https://pasal.test/api/laws");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      type: "UU", year: "2000", status: "berlaku", limit: "100", offset: "100", // limit dibatasi 100
    });
    expect(url.searchParams.has("page")).toBe(false);
    expect(url.searchParams.has("per_page")).toBe(false);
    expect(auth).toBe("Bearer TKN");
    expect(cf).toEqual({ cacheTtl: 3600, cacheEverything: true });
  });

  it("listLaws menghitung kursor halaman berikutnya dan hasMore", async () => {
    stubFetch(() => daftarSatu());
    const hasil = await klien().listLaws({ offset: 0, limit: 50 });
    expect(hasil.total).toBe(3);
    expect(hasil.offsetBerikut).toBe(1);
    expect(hasil.hasMore).toBe(true);
    expect(hasil.laws.map((l) => l.frbr_uri)).toEqual(["/akn/id/act/uu/2000/1"]);
    expect(hasil.idNumerik.get("/akn/id/act/uu/2000/1")).toBe(7);
  });

  it("HTTP 429 -> PasalRateLimitError dengan jeda dari header Retry-After", async () => {
    stubFetch(() => new Response("lambat", { status: 429, headers: { "retry-after": "42" } }));
    const dipanggil = vi.fn();
    const c = new PasalClient({ base: "https://pasal.test/api", token: "T", onRateLimit: dipanggil });

    const galat = await c.listLaws().catch((e: unknown) => e);
    expect(galat).toBeInstanceOf(PasalRateLimitError);
    expect((galat as PasalRateLimitError).retryAfterMs).toBe(42_000);
    expect(dipanggil).toHaveBeenCalledWith(42_000);
  });

  it("HTTP 429 tanpa Retry-After -> jeda bawaan 60 detik", async () => {
    stubFetch(() => new Response("lambat", { status: 429 }));
    const galat = await klien().listLaws().catch((e: unknown) => e);
    expect((galat as PasalRateLimitError).retryAfterMs).toBe(60_000);
  });

  it("status gagal lain -> PasalApiError", async () => {
    stubFetch(() => new Response("boom", { status: 500 }));
    const galat = await klien().listLaws().catch((e: unknown) => e);
    expect(galat).toBeInstanceOf(PasalApiError);
    expect(galat).toMatchObject({ status: 500, message: "pasal.id 500 pada /laws" });
  });

  it("getLaw mencoba bentuk path dulu, lalu ?uri=, dan mengingat bentuk yang berhasil", async () => {
    stubFetch((url) =>
      url.pathname.startsWith("/api/laws/akn")
        ? new Response("tidak ada", { status: 404 })
        : Response.json({
            work: { frbr_uri: url.searchParams.get("uri"), title: "T", type: "UU", number: "1", year: 2000 },
            articles: [{ id: 1, type: "pasal", number: "1", content: "Isi." }],
            relationships: [
              { frbr_uri: "/akn/id/act/uu/1999/9", relationship_type: "Mengubah", note: "catatan" },
              { note: "tanpa tujuan, harus dibuang" },
            ],
          }),
    );

    const c = klien();
    const hasil = await c.getLaw("/akn/id/act/uu/2000/1");
    expect(panggilan.map((p) => p.url.pathname + p.url.search)).toEqual([
      "/api/laws/akn/id/act/uu/2000/1", // path ditempel apa adanya (tanpa di-encode utuh)
      "/api/laws?uri=%2Fakn%2Fid%2Fact%2Fuu%2F2000%2F1",
    ]);
    expect(hasil.law.jumlah_pasal).toBe(1);
    expect(hasil.articles.map((a) => a.id)).toEqual(["/akn/id/act/uu/2000/1#pasal-1"]);
    expect(hasil.relations).toEqual([
      { to_uri: "/akn/id/act/uu/1999/9", jenis_relasi: "mengubah", keterangan: "catatan" },
    ]);

    // Panggilan kedua langsung memakai bentuk ?uri= yang sudah terbukti.
    panggilan.length = 0;
    await c.getLaw("/akn/id/act/uu/2000/1");
    expect(panggilan).toHaveLength(1);
    expect(panggilan[0].url.searchParams.get("uri")).toBe("/akn/id/act/uu/2000/1");
  });
});

describe("urlBpk", () => {
  it("membangun tautan ke halaman detail BPK", () => {
    expect(urlBpk("https://peraturan.bpk.go.id/", "149750")).toBe("https://peraturan.bpk.go.id/Details/149750");
  });

  it("mengembalikan null bila ID BPK tidak diketahui", () => {
    expect(urlBpk("https://peraturan.bpk.go.id", null)).toBeNull();
  });
});
