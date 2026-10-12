import { describe, expect, it } from "vitest";
import { alamatRincian, bacaAlamatBpk, kenaliTautan, type HasilKenali } from "../src/worker/lib/tautanBpk";

/** Kandidat sitasi sebagai teks ringkas, mis. ["PP 5/2021"]. */
function kandidat(h: HasilKenali): string[] {
  if (!h.ok) throw new Error(`tidak dikenali: ${h.alasan}`);
  return h.dok.kandidat.map((s) => `${s.jenis} ${s.nomor}/${s.tahun}`);
}

describe("bacaAlamatBpk dan alamatRincian", () => {
  it("membaca id dan slug dari bentuk alamat BPK yang lazim", () => {
    expect(bacaAlamatBpk("/Details/149750/uu-no-11-tahun-2020")).toEqual({ bpk_id: "149750", slug: "uu-no-11-tahun-2020" });
    expect(bacaAlamatBpk("https://peraturan.bpk.go.id/Home/Details/39012")).toEqual({ bpk_id: "39012", slug: null });
    expect(bacaAlamatBpk("https://peraturan.bpk.go.id/Details/45929?x=1#a")).toEqual({ bpk_id: "45929", slug: null });
  });

  it("alamat mutlak ke situs lain, dan alamat yang bukan halaman rincian, ditolak", () => {
    expect(bacaAlamatBpk("https://contoh.example/Details/1/uu-no-1-tahun-2020")).toBeNull();
    expect(bacaAlamatBpk("https://peraturan.bpk.go.id.contoh.example/Details/1")).toBeNull();
    expect(bacaAlamatBpk("/Download/1/berkas.pdf")).toBeNull();
    expect(bacaAlamatBpk("")).toBeNull();
    expect(bacaAlamatBpk(undefined)).toBeNull();
  });

  it("alamat yang disimpan dibangun dari id dan slug yang sudah divalidasi", () => {
    expect(alamatRincian("https://peraturan.bpk.go.id/", "123", "pp-no-5-tahun-2021")).toBe("https://peraturan.bpk.go.id/Details/123/pp-no-5-tahun-2021");
    expect(alamatRincian("https://peraturan.bpk.go.id", "123", null)).toBe("https://peraturan.bpk.go.id/Details/123");
  });
});

describe("kenaliTautan: UU, Perppu, PP", () => {
  it("dari slug", () => {
    expect(kandidat(kenaliTautan({ url: "/Details/149750/uu-no-11-tahun-2020" }))).toEqual(["UU 11/2020"]);
    expect(kandidat(kenaliTautan({ url: "/Details/319773/pp-no-28-tahun-2025" }))).toEqual(["PP 28/2025"]);
  });

  it("Perppu: BPK memakai 'perppu' dan 'perpu' bergantian pada slug", () => {
    expect(kandidat(kenaliTautan({ url: "/Details/234926/perppu-no-2-tahun-2022" }))).toEqual(["PERPPU 2/2022"]);
    expect(kandidat(kenaliTautan({ url: "/Details/53275/perpu-no-1-tahun-2017" }))).toEqual(["PERPPU 1/2017"]);
  });

  it("dari teks tautan bila alamatnya tanpa slug (bentuk 'Details/<id>' saja)", () => {
    expect(kandidat(kenaliTautan({ url: "https://peraturan.bpk.go.id/Details/47004", teks: "Undang-undang (UU) No. 8 Tahun 1982" }))).toEqual(["UU 8/1982"]);
    expect(kandidat(kenaliTautan({ url: "/Details/53949", teks: "Peraturan Pemerintah Pengganti Undang-Undang (Perpu) No. 17 Tahun 1959" }))).toEqual(["PERPPU 17/1959"]);
    expect(kandidat(kenaliTautan({ url: "/Details/1", teks: "PP No. 99 Tahun 2025 tentang Pengelolaan Sampah" }))).toEqual(["PP 99/2025"]);
  });

  it("slug dan teks yang sepakat menghasilkan satu kandidat", () => {
    expect(kandidat(kenaliTautan({ url: "/Details/15/uu-no-15-tahun-2006", teks: "UU No. 15 Tahun 2006 tentang Badan Pemeriksa Keuangan" }))).toEqual(["UU 15/2006"]);
  });

  it("slug dan teks yang berselisih jenis menghasilkan dua kandidat; yang memutuskan data Lexa (BPK menamai Perppu 7/1964 'uu-no-7-tahun-1964')", () => {
    const h = kenaliTautan({ url: "/Details/50288/uu-no-7-tahun-1964", teks: "Peraturan Pemerintah Pengganti Undang-Undang (Perpu) No. 7 Tahun 1964" });
    expect(kandidat(h)).toEqual(["UU 7/1964", "PERPPU 7/1964"]);
  });

  it("kolom jenis, nomor, tahun yang terpisah ikut dipakai", () => {
    expect(kandidat(kenaliTautan({ bpk_id: 77, jenis: "PP", nomor: "9", tahun: 2018 }))).toEqual(["PP 9/2018"]);
  });

  it("jenis di luar llima jenis tetap dikenali (pemeriksaan cakupan dilakukan pemanggil)", () => {
    expect(kandidat(kenaliTautan({ url: "/Details/5/perpres-no-5-tahun-2020" }))).toEqual(["PERPRES 5/2020"]);
  });
});

