/**
 * Pengenalan judul pasal pada teks halaman PDF (public/js/pdfPasal.js): dasar tombol "Lihat di PDF". Murni, tanpa DOM
 * dan tanpa PDF.js; pemindaian PDF sungguhan diuji di e2e/penampil-pdf.test.mjs.
 */
import { describe, expect, it } from "vitest";
import { barisDariItem, catatPasalHalaman, nomorDariJudulPasal, pasalDiHalaman } from "../public/js/pdfPasal.js";

const item = (str: string, hasEOL = false) => ({ str, hasEOL });

describe("nomorDariJudulPasal", () => {
  it("judul pasal yang berdiri sendiri di satu baris", () => {
    expect(nomorDariJudulPasal("Pasal 156")).toBe("156");
    expect(nomorDariJudulPasal("PASAL 82")).toBe("82");
    expect(nomorDariJudulPasal("  pasal   7  ")).toBe("7");
    expect(nomorDariJudulPasal("Pasal 1")).toBe("1");
  });

  it("akhiran huruf dirapikan seperti nomor di D1: '5 a' dan '5A' sama", () => {
    expect(nomorDariJudulPasal("Pasal 5A")).toBe("5A");
    expect(nomorDariJudulPasal("Pasal 5 a")).toBe("5A");
    expect(nomorDariJudulPasal("PASAL 12 B")).toBe("12B");
  });

  it("angka Romawi (undang-undang perubahan: Pasal I, Pasal II)", () => {
    expect(nomorDariJudulPasal("Pasal I")).toBe("I");
    expect(nomorDariJudulPasal("PASAL XIV")).toBe("XIV");
  });

  it("nol yang terbaca huruf O oleh OCR dirapikan seperti di data: 'Pasal 1O' adalah Pasal 10", () => {
    expect(nomorDariJudulPasal("Pasal 1O")).toBe("10");
    expect(nomorDariJudulPasal("PASAL 15O")).toBe("150");
  });

  it("rujukan di tengah kalimat bukan judul: sebuah judul tak diikuti kata lain", () => {
    for (const baris of [
      "sebagaimana dimaksud dalam Pasal 156",
      "Pasal 156 ayat (2) berlaku",
      "Pasal 156 dan Pasal 157",
      "Pasal 156 mengatur",
      "Pasal",
      "Pasal ini",
      "Pasal 12345",
      "",
      "156",
    ]) {
      expect(nomorDariJudulPasal(baris), baris).toBeNull();
    }
  });
});

describe("barisDariItem", () => {
  it("menyambung item sampai tanda akhir baris, merapikan spasi, dan melewati penanda isi", () => {
    expect(barisDariItem([item("Pasal"), item(" 156", true), { hasEOL: false }, item("Dalam  hal ", false), item("terjadi", true), item("")])).toEqual([
      "Pasal 156",
      "Dalam hal terjadi",
    ]);
  });

  it("sisa tanpa akhir baris tetap menjadi baris terakhir; baris kosong dibuang", () => {
    expect(barisDariItem([item("a", true), item("   ", true), item("b")])).toEqual(["a", "b"]);
    expect(barisDariItem([])).toEqual([]);
  });
});

describe("pasalDiHalaman", () => {
  it("memakai tanda akhir baris bila ada", () => {
    expect(pasalDiHalaman([item("Pasal 1", true), item("Ketentuan umum.", true), item("Pasal 2", true)])).toEqual(["1", "2"]);
  });

  it("judul yang menjadi item tersendiri terbaca walau PDF-nya tak menandai akhir baris (semua item menyambung)", () => {
    expect(pasalDiHalaman([item("UNDANG-UNDANG"), item("Pasal 3"), item("Setiap orang wajib."), item("Pasal 4")])).toEqual(["3", "4"]);
  });

  it("tak menggandakan nomor yang sama, dan mengabaikan rujukan di dalam kalimat", () => {
    expect(pasalDiHalaman([item("Pasal 5", true), item("Pasal 5", true), item("sebagaimana dimaksud dalam Pasal 9", true)])).toEqual(["5"]);
  });

  it("halaman tanpa teks (pindaian) tidak menghasilkan apa pun", () => {
    expect(pasalDiHalaman([])).toEqual([]);
  });
});

describe("catatPasalHalaman", () => {
  it("mencatat halaman pertama tiap pasal; penjelasan yang memakai ulang nomor tak menggesernya", () => {
    const indeks = new Map<string, number>();
    expect(catatPasalHalaman(indeks, 1, [item("Pasal 1", true), item("Pasal 2", true)])).toBe(2);
    expect(catatPasalHalaman(indeks, 6, [item("Pasal 82", true)])).toBe(1);
    // Penjelasan di halaman 12: Pasal 1 dan 82 muncul lagi, tak mengubah catatan, dan tak dihitung baru.
    expect(catatPasalHalaman(indeks, 12, [item("PENJELASAN", true), item("Pasal 1", true), item("Pasal 82", true), item("Pasal 83", true)])).toBe(1);
    expect([...indeks]).toEqual([["1", 1], ["2", 1], ["82", 6], ["83", 12]]);
  });
});
