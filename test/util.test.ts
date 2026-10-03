import { describe, expect, it } from "vitest";
import { diagnosaToken, tokenSah } from "../src/worker/lib/auth";
import { klausaBidang, pecahBidang } from "../src/worker/lib/bidang";
import { headerCors } from "../src/worker/lib/cors";
import { potongTeks } from "../src/worker/lib/ingest";
import { gabungRRF, kunciCache, type KandidatMentah } from "../src/worker/lib/search";
import {
  bacaSesi,
  cookieHapus,
  cookieSesi,
  idSesiBaru,
  idSesiDariCookie,
  kunciSesi,
  simpanSesi,
  type Sesi,
} from "../src/worker/lib/sesi";

describe("tokenSah (token admin)", () => {
  it("menerima token yang sama, termasuk dengan spasi/newline di ujung", () => {
    expect(tokenSah("abc", "abc")).toBe(true);
    // Secret yang dipasang lewat pipa membawa newline; harus tetap cocok.
    expect(tokenSah("abc ", "abc\n")).toBe(true);
  });

  it("menolak token berbeda, kosong, atau tidak ada", () => {
    expect(tokenSah("abd", "abc")).toBe(false);
    expect(tokenSah("abcd", "abc")).toBe(false);
    expect(tokenSah(undefined, "abc")).toBe(false);
    expect(tokenSah("abc", undefined)).toBe(false);
    expect(tokenSah("", "")).toBe(false);
  });

  it("diagnosaToken hanya mengembalikan boolean, tidak membocorkan nilai", () => {
    const hasil = diagnosaToken("abc ", "abc");
    expect(hasil).toEqual({
      header_diterima: true,
      secret_terpasang: true,
      ada_spasi_berlebih: true,
      panjang_cocok: true,
      cocok: true,
    });
    expect(Object.values(hasil).every((v) => typeof v === "boolean")).toBe(true);
  });
});

describe("headerCors", () => {
  it("hanya mengizinkan origin BPK (untuk skrip panen dari sesi peramban)", () => {
    const h = headerCors("https://peraturan.bpk.go.id");
    expect(h["Access-Control-Allow-Origin"]).toBe("https://peraturan.bpk.go.id");
    expect(h["Access-Control-Allow-Headers"]).toContain("x-admin-token");
    expect(h.Vary).toBe("Origin");
    expect(headerCors("https://www.peraturan.bpk.go.id")["Access-Control-Allow-Origin"]).toBe(
      "https://www.peraturan.bpk.go.id",
    );
  });

  it("tidak memberi header CORS untuk origin lain atau tanpa origin", () => {
    expect(headerCors("https://evil.example")).toEqual({});
    expect(headerCors(undefined)).toEqual({});
  });
});

describe("bidang hukum", () => {
  it("memecah rangkaian bidang BPK pada ' - ' (dengan spasi di kedua sisi)", () => {
    expect(pecahBidang("APBN - BUMN")).toEqual(["APBN", "BUMN"]);
    expect(pecahBidang("BEA CUKAI, EKSPOR-IMPOR, KEPABEANAN")).toEqual(["BEA CUKAI, EKSPOR-IMPOR, KEPABEANAN"]);
    expect(pecahBidang(null)).toEqual([]);
    expect(pecahBidang("  ")).toEqual([]);
  });

  it("klausaBidang mencocokkan posisi: sendiri, awal, akhir, tengah", () => {
    const k = klausaBidang("bidang");
    expect(k.sql).toBe(
      "(bidang = ? OR bidang LIKE ? ESCAPE '\\' OR bidang LIKE ? ESCAPE '\\' OR bidang LIKE ? ESCAPE '\\')",
    );
    expect(k.params("PAJAK")).toEqual(["PAJAK", "PAJAK - %", "% - PAJAK", "% - PAJAK - %"]);
  });

  it("klausaBidang melucuti wildcard LIKE dari masukan pengguna", () => {
    const [persis, awal] = klausaBidang("bidang").params("A_B%");
    expect(persis).toBe("A_B%");
    expect(awal).toBe("A\\_B\\% - %");
  });
});

describe("kunciCache", () => {
  const dasar = { query: "  PHK Pesangon ", mode: "hybrid" as const, limit: 20 };

  it("menormalkan kueri dan mengurutkan filter agar kunci stabil", () => {
    const a = kunciCache({ ...dasar, filters: { jenis: ["PP", "UU"], status: ["berlaku"], tahun_min: 2000 } });
    const b = kunciCache({ ...dasar, query: "phk pesangon", filters: { jenis: ["UU", "PP"], status: ["berlaku"], tahun_min: 2000 } });
    expect(a).toBe("cari:v2:phk pesangon|hybrid|20|PP,UU|berlaku|2000|||");
    expect(b).toBe(a);
  });

  it("memasukkan semua filter ke kunci (regresi: 'bidang' pernah tertinggal)", () => {
    const polos = kunciCache(dasar);
    expect(kunciCache({ ...dasar, filters: { bidang: "PAJAK" } })).not.toBe(polos);
    expect(kunciCache({ ...dasar, filters: { instansi: "Indonesia" } })).not.toBe(polos);
    expect(kunciCache({ ...dasar, filters: { tahun_max: 2020 } })).not.toBe(polos);
    expect(kunciCache({ ...dasar, mode: "keyword" })).not.toBe(polos);
  });
});

