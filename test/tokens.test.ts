import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Token warna di public/css/app.css dijaga kontrasnya (WCAG 2): teks 4,5:1 pada permukaan yang disebut catatannya,
 * batas kolom isian dan kontrol 3:1. Mengubah warna tanpa memeriksa kontras akan gagal di sini, bukan di mata pembaca.
 */

const css = readFileSync("public/css/app.css", "utf8");

/** Isi blok CSS yang diawali `pembuka` (sampai kurung kurawal penutup pertama; blok token tidak bersarang). */
function blok(pembuka: string): string {
  const i = css.indexOf(pembuka);
  if (i < 0) throw new Error(`blok tidak ditemukan: ${pembuka}`);
  return css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
}

function token(isi: string): Record<string, string> {
  const hasil: Record<string, string> = {};
  for (const m of isi.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) hasil[m[1]] = m[2].toLowerCase();
  return hasil;
}

/** Warna `rgba(r, g, b, a)` token fokus. */
function rgba(isi: string, nama: string): [number, number, number, number] {
  const m = new RegExp(`--${nama}:\\s*rgba\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*([0-9.]+)\\)`).exec(isi);
  if (!m) throw new Error(`${nama} bukan rgba() di blok ini`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}

/** Warna `fg` berlapis alfa `a` di atas `latar` (hex), sebagai hex. */
function lapis([r, g, b, a]: [number, number, number, number], latar: string): string {
  const dasar = [1, 3, 5].map((i) => parseInt(latar.slice(i, i + 2), 16));
  return `#${[r, g, b].map((c, i) => Math.round(a * c + (1 - a) * dasar[i]).toString(16).padStart(2, "0")).join("")}`;
}

const terang = token(blok(":root {"));
const gelap = token(blok(':root[data-tema="gelap"] {'));
const gelapOtomatis = token(blok(':root:not([data-tema="terang"]) {'));

function luminans(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const kontras = (a: string, b: string) => {
  const [terang1, gelap1] = [luminans(a), luminans(b)].sort((x, y) => y - x);
  return (terang1 + 0.05) / (gelap1 + 0.05);
};

const TEMA = { terang, gelap } as const;

describe("token warna", () => {
  it("tema gelap manual dan otomatis (prefers-color-scheme) bernilai sama", () => {
    expect(gelapOtomatis).toEqual(gelap);
    expect(rgba(blok(':root:not([data-tema="terang"]) {'), "fokus")).toEqual(rgba(blok(':root[data-tema="gelap"] {'), "fokus"));
  });

  it("kedua tema mendefinisikan token yang sama", () => {
    expect(Object.keys(gelap).sort()).toEqual(Object.keys(terang).sort());
  });

  describe.each(Object.entries(TEMA))("tema %s", (_nama, t) => {
    it.each([
      ["teks", "bg"], ["teks", "permukaan"], ["teks", "permukaan-2"],
      ["teks-redup", "bg"], ["teks-redup", "permukaan"], ["teks-redup", "permukaan-2"],
      ["aksen", "bg"], ["aksen", "permukaan"], ["aksen", "aksen-lembut"],
      ["teks", "aksen-lembut"], ["teks-redup", "aksen-lembut"],
      ["aksen-teks", "aksen"],
      ["berlaku-fg", "berlaku-bg"], ["dicabut-fg", "dicabut-bg"], ["diubah-fg", "diubah-bg"], ["netral-fg", "netral-bg"], ["tanda-fg", "tanda-bg"],
    ])("teks %s di atas %s: kontras minimal 4,5:1", (depan, latar) => {
      expect(kontras(t[depan], t[latar]), `${depan} ${t[depan]} di atas ${latar} ${t[latar]}`).toBeGreaterThanOrEqual(4.5);
    });

    it.each(["bg", "permukaan", "permukaan-2"])("batas kolom isian (garis-kontrol) terhadap %s: minimal 3:1", (latar) => {
      expect(kontras(t["garis-kontrol"], t[latar]), `garis-kontrol ${t["garis-kontrol"]} terhadap ${latar} ${t[latar]}`).toBeGreaterThanOrEqual(3);
    });
  });

  describe.each([["terang", ":root {", terang], ["gelap", ':root[data-tema="gelap"] {', gelap]] as const)("cincin fokus tema %s", (_nama, pembuka, t) => {
    const cincin = rgba(blok(pembuka), "fokus");
    it.each(["bg", "permukaan", "permukaan-2"])("cincin fokus di atas %s: minimal 3:1 (WCAG 1.4.11)", (latar) => {
      const efektif = lapis(cincin, t[latar]);
      expect(kontras(efektif, t[latar]), `fokus ${efektif} di atas ${latar} ${t[latar]}`).toBeGreaterThanOrEqual(3);
    });
  });

  it("kolom isian dan kontrol pilihan memakai garis-kontrol, bukan garis-kuat yang hanya pemisah", () => {
    expect(css).toMatch(/\.input, select\.input, textarea\.input \{[^}]*border: 1px solid var\(--garis-kontrol\)/);
    expect(css).toMatch(/\.segmen \{[^}]*border: 1px solid var\(--garis-kontrol\)/);
  });
});
