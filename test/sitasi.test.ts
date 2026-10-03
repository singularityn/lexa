import { describe, expect, it } from "vitest";
import { uraiSitasi } from "../src/worker/lib/sitasi";
import { uraiKueri } from "../src/worker/lib/query";
import { sitasiDariTeks } from "../src/worker/lib/bpk";

const uu = (nomor: string, tahun: number) => ({ jenis: "UU", nomor, tahun });

describe("uraiSitasi: bentuk yang dikenali", () => {
  const kasus: Array<[string, ReturnType<typeof uraiSitasi>]> = [
    // singkatan
    ["UU 13/2003", uu("13", 2003)],
    ["uu 13 / 2003", uu("13", 2003)],
    ["UU No. 13/2003", uu("13", 2003)],
    ["UU No.13 Tahun 2003", uu("13", 2003)],
    ["UU Nomor 13 Tahun 2003", uu("13", 2003)],
    ["UU 13 Tahun 2003", uu("13", 2003)],
    ["UU 13 Th. 2003", uu("13", 2003)],
    ["UU 13 Thn 2003", uu("13", 2003)],
    ["UU 13 2003", uu("13", 2003)],
    ["PP 35/2021", { jenis: "PP", nomor: "35", tahun: 2021 }],
    ["Perpres No 12 tahun 2021", { jenis: "PERPRES", nomor: "12", tahun: 2021 }],
    ["Perppu 2/2022", { jenis: "PERPPU", nomor: "2", tahun: 2022 }],
    ["Perpu 2/2022", { jenis: "PERPPU", nomor: "2", tahun: 2022 }],
    ["PERMEN 5/2020", { jenis: "PERMEN", nomor: "5", tahun: 2020 }],
    ["POJK 23/2023", { jenis: "POJK", nomor: "23", tahun: 2023 }],
    ["PBI 7 Tahun 2023", { jenis: "PBI", nomor: "7", tahun: 2023 }],
    ["Perda 8/2007", { jenis: "PERDA_PROV", nomor: "8", tahun: 2007 }],
    // nama panjang
    ["Undang-Undang Nomor 13 Tahun 2003", uu("13", 2003)],
    ["Undang-undang (UU) Nomor 1 Tahun 1947", uu("1", 1947)],
    ["Undang Undang No 13 tahun 2003", uu("13", 2003)],
    ["Undang-Undang Republik Indonesia Nomor 13 Tahun 2003 tentang Ketenagakerjaan", uu("13", 2003)],
    ["UU RI No. 13 Tahun 2003", uu("13", 2003)],
    ["Peraturan Pemerintah Nomor 35 Tahun 2021", { jenis: "PP", nomor: "35", tahun: 2021 }],
    ["Peraturan Pemerintah (PP) Nomor 2 Tahun 1946", { jenis: "PP", nomor: "2", tahun: 1946 }],
    ["Peraturan Pemerintah Republik Indonesia Nomor 35 Tahun 2021 tentang PKWT", { jenis: "PP", nomor: "35", tahun: 2021 }],
    ["Peraturan Presiden Nomor 12 Tahun 2021", { jenis: "PERPRES", nomor: "12", tahun: 2021 }],
    ["Keputusan Presiden Nomor 1 Tahun 1999", { jenis: "KEPPRES", nomor: "1", tahun: 1999 }],
    ["Instruksi Presiden Nomor 5 Tahun 2019", { jenis: "INPRES", nomor: "5", tahun: 2019 }],
    ["Peraturan Otoritas Jasa Keuangan Nomor 23 Tahun 2023", { jenis: "POJK", nomor: "23", tahun: 2023 }],
    ["Peraturan OJK Nomor 23 Tahun 2023", { jenis: "POJK", nomor: "23", tahun: 2023 }],
    ["Peraturan Bank Indonesia Nomor 7 Tahun 2023", { jenis: "PBI", nomor: "7", tahun: 2023 }],
    ["Peraturan Daerah Nomor 8 Tahun 2007", { jenis: "PERDA_PROV", nomor: "8", tahun: 2007 }],
    // nama kementerian atau daerah di antara jenis dan nomor
    ["Peraturan Menteri Nomor 29 Tahun 2025", { jenis: "PERMEN", nomor: "29", tahun: 2025 }],
    ["Peraturan Menteri Ketenagakerjaan Nomor 5 Tahun 2020", { jenis: "PERMEN", nomor: "5", tahun: 2020 }],
    ["Peraturan Menteri Pendayagunaan Aparatur Negara dan Reformasi Birokrasi Nomor 5 Tahun 2020", { jenis: "PERMEN", nomor: "5", tahun: 2020 }],
    ["Keputusan Menteri Kesehatan Nomor 1 Tahun 2021", { jenis: "KEPMEN", nomor: "1", tahun: 2021 }],
    ["Perda DKI Jakarta Nomor 8 Tahun 2007", { jenis: "PERDA_PROV", nomor: "8", tahun: 2007 }],
    ["Peraturan Gubernur Jawa Barat Nomor 3 Tahun 2022", { jenis: "PERGUB", nomor: "3", tahun: 2022 }],
    // sitasi di tengah kalimat
    ["pasal 156 uu 13/2003", uu("13", 2003)],
    ["bagaimana bunyi Pasal 5 UU No. 8 Tahun 1999 tentang perlindungan konsumen?", uu("8", 1999)],
    // penomoran resmi POJK
    ["POJK 48/POJK.04/2016", { jenis: "POJK", nomor: "48", tahun: 2016, sub: "04" }],
    ["POJK Nomor 48/POJK.04/2016", { jenis: "POJK", nomor: "48", tahun: 2016, sub: "04" }],
    ["48/POJK.04/2016", { jenis: "POJK", nomor: "48", tahun: 2016, sub: "04" }],
    ["Peraturan OJK Nomor 1 / POJK.03 / 2019 tentang apa saja", { jenis: "POJK", nomor: "1", tahun: 2019, sub: "03" }],
  ];

  for (const [teks, harapan] of kasus) {
    it(`"${teks}"`, () => {
      expect(uraiSitasi(teks)).toEqual(harapan);
    });
  }
});

