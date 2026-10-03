/**
 * Fungsi murni antarmuka (public/js/format.js): pelabelan, URL, pengelompokan
 * pasal, tata letak graf, dan penguraian jawaban model. Tanpa DOM.
 */
import { describe, expect, it } from "vitest";
import {
  angka, bacaFilter, bacaTeksModel, bersihkanArtefak, blokKeTeks, daftarBidang, istilahDariKueri, jangkarDariId,
  hitungPasal, judulRingkas, kelompokkanPasal, kodeJenis, labelJenis, labelRelasi, labelStatus, namaLengkap, namaPasal, nomorTahun, pisahJudul,
  bacaIsiPasal, pisahPenjelasanTertanam, queryString, rapikanHuruf, sisiUnik, sitasi, sitasiPasal, strukturDaftarIsi, tanggalIndonesia, tataLetakGraf, teksPasal, urlPeraturan,
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

  describe("Penjelasan (nomor pasal yang berulang sampai akhir dokumen)", () => {
    /** Id seperti yang dibuat idPasalUnik saat ingest: kemunculan kedua mendapat akhiran ~2. */
    const kembar = (nomor: string, ayat: string | null = null) => {
      const a = artikel(nomor, ayat, "BAB II");
      return { ...a, id: `${a.id}~2` };
    };
    const batang = [artikel("1", null, "BAB I"), artikel("2", null, "BAB II"), artikel("3", null, "BAB II")];

    it("menandai rangkaian berulang di akhir sebagai penjelasan, dengan jangkar yang tidak bertabrakan", () => {
      const g = kelompokkanPasal([...batang, kembar("1"), kembar("2"), kembar("3")]);
      expect(g.map((x) => x.penjelasan)).toEqual([false, false, false, true, true, true]);
      expect(g.map((x) => x.penjelasanBaru)).toEqual([false, false, false, true, false, false]);
      expect(g.map((x) => x.jangkar)).toEqual(["pasal-1", "pasal-2", "pasal-3", "pasal-1~2", "pasal-2~2", "pasal-3~2"]);
      expect(new Set(g.map((x) => x.jangkar)).size).toBe(6);
    });

    it("penjelasan berayat tetap mendapat jangkar sendiri (pasal-5-ayat-1~2 menjadi pasal-5~2)", () => {
      const g = kelompokkanPasal([...batang, kembar("1"), kembar("2", "1"), { ...kembar("2", "2") }, kembar("3")]);
      expect(g.map((x) => x.jangkar)).toEqual(["pasal-1", "pasal-2", "pasal-3", "pasal-1~2", "pasal-2~2", "pasal-3~2"]);
      expect(g[4].butir).toHaveLength(2);
      expect(g[4].penjelasan).toBe(true);
    });

    it("satu atau dua nomor kembar di tengah peraturan bukan penjelasan", () => {
      const g = kelompokkanPasal([artikel("1", null, "BAB I"), artikel("2", null, "BAB I"), kembar("2"), artikel("3", null, "BAB II"), artikel("4", null, "BAB II")]);
      expect(g.some((x) => x.penjelasan)).toBe(false);
      // Ujung dokumen yang hanya dua nomor berulang juga terlalu pendek untuk disebut penjelasan.
      expect(kelompokkanPasal([...batang, kembar("2"), kembar("3")]).some((x) => x.penjelasan)).toBe(false);
    });

    it("penomoran yang kembali ke awal setelah nomor tinggi menandai awal penjelasan, walau id-nya tidak berakhiran ~n", () => {
      // Sebagian nomor di penjelasan bukan kembar (pasalnya tidak berhasil diekstrak dari batang tubuh): id polos.
      const nomorBatang = Array.from({ length: 30 }, (_, i) => String(i + 1));
      const baris = [
        ...nomorBatang.map((n) => artikel(n, null, "BAB I")),
        ...["1", "2", "3", "4", "5", "6"].map((n) => (n === "4" ? { ...artikel(n, null, "BAB I"), id: `/akn/id/act/uu/2003/13#pasal-${n}~9` } : { ...kembar(n) })),
      ];
      const g = kelompokkanPasal(baris);
      const awal = g.findIndex((x) => x.penjelasanBaru);
      expect(awal).toBe(30);
      expect(g.slice(awal).every((x) => x.penjelasan)).toBe(true);
      expect(g.slice(0, awal).some((x) => x.penjelasan)).toBe(false);
    });

    it("penurunan tunggal di tengah teks (salah deteksi) bukan awal penjelasan", () => {
      const nomor = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "9", "18", "19", "20", "21", "22"];
      const g = kelompokkanPasal(nomor.map((n, i) => (i === 17 ? { ...artikel(n, null, "BAB I"), id: `/akn/id/act/uu/2003/13#pasal-9~2` } : artikel(n, null, "BAB I"))));
      expect(g.some((x) => x.penjelasan)).toBe(false);
    });

    it("peraturan tanpa nomor berulang tidak punya penjelasan", () => {
      expect(kelompokkanPasal(batang).some((x) => x.penjelasan || x.penjelasanBaru)).toBe(false);
      expect(kelompokkanPasal([])).toEqual([]);
    });
  });
});

