/**
 * Pengurai Penjelasan (src/worker/lib/penjelasan.ts). Cuplikan menirukan naskah nyata di produksi (14 Okt 2026): UU 13/2003
 * (bentuk bersih), PP 93/2021 dan UU 10/2020 (pindaian, semua menempel), UU 19/2013 (sel tabel), UU 9/1998 ("Cukup jelas"
 * untuk seluruh pasal), UU 10/1995 dan UU 8/1995 ("UMUM" menempel pada judul).
 */
import { describe, expect, it } from "vitest";
import { barisPenjelasan, hanyaCukupJelas, NOMOR_UMUM, uraikanPenjelasan } from "../src/worker/lib/penjelasan";

const P = (n: number) => `\n\n\n\n### Page ${n}\n`;

const ringkas = (naskah: string) => uraikanPenjelasan(naskah).pasal.map((p) => [p.nomor_pasal, p.isi]);

const BATANG = "Pasal 1\nSatu.\nPasal 2\nDua.\n";

describe("uraikanPenjelasan: naskah bersih", () => {
  const naskah = [
    BATANG,
    "PENJELASAN\nATAS\nUNDANG-UNDANG REPUBLIK INDONESIA\nNOMOR 13 TAHUN 2003\nTENTANG\nKETENAGAKERJAAN",
    "I. UMUM",
    "Pembangunan ketenagakerjaan sebagai bagian integral dari pembangunan\nnasional berdasarkan Pancasila dan Undang-Undang Dasar.",
    "Pasal 33 Undang-Undang Dasar Negara Republik Indonesia Tahun 1945 mengamanatkan perekonomian.",
    "II. PASAL DEMI PASAL",
    "Pasal 1\nCukup jelas.",
    "Pasal 2\nCukup jelas.",
    "Pasal 3\nAyat (1)\nCukup jelas.\nAyat (2)\nYang dimaksud dengan \"pekerja\" adalah setiap orang.",
    "Pasal 4 sampai dengan Pasal 6\nCukup jelas.",
    "Pasal 7A\nHuruf a\nCukup jelas.\nHuruf b\nYang dimaksud dengan \"upah\" adalah hak.",
    "Pasal 8\nYang dimaksud dengan \"pengusaha\" adalah orang yang menjalankan\nperusahaan milik sendiri.",
  ].join("\n");
  const hasil = uraikanPenjelasan(naskah);

  it("Penjelasan Umum: dari sesudah 'I. UMUM' sampai 'II. PASAL DEMI PASAL', tanpa judul peraturan", () => {
    expect(hasil.umum).toBe(
      "Pembangunan ketenagakerjaan sebagai bagian integral dari pembangunan\nnasional berdasarkan Pancasila dan Undang-Undang Dasar.\n" +
        "Pasal 33 Undang-Undang Dasar Negara Republik Indonesia Tahun 1945 mengamanatkan perekonomian.",
    );
  });

  it("satu entri per pasal menurut urutan kemunculan; rentang diperluas; label tetap di barisnya sendiri", () => {
    expect(hasil.pasal.map((p) => p.nomor_pasal)).toEqual(["1", "2", "3", "4", "5", "6", "7A", "8"]);
    expect(hasil.pasal.map((p) => p.urutan)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const per = Object.fromEntries(hasil.pasal.map((p) => [p.nomor_pasal, p.isi]));
    expect(per["1"]).toBe("Cukup jelas.");
    expect(per["3"]).toBe('Ayat (1)\nCukup jelas.\nAyat (2)\nYang dimaksud dengan "pekerja" adalah setiap orang.');
    expect(per["4"]).toBe("Cukup jelas.");
    expect(per["6"]).toBe("Cukup jelas.");
    expect(per["7A"]).toBe('Huruf a\nCukup jelas.\nHuruf b\nYang dimaksud dengan "upah" adalah hak.');
    expect(per["8"]).toBe('Yang dimaksud dengan "pengusaha" adalah orang yang menjalankan\nperusahaan milik sendiri.');
  });

  it("batang tubuh sebelum PENJELASAN tidak ikut", () => {
    expect(JSON.stringify(hasil)).not.toMatch(/Satu\.|Dua\./);
  });

  it("naskah tanpa Penjelasan: kosong", () => {
    expect(uraikanPenjelasan(BATANG)).toEqual({ umum: null, pasal: [] });
    expect(uraikanPenjelasan("")).toEqual({ umum: null, pasal: [] });
  });
});

describe("uraikanPenjelasan: judul dan batas", () => {
  it("rentang dan daftar: 'dan', 's.d.', koma, tanda hubung; nomor huruf dan Romawi", () => {
    const naskah = [
      "PENJELASAN\nPASAL DEMI PASAL",
      "Pasal 1 dan Pasal 2\nCukup jelas.",
      "Pasal 3 s.d. Pasal 5\nCukup jelas.",
      "Pasal 6, Pasal 7, dan Pasal 8\nCukup jelas.",
      "Pasal 9 - 10\nCukup jelas.",
      "Pasal 11A\nCukup jelas.",
    ].join("\n");
    expect(ringkas(naskah).map(([n]) => n)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11A"]);
    const romawi = ringkas("PENJELASAN\nPASAL DEMI PASAL\nPasal I\nAngka 1\nCukup jelas.\nAngka 2\nYang dimaksud adalah.\nPasal II\nCukup jelas.");
    expect(romawi).toEqual([["I", "Angka 1\nCukup jelas.\nAngka 2\nYang dimaksud adalah."], ["II", "Cukup jelas."]]);
  });

  it("rentang yang tidak masuk akal tidak diperluas (hanya ujung-ujungnya)", () => {
    expect(ringkas("PENJELASAN\nPASAL DEMI PASAL\nPasal 1 sampai dengan Pasal 99999\nCukup jelas.").map(([n]) => n)).toEqual(["1", "99999"]);
  });

  it("judul dan isi pada satu baris ('Pasal 5Cukup jelas.', 'Pasal 6: Yang dimaksud ...')", () => {
    expect(ringkas("PENJELASAN\nPASAL DEMI PASAL\nPasal 1Cukup jelas.\nPasal 2: Yang dimaksud dengan itu adalah ini.")).toEqual([
      ["1", "Cukup jelas."], ["2", "Yang dimaksud dengan itu adalah ini."],
    ]);
  });

  it("rujukan silang yang terpotong di awal baris bukan judul: nomor turun, melompat, atau kalimat belum selesai", () => {
    const naskah = [
      "PENJELASAN\nPASAL DEMI PASAL",
      "Pasal 1\nCukup jelas.",
      "Pasal 2\nKetentuan ini mengatur kewajiban sebagaimana dimaksud dalam",
      "Pasal 1 ayat (1) huruf a.",
      "Pasal 3\nYang dimaksud dengan itu sebagaimana diatur dalam",
      "Pasal 28 Undang-Undang Dasar Negara Republik Indonesia Tahun 1945.",
      "Pasal 4\nCukup jelas.",
    ].join("\n");
    expect(ringkas(naskah)).toEqual([
      ["1", "Cukup jelas."],
      ["2", "Ketentuan ini mengatur kewajiban sebagaimana dimaksud dalam\nPasal 1 ayat (1) huruf a."],
      ["3", "Yang dimaksud dengan itu sebagaimana diatur dalam\nPasal 28 Undang-Undang Dasar Negara Republik Indonesia Tahun 1945."],
      ["4", "Cukup jelas."],
    ]);
  });

  it("'Pasal 14' yang berdiri sendiri di baris: judul bila kalimat sebelumnya selesai, rujukan terpotong bila menggantung", () => {
    const menggantung = "PENJELASAN\nPASAL DEMI PASAL\nPasal 2\nKetentuan ini mengatur kewajiban sebagaimana dimaksud dalam\nPasal 14\nayat (1) huruf a.\nPasal 3\nCukup jelas.";
    expect(ringkas(menggantung)).toEqual([
      ["2", "Ketentuan ini mengatur kewajiban sebagaimana dimaksud dalam\nPasal 14\nayat (1) huruf a."],
      ["3", "Cukup jelas."],
    ]);
    // Penjelasan tak selalu memuat semua pasal: nomor yang melompat tetap judul bila baris itu berdiri sendiri sesudah kalimat selesai.
    expect(ringkas("PENJELASAN\nPASAL DEMI PASAL\nPasal 2\nCukup jelas.\nPasal 14\nCukup jelas.").map(([n]) => n)).toEqual(["2", "14"]);
  });

  it("kalimat uraian yang dibuka rujukan ('Pasal 28 Undang-Undang Dasar ...') bukan judul walau kalimat sebelumnya selesai", () => {
    const naskah = [
      "PENJELASAN\nPASAL DEMI PASAL",
      "Pasal 1\nCukup jelas.",
      "Pasal 2\nKetentuan ini sejalan dengan UUD.",
      "Pasal 28 Undang-Undang Dasar menjamin hak setiap orang.",
      "Pasal 28 ayat (1) menegaskan hal yang sama.",
      "Pasal 3\nCukup jelas.",
    ].join("\n");
    expect(ringkas(naskah)).toEqual([
      ["1", "Cukup jelas."],
      ["2", "Ketentuan ini sejalan dengan UUD.\nPasal 28 Undang-Undang Dasar menjamin hak setiap orang.\nPasal 28 ayat (1) menegaskan hal yang sama."],
      ["3", "Cukup jelas."],
    ]);
  });

  it("nomor yang melompat diterima bila dibuka awal uraian yang lazim ('Cukup jelas', 'Ayat (1)', 'Yang dimaksud')", () => {
    const naskah = "PENJELASAN\nPASAL DEMI PASAL\nPasal 1\nCukup jelas.\nPasal 5 Cukup jelas.\nPasal 9 Ayat (1) Cukup jelas.\nPasal 12 Yang dimaksud adalah itu.";
    expect(ringkas(naskah).map(([n]) => n)).toEqual(["1", "5", "9", "12"]);
  });

  it("BAB dan 'Bagian Kesatu' menutup entri dan judulnya tidak ikut; 'Bagian ini ...' di dalam uraian tetap uraian", () => {
    const naskah = [
      "PENJELASAN\nPASAL DEMI PASAL",
      "BAB I\nKETENTUAN UMUM",
      "Pasal 1\nCukup jelas.",
      "BAB II\nHAK",
      "Bagian Kesatu\nUpah",
      "Pasal 2\nBagian ini mengatur upah.",
      "Pasal 3\nCukup jelas.",
    ].join("\n");
    expect(ringkas(naskah)).toEqual([["1", "Cukup jelas."], ["2", "Bagian ini mengatur upah."], ["3", "Cukup jelas."]]);
  });

  it("penjelasan tanpa 'II. PASAL DEMI PASAL': Umum berakhir di 'Pasal 1', bukan di rujukan 'Pasal 33 ...' dalam uraian umum", () => {
    const naskah = [
      "PENJELASAN\nATAS\nPERATURAN PEMERINTAH\nNOMOR 5 TAHUN 2021\nTENTANG\nPERIZINAN",
      "I. UMUM",
      "Pertimbangan penyusunan.",
      "Pasal 33 Undang-Undang Dasar mengamanatkan hal ini.",
      "Pasal 1\nCukup jelas.",
      "Pasal 2\nCukup jelas.",
    ].join("\n");
    const hasil = uraikanPenjelasan(naskah);
    expect(hasil.umum).toBe("Pertimbangan penyusunan.\nPasal 33 Undang-Undang Dasar mengamanatkan hal ini.");
    expect(hasil.pasal.map((p) => p.nomor_pasal)).toEqual(["1", "2"]);
  });

  it("langsung 'PASAL DEMI PASAL' tanpa judul PENJELASAN dan tanpa Umum (UU 5/1995)", () => {
    const hasil = uraikanPenjelasan("Pasal 1\nSatu.\nPASAL DEMI PASAL\nPasal I\nCukup jelas.\nPasal II\nCukup jelas.");
    expect(hasil.umum).toBeNull();
    expect(hasil.pasal.map((p) => [p.nomor_pasal, p.isi])).toEqual([["I", "Cukup jelas."], ["II", "Cukup jelas."]]);
  });

  it("'Umum' tanpa 'I.' dan huruf kecil ('I. Umum') dikenali", () => {
    expect(uraikanPenjelasan("PENJELASAN\nATAS\nUNDANG-UNDANG\nTENTANG\nTELEKOMUNIKASI\nUMUM\nSejak dahulu.\nPASAL DEMI PASAL\nPasal 1\nCukup jelas.").umum).toBe("Sejak dahulu.");
    expect(uraikanPenjelasan("PENJELASAN\nATAS\nUNDANG-UNDANG\nI. Umum\nManusia membutuhkan pendidikan.\nII. Pasal Demi Pasal\nPasal 1\nCukup jelas.").umum).toBe(
      "Manusia membutuhkan pendidikan.",
    );
  });
});

describe("uraikanPenjelasan: artefak halaman", () => {
  it("penanda, kepala bernomor, kaki 'SK No', situs, dan catchword tidak masuk ke penjelasan", () => {
    const naskah = [
      "PENJELASAN\nPASAL DEMI PASAL\nPasal 1\nCukup jelas.\nPasal 2\nYang dimaksud dengan \"harta\" adalah barang yang dimiliki dan dikuasai oleh pemegang hak.SK No 096253 AAyat(2)...",
      `${P(14)}PRESIDEN\nREPUBLIK INDONESIA- 3 -Ayat (2)Cukup jelas.www.peraturan.go.id`,
      `${P(15)}PRESIDEN\nREPUBLIK INDONESIA- 4 -Pasal 3\nCukup jelas.`,
    ].join("");
    expect(ringkas(naskah)).toEqual([
      ["1", "Cukup jelas."],
      ["2", 'Yang dimaksud dengan "harta" adalah barang yang dimiliki dan dikuasai oleh pemegang hak.\nAyat (2)\nCukup jelas.'],
      ["3", "Cukup jelas."],
    ]);
  });

  it("kaki 'TAMBAHAN LEMBARAN NEGARA ...' huruf besar dibuang; sebutan dalam kalimat dibiarkan", () => {
    const naskah = [
      "PENJELASAN\nPASAL DEMI PASAL",
      "Pasal 1\nCukup jelas.",
      "Pasal 2\nDiumumkan dalam Tambahan Lembaran Negara Republik Indonesia Nomor 3817 oleh Menteri.\nTAMBAHAN LEMBARAN NEGARA REPUBLIK INDONESIA NOMOR 3789",
    ].join("\n");
    expect(ringkas(naskah)).toEqual([
      ["1", "Cukup jelas."],
      ["2", "Diumumkan dalam Tambahan Lembaran Negara Republik Indonesia Nomor 3817 oleh Menteri."],
    ]);
  });
});

describe("uraikanPenjelasan: PP 53/2010 (naskah nyata, kepala 'PRESIDENREPUBLIK INDONESIA- N -' dan catchword '. . .')", () => {
  // Bentuk asli di produksi: judul PENJELASAN menempel pada kepala halaman tanpa nomor, kepala bernomor menempel pada judul
  // pasal berikutnya, dan catchword ('Angka 6 . . .', 'Ayat (4) . . .', 'Contoh: . . .') di ujung tiap halaman.
  const naskah = [
    "Menteri Hukum dan Hak Asasi Manusia,\nPATRIALIS AKBAR",
    `${P(66)}PRESIDENREPUBLIK INDONESIAPENJELASAN\nATAS\nPERATURAN PEMERINTAH REPUBLIK INDONESIA\nNOMOR 53 TAHUN 2010\nTENTANG\nDISIPLIN PEGAWAI NEGERI SIPIL\nI. UMUM\nDalam rangka mewujudkan PNS yang handal, profesional, dan\nbermoral sebagai penyelenggara pemerintahan yang baik.\nUntuk mewujudkan PNS yang handal, mutlak diperlukan\nperaturan disiplin PNS.\nPeraturan . . .`,
    `${P(67)}PRESIDENREPUBLIK INDONESIA- 2 -\nPeraturan Pemerintah tentang disiplin PNS ini antara lain\nmemuat kewajiban, larangan, dan hukuman disiplin.\nII. PASAL DEMI PASAL\nPasal 1\nCukup jelas.\nPasal 2\nCukup jelas.`,
    `${P(68)}PRESIDENREPUBLIK INDONESIA- 3 -Pasal 3\nAngka 1\nCukup jelas.\nAngka 2\nYang dimaksud dengan “tugas kedinasan” adalah tugas yang\nberhubungan dengan:\na. perintah kedinasan;\nb. peraturan perundang-undangan.\nAngka 3 . . .`,
    `${P(69)}PRESIDENREPUBLIK INDONESIA- 4 -Angka 3\nCukup jelas.\nPasal 4\nAngka 1\nYang dimaksud dengan “menyalahgunakan wewenang”\nadalah menggunakan kewenangannya.\nAngka 2\nContoh:\nSeorang PNS yang tidak memiliki wewenang.\nAngka 3 . . .`,
    `${P(70)}PRESIDENREPUBLIK INDONESIA- 5 -\nAngka 3\nCukup jelas.\nPasal 5\nCukup jelas.\nPasal 6\nPNS yang melanggar ketentuan disiplin PNS dijatuhi hukuman\ndisiplin.`,
    `${P(71)}PRESIDENREPUBLIK INDONESIA- 6 -Pasal 7\nAyat (1)\nCukup jelas.\nAyat (2)\nHuruf a\nHukuman disiplin yang berupa teguran lisan dinyatakan\nsecara lisan.\nHuruf b\nCukup jelas.\nAyat (3) . . .`,
    `${P(72)}PRESIDENREPUBLIK INDONESIA- 7 -\nAyat (3)\nHuruf a\nMasa penundaan kenaikan gaji berkala dihitung penuh.\nPasal 14\nYang dimaksud dengan “dihitung secara kumulatif” adalah bahwa\npelanggaran yang dilakukan dihitung mulai bulan Januari.\nContoh: . . .`,
    `${P(73)}PRESIDENREPUBLIK INDONESIA- 8 -\nContoh:\nSeorang PNS dari bulan Januari sampai dengan bulan Maret\ntidak masuk kerja selama 5 (lima) hari.`,
  ].join("");
  const hasil = uraikanPenjelasan(naskah);
  const per = Object.fromEntries(hasil.pasal.map((p) => [p.nomor_pasal, p.isi]));

  it("Umum bersih: tanpa kepala, judul peraturan, dan catchword; paragraf yang terpisah halaman tersambung", () => {
    expect(hasil.umum).toBe(
      "Dalam rangka mewujudkan PNS yang handal, profesional, dan\nbermoral sebagai penyelenggara pemerintahan yang baik.\nUntuk mewujudkan PNS yang handal, mutlak diperlukan\nperaturan disiplin PNS.\n" +
        "Peraturan Pemerintah tentang disiplin PNS ini antara lain\nmemuat kewajiban, larangan, dan hukuman disiplin.",
    );
  });

  it("penjelasan pasal: catchword dan kepala tak tersisa, nomor yang terlompat (8-13) tidak dikarang", () => {
    expect(Object.keys(per)).toEqual(["1", "2", "3", "4", "5", "6", "7", "14"]);
    expect(per["2"]).toBe("Cukup jelas.");
    expect(per["3"]).toBe(
      'Angka 1\nCukup jelas.\nAngka 2\nYang dimaksud dengan “tugas kedinasan” adalah tugas yang\nberhubungan dengan:\na. perintah kedinasan;\nb. peraturan perundang-undangan.\nAngka 3\nCukup jelas.',
    );
    expect(per["4"]).toBe(
      "Angka 1\nYang dimaksud dengan “menyalahgunakan wewenang”\nadalah menggunakan kewenangannya.\nAngka 2\nContoh:\nSeorang PNS yang tidak memiliki wewenang.\nAngka 3\nCukup jelas.",
    );
    expect(per["6"]).toBe("PNS yang melanggar ketentuan disiplin PNS dijatuhi hukuman\ndisiplin.");
    expect(per["7"]).toBe(
      "Ayat (1)\nCukup jelas.\nAyat (2)\nHuruf a\nHukuman disiplin yang berupa teguran lisan dinyatakan\nsecara lisan.\nHuruf b\nCukup jelas.\nAyat (3)\nHuruf a\nMasa penundaan kenaikan gaji berkala dihitung penuh.",
    );
    expect(per["14"]).toBe(
      "Yang dimaksud dengan “dihitung secara kumulatif” adalah bahwa\npelanggaran yang dilakukan dihitung mulai bulan Januari.\nContoh:\nSeorang PNS dari bulan Januari sampai dengan bulan Maret\ntidak masuk kerja selama 5 (lima) hari.",
    );
  });

  it("tidak satu pun entri memuat sisa artefak halaman", () => {
    for (const isi of [hasil.umum ?? "", ...hasil.pasal.map((p) => p.isi)]) expect(isi).not.toMatch(/Page \d|PRESIDEN|REPUBLIK INDONESIA|\. \. \./);
  });

  it("pasal batang tubuh berhenti sebelum Penjelasan walau judulnya menempel pada kepala halaman", async () => {
    const { uraikanPasal } = await import("../src/worker/lib/bpk");
    const pasal = uraikanPasal(`Pasal 51\nSelesai.\n${naskah}`);
    expect(pasal.map((p) => p.nomor_pasal)).toEqual(["51"]);
    expect(pasal[0].isi).toBe("Selesai.\nMenteri Hukum dan Hak Asasi Manusia,\nPATRIALIS AKBAR");
  });
});

describe("uraikanPenjelasan: bentuk menempel dari pindaian (produksi)", () => {
  it("PP 93/2021: seluruh bagian pasal menempel dalam satu baris, dengan kepala OCR dan catchword", () => {
    const naskah = [
      "pengalihan Partisipasi Interes.II. PASAL DEMI PASALPasal 1Cukup jelas.\nPasal 2Ayat (1)Yang dimaksud dengan \"harta tidak bergerak\" adalah harta permanen seperti tanah dan bangunan.SK No 096253 AAyat(2)...",
      `${P(14)}PRESIDENREPUELIK INDONESIA-3-Ayat (2)Cukup jelasAyat (3)Cukup jelasPasal 3Cukup jelasPasal 4Ayat (1)Pada masa Eksplorasi Kontraktor menanggung risiko.Huruf aCukup jelasHuruf bCukup jelasHuruf dYang dimaksud dengan \"pengalihan\" adalah pengalihan yang dilakukan untuk memitigasi risiko.`,
      `${P(15)}PRESIDENREPUBLIK INDONESTA-4-Pasal 5Cukup jelas.`,
    ].join("");
    // Sebelum batas penjelasan: naskah hanya memuat bagian pasal, jadi tambahkan judulnya agar batas ditemukan.
    const hasil = uraikanPenjelasan(`PENJELASAN\nATAS\nPERATURAN PEMERINTAH\nI. UMUM\nUraian.\n${naskah}`);
    expect(hasil.umum).toBe("Uraian.\npengalihan Partisipasi Interes.");
    const per = Object.fromEntries(hasil.pasal.map((p) => [p.nomor_pasal, p.isi]));
    expect(Object.keys(per)).toEqual(["1", "2", "3", "4", "5"]);
    expect(per["1"]).toBe("Cukup jelas.");
    expect(per["2"]).toBe(
      'Ayat (1)\nYang dimaksud dengan "harta tidak bergerak" adalah harta permanen seperti tanah dan bangunan.\nAyat (2)\nCukup jelas\nAyat (3)\nCukup jelas',
    );
    expect(per["3"]).toBe("Cukup jelas");
    expect(per["4"]).toBe(
      'Ayat (1)\nPada masa Eksplorasi Kontraktor menanggung risiko.\nHuruf a\nCukup jelas\nHuruf b\nCukup jelas\nHuruf d\nYang dimaksud dengan "pengalihan" adalah pengalihan yang dilakukan untuk memitigasi risiko.',
    );
    expect(per["5"]).toBe("Cukup jelas.");
  });

  it("UU 10/1995 dan UU 8/1995: 'UMUM' menempel pada judul peraturan, 'I. UMUM' menempel pada judul dan uraian", () => {
    const a = uraikanPenjelasan("PENJELASAN\nATAS\nUNDANG-UNDANG\nNOMOR 10 TAHUN 1995\nTENTANG\nKEPABEANANUMUM\n1. Republik Indonesia adalah negara kepulauan.\nPASAL DEMI PASAL\nPasal 1\nCukup jelas.");
    expect(a.umum).toBe("1. Republik Indonesia adalah negara kepulauan.");
    const b = uraikanPenjelasan("PENJELASAN\nATAS\nUNDANG-UNDANG\nNOMOR 8 TAHUN 1995\nTENTANG\nPASAR MODALUMUM\nPembangunan nasional bertujuan.\nPASAL DEMI PASAL\nPasal 1\nCukup jelas.");
    expect(b.umum).toBe("Pembangunan nasional bertujuan.");
    const c = uraikanPenjelasan("PENJELASANATASUNDANG-UNDANG REPUBLIK INDONESIA\nNOMOR 38 TAHUN 2014TENTANG\nKEPERAWATANI. UMUMKesehatan sebagai hak asasi manusia.\nII. PASAL DEMI PASALPasal 1Cukup jelas.Pasal 2Cukup jelas.");
    expect(c.umum).toBe("Kesehatan sebagai hak asasi manusia.");
    expect(c.pasal.map((p) => [p.nomor_pasal, p.isi])).toEqual([["1", "Cukup jelas."], ["2", "Cukup jelas."]]);
  });

  it("UU 10/2020: 'Ayat (1)Huruf aYang dimaksud ...' bersarang, label bertingkat dipisah", () => {
    const naskah = `PENJELASAN\nPASAL DEMI PASAL\nPasal 2Ayat (1)Huruf aYang dimaksud dengan "asas kesederhanaan" adalah pengaturan.Huruf bYang dimaksud dengan "asas efisiensi" adalah hemat.Ayat (2)Huruf aCukup jelas.Huruf bCukup jelas.`;
    expect(ringkas(naskah)).toEqual([
      ["2", 'Ayat (1)\nHuruf a\nYang dimaksud dengan "asas kesederhanaan" adalah pengaturan.\nHuruf b\nYang dimaksud dengan "asas efisiensi" adalah hemat.\nAyat (2)\nHuruf a\nCukup jelas.\nHuruf b\nCukup jelas.'],
    ]);
  });

  it("kata biasa yang kebetulan berawal 'Huruf'/'Ayat' tidak dipecah", () => {
    const hasil = ringkas("PENJELASAN\nPASAL DEMI PASAL\nPasal 1\nHuruf besar dipakai untuk judul. Ayat ini dimaksudkan sebagai contoh.");
    expect(hasil).toEqual([["1", "Huruf besar dipakai untuk judul. Ayat ini dimaksudkan sebagai contoh."]]);
  });
});

describe("uraikanPenjelasan: sel tabel dan 'Cukup jelas' seluruhnya", () => {
  it("UU 19/2013: naskah di dalam sel tabel markdown", () => {
    const naskah = [
      "| PENJELASAN ATAS |\n| I. UMUM |\n| Pembangunan pertanian berkelanjutan. |\n| - |\n| II. PASAL DEMI PASAL |\n| Pasal 1 |\n| Cukup jelas. |\n| Pasal 2 |\n",
      "| Huruf aYang dimaksud dengan “asas kedaulatan” adalah\npenyelenggaraan dengan menjunjung tinggi kedaulatan. |\n| Huruf e . . . |",
      `${P(44)}| Huruf eYang dimaksud dengan “asas keterpaduan” adalah memadukan kepentingan. |\n| - |\n| Pasal 3 |\n| Huruf aCukup jelas. |`,
    ].join("");
    const hasil = uraikanPenjelasan(naskah);
    expect(hasil.umum).toBe("Pembangunan pertanian berkelanjutan.");
    expect(hasil.pasal.map((p) => [p.nomor_pasal, p.isi])).toEqual([
      ["1", "Cukup jelas."],
      [
        "2",
        "Huruf a\nYang dimaksud dengan “asas kedaulatan” adalah\npenyelenggaraan dengan menjunjung tinggi kedaulatan.\nHuruf e\nYang dimaksud dengan “asas keterpaduan” adalah memadukan kepentingan.",
      ],
      ["3", "Huruf a\nCukup jelas."],
    ]);
  });

  it("UU 9/1998: 'PASAL DEMI PASAL / Cukup jelas' untuk seluruh peraturan dilekatkan pada Penjelasan Umum", () => {
    const naskah = "PENJELASAN\nATAS\nUNDANG-UNDANG\nTENTANG\nKEMERDEKAAN MENYAMPAIKAN PENDAPAT DI MUKA UMUM\nUMUM\nMenyampaikan pendapat adalah hak asasi manusia.\nPASAL DEMI PASAL\nCukup jelas\nTAMBAHAN LEMBARAN NEGARA REPUBLIK INDONESIA NOMOR 3789";
    const hasil = uraikanPenjelasan(naskah);
    expect(hasil.pasal).toEqual([]);
    expect(hasil.umum).toBe("Menyampaikan pendapat adalah hak asasi manusia.\n\nPenjelasan pasal demi pasal: Cukup jelas.");
  });

  it("'PASAL DEMI PASAL' yang berisi sesuatu selain 'Cukup jelas' tanpa judul pasal tidak dikarang menjadi 'Cukup jelas'", () => {
    const hasil = uraikanPenjelasan("PENJELASAN\nUMUM\nUraian.\nPASAL DEMI PASAL\nKetentuan ini diatur kemudian.");
    expect(hasil.umum).toBe("Uraian.");
    expect(hasil.pasal).toEqual([]);
  });
});

describe("barisPenjelasan dan hanyaCukupJelas", () => {
  it("Penjelasan Umum urutan 0, lalu penjelasan pasal mulai urutan 1", () => {
    const baris = barisPenjelasan(uraikanPenjelasan("PENJELASAN\nUMUM\nUraian.\nPASAL DEMI PASAL\nPasal 1\nCukup jelas.\nPasal 2\nIsi dua."));
    expect(baris).toEqual([
      { nomor_pasal: NOMOR_UMUM, isi: "Uraian.", urutan: 0 },
      { nomor_pasal: "1", isi: "Cukup jelas.", urutan: 1 },
      { nomor_pasal: "2", isi: "Isi dua.", urutan: 2 },
    ]);
    expect(barisPenjelasan({ umum: null, pasal: [] })).toEqual([]);
  });

  it("'Cukup jelas' saja, boleh per ayat dan huruf; selain itu tidak", () => {
    for (const isi of ["Cukup jelas.", "cukup jelas", "Ayat (1)\nCukup jelas.\nAyat (2)\nCukup jelas.", "Huruf a\nCukup jelas.\nHuruf b\nCukup jelas."]) {
      expect(hanyaCukupJelas(isi), isi).toBe(true);
    }
    for (const isi of ["", "Ayat (1)\nCukup jelas.\nAyat (2)\nYang dimaksud dengan itu.", "Cukup jelas, kecuali huruf b.", "Ayat (1)"]) {
      expect(hanyaCukupJelas(isi), isi).toBe(false);
    }
  });
});
