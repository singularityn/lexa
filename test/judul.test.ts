/**
 * Tingkat judul: penilaian judul peraturan terhadap kata yang diketik (lib/judul.ts). Judul-judul di bawah disalin
 * dari data produksi (D1 `lexa-db`, 12 Oktober 2026), karena justru bentuk aslinya yang membuat BM25 salah urut.
 */
import { describe, expect, it } from "vitest";
import { bandingkanJudul, nilaiJudul, pecahKata, pokokJudul, type BarisJudul } from "../src/worker/lib/judul";
import { uraiKueri } from "../src/worker/lib/query";
import type { StatusPeraturan } from "../src/shared/types";

describe("pokokJudul", () => {
  it("mengambil bagian sesudah 'tentang' pada judul resmi", () => {
    expect(pokokJudul("Undang-Undang Nomor 32 Tahun 2014 tentang Kelautan")).toBe("Kelautan");
    expect(pokokJudul("Peraturan Pemerintah Nomor 27 Tahun 2021 tentang PENYELENGGARAAN BIDANG KELAUTAN DAN PERIKANAN")).toBe(
      "PENYELENGGARAAN BIDANG KELAUTAN DAN PERIKANAN",
    );
  });

  it("hanya 'tentang' yang pertama memisahkan: judul penetapan memuat 'tentang' lagi di dalam pokoknya", () => {
    expect(
      pokokJudul(
        "Undang-Undang Nomor 6 Tahun 2023 tentang Penetapan Peraturan Pemerintah Pengganti Undang-Undang Nomor 2 Tahun 2022 tentang Cipta Kerja menjadi Undang-Undang",
      ),
    ).toBe("Penetapan Peraturan Pemerintah Pengganti Undang-Undang Nomor 2 Tahun 2022 tentang Cipta Kerja menjadi Undang-Undang");
    expect(pokokJudul("Peraturan Pemerintah Nomor 19 Tahun 2006 tentang PERUBAHAN PP 62-2002 TENTANG TARIF ATAS JENIS PNBP")).toBe(
      "PERUBAHAN PP 62-2002 TENTANG TARIF ATAS JENIS PNBP",
    );
  });

  it("judul yang tidak dibuka nama jenis dipakai utuh: 'Perubahan atas ...' adalah bagian dari pokoknya", () => {
    const j = "Perubahan atas Undang-Undang Nomor 1 Tahun 1974 tentang Perkawinan";
    expect(pokokJudul(j)).toBe(j);
    const penetapan = "Penetapan Peraturan Pemerintah Pengganti Undang-Undang Nomor 2 Tahun 2022 tentang Cipta Kerja menjadi Undang-Undang";
    expect(pokokJudul(penetapan)).toBe(penetapan);
  });

  it("judul tanpa 'tentang' dipakai utuh", () => {
    expect(pokokJudul("Ketenagakerjaan")).toBe("Ketenagakerjaan");
    expect(pokokJudul("Undang-Undang Dasar Negara Republik Indonesia Tahun 1945")).toBe("Undang-Undang Dasar Negara Republik Indonesia Tahun 1945");
  });

  it("'tentang' di tengah kalimat yang bagian depannya bukan rujukan tidak memisahkan", () => {
    expect(pokokJudul("Pedoman Kebijakan tentang Perlindungan Anak")).toBe("Pedoman Kebijakan tentang Perlindungan Anak");
  });

  it("judul yang hanya rujukan tidak punya pokok (sumber katalog tak memberinya)", () => {
    expect(pokokJudul("Undang-Undang Nomor 7 Tahun 1981")).toBe("");
    expect(pokokJudul("Peraturan Pemerintah Nomor 53 Tahun 1963")).toBe("");
  });
});

describe("pecahKata", () => {
  it("memecah seperti tokenizer indeks: tanda hubung di dalam kata dipertahankan", () => {
    expect(pecahKata("Pengganti Undang-Undang, Nomor 2/2022 (Cipta Kerja)")).toEqual([
      "pengganti", "undang-undang", "nomor", "2", "2022", "cipta", "kerja",
    ]);
  });
});

