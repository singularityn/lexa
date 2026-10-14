import { describe, expect, it } from "vitest";
import {
  frbrDari,
  idPasal,
  idPasalUnik,
  nilaiKualitasEkstraksi,
  periksaKecocokanNaskah,
  petakanDokumen,
  relasiDari,
  sitasiDariTeks,
  statusDari,
  tanggalIndonesia,
  uraikanPasal,
  urlBpk,
} from "../src/worker/lib/bpk";

describe("urlBpk", () => {
  it("membangun tautan ke halaman rincian BPK", () => {
    expect(urlBpk("https://peraturan.bpk.go.id/", "149750")).toBe("https://peraturan.bpk.go.id/Details/149750");
  });

  it("mengembalikan null bila ID BPK tidak diketahui", () => {
    expect(urlBpk("https://peraturan.bpk.go.id", null)).toBeNull();
    expect(urlBpk("https://peraturan.bpk.go.id", "")).toBeNull();
  });
});

describe("tanggalIndonesia", () => {
  it("memahami berbagai format tanggal BPK", () => {
    expect(tanggalIndonesia("2 November 2020")).toBe("2020-11-02");
    expect(tanggalIndonesia("02 November 2020")).toBe("2020-11-02");
    expect(tanggalIndonesia("2020-11-02")).toBe("2020-11-02");
    expect(tanggalIndonesia("02/11/2020")).toBe("2020-11-02");
    expect(tanggalIndonesia("31 Mei 1999")).toBe("1999-05-31");
  });

  it("mengembalikan null untuk masukan yang tak dikenali", () => {
    expect(tanggalIndonesia("abc")).toBeNull();
    expect(tanggalIndonesia(null)).toBeNull();
  });
});

describe("statusDari", () => {
  it("memetakan teks status BPK", () => {
    expect(statusDari("Berlaku")).toBe("berlaku");
    expect(statusDari("Tidak Berlaku")).toBe("dicabut");
    expect(statusDari("Dicabut")).toBe("dicabut");
    expect(statusDari("Diubah")).toBe("diubah");
  });

  it("menganggap berlaku bila tidak ada keterangan", () => {
    expect(statusDari(null)).toBe("berlaku");
  });
});

describe("relasiDari", () => {
  it("memetakan label relasi BPK ke jenis relasi internal", () => {
    expect(relasiDari("Mengubah")).toBe("mengubah");
    expect(relasiDari("Diubah oleh")).toBe("diubah_oleh");
    expect(relasiDari("Mencabut")).toBe("mencabut");
    expect(relasiDari("Dicabut oleh")).toBe("dicabut_oleh");
    expect(relasiDari("Dasar Hukum")).toBe("dasar_hukum");
    expect(relasiDari("Peraturan Pelaksana")).toBe("dilaksanakan_oleh");
    expect(relasiDari("Melaksanakan")).toBe("melaksanakan");
  });

  it("memakai 'terkait' untuk label yang tidak dikenal", () => {
    expect(relasiDari("xyz")).toBe("terkait");
  });
});

describe("frbrDari", () => {
  it("membangun URI gaya FRBR dengan segmen jenis yang benar", () => {
    expect(frbrDari("UU", "13", 2003)).toBe("/akn/id/act/uu/2003/13");
    expect(frbrDari("PERDA_PROV", "5", 2020)).toBe("/akn/id/act/perda-prov/2020/5");
    expect(frbrDari("TAP_MPR", "1", 1998)).toBe("/akn/id/act/tap-mpr/1998/1");
  });

  it("garis miring dan spasi di dalam nomor tidak menambah segmen alamat; Tap MPR ditulis seperti baris yang sudah ada (xvi-mpr-1998)", () => {
    expect(frbrDari("TAP_MPR", "XVI/MPR/1998", 1998)).toBe("/akn/id/act/tap-mpr/1998/xvi-mpr-1998");
    expect(frbrDari("UUD", "1945/P4", 1945)).toBe("/akn/id/act/uud/1945/1945-P4");
    expect(frbrDari("UU", " 5 A ", 2020)).toBe("/akn/id/act/uu/2020/5-A");
  });
});

describe("sitasiDariTeks", () => {
  it("mengenali sitasi dalam teks relasi", () => {
    expect(sitasiDariTeks("Undang-Undang Nomor 13 Tahun 2003 tentang Ketenagakerjaan")).toEqual({
      jenis: "UU", nomor: "13", tahun: 2003,
    });
    expect(sitasiDariTeks("PP No. 35 Tahun 2021")).toEqual({ jenis: "PP", nomor: "35", tahun: 2021 });
    expect(sitasiDariTeks("Peraturan Presiden Nomor 12 Tahun 2021")).toEqual({
      jenis: "PERPRES", nomor: "12", tahun: 2021,
    });
    expect(sitasiDariTeks("Perppu 2/2022")).toEqual({ jenis: "PERPPU", nomor: "2", tahun: 2022 });
  });

  it("mengembalikan null bila tidak ada sitasi", () => {
    expect(sitasiDariTeks("tidak ada sitasi di sini")).toBeNull();
  });
});

describe("uraikanPasal: angka nol yang terbaca huruf O", () => {
  it('"Pasal 1O" dan "Pasal 12O" disimpan sebagai pasal 10 dan 120; sisipan A tetap', () => {
    const pasal = uraikanPasal(["Pasal 9", "Isi sembilan.", "Pasal 1O", "Isi sepuluh.", "Pasal 10A", "Isi sepuluh A.", "Pasal 12O", "Isi seratus dua puluh."].join("\n"));
    expect(pasal.map((p) => p.nomor_pasal)).toEqual(["9", "10", "10A", "120"]);
  });

  it("angka romawi tidak tersentuh", () => {
    expect(uraikanPasal(["Pasal I", "Isi satu.", "Pasal II", "Isi dua."].join("\n")).map((p) => p.nomor_pasal)).toEqual(["I", "II"]);
  });
});

