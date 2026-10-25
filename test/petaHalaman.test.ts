/**
 * Peta pasal ke halaman PDF (src/worker/lib/petaHalaman.ts): halaman tempat tiap pasal dimulai, dipulihkan dari penanda
 * "### Page n" dan dicocokkan dengan urutan pasal yang sudah terurai. Bentuk naskahnya meniru yang nyata: konversi bawaan tak
 * menandai halaman pertama dan menaruh kepala cetak ("PRESIDEN REPUBLIK INDONESIA- 2 -") di awal halaman berikutnya; bacaan Gemini
 * dimulai dengan "### Page 1".
 */
import { describe, expect, it } from "vitest";
import { nomorJudulPasal, uraikanPasal, VERSI_PARSER } from "../src/worker/lib/bpk";
import { petakanHalamanPasal } from "../src/worker/lib/petaHalaman";

const P = (n: number) => `\n\n\n\n### Page ${n}\n`;

/** Halaman tiap baris pasal terurai, sebagai pasangan "nomor[/ayat]:halaman". */
function peta(naskah: string): string[] {
  const pasal = uraikanPasal(naskah);
  const halaman = petakanHalamanPasal(naskah, pasal);
  expect(halaman).toHaveLength(pasal.length);
  return pasal.map((p, i) => `${p.nomor_pasal}${p.ayat ? `/${p.ayat}` : ""}:${halaman[i]}`);
}

describe("petakanHalamanPasal: konversi bawaan (halaman pertama tanpa penanda)", () => {
  const NASKAH = [
    "UNDANG-UNDANG REPUBLIK INDONESIA\nBAB I\nKETENTUAN UMUM\nPasal 1\nDalam Undang-Undang ini yang dimaksud dengan hal dasar adalah sesuatu.",
    `${P(2)}PRESIDEN\nREPUBLIK INDONESIA- 2 -Pasal 2\n(1) Setiap orang wajib menaati.\n(2) Pelanggar dikenai sanksi.\nPasal 3\nPemerintah mengatur lebih lanjut.`,
    `${P(3)}PRESIDEN\nREPUBLIK INDONESIA- 3 -BAB II\nPELAKSANAAN\nPasal 4\nPelaksanaan dilakukan bertahap.`,
  ].join("");

  it("pasal di halaman pertama berhalaman 1; yang sesudah penanda mengikuti penandanya; ayat satu pasal sehalaman", () => {
    expect(peta(NASKAH)).toEqual(["1:1", "2/1:2", "2/2:2", "3:2", "4:3"]);
  });

  it("kepala cetak yang menempel pada judul tak menghalangi judul dikenali", () => {
    // "REPUBLIK INDONESIA- 2 -Pasal 2" di atas: judul menempel pada nomor halaman cetak.
    expect(peta(NASKAH)[1]).toBe("2/1:2");
  });
});

describe("petakanHalamanPasal: bacaan Gemini (dimulai ### Page 1)", () => {
  it("halaman sesuai penanda, termasuk pasal yang baru dimulai di dasar halaman", () => {
    const naskah = `### Page 1\nBAB I\nKETENTUAN UMUM\nPasal 1\nIsi satu.\n\n### Page 2\nPasal 2\nIsi dua.\n\n### Page 3\nIsi dua lanjutan.\nPasal 3\nIsi tiga.\n\n### Page 4\nIsi tiga lanjutan.`;
    expect(peta(naskah)).toEqual(["1:1", "2:2", "3:3"]);
  });
});