const J = {
  uu32: "Undang-Undang Nomor 32 Tahun 2014 tentang Kelautan",
  pp27: "Peraturan Pemerintah Nomor 27 Tahun 2021 tentang PENYELENGGARAAN BIDANG KELAUTAN DAN PERIKANAN",
  pp62: "Peraturan Pemerintah Nomor 62 Tahun 2002 tentang TARIF ATAS JENIS PENERIMAAN NEGARA BUKAN PAJAK YANG BERLAKU PADA DEPARTEMEN KELAUTAN DAN PERIKANAN",
  pp85: "Peraturan Pemerintah Nomor 85 Tahun 2021 tentang JENIS DAN TARIF ATAS JENIS PENERIMAAN NEGARA BUKAN PAJAK YANG BERLAKU PADA KEMENTERIAN KELAUTAN DAN PERIKANAN",
  uu31: "Undang-Undang Nomor 31 Tahun 2004 tentang PERIKANAN",
  uu1962: "Undang-Undang Nomor 1 Tahun 1962 tentang Karantina Laut",
};

const nilai = (judul: string, kueri: string, status: StatusPeraturan = "berlaku") => nilaiJudul(judul, uraiKueri(kueri), status);

describe("nilaiJudul: kasus 'kelautan'", () => {
  it("judul yang tidak memuat kata itu, termasuk yang hanya sepadan ('laut', bidang 'Perikanan'), bukan hasil tingkat judul", () => {
    expect(nilai(J.uu31, "kelautan")).toBeNull();
    expect(nilai(J.uu1962, "kelautan")).toBeNull();
  });

  it("yang pokoknya persis 'Kelautan' menang atas yang sekadar menyebutnya, berapa pun panjang judulnya", () => {
    const a = nilai(J.uu32, "kelautan", "diubah")!;
    const b = nilai(J.pp27, "kelautan", "dicabut")!;
    const c = nilai(J.pp62, "kelautan")!;
    const d = nilai(J.pp85, "kelautan")!;
    expect(a.persis).toBe(true);
    expect(b.persis).toBe(false);
    expect(a.skor).toBeGreaterThan(b.skor);
    // Pokok yang lebih pendek lebih dibicarakan kata itu: PP 27/2021 (4 kata bermakna) di atas PP tarif (10 dan 11 kata),
    // walau yang tarif masih berlaku dan yang 27/2021 sudah dicabut.
    expect(b.skor).toBeGreaterThan(c.skor);
    expect(c.skor).toBeGreaterThan(d.skor);
  });

  it("urutan produksi (BM25 menaruh UU 32/2014 paling bawah dari delapan) dibalik menjadi UU 32/2014 paling atas", () => {
    const baris = (uri: string, jenis: string, tahun: number, judul: string, status: StatusPeraturan): BarisJudul => ({
      frbr_uri: uri, jenis, tahun, nilai: nilai(judul, "kelautan", status)!,
    });
    const urutan = [
      baris("/akn/id/act/pp/2002/62", "PP", 2002, J.pp62, "berlaku"),
      baris("/akn/id/act/pp/2021/27", "PP", 2021, J.pp27, "dicabut"),
      baris("/akn/id/act/pp/2021/85", "PP", 2021, J.pp85, "berlaku"),
      baris("/akn/id/act/uu/2014/32", "UU", 2014, J.uu32, "diubah"),
    ].sort(bandingkanJudul);
    expect(urutan.map((b) => b.frbr_uri)).toEqual([
      "/akn/id/act/uu/2014/32",
      "/akn/id/act/pp/2021/27",
      "/akn/id/act/pp/2002/62",
      "/akn/id/act/pp/2021/85",
    ]);
  });
});

