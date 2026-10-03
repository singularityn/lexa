/**
 * Fungsi murni antarmuka (public/js/format.js): pelabelan, URL, pengelompokan
 * pasal, tata letak graf, dan penguraian jawaban model. Tanpa DOM.
 */
import { describe, expect, it } from "vitest";
import {
  angka, bacaFilter, bacaTeksModel, bersihkanArtefak, blokKeTeks, istilahDariKueri, jangkarDariId, kelompokkanPasal,
  kodeJenis, labelJenis, labelRelasi, labelStatus, namaLengkap, nomorTahun, queryString, sisiUnik, sitasi,
  sitasiPasal, tanggalIndonesia, tataLetakGraf, urlPeraturan,
} from "../public/js/format.js";
import { labelSitasi, nomorTahun as nomorTahunServer } from "../src/shared/label";

const artikel = (nomor: string, ayat: string | null, bab: string | null, urutan = 0, bagian: string | null = null) => ({
  id: `/akn/id/act/uu/2003/13#pasal-${nomor}${ayat ? `-ayat-${ayat}` : ""}`,
  frbr_uri: "/akn/id/act/uu/2003/13", nomor_pasal: nomor, ayat, bab, bagian, judul: null, isi: `isi ${nomor}/${ayat ?? "-"}`, urutan,
});

describe("pelabelan", () => {
  it("sitasi dan nama lengkap", () => {
    const uu = { jenis: "UU", nomor: "13", tahun: 2003 };
    expect(sitasi(uu)).toBe("UU 13/2003");
    expect(namaLengkap(uu)).toBe("Undang-Undang Nomor 13 Tahun 2003");
    expect(sitasiPasal(uu, "82", "1")).toBe("UU 13/2003 Pasal 82 ayat (1)");
    expect(sitasiPasal(uu, "156")).toBe("UU 13/2003 Pasal 156");
    expect(sitasiPasal(uu, null)).toBe("UU 13/2003");
  });

  it("POJK lama bernomor slug ditulis dengan penomoran resminya", () => {
    const pojk = { jenis: "POJK", nomor: "48-pojk-04-2016", tahun: 2016 };
    expect(sitasi(pojk)).toBe("POJK 48/POJK.04/2016");
    expect(sitasiPasal(pojk, "5", "2")).toBe("POJK 48/POJK.04/2016 Pasal 5 ayat (2)");
    expect(namaLengkap(pojk)).toBe("Peraturan OJK Nomor 48/POJK.04/2016");
    // POJK bernomor polos dan jenis lain tidak berubah.
    expect(sitasi({ jenis: "POJK", nomor: "23", tahun: 2023 })).toBe("POJK 23/2023");
    expect(namaLengkap({ jenis: "POJK", nomor: "23", tahun: 2023 })).toBe("Peraturan OJK Nomor 23 Tahun 2023");
    // Slug pada jenis lain bukan urusan format ini.
    expect(sitasi({ jenis: "PP", nomor: "1-pojk-03-2019", tahun: 2019 })).toBe("PP 1-pojk-03-2019/2019");
  });

  it("pemformat label di Worker (src/shared/label.ts) dan antarmuka (format.js) selalu sama", () => {
    const kasus = [
      { jenis: "UU", nomor: "13", tahun: 2003 },
      { jenis: "POJK", nomor: "48-pojk-04-2016", tahun: 2016 },
      { jenis: "POJK", nomor: "1-POJK-05-2019", tahun: 2019 },
      { jenis: "POJK", nomor: "23", tahun: 2023 },
      { jenis: "POJK", nomor: "48-pojk-4-2016", tahun: 2016 }, // bukan bentuk slug yang sah
      { jenis: "PERMEN", nomor: "pmk91+", tahun: 2024 },
      { jenis: "TAP_MPR", nomor: "XVI/MPR/1998", tahun: 1998 },
    ];
    for (const k of kasus) {
      expect(nomorTahun(k.jenis, k.nomor, k.tahun), JSON.stringify(k)).toBe(nomorTahunServer(k.jenis, k.nomor, k.tahun));
      // Antarmuka memendekkan kode jenis (PERDA_PROV -> PERDA); untuk jenis di atas keduanya identik.
      expect(sitasi(k), JSON.stringify(k)).toBe(labelSitasi(k).replace("TAP_MPR", "TAP MPR"));
    }
  });

  it("jenis bersufiks provinsi/kabupaten dipersingkat pada sitasi, jenis tak dikenal tetap terbaca", () => {
    expect(sitasi({ jenis: "PERDA_PROV", nomor: "5", tahun: 2020 })).toBe("PERDA 5/2020");
    expect(kodeJenis("TAP_MPR")).toBe("TAP MPR");
    expect(labelJenis("PERDA_KAB")).toBe("Perda Kabupaten/Kota");
    expect(labelJenis("ASING_BARU")).toBe("ASING BARU");
  });

  it("status dan relasi", () => {
    expect(labelStatus("dicabut")).toBe("Dicabut");
    expect(labelStatus(null)).toBe("Status tidak diketahui");
    expect(labelRelasi("diubah_oleh")).toBe("Diubah oleh");
    expect(labelRelasi("jenis_baru")).toBe("jenis baru");
  });

  it("tanggal Indonesia dan angka", () => {
    expect(tanggalIndonesia("2003-03-25")).toBe("25 Maret 2003");
    expect(tanggalIndonesia("2020-11-02T00:00:00Z")).toBe("2 November 2020");
    expect(tanggalIndonesia(null)).toBe("");
    expect(tanggalIndonesia("tidak jelas")).toBe("tidak jelas");
    expect(angka(305000)).toBe("305.000");
    expect(angka(null)).toBe("0");
  });
});

