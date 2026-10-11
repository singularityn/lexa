import { describe, expect, it } from "vitest";
import { jenisDariSitasi, kelasJenis, kodePendek } from "../../public/js/komponen/jenis.js";

describe("jenis peraturan: kelas warna dan kode", () => {
  it.each([
    ["UU", "j-uu"],
    ["PP", "j-pp"],
    ["PERPPU", "j-perppu"],
    ["TAP_MPR", "j-tap"],
    ["tap mpr", "j-tap"],
    ["UUD", "j-uud"],
    ["PERPRES", "j-lain"],
    ["", "j-lain"],
    [null, "j-lain"],
  ])("kelasJenis(%j) = %s", (jenis, kelas) => {
    expect(kelasJenis(jenis)).toBe(kelas);
  });

  it("kodePendek muat di lingkaran kecil", () => {
    expect(kodePendek("UU")).toBe("UU");
    expect(kodePendek("PERPPU")).toBe("PPU");
    expect(kodePendek("TAP_MPR")).toBe("TAP");
    expect(kodePendek("PERMEN")).toBe("PER");
  });

  it.each([
    ["UU 13/2003", "UU"],
    ["PP 35/2021", "PP"],
    ["PERPPU 2/2022", "PERPPU"],
    ["TAP MPR 1/2003", "TAP_MPR"],
    ["UU 13/2003 Pasal 82", "UU"],
    ["Ketenagakerjaan", ""],
    ["", ""],
  ])("jenisDariSitasi(%j) = %j", (sitasi, jenis) => {
    expect(jenisDariSitasi(sitasi)).toBe(jenis);
  });
});