describe("nilaiJudul: undang-undang dasar dan perubahannya", () => {
  it("undang-undang yang menjadi pokok bahasan didahulukan dari perubahannya: 'perkawinan'", () => {
    const dasar = nilai("Undang-Undang Nomor 1 Tahun 1974 tentang Perkawinan", "perkawinan")!;
    const ubah = nilai("Undang-Undang Nomor 16 Tahun 2019 tentang Perubahan atas Undang-Undang Nomor 1 Tahun 1974 tentang Perkawinan", "perkawinan")!;
    const ringkas = nilai("Perubahan atas Undang-Undang Nomor 1 Tahun 1974 tentang Perkawinan", "perkawinan")!;
    expect(dasar.persis).toBe(true);
    expect(ubah.persis).toBe(false);
    expect(ringkas.persis).toBe(false);
    expect(dasar.skor).toBeGreaterThan(ubah.skor);
    expect(dasar.skor).toBeGreaterThan(ringkas.skor);
  });

  it("penetapan Perppu menjadi undang-undang bukan 'Cipta Kerja' itu sendiri", () => {
    const dasar = nilai("Undang-Undang Nomor 11 Tahun 2020 tentang Cipta Kerja", "cipta kerja")!;
    const tetap = nilai(
      "Undang-Undang Nomor 6 Tahun 2023 tentang Penetapan Peraturan Pemerintah Pengganti Undang-Undang Nomor 2 Tahun 2022 tentang Cipta Kerja menjadi Undang-Undang",
      "cipta kerja",
    )!;
    expect(dasar.skor).toBeGreaterThan(tetap.skor);
  });
});

describe("nilaiJudul: aturan lolos", () => {
  it("semua kata yang diketik harus ada di judul", () => {
    expect(nilai("Undang-Undang Nomor 13 Tahun 2003 tentang Ketenagakerjaan", "ketenagakerjaan pesangon")).toBeNull();
    expect(nilai("Perlindungan Pekerja Migran Indonesia", "pekerja migran")).not.toBeNull();
    expect(nilai("Perlindungan Pekerja Migran Indonesia", "pekerja indonesia")).not.toBeNull();
  });

  it("kata yang hanya ada di bagian depan judul ('peraturan pemerintah', tahun) tidak meloloskan apa pun", () => {
    expect(nilai(J.pp27, "peraturan pemerintah")).toBeNull();
    expect(nilai(J.uu32, "undang-undang")).toBeNull();
    expect(nilai(J.uu32, "tahun 2014")).toBeNull();
  });

  it("tetapi kata bagian depan menyertai kata pokok tanpa menggugurkannya", () => {
    expect(nilai(J.pp27, "peraturan pemerintah kelautan")).not.toBeNull();
    expect(nilai(J.uu32, "kelautan 2014")).not.toBeNull();
    expect(nilai(J.uu32, "kelautan 2015")).toBeNull();
  });

  it("judul yang hanya rujukan tak punya pokok, jadi tak lolos oleh kata apa pun", () => {
    expect(nilai("Undang-Undang Nomor 7 Tahun 1981", "undang-undang")).toBeNull();
    expect(nilai("Undang-Undang Nomor 7 Tahun 1981", "wajib lapor")).toBeNull();
  });

  it("awalan kata judul cocok tetapi di bawah kata persis: 'kerja' menemukan 'kerjasama', di bawah 'kerja'", () => {
    const persis = nilai("Peraturan Pemerintah Nomor 1 Tahun 2020 tentang Kerja", "kerja")!;
    const awalan = nilai("Peraturan Pemerintah Nomor 2 Tahun 2020 tentang Kerjasama", "kerja")!;
    expect(awalan).not.toBeNull();
    expect(persis.skor).toBeGreaterThan(awalan.skor);
    expect(awalan.persis).toBe(false);
  });

  it("awalan hanya untuk kata ≥ 4 huruf dan kata tunggal: 'uu' tidak menemukan 'uumum'", () => {
    expect(nilai("Peraturan Pemerintah Nomor 2 Tahun 2020 tentang Uumum", "uu pp")).toBeNull();
    expect(nilai("Peraturan Pemerintah Nomor 2 Tahun 2020 tentang Hak Cipta", "cip")).toBeNull();
  });

  it("ejaan lain dari kata yang sama dihitung persis: 'perlindungan' menemukan 'Pelindungan Data Pribadi'", () => {
    const n = nilai("Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi", "perlindungan data pribadi")!;
    expect(n).not.toBeNull();
    expect(n.persis).toBe(true);
  });

  it("singkatan yang berarti beberapa kata ditemukan sebagai frasa: 'ite' menemukan judulnya", () => {
    const n = nilai("Undang-Undang Nomor 11 Tahun 2008 tentang Informasi dan Transaksi Elektronik", "ite")!;
    expect(n).not.toBeNull();
    expect(n.persis).toBe(true);
    expect(nilai("Undang-Undang Nomor 11 Tahun 2008 tentang Informasi Elektronik", "ite")).toBeNull();
  });

  it("frasa berkutip harus muncul berurutan di judul", () => {
    expect(nilai("Undang-Undang Nomor 11 Tahun 2020 tentang Cipta Kerja", '"cipta kerja"')).not.toBeNull();
    expect(nilai("Undang-Undang Nomor 11 Tahun 2020 tentang Kerja Cipta", '"cipta kerja"')).toBeNull();
    // Tanpa kutip, urutannya bebas.
    expect(nilai("Undang-Undang Nomor 11 Tahun 2020 tentang Kerja Cipta", "cipta kerja")).not.toBeNull();
  });

  it("kata pokok yang menjadi kata pertama judul mendapat tambahan, dan yang persis lebih besar lagi", () => {
    const awal = nilai("Peraturan Pemerintah Nomor 1 Tahun 2020 tentang Kelautan dan Pesisir Terpadu", "kelautan")!;
    const tengah = nilai("Peraturan Pemerintah Nomor 1 Tahun 2020 tentang Pengelolaan Kelautan dan Pesisir", "kelautan")!;
    expect(awal.skor).toBeGreaterThan(tengah.skor);
  });

  it("kueri tanpa kata (hanya kata henti) tidak menilai apa pun", () => {
    expect(nilai(J.uu32, "yang dan di")).toBeNull();
  });
});

