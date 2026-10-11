/**
 * Cakupan peraturan (src/shared/cakupan.ts): pembacaan variabel, pengenalan jenis dari URI, dan klausa SQL.
 * Perilaku di seluruh aplikasi (pencarian, telusur, ingest, impor) diuji di test/integration/cakupan.test.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  bacaCakupan, CAKUPAN_BAWAAN, dalamCakupan, jenisDariUri, klausaCakupan, uriJelasDiLuarCakupan,
} from "../src/shared/cakupan";
import { CRON_HARIAN, CRON_MENIT } from "../src/worker/lib/jadwal";

describe("bacaCakupan", () => {
  it("tanpa variabel: daftar bawaan (UUD, Tap MPR, UU, Perppu, PP)", () => {
    expect(CAKUPAN_BAWAAN).toEqual(["UUD", "TAP_MPR", "UU", "PERPPU", "PP"]);
    expect(bacaCakupan(undefined)).toEqual(CAKUPAN_BAWAAN);
    expect(bacaCakupan(null)).toEqual(CAKUPAN_BAWAAN);
  });

  it("membaca daftar berpemisah koma, merapikan huruf, spasi, dan strip, dan membuang yang kembar", () => {
    expect(bacaCakupan("UU,PP")).toEqual(["UU", "PP"]);
    expect(bacaCakupan(" uu , pp ,PERPRES, uu")).toEqual(["UU", "PP", "PERPRES"]);
    expect(bacaCakupan("tap mpr,tap-mpr")).toEqual(["TAP_MPR"]);
    expect(bacaCakupan("UU,,PP,")).toEqual(["UU", "PP"]);
  });

  it("nilai kosong atau meragukan jatuh ke bawaan, bukan daftar kosong yang menyembunyikan semuanya", () => {
    for (const nilai of ["", "  ", ",", "UU;PP", "UU,PP'--", "UU,1", "UU,PP)", "'", "UU PP)"]) {
      expect(bacaCakupan(nilai), JSON.stringify(nilai)).toEqual(CAKUPAN_BAWAAN);
    }
  });

  it("wrangler.jsonc memuat daftar yang sama dengan bawaan di kode, dan sah", () => {
    const berkas = readFileSync("wrangler.jsonc", "utf8");
    const nilai = /^\s*"CAKUPAN_JENIS"\s*:\s*"([^"]*)"/m.exec(berkas)?.[1];
    expect(nilai, "wrangler.jsonc harus menyetel vars.CAKUPAN_JENIS").toBeTruthy();
    expect(nilai).toBe(CAKUPAN_BAWAAN.join(","));
    expect(bacaCakupan(nilai)).toEqual(CAKUPAN_BAWAAN);
  });
});

describe("dalamCakupan", () => {
  it("memeriksa kode jenis seperti kolom laws.jenis", () => {
    for (const j of ["UUD", "TAP_MPR", "UU", "PERPPU", "PP"]) expect(dalamCakupan(CAKUPAN_BAWAAN, j), j).toBe(true);
    for (const j of ["PERPRES", "KEPPRES", "INPRES", "PERMEN", "KEPMEN", "POJK", "PBI", "PERDA_PROV", "PERDA_KAB", "PERGUB", "uu", "", "LAIN"]) {
      expect(dalamCakupan(CAKUPAN_BAWAAN, j), j).toBe(false);
    }
    expect(dalamCakupan(CAKUPAN_BAWAAN, null)).toBe(false);
    expect(dalamCakupan(CAKUPAN_BAWAAN, undefined)).toBe(false);
  });

  it("mengikuti cakupan yang diberikan", () => {
    expect(dalamCakupan(["UU", "PERPRES"], "PERPRES")).toBe(true);
    expect(dalamCakupan(["UU", "PERPRES"], "PP")).toBe(false);
  });
});

describe("jenisDariUri", () => {
  it("membaca kode jenis dari segmen FRBR URI, dengan ejaan PERPU disatukan dengan PERPPU", () => {
    const kasus: Array<[string, string]> = [
      ["/akn/id/act/uu/2003/13", "UU"],
      ["/akn/id/act/pp/2021/35", "PP"],
      ["/akn/id/act/perpu/2022/2", "PERPPU"],
      ["/akn/id/act/perppu/2022/2", "PERPPU"],
      ["/akn/id/act/tap-mpr/1998/16", "TAP_MPR"],
      ["/akn/id/act/uud/1945/1945", "UUD"],
      ["/akn/id/act/perpres/2020/1", "PERPRES"],
      ["/akn/id/act/peraturan-ojk/2019/1-pojk-04-2019", "PERATURAN_OJK"],
      ["/akn/id/act/permenkeu/2021/10", "PERMENKEU"],
      ["/akn/id/act/uu/2003/13#pasal-82-ayat-1", "UU"],
    ];
    for (const [uri, kode] of kasus) expect(jenisDariUri(uri), uri).toBe(kode);
  });

  it("null untuk yang bukan FRBR URI peraturan", () => {
    for (const uri of ["", "uu/2003/13", "/akn/id/act/uu", "/akn/id/act/uu/abc/13", "/akn/id/act//2003/13", "https://x.test/akn/id/act/uu/2003/13", "/api/laws"]) {
      expect(jenisDariUri(uri), uri).toBeNull();
    }
  });
});

describe("uriJelasDiLuarCakupan", () => {
  it("jelas di luar cakupan: segmen baku jenis yang tidak dicakup", () => {
    for (const uri of [
      "/akn/id/act/perpres/2020/1", "/akn/id/act/keppres/2000/1", "/akn/id/act/inpres/2005/4", "/akn/id/act/permen/2025/29",
      "/akn/id/act/kepmen/2010/1", "/akn/id/act/pojk/2016/48", "/akn/id/act/pbi/2020/3", "/akn/id/act/perda-prov/2007/8",
      "/akn/id/act/perda-kab/2007/8", "/akn/id/act/pergub/2012/3", "/akn/id/act/perbup/2012/3", "/akn/id/act/perwali/2012/3",
    ]) expect(uriJelasDiLuarCakupan(CAKUPAN_BAWAAN, uri), uri).toBe(true);
  });

  it("tidak jelas di luar cakupan: UUD, Tap MPR, UU, Perppu (kedua ejaan), dan PP", () => {
    for (const uri of [
      "/akn/id/act/uud/1945/1945", "/akn/id/act/tap-mpr/1998/16", "/akn/id/act/uu/2003/13",
      "/akn/id/act/perpu/2022/2", "/akn/id/act/perppu/2022/2", "/akn/id/act/pp/2021/35",
    ]) expect(uriJelasDiLuarCakupan(CAKUPAN_BAWAAN, uri), uri).toBe(false);
  });

  it("segmen yang tak baku dan URI yang tak dikenal TIDAK dianggap jelas di luar (barisnya yang menentukan)", () => {
    // Bentuk di produksi: POJK memakai "peraturan-ojk", PERMEN tersebar pada puluhan segmen.
    for (const uri of [
      "/akn/id/act/peraturan-ojk/2019/1-pojk-04-2019", "/akn/id/act/permenkeu/2021/10", "/akn/id/act/mk/2023/7",
      "/akn/id/act/pkpu/2018/2", "/akn/id/act/perpang-tni/2019/1", "", "bukan uri", "/akn/id/act/uu/abc/13",
    ]) expect(uriJelasDiLuarCakupan(CAKUPAN_BAWAAN, uri), uri).toBe(false);
  });

  it("mengikuti cakupan yang diberikan", () => {
    expect(uriJelasDiLuarCakupan(["UU", "PERPRES"], "/akn/id/act/perpres/2020/1")).toBe(false);
    expect(uriJelasDiLuarCakupan(["UU", "PERPRES"], "/akn/id/act/pp/2021/35")).toBe(true);
    expect(uriJelasDiLuarCakupan([], "/akn/id/act/uu/2003/13")).toBe(true);
  });
});

describe("klausaCakupan", () => {
  it("menulis kode jenis langsung di SQL (bukan parameter), untuk kolom yang diminta", () => {
    expect(klausaCakupan(CAKUPAN_BAWAAN, "l.jenis")).toBe("l.jenis IN ('UUD','TAP_MPR','UU','PERPPU','PP')");
    expect(klausaCakupan(["UU"], "jenis")).toBe("jenis IN ('UU')");
  });

  it("cakupan kosong menghasilkan klausa yang tak pernah benar", () => {
    expect(klausaCakupan([], "jenis")).toBe("0");
  });

  it("menolak kode yang bisa menyelipkan SQL", () => {
    expect(() => klausaCakupan(["UU'; DROP TABLE laws; --"], "jenis")).toThrow();
    expect(() => klausaCakupan(["uu"], "jenis")).toThrow();
    expect(() => klausaCakupan(["UU", "P P"], "jenis")).toThrow();
  });
});

describe("jadwal Cron dan cadangan tik di wrangler.jsonc", () => {
  const berkas = readFileSync("wrangler.jsonc", "utf8");

  it("pemicu di wrangler.jsonc sama persis dengan konstanta di kode (event.cron dibandingkan karakter demi karakter)", () => {
    const crons = /"crons"\s*:\s*\[([^\]]*)\]/.exec(berkas)?.[1];
    expect(crons, "wrangler.jsonc harus menyetel triggers.crons").toBeTruthy();
    const daftar = [...(crons ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(daftar).toEqual([CRON_MENIT, CRON_HARIAN]);
  });

  it("vars.TIK_CADANGAN diaktifkan di produksi dengan nilai yang dikenal kode", () => {
    expect(/^\s*"TIK_CADANGAN"\s*:\s*"antrean"/m.test(berkas)).toBe(true);
  });
});