describe('uraikanPasal: judul gaya lama bertitik ("Pasal 1.")', () => {
  const nomor = (naskah: string) => uraikanPasal(naskah).map((p) => p.nomor_pasal);

  it('"Pasal 1." dan "Pasal 2." (titik tunggal) adalah judul, bukan catchword; titiknya tidak ikut menjadi isi', () => {
    // Di produksi 89 UU 1946-1954 tak menghasilkan satu pasal pun karena sisa baris "." dibuang sebagai catchword.
    const pasal = uraikanPasal(["UNDANG-UNDANG", "MEMUTUSKAN:", "Pasal 1.", "Yang dimaksud ialah A.", "Pasal 2.", "Undang-undang ini berlaku."].join("\n"));
    expect(pasal.map((p) => [p.nomor_pasal, p.isi])).toEqual([
      ["1", "Yang dimaksud ialah A."],
      ["2", "Undang-undang ini berlaku."],
    ]);
  });

  it("angka romawi dan huruf kapital semua: 'Pasal I.' dan 'PASAL 2.'", () => {
    expect(nomor(["Pasal I.", "Satu.", "Pasal II.", "Dua."].join("\n"))).toEqual(["I", "II"]);
    expect(nomor(["PASAL 1.", "Satu.", "PASAL 2.", "Dua."].join("\n"))).toEqual(["1", "2"]);
  });

  it("isi yang menempel sesudah titik dimulai dari isinya: 'Pasal 3. Ketentuan...' dan 'Pasal 4.Ketentuan...'", () => {
    const pasal = uraikanPasal(["Pasal 3. Ketentuan tiga.", "Pasal 4.Ketentuan empat."].join("\n"));
    expect(pasal.map((p) => [p.nomor_pasal, p.isi])).toEqual([["3", "Ketentuan tiga."], ["4", "Ketentuan empat."]]);
  });

  it("penutup '.-' dan '-' tidak menjadi isi", () => {
    const pasal = uraikanPasal(["Pasal 1.-", "Satu.", "Pasal 2 -", "Dua."].join("\n"));
    expect(pasal.map((p) => [p.nomor_pasal, p.isi])).toEqual([["1", "Satu."], ["2", "Dua."]]);
  });

  it("nomor yang melompat tetap judul bila kalimat sebelumnya selesai, atau baris sebelumnya judul bab berhuruf kapital", () => {
    expect(nomor(["Pasal 1.", "Satu.", "Pasal 5.", "Lima."].join("\n"))).toEqual(["1", "5"]);
    expect(nomor(["Pasal 1.", "Satu", "BAB II", "PERIZINAN", "Pasal 8.", "Delapan."].join("\n"))).toEqual(["1", "8"]);
  });

  it("ujung rujukan silang yang terpotong ('... dimaksud dalam' / 'Pasal 15.') tetap isi pasal yang berjalan", () => {
    const pasal = uraikanPasal(["Pasal 3.", "Pengecualian sebagaimana dimaksud dalam", "Pasal 15.", "tidak berlaku.", "Pasal 4.", "Empat."].join("\n"));
    expect(pasal.map((p) => p.nomor_pasal)).toEqual(["3", "4"]);
    expect(pasal[0].isi).toBe("Pengecualian sebagaimana dimaksud dalam\nPasal 15.\ntidak berlaku.");
  });

  it("catchword kaki halaman tetap dibuang: 'Pasal 15 . . .' dan 'Pasal 15…'", () => {
    const pasal = uraikanPasal(["Pasal 4.", "Isi empat dan seterusnya", "Pasal 15 . . .", "lanjutan.", "Pasal 5.", "Lima."].join("\n"));
    expect(pasal.map((p) => p.nomor_pasal)).toEqual(["4", "5"]);
    expect(pasal[0].isi).toBe("Isi empat dan seterusnya\nlanjutan.");
    expect(nomor(["Pasal 1", "Satu.", "Pasal 15…", "lanjutan.", "Pasal 2", "Dua."].join("\n"))).toEqual(["1", "2"]);
  });

  it("naskah 1946 lengkap dengan kepala undang-undang dan penutup: pasal terbaca dalam urutan, bab terbawa", () => {
    const naskah = [
      "UNDANG-UNDANG REPUBLIK INDONESIA",
      "NOMOR 12 TAHUN 1946",
      "tentang Peraturan Mengenai Sesuatu",
      "Dengan persetujuan Badan Pekerja Komite Nasional Pusat,",
      "MEMUTUSKAN:",
      "Menetapkan: Undang-undang tentang Peraturan Mengenai Sesuatu.",
      "BAB I",
      "Pasal 1.",
      "Yang dimaksud dengan Sesuatu ialah hal yang diatur.",
      "Pasal 2.",
      "(1) Sesuatu dikerjakan oleh Menteri.",
      "(2) Menteri mengatur lebih lanjut.",
      "BAB II",
      "Pasal 3.",
      "Undang-undang ini mulai berlaku pada hari diundangkan.",
    ].join("\n");
    const pasal = uraikanPasal(naskah);
    expect(pasal.map((p) => [p.nomor_pasal, p.ayat, p.bab])).toEqual([
      ["1", null, "BAB I"],
      ["2", "1", "BAB I"],
      ["2", "2", "BAB I"],
      ["3", null, "BAB II"],
    ]);
  });
});