describe("gabungRRF (Reciprocal Rank Fusion)", () => {
  const k = (
    frbr_uri: string,
    article_id: string | null,
    sumber: KandidatMentah["sumber"],
    peringkat: number,
    snippet: string | null = null,
  ): KandidatMentah => ({ frbr_uri, article_id, sumber, peringkat, snippet });

  const hasil = gabungRRF([
    [k("/a", null, "sitasi", 1), k("/b", null, "sitasi", 2)],
    [k("/b", "b1", "fts", 1, "<mark>x</mark>"), k("/c", "c1", "fts", 2)],
    [k("/c", "c1", "vector", 1)],
  ]);

  it("memberi bobot besar pada sitasi (12), FTS (1,0), dan vektor (0,8) dengan peredam K=60", () => {
    expect(hasil.get("/a")!.score).toBeCloseTo(12 / 61, 6);
    expect(hasil.get("b1")!.score).toBeCloseTo(1 / 61, 6);
    expect(hasil.get("c1")!.score).toBeCloseTo(1 / 62 + 0.8 / 61, 6);
  });

  it("menggabungkan kandidat yang sama dari beberapa sumber", () => {
    expect([...hasil.get("c1")!.sources].sort()).toEqual(["fts", "vector"]);
    expect(hasil.get("b1")!.snippet).toBe("<mark>x</mark>");
  });

  it("memisahkan hasil level peraturan dan level pasal", () => {
    expect([...hasil.keys()].sort()).toEqual(["/a", "/b", "b1", "c1"]);
  });
});

describe("potongTeks", () => {
  it("memotong teks panjang menjadi bagian <= 1200 karakter tanpa kehilangan isi", () => {
    const teks = "Kalimat satu. ".repeat(200);
    const bagian = potongTeks(teks);
    expect(bagian.length).toBeGreaterThan(1);
    expect(bagian.every((b) => b.length <= 1200)).toBe(true);
    expect(bagian.join(" ").match(/Kalimat satu\./g)).toHaveLength(200);
  });

  it("teks pendek tidak dipotong", () => {
    expect(potongTeks("Pendek saja.")).toEqual(["Pendek saja."]);
  });
});

describe("sesi login", () => {
  const sesi: Sesi = { pengguna_id: "u1", email: "a@b.c", nama: null, foto_url: null, dibuat: 1 };

  function kvPalsu() {
    const isi = new Map<string, string>();
    const kv = {
      put: async (k: string, v: string) => void isi.set(k, v),
      get: async (k: string, tipe?: string) => {
        const v = isi.get(k);
        return v === undefined ? null : tipe === "json" ? JSON.parse(v) : v;
      },
      delete: async (k: string) => void isi.delete(k),
    };
    return kv as unknown as KVNamespace;
  }

  it("membuat ID acak 256-bit yang aman untuk cookie dan kunci KV", () => {
    const id = idSesiBaru();
    expect(id).toHaveLength(64);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(idSesiBaru()).not.toBe(id);
    expect(kunciSesi("abc")).toBe("sesi:abc");
  });

  it("membaca ID sesi dari header Cookie", () => {
    expect(idSesiDariCookie("lexa_sesi=abc123; lain=1")).toBe("abc123");
    expect(idSesiDariCookie("lain=1")).toBeNull();
    expect(idSesiDariCookie(undefined)).toBeNull();
  });

  it("cookie sesi HttpOnly, SameSite=Lax, 30 hari; Secure hanya di HTTPS", () => {
    expect(cookieSesi("abc123", true)).toBe(
      "lexa_sesi=abc123; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=2592000",
    );
    expect(cookieSesi("abc123", false)).not.toContain("Secure");
    expect(cookieHapus(true)).toBe("lexa_sesi=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0");
  });

  it("menyimpan dan membaca sesi dari KV; sesi tak dikenal atau tanpa cookie -> null", async () => {
    const kv = kvPalsu();
    const id = idSesiBaru();
    await simpanSesi(kv, id, sesi);
    expect(await bacaSesi(kv, `lexa_sesi=${id}`)).toEqual(sesi);
    expect(await bacaSesi(kv, "lexa_sesi=tidak-ada")).toBeNull();
    expect(await bacaSesi(kv, undefined)).toBeNull();
  });
});
