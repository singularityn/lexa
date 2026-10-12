/**
 * Salinan pihak ketiga di public/vendor (kini PDF.js): berkasnya tak boleh berubah diam-diam, dan harus punya lisensinya.
 * Daftar sha256 ada di SHA256SUMS (dibuat dari paket npm resmi; lihat README di folder itu untuk cara memperbaruinya).
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FOLDER = "public/vendor/pdfjs";
const daftar = readFileSync(`${FOLDER}/SHA256SUMS`, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((baris) => {
    const [hash, berkas] = baris.split(/\s+/);
    return { hash, berkas };
  });

describe("public/vendor/pdfjs", () => {
  it("memuat berkas yang dipakai penampil PDF, tak lebih", () => {
    expect(daftar.map((d) => d.berkas).sort()).toEqual([
      "pdf.min.mjs",
      "pdf.worker.min.mjs",
      "wasm/jbig2_nowasm_fallback.js",
      "wasm/openjpeg_nowasm_fallback.js",
    ]);
  });

  it.each(daftar)("$berkas sama dengan sha256 yang tercatat", async ({ hash, berkas }) => {
    const ringkas = await crypto.subtle.digest("SHA-256", readFileSync(`${FOLDER}/${berkas}`));
    expect([...new Uint8Array(ringkas)].map((b) => b.toString(16).padStart(2, "0")).join("")).toBe(hash);
  });

  it("lisensi Apache-2.0 PDF.js dan lisensi dekoder yang terbawa ikut disalin", () => {
    expect(readFileSync(`${FOLDER}/LICENSE`, "utf8")).toContain("Apache License");
    for (const lisensi of ["LICENSE_JBIG2", "LICENSE_OPENJPEG", "LICENSE_PDFJS_JBIG2", "LICENSE_PDFJS_OPENJPEG"]) {
      expect(existsSync(`${FOLDER}/wasm/${lisensi}`), lisensi).toBe(true);
    }
  });

  it("versinya sama dengan yang dinyatakan README dan tercantum di kepala berkas", () => {
    const inti = readFileSync(`${FOLDER}/pdf.min.mjs`, "utf8").slice(0, 3000);
    const versi = /pdfjsVersion = ([\d.]+)/.exec(inti)?.[1] ?? /(\d+\.\d+\.\d+)/.exec(inti)?.[1];
    expect(versi).toBeTruthy();
    expect(readFileSync(`${FOLDER}/README.md`, "utf8")).toContain(`pdfjs-dist ${versi}`);
  });

  it("tidak ikut precache service worker (2,3 MB hanya diunduh saat tab PDF dibuka)", async () => {
    const { hitungDaftar } = await import("../scripts/sw-daftar.mjs");
    const { url } = await hitungDaftar("public");
    expect(url.filter((u: string) => u.startsWith("/vendor/"))).toEqual([]);
  });
});
