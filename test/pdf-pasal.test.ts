/**
 * Pengenalan judul pasal pada teks halaman PDF (public/js/pdfPasal.js): dasar tombol "Lihat di PDF". Murni, tanpa DOM
 * dan tanpa PDF.js; pemindaian PDF sungguhan diuji di e2e/penampil-pdf.test.mjs.
 */
import { describe, expect, it } from "vitest";
import {
  adalahJudulPenjelasan, bandingkanNomorPasal, bandingkanPasal, barisDariItem, catatHalamanBadan, catatPasalHalaman, nomorDariJudulPasal,
  pasalDiHalaman, pindaiHalaman,
} from "../public/js/pdfPasal.js";

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

describe("adalahJudulPenjelasan", () => {
  it("judul bagian penjelasan berhuruf besar, seperti yang dikenali pengurai di server", () => {
    for (const baris of ["PENJELASAN", "  PENJELASAN  ", "PENJELASAN ATAS UNDANG-UNDANG NOMOR 13 TAHUN 2003", "P E N J E L A S A N", "PASAL DEMI PASAL"]) {
      expect(adalahJudulPenjelasan(baris), baris).toBe(true);
    }
  });

  it("kata 'penjelasan' di dalam kalimat atau berhuruf kecil bukan judul bagiannya", () => {
    for (const baris of ["Penjelasan", "penjelasan ayat ini.", "Penjelasan Pasal 3", "PENJELASAN UMUM", "Lihat PENJELASAN", "Pasal demi pasal", "PASAL DEMI PASAL 5"]) {
      expect(adalahJudulPenjelasan(baris), baris).toBe(false);
    }
  });
});

describe("pindaiHalaman", () => {
  it("mengembalikan nomor pasal menurut urutan kemunculan, tanpa penjelasan bila judul penjelasan tak ada", () => {
    expect(pindaiHalaman([item("Pasal 1", true), item("Ketentuan umum.", true), item("Pasal 2", true)])).toEqual({ pasal: ["1", "2"], penjelasan: false });
  });

  it("berhenti di judul penjelasan: pasal sebelum judul dihitung, sesudahnya tidak", () => {
    const hasil = pindaiHalaman([item("Pasal 9", true), item("Isi pasal sembilan.", true), item("PENJELASAN", true), item("Pasal 1", true), item("Cukup jelas.", true), item("Pasal 9", true)]);
    expect(hasil).toEqual({ pasal: ["9"], penjelasan: true });
  });

  it("judul penjelasan yang menjadi item tersendiri tanpa tanda akhir baris pun dikenali, seperti judul pasal", () => {
    expect(pindaiHalaman([item("Pasal 3"), item("PASAL DEMI PASAL"), item("Pasal 3")])).toEqual({ pasal: ["3"], penjelasan: true });
  });

  it("halaman pertama penjelasan yang tidak memuat pasal sama sekali, dan halaman kosong", () => {
    expect(pindaiHalaman([item("PENJELASAN ATAS UNDANG-UNDANG", true), item("I. UMUM", true)])).toEqual({ pasal: [], penjelasan: true });
    expect(pindaiHalaman([])).toEqual({ pasal: [], penjelasan: false });
  });
});

describe("catatHalamanBadan", () => {
  it("hanya batang tubuh: pasal yang cuma ada di penjelasan tidak dicatat, dan penjelasan dilaporkan", () => {
    const indeks = new Map<string, number>();
    expect(catatHalamanBadan(indeks, 1, [item("Pasal 1", true), item("Pasal 2", true)])).toEqual({ baru: 2, penjelasan: false });
    expect(catatHalamanBadan(indeks, 5, [item("Pasal 3", true), item("PENJELASAN", true), item("Pasal 4", true)])).toEqual({ baru: 1, penjelasan: true });
    expect([...indeks]).toEqual([["1", 1], ["2", 1], ["3", 5]]);
  });
});

describe("bandingkanNomorPasal", () => {
  it("urutan alami: angka menurut nilai, sisipan huruf sesudah angkanya, Romawi sesudah angka", () => {
    expect(["10", "2", "2A", "1", "II", "I", "2B", "XIV", "9"].sort(bandingkanNomorPasal)).toEqual(["1", "2", "2A", "2B", "9", "10", "I", "II", "XIV"]);
  });
});

describe("bandingkanPasal", () => {
  it("memisahkan yang hanya ada di PDF, yang hanya ada di Lexa, dan yang sama", () => {
    const h = bandingkanPasal(["1", "2", "3", "45A", "10"], ["1", "2", "3", "7"]);
    expect(h).toEqual({ pdf: 5, lexa: 4, sama: 3, hanyaPdf: ["10", "45A"], hanyaLexa: ["7"] });
  });

  it("nomor Lexa dibaca tanpa peduli huruf besar-kecil; yang tak lazim (bukan nomor pasal) tak ikut dibandingkan", () => {
    const h = bandingkanPasal(["5A", "6"], ["5a", "6", "Umum", "", "ayat", "12345"]);
    expect(h).toEqual({ pdf: 2, lexa: 2, sama: 2, hanyaPdf: [], hanyaLexa: [] });
  });

  it("Lexa tanpa pasal: seluruh judul di PDF dilaporkan terlewat; PDF tanpa judul: seluruh pasal Lexa tak tampak", () => {
    expect(bandingkanPasal(["1", "2"], [])).toMatchObject({ lexa: 0, sama: 0, hanyaPdf: ["1", "2"], hanyaLexa: [] });
    expect(bandingkanPasal([], ["1", "2"])).toMatchObject({ pdf: 0, sama: 0, hanyaPdf: [], hanyaLexa: ["1", "2"] });
  });

  it("undang-undang perubahan (Romawi) dibandingkan sama seperti angka", () => {
    expect(bandingkanPasal(["I", "II", "III"], ["I", "II"])).toMatchObject({ hanyaPdf: ["III"], hanyaLexa: [] });
  });
});