describe("kenaliTautan: Tap MPR", () => {
  it("slug BPK tanpa garis miring: 'tap-mpr-no-xvimpr1998'", () => {
    expect(kandidat(kenaliTautan({ url: "https://peraturan.bpk.go.id/Details/210109/tap-mpr-no-xvimpr1998" }))).toEqual(["TAP_MPR xvi-mpr-1998/1998"]);
  });

  it("teks 'Ketetapan MPR Nomor XVI/MPR/1998 tentang ...'", () => {
    expect(kandidat(kenaliTautan({ url: "/Details/210109", teks: "Ketetapan MPR Nomor XVI/MPR/1998 tentang Politik Ekonomi dalam Rangka Demokrasi Ekonomi" }))).toEqual(["TAP_MPR xvi-mpr-1998/1998"]);
    expect(kandidat(kenaliTautan({ url: "/Details/2", teks: "Ketetapan Majelis Permusyawaratan Rakyat Nomor V/MPR/1999 tentang Penentuan Pendapat di Timor Timur" }))).toEqual(["TAP_MPR v-mpr-1999/1999"]);
  });

  it("'TAP MPR No. I' tanpa tahun pada nomor: tahun dari kolom, dari 'Tahun 2003' di teks, atau dari teks kartu", () => {
    expect(kandidat(kenaliTautan({ url: "/Details/95809/tap-mpr-no-i", tahun: 2003 }))).toEqual(["TAP_MPR I/2003"]);
    expect(kandidat(kenaliTautan({ url: "/Details/95809/tap-mpr-no-i", teks: "TAP MPR No. I Tahun 2003" }))).toEqual(["TAP_MPR I/2003"]);
    expect(kandidat(kenaliTautan({ url: "/Details/95809/tap-mpr-no-i", konteks: "TAP MPR No. I Bentuk: Ketetapan MPR Tahun 2003 Status: Berlaku" }))).toEqual(["TAP_MPR I/2003"]);
  });

  it("tanpa tahun di mana pun tidak ditebak", () => {
    const h = kenaliTautan({ url: "/Details/95809/tap-mpr-no-i" });
    expect(h.ok).toBe(false);
  });

  it("penutup kurung atau koma sesudah nomor tidak ikut menjadi nomor", () => {
    expect(kandidat(kenaliTautan({ url: "/Details/3", teks: "Ketetapan MPR (TAP MPR) Nomor VI/MPR/2001, tentang Etika Kehidupan Berbangsa" }))).toEqual(["TAP_MPR vi-mpr-2001/2001"]);
  });

  it("Peraturan MPR bukan Tap MPR", () => {
    const h = kenaliTautan({ url: "/Details/227510/peraturan-mpr-no-1-tahun-2014" });
    expect(h.ok).toBe(false);
  });
});

