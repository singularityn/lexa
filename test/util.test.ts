import { describe, expect, it } from "vitest";
import { diagnosaToken, tokenSah } from "../src/worker/lib/auth";
import { klausaBidang, pecahBidang } from "../src/worker/lib/bidang";
import { headerCors } from "../src/worker/lib/cors";
import { potongTeks } from "../src/worker/lib/ingest";
import { bersihkanJudul, rapikanArtikel, rapikanInstansi, rapikanLaw, rapikanNomorPasal } from "../src/shared/label";
import { gabungRRF, jatahJudul, kunciCache, urutkanBertingkat, type KandidatMentah } from "../src/worker/lib/search";
import {
  bacaSesi,
  cookieHapus,
  cookieSesi,
  idSesiBaru,
  idSesiDariCookie,
  kunciSesi,
  simpanSesi,
  type Sesi,  tujuanAman,
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

  it("klausaBidang membungkus kolom dengan pemisah dan mencari ' - X - ' utuh", () => {
    const k = klausaBidang("bidang");
    expect(k.sql).toBe("INSTR(LOWER(' - ' || bidang || ' - '), LOWER(?)) > 0");
    expect(k.params("PAJAK")).toEqual([" - PAJAK - "]);
  });

  it("klausaBidang tidak memakai LIKE/GLOB (D1 membatasi pola 50 byte) dan tidak punya wildcard", () => {
    const k = klausaBidang("l.bidang");
    expect(k.sql).not.toMatch(/\b(LIKE|GLOB)\b/i);
    // `%` dan `_` dari masukan pengguna adalah karakter biasa.
    expect(k.params("A_B%")).toEqual([" - A_B% - "]);
  });
});