describe("petakanHalamanPasal: ketahanan", () => {
  it("tanpa penanda halaman sama sekali: semuanya null, bukan halaman 1 yang menyesatkan", () => {
    const naskah = "Pasal 1\nIsi satu.\nPasal 2\nIsi dua.";
    expect(peta(naskah)).toEqual(["1:null", "2:null"]);
  });

  it("tanpa pasal terurai: larik kosong", () => {
    expect(petakanHalamanPasal(`Teks tanpa pasal${P(2)}Lanjutan`, [])).toEqual([]);
  });

  it("rujukan 'Pasal 5 ayat (2)...' di awal baris halaman lain bukan judul: halaman Pasal 5 tetap yang sebenarnya", () => {
    const naskah = [
      "Pasal 4\nIsi empat.",
      `${P(2)}Pasal 5 ayat (2) berlaku juga bagi hal ini.\nPasal 5\nIsi lima.`,
    ].join("");
    // Pasal 5 ayat (2) pada awal halaman 2 dianggap sambungan isi Pasal 4 oleh pengurai; judul Pasal 5 yang sebenarnya juga di halaman 2.
    expect(peta(naskah)).toEqual(["4:1", "5:2"]);
  });

  it("judul yang tak ditemukan di halaman mana pun mengikuti halaman pasal sebelumnya", () => {
    // "Pasal 2" tertulis terpotong ("Pasa l 2") sehingga tak dikenal pengurai dan tak ada di urutan: hanya 1 dan 3 terurai.
    const naskah = `Pasal 1\nSatu.${P(2)}Pasa l 2\nDua.${P(3)}Pasal 3\nTiga.`;
    expect(peta(naskah)).toEqual(["1:1", "3:3"]);
  });

  it("pasal yang terurai tetapi judulnya tak cocok urutan di teks halaman (mis. nomor salah baca) ikut halaman sebelumnya", () => {
    const pasal = [
      { nomor_pasal: "1" },
      { nomor_pasal: "2" },
      { nomor_pasal: "3" },
    ];
    // Teks halaman 2 hanya memuat judul Pasal 3: Pasal 2 mengikuti Pasal 1 (halaman 1), Pasal 3 di halaman 2.
    const naskah = `Pasal 1\nSatu.${P(2)}Pasal 3\nTiga.`;
    expect(petakanHalamanPasal(naskah, pasal)).toEqual([1, 1, 2]);
  });

  it("Penjelasan memakai ulang nomor pasal tetapi tak menggeser halaman batang tubuh", () => {
    const naskah = [
      "Pasal 1\nSatu.",
      `${P(2)}Pasal 2\nDua.`,
      `${P(3)}PENJELASAN\nATAS UNDANG-UNDANG\nPasal 1\nCukup jelas.`,
      `${P(4)}Pasal 2\nCukup jelas.`,
    ].join("");
    expect(peta(naskah)).toEqual(["1:1", "2:2"]);
  });

  it("batang tubuh berhenti di judul Penjelasan atau 'PASAL DEMI PASAL': judul yang hanya ada di sana tak menggeser halaman", () => {
    const pasal = [{ nomor_pasal: "1" }, { nomor_pasal: "2" }];
    expect(petakanHalamanPasal(`Pasal 1\nSatu.${P(2)}PENJELASAN\nPasal 2\nCukup jelas.`, pasal)).toEqual([1, 1]);
    expect(petakanHalamanPasal(`Pasal 1\nSatu.${P(2)}PASAL DEMI PASAL\nPasal 2\nCukup jelas.`, pasal)).toEqual([1, 1]);
  });

  it("nomor yang sama di dua tempat (peraturan pengubah) dipetakan menurut urutan, bukan kemunculan pertama", () => {
    const pasal = [{ nomor_pasal: "1" }, { nomor_pasal: "2" }, { nomor_pasal: "1" }];
    const naskah = `Pasal 1\nSatu.${P(2)}Pasal 2\nDua.${P(3)}Pasal 1\nSatu lagi.`;
    expect(petakanHalamanPasal(naskah, pasal)).toEqual([1, 2, 3]);
  });

  it("nomor berakhiran huruf dan angka romawi dikenali", () => {
    const naskah = `Pasal I\nSatu.${P(2)}Pasal 5A\nLima A.${P(3)}Pasal 10\nSepuluh.`;
    const pasal = [{ nomor_pasal: "I" }, { nomor_pasal: "5A" }, { nomor_pasal: "10" }];
    expect(petakanHalamanPasal(naskah, pasal)).toEqual([1, 2, 3]);
  });

  it("judul yang menempel pada ujung kalimat sebelumnya ('kepentingan masyarakat.Pasal 5') tetap ditemukan", () => {
    const naskah = `Pasal 4\nUntuk kepentingan masyarakat.Pasal 5\nIsi lima.${P(2)}Pasal 6\nIsi enam.`;
    expect(peta(naskah)).toEqual(["4:1", "5:1", "6:2"]);
  });
});

