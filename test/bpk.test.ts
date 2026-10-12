import { describe, expect, it } from "vitest";
import {
  frbrDari,
  idPasal,
  idPasalUnik,
  nilaiKualitasEkstraksi,
  petakanDokumen,
  relasiDari,
  sitasiDariTeks,
  statusDari,
  tanggalIndonesia,
  uraikanPasal,
} from "../src/worker/lib/bpk";

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

  it("garis miring dan spasi di dalam nomor tidak menambah segmen alamat; Tap MPR ditulis seperti pasal.id", () => {
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

  it("nomor Tap MPR dan nomor bernol di depan ditulis seperti pasal.id; baris baru tak menambah ragam penulisan", () => {
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

  it("menolak dokumen tanpa nomor dan tahun", () => {
    expect(petakanDokumen({ bpk_id: "1", meta: { Judul: "Tanpa nomor dan tahun" } })).toBeNull();
  });
});
