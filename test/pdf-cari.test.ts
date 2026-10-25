/**
 * Pencarian di dalam PDF (public/js/pdfCari.js) dan rumus penampil (public/js/pdfZoom.js: gestur zoom, halaman yang terlihat):
 * murni, tanpa DOM dan PDF.js. Pemindaian dan penandaan di lapisan teks diuji di e2e/penampil-pdf.test.mjs.
 */
import { describe, expect, it } from "vitest";
import { bangunTeksHalaman, cariDiHalaman, itemDariTeks, itemDiLetak, MAKS_KECOCOKAN, polaCari, rentangItem } from "../public/js/pdfCari.js";
import { halamanTerlihat, indeksPertamaDi, jarakSentuh, jepit, ketukDua, rasioCubit } from "../public/js/pdfZoom.js";

const item = (str: string, hasEOL = false) => ({ str, hasEOL });

describe("bangunTeksHalaman", () => {
  it("menempel item apa adanya, baris baru sesudah item berakhir baris, dan mencatat letak awal tiap item", () => {
    const h = bangunTeksHalaman([item("Pasal"), item(" "), item("156", true), item("Dalam hal", true)]);
    expect(h.teks).toBe("Pasal 156\nDalam hal\n");
    expect(h.awal).toEqual([0, 5, 6, 10]);
    expect(h.bagian).toEqual(["Pasal", " ", "156", "Dalam hal"]);
    expect(h.akhirBaris).toEqual([false, false, true, true]);
  });

  it("itemDariTeks mengembalikan item (str dan hasEOL) untuk pengenal judul pasal, tanpa membaca ulang PDF", () => {
    const h = bangunTeksHalaman([item("Pasal 7", true), item("Isi."), item("", true)]);
    expect(itemDariTeks(h)).toEqual([
      { str: "Pasal 7", hasEOL: true },
      { str: "Isi.", hasEOL: false },
      { str: "", hasEOL: true },
    ]);
  });

  it("item penanda isi (tanpa str) dilewati dan tak menggeser indeks", () => {
    const h = bangunTeksHalaman([{ hasEOL: false }, item("a"), { str: undefined }, item("b", true)]);
    expect(h.bagian).toEqual(["a", "b"]);
    expect(h.awal).toEqual([0, 1]);
    expect(h.teks).toBe("ab\n");
  });

  it("halaman tanpa teks menghasilkan teks kosong", () => {
    expect(bangunTeksHalaman([])).toEqual({ teks: "", awal: [], bagian: [], akhirBaris: [] });
  });
});

describe("polaCari dan cariDiHalaman", () => {
  const halaman = bangunTeksHalaman([item("Pekerja perempuan berhak", true), item("memperoleh istirahat.", true), item("PEKERJA lain (1) tidak.", true)]);

  it("tak peduli huruf besar-kecil, dan menemukan semua kemunculan menurut urutannya", () => {
    const pola = polaCari("pekerja");
    expect(pola).not.toBeNull();
    const hasil = cariDiHalaman(halaman, pola!);
    expect(hasil.map((r) => halaman.teks.slice(r.mulai, r.akhir))).toEqual(["Pekerja", "PEKERJA"]);
  });

  it("spasi pada kueri cocok dengan baris baru di PDF: frasa yang terpotong baris tetap ditemukan", () => {
    const hasil = cariDiHalaman(halaman, polaCari("perempuan berhak memperoleh")!);
    expect(hasil).toHaveLength(1);
    expect(halaman.teks.slice(hasil[0].mulai, hasil[0].akhir)).toBe("perempuan berhak\nmemperoleh");
  });

  it("tanda regex di kueri diperlakukan sebagai huruf biasa", () => {
    expect(cariDiHalaman(halaman, polaCari("lain (1)")!)).toHaveLength(1);
    expect(cariDiHalaman(halaman, polaCari("a.b")!)).toHaveLength(0);
    expect(cariDiHalaman(halaman, polaCari("[x")!)).toHaveLength(0);
  });

  it("kueri kosong atau satu karakter tak dicari; spasi berlebih dirapikan", () => {
    expect(polaCari("")).toBeNull();
    expect(polaCari("  ")).toBeNull();
    expect(polaCari("a")).toBeNull();
    expect(cariDiHalaman(halaman, polaCari("  pekerja   perempuan ")!)).toHaveLength(1);
  });

  it("pola yang dipakai ulang mulai dari awal (lastIndex tak bocor antar halaman)", () => {
    const pola = polaCari("pekerja")!;
    expect(cariDiHalaman(halaman, pola)).toHaveLength(2);
    expect(cariDiHalaman(halaman, pola)).toHaveLength(2);
  });

  it("jumlah kecocokan dibatasi", () => {
    const banyak = bangunTeksHalaman([item("ab ".repeat(MAKS_KECOCOKAN + 50))]);
    expect(cariDiHalaman(banyak, polaCari("ab")!)).toHaveLength(MAKS_KECOCOKAN);
    expect(MAKS_KECOCOKAN).toBe(1000);
    expect(cariDiHalaman(banyak, polaCari("ab")!, 3)).toHaveLength(3);
  });
});

