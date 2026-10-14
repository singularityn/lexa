/**
 * Pembersih artefak halaman PDF (src/worker/lib/halaman.ts). Contoh diambil dari naskah nyata di produksi (14 Okt 2026):
 * PP 5/2021 (kepala "2021, No.15" dan kaki www.peraturan.go.id), UU 11/2006 (catchword ". . ."), UU 8/2019 dan UU 11/2020
 * (kaki "SK No ... A" dan kepala "PRESIDEN REPUBLIK INDONESIA" dengan salah baca OCR), PP 7/2010 ("DISTRIBUSI II").
 */
import { describe, expect, it } from "vitest";
import { bersihkanHalaman } from "../src/worker/lib/halaman";

const P = (n: number) => `\n\n\n\n### Page ${n}\n`;

describe("bersihkanHalaman: penanda halaman", () => {
  it("penanda dibuang dan halaman tersambung sebagai baris biasa", () => {
    const naskah = `Pasal 1\nSatu.${P(2)}Pasal 2\nDua.${P(3)}Pasal 3\nTiga.`;
    expect(bersihkanHalaman(naskah)).toBe("Pasal 1\nSatu.\nPasal 2\nDua.\nPasal 3\nTiga.");
  });

  it("berbagai bentuk penanda dikenali, tetapi kata 'Page' di dalam kalimat tidak", () => {
    expect(bersihkanHalaman(`a\n## Page 2\nb\n#### Page 3 \nc`)).toBe("a\nb\nc");
    const kalimat = "Lihat Page 4 untuk contoh, atau ### Page 5 di tengah kalimat.";
    expect(bersihkanHalaman(kalimat)).toBe(kalimat);
  });

  it("teks tanpa penanda dan tanpa kaki khas tidak berubah (selain pangkas ujung)", () => {
    const teks = "BAB I\nKETENTUAN UMUM\nPasal 1\n(1) Isi pertama;\n(2) Isi kedua - 5 - tetap.\n";
    expect(bersihkanHalaman(teks)).toBe(teks.replace(/\s+$/, ""));
  });
});

