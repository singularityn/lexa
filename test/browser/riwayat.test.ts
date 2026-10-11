import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAKS_CARI, MAKS_DILIHAT, MAKS_POSISI, riwayat } from "../../public/js/riwayat.js";
import { pantau, penyimpanan } from "../../public/js/state.js";

// Riwayat dijalankan di Node: localStorage tidak ada, jadi `penyimpanan` memakai cadangan di memori,
// persis seperti peramban yang menolak akses penyimpanan (mode privat).

const p = (n: number) => ({ uri: `/akn/id/act/uu/2000/${n}`, sitasi: `UU ${n}/2000`, judul: `Judul ${n}` });

beforeEach(() => {
  riwayat.hapusSemua();
  vi.useRealTimers();
});

describe("riwayat: peraturan yang dilihat", () => {
  it("terbaru dulu, dan membuka lagi memindahkannya ke atas tanpa menggandakan", () => {
    riwayat.catatDilihat(p(1));
    riwayat.catatDilihat(p(2));
    riwayat.catatDilihat(p(3));
    riwayat.catatDilihat(p(1));
    expect(riwayat.dilihat().map((e) => e.uri)).toEqual([p(1).uri, p(3).uri, p(2).uri]);
  });

  it(`dibatasi ${MAKS_DILIHAT} entri; yang tertua dibuang`, () => {
    for (let i = 1; i <= MAKS_DILIHAT + 5; i++) riwayat.catatDilihat(p(i));
    const daftar = riwayat.dilihat();
    expect(daftar).toHaveLength(MAKS_DILIHAT);
    expect(daftar[0].uri).toBe(p(MAKS_DILIHAT + 5).uri);
    expect(daftar.some((e) => e.uri === p(1).uri)).toBe(false);
  });

  it("mencatat waktu", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T08:00:00Z"));
    riwayat.catatDilihat(p(1));
    expect(riwayat.dilihat()[0].waktu).toBe(Date.parse("2026-10-03T08:00:00Z"));
  });

  it("hapusDilihat membuang satu, hapusSemua membuang semuanya (termasuk pencarian)", () => {
    riwayat.catatDilihat(p(1));
    riwayat.catatDilihat(p(2));
    riwayat.catatPencarian("pesangon");
    riwayat.hapusDilihat(p(1).uri);
    expect(riwayat.dilihat().map((e) => e.uri)).toEqual([p(2).uri]);
    riwayat.hapusSemua();
    expect(riwayat.dilihat()).toEqual([]);
    expect(riwayat.pencarian()).toEqual([]);
  });
});

describe("riwayat: pencarian", () => {
  it("terbaru dulu; spasi dirapikan; huruf besar/kecil dianggap sama", () => {
    riwayat.catatPencarian("  pesangon   PHK ");
    riwayat.catatPencarian("cuti melahirkan");
    riwayat.catatPencarian("Pesangon phk");
    expect(riwayat.pencarian().map((e) => e.q)).toEqual(["Pesangon phk", "cuti melahirkan"]);
  });

  it("kueri terlalu pendek atau kosong tidak dicatat", () => {
    riwayat.catatPencarian("");
    riwayat.catatPencarian(" a ");
    expect(riwayat.pencarian()).toEqual([]);
  });

  it(`dibatasi ${MAKS_CARI} entri`, () => {
    for (let i = 0; i < MAKS_CARI + 4; i++) riwayat.catatPencarian(`kueri ${i}`);
    expect(riwayat.pencarian()).toHaveLength(MAKS_CARI);
    expect(riwayat.pencarian()[0].q).toBe(`kueri ${MAKS_CARI + 3}`);
  });
});

describe("riwayat: data rusak tidak merusak aplikasi", () => {
  it.each(["{", "null", "[]", '{"dilihat":"bukan larik","cari":42}', "bukan json sama sekali"])("%j dibaca sebagai kosong", (mentah) => {
    penyimpanan.tulis("lexa:riwayat:v1", mentah);
    expect(riwayat.dilihat()).toEqual([]);
    expect(riwayat.pencarian()).toEqual([]);
    // Dan masih bisa menulis setelahnya.
    riwayat.catatDilihat(p(1));
    expect(riwayat.dilihat()).toHaveLength(1);
  });

  it("entri berbentuk salah disaring, yang benar dipertahankan", () => {
    penyimpanan.tulis(
      "lexa:riwayat:v1",
      JSON.stringify({
        dilihat: [null, 5, { uri: 1, judul: "x" }, { uri: "/ok", judul: "OK", sitasi: "UU 1/2000", waktu: 5 }, { uri: "/tanpa-judul" }],
        cari: [{ q: "" }, { q: "   " }, { q: 7 }, { q: "sah", waktu: 9 }],
      }),
    );
    expect(riwayat.dilihat()).toEqual([{ uri: "/ok", judul: "OK", sitasi: "UU 1/2000", waktu: 5 }]);
    expect(riwayat.pencarian()).toEqual([{ q: "sah", waktu: 9 }]);
  });
});

