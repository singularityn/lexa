import { describe, expect, it } from "vitest";
import { kunciSitasi, nomorKanonik, ringkasNomor, samaSitasi, uraiNomorTapMpr } from "../src/worker/lib/nomor";

describe("uraiNomorTapMpr", () => {
  it.each([
    ["XVI/MPR/1998", { romawi: "xvi", badan: "mpr", tahun: 1998 }],
    ["xvi-mpr-1998", { romawi: "xvi", badan: "mpr", tahun: 1998 }],
    ["XVI-MPR-1998", { romawi: "xvi", badan: "mpr", tahun: 1998 }],
    // Slug BPK membuang garis miringnya: "tap-mpr-no-xvimpr1998".
    ["xvimpr1998", { romawi: "xvi", badan: "mpr", tahun: 1998 }],
    ["i-mprs-1960", { romawi: "i", badan: "mprs", tahun: 1960 }],
    ["mprxxiv-mprs-1966", { romawi: "xxiv", badan: "mprs", tahun: 1966 }],
    ["IV/MPR/1999", { romawi: "iv", badan: "mpr", tahun: 1999 }],
    // Hanya angka Romawi, tahunnya kolom tersendiri (TAP MPR No. I, 2003).
    ["I", { romawi: "i", badan: null, tahun: null }],
    // "m" bagian dari angka Romawi dan awal "mpr": angka diambil sependek yang membuat sisanya sah.
    ["vimpr2000", { romawi: "vi", badan: "mpr", tahun: 2000 }],
  ])("%s", (nomor, harapan) => {
    expect(uraiNomorTapMpr(nomor)).toEqual(harapan);
  });

  it("menolak yang bukan angka Romawi yang sah", () => {
    for (const nomor of ["16", "abc", "", "mpr", "iiii", "1945", "xvi/dpr/1998"]) expect(uraiNomorTapMpr(nomor), nomor).toBeNull();
  });
});

describe("kunciSitasi dan samaSitasi", () => {
  const sama = (a: [string, string, number], b: [string, string, number]) => samaSitasi(kunciSitasi(...a), kunciSitasi(...b));

  it("nol di depan dan spasi/huruf besar pada akhiran tak membedakan nomor", () => {
    expect(sama(["PP", "01", 2022], ["PP", "1", 2022])).toBe(true);
    expect(sama(["UU", "5 A", 2020], ["UU", "5a", 2020])).toBe(true);
    expect(sama(["UU", "5A", 2020], ["UU", "5", 2020])).toBe(false);
  });

  it("jenis dan tahun harus sama persis", () => {
    expect(sama(["UU", "7", 1964], ["PERPPU", "7", 1964])).toBe(false);
    expect(sama(["PP", "5", 2021], ["PP", "5", 2020])).toBe(false);
  });

  it("Tap MPR: penulisan pemisah dan huruf besar/kecil tak membedakan; angka Romawi dan tahun membedakan", () => {
    const varian: Array<[string, string, number]> = [
      ["TAP_MPR", "XVI/MPR/1998", 1998], ["TAP_MPR", "XVI-MPR-1998", 1998], ["TAP_MPR", "xvi-mpr-1998", 1998], ["TAP_MPR", "xvimpr1998", 1998],
    ];
    for (const a of varian) for (const b of varian) expect(sama(a, b)).toBe(true);
    expect(sama(["TAP_MPR", "xvi-mpr-1998", 1998], ["TAP_MPR", "xvii-mpr-1998", 1998])).toBe(false);
    expect(sama(["TAP_MPR", "xvi-mpr-1998", 1998], ["TAP_MPR", "xvi-mpr-1999", 1999])).toBe(false);
  });

  it("Tap MPR: badan yang tak disebut cocok dengan badan apa pun, badan yang berbeda tidak", () => {
    expect(sama(["TAP_MPR", "I", 2003], ["TAP_MPR", "i-mpr-2003", 2003])).toBe(true);
    expect(sama(["TAP_MPR", "i-mprs-1960", 1960], ["TAP_MPR", "i-mpr-1960", 1960])).toBe(false);
  });

  it("nomor yang tak terurai dibandingkan sebagai huruf dan angka saja", () => {
    expect(sama(["UUD", "1945/P1", 1945], ["UUD", "1945-p1", 1945])).toBe(true);
    expect(sama(["UUD", "1945", 1945], ["UUD", "1945/P1", 1945])).toBe(false);
    expect(ringkasNomor("1945/P1")).toBe("1945p1");
  });
});

describe("nomorKanonik (nomor untuk baris baru dari BPK)", () => {
  it("Tap MPR ditulis seperti pasal.id", () => {
    expect(nomorKanonik("TAP_MPR", "XVI/MPR/1998")).toBe("xvi-mpr-1998");
    expect(nomorKanonik("TAP_MPR", "xvimpr1998")).toBe("xvi-mpr-1998");
    expect(nomorKanonik("TAP_MPR", "I")).toBe("I");
  });
  it("nomor lain dirapikan: spasi dibuang, nol di depan dibuang", () => {
    expect(nomorKanonik("PP", " 05 ")).toBe("5");
    expect(nomorKanonik("UU", "5 A")).toBe("5A");
    expect(nomorKanonik("UUD", "1945/P1")).toBe("1945/P1");
    expect(nomorKanonik("UU", "0")).toBe("0");
  });
});