describe("bersihkanHalaman: kepala halaman bernomor", () => {
  it("kepala 'PRESIDEN / REPUBLIK INDONESIA- 20 -' menempel pada baris pertama halaman (UU 10/1995)", () => {
    const naskah = [
      `Penanganannya diatur lebih lanjut dengan Peraturan\nPemerintah.${P(20)}PRESIDEN\nREPUBLIK INDONESIA- 20 -BAB V\nKETENTUAN PIDANA`,
      `${P(21)}PRESIDEN\nREPUBLIK INDONESIA- 21 -Pasal 24\nSetiap orang dilarang.`,
      `${P(22)}PRESIDEN\nREPUBLIK INDONESIA- 22 -Pasal 25\nTerlarang.`,
    ].join("");
    expect(bersihkanHalaman(naskah)).toBe(
      "Penanganannya diatur lebih lanjut dengan Peraturan\nPemerintah.\nBAB V\nKETENTUAN PIDANA\nPasal 24\nSetiap orang dilarang.\nPasal 25\nTerlarang.",
    );
  });

  it("kepala dengan nomor di baris tersendiri: 'PRESIDEN / REPUBLIK INDONESIA / - 9 -(2) Dalam hal' (UU 12/1980)", () => {
    const naskah = `Selesai.${P(8)}PRESIDEN\nREPUBLIK INDONESIA\n- 8 -(1) Satu.${P(9)}PRESIDEN\nREPUBLIK INDONESIA\n- 9 -(2) Dalam hal terjadi sebagaimana dimaksud.`;
    expect(bersihkanHalaman(naskah)).toBe("Selesai.\n(1) Satu.\n(2) Dalam hal terjadi sebagaimana dimaksud.");
  });

  it("kepala tanpa spasi dan salah baca OCR: 'PRESIDENREPUBLIK INDONESIA-20-', 'PRES I DENREPUBLIK INDONESIA-9 -', 'REPUELIK INDONESIA-8-'", () => {
    const naskah = [
      `Awal.${P(19)}PRESIDENREPUBLIK INDONESIA-19-(2) Dua.`,
      `${P(20)}PRESIDENREPUBLIK INDONESIA-20-(3) Dalam melaksanakan tugas.`,
      `${P(21)}PRES I DENREPUBLIK INDONESIA-21 -(4) Empat.`,
      `${P(22)}REPUELIK INDONESIA-22-(5) Lima.`,
      `${P(23)}PRESTOENR,EPUBLIK INDONESIA-23-6. Pensiunan adalah aparatur.`,
    ].join("");
    expect(bersihkanHalaman(naskah)).toBe("Awal.\n(2) Dua.\n(3) Dalam melaksanakan tugas.\n(4) Empat.\n(5) Lima.\n6. Pensiunan adalah aparatur.");
  });

  it("kepala Lembaran Negara '2021, No.15-79-' dan '2021, No.15 -166-' dengan kaki www.peraturan.go.id (PP 5/2021)", () => {
    const naskah = [
      `Pemanfaatan ruang manfaat jalan selain peruntukannyawww.peraturan.go.id${P(78)}2021, No.15-78-wajib memperoleh persetujuan dari penyelenggara`,
      `\njalan sesuai dengan kewenangannya.www.peraturan.go.id${P(79)}2021, No.15 -79-Pasal 111\nPelaksanaan pekerjaan konstruksi.www.peraturan.go.id`,
      `${P(80)}2021, No.15-80-Pasal 112\nTerakhir.`,
    ].join("");
    expect(bersihkanHalaman(naskah)).toBe(
      "Pemanfaatan ruang manfaat jalan selain peruntukannya\nwajib memperoleh persetujuan dari penyelenggara\njalan sesuai dengan kewenangannya.\nPasal 111\nPelaksanaan pekerjaan konstruksi.\nPasal 112\nTerakhir.",
    );
  });

  it("penomoran cetak yang berganti (Penjelasan bernomor ulang) tetap dikenali selama konsisten", () => {
    const naskah = [
      `Pasal 1\nSatu.`,
      `${P(1)}PRESIDEN\nREPUBLIK INDONESIA- 1 -Pasal 2\nDua.`,
      `${P(2)}PRESIDEN\nREPUBLIK INDONESIA- 2 -Pasal 3\nTiga.`,
      `${P(3)}PRESIDEN\nREPUBLIK INDONESIA- 1 -PENJELASAN\nATAS`,
      `${P(4)}PRESIDEN\nREPUBLIK INDONESIA- 2 -I. UMUM\nUraian.`,
    ].join("");
    expect(bersihkanHalaman(naskah)).toBe("Pasal 1\nSatu.\nPasal 2\nDua.\nPasal 3\nTiga.\nPENJELASAN\nATAS\nI. UMUM\nUraian.");
  });

  it("kepala yang nomornya tak cocok dibuang bila bentuknya jelas kepala cetak, tidak bila awalnya kalimat biasa", () => {
    const jelas = bersihkanHalaman(`Satu.${P(7)}PRESIDEN\nREPUBLIK INDONESIA- 99 -Pasal 8\nDelapan.`);
    expect(jelas).toBe("Satu.\nPasal 8\nDelapan.");
    const prosa = "Berdasarkan pertimbangan rapat sebelumnya - 99 - angka itu tetap sebagai bagian kalimat.";
    expect(bersihkanHalaman(`Satu.${P(7)}${prosa}`)).toBe(`Satu.\n${prosa}`);
  });

  it("jangkar di tengah halaman, atau terlalu jauh dari awal, tidak disentuh", () => {
    const tengah = "Pasal 8\nBesaran sebagaimana dimaksud pada ayat (1) adalah rentang 5 - 7 - 9 kali dari upah.";
    expect(bersihkanHalaman(`Satu.${P(7)}${tengah}`)).toBe(`Satu.\n${tengah}`);
    const jauh = `${"HEADER PANJANG ".repeat(12)}- 7 -isi`;
    expect(bersihkanHalaman(`Satu.${P(7)}${jauh}`)).toBe(`Satu.\n${jauh}`);
  });

  it("jangkar tanpa kepala (hanya '- 5 -') dipercaya hanya bila penomoran cetaknya konsisten", () => {
    const sendirian = `Satu.${P(5)}- 5 -Pasal 9\nSembilan.`;
    expect(bersihkanHalaman(sendirian)).toBe("Satu.\n- 5 -Pasal 9\nSembilan.");
    const konsisten = `Satu.${P(5)}- 5 -Pasal 9\nSembilan.${P(6)}- 6 -Pasal 10\nSepuluh.`;
    expect(bersihkanHalaman(konsisten)).toBe("Satu.\nPasal 9\nSembilan.\nPasal 10\nSepuluh.");
  });
});

