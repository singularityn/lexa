/**
 * Indeks pasal -> halaman PDF yang dibangun di peramban (public/js/indeksPasalPdf.js): murni, dengan teks halaman palsu.
 * Dipakai bersama oleh "Lihat di PDF", pencarian pasal, dan "Periksa pasal"; pemindaian PDF sungguhan diuji di e2e.
 */
import { describe, expect, it } from "vitest";
import { buatIndeksPasal, HALAMAN_UJI_PINDAIAN, kunciPasal } from "../public/js/indeksPasalPdf.js";

type Item = { str: string; hasEOL?: boolean };
/** Tiap halaman berupa daftar baris; tiap baris menjadi satu item yang mengakhiri baris. */
const halaman = (...baris: string[]): Item[] => baris.map((str) => ({ str, hasEOL: true }));

function pasang(halamanPdf: Item[][], o: { gagalDi?: number[]; simpan?: (s: string) => void; pulihkan?: () => string | null } = {}) {
  const dibaca: number[] = [];
  const indeks = buatIndeksPasal({
    jumlahHalaman: halamanPdf.length,
    ambilItem: async (no) => {
      dibaca.push(no);
      if (o.gagalDi?.includes(no)) throw new Error("gagal baca");
      return halamanPdf[no - 1];
    },
    simpan: o.simpan,
    pulihkan: o.pulihkan,
  });
  return { indeks, dibaca };
}

const naskah = () => [
  halaman("UNDANG-UNDANG CONTOH", "Pasal 1", "Ketentuan umum."),
  halaman("Pasal 2", "Isi dua."),
  halaman("Pasal 3", "Isi tiga.", "Pasal 4", "Isi empat."),
  halaman("Teks pengisi."),
  halaman("PENJELASAN", "Pasal 1", "Cukup jelas.", "Pasal 999", "Cukup jelas."),
];

describe("kunciPasal", () => {
  it("spasi dibuang, huruf besar, dirapikan seperti di D1", () => {
    expect(kunciPasal("5 a")).toBe("5A");
    expect(kunciPasal(" 156 ")).toBe("156");
    expect(kunciPasal("1O")).toBe("10");
  });
});

describe("cari: pemindaian berurutan", () => {
  it("menemukan halaman pasal dan berhenti membaca begitu ketemu", async () => {
    const { indeks, dibaca } = pasang(naskah());
    expect(await indeks.cari("2")).toBe(2);
    expect(dibaca).toEqual([1, 2]);
    // Pasal yang sudah terindeks tak membaca ulang.
    expect(await indeks.cari("1")).toBe(1);
    expect(dibaca).toEqual([1, 2]);
  });

  it("melanjutkan dari halaman terakhir yang dipindai, bukan dari awal", async () => {
    const { indeks, dibaca } = pasang(naskah());
    await indeks.cari("2");
    expect(await indeks.cari("4")).toBe(3);
    expect(dibaca).toEqual([1, 2, 3]);
  });

  it("penjelasan memakai ulang nomor tetapi tak menggeser, dan pemindaian berhenti di judul penjelasan", async () => {
    const { indeks, dibaca } = pasang(naskah());
    expect(await indeks.cari("1")).toBe(1);
    expect(await indeks.cari("999")).toBeNull(); // hanya ada di penjelasan
    expect(dibaca).toEqual([1, 2, 3, 4, 5]);
    expect(indeks.keadaan().akhirBadan).toBe(true);
    expect(indeks.bisaMemindai()).toBe(false);
    expect(indeks.nomor()).toEqual(["1", "2", "3", "4"]);
  });

  it("pasal yang tak ada: null setelah seluruh batang tubuh dipindai, dan tak dipindai ulang", async () => {
    const { indeks, dibaca } = pasang(naskah());
    expect(await indeks.cari("77")).toBeNull();
    const jumlah = dibaca.length;
    expect(await indeks.cari("78")).toBeNull();
    expect(dibaca.length).toBe(jumlah);
  });

  it("nomor ditulis bebas: '5 a' dan '5A' sama", async () => {
    const { indeks } = pasang([halaman("Pasal 5A", "Isi.")]);
    expect(await indeks.cari("5 a")).toBe(1);
    expect(indeks.halamanDari("5a")).toBe(1);
  });

  it("halaman yang gagal dibaca dilewati, bukan menghentikan pemindaian", async () => {
    const { indeks } = pasang(naskah(), { gagalDi: [2] });
    expect(await indeks.cari("3")).toBe(3);
    expect(await indeks.cari("2")).toBeNull();
  });

  it("pencarian bersamaan berjalan berurutan tanpa membaca halaman dua kali", async () => {
    const { indeks, dibaca } = pasang(naskah());
    const [a, b, c] = await Promise.all([indeks.cari("4"), indeks.cari("2"), indeks.cari("1")]);
    expect([a, b, c]).toEqual([3, 2, 1]);
    expect(dibaca).toEqual([1, 2, 3]);
  });
});