describe("URL", () => {
  it("queryString membuang nilai kosong dan menggabung larik dengan koma", () => {
    expect(queryString({ q: "pesangon", jenis: ["UU", "PP"], status: [], tahun_min: undefined, x: "", y: null, z: false })).toBe("?q=pesangon&jenis=UU%2CPP");
    expect(queryString({})).toBe("");
  });

  it("urlPeraturan sama dengan bentuk pada sitemap dan membawa kueri serta jangkar", () => {
    expect(urlPeraturan("/akn/id/act/uu/2023/6")).toBe(`/peraturan?uri=${encodeURIComponent("/akn/id/act/uu/2023/6")}`);
    expect(urlPeraturan("/akn/id/act/uu/2003/13", { q: "uang pesangon", jangkar: "pasal-156-ayat-1" })).toBe(
      "/peraturan?uri=%2Fakn%2Fid%2Fact%2Fuu%2F2003%2F13&q=uang+pesangon#pasal-156-ayat-1",
    );
  });

  it("jangkarDariId mengambil bagian setelah # dan mempertahankan akhiran ~n yang sah", () => {
    expect(jangkarDariId("/akn/id/act/uu/2003/13#pasal-82-ayat-1")).toBe("pasal-82-ayat-1");
    expect(jangkarDariId("/akn/id/act/uu/2010/10#pasal-8-ayat-2~2")).toBe("pasal-8-ayat-2~2");
    expect(jangkarDariId(null)).toBe("");
    expect(jangkarDariId("tanpa-tanda")).toBe("tanpa-tanda");
  });

  it("bacaFilter menormalkan parameter pencarian", () => {
    const p = new URLSearchParams("q=%20cuti%20&mode=keyword&jenis=UU,PP&jenis=PERPRES&status=dicabut&tahun_min=2000&tahun_max=abc&bidang=PAJAK");
    expect(bacaFilter(p)).toEqual({
      q: "cuti", mode: "keyword", jenis: ["UU", "PP", "PERPRES"], status: ["dicabut"],
      tahun_min: 2000, tahun_max: undefined, bidang: "PAJAK",
    });
    expect(bacaFilter(new URLSearchParams("mode=ngawur")).mode).toBe("hybrid");
    expect(bacaFilter(new URLSearchParams("")).jenis).toEqual([]);
  });

  it("istilahDariKueri membuang kata henti dan kata pendek, tanpa duplikat", () => {
    expect(istilahDariKueri("Uang pesangon dan uang penghargaan untuk pekerja")).toEqual(["uang", "pesangon", "penghargaan", "pekerja"]);
    expect(istilahDariKueri("perundang-undangan")).toEqual(["perundang-undangan"]);
    expect(istilahDariKueri("a di")).toEqual([]);
    expect(istilahDariKueri(null)).toEqual([]);
  });
});