describe("bersihkanHalaman: kaki tetap", () => {
  it.each([
    ["selama musim haji.SK No 004269 A(3) Dalam melaksanakan", "selama musim haji.\n(3) Dalam melaksanakan"],
    ["Pasal 28 diubah sehingga berbunyi sebagaiSK No 050842 APasal 28 . .", "Pasal 28 diubah sehingga berbunyi sebagai\nPasal 28 . ."],
    ["tindak pidana lain.SK No 115715 AAyat (2) .", "tindak pidana lain.\nAyat (2) ."],
    ["Cukup jelas.\nSK No 104150A\nBerikut", "Cukup jelas.\n\nBerikut"],
    ["Cukup jelas.SK No275468A", "Cukup jelas.\n"],
    ["Ayat (8)Cukup jelas.SK No l893ll A", "Ayat (8)Cukup jelas.\n"],
    ["Huruf dCukup jelas.SK No 060964 AHuruf e. .", "Huruf dCukup jelas.\nHuruf e. ."],
  ])("%j", (masuk, keluar) => {
    expect(bersihkanHalaman(masuk)).toBe(keluar.replace(/\s+$/, ""));
  });

  it("situs di kaki dibuang dari kata yang ditempelinya, dalam huruf besar maupun kecil", () => {
    expect(bersihkanHalaman("menteri yangwww.peraturan.go.id")).toBe("menteri yang");
    expect(bersihkanHalaman("Menteri.www.djpp.depkumham.go.id")).toBe("Menteri.");
    expect(bersihkanHalaman("sepertiWWW.DJPP.KEMENKUMHAM.GO.ID lanjut")).toBe("seperti lanjut");
  });

  it("'SK No' di dalam kalimat biasa dan situs lain tidak disentuh", () => {
    const biasa = "Surat Keputusan (SK) No. 123 tentang A, atau SK No 12 dan www.contoh.go.id tetap.";
    expect(bersihkanHalaman(biasa)).toBe(biasa);
  });
});

describe("bersihkanHalaman: catchword", () => {
  it("'Pemantau . . .' di ujung halaman dibuang karena halaman berikutnya diawali '(3) Pemantau' (UU 11/2006)", () => {
    const naskah = `(2) Pemantau dapat berasal dari perorangan.\nPemantau . . .${P(49)}\n(3) Pemantau asing sebagaimana dimaksud pada ayat (1) harus\nmemenuhi prosedur.`;
    expect(bersihkanHalaman(naskah)).toBe("(2) Pemantau dapat berasal dari perorangan.\n(3) Pemantau asing sebagaimana dimaksud pada ayat (1) harus\nmemenuhi prosedur.");
  });

  it("catchword dengan beberapa kata dan penanda butir yang sama: 'c. memiliki . . .' sebelum 'c. memiliki pengurus'", () => {
    const naskah = `b. berbadan hukum;\nc. memiliki . . .${P(65)}\nc. memiliki pengurus lengkap sekurang-kurangnya di 2/3\nd. memiliki anggota.`;
    expect(bersihkanHalaman(naskah)).toBe("b. berbadan hukum;\nc. memiliki pengurus lengkap sekurang-kurangnya di 2/3\nd. memiliki anggota.");
  });

  it("catchword yang menempel pada kalimat dan diakhiri '...' atau '…': hanya kata yang cocok yang dibuang", () => {
    const a = bersihkanHalaman(`Diselenggarakan oleh Pemerintah Pusat. Pada saat itu (3) Dalam...${P(20)}(3) Dalam melaksanakan tugas.`);
    expect(a).toBe("Diselenggarakan oleh Pemerintah Pusat. Pada saat itu\n(3) Dalam melaksanakan tugas.");
    const b = bersihkanHalaman(`Bunyi ayat terdahulu. Sebelum…${P(99)}(2) Sebelum melakukan kegiatan usaha.`);
    expect(b).toBe("Bunyi ayat terdahulu.\n(2) Sebelum melakukan kegiatan usaha.");
  });

  it("titik-titik yang tidak diikuti halaman dengan kata yang sama dibiarkan (bukan catchword)", () => {
    const naskah = `Seterusnya demikian . . .${P(5)}Pasal 9\nSembilan.`;
    expect(bersihkanHalaman(naskah)).toBe("Seterusnya demikian . . .\nPasal 9\nSembilan.");
  });

  it("catchword yang hanya penanda butir ('(2) . . .') tidak menghapus apa pun yang bukan itu", () => {
    const naskah = `Satu.\n(2) . . .${P(5)}(2) Dua.`;
    expect(bersihkanHalaman(naskah)).toBe("Satu.\n(2) Dua.");
    const lain = `Satu.\n. . .${P(5)}Dua.`;
    expect(bersihkanHalaman(lain)).toBe("Satu.\n. . .\nDua.");
  });
});