describe("uraikanPasal: artefak halaman PDF tidak masuk ke isi pasal", () => {
  const P = (n: number) => `\n\n\n\n### Page ${n}\n`;

  it("pasal yang membentang antarhalaman tersambung bersih: tanpa penanda, kepala, kaki, dan catchword", () => {
    const naskah = [
      "BAB I\nKETENTUAN UMUM\nPasal 1\n(1) Setiap orang berhak atas upah yang layak.",
      "(2) Upah dibayar tepat waktu sesuai kesepakatan yang dibuat antara pekerja dan pengusaha sebagaimana",
      `dimaksud dalam Pasal 3.SK No 004269 A(3) Dalam...${P(2)}PRESIDEN\nREPUBLIK INDONESIA- 2 -(3) Dalam hal terjadi sengketa, para pihak menyelesaikannya secara musyawarah.`,
      "Pasal 2\nKetentuan lebih lanjut diatur dengan Peraturan Pemerintah.www.peraturan.go.id",
      `${P(3)}PRESIDEN\nREPUBLIK INDONESIA- 3 -Pasal 3\nUndang-undang ini mulai berlaku pada tanggal diundangkan.`,
    ].join("\n");
    const pasal = uraikanPasal(naskah);
    expect(pasal.map((p) => [p.nomor_pasal, p.ayat])).toEqual([["1", "1"], ["1", "2"], ["1", "3"], ["2", null], ["3", null]]);
    expect(pasal[1].isi).toBe("Upah dibayar tepat waktu sesuai kesepakatan yang dibuat antara pekerja dan pengusaha sebagaimana\ndimaksud dalam Pasal 3.");
    expect(pasal[2].isi).toBe("Dalam hal terjadi sengketa, para pihak menyelesaikannya secara musyawarah.");
    expect(pasal[3].isi).toBe("Ketentuan lebih lanjut diatur dengan Peraturan Pemerintah.");
    for (const p of pasal) expect(p.isi).not.toMatch(/Page|REPUBLIK INDONESIA|SK No|www\.|\.\.\./);
  });

  it("judul pasal yang menempel pada kepala halaman ('REPUBLIK INDONESIA- 17 -Pasal 20') tetap terdeteksi sebagai pasal", () => {
    const naskah = `Pasal 19\nIsi sembilan belas.${P(17)}PRESIDEN\nREPUBLIK INDONESIA- 17 -Pasal 20\nIsi dua puluh.${P(18)}PRESIDEN\nREPUBLIK INDONESIA- 18 -Pasal 21\nIsi dua puluh satu.`;
    expect(uraikanPasal(naskah).map((p) => [p.nomor_pasal, p.isi])).toEqual([
      ["19", "Isi sembilan belas."], ["20", "Isi dua puluh."], ["21", "Isi dua puluh satu."],
    ]);
  });

  it("pembersihan juga berlaku sebelum PENJELASAN, yang tetap menghentikan penguraian", () => {
    const naskah = `Pasal 1\nSatu.${P(2)}PRESIDEN\nREPUBLIK INDONESIA- 2 -Pasal 2\nDua.${P(3)}PRESIDEN\nREPUBLIK INDONESIA- 3 -PENJELASAN\nATAS\nPasal 1\nCukup jelas.`;
    expect(uraikanPasal(naskah).map((p) => p.nomor_pasal)).toEqual(["1", "2"]);
  });

  it("judul PENJELASAN yang menempel pada kepala halaman tanpa nomor tetap menjadi batas (UU 7/1998 dan 700 peraturan lain)", () => {
    // Produksi 14 Okt 2026: "PRESIDEN⏎REPUBLIK INDONESIAPENJELASAN" lolos dari batas penguraian, dan seluruh Penjelasan
    // (hingga 24.000 karakter) tersimpan di pasal terakhir.
    // Tanpa rumus penutup yang utuh (naskah lama atau pindaian), pengesahan tetap di pasal terakhir; yang tak boleh ikut hanya Penjelasan.
    const naskah = [
      "Pasal 2\nIsi dua.",
      "Pasal 3\nUndang-undang ini mulai berlaku pada tanggal diundangkan.",
      `Disahkan di Jakarta.\nPRESIDEN REPUBLIK INDONESIA,\nLEMBARAN NEGARA REPUBLIK INDONESIA TAHUN 1998 NOMOR 175${P(9)}PRESIDEN\nREPUBLIK INDONESIAPENJELASAN\nATAS\nUNDANG-UNDANG REPUBLIK INDONESIA\nNOMOR 7 TAHUN 1998\nTENTANG\nPERUBAHAN\nUMUM\nUraian umum.\nPASAL DEMI PASAL\nPasal 1\nCukup jelas.`,
    ].join("\n");
    const pasal = uraikanPasal(naskah);
    expect(pasal.map((p) => p.nomor_pasal)).toEqual(["2", "3"]);
    const akhir = pasal[pasal.length - 1].isi;
    expect(akhir).toContain("LEMBARAN NEGARA REPUBLIK INDONESIA TAHUN 1998 NOMOR 175");
    expect(akhir).not.toMatch(/PENJELASAN|UMUM|Uraian umum|Cukup jelas|^PRESIDEN$/m);
  });

  it("tanpa penanda halaman pun: kepala yang menempel dibuang dari pasal terakhir, dan judul yang menempel pada kata lain dipisah", () => {
    const polos = uraikanPasal("Pasal 3\nIsi tiga.\nPRESIDEN\nREPUBLIK INDONESIAPENJELASAN\nATAS\nUNDANG-UNDANG\nPasal 1\nCukup jelas.");
    expect(polos.map((p) => [p.nomor_pasal, p.isi])).toEqual([["3", "Isi tiga."]]);
    const menempel = uraikanPasal("Pasal 3\nIsi tiga.\nLEMBARAN NEGARA NOMOR 175PENJELASAN\nATAS\nUNDANG-UNDANG\nPasal 1\nCukup jelas.");
    expect(menempel.map((p) => [p.nomor_pasal, p.isi])).toEqual([["3", "Isi tiga.\nLEMBARAN NEGARA NOMOR 175"]]);
  });

  it("pindaian yang menyambung judul tanpa spasi ('PENJELASANATASUNDANG-UNDANG') juga menjadi batas", () => {
    const naskah = `Pasal 1\nSatu.\nPasal 2\nDua.${P(30)}PENJELASANATASUNDANG-UNDANG REPUBLIK INDONESIA\nNOMOR 38 TAHUN 2014TENTANG\nKEPERAWATANI. UMUMKesehatan sebagai hak asasi.`;
    const pasal = uraikanPasal(naskah);
    expect(pasal.map((p) => [p.nomor_pasal, p.isi])).toEqual([["1", "Satu."], ["2", "Dua."]]);
  });

  it("'PENJELASAN' di dalam kalimat atau huruf kecil tidak menghentikan penguraian", () => {
    const naskah = "Pasal 1\nUraian ini dijelaskan dalam PENJELASAN pasal lain.\nPasal 2\nSebagaimana dalam penjelasan ayat ini.\nPasal 3\nTiga.";
    expect(uraikanPasal(naskah).map((p) => p.nomor_pasal)).toEqual(["1", "2", "3"]);
  });

  it("pasal di dalam sel tabel ('| Pasal 1 |') terbaca sebagai judul, tanpa pipa di isinya", () => {
    const naskah = "| Pasal 1 |\n| Dalam Undang-Undang ini yang dimaksud dengan petani. |\n| - |\n| Pasal 2 |\n| Isi dua\nsambungan. |";
    expect(uraikanPasal(naskah).map((p) => [p.nomor_pasal, p.isi])).toEqual([
      ["1", "Dalam Undang-Undang ini yang dimaksud dengan petani."],
      ["2", "Isi dua\nsambungan."],
    ]);
  });

  it("naskah yang sudah bersih menghasilkan pasal yang sama (bersih dua kali = sekali)", () => {
    const kotor = `Pasal 1\n(1) Satu.\nPemantau . . .${P(2)}PRESIDEN\nREPUBLIK INDONESIA- 2 -(2) Pemantau dua.\nPasal 2\nDua.`;
    const sekali = uraikanPasal(kotor);
    expect(sekali.map((p) => p.isi)).toEqual(["Satu.", "Pemantau dua.", "Dua."]);
  });
});