describe("kelompokkanPasal", () => {
  it("menggabung ayat berurutan dalam satu pasal dan menandai bab baru", () => {
    const g = kelompokkanPasal([
      artikel("1", null, "BAB I", 0),
      artikel("2", "1", "BAB I", 1),
      artikel("2", "2", "BAB I", 2),
      artikel("3", null, "BAB II", 3),
    ]);
    expect(g.map((x) => [x.nomor, x.butir.length, x.babBaru])).toEqual([["1", 1, true], ["2", 2, false], ["3", 1, true]]);
    expect(g.map((x) => x.jangkar)).toEqual(["pasal-1", "pasal-2", "pasal-3"]);
  });

  it("bab yang sama tidak diulang, dan pasal tanpa bab tidak memutus kelanjutan bab", () => {
    const g = kelompokkanPasal([artikel("1", null, "BAB I"), artikel("2", null, null), artikel("3", null, "BAB I")]);
    expect(g.map((x) => x.babBaru)).toEqual([true, false, false]);
  });

  it("jangkar kelompok mengikuti id pasal, tanpa bagian -ayat-", () => {
    expect(kelompokkanPasal([artikel("82", "1", null)])[0].jangkar).toBe("pasal-82");
  });
});

describe("graf relasi", () => {
  it("sisiUnik menggambar satu garis per pasangan, memilih jenis yang paling berpengaruh", () => {
    const sisi = sisiUnik([
      { dari: "A", ke: "B", jenis: "dicabut_oleh" },
      { dari: "B", ke: "A", jenis: "mencabut" },
      { dari: "A", ke: "C", jenis: "terkait" },
    ]);
    expect(sisi).toHaveLength(2);
    expect(sisi.find((s) => s.ke === "A" || s.dari === "B")).toMatchObject({ dari: "B", ke: "A", jenis: "mencabut" });
  });

  it("tataLetakGraf menaruh pusat di tengah, tetangga di cincin pertama, dan semua simpul berada di dalam kanvas", () => {
    const simpul = [{ uri: "P", jarak: 0 }, ...Array.from({ length: 12 }, (_, i) => ({ uri: `T${i}`, jarak: 1 })), { uri: "X", jarak: 2 }];
    const sisi = [...simpul.slice(1, 13).map((s) => ({ dari: "P", ke: s.uri })), { dari: "T3", ke: "X" }];
    const t = tataLetakGraf(simpul, sisi, "P");
    expect(t.posisi.get("P")).toMatchObject({ x: t.lebar / 2, y: t.tinggi / 2 });
    for (const n of simpul) {
      const p = t.posisi.get(n.uri)!;
      expect(p.x - t.lebarSimpul / 2).toBeGreaterThanOrEqual(0);
      expect(p.x + t.lebarSimpul / 2).toBeLessThanOrEqual(t.lebar);
      expect(p.y - t.tinggiSimpul / 2).toBeGreaterThanOrEqual(0);
      expect(p.y + t.tinggiSimpul / 2).toBeLessThanOrEqual(t.tinggi);
    }
    // Simpul pada cincin yang sama berjarak sama dari pusat.
    const jarak = (u: string) => Math.hypot(t.posisi.get(u)!.x - t.lebar / 2, t.posisi.get(u)!.y - t.tinggi / 2);
    expect(jarak("T0")).toBeCloseTo(jarak("T7"), 3);
    expect(jarak("X")).toBeGreaterThan(jarak("T0"));
  });

  it("tanpa tetangga tetap menghasilkan kanvas yang sah", () => {
    const t = tataLetakGraf([{ uri: "P", jarak: 0 }], [], "P");
    expect(t.lebar).toBeGreaterThan(0);
    expect(t.posisi.size).toBe(1);
  });
});