describe("bersihkanHalaman: baris berulang di tepi halaman", () => {
  const halaman = (n: number, isi: string, ekstra = "") => `${P(n)}${ekstra}${isi}\nDISTRIBUSI II`;

  it("baris yang sama di tepi sedikitnya 30% halaman dibuang (PP 7/2010: 'DISTRIBUSI II')", () => {
    const naskah = Array.from({ length: 10 }, (_, i) => halaman(i + 1, `Isi halaman ${i + 1} yang berbeda.`)).join("");
    const bersih = bersihkanHalaman(naskah);
    expect(bersih).not.toContain("DISTRIBUSI");
    expect(bersih.split("\n")).toHaveLength(10);
  });

  it("baris yang hanya di sebagian kecil halaman, atau di tengah halaman, tetap", () => {
    const naskah = Array.from({ length: 10 }, (_, i) => (i < 2 ? halaman(i + 1, `Isi ${i}.`) : `${P(i + 1)}Isi ${i}.`)).join("");
    expect(bersihkanHalaman(naskah)).toContain("DISTRIBUSI II");
    const tengah = Array.from({ length: 10 }, (_, i) => `${P(i + 1)}Awal ${i}.\nBaris 1\nBaris 2\nBaris 3\nDISTRIBUSI II\nBaris 4\nBaris 5\nBaris 6\nAkhir ${i}.`).join("");
    expect(bersihkanHalaman(tengah).match(/DISTRIBUSI II/g)).toHaveLength(10);
  });

  it("struktur naskah dan kalimat tidak pernah dianggap berulang: 'Cukup jelas.', 'Pasal 5', 'BAB I', butir, baris berpenutup", () => {
    const naskah = Array.from({ length: 8 }, (_, i) => `${P(i + 1)}BAB I\nPasal 5\nCukup jelas.\na. huruf pertama\nBerlaku sejak diundangkan;\nKETENTUAN UMUM\nIsi ${i}.`).join("");
    const bersih = bersihkanHalaman(naskah);
    for (const k of ["BAB I", "Pasal 5", "Cukup jelas.", "a. huruf pertama", "Berlaku sejak diundangkan;"]) {
      expect(bersih.split("\n").filter((b) => b === k), k).toHaveLength(8);
    }
  });

  it("dokumen pendek (kurang dari empat halaman) tidak diperiksa", () => {
    const naskah = Array.from({ length: 3 }, (_, i) => halaman(i + 1, `Isi ${i}.`)).join("");
    expect(bersihkanHalaman(naskah).match(/DISTRIBUSI II/g)).toHaveLength(3);
  });
});