describe("itemDiLetak dan rentangItem", () => {
  const halaman = bangunTeksHalaman([item("Pasal"), item(" "), item("156", true), item("Dalam hal", true)]);

  it("pencarian biner menemukan item pemilik karakter, termasuk di batas", () => {
    expect(itemDiLetak(halaman.awal, 0)).toBe(0);
    expect(itemDiLetak(halaman.awal, 4)).toBe(0);
    expect(itemDiLetak(halaman.awal, 5)).toBe(1);
    expect(itemDiLetak(halaman.awal, 6)).toBe(2);
    expect(itemDiLetak(halaman.awal, 8)).toBe(2);
    expect(itemDiLetak(halaman.awal, 10)).toBe(3);
    expect(itemDiLetak(halaman.awal, 999)).toBe(3);
    expect(itemDiLetak([], 0)).toBe(-1);
    expect(itemDiLetak(halaman.awal, -1)).toBe(-1);
  });

  it("kecocokan di dalam satu item", () => {
    const r = cariDiHalaman(halaman, polaCari("hal")!)[0];
    expect(rentangItem(halaman, r)).toEqual({ itemAwal: 3, dari: 6, itemAkhir: 3, sampai: 9 });
  });

  it("kecocokan yang melintasi beberapa item dan baris: dari karakter pertama item awal sampai karakter terakhir item akhir", () => {
    const r = cariDiHalaman(halaman, polaCari("pasal 156 dalam")!)[0];
    expect(halaman.teks.slice(r.mulai, r.akhir)).toBe("Pasal 156\nDalam");
    expect(rentangItem(halaman, r)).toEqual({ itemAwal: 0, dari: 0, itemAkhir: 3, sampai: 5 });
  });

  it("baris baru penutup tak ikut: kecocokan yang berakhir tepat di akhir item", () => {
    const r = cariDiHalaman(halaman, polaCari("156")!)[0];
    expect(rentangItem(halaman, r)).toEqual({ itemAwal: 2, dari: 0, itemAkhir: 2, sampai: 3 });
  });

  it("kecocokan yang berakhir tepat di batas dua item tak menyeret item berikutnya", () => {
    const r = cariDiHalaman(halaman, polaCari("Pasal")!)[0];
    expect(rentangItem(halaman, r)).toEqual({ itemAwal: 0, dari: 0, itemAkhir: 0, sampai: 5 });
  });

  it("rentang yang berakhir di baris baru penutup dijepit ke panjang item (karakter sisipan itu bukan bagian item)", () => {
    // "Pasal 156\nDalam hal\n": "156" mulai di 6, baris barunya di 9, jadi akhir 10 melewati item itu (3 karakter) satu karakter.
    expect(rentangItem(halaman, { mulai: 6, akhir: 10 })).toEqual({ itemAwal: 2, dari: 0, itemAkhir: 2, sampai: 3 });
  });

  it("halaman tanpa item: null", () => {
    expect(rentangItem({ teks: "", awal: [], bagian: [], akhirBaris: [] }, { mulai: 0, akhir: 2 })).toBeNull();
  });
});

describe("rumus gestur zoom", () => {
  it("jepit", () => {
    expect(jepit(5, 1, 3)).toBe(3);
    expect(jepit(0, 1, 3)).toBe(1);
    expect(jepit(2, 1, 3)).toBe(2);
  });

  it("jarak dua sentuhan", () => {
    expect(jarakSentuh({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 })).toBe(5);
  });

  it("rasio cubitan mengikuti jarak, tetapi zoom akhirnya dijepit ke batas penampil", () => {
    expect(rasioCubit(100, 200, 1, 0.5, 4)).toBe(2);
    expect(rasioCubit(100, 50, 1, 0.5, 4)).toBe(0.5);
    // dari zoom 2: perbesar 10x hanya boleh sampai 4 (rasio 2); perkecil 10x hanya sampai 0,5 (rasio 0,25)
    expect(rasioCubit(100, 1000, 2, 0.5, 4)).toBe(2);
    expect(rasioCubit(100, 10, 2, 0.5, 4)).toBe(0.25);
    // masukan tak sah tak menghasilkan NaN
    expect(rasioCubit(0, 10, 1, 0.5, 4)).toBe(1);
    expect(rasioCubit(100, 10, 0, 0.5, 4)).toBe(1);
  });

  it("ketuk dua kali: cukup dekat waktunya dan letaknya, urutan waktu benar", () => {
    const a = { waktu: 1000, x: 100, y: 100 };
    expect(ketukDua(a, { waktu: 1200, x: 110, y: 105 })).toBe(true);
    expect(ketukDua(a, { waktu: 1400, x: 100, y: 100 })).toBe(false);
    expect(ketukDua(a, { waktu: 1200, x: 200, y: 100 })).toBe(false);
    expect(ketukDua(a, { waktu: 900, x: 100, y: 100 })).toBe(false);
    expect(ketukDua(a, { waktu: 1000, x: 100, y: 100 })).toBe(false);
  });

  it("batas jeda (320 ms) dan jarak (32 px) masih termasuk, jarak dihitung pada kedua sumbu, dan batas bawaan bisa diganti", () => {
    const a = { waktu: 1000, x: 100, y: 100 };
    expect(ketukDua(a, { waktu: 1320, x: 100, y: 100 })).toBe(true);
    expect(ketukDua(a, { waktu: 1321, x: 100, y: 100 })).toBe(false);
    expect(ketukDua(a, { waktu: 1100, x: 132, y: 100 })).toBe(true);
    expect(ketukDua(a, { waktu: 1100, x: 133, y: 100 })).toBe(false);
    expect(ketukDua(a, { waktu: 1100, x: 100, y: 133 })).toBe(false);
    // 24 px ke kanan dan 24 px ke bawah: tiap sumbu di bawah batas, tetapi jaraknya (33,9 px) di atasnya.
    expect(ketukDua(a, { waktu: 1100, x: 124, y: 124 })).toBe(false);
    expect(ketukDua(a, { waktu: 1500, x: 100, y: 100 }, { jedaMs: 600 })).toBe(true);
    expect(ketukDua(a, { waktu: 1100, x: 150, y: 100 }, { jarakPx: 60 })).toBe(true);
  });
});