describe("uraikanPasal: rumus penutup bukan bagian pasal terakhir", () => {
  const P = (n: number) => `\n\n\n\n### Page ${n}\n`;
  const PENGESAHAN = [
    "Disahkan di Jakarta", "pada tanggal 25 Maret 2003", "PRESIDEN REPUBLIK INDONESIA,", "ttd.", "MEGAWATI SOEKARNOPUTRI",
    "Diundangkan di Jakarta", "pada tanggal 25 Maret 2003", "SEKRETARIS NEGARA REPUBLIK INDONESIA,", "ttd.", "BAMBANG KESOWO",
    "LEMBARAN NEGARA REPUBLIK INDONESIA TAHUN 2003 NOMOR 39",
  ].join("\n");

  it("pasal terakhir berhenti sebelum 'Agar setiap orang mengetahuinya'; pengesahan dan pengundangan tidak ikut", () => {
    const naskah = `Pasal 192\nSemua peraturan dinyatakan masih tetap berlaku.\nPasal 193\nUndang-undang ini mulai berlaku pada tanggal diundangkan.\nAgar setiap orang mengetahuinya, memerintahkan pengundangan Undang-undang ini\ndengan penempatannya dalam Lembaran Negara Republik Indonesia.\n${PENGESAHAN}`;
    const pasal = uraikanPasal(naskah);
    expect(pasal.map((p) => [p.nomor_pasal, p.isi])).toEqual([
      ["192", "Semua peraturan dinyatakan masih tetap berlaku."], ["193", "Undang-undang ini mulai berlaku pada tanggal diundangkan."],
    ]);
  });

  it("penulisan lama ('Agar supaya setiap orang dapat mengetahuinya'), menempel pada kalimat, dan terpisah halaman", () => {
    const lama = uraikanPasal("Pasal II\nUndang-undang ini mulai berlaku pada hari diundangkan.\nAgar supaya setiap orang dapat mengetahuinya, memerintahkan pengundangan undang-undang ini dengan penempatan dalam Lembaran-Negara Republik Indonesia.\nDisahkan di Jakarta.");
    expect(lama.map((p) => p.isi)).toEqual(["Undang-undang ini mulai berlaku pada hari diundangkan."]);

    const menempel = uraikanPasal("Pasal 2\nPeraturan ini mulai berlaku pada tanggal diundangkan.Agar setiap orang mengetahuinya, memerintahkan pengundangan Peraturan Pemerintah ini dengan penempatannya dalam Lembaran Negara Republik Indonesia.\nDitetapkan di Jakarta");
    expect(menempel.map((p) => p.isi)).toEqual(["Peraturan ini mulai berlaku pada tanggal diundangkan."]);

    const halaman = uraikanPasal(`Pasal 2\nPeraturan ini mulai berlaku.${P(5)}PRESIDEN\nREPUBLIK INDONESIA- 5 -Agar setiap orang mengetahuinya, memerintahkan\npengundangan Peraturan Pemerintah ini dengan penempatannya dalam Lembaran Negara Republik Indonesia.`);
    expect(halaman.map((p) => p.isi)).toEqual(["Peraturan ini mulai berlaku."]);
  });

  it("catchword 'Agar…Agar setiap orang' yang menempel di ujung kalimat terakhir dibuang dulu, sehingga penutup tetap dikenali (UU 8/1995)", () => {
    const naskah = `Pasal 115\nDengan berlakunya Undang-undang ini, yang lama dinyatakan tidak berlaku lagi.Pasal 116Undang-undang ini mulai berlaku pada tanggal 1\nJanuari 1996.Agar…Agar setiap orang mengetahuinya, memerintahkan\npengundangan Undang-undang ini dengan\npenempatannya dalam Lembaran Negara Republik\nIndonesia.${P(62)}PRESIDEN\nREPUBLIK INDONESIA- 62 -Disahkan di Jakarta\npada tanggal 10 Nopember 1995\nPRESIDEN REPUBLIK INDONESIA,\nttd\nSOEHARTO\nLEMBARAN NEGARA REPUBLIK INDONESIA TAHUN 1995 NOMOR 64`;
    expect(uraikanPasal(naskah).map((p) => [p.nomor_pasal, p.isi])).toEqual([
      ["115", "Dengan berlakunya Undang-undang ini, yang lama dinyatakan tidak berlaku lagi."],
      ["116", "Undang-undang ini mulai berlaku pada tanggal 1\nJanuari 1996."],
    ]);
  });

  it("catchword 'Agar …' yang berdiri di barisnya sendiri sebelum rumus penutup tak tertinggal di pasal terakhir (PP 7/1977)", () => {
    const naskah = `Pasal 26\nPeraturan Pemerintah ini mulai berlaku pada tanggal 1 April 1977.\nAgar …\nAgar supaya setiap orang mengetahuinya, memerintahkan\npengundangan Peraturan Pemerintah ini dengan penempatannya dalam Lembaran Negara Republik Indonesia.\n${PENGESAHAN}`;
    expect(uraikanPasal(naskah).map((p) => [p.nomor_pasal, p.isi])).toEqual([["26", "Peraturan Pemerintah ini mulai berlaku pada tanggal 1 April 1977."]]);
  });

  it("lampiran sesudah penutup (naskah perjanjian, tabel) tidak menjadi isi pasal dan 'Pasal N'-nya tidak dikira pasal", () => {
    const naskah = `Pasal 1\nMengesahkan perjanjian.\nPasal 2\nUndang-undang ini mulai berlaku.\nAgar setiap orang mengetahuinya, memerintahkan pengundangan Undang-undang ini dengan penempatannya dalam Lembaran Negara Republik Indonesia.\n${PENGESAHAN}\nLAMPIRAN\nARTICLE 1\nPasal 3 Konvensi ini berlaku bagi semua pihak.\nPasal 4\nTabel tarif.\nPENJELASAN\nATAS\nUNDANG-UNDANG\nPasal 1\nCukup jelas.`;
    const pasal = uraikanPasal(naskah);
    expect(pasal.map((p) => [p.nomor_pasal, p.isi])).toEqual([["1", "Mengesahkan perjanjian."], ["2", "Undang-undang ini mulai berlaku."]]);
  });

  it("kalimat pasal yang kebetulan berawal 'Agar setiap orang ...' tidak memotong pasal", () => {
    const naskah = [
      "Pasal 5", "Agar setiap orang dapat memperoleh pelayanan, Pemerintah wajib menyediakan loket.",
      "Pasal 6", "Agar setiap orang mengetahui hak-haknya, Pemerintah wajib melakukan sosialisasi.",
      "Pasal 7", "Agar setiap orang mengetahuinya, Menteri dapat memerintahkan pengumuman di media.", "Ketentuan lebih lanjut diatur dengan Peraturan Menteri.",
    ].join("\n");
    expect(uraikanPasal(naskah).map((p) => [p.nomor_pasal, p.isi])).toEqual([
      ["5", "Agar setiap orang dapat memperoleh pelayanan, Pemerintah wajib menyediakan loket."],
      ["6", "Agar setiap orang mengetahui hak-haknya, Pemerintah wajib melakukan sosialisasi."],
      ["7", "Agar setiap orang mengetahuinya, Menteri dapat memerintahkan pengumuman di media.\nKetentuan lebih lanjut diatur dengan Peraturan Menteri."],
    ]);
  });

  it("rumus tanpa kata 'pengundangan' dalam tiga baris tidak dikenali sebagai penutup", () => {
    const naskah = "Pasal 1\nSatu.\nAgar setiap orang mengetahuinya, Pemerintah wajib mengumumkan.\nBaris kedua.\nBaris ketiga.\nBaris keempat memerintahkan pengundangan.";
    expect(uraikanPasal(naskah).map((p) => p.isi)).toEqual(["Satu.\nAgar setiap orang mengetahuinya, Pemerintah wajib mengumumkan.\nBaris kedua.\nBaris ketiga.\nBaris keempat memerintahkan pengundangan."]);
  });
});