describe("bersihkanHalaman: bentuk lain yang ditemukan di produksi", () => {
  it("OCR menulis garis bawah sebagai ganti tanda hubung: 'PRESIDENREPUELIK INDONESIA_ 15_a. memenuhi' (UU 41/2014)", () => {
    const naskah = `harus:(1)\n(2)\n(4)(s)(6)a. memenuhi ...${P(15)}PRESIDENREPUELIK INDONESIA_ 15_a. memenuhi persyaratan teknis Kesehatan Hewan;b. bebas dari Penyakit.`;
    expect(bersihkanHalaman(naskah)).toBe("harus:(1)\n(2)\n(4)(s)(6)\na. memenuhi persyaratan teknis Kesehatan Hewan;b. bebas dari Penyakit.");
  });

  it("kaki 'SK No' di tengah kalimat yang disusul kelanjutannya, dan catchword menempel 'kota.Pasal22. . .' (UU 2/2026)", () => {
    const naskah = [
      `dinas yangketenagakerjaan provinsi atauSK No275472 Akabupaten/kota.Pasal22. . .`,
      `${P(12)}NEFUBUK INDONESIA-12-Pasal22Ketentuan lebih lanjut mengenai hak diatur dengan Peraturan Menteri.`,
      `${P(13)}NEFUBUK INDONESIA-13-Pasal23Berikutnya.`,
    ].join("");
    expect(bersihkanHalaman(naskah)).toBe(
      "dinas yangketenagakerjaan provinsi atau\nkabupaten/kota.\nPasal22Ketentuan lebih lanjut mengenai hak diatur dengan Peraturan Menteri.\nPasal23Berikutnya.",
    );
  });

  it("catchword '(5) Tarif ...' menempel pada kalimat sebelumnya dan didahului kaki 'SK No' (UU 1/2022)", () => {
    const naskah = [
      `ditetapkan dengan Peraturan Presiden.(5) Tarif ...SK No 104057 A`,
      `${P(23)}PRES IOENREPUBLIK INDONESIA-23-(5) Tarif PBBKB sebagaimana dimaksud pada ayat (1)`,
      `${P(24)}PRESIDENREPUBLIK INDONESIA-24-(6) Enam.`,
    ].join("");
    expect(bersihkanHalaman(naskah)).toBe("ditetapkan dengan Peraturan Presiden.\n(5) Tarif PBBKB sebagaimana dimaksud pada ayat (1)\n(6) Enam.");
  });

  it("'Yang . . .' sesudah kaki 'SK No' dan sebelum kepala 'Nomor-Halaman' dengan awalan huruf acak (UU 1/2023)", () => {
    const naskah = `tempat tinggal.SK No 151445 AYang . . .${P(325)}7J-96-Yang dimaksud dengan "pekarangan tertutup" adalah sebidang tanah.${P(326)}PRESIDENREPUBLIK INDONESIA-97-Selesai.`;
    expect(bersihkanHalaman(naskah)).toBe('tempat tinggal.\nYang dimaksud dengan "pekarangan tertutup" adalah sebidang tanah.\nSelesai.');
  });

  it("catchword satu karakter '…' dan penanda halaman yang berdiri di akhir halaman terakhir", () => {
    const naskah = `huruf a\nb. hak…${P(29)}PRESIDEN\nREPUBLIK INDONESIA- 11 -b. hak tersebut menurut sifatnya dapat dipindahtangankan.${P(30)}`;
    expect(bersihkanHalaman(naskah)).toBe("huruf a\nb. hak tersebut menurut sifatnya dapat dipindahtangankan.");
  });

  it("kepala dengan nomor yang tak berhubungan dengan penanda (Penjelasan bernomor ulang di UU 11/2020: Page 1174 tercetak 405)", () => {
    const naskah = `Huruf d${P(1174)}PRESIDENREPUBLIK INDONESTA-405-Huruf dHuruf eCukup jelasHuruf fCukup jelas${P(1175)}PRESIDENREPUBLIK INDONESIA-406-Huruf g\nCukup jelas.`;
    // "Huruf d" di ujung halaman sebelumnya adalah catchword (titik-titiknya hilang dibaca OCR) dan ikut dibuang.
    expect(bersihkanHalaman(naskah)).toBe("Huruf dHuruf eCukup jelasHuruf fCukup jelas\nHuruf g\nCukup jelas.");
  });
});