describe("kenaliTautan: UUD", () => {
  it("dokumen 'UUD 1945 dan Amandemen' dipetakan ke naskah asli", () => {
    expect(kandidat(kenaliTautan({ url: "/Details/101646/uud-no--", teks: "UUD No. - tentang UUD 1945 dan Amandemen" }))).toEqual(["UUD 1945/1945"]);
  });
  it("perubahan hanya bila disebut tegas", () => {
    expect(kandidat(kenaliTautan({ url: "/Details/9", teks: "Undang-Undang Dasar Negara Republik Indonesia Tahun 1945 Perubahan Kedua" }))).toEqual(["UUD 1945/P2/1945"]);
    expect(kandidat(kenaliTautan({ url: "/Details/9", teks: "UUD 1945 Perubahan ke-4" }))).toEqual(["UUD 1945/P4/1945"]);
  });
  it("UUD Sementara dan Konstitusi RIS bukan UUD 1945", () => {
    expect(kenaliTautan({ url: "/Details/9", teks: "Undang-Undang Dasar Sementara 1950" }).ok).toBe(false);
    expect(kenaliTautan({ url: "/Details/9", teks: "UUD RIS 1949 Konstitusi Republik Indonesia Serikat" }).ok).toBe(false);
  });
  it("Perppu yang namanya memuat 'Undang-Undang' bukan UUD", () => {
    expect(kandidat(kenaliTautan({ url: "/Details/9/perppu-no-1-tahun-2020" }))).toEqual(["PERPPU 1/2020"]);
  });
});

describe("kenaliTautan: masukan yang buruk", () => {
  it("tanpa id dokumen, atau id bukan angka", () => {
    expect(kenaliTautan({ teks: "UU No. 1 Tahun 2020" })).toEqual({ ok: false, alasan: "id dokumen BPK tak ditemukan" });
    expect(kenaliTautan({ bpk_id: "abc", teks: "UU No. 1 Tahun 2020" }).ok).toBe(false);
  });

  it("alamat ke situs lain tanpa bpk_id ditolak; dengan bpk_id yang sah alamat itu diabaikan", () => {
    expect(kenaliTautan({ url: "https://contoh.example/Details/1/uu-no-1-tahun-2020" })).toEqual({ ok: false, alasan: "alamat bukan halaman rincian BPK" });
    const h = kenaliTautan({ url: "https://contoh.example/x", bpk_id: "12", teks: "UU No. 1 Tahun 2020" });
    expect(h.ok && h.dok.slug).toBeNull();
  });

  it("slug dengan karakter tak aman tidak disimpan", () => {
    const h = kenaliTautan({ bpk_id: "12", slug: "uu-no-1-tahun-2020<script>", teks: "UU No. 1 Tahun 2020" });
    expect(h.ok && h.dok.slug).toBeNull();
    expect(kandidat(h)).toEqual(["UU 1/2020"]);
  });

  it("tak ada sitasi di slug maupun teks", () => {
    expect(kenaliTautan({ url: "/Details/5/selengkapnya", teks: "Selengkapnya" })).toEqual({ ok: false, alasan: "sitasi tak dikenali dari slug maupun teks tautan" });
  });

  it("teks kartu saja tidak dipakai mengenali sitasi (terlalu mudah keliru)", () => {
    expect(kenaliTautan({ url: "/Details/5/x", konteks: "PP No. 5 Tahun 2021 tentang apa saja" }).ok).toBe(false);
  });

  it("masukan bertipe aneh tidak membuat galat", () => {
    expect(kenaliTautan(null as never).ok).toBe(false);
    expect(kenaliTautan({ url: 5, bpk_id: {}, teks: ["x"] } as never).ok).toBe(false);
    const panjang = "UU No. 1 Tahun 2020 ".repeat(5000);
    expect(kenaliTautan({ bpk_id: "1", teks: panjang }).ok).toBe(true);
  });

  it("pemetaan manual (uri) melewati pengenalan sitasi", () => {
    const h = kenaliTautan({ url: "/Details/101646/uud-no--", uri: "/akn/id/act/uud/1945/original" });
    expect(h).toEqual({ ok: true, dok: { bpk_id: "101646", slug: "uud-no--", kandidat: [], uri: "/akn/id/act/uud/1945/original" } });
  });
});