describe("kunciCache", () => {
  const dasar = { query: "  PHK Pesangon ", mode: "hybrid" as const, limit: 20 };

  it("menormalkan kueri dan mengurutkan filter agar kunci stabil", () => {
    const a = kunciCache({ ...dasar, filters: { jenis: ["PP", "UU"], status: ["berlaku"], tahun_min: 2000 } });
    const b = kunciCache({ ...dasar, query: "phk pesangon", filters: { jenis: ["UU", "PP"], status: ["berlaku"], tahun_min: 2000 } });
    expect(a).toBe("cari:v5:PERPPU,PP,TAP_MPR,UU,UUD|phk pesangon|hybrid|20|PP,UU|berlaku|2000|||");
    expect(b).toBe(a);
  });

  it("memasukkan cakupan ke kunci, tak peduli urutannya: mengubah cakupan tidak menyajikan hasil lama", () => {
    const bawaan = kunciCache(dasar);
    expect(kunciCache(dasar, ["UU", "PP"])).not.toBe(bawaan);
    expect(kunciCache(dasar, ["PP", "UU"])).toBe(kunciCache(dasar, ["UU", "PP"]));
    expect(kunciCache(dasar, ["UUD", "TAP_MPR", "UU", "PERPPU", "PP"])).toBe(bawaan);
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

describe("urutkanBertingkat (sitasi, lalu peraturan berjudul cocok, lalu skor fusi)", () => {
  type E = { frbr_uri: string; article_id: string | null; score: number; sources: Set<string> };
  const e = (frbr_uri: string, article_id: string | null, score: number, sources: string[] = ["fts"]): E => ({
    frbr_uri, article_id, score, sources: new Set(sources),
  });
  const uri = (t: E) => t.article_id ?? t.frbr_uri;

  it("peraturan berjudul cocok mendahului pasal yang skor fusinya jauh lebih besar", () => {
    // Keadaan produksi: UU Kelautan hanya dari FTS peraturan (0,016); pasal-pasalnya dari FTS dan vektor sekaligus (0,029).
    const { terurut } = urutkanBertingkat(
      [e("/pp/62", "/pp/62#1", 0.0295, ["fts", "vector"]), e("/uu/32", null, 0.0164), e("/uu/31", "/uu/31#3", 0.029, ["fts", "vector"])],
      [{ frbr_uri: "/uu/32" }],
      20,
    );
    expect(terurut.map(uri)).toEqual(["/uu/32", "/pp/62#1", "/uu/31#3"]);
  });

  it("di antara peraturan tingkat judul, urutan nilai judul yang berlaku, bukan skor fusi", () => {
    const { terurut } = urutkanBertingkat(
      [e("/a", null, 0.03), e("/b", null, 0.01), e("/c", null, 0.02)],
      [{ frbr_uri: "/b" }, { frbr_uri: "/c" }, { frbr_uri: "/a" }],
      20,
    );
    expect(terurut.map(uri)).toEqual(["/b", "/c", "/a"]);
  });

  it("sitasi tetap paling atas, sekalipun ada peraturan berjudul cocok", () => {
    const { terurut } = urutkanBertingkat(
      [e("/judul", null, 0.02), e("/sitasi", null, 0.19, ["sitasi"])],
      [{ frbr_uri: "/judul" }],
      20,
    );
    expect(terurut.map(uri)).toEqual(["/sitasi", "/judul"]);
  });

  it("hanya hasil tingkat peraturan yang berjudul cocok; pasal dari peraturan yang sama tetap hasil biasa", () => {
    const { terurut, cocokJudul } = urutkanBertingkat(
      [e("/uu/32", "/uu/32#1", 0.05), e("/uu/32", null, 0.01)],
      [{ frbr_uri: "/uu/32" }],
      20,
    );
    expect(terurut.map((t) => [uri(t), cocokJudul(t)])).toEqual([["/uu/32", true], ["/uu/32#1", false]]);
  });

  it("sisa di luar jatah halaman kembali bersaing menurut skor fusi dan tidak ditandai", () => {
    const judul = Array.from({ length: 30 }, (_, i) => ({ frbr_uri: `/j${i}` }));
    const entri = [...judul.map((j, i) => e(j.frbr_uri, null, 0.01 + i / 10000)), e("/pasal", "/pasal#1", 0.0302, ["fts", "vector"])];
    const { terurut, cocokJudul } = urutkanBertingkat(entri, judul, 20);
    expect(terurut.slice(0, 15).every(cocokJudul)).toBe(true);
    expect(terurut.slice(0, 15).map(uri)).toEqual(judul.slice(0, 15).map((j) => j.frbr_uri));
    expect(terurut.filter(cocokJudul)).toHaveLength(15);
    // Pasal (0,0302) mengalahkan semua judul sisa (0,01x) di tingkat bawah.
    expect(uri(terurut[15])).toBe("/pasal#1");
  });

  it("tanpa daftar judul, urutannya hanya skor fusi (perilaku semula)", () => {
    const { terurut } = urutkanBertingkat([e("/a", null, 0.01), e("/b", "/b#1", 0.03), e("/c", null, 0.02)], [], 20);
    expect(terurut.map(uri)).toEqual(["/b#1", "/c", "/a"]);
  });
});

describe("jatahJudul (berapa peraturan tingkat judul per halaman)", () => {
  it("menyisakan paling sedikit lima hasil lain pada halaman besar, tetapi tidak kurang dari separuh halaman untuk judul", () => {
    expect(jatahJudul(20)).toBe(15);
    expect(jatahJudul(50)).toBe(37);
    expect(jatahJudul(12)).toBe(7);
    expect(jatahJudul(5)).toBe(3);
    expect(jatahJudul(1)).toBe(1);
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

describe("tujuanAman (tujuan setelah masuk)", () => {
  it.each([
    ["/", "/"],
    ["/koleksi", "/koleksi"],
    ["/cari?q=pesangon&mode=keyword#hasil", "/cari?q=pesangon&mode=keyword#hasil"],
    ["/peraturan?uri=%2Fakn%2Fid%2Fact%2Fuu%2F2003%2F13#pasal-82-ayat-1", "/peraturan?uri=%2Fakn%2Fid%2Fact%2Fuu%2F2003%2F13#pasal-82-ayat-1"],
    ["/a/../b", "/b"],
  ])("jalur lokal %j diteruskan", (masukan, harapan) => {
    expect(tujuanAman(masukan)).toBe(harapan);
  });

  it.each([
    "//jahat.example",
    "//jahat.example/jalur",
    "///jahat.example",
    "/\\jahat.example",
    "/\t/jahat.example",
    "/\n/jahat.example",
    "/\r/jahat.example",
    "\\jahat.example",
    "https://jahat.example",
    "http://jahat.example/",
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "jahat.example",
    "koleksi",
    " /koleksi",
    "",
  ])("tujuan mencurigakan %j jatuh ke beranda", (masukan) => {
    expect(tujuanAman(masukan)).toBe("/");
  });

  it("null dan undefined jatuh ke beranda", () => {
    expect(tujuanAman(null)).toBe("/");
    expect(tujuanAman(undefined)).toBe("/");
  });
});

describe("rapikanInstansi / rapikanLaw", () => {
  it.each([
    ["[object Object]", null],
    ["[object Array]", null],
    ["", null],
    ["   ", null],
    [null, null],
    [undefined, null],
    ["Indonesia", null],
    ["indonesia", null],
    ["Indonesia, ", null],
    ["Indonesia, Pemerintah Pusat", "Pemerintah Pusat"],
    ["INDONESIA , Presiden", "Presiden"],
    ["Pemerintah Pusat", "Pemerintah Pusat"],
    ["Kementerian Keuangan Republik Indonesia", "Kementerian Keuangan Republik Indonesia"],
  ])("%j -> %j", (masukan, harapan) => {
    expect(rapikanInstansi(masukan as string | null | undefined)).toBe(harapan);
  });

  it("rapikanLaw hanya mengganti instansi, dan mengembalikan objek yang sama bila tidak ada yang berubah", () => {
    const bersih = { judul: "x", instansi: "Presiden" };
    expect(rapikanLaw(bersih)).toBe(bersih);
    const kotor = { judul: "x", instansi: "[object Object]", tahun: 2003 };
    expect(rapikanLaw(kotor)).toEqual({ judul: "x", instansi: null, tahun: 2003 });
    expect(kotor.instansi).toBe("[object Object]"); // tidak mengubah masukan
  });
});

describe("bersihkanJudul (karakter pengganti dari sumber)", () => {
  it.each([
    // Data produksi: UU 35/1953.
    ["Undang-Undang Nomor 35 Tahun 1953 tentang Penetapan ï¿½undang-undang Darurat Nomor 19 Tahun 1951", "Undang-Undang Nomor 35 Tahun 1953 tentang Penetapan undang-undang Darurat Nomor 19 Tahun 1951"],
    ["Penetapan \uFFFDundang-undang Darurat", "Penetapan undang-undang Darurat"],
    ["Pasal \uFFFD\uFFFD dan ï¿½ï¿½ lain", "Pasal dan lain"],
    ["Judul biasa tentang Kelautan", "Judul biasa tentang Kelautan"],
    ["", ""],
  ])("%j -> %j", (masuk, keluar) => {
    expect(bersihkanJudul(masuk)).toBe(keluar);
  });

  it("dipanggil berulang tetap konsisten (tanpa keadaan tersisa dari ekspresi reguler)", () => {
    for (let i = 0; i < 4; i++) expect(bersihkanJudul("a \uFFFD b")).toBe("a b");
  });

  it("rapikanLaw ikut membersihkan judul dan tentang, dan tidak mengubah objek yang sudah bersih", () => {
    const rusak = { judul: "UU \uFFFDx", tentang: "T\uFFFD", instansi: "Presiden", tahun: 1953 };
    expect(rapikanLaw(rusak)).toEqual({ judul: "UU x", tentang: "T", instansi: "Presiden", tahun: 1953 });
    expect(rusak.judul).toBe("UU \uFFFDx");
    const bersih = { judul: "UU x", tentang: null, instansi: "Presiden" };
    expect(rapikanLaw(bersih)).toBe(bersih);
  });
});

describe("rapikanNomorPasal / rapikanArtikel (angka nol yang terbaca huruf O oleh OCR)", () => {
  it.each([
    ["1O", "10"], ["2O", "20"], ["12O", "120"], ["1OO", "100"], ["1O1", "101"],
    ["1OA", "10A"], ["12OB", "120B"], // huruf sisipan sesudahnya tetap
  ])("%s menjadi %s", (masuk, keluar) => {
    expect(rapikanNomorPasal(masuk)).toBe(keluar);
  });

  it.each(["1", "10", "5A", "12B", "119L", "I", "II", "XIV", "Umum", "O", "O5", "", "1AO", "a1O"])(
    "%j tidak berubah (bukan angka yang terbaca O)",
    (nomor) => {
      expect(rapikanNomorPasal(nomor)).toBe(nomor);
    },
  );

  it("rapikanArtikel mengembalikan objek yang sama bila tak ada yang berubah, dan salinan bila berubah", () => {
    const baik = { id: "u#pasal-5", nomor_pasal: "5", isi: "x" };
    expect(rapikanArtikel(baik)).toBe(baik);
    const rusak = { id: "u#pasal-1O", nomor_pasal: "1O", isi: "x" };
    expect(rapikanArtikel(rusak)).toEqual({ id: "u#pasal-1O", nomor_pasal: "10", isi: "x" });
    expect(rusak.nomor_pasal).toBe("1O"); // objek asal tidak diubah
  });
});