describe("bersihkanHalaman: bentuk dari bagian Penjelasan (produksi, 14 Okt 2026)", () => {
  it("sel tabel markdown dibuka, baris pemisah dihapus, dan catchword di dalam sel tetap dikenali (UU 19/2013)", () => {
    const naskah = [
      "| - |\n| II. PASAL DEMI PASAL |\n| Pasal 1 |\n| Cukup jelas. |\n| Pasal 2 |\n",
      "| Huruf aYang dimaksud dengan “asas kedaulatan” adalah\npenyelenggaraan Perlindungan dan Pemberdayaan Petani\nharus dilaksanakan dengan menjunjung tinggi kedaulatan. |\n",
      "| Huruf e . . . |",
      `${P(44)}| Huruf eYang dimaksud dengan “asas keterpaduan” adalah\npenyelenggaraan Perlindungan harus memadukan berbagai kepentingan. |\n| - |\n| Huruf fYang dimaksud dengan “asas keterbukaan” adalah terbuka. |`,
    ].join("");
    expect(bersihkanHalaman(naskah)).toBe(
      [
        "II. PASAL DEMI PASAL",
        "Pasal 1",
        "Cukup jelas.",
        "Pasal 2",
        "Huruf aYang dimaksud dengan “asas kedaulatan” adalah",
        "penyelenggaraan Perlindungan dan Pemberdayaan Petani",
        "harus dilaksanakan dengan menjunjung tinggi kedaulatan.",
        "Huruf eYang dimaksud dengan “asas keterpaduan” adalah",
        "penyelenggaraan Perlindungan harus memadukan berbagai kepentingan.",
        "",
        "Huruf fYang dimaksud dengan “asas keterbukaan” adalah terbuka.",
      ].join("\n"),
    );
  });

  it("pipa di dalam baris (tabel berkolom banyak) dibiarkan; hanya bingkai tepinya yang dibuang", () => {
    expect(bersihkanHalaman("| Jenis | Tarif |\n|---|---|\n| Cek | 3000 |")).toBe("Jenis | Tarif\n\nCek | 3000");
  });

  it("kepala 'PRESIDEN / REPUBLIK INDONESIA' yang menempel pada judul PENJELASAN di halaman tanpa nomor (UU 7/1998)", () => {
    const naskah = `Diundangkan di Jakarta.\nLEMBARAN NEGARA REPUBLIK INDONESIA TAHUN 1998 NOMOR 175${P(9)}PRESIDEN\nREPUBLIK INDONESIAPENJELASAN\nATAS\nUNDANG-UNDANG REPUBLIK INDONESIA\nNOMOR 7 TAHUN 1998`;
    expect(bersihkanHalaman(naskah)).toBe(
      "Diundangkan di Jakarta.\nLEMBARAN NEGARA REPUBLIK INDONESIA TAHUN 1998 NOMOR 175\nPENJELASAN\nATAS\nUNDANG-UNDANG REPUBLIK INDONESIA\nNOMOR 7 TAHUN 1998",
    );
  });

  it("kepala yang berdiri sendiri, bertanda baca, atau bukan di awal halaman tidak disentuh", () => {
    const sendiri = `a${P(2)}PRESIDEN\nREPUBLIK INDONESIA\nUNDANG-UNDANG`;
    expect(bersihkanHalaman(sendiri)).toBe("a\nPRESIDEN\nREPUBLIK INDONESIA\nUNDANG-UNDANG");
    const tandaTangan = `a${P(2)}PRESIDEN REPUBLIK INDONESIA,\nttd.`;
    expect(bersihkanHalaman(tandaTangan)).toBe("a\nPRESIDEN REPUBLIK INDONESIA,\nttd.");
    const tengah = `a${P(2)}Isi halaman. PRESIDEN REPUBLIK INDONESIAPENJELASAN`;
    expect(bersihkanHalaman(tengah)).toBe("a\nIsi halaman. PRESIDEN REPUBLIK INDONESIAPENJELASAN");
  });

  it("catchword yang ditulis 'Ayat(2)...' di ujung halaman dan 'Ayat (2)' di awal halaman berikutnya tetap cocok (PP 93/2021)", () => {
    const naskah = `Pasal 2Ayat (1)Yang dimaksud dengan "harta tidak bergerak" adalah harta permanen.SK No 096253 AAyat(2)...${P(14)}PRESIDENREPUELIK INDONESIA-3-Ayat (2)Cukup jelasAyat (3)Cukup jelasPasal 3Cukup jelas`;
    expect(bersihkanHalaman(naskah)).toBe(
      'Pasal 2Ayat (1)Yang dimaksud dengan "harta tidak bergerak" adalah harta permanen.\nAyat (2)Cukup jelasAyat (3)Cukup jelasPasal 3Cukup jelas',
    );
  });

  it("catchword yang titik-titiknya hilang dibaca OCR: 'Huruf d' dan 'II. PASAL' diulang di awal halaman berikutnya (UU 10/2020)", () => {
    const huruf = `Ayat (2)Huruf aCukup jelas.Huruf cCukup jelas.SK No 051691 AHuruf d${P(24)}FRESIDEN\nREPUBLTK INDONESIA-3-Huruf dCukup jelasHuruf eSehubungan dengan perkembangan hukum`;
    expect(bersihkanHalaman(huruf)).toBe("Ayat (2)Huruf aCukup jelas.Huruf cCukup jelas.\nHuruf dCukup jelasHuruf eSehubungan dengan perkembangan hukum");
    const judul = `ketentuan perjanjianinternasional.SK No 051538 AII. PASAL${P(23)}FRESIDENREFUELIK INDONESIA-2-II. PASAL DEMI PASALPasal 1Cukup jelas.`;
    expect(bersihkanHalaman(judul)).toBe("ketentuan perjanjianinternasional.\nII. PASAL DEMI PASALPasal 1Cukup jelas.");
  });

  it("baris pendek di dasar halaman yang BUKAN diulang di halaman berikutnya tetap: judul yang menggantung, kata tunggal", () => {
    for (const [ujung, awal] of [
      ["Pasal 12", "(1) Setiap orang wajib."],
      ["Huruf d", "Huruf e\nCukup jelas."],
      ["Presiden", "Presiden menetapkan peraturan."],
      ["Cukup jelas.", "Cukup jelas."],
    ]) {
      const naskah = `Isi.\n${ujung}${P(2)}${awal}`;
      expect(bersihkanHalaman(naskah), `${ujung} | ${awal}`).toBe(`Isi.\n${ujung}\n${awal}`);
    }
  });
});