describe("pisahPenjelasanTertanam", () => {
  const ttd = "Disahkan di Jakarta\npada tanggal 25 Maret 2003\nPRESIDEN REPUBLIK INDONESIA,\nttd\nMEGAWATI SOEKARNOPUTRI\nLEMBARAN NEGARA REPUBLIK INDONESIA TAHUN 2003 NOMOR 39";

  it("memisahkan penjelasan umum dari teks pasal terakhir, termasuk kepala halaman yang menempel", () => {
    const teks = `Undang undang ini mulai berlaku.\n${ttd}\n\n\n\n### Page 80\nPRESIDEN\nREPUBLIK INDONESIAPENJELASAN\nATAS\nUNDANG-UNDANG REPUBLIK INDONESIA\nNOMOR 13 TAHUN 2003\nTENTANG\nKETENAGAKERJAAN\nI. UMUM\nPembangunan ketenagakerjaan adalah bagian dari pembangunan nasional.\nII. PASAL DEMI PASAL`;
    const r = pisahPenjelasanTertanam(teks)!;
    expect(r.batang.endsWith("TAHUN 2003 NOMOR 39")).toBe(true);
    expect(r.batang).not.toMatch(/Page|PRESIDEN\s*$/);
    expect(r.umum).toBe("Pembangunan ketenagakerjaan adalah bagian dari pembangunan nasional.");
  });

  it("mengenali tata letak yang kata-katanya menempel (hasil konversi lain)", () => {
    const teks = "Pasal terakhir.\n\n### Page 57\n\nPENJELASANATASUNDANG-UNDANG REPUBLIK INDONESIANOMOR 7 TAHUN 2014013TENTANGPERDAGANGAN\n\n\n- I. UMUM\n\nIsi umum.";
    const r = pisahPenjelasanTertanam(teks)!;
    expect(r.batang).toBe("Pasal terakhir.");
    expect(r.umum).toBe("Isi umum.");
  });

  it("tanpa judul 'I. UMUM' seluruh naskah sesudah penanda dipertahankan; tanpa penanda hasilnya null", () => {
    const r = pisahPenjelasanTertanam("Isi.\nPENJELASAN\nATAS\nPERATURAN PEMERINTAH\nuraian tanpa nomor romawi")!;
    expect(r.batang).toBe("Isi.");
    expect(r.umum).toContain("uraian tanpa nomor romawi");
    expect(pisahPenjelasanTertanam("Pasal biasa yang menyebut penjelasan atas permintaan.")).toBeNull();
  });
});