describe("uraiSitasi: jenis yang bernama mirip tidak tertukar", () => {
  it("Peraturan Pemerintah Pengganti Undang-Undang adalah PERPPU, bukan UU maupun PP", () => {
    expect(uraiSitasi("Peraturan Pemerintah Pengganti Undang-Undang Nomor 2 Tahun 2022")).toEqual({ jenis: "PERPPU", nomor: "2", tahun: 2022 });
    expect(uraiSitasi("Peraturan Pemerintah Pengganti Undang-Undang (Perpu) Nomor 1 Tahun 1962")).toEqual({ jenis: "PERPPU", nomor: "1", tahun: 1962 });
  });

  it("sitasi yang disebut pertama menang bila ada beberapa", () => {
    expect(uraiSitasi("PP 35/2021 yang menjalankan UU 11/2020")).toEqual({ jenis: "PP", nomor: "35", tahun: 2021 });
    expect(uraiSitasi("UU 11/2020 dan PP 35/2021")).toEqual(uu("11", 2020));
  });

  it("judul yang menyebut peraturan lain di tengahnya tetap ditautkan ke jenis yang disebut pertama", () => {
    const judul = "Penetapan Peraturan Pemerintah Pengganti Undang-Undang Nomor 2 Tahun 2022 tentang Cipta Kerja menjadi Undang-Undang";
    expect(uraiSitasi(judul)).toEqual({ jenis: "PERPPU", nomor: "2", tahun: 2022 });
  });
});

describe("uraiSitasi: bukan sitasi", () => {
  const bukan = [
    "",
    "   ",
    "cuti melahirkan",
    "PHK pesangon",
    "uu ite pasal 28",
    "uu tentang ketenagakerjaan",
    "peraturan pemerintah tentang upah minimum 2021",
    "peraturan menteri tentang upah minimum 2021",
    "pp 35",
    "pp 35 21", // tahun harus empat digit
    "uu 13 tahun", // tahun hilang
    "ppn 11 persen 2022", // "ppn" bukan "pp"
    "uud 1945 pasal 33", // UUD bukan UU
    "perundang-undangan 12 2011", // "undang-undang" di tengah kata
    "usia 17 tahun 2020",
    "5/2020", // nomor/tahun tanpa nama jenis
    "uu 13/20031", // tahun lima digit
    "uu 5 1000", // tahun di luar akal sehat
    "uu 5 2200",
    "seojk 5/seojk.05/2020", // surat edaran bukan POJK
  ];
  for (const teks of bukan) {
    it(JSON.stringify(teks), () => {
      expect(uraiSitasi(teks)).toBeNull();
    });
  }

  it("tidak lambat pada masukan panjang yang menyerupai sitasi", () => {
    const mulai = performance.now();
    const berbahaya = "peraturan menteri " + "kata ".repeat(2000) + "tanpa nomor";
    expect(uraiSitasi(berbahaya)).toBeNull();
    expect(uraiSitasi("uu ".repeat(5000))).toBeNull();
    expect(performance.now() - mulai).toBeLessThan(500);
  });
});

describe("integrasi dengan pengurai kueri dan pengurai relasi", () => {
  it("uraiKueri memberikan sitasi yang sama, termasuk sektor POJK", () => {
    expect(uraiKueri("Peraturan Pemerintah Nomor 35 Tahun 2021").sitasi).toEqual({ jenis: "PP", nomor: "35", tahun: 2021 });
    expect(uraiKueri("POJK 48/POJK.04/2016").sitasi).toEqual({ jenis: "POJK", nomor: "48", tahun: 2016, sub: "04" });
    expect(uraiKueri("cuti melahirkan").sitasi).toBeNull();
  });

  it("sitasiDariTeks tidak lagi membaca PERPPU sebagai UU", () => {
    expect(sitasiDariTeks("Peraturan Pemerintah Pengganti Undang-Undang Nomor 1 Tahun 2020 tentang Kebijakan Keuangan Negara")).toEqual({
      jenis: "PERPPU", nomor: "1", tahun: 2020,
    });
    expect(sitasiDariTeks("Peraturan Pemerintah Pengganti Undang-Undang (Perpu) Nomor 1 Tahun 1962")).toEqual({
      jenis: "PERPPU", nomor: "1", tahun: 1962,
    });
  });

  it("sitasiDariTeks mengenali Peraturan Menteri dan tetap memakai pola lama sebagai cadangan", () => {
    expect(sitasiDariTeks("Peraturan Menteri Nomor 29 Tahun 2025 tentang Pedoman")).toEqual({ jenis: "PERMEN", nomor: "29", tahun: 2025 });
    // Cadangan: kata sisipan sampai 30 karakter, yang tak dicakup tata bahasa ketat.
    expect(sitasiDariTeks("Undang-Undang Cipta Kerja No. 11 Tahun 2020")).toEqual({ jenis: "UU", nomor: "11", tahun: 2020 });
    expect(sitasiDariTeks("TAP MPR No. 5 Tahun 1998")).toEqual({ jenis: "TAP_MPR", nomor: "5", tahun: 1998 });
    expect(sitasiDariTeks("tidak ada sitasi di sini")).toBeNull();
  });
});