describe("bandingkanJudul", () => {
  const b = (frbr_uri: string, jenis: string, tahun: number, skor = 1): BarisJudul => ({ frbr_uri, jenis, tahun, nilai: { skor, persis: false } });

  it("pada nilai sama: hierarki jenis (UUD, Tap MPR, UU, Perppu, PP), lalu tahun terbaru, lalu URI", () => {
    const urut = [
      b("/pp/2021/1", "PP", 2021),
      b("/uu/2000/1", "UU", 2000),
      b("/perppu/2022/1", "PERPPU", 2022),
      b("/uud/1945/1", "UUD", 1945),
      b("/tap/1998/1", "TAP_MPR", 1998),
      b("/uu/2010/1", "UU", 2010),
      b("/uu/2010/2", "UU", 2010),
    ].sort(bandingkanJudul);
    expect(urut.map((x) => x.frbr_uri)).toEqual([
      "/uud/1945/1", "/tap/1998/1", "/uu/2010/1", "/uu/2010/2", "/uu/2000/1", "/perppu/2022/1", "/pp/2021/1",
    ]);
  });

  it("nilai yang lebih besar selalu mendahului, apa pun jenisnya", () => {
    expect([b("/pp/1", "PP", 2000, 2), b("/uud/1", "UUD", 1945, 1)].sort(bandingkanJudul)[0].frbr_uri).toBe("/pp/1");
  });

  it("jenis yang tak dikenal diurutkan paling akhir, tanpa merusak urutan", () => {
    expect([b("/x/1", "LAIN", 2020), b("/pp/1", "PP", 1990)].sort(bandingkanJudul)[0].frbr_uri).toBe("/pp/1");
  });
});