describe("kelompokkanPasal: penjelasan yang terbawa di pasal terakhir", () => {
  const isiAkhir = "Undang undang ini mulai berlaku.\nLEMBARAN NEGARA NOMOR 39\n\n### Page 80\nPENJELASAN\nATAS\nUNDANG-UNDANG REPUBLIK INDONESIA\nI. UMUM\nUraian umum.\nII. PASAL DEMI PASAL";
  const kembar = (nomor: string) => ({ ...artikel(nomor, null, "BAB I"), id: `/akn/id/act/uu/2003/13#pasal-${nomor}~2`, isi: "Cukup jelas." });

  it("memotong pasal terakhir, membuat kelompok 'Umum', dan menandai pasal-pasal sesudahnya sebagai penjelasan", () => {
    const g = kelompokkanPasal([artikel("1", null, "BAB I"), { ...artikel("2", null, "BAB I"), isi: isiAkhir }, kembar("1"), kembar("2")]);
    expect(g.map((x) => [x.nomor, x.penjelasan, x.penjelasanBaru])).toEqual([
      ["1", false, false], ["2", false, false], ["Umum", true, true], ["1", true, false], ["2", true, false],
    ]);
    expect(g[1].butir[0].isi).toBe("Undang undang ini mulai berlaku.\nLEMBARAN NEGARA NOMOR 39");
    expect(g[2].jangkar).toBe("penjelasan-umum");
    expect(g[2].butir[0].isi).toBe("Uraian umum.");
    expect(new Set(g.map((x) => x.jangkar)).size).toBe(g.length);
  });

  it("tidak mengubah objek masukan", () => {
    const masukan = [{ ...artikel("2", null, "BAB I"), isi: isiAkhir }];
    kelompokkanPasal(masukan);
    expect(masukan[0].isi).toBe(isiAkhir);
  });

  it("pasal yang seluruh isinya penjelasan tidak menyisakan kelompok kosong", () => {
    const g = kelompokkanPasal([artikel("1", null, "BAB I"), { ...artikel("2", null, "BAB I"), isi: "PENJELASAN\nATAS\nUNDANG-UNDANG\nI. UMUM\nUraian." }]);
    expect(g.map((x) => [x.nomor, x.penjelasan])).toEqual([["1", false], ["Umum", true]]);
  });
});

describe("namaPasal dan hitungPasal", () => {
  it("nama kelompok: pasal, penjelasan pasal, dan penjelasan umum", () => {
    expect(namaPasal({ nomor: "82", penjelasan: false })).toBe("Pasal 82");
    expect(namaPasal({ nomor: "82", penjelasan: true })).toBe("Penjelasan Pasal 82");
    expect(namaPasal({ nomor: "Umum", penjelasan: true })).toBe("Penjelasan Umum");
  });

  it("jumlah pasal tidak menghitung penjelasan dan tidak menghitung nomor kembar dua kali", () => {
    const g = [
      { nomor: "1", penjelasan: false }, { nomor: "2", penjelasan: false }, { nomor: "9", penjelasan: false }, { nomor: "9", penjelasan: false },
      { nomor: "5A", penjelasan: false }, { nomor: "5a", penjelasan: false },
      { nomor: "Umum", penjelasan: true }, { nomor: "1", penjelasan: true }, { nomor: "2", penjelasan: true },
    ];
    expect(hitungPasal(g)).toBe(4);
    expect(hitungPasal([])).toBe(0);
  });
});