describe("uraikanPasal", () => {
  const naskah = [
    "# UNDANG-UNDANG",
    "BAB I",
    "KETENTUAN UMUM",
    "Pasal 1",
    "Dalam Undang-Undang ini yang dimaksud dengan:",
    "1. Pekerja adalah setiap orang yang bekerja.",
    "Pasal 2",
    "(1) Setiap pekerja berhak atas upah.",
    "(2) Upah dibayar tepat waktu.",
    "BAB II",
    "HAK",
    "Bagian Kesatu",
    "Upah",
    "Pasal 3",
    "Ketentuan lebih lanjut diatur dengan Peraturan Pemerintah.",
    "PENJELASAN",
    "PASAL DEMI PASAL",
    "Pasal 1",
    "Cukup jelas.",
  ].join("\n");

  const pasal = uraikanPasal(naskah);

  it("memecah pasal dan ayat dengan urutan yang benar", () => {
    expect(pasal.map((p) => [p.nomor_pasal, p.ayat])).toEqual([
      ["1", null],
      ["2", "1"],
      ["2", "2"],
      ["3", null],
    ]);
    expect(pasal.map((p) => p.urutan)).toEqual([0, 1, 2, 3]);
  });

  it("membawa konteks BAB dan Bagian", () => {
    expect(pasal[0].bab).toBe("BAB I");
    expect(pasal[3].bab).toBe("BAB II");
    expect(pasal[3].bagian).toBe("Bagian Kesatu");
  });

  it("memperlakukan daftar bernomor di dalam pasal sebagai isi pasal, bukan ayat", () => {
    expect(pasal[0].isi).toContain("1. Pekerja adalah setiap orang yang bekerja.");
  });

  it("mengabaikan bagian Penjelasan (Pasal demi Pasal)", () => {
    expect(pasal.some((p) => p.isi.includes("Cukup jelas"))).toBe(false);
  });

  it("rujukan silang yang terpotong tepat sebelum tanda baca tetap menjadi isi pasal yang sedang berjalan", () => {
    // Pola nyata UU 13/2003: baris berikutnya diawali "Pasal 9;" atau "Pasal 48, Pasal 87, ...".
    const hasil = uraikanPasal(
      [
        "Pasal 17",
        "(2) Sanksi dijatuhkan apabila pelatihan:",
        "a. tidak sesuai dengan arah pelatihan kerja sebagaimana dimaksud dalam",
        "Pasal 9; dan/atau",
        "b. tidak memenuhi persyaratan sebagaimana dimaksud dalam Pasal 15.",
        "Pasal 18",
        "Pengaturan lebih lanjut diatur dengan Peraturan Pemerintah.",
        "Pasal 190",
        "Pengusaha yang melanggar Pasal 5, Pasal 6, Pasal 15, Pasal 25, Pasal 38 ayat (2), Pasal 45 ayat (1),",
        "Pasal 48, Pasal 87, Pasal 106 dikenakan sanksi administratif.",
      ].join("\n"),
    );
    expect(hasil.map((p) => p.nomor_pasal)).toEqual(["17", "18", "190"]);
    expect(hasil[0].isi).toContain("sebagaimana dimaksud dalam\nPasal 9; dan/atau\nb. tidak memenuhi");
    expect(hasil[2].isi).toContain("Pasal 48, Pasal 87, Pasal 106 dikenakan sanksi administratif.");
  });

  it("judul pasal yang diikuti kata (bukan tanda baca) tetap judul: 'Pasal 12 dihapus.'", () => {
    const hasil = uraikanPasal(["Pasal 11", "Ketentuan sebelas.", "Pasal 12 dihapus.", "Pasal 13", "Ketentuan tiga belas."].join("\n"));
    expect(hasil.map((p) => p.nomor_pasal)).toEqual(["11", "12", "13"]);
  });

  it("membentuk ID pasal yang stabil dan unik", () => {
    expect(idPasal("/akn/id/act/uu/2003/13", "156", null)).toBe("/akn/id/act/uu/2003/13#pasal-156");
    expect(idPasal("/akn/id/act/uu/2003/13", "156", "1")).toBe("/akn/id/act/uu/2003/13#pasal-156-ayat-1");
    expect(idPasalUnik("/akn/id/act/uu/2003/13", pasal)).toEqual([
      "/akn/id/act/uu/2003/13#pasal-1",
      "/akn/id/act/uu/2003/13#pasal-2-ayat-1",
      "/akn/id/act/uu/2003/13#pasal-2-ayat-2",
      "/akn/id/act/uu/2003/13#pasal-3",
    ]);
  });
});