describe("PDF hasil pindaian (tanpa lapisan teks)", () => {
  it("dikenali dari halaman-halaman awal yang kosong; pemindaian berhenti dan tak diulang", async () => {
    const kosong = Array.from({ length: 20 }, () => [] as Item[]);
    const { indeks, dibaca } = pasang(kosong);
    expect(await indeks.cari("1")).toBeNull();
    expect(dibaca.length).toBe(HALAMAN_UJI_PINDAIAN);
    expect(indeks.keadaan().tanpaTeks).toBe(true);
    expect(indeks.bisaMemindai()).toBe(false);
    expect(await indeks.cari("2")).toBeNull();
    expect(dibaca.length).toBe(HALAMAN_UJI_PINDAIAN);
  });

  it("naskah pendek yang kosong semua: diputuskan pada halaman terakhir", async () => {
    const { indeks } = pasang([[], []]);
    await indeks.pindai();
    expect(indeks.keadaan().tanpaTeks).toBe(true);
  });

  it("teks muncul hanya di halaman ke-9: tetap dianggap pindaian (yang diuji hanya halaman awal)", async () => {
    const halamanPdf: Item[][] = Array.from({ length: 12 }, () => []);
    halamanPdf[8] = halaman("Pasal 1");
    const { indeks } = pasang(halamanPdf);
    await indeks.pindai();
    expect(indeks.keadaan().tanpaTeks).toBe(true);
    expect(indeks.nomor()).toEqual([]);
  });
});

describe("pindai: seluruh batang tubuh, dapat dibatalkan", () => {
  it("melaporkan kemajuan dan berhenti di penjelasan", async () => {
    const { indeks } = pasang(naskah());
    const lapor: Array<[number, number]> = [];
    await indeks.pindai({ lapor: (s, t) => lapor.push([s, t]) });
    expect(lapor).toEqual([[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]]);
    expect(indeks.nomor()).toEqual(["1", "2", "3", "4"]);
    expect(indeks.keadaan()).toEqual({ sudahDipindai: 5, jumlahHalaman: 5, tanpaTeks: false, akhirBadan: true, jumlahJudul: 4 });
  });

  it("halaman sesudah judul penjelasan tak dibaca sama sekali", async () => {
    const { indeks, dibaca } = pasang([...naskah(), halaman("Pasal 1", "Cukup jelas."), halaman("Pasal 2", "Cukup jelas.")]);
    await indeks.pindai();
    expect(dibaca).toEqual([1, 2, 3, 4, 5]);
    expect(indeks.bisaMemindai()).toBe(false);
    expect(indeks.nomor()).toEqual(["1", "2", "3", "4"]);
  });

  it("naskah tanpa penjelasan dipindai sampai halaman terakhir, tak sampai halaman yang tak ada", async () => {
    const { indeks, dibaca } = pasang([halaman("Pasal 1", "Isi."), halaman("Pasal 2", "Isi.")]);
    await indeks.pindai();
    expect(dibaca).toEqual([1, 2]);
    expect(indeks.keadaan()).toMatchObject({ sudahDipindai: 2, akhirBadan: false, tanpaTeks: false });
    expect(indeks.bisaMemindai()).toBe(false);
  });

  it("dibatalkan: hanya halaman yang sudah dibaca yang tercatat, dan bisa dilanjutkan", async () => {
    const { indeks, dibaca } = pasang(naskah());
    let boleh = true;
    await indeks.pindai({ batal: () => !boleh, lapor: (s) => void (s >= 2 && (boleh = false)) });
    expect(dibaca).toEqual([1, 2]);
    expect(indeks.bisaMemindai()).toBe(true);
    await indeks.pindai();
    expect(dibaca).toEqual([1, 2, 3, 4, 5]);
    expect(indeks.nomor()).toEqual(["1", "2", "3", "4"]);
  });

  it("dihancurkan: tak ada lagi yang dibaca", async () => {
    const { indeks, dibaca } = pasang(naskah());
    indeks.hancurkan();
    await indeks.pindai();
    expect(await indeks.cari("3")).toBeNull();
    expect(dibaca).toEqual([]);
  });
});