describe("petakanHalamanPasal: ketepatan pencocokan", () => {
  it("sisa rujukan silang bertitik ('Pasal 5.') sesudah judul Pasal 5 tak memindahkan halamannya: yang dicari nomor berikutnya, bukan yang sudah cocok", () => {
    // Pengurai menolak "Pasal 5." sebagai judul (nomornya bukan lanjutan dan kalimat sebelumnya menggantung), tetapi baris itu sendiri
    // tampak seperti judul bertitik; pemeta tak boleh mencocokkannya lagi dengan Pasal 5 yang sudah ditemukan di halaman 1.
    const naskah = `Pasal 5\nBunyi pasal lima sebagaimana dimaksud dalam${P(2)}Pasal 5.\nTentang hal lain.\nPasal 6\nIsi enam yang cukup panjang.`;
    const pasal = uraikanPasal(naskah);
    expect(pasal.map((p) => p.nomor_pasal)).toEqual(["5", "6"]);
    expect(petakanHalamanPasal(naskah, pasal)).toEqual([1, 2]);
  });

  it("pasal berayat banyak tak menghabiskan jendela pencarian: pasal sesudahnya tetap di halamannya sendiri", () => {
    const ayat = Array.from({ length: 9 }, (_, i) => `(${i + 1}) Ketentuan ayat ke-${i + 1} yang cukup panjang.`).join("\n");
    const naskah = `Pasal 1\n${ayat}${P(2)}Pasal 2\nIsi dua yang cukup panjang.`;
    const pasal = uraikanPasal(naskah);
    expect(pasal).toHaveLength(10);
    expect(petakanHalamanPasal(naskah, pasal)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 2]);
  });

  it("versi pengurai memuat peta halaman (5 atau lebih): peraturan lama ditawarkan ke uraian ulang", () => {
    expect(VERSI_PARSER).toBeGreaterThanOrEqual(5);
  });
});

describe("nomorJudulPasal (judul pasal menurut aturan pengurai)", () => {
  it("judul bernomor, berakhiran huruf, romawi, dan yang menempel pada isinya diterima dalam bentuk rapi", () => {
    expect(nomorJudulPasal("Pasal 5")).toBe("5");
    expect(nomorJudulPasal("PASAL 5A")).toBe("5A");
    expect(nomorJudulPasal("## Pasal 12")).toBe("12");
    expect(nomorJudulPasal("Pasal I")).toBe("I");
    expect(nomorJudulPasal("Pasal 1Dalam Undang-Undang ini")).toBe("1");
    expect(nomorJudulPasal("Pasal 2(1) Setiap orang")).toBe("2");
    expect(nomorJudulPasal("Pasal 1O")).toBe("10"); // nol yang terbaca huruf O
  });

  it("judul gaya lama bertitik tunggal diterima, tetapi catchword kaki halaman tidak", () => {
    expect(nomorJudulPasal("Pasal 1.")).toBe("1");
    expect(nomorJudulPasal("Pasal 15 . . .")).toBeNull();
    expect(nomorJudulPasal("Pasal 15…")).toBeNull();
  });

  it("ujung rujukan silang yang terpotong baris bukan judul: 'Pasal 2 ayat (2) ...', 'Pasal 9; dan/atau', 'Pasal 48, Pasal 87'", () => {
    expect(nomorJudulPasal("Pasal 2 ayat (2) terdiri atas:")).toBeNull();
    expect(nomorJudulPasal("Pasal 9; dan/atau")).toBeNull();
    expect(nomorJudulPasal("Pasal 48, Pasal 87, dan Pasal 90")).toBeNull();
  });

  it("baris yang bukan judul pasal sama sekali", () => {
    expect(nomorJudulPasal("Dalam Pasal 5 ditentukan")).toBeNull();
    expect(nomorJudulPasal("")).toBeNull();
    expect(nomorJudulPasal("BAB I")).toBeNull();
  });
});