describe("nilaiKualitasEkstraksi", () => {
  it("menilai naskah yang utuh sebagai bersih", () => {
    const naskah = "Pasal 1\nisi satu\nPasal 2\nisi dua\nPasal 3\nisi tiga";
    const laporan = nilaiKualitasEkstraksi(naskah, uraikanPasal(naskah));
    expect(laporan).toMatchObject({
      jumlah_pasal: 3, pasal_tertinggi: 3, celah_pasal: 0, kerusakan_per_1000: 0, vonis: "bersih",
    });
  });

  it("menghitung pasal yang hilang sebagai celah", () => {
    const naskah = "Pasal 1\nsatu\nPasal 5\nlima";
    expect(nilaiKualitasEkstraksi(naskah, uraikanPasal(naskah)).celah_pasal).toBe(3);
  });

  it("mendeteksi kerusakan OCR: angka tercemar, simbol liar, artefak halaman", () => {
    const naskah = "Pasal 1\nNilai Rp2O24 dan 72o/o dari € total . . . sisa\nPasal 2\nlorem";
    const laporan = nilaiKualitasEkstraksi(naskah, uraikanPasal(naskah));
    expect(laporan.angka_tercemar).toBe(1);
    expect(laporan.simbol_liar).toBe(2);
    expect(laporan.artefak_halaman).toBe(1);
    expect(laporan.vonis).toBe("berat");
  });

  it("memberi vonis 'tanpa_pasal' bila tidak ada pasal terdeteksi", () => {
    const naskah = "tidak ada pasal sama sekali";
    expect(nilaiKualitasEkstraksi(naskah, uraikanPasal(naskah)).vonis).toBe("tanpa_pasal");
  });
});