describe("riwayat: posisi baca", () => {
  const u = (n: number) => `/akn/id/act/uu/2000/${n}`;

  it("mencatat pasal terakhir yang dibaca per peraturan dan mengembalikannya", () => {
    expect(riwayat.posisi(u(1))).toBeNull();
    riwayat.catatPosisi(u(1), { jangkar: "pasal-82", nama: "Pasal 82" });
    expect(riwayat.posisi(u(1))).toMatchObject({ uri: u(1), jangkar: "pasal-82", nama: "Pasal 82" });
    riwayat.catatPosisi(u(1), { jangkar: "pasal-156", nama: "Pasal 156" });
    expect(riwayat.posisi(u(1))?.jangkar).toBe("pasal-156");
    expect(riwayat.posisi(u(2))).toBeNull();
  });

  it(`dibatasi ${MAKS_POSISI} peraturan; yang tertua dibuang`, () => {
    for (let i = 1; i <= MAKS_POSISI + 3; i++) riwayat.catatPosisi(u(i), { jangkar: "pasal-1", nama: "Pasal 1" });
    expect(riwayat.posisi(u(1))).toBeNull();
    expect(riwayat.posisi(u(MAKS_POSISI + 3))).not.toBeNull();
  });

  it("hapusPosisi membuang satu; posisi tidak mengganggu riwayat dilihat/cari dan sebaliknya; hapusSemua membuang semuanya", () => {
    riwayat.catatPosisi(u(1), { jangkar: "pasal-5", nama: "Pasal 5" });
    riwayat.catatDilihat(p(1));
    riwayat.catatPencarian("pesangon");
    expect(riwayat.posisi(u(1))).not.toBeNull();
    riwayat.hapusDilihat(p(1).uri);
    expect(riwayat.posisi(u(1))).not.toBeNull();
    riwayat.hapusPosisi(u(1));
    expect(riwayat.posisi(u(1))).toBeNull();
    expect(riwayat.pencarian()).toHaveLength(1);
    riwayat.catatPosisi(u(2), { jangkar: "pasal-7", nama: "Pasal 7" });
    riwayat.hapusSemua();
    expect(riwayat.posisi(u(2))).toBeNull();
  });

  it("data rusak di penyimpanan diabaikan, bukan membuat galat", () => {
    penyimpanan.tulis("lexa:riwayat:v1", JSON.stringify({ posisi: [null, { uri: 5 }, { uri: "x", jangkar: "" }, { uri: "ok", jangkar: "pasal-1", nama: 1 }] }));
    expect(riwayat.posisi("ok")).toMatchObject({ jangkar: "pasal-1", nama: "1" });
    expect(riwayat.posisi("x")).toBeNull();
    penyimpanan.tulis("lexa:riwayat:v1", "bukan json");
    expect(riwayat.posisi("ok")).toBeNull();
  });
});

describe("riwayat: menghapus dan memulihkan pencarian", () => {
  it("hapusPencarian membuang satu kata (huruf besar/kecil dan spasi diabaikan) dan memberi tahu pendengar hanya bila berubah", () => {
    const dengar = vi.fn();
    const berhenti = pantau("riwayat", dengar);
    riwayat.catatPencarian("pesangon PHK");
    riwayat.catatPencarian("cuti melahirkan");
    dengar.mockClear();
    riwayat.hapusPencarian("  PESANGON phk ");
    expect(riwayat.pencarian().map((e) => e.q)).toEqual(["cuti melahirkan"]);
    expect(dengar).toHaveBeenCalledTimes(1);
    riwayat.hapusPencarian("tidak pernah dicari");
    expect(dengar).toHaveBeenCalledTimes(1);
    berhenti();
  });

  it("hapusSemuaPencarian mengosongkan pencarian tanpa menyentuh peraturan yang dilihat", () => {
    riwayat.catatDilihat(p(1));
    riwayat.catatPencarian("pesangon");
    riwayat.catatPencarian("cuti melahirkan");
    riwayat.hapusSemuaPencarian();
    expect(riwayat.pencarian()).toEqual([]);
    expect(riwayat.dilihat()).toHaveLength(1);
  });

  it("pulihkanPencarian mengembalikan yang dihapus, tanpa menggandakan dan tanpa menimpa yang lebih baru", () => {
    riwayat.catatPencarian("pesangon");
    riwayat.catatPencarian("cuti melahirkan");
    const lama = riwayat.pencarian();
    riwayat.hapusSemuaPencarian();
    riwayat.catatPencarian("pajak penghasilan");
    riwayat.pulihkanPencarian(lama);
    expect(riwayat.pencarian().map((e) => e.q)).toEqual(["pajak penghasilan", "cuti melahirkan", "pesangon"]);
    riwayat.pulihkanPencarian(lama);
    expect(riwayat.pencarian()).toHaveLength(3);
  });

  it("mencatat peraturan dan pencarian menyiarkan peristiwa; posisi baca (sering berubah) tidak", () => {
    const dengar = vi.fn();
    const berhenti = pantau("riwayat", dengar);
    riwayat.catatDilihat(p(1));
    riwayat.catatPencarian("pesangon");
    expect(dengar).toHaveBeenCalledTimes(2);
    riwayat.catatPosisi(p(1).uri, { jangkar: "pasal-5", nama: "Pasal 5" });
    riwayat.hapusPosisi(p(1).uri);
    expect(dengar).toHaveBeenCalledTimes(2);
    riwayat.hapusSemua();
    expect(dengar).toHaveBeenCalledTimes(3);
    berhenti();
  });
});