describe("bersihkanHalaman: sifat umum", () => {
  const CONTOH = [
    `(2) Pemantau dapat berasal dari perorangan.\nPemantau . . .www.peraturan.go.id${P(48)}2021, No.15-48-(3) Pemantau asing harus\nmemenuhi prosedur.SK No 004269 A(4) Satu.`,
    `${P(49)}PRESIDEN\nREPUBLIK INDONESIA- 49 -(4) Satu dua tiga.\nDISTRIBUSI II`,
    `${P(50)}PRESIDEN\nREPUBLIK INDONESIA- 50 -Pasal 7\nTujuh.\nDISTRIBUSI II`,
    `${P(51)}PRESIDEN\nREPUBLIK INDONESIA- 51 -Pasal 8\nDelapan.\nDISTRIBUSI II`,
    `${P(52)}PRESIDEN\nREPUBLIK INDONESIA- 52 -Pasal 9\nSembilan.\nDISTRIBUSI II`,
  ].join("");

  it("idempoten: membersihkan hasilnya sekali lagi tidak mengubah apa pun", () => {
    const sekali = bersihkanHalaman(CONTOH);
    expect(bersihkanHalaman(sekali)).toBe(sekali);
    expect(sekali).not.toMatch(/Page|REPUBLIK INDONESIA|DISTRIBUSI|SK No|www\./);
  });

  it("teks kosong dan teks tanpa isi di antara penanda tidak menimbulkan galat", () => {
    expect(bersihkanHalaman("")).toBe("");
    expect(bersihkanHalaman(`${P(1)}${P(2)}${P(3)}`)).toBe("");
    expect(bersihkanHalaman(`${P(1)}\n\n${P(2)}Isi.`)).toBe("Isi.");
  });

  it("naskah seribu halaman dibersihkan dengan cepat dan tanpa menghapus isi", () => {
    const isi = (n: number) => `${P(n)}PRESIDEN\nREPUBLIK INDONESIA- ${n} -Pasal ${n}\n${"Kalimat isi pasal yang cukup panjang untuk uji. ".repeat(20)}\nDISTRIBUSI II\nSK No 004269 A`;
    const naskah = Array.from({ length: 1000 }, (_, i) => isi(i + 1)).join("");
    const mulai = performance.now();
    const bersih = bersihkanHalaman(naskah);
    expect(performance.now() - mulai).toBeLessThan(2000);
    expect(bersih.match(/^Pasal \d+$/gm)).toHaveLength(1000);
    expect(bersih).not.toMatch(/Page|REPUBLIK INDONESIA|DISTRIBUSI|SK No/);
  });
});