describe("petakanDokumen (manifest hasil panen BPK -> Law + relasi)", () => {
  const dokumen = {
    bpk_id: "149750",
    detail_url: "https://peraturan.bpk.go.id/Details/149750/uu-no-11-tahun-2020",
    meta: {
      Judul: "Cipta Kerja",
      "Bentuk Singkat": "UU",
      Nomor: "11",
      Tahun: "2020",
      Status: "Tidak Berlaku",
      "Tanggal Penetapan": "2 November 2020",
      "Tanggal Pengundangan": "2 November 2020",
      "T.E.U.": "Indonesia",
      Bidang: "EKONOMI - KETENAGAKERJAAN",
      Subjek: "CIPTA KERJA",
    },
    relasi: [
      {
        label: "Dicabut oleh",
        bpk_id: "246523",
        teks: "Undang-undang Nomor 6 Tahun 2023 tentang Penetapan Peraturan Pemerintah Pengganti Undang-Undang Nomor 2 Tahun 2022",
      },
      { label: "Mengubah", bpk_id: null, teks: "tanpa sitasi yang bisa dikenali" },
    ],
    abstrak: ["Sepuluh ruang lingkup UU ini...", "Peraturan pelaksana wajib ditetapkan."],
  };

  it("memetakan metadata ke Law", () => {
    const hasil = petakanDokumen(dokumen);
    expect(hasil?.law).toMatchObject({
      frbr_uri: "/akn/id/act/uu/2020/11",
      jenis: "UU",
      nomor: "11",
      tahun: 2020,
      judul: "Cipta Kerja",
      tentang: "CIPTA KERJA",
      status: "dicabut",
      tanggal_penetapan: "2020-11-02",
      tanggal_berlaku: "2020-11-02",
      instansi: "Indonesia",
      bidang: "EKONOMI - KETENAGAKERJAAN",
      bpk_id: "149750",
      sumber_url: "https://peraturan.bpk.go.id/Details/149750/uu-no-11-tahun-2020",
      jumlah_pasal: 0,
    });
    expect(hasil?.law.ringkasan).toBe("Sepuluh ruang lingkup UU ini... Peraturan pelaksana wajib ditetapkan.");
  });

  it("hanya menyimpan relasi yang sitasinya bisa dikenali", () => {
    expect(petakanDokumen(dokumen)?.relasi).toEqual([
      {
        to_uri: "/akn/id/act/uu/2023/6",
        jenis_relasi: "dicabut_oleh",
        keterangan: dokumen.relasi[0].teks,
        sasaran: { jenis: "UU", nomor: "6", tahun: 2023 },
      },
    ]);
  });

  it("nomor Tap MPR dan nomor bernol di depan ditulis seperti baris yang sudah ada; baris baru tak menambah ragam penulisan", () => {
    const tap = petakanDokumen({ bpk_id: "210109", meta: { Judul: "Ketetapan MPR Nomor XVI/MPR/1998 tentang Politik Ekonomi", "Bentuk Singkat": "TAP MPR", Nomor: "XVI/MPR/1998", Tahun: "1998" } });
    expect(tap?.law).toMatchObject({ jenis: "TAP_MPR", nomor: "xvi-mpr-1998", frbr_uri: "/akn/id/act/tap-mpr/1998/xvi-mpr-1998" });
    const nol = petakanDokumen({ bpk_id: "1", meta: { Judul: "PP 1/2022", "Bentuk Singkat": "PP", Nomor: "01", Tahun: "2022" } });
    expect(nol?.law).toMatchObject({ nomor: "1", frbr_uri: "/akn/id/act/pp/2022/1" });
  });

  it("adaStatus menandai apakah halaman BPK menyebut Status (yang tak menyebutnya tak boleh menimpa status tersimpan)", () => {
    expect(petakanDokumen(dokumen)?.adaStatus).toBe(true);
    const { Status: _, ...tanpaStatus } = dokumen.meta;
    const hasil = petakanDokumen({ ...dokumen, meta: tanpaStatus });
    expect(hasil?.adaStatus).toBe(false);
    expect(hasil?.law.status).toBe("berlaku"); // bawaan; pemanggil yang memutuskan memakainya atau tidak
  });

  it("masukan yang bertipe aneh tidak melempar galat: yang tak terbaca diabaikan, yang inti hilang ditolak (null)", () => {
    expect(petakanDokumen(null as never)).toBeNull();
    expect(petakanDokumen({ bpk_id: "1", meta: "bukan objek" } as never)).toBeNull();
    expect(petakanDokumen({ bpk_id: "1", meta: { Judul: 5, Nomor: {}, Tahun: "2020" } } as never)).toBeNull();
    const hasil = petakanDokumen({ bpk_id: "1", meta: { Judul: "PP 5/2021", "Bentuk Singkat": "PP", Nomor: "5", Tahun: "2021" }, relasi: "bukan larik", abstrak: "bukan larik" } as never);
    expect(hasil?.law).toMatchObject({ jenis: "PP", nomor: "5", ringkasan: null });
    expect(hasil?.relasi).toEqual([]);
    const campur = petakanDokumen({
      bpk_id: "1", meta: { Judul: "PP 5/2021", "Bentuk Singkat": "PP", Nomor: "5", Tahun: "2021" },
      relasi: [null, { label: "Mengubah" }, { label: "Mengubah", teks: "Peraturan Pemerintah Nomor 35 Tahun 2021" }], abstrak: ["satu", 2, "tiga"],
    } as never);
    expect(campur?.relasi.map((r) => r.to_uri)).toEqual(["/akn/id/act/pp/2021/35"]);
    expect(campur?.law.ringkasan).toBe("satu tiga");
  });

  it("menolak dokumen tanpa nomor dan tahun", () => {
    expect(petakanDokumen({ bpk_id: "1", meta: { Judul: "Tanpa nomor dan tahun" } })).toBeNull();
  });
});

