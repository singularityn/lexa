import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  keBendera,
  PasalApiError,
  PasalClient,
  PasalRateLimitError,
  petakanJenisRelasi,
  petakanLaw,
  petakanSimpul,
  ratakanPohonPasal,
  uraiDetail,
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

  describe("nilai bersarang tidak pernah menjadi \"[object Object]\"", () => {
    const dasar = { frbr_uri: "/akn/id/act/uu/2003/13", title: "Judul" };
    const instansi = (issuing_body: unknown) => petakanLaw({ ...dasar, issuing_body })?.instansi;

    it("objek diambil namanya, apa pun nama kuncinya yang lazim", () => {
      expect(instansi({ id: 3, name: "Pemerintah Pusat" })).toBe("Pemerintah Pusat");
      expect(instansi({ id: 3, nama: "Kementerian Keuangan" })).toBe("Kementerian Keuangan");
      expect(instansi({ kode: "X", uraian: "Presiden" })).toBe("Presiden");
      expect(instansi({ detail: { name: "Bersarang" }, name: { name: "Dalam" } })).toBe("Dalam");
    });

    it("larik digabung, yang kosong dan kembar dibuang", () => {
      expect(instansi([{ name: "Presiden" }, { name: "DPR" }, { name: "Presiden" }, {}, null])).toBe("Presiden, DPR");
      expect(instansi([])).toBeNull();
    });

    it("objek yang bentuknya tak dikenal dan teks '[object Object]' yang sudah telanjur ada dianggap kosong", () => {
      expect(instansi({ id: 3, kode: "PP" })).toBeNull();
      expect(instansi({})).toBeNull();
      expect(instansi("[object Object]")).toBeNull();
    });

    it("teks biasa, angka, dan nilai kosong tetap seperti semula", () => {
      expect(instansi("  Presiden  ")).toBe("Presiden");
      expect(instansi(42)).toBe("42");
      expect(instansi("")).toBeNull();
      expect(instansi(null)).toBeNull();
      expect(instansi(undefined)).toBeNull();
    });

    it("berlaku juga untuk bidang dan ringkasan, bukan hanya instansi", () => {
      const law = petakanLaw({ ...dasar, bidang: { label: "PERPAJAKAN" }, summary: ["Satu", "Dua"] });
      expect(law).toMatchObject({ bidang: "PERPAJAKAN", ringkasan: "Satu, Dua" });
    });
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

describe("ratakanPohonPasal: bentuk pohon yang dulu menghilangkan isi", () => {
  const URI = "/akn/id/act/uu/2023/17";

  it("pasal yatim (induknya tak ada di respons) diperlakukan sebagai akar, bukan dibuang diam-diam", () => {
    const baris = ratakanPohonPasal(
      [
        simpul({ id: 3, type: "ayat", number: "1", content: "Ayat yatim tanpa pasal.", parent_id: 998, sort_order: 0 }),
        simpul({ id: 1, type: "pasal", number: "1", content: "Pasal satu.", sort_order: 1 }),
        simpul({ id: 2, type: "pasal", number: "2", content: "Pasal dua yatim.", parent_id: 999, sort_order: 2 }),
      ],
      URI,
    );
    // Ayat yatim yang tak punya pasal di depannya tetap tak punya tempat; pasal yatim kini terambil.
    expect(baris.map((b) => [b.nomor_pasal, b.isi])).toEqual([["1", "Pasal satu."], ["2", "Pasal dua yatim."]]);
  });

  it("ayat yatim yang jatuh sesudah sebuah pasal dipasang ke pasal itu", () => {
    const baris = ratakanPohonPasal(
      [
        simpul({ id: 1, type: "pasal", number: "1", content: "Pengantar.", sort_order: 1 }),
        simpul({ id: 2, type: "ayat", number: "1", content: "Ayat yatim.", parent_id: 998, sort_order: 2 }),
      ],
      URI,
    );
    expect(baris.map((b) => [b.nomor_pasal, b.ayat, b.isi])).toEqual([["1", "1", "Pengantar.\nAyat yatim."]]);
  });

  it("ayat yang bersaudara dengan pasalnya (sama-sama anak bab) dipasang ke pasal di depannya", () => {
    const baris = ratakanPohonPasal(
      [
        simpul({ id: 1, type: "bab", number: "I", heading: "KETENTUAN UMUM", sort_order: 1 }),
        simpul({ id: 2, type: "pasal", number: "4", parent_id: 1, sort_order: 10 }),
        simpul({ id: 3, type: "ayat", number: "1", content: "Setiap orang berhak.", parent_id: 1, sort_order: 11 }),
        simpul({ id: 4, type: "ayat", number: "2", content: "Hak dilaksanakan.", parent_id: 1, sort_order: 12 }),
        simpul({ id: 5, type: "pasal", number: "5", content: "Pasal tunggal.", parent_id: 1, sort_order: 20 }),
      ],
      URI,
    );
    expect(baris.map((b) => [b.nomor_pasal, b.ayat, b.isi, b.bab])).toEqual([
      ["4", "1", "Setiap orang berhak.", "BAB I KETENTUAN UMUM"],
      ["4", "2", "Hak dilaksanakan.", "BAB I KETENTUAN UMUM"],
      ["5", null, "Pasal tunggal.", "BAB I KETENTUAN UMUM"],
    ]);
  });

  it("butir (huruf) yang menyusul ayat bersaudara ikut ke ayat itu, dan yang menyusul pasal tanpa ayat ikut ke pasalnya", () => {
    const baris = ratakanPohonPasal(
      [
        simpul({ id: 1, type: "pasal", number: "1", content: "Pengantar:", sort_order: 1 }),
        simpul({ id: 2, type: "huruf", number: "a", content: "butir satu;", sort_order: 2 }),
        simpul({ id: 3, type: "huruf", number: "b", content: "butir dua.", sort_order: 3 }),
        simpul({ id: 4, type: "pasal", number: "2", sort_order: 4 }),
        simpul({ id: 5, type: "ayat", number: "1", content: "Ayat pasal dua:", sort_order: 5 }),
        simpul({ id: 6, type: "huruf", number: "a", content: "rincian ayat.", sort_order: 6 }),
      ],
      URI,
    );
    expect(baris[0].isi).toBe("Pengantar:\n(a) butir satu;\n(b) butir dua.");
    expect(baris[1]).toMatchObject({ nomor_pasal: "2", ayat: "1", isi: "Ayat pasal dua:\n(a) rincian ayat." });
  });

  it("tipe lain di tingkat atas (menimbang, mengingat) tidak diseret ke pasal di depannya", () => {
    const baris = ratakanPohonPasal(
      [
        simpul({ id: 1, type: "pasal", number: "1", content: "Pasal satu.", sort_order: 1 }),
        simpul({ id: 2, type: "penutup", content: "Ditetapkan di Jakarta.", sort_order: 2 }),
      ],
      URI,
    );
    expect(baris).toHaveLength(1);
    expect(baris[0].isi).toBe("Pasal satu.");
  });

  it("pohon yang bersarang benar tidak berubah", () => {
    const baris = ratakanPohonPasal(
      [
        simpul({ id: 1, type: "pasal", number: "1", sort_order: 1 }),
        simpul({ id: 2, type: "ayat", number: "1", content: "A.", parent_id: 1, sort_order: 2 }),
        simpul({ id: 3, type: "ayat", number: "2", content: "B.", parent_id: 1, sort_order: 3 }),
      ],
      URI,
    );
    expect(baris.map((b) => [b.nomor_pasal, b.ayat, b.isi])).toEqual([["1", "1", "A."], ["1", "2", "B."]]);
  });
});

describe("uraiDetail", () => {
  const mentah = {
    work: { id: 7, frbr_uri: "/akn/id/act/uu/2023/17", title: "Kesehatan", type: "UU", number: "17", year: 2023, status: "berlaku", content_verified: true },
    detail_access: { tier: "free", partial: true },
    articles: [
      { id: 1, type: "pasal", number: "1", content: "Pasal satu.", sort_order: 1 },
      { id: 2, type: "pasal", number: "2", content: "Yatim.", parent_id: 555, sort_order: 2 },
    ],
    relationships: [{ frbr_uri: "/akn/id/act/uu/2009/36", relationship_type: "Mencabut" }],
  };

  it("memetakan peraturan, pasal, relasi, tingkat akses, bendera verifikasi, dan ringkasan pohon", () => {
    const d = uraiDetail(mentah);
    expect(d.law).toMatchObject({ frbr_uri: "/akn/id/act/uu/2023/17", judul: "Kesehatan", jenis: "UU", jumlah_pasal: 2 });
    expect(d.articles.map((a) => a.nomor_pasal)).toEqual(["1", "2"]);
    expect(d.relations).toEqual([{ to_uri: "/akn/id/act/uu/2009/36", jenis_relasi: "mencabut", keterangan: null }]);
    expect(d.akses).toBe('{"tier":"free","partial":true}');
    expect(d.terverifikasi).toBe(true);
    expect(d.pohon).toBe("2 simpul: pasal 2; 2 berisi; 1 yatim");
  });

  it("respons yang tak terpetakan melempar PasalApiError 422 (tanpa menyimpan setengah data)", () => {
    expect(() => uraiDetail({ work: { frbr_uri: "/akn/id/act/uu/2023/17" } })).toThrow(PasalApiError);
    expect(() => uraiDetail(null)).toThrow(PasalApiError);
  });

  it("detail_access teks dibawa apa adanya, dan yang tak ada menjadi null", () => {
    expect(uraiDetail({ ...mentah, detail_access: "full" }).akses).toBe("full");
    expect(uraiDetail({ ...mentah, detail_access: undefined }).akses).toBeNull();
  });
});

describe("keBendera", () => {
  it("membaca true/false, 1/0, dan 'true'/'false'; selain itu tidak diketahui", () => {
    for (const v of [true, 1, "1", "true"]) expect(keBendera(v), String(v)).toBe(true);
    for (const v of [false, 0, "0", "false"]) expect(keBendera(v), String(v)).toBe(false);
    for (const v of [undefined, null, "", "ya", 2, {}]) expect(keBendera(v), String(v)).toBeNull();
  });
});