describe("strukturDaftarIsi", () => {
  it("mengelompokkan pasal menurut BAB, mempertahankan pasal tanpa BAB di awal", () => {
    const s = strukturDaftarIsi(kelompokkanPasal([artikel("1", null, null), artikel("2", null, "BAB I"), artikel("3", null, "BAB I"), artikel("4", null, "BAB II")]));
    expect(s.map((x) => [x.bab, x.pasal.map((p) => p.nomor)])).toEqual([[null, ["1"]], ["BAB I", ["2", "3"]], ["BAB II", ["4"]]]);
    expect(s.every((x) => !x.penjelasan)).toBe(true);
  });

  it("penjelasan menjadi kelompok tersendiri walau BAB terakhir terbawa di barisnya", () => {
    const kembar = (nomor: string) => ({ ...artikel(nomor, null, "BAB II"), id: `/akn/id/act/uu/2003/13#pasal-${nomor}~2` });
    const s = strukturDaftarIsi(kelompokkanPasal([artikel("1", null, "BAB I"), artikel("2", null, "BAB II"), kembar("1"), kembar("2"), kembar("3")]));
    expect(s.map((x) => [x.bab, x.penjelasan, x.pasal.map((p) => p.nomor)])).toEqual([
      ["BAB I", false, ["1"]],
      ["BAB II", false, ["2"]],
      [null, true, ["1", "2", "3"]],
    ]);
    expect(s[2].pasal.map((p) => p.jangkar)).toEqual(["pasal-1~2", "pasal-2~2", "pasal-3~2"]);
  });
});