describe("periksaKecocokanNaskah (apakah PDF memang milik peraturan yang dituju)", () => {
  const pp5 = { jenis: "PP", nomor: "5", tahun: 2021 };
  const judul = (baris: string) => `PRESIDEN\nREPUBLIK INDONESIA\n${baris}\nTENTANG PENYELENGGARAAN CONTOH\n\nDENGAN RAHMAT TUHAN YANG MAHA ESA\nMenimbang: ...`;

  it("judul resmi di kepala naskah sama dengan peraturannya: cocok", () => {
    expect(periksaKecocokanNaskah(judul("PERATURAN PEMERINTAH REPUBLIK INDONESIA NOMOR 5 TAHUN 2021"), pp5)).toEqual({ hasil: "cocok" });
    expect(periksaKecocokanNaskah(judul("UNDANG-UNDANG REPUBLIK INDONESIA NOMOR 6 TAHUN 2023"), { jenis: "UU", nomor: "6", tahun: 2023 })).toEqual({ hasil: "cocok" });
    expect(periksaKecocokanNaskah(judul("PERATURAN PEMERINTAH PENGGANTI UNDANG-UNDANG REPUBLIK INDONESIA NOMOR 2 TAHUN 2022"), { jenis: "PERPPU", nomor: "2", tahun: 2022 })).toEqual({ hasil: "cocok" });
  });

  it("judul resmi milik peraturan lain: tidak cocok, dengan yang ditemukan", () => {
    expect(periksaKecocokanNaskah(judul("PERATURAN PEMERINTAH REPUBLIK INDONESIA NOMOR 9 TAHUN 2020"), pp5)).toEqual({
      hasil: "tidak_cocok", ditemukan: { jenis: "PP", nomor: "9", tahun: 2020 },
    });
    // Nomor sama, tahun berbeda; dan nomor berbeda, tahun sama.
    expect(periksaKecocokanNaskah(judul("PERATURAN PEMERINTAH REPUBLIK INDONESIA NOMOR 5 TAHUN 2020"), pp5).hasil).toBe("tidak_cocok");
    expect(periksaKecocokanNaskah(judul("PERATURAN PEMERINTAH REPUBLIK INDONESIA NOMOR 6 TAHUN 2021"), pp5).hasil).toBe("tidak_cocok");
    // Jenis berbeda dengan nomor dan tahun sama (PP 5/2021 bukan UU 5/2021).
    expect(periksaKecocokanNaskah(judul("UNDANG-UNDANG REPUBLIK INDONESIA NOMOR 5 TAHUN 2021"), pp5).hasil).toBe("tidak_cocok");
  });

  it("rujukan di dalam kalimat bukan judul naskah: tak cukup untuk menyatakan tidak cocok", () => {
    const naskah = "Menimbang bahwa Undang-Undang Nomor 11 Tahun 2020 tentang Cipta Kerja perlu dilaksanakan; Peraturan Pemerintah Nomor 35 Tahun 2021 diubah.";
    expect(periksaKecocokanNaskah(naskah, pp5)).toEqual({ hasil: "tak_diketahui" });
  });

  it("judul peraturannya sendiri ada, walau naskah juga menyebut judul lain (bundel, lampiran): cocok", () => {
    const naskah = judul("PERATURAN PEMERINTAH REPUBLIK INDONESIA NOMOR 5 TAHUN 2021") + "\nLampiran: PERATURAN PEMERINTAH REPUBLIK INDONESIA NOMOR 9 TAHUN 2020";
    expect(periksaKecocokanNaskah(naskah, pp5)).toEqual({ hasil: "cocok" });
  });

  it("undang-undang dan Perppu satu deret penomoran: sejenis (BPK pernah menamai Perppu 7/1964 sebagai UU)", () => {
    expect(periksaKecocokanNaskah(judul("PERATURAN PEMERINTAH PENGGANTI UNDANG-UNDANG REPUBLIK INDONESIA NOMOR 7 TAHUN 1964"), { jenis: "UU", nomor: "7", tahun: 1964 })).toEqual({ hasil: "cocok" });
    expect(periksaKecocokanNaskah(judul("UNDANG-UNDANG REPUBLIK INDONESIA NOMOR 7 TAHUN 1964"), { jenis: "PERPPU", nomor: "7", tahun: 1964 })).toEqual({ hasil: "cocok" });
  });

  it("nomor bernol di depan, huruf kecil, dan penanda markdown tak membuat yang cocok dianggap lain", () => {
    expect(periksaKecocokanNaskah("# **PERATURAN PEMERINTAH** REPUBLIK INDONESIA\n**NOMOR 1 TAHUN 2022**", { jenis: "PP", nomor: "01", tahun: 2022 })).toEqual({ hasil: "cocok" });
    expect(periksaKecocokanNaskah("Peraturan Pemerintah Republik Indonesia Nomor 5a Tahun 2021", { jenis: "PP", nomor: "5A", tahun: 2021 })).toEqual({ hasil: "cocok" });
  });

  it("tanpa judul bentuk resmi, atau angkanya rusak oleh OCR: tak diketahui (diproses seperti biasa)", () => {
    expect(periksaKecocokanNaskah("PP 99/2025\nBAB I\nPasal 1\nIsi.", pp5)).toEqual({ hasil: "tak_diketahui" });
    expect(periksaKecocokanNaskah("UNDANG-UNDANG REPUBLIK INDONESIA NOMOR 6 TAHUN 2O23 TENTANG PENETAPAN PERATURAN PEMERINTAH PENGGANTI UNDANG-UNDANG NOMOR 2 TAHUN 2022", { jenis: "UU", nomor: "6", tahun: 2023 })).toEqual({ hasil: "tak_diketahui" });
    expect(periksaKecocokanNaskah("", pp5)).toEqual({ hasil: "tak_diketahui" });
  });

  it("hanya 3.000 karakter pertama yang diperiksa", () => {
    const jauh = "x".repeat(3500) + " PERATURAN PEMERINTAH REPUBLIK INDONESIA NOMOR 9 TAHUN 2020";
    expect(periksaKecocokanNaskah(jauh, pp5)).toEqual({ hasil: "tak_diketahui" });
  });

  it("Tap MPR dan UUD tak diperiksa (penulisan judulnya lain)", () => {
    const naskah = "PERATURAN PEMERINTAH REPUBLIK INDONESIA NOMOR 9 TAHUN 2020";
    expect(periksaKecocokanNaskah(naskah, { jenis: "TAP_MPR", nomor: "xvi-mpr-1998", tahun: 1998 })).toEqual({ hasil: "tak_diketahui" });
    expect(periksaKecocokanNaskah(naskah, { jenis: "UUD", nomor: "1945", tahun: 1945 })).toEqual({ hasil: "tak_diketahui" });
  });
});