describe("verifikasi saran halaman dari server", () => {
  it("saran tepat: dipastikan dengan membaca satu halaman saja", async () => {
    const { indeks, dibaca } = pasang(naskah());
    expect(await indeks.verifikasi("3", 3)).toEqual({ halaman: 3, pasti: true });
    expect(dibaca).toEqual([3]);
  });

  it("bergeser satu halaman: ditemukan di halaman berikutnya, lalu sebelumnya", async () => {
    const { indeks } = pasang(naskah());
    expect(await indeks.verifikasi("3", 2)).toEqual({ halaman: 3, pasti: true });
    expect(await indeks.verifikasi("2", 3)).toEqual({ halaman: 2, pasti: true });
  });

  it("judul tak tampak di sekitar saran (padahal ada teks): null, supaya pemindaian penuh yang menentukan", async () => {
    const { indeks } = pasang(naskah());
    expect(await indeks.verifikasi("3", 5)).toBeNull();
    expect(await indeks.verifikasi("1", 4)).toBeNull();
  });

  it("halaman tanpa lapisan teks: saran dipercaya tetapi ditandai tak pasti", async () => {
    const { indeks } = pasang([[], [], []]);
    expect(await indeks.verifikasi("2", 2)).toEqual({ halaman: 2, pasti: false });
  });

  it("judul tampak di kedua halaman tetangga: yang berikutnya didahulukan (urutan tetap: saran, berikutnya, sebelumnya)", async () => {
    const { indeks } = pasang([halaman("Pasal 7", "a"), halaman("Teks."), halaman("Pasal 7", "b")]);
    expect(await indeks.verifikasi("7", 2)).toEqual({ halaman: 3, pasti: true });
  });

  it("halaman terakhir dan halaman pertama bisa diverifikasi (tepi rentang termasuk)", async () => {
    const { indeks } = pasang(naskah());
    expect(await indeks.verifikasi("1", 1)).toEqual({ halaman: 1, pasti: true });
    expect(await indeks.verifikasi("999", 5)).toBeNull(); // halaman terakhir ada, tetapi 999 hanya di penjelasan
    expect(await indeks.verifikasi("4", 4)).toEqual({ halaman: 3, pasti: true }); // tetangga sebelumnya
  });

  it("dihancurkan: verifikasi tak membaca halaman lagi", async () => {
    const { indeks, dibaca } = pasang(naskah());
    indeks.hancurkan();
    expect(await indeks.verifikasi("3", 3)).toBeNull();
    expect(dibaca).toEqual([]);
  });

  it("saran di luar rentang atau bukan bilangan bulat ditolak; tepi dokumen tak membaca halaman yang tak ada", async () => {
    const { indeks, dibaca } = pasang(naskah());
    expect(await indeks.verifikasi("1", 0)).toBeNull();
    expect(await indeks.verifikasi("1", 6)).toBeNull();
    expect(await indeks.verifikasi("1", 1.5)).toBeNull();
    expect(dibaca).toEqual([]);
    await indeks.verifikasi("3", 5);
    expect(dibaca).toEqual([5, 4]); // 6 tak ada
  });

  it("halaman yang gagal dibaca dilewati; verifikasi tak mencatat apa pun ke indeks pemindaian", async () => {
    const { indeks } = pasang(naskah(), { gagalDi: [3] });
    expect(await indeks.verifikasi("3", 3)).toBeNull();
    const ok = pasang(naskah());
    await ok.indeks.verifikasi("4", 3);
    expect(ok.indeks.nomor()).toEqual([]);
  });
});