describe("teksPasal (untuk disalin)", () => {
  const dengan = (isi: string[], ekstra: Partial<ReturnType<typeof artikel>> = {}) =>
    kelompokkanPasal(isi.map((t, i) => ({ ...artikel("82", String(i + 1), null, i), isi: t, ...ekstra })))[0];

  it("memuat baris 'Pasal N', lalu tiap ayat berawalan nomornya", () => {
    expect(teksPasal(dengan(["Satu.", "Dua."]))).toBe("Pasal 82\n(1) Satu.\n(2) Dua.");
  });

  it("tanpa kepala bila sitasi lengkap sudah ditulis di atasnya", () => {
    expect(teksPasal(dengan(["Satu.", "Dua."]), { kepala: false })).toBe("(1) Satu.\n(2) Dua.");
  });

  it("butir bersusun ikut dengan penandanya", () => {
    const g = kelompokkanPasal([{ ...artikel("5", null, null), isi: "Pengusaha adalah :\na. orang;\nb. badan hukum." }])[0];
    expect(teksPasal(g)).toBe("Pasal 5\nPengusaha adalah :\na. orang;\nb. badan hukum.");
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

  it.each([
    ["milik sendiri; PRESIDEN\nREPUBLIK INDONESIA- 3 -\nb. orang perseorangan", "milik sendiri;\nb. orang perseorangan"],
    ["yang berada di PRESIDEN REPUBLIK INDONESIA - 12 -\nIndonesia mewakili", "yang berada di\nIndonesia mewakili"],
    ["ketentuan MENTERI KEUANGAN REPUBLIK INDONESIA - 7 - lanjutan", "ketentuan lanjutan"],
    ["kalimat\n- 12 -\nberikutnya", "kalimat\n\nberikutnya"],
    ["WALI KOTA BANDUNG\nREPUBLIK INDONESIA- 9 -\nPasal 5", "Pasal 5"],
  ])("kepala halaman cetak tanpa penanda dibuang: %j", (masukan, harapan) => {
    expect(bersihkanArtefak(masukan)).toBe(harapan);
  });

  it("kalimat biasa yang menyebut 'Republik Indonesia' atau memuat angka dengan tanda hubung tidak tersentuh", () => {
    for (const t of [
      "Presiden Republik Indonesia menetapkan peraturan ini.",
      "NEGARA KESATUAN REPUBLIK INDONESIA adalah negara hukum.",
      "Pasal 5 - 7 mengatur hal yang sama, sedangkan 10 - 12 tidak.",
      "Pemerintah Republik Indonesia - 3 hal - dilarang.",
    ]) {
      expect(bersihkanArtefak(t)).toBe(t);
    }
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

describe("rapikanHuruf (judul dan nama bidang dari BPK)", () => {
  it.each([
    // Seluruhnya huruf besar: huruf judul, kata sambung kecil, singkatan dan angka Romawi dipertahankan.
    ["TATA CARA HUBUNGAN ANTAR LEMBAGA BADAN PENYELENGGARA JAMINAN SOSIAL", "Tata Cara Hubungan Antar Lembaga Badan Penyelenggara Jaminan Sosial"],
    ["KAWASAN EKONOMI KHUSUS LIKUPANG", "Kawasan Ekonomi Khusus Likupang"],
    ["APBN", "APBN"],
    ["APBN - BUMN", "APBN - BUMN"],
    ["PENGESAHAN DAN / ATAU PEMBATALAN PERSETUJUAN / KONVENSI", "Pengesahan dan / atau Pembatalan Persetujuan / Konvensi"],
    ["BEA CUKAI, EKSPOR-IMPOR, KEPABEANAN", "Bea Cukai, Ekspor-Impor, Kepabeanan"],
    ["PENGGANTIAN KERUGIAN ANGGOTA-ANGGOTA \"DEWAN PERWAKILAN RAKYAT\"", "Penggantian Kerugian Anggota-Anggota \"Dewan Perwakilan Rakyat\""],
    ["RENCANA AKSI NASIONAL HAK ASASI MANUSIA TAHUN 2021 - 2025", "Rencana Aksi Nasional Hak Asasi Manusia Tahun 2021 - 2025"],
    ["PENGELOLAAN BPK DAN DPR DI MPR UNTUK TNI POLRI", "Pengelolaan BPK dan DPR di MPR untuk TNI POLRI"],
    ["PENANGANAN COVID-19 BAB IV", "Penanganan COVID-19 Bab IV"],
    ["BAB IV DAN VII", "Bab IV dan VII"],
    // Campuran: hanya kata sambung berkapital yang diturunkan; sisanya persis.
    ["Pemberian Uang Kompensasi/penghargaan Bagi Ketua Dan Anggota", "Pemberian Uang Kompensasi/penghargaan bagi Ketua dan Anggota"],
    ["Perubahan Kedua Atas Undang-Undang Nomor 8 Tahun 2019", "Perubahan Kedua atas Undang-Undang Nomor 8 Tahun 2019"],
    ["Ketenagakerjaan", "Ketenagakerjaan"],
    ["Dan seterusnya", "Dan seterusnya"], // kata pertama tidak diturunkan
    ["  spasi   berlebih  ", "spasi berlebih"],
  ])("%j -> %j", (masukan, harapan) => {
    expect(rapikanHuruf(masukan)).toBe(harapan);
  });

  it("kosong dan null menghasilkan string kosong; idempoten", () => {
    expect(rapikanHuruf(null)).toBe("");
    expect(rapikanHuruf("")).toBe("");
    for (const t of ["TATA CARA", "Tata Cara Dan Pengelolaan", "BEA CUKAI, EKSPOR-IMPOR"]) expect(rapikanHuruf(rapikanHuruf(t))).toBe(rapikanHuruf(t));
  });
});

describe("pisahJudul / judulRingkas", () => {
  it("memisahkan kepala resmi dan topik", () => {
    expect(pisahJudul("Peraturan Pemerintah Nomor 85 Tahun 2013 tentang TATA CARA HUBUNGAN")).toEqual({
      kepala: "Peraturan Pemerintah Nomor 85 Tahun 2013", topik: "TATA CARA HUBUNGAN",
    });
    expect(pisahJudul("Undang-undang (UU) Nomor 14 Tahun 2025 tentang Perubahan Ketiga atas Undang-Undang Nomor 8 Tahun 2019 tentang Ibadah Haji")).toEqual({
      kepala: "Undang-undang (UU) Nomor 14 Tahun 2025", topik: "Perubahan Ketiga atas Undang-Undang Nomor 8 Tahun 2019 tentang Ibadah Haji",
    });
    expect(pisahJudul("Peraturan Badan Nomor 33-pojk-04-2020 Tahun 2020 tentang Laporan Keuangan").kepala).toBe("Peraturan Badan Nomor 33-pojk-04-2020 Tahun 2020");
    expect(pisahJudul("Peraturan Menteri Nomor 59 Tahun 2025 tentang\nPembelian Kembali").topik).toBe("Pembelian Kembali");
  });

  it("judul yang bukan berbentuk 'Jenis Nomor N Tahun Y tentang …' dibiarkan utuh", () => {
    for (const j of ["Ketenagakerjaan", "Penetapan Peraturan Pemerintah Pengganti Undang-Undang Nomor 2 Tahun 2022 tentang Cipta Kerja menjadi Undang-Undang", ""]) {
      expect(pisahJudul(j)).toEqual({ kepala: null, topik: j });
    }
    expect(pisahJudul(null)).toEqual({ kepala: null, topik: "" });
  });

  it("judulRingkas = topik dengan huruf dirapikan", () => {
    expect(judulRingkas("Peraturan Pemerintah Nomor 85 Tahun 2013 tentang TATA CARA HUBUNGAN ANTAR LEMBAGA")).toBe("Tata Cara Hubungan Antar Lembaga");
    expect(judulRingkas("Peraturan Presiden Nomor 22 Tahun 2015 tentang Pemberian Uang Bagi Ketua Dan Anggota")).toBe("Pemberian Uang bagi Ketua dan Anggota");
    expect(judulRingkas("Ketenagakerjaan")).toBe("Ketenagakerjaan");
  });
});

describe("daftarBidang", () => {
  it("memecah bidang gabungan dengan ' - ' (bukan '-' rapat) dan merapikan huruf", () => {
    expect(daftarBidang("APBN - BUMN - KESEHATAN - JABATAN / PROFESI / KEAHLIAN")).toEqual(["APBN", "BUMN", "Kesehatan", "Jabatan / Profesi / Keahlian"]);
    expect(daftarBidang("BEA CUKAI, EKSPOR-IMPOR, KEPABEANAN")).toEqual(["Bea Cukai, Ekspor-Impor, Kepabeanan"]);
  });
  it("kosong, null, dan duplikat", () => {
    expect(daftarBidang(null)).toEqual([]);
    expect(daftarBidang("")).toEqual([]);
    expect(daftarBidang("PAJAK - PAJAK")).toEqual(["Pajak"]);
  });
});

describe("bacaIsiPasal (penyusunan ulang teks hasil ekstraksi PDF)", () => {
  const p = (teks: string) => ({ tipe: "p", teks });
  const butir = (penanda: string, teks: string, tingkat = 1) => ({ tipe: "butir", penanda, tingkat, teks });

  it("menyambung baris yang patah di tengah kalimat, dan memperbaiki 'undang undang'", () => {
    const hasil = bacaIsiPasal(
      "Dalam undang undang ini yang dimaksud dengan :\n1. Ketenagakerjaan adalah segala hal yang berhubungan dengan tenaga kerja\npada waktu sebelum, selama, dan sesudah masa kerja.\n2. Tenaga kerja adalah setiap orang.",
    );
    expect(hasil).toEqual([
      p("Dalam undang-undang ini yang dimaksud dengan :"),
      butir("1.", "Ketenagakerjaan adalah segala hal yang berhubungan dengan tenaga kerja pada waktu sebelum, selama, dan sesudah masa kerja."),
      butir("2.", "Tenaga kerja adalah setiap orang."),
    ]);
  });

  it("butir huruf menjorok lebih dalam (tingkat 2) daripada butir angka; lanjutannya ikut tersambung", () => {
    expect(bacaIsiPasal("Pengusaha wajib:\na. membayar upah;\nb. memberi cuti\nselama 12 hari kerja; dan\nc. menjamin keselamatan.")).toEqual([
      p("Pengusaha wajib:"),
      butir("a.", "membayar upah;", 2),
      butir("b.", "memberi cuti selama 12 hari kerja; dan", 2),
      butir("c.", "menjamin keselamatan.", 2),
    ]);
  });

  it("ayat bernomor dalam satu baris dipecah, tetapi rujukan 'ayat (2)' di tengah kalimat tidak", () => {
    expect(bacaIsiPasal("(1) Pekerja berhak atas istirahat. (2) Pengusaha wajib melaksanakan.")).toEqual([
      butir("(1)", "Pekerja berhak atas istirahat."),
      butir("(2)", "Pengusaha wajib melaksanakan."),
    ]);
    const rujukan = "Sebagaimana dimaksud pada ayat (2) dan ayat (3) berlaku ketentuan Pasal 5.";
    expect(bacaIsiPasal(rujukan)).toEqual([p(rujukan)]);
    // Daftar huruf dalam satu baris hanya dipecah setelah titik koma.
    expect(bacaIsiPasal("meliputi: a. upah; b. cuti; dan c. tunjangan.")).toEqual([p("meliputi: a. upah;"), butir("b.", "cuti; dan c. tunjangan.", 2)]);
  });

  it("baris kosong memulai paragraf baru; baris berawal huruf besar tidak disambung", () => {
    expect(bacaIsiPasal("Paragraf satu belum selesai\n\nlanjutan setelah kosong")).toEqual([p("Paragraf satu belum selesai"), p("lanjutan setelah kosong")]);
    expect(bacaIsiPasal("Kalimat pertama tanpa titik\nKalimat kedua")).toEqual([p("Kalimat pertama tanpa titik"), p("Kalimat kedua")]);
  });

  it("kalimat yang sudah selesai tidak disambung dengan baris berikutnya, walau berawal huruf kecil", () => {
    expect(bacaIsiPasal("1. Butir pertama selesai.\nlalu teks liar")).toEqual([butir("1.", "Butir pertama selesai."), p("lalu teks liar")]);
  });

  it("penanda halaman PDF dibuang; 'perundang undangan' dipulihkan; kosong menghasilkan larik kosong", () => {
    expect(bacaIsiPasal("Cukup jelas    ### Page 97 PRESIDEN REPUBLIK INDONESIA- 18 -")).toEqual([p("Cukup jelas")]);
    expect(bacaIsiPasal("Peraturan perundang undangan nasional")).toEqual([p("Peraturan perundang-undangan nasional")]);
    expect(bacaIsiPasal("")).toEqual([]);
    expect(bacaIsiPasal(null)).toEqual([]);
    expect(bacaIsiPasal("   \n  \n")).toEqual([]);
  });

  it("kalimat yang patah setelah kata penghubung disambung walau lanjutannya berawal huruf besar (nama diri)", () => {
    expect(bacaIsiPasal("c. orang perseorangan yang berada di\nIndonesia mewakili perusahaan sebagaimana dimaksud.")).toEqual([
      butir("c.", "orang perseorangan yang berada di Indonesia mewakili perusahaan sebagaimana dimaksud.", 2),
    ]);
    expect(bacaIsiPasal("Pekerja, buruh,\nPengusaha wajib")).toEqual([p("Pekerja, buruh, Pengusaha wajib")]);
    // Tanpa tanda penghubung, baris berhuruf besar tetap paragraf baru.
    expect(bacaIsiPasal("Kalimat pertama tanpa titik\nKalimat kedua")).toEqual([p("Kalimat pertama tanpa titik"), p("Kalimat kedua")]);
  });

  it("baris panjang tanpa tanda akhir disambung walau lanjutannya berhuruf besar (nama jabatan, nama diri, rujukan pasal)", () => {
    expect(bacaIsiPasal("Ketentuan lebih lanjut mengenai tata cara perizinan diatur dengan Keputusan\nMenteri.")).toEqual([
      p("Ketentuan lebih lanjut mengenai tata cara perizinan diatur dengan Keputusan Menteri."),
    ]);
    expect(bacaIsiPasal("berhak atas uang pesangon sebesar 2 (dua) kali ketentuan\nPasal 156 ayat (2), uang penghargaan masa kerja.")).toEqual([
      p("berhak atas uang pesangon sebesar 2 (dua) kali ketentuan Pasal 156 ayat (2), uang penghargaan masa kerja."),
    ]);
    expect(bacaIsiPasal("Pembangunan nasional berdasarkan Pancasila dan Undang-undang Dasar Negara Republik Indonesia\nTahun 1945, dilaksanakan dalam rangka.")).toEqual([
      p("Pembangunan nasional berdasarkan Pancasila dan Undang-undang Dasar Negara Republik Indonesia Tahun 1945, dilaksanakan dalam rangka."),
    ]);
  });

  it("label struktur dan judul berhuruf kapital tetap berdiri sendiri, juga sesudah baris panjang", () => {
    const panjang = "Ketentuan penutup yang cukup panjang untuk mengisi satu baris penuh pada halaman";
    expect(bacaIsiPasal(`${panjang}\nParagraf 2\nAnak`)).toEqual([p(panjang), p("Paragraf 2"), p("Anak")]);
    expect(bacaIsiPasal(`${panjang}\nBAB XII`)).toEqual([p(panjang), p("BAB XII")]);
    expect(bacaIsiPasal(`${panjang}\nKETENAGAKERJAAN`)).toEqual([p(panjang), p("KETENAGAKERJAAN")]);
    expect(bacaIsiPasal(`${panjang}\nII. PASAL DEMI PASAL`)).toEqual([p(panjang), p("II. PASAL DEMI PASAL")]);
    // Baris pendek (judul sub-bagian) tidak disambung dengan teks berikutnya.
    expect(bacaIsiPasal("Dasar hukum\nPemberdayaan dan pendayagunaan tenaga kerja.")).toEqual([p("Dasar hukum"), p("Pemberdayaan dan pendayagunaan tenaga kerja.")]);
  });

  it("penunjuk bagian penjelasan ('Ayat (2)', 'Huruf b') menjadi label tersendiri dan teks sesudahnya paragraf baru", () => {
    const label = (teks: string) => ({ tipe: "label", teks });
    expect(bacaIsiPasal("Ayat (1)\nCukup jelas.\nAyat (2)\nHuruf a\nYang dimaksud dengan pelatihan kerja adalah\nkegiatan.\nHuruf b\nCukup jelas.")).toEqual([
      label("Ayat (1)"), p("Cukup jelas."), label("Ayat (2)"), label("Huruf a"), p("Yang dimaksud dengan pelatihan kerja adalah kegiatan."), label("Huruf b"), p("Cukup jelas."),
    ]);
    // Rujukan di tengah kalimat bukan label.
    expect(bacaIsiPasal("sebagaimana dimaksud pada Ayat (2) berlaku")).toEqual([p("sebagaimana dimaksud pada Ayat (2) berlaku")]);
  });

  it("kepala halaman cetak di tengah butir dibuang dan butir tetap utuh", () => {
    expect(bacaIsiPasal("a. perusahaan milik sendiri; PRESIDEN\nREPUBLIK INDONESIA- 3 -\nb. orang perseorangan yang berada di\nIndonesia mewakili.")).toEqual([
      butir("a.", "perusahaan milik sendiri;", 2),
      butir("b.", "orang perseorangan yang berada di Indonesia mewakili.", 2),
    ]);
  });

  it("angka biasa di awal baris tanpa titik bukan butir", () => {
    expect(bacaIsiPasal("2003 tentang Ketenagakerjaan\n1,5 bulan sebelum")).toEqual([p("2003 tentang Ketenagakerjaan 1,5 bulan sebelum")]);
  });
});