describe("bacaTeksModel (jawaban model)", () => {
  it("paragraf dipisah baris kosong; baris berurutan digabung", () => {
    expect(bacaTeksModel("Baris satu\nbaris dua.\n\nParagraf kedua.")).toEqual([
      { tipe: "p", isi: [{ teks: "Baris satu baris dua.", tebal: false }] },
      { tipe: "p", isi: [{ teks: "Paragraf kedua.", tebal: false }] },
    ]);
  });

  it("daftar bebas dan bernomor, serta teks tebal", () => {
    const blok = bacaTeksModel("Dasar:\n\n- **UU 13/2003 Pasal 82**: istirahat\n- butir dua\n\n1. satu\n2. dua");
    expect(blok.map((b) => b.tipe)).toEqual(["p", "ul", "ol"]);
    expect(blok[1]).toMatchObject({ butir: [[{ teks: "UU 13/2003 Pasal 82", tebal: true }, { teks: ": istirahat", tebal: false }], [{ teks: "butir dua", tebal: false }]] });
  });

  it("markup lain dianggap teks biasa: tag HTML tidak pernah menjadi elemen", () => {
    const blok = bacaTeksModel('<img src=x onerror=alert(1)> dan <script>x</script>');
    expect(blok).toEqual([{ tipe: "p", isi: [{ teks: '<img src=x onerror=alert(1)> dan <script>x</script>', tebal: false }] }]);
  });

  it("judul markdown menjadi paragraf tebal; tebal yang tak ditutup tidak merusak", () => {
    expect(bacaTeksModel("### Ringkasan")[0]).toEqual({ tipe: "p", isi: [{ teks: "Ringkasan", tebal: true }] });
    expect(() => bacaTeksModel("**tidak ditutup")).not.toThrow();
  });

  it("blokKeTeks mengembalikan teks polos untuk disalin", () => {
    expect(blokKeTeks(bacaTeksModel("Halo **dunia**\n\n- a\n- b"))).toBe("Halo dunia\n\n- a\n- b");
  });
});

describe("bersihkanArtefak (penanda halaman hasil konversi PDF)", () => {
  it.each([
    ["Cukup jelas    ### Page 97 PRESIDEN REPUBLIK INDONESIA- 18 -", "Cukup jelas"],
    ["### Page 98 PRESIDEN REPUBLIK INDONESIA- 19 -Ayat (1) Cukup jelas Ayat (2) Yang dimaksud", "Ayat (1) Cukup jelas Ayat (2) Yang dimaksud"],
    ["### Page 91 PRESIDEN REPUBLIK INDONESIA- 12 -Sertifikasi dapat dilakukan", "Sertifikasi dapat dilakukan"],
    ["kalimat awal ### Page 5 MENTERI KEUANGAN REPUBLIK INDONESIA - 3 - lanjutan kalimat", "kalimat awal lanjutan kalimat"],
    ["teks ### Page 12 lanjutan", "teks lanjutan"],
  ])("%j -> %j", (masukan, harapan) => {
    expect(bersihkanArtefak(masukan)).toBe(harapan);
  });

  it("teks biasa, kata 'Page' dalam kalimat, dan rujukan pasal tidak tersentuh", () => {
    for (const t of ["Dalam hal terjadi pemutusan hubungan kerja.", "Lihat Page 3 dari lampiran.", "Pasal 5 ayat (2) ### bukan penanda"]) {
      expect(bersihkanArtefak(t)).toBe(t);
    }
  });

  it("null dan kosong menghasilkan string kosong", () => {
    expect(bersihkanArtefak(null)).toBe("");
    expect(bersihkanArtefak("")).toBe("");
  });
});