describe("penyimpanan keadaan", () => {
  it("disimpan sesudah pemindaian dan dipulihkan untuk PDF yang sama (jumlah halaman cocok)", async () => {
    let tersimpan = "";
    const a = pasang(naskah(), { simpan: (s) => void (tersimpan = s) });
    await a.indeks.pindai();
    expect(JSON.parse(tersimpan)).toMatchObject({ n: 5, a: true, t: false });

    const b = pasang(naskah(), { pulihkan: () => tersimpan });
    expect(b.indeks.nomor()).toEqual(["1", "2", "3", "4"]);
    expect(await b.indeks.cari("3")).toBe(3);
    expect(b.dibaca).toEqual([]);
    expect(b.indeks.bisaMemindai()).toBe(false);
  });

  it("penanda pulihan ikut dipulihkan: PDF pindaian, batang tubuh yang selesai, dan jumlah halaman terpindai tak melebihi jumlah halaman", () => {
    const mentah = (o: Record<string, unknown>) => JSON.stringify({ n: 5, s: 2, t: false, a: false, p: [], ...o });
    const pindaian = pasang(naskah(), { pulihkan: () => mentah({ t: true }) });
    expect(pindaian.indeks.keadaan().tanpaTeks).toBe(true);
    expect(pindaian.indeks.bisaMemindai()).toBe(false);
    const selesai = pasang(naskah(), { pulihkan: () => mentah({ a: true }) });
    expect(selesai.indeks.keadaan().akhirBadan).toBe(true);
    expect(selesai.indeks.bisaMemindai()).toBe(false);
    expect(pasang(naskah(), { pulihkan: () => mentah({}) }).indeks.bisaMemindai()).toBe(true);
    expect(pasang(naskah(), { pulihkan: () => mentah({ s: 99 }) }).indeks.keadaan().sudahDipindai).toBe(5);
  });

  it("jumlah halaman berbeda, JSON rusak, atau bentuk keliru: diabaikan, pemindaian dari awal", async () => {
    let tersimpan = "";
    const a = pasang(naskah(), { simpan: (s) => void (tersimpan = s) });
    await a.indeks.pindai();
    for (const mentah of [tersimpan.replace('"n":5', '"n":6'), "{rusak", '{"n":5,"p":"bukan daftar"}', "", "null"]) {
      const b = pasang(naskah(), { pulihkan: () => mentah });
      expect(b.indeks.nomor(), mentah).toEqual([]);
      expect(await b.indeks.cari("2")).toBe(2);
    }
  });

  it("penyimpanan yang melempar galat tidak merusak pemindaian", async () => {
    const { indeks } = pasang(naskah(), {
      simpan: () => {
        throw new Error("penuh");
      },
      pulihkan: () => {
        throw new Error("diblokir");
      },
    });
    expect(await indeks.cari("2")).toBe(2);
  });

  it("entri pulihan yang bukan [string, bilangan bulat] dibuang", async () => {
    const mentah = JSON.stringify({ n: 5, s: 2, t: false, a: false, p: [["1", 1], [2, 2], ["3", "x"], ["4", 2.5]] });
    const { indeks } = pasang(naskah(), { pulihkan: () => mentah });
    expect(indeks.nomor()).toEqual(["1"]);
    expect(indeks.keadaan().sudahDipindai).toBe(2);
  });
});
