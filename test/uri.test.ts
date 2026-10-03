import { describe, expect, it } from "vitest";
import { aliasUri, selesaikanUri, varianUri } from "../src/worker/lib/uri";

describe("aliasUri / varianUri", () => {
  it("menukar ejaan PERPPU dua arah", () => {
    expect(aliasUri("/akn/id/act/perppu/2022/2")).toBe("/akn/id/act/perpu/2022/2");
    expect(aliasUri("/akn/id/act/perpu/2022/2")).toBe("/akn/id/act/perppu/2022/2");
    expect(varianUri("/akn/id/act/perpu/2022/2")).toEqual(["/akn/id/act/perpu/2022/2", "/akn/id/act/perppu/2022/2"]);
  });

  it("jenis lain tidak punya alias, dan hanya segmen utuh yang ditukar", () => {
    for (const u of ["/akn/id/act/uu/2003/13", "/akn/id/act/pp/2021/35", "/akn/id/act/perpres/2021/12", "/akn/id/act/peraturan-ojk/2016/48-pojk-04-2016", "/akn/id/act/perpuxyz/2020/1"]) {
      expect(aliasUri(u), u).toBeNull();
      expect(varianUri(u), u).toEqual([u]);
    }
  });
});

describe("selesaikanUri", () => {
  /** D1 tiruan yang merekam jumlah parameter tiap kueri dan menjawab dengan `ada`. */
  function dbTiruan(ada: string[] = []) {
    const parameter: number[] = [];
    const db = {
      prepare: () => ({
        bind: (...p: string[]) => ({
          all: async () => {
            parameter.push(p.length);
            return { results: p.filter((u) => ada.includes(u)).map((frbr_uri) => ({ frbr_uri })) };
          },
        }),
      }),
    } as unknown as D1Database;
    return { db, parameter };
  }

  it("tanpa URI beralias database tidak disentuh sama sekali", async () => {
    const { db, parameter } = dbTiruan();
    const peta = await selesaikanUri(db, ["/akn/id/act/uu/2003/13", "/akn/id/act/pp/2021/35"]);
    expect(parameter).toEqual([]);
    expect([...peta]).toEqual([["/akn/id/act/uu/2003/13", "/akn/id/act/uu/2003/13"], ["/akn/id/act/pp/2021/35", "/akn/id/act/pp/2021/35"]]);
  });

  it("memilih ejaan yang ada: dirinya bila ada, kalau tidak aliasnya, kalau tidak dirinya sendiri", async () => {
    const { db } = dbTiruan(["/akn/id/act/perpu/2022/2", "/akn/id/act/perppu/2020/1", "/akn/id/act/perppu/2021/3", "/akn/id/act/perpu/2021/3"]);
    const peta = await selesaikanUri(db, [
      "/akn/id/act/perppu/2022/2", // hanya "perpu" yang ada -> alias
      "/akn/id/act/perpu/2020/1", //  hanya "perppu" yang ada -> alias
      "/akn/id/act/perppu/2021/3", // keduanya ada -> tetap dirinya
      "/akn/id/act/perppu/1999/9", // tak satu pun -> dirinya
    ]);
    expect(Object.fromEntries(peta)).toEqual({
      "/akn/id/act/perppu/2022/2": "/akn/id/act/perpu/2022/2",
      "/akn/id/act/perpu/2020/1": "/akn/id/act/perppu/2020/1",
      "/akn/id/act/perppu/2021/3": "/akn/id/act/perppu/2021/3",
      "/akn/id/act/perppu/1999/9": "/akn/id/act/perppu/1999/9",
    });
  });

  it("ratusan URI dipecah agar tak melampaui 100 parameter per kueri D1", async () => {
    const { db, parameter } = dbTiruan();
    const uris = Array.from({ length: 250 }, (_, i) => `/akn/id/act/perppu/2000/${i}`);
    const peta = await selesaikanUri(db, uris);
    expect(peta.size).toBe(250);
    expect(parameter.length).toBeGreaterThan(1);
    expect(Math.max(...parameter)).toBeLessThanOrEqual(100);
  });
});