describe("indeksPertamaDi dan halamanTerlihat", () => {
  // 10 halaman setinggi 100 dengan celah 10: halaman ke-i (0-based) menempati [110i, 110i + 100].
  const atas = (i: number) => 110 * i;
  const bawah = (i: number) => 110 * i + 100;

  it("indeksPertamaDi: pencarian biner pada tepi bawah yang naik", () => {
    expect(indeksPertamaDi(10, bawah, -50)).toBe(0);
    expect(indeksPertamaDi(10, bawah, 100)).toBe(0); // tepi bawah halaman pertama tepat di y: masih halaman itu
    expect(indeksPertamaDi(10, bawah, 101)).toBe(1);
    expect(indeksPertamaDi(10, bawah, 545)).toBe(5);
    expect(indeksPertamaDi(10, bawah, 5000)).toBe(10);
    expect(indeksPertamaDi(0, bawah, 0)).toBe(0);
  });

  it("halaman yang paling banyak terlihat menjadi halaman saat ini", () => {
    // Layar setinggi 250 mulai dari y=60 (terlihat 60..310): halaman 1 terlihat 40, halaman 2 terlihat 100, halaman 3 terlihat 90.
    const r = halamanTerlihat(10, atas, bawah, 60, 250, 0);
    expect(r.dekat).toEqual([1, 2, 3]);
    expect(r.utama).toBe(2);
  });

  it("sama luasnya: halaman yang lebih awal menang", () => {
    // terlihat 105..215: halaman 2 (110..210) terlihat 100, tak ada yang lebih luas; terlihat 10..210: halaman 1 90, halaman 2 100
    expect(halamanTerlihat(10, atas, bawah, 0, 220, 0).utama).toBe(1); // halaman 1 terlihat 100, halaman 2 terlihat 100 (110..210)
  });

  it("tepat di awal sebuah halaman, halaman itu yang utama (loncat ke halaman)", () => {
    expect(halamanTerlihat(10, atas, bawah, 440, 250, 0).utama).toBe(5);
  });

  it("margin menambah halaman 'dekat' di kedua sisi tanpa mengubah yang utama", () => {
    const tanpa = halamanTerlihat(10, atas, bawah, 440, 250, 0);
    const dengan = halamanTerlihat(10, atas, bawah, 440, 250, 300);
    expect(dengan.utama).toBe(tanpa.utama);
    // terlihat 440..690, ditambah 300 di tiap sisi: halaman yang tepi bawahnya >= 140 dan tepi atasnya <= 990
    expect(dengan.dekat).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(tanpa.dekat).toEqual([5, 6, 7]);
  });

  it("di celah antar-halaman atau di luar isi: tak ada halaman utama bila tak ada yang terlihat", () => {
    expect(halamanTerlihat(10, atas, bawah, 1200, 250, 0)).toEqual({ utama: 0, dekat: [] });
    expect(halamanTerlihat(0, atas, bawah, 0, 250, 0)).toEqual({ utama: 0, dekat: [] });
    // layar sepenuhnya di celah 100..110
    expect(halamanTerlihat(10, atas, bawah, 101, 8, 0)).toEqual({ utama: 0, dekat: [] });
    // layar tepat di celah: dua halaman menyentuh tepinya tanpa terlihat sepiksel pun, jadi keduanya "dekat" tetapi tak ada yang utama
    expect(halamanTerlihat(10, atas, bawah, 100, 10, 0)).toEqual({ utama: 0, dekat: [1, 2] });
  });
});
