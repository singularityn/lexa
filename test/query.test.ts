import { describe, expect, it } from "vitest";
import { kataDasar, kueriUntukEmbedding, uraiKueri } from "../src/worker/lib/query";
import { bukaIndeksUji } from "./helpers/fts";

// Tes karakterisasi: mengunci perilaku kode v0.1 yang dipulihkan dari produksi,
// agar perubahan berikutnya (refactor atau perbaikan) terlihat jelas dampaknya.

describe("kataDasar (stemmer Nazief-Adriani ringkas)", () => {
  it("selalu menyertakan bentuk asli sebagai kandidat pertama", () => {
    for (const kata of ["pekerja", "berhak", "diatur", "peraturan", "ketenagakerjaan", "bekerja"]) {
      expect(kataDasar(kata)[0]).toBe(kata);
    }
  });

  it("melucuti imbuhan umum", () => {
    expect(kataDasar("pekerja")).toEqual(["pekerja", "kerja"]);
    expect(kataDasar("berhak")).toEqual(["berhak", "hak"]);
    expect(kataDasar("diatur")).toEqual(["diatur", "atur"]);
    expect(kataDasar("dipidana")).toEqual(["dipidana", "pidana"]);
  });

  it("menangani peluluhan dan awalan majemuk", () => {
    expect(kataDasar("memperoleh")).toEqual(["memperoleh", "peroleh"]);
    expect(kataDasar("pemutusan")).toContain("putus");
    expect(kataDasar("peraturan")).toContain("atur");
  });

  it.todo("'bekerja' seharusnya juga menghasilkan 'kerja' (awalan 'be-' belum dilucuti)");
});

describe("uraiKueri", () => {
  it("mengenali sitasi 'UU 13 Tahun 2003'", () => {
    expect(uraiKueri("UU 13 Tahun 2003").sitasi).toEqual({ jenis: "UU", nomor: "13", tahun: 2003 });
  });

  it("mengenali sitasi 'UU No. 13/2003 Pasal 156'", () => {
    expect(uraiKueri("UU No. 13/2003 Pasal 156").sitasi).toEqual({ jenis: "UU", nomor: "13", tahun: 2003 });
  });

  it("tidak menganggap kueri biasa sebagai sitasi", () => {
    expect(uraiKueri("cuti melahirkan").sitasi).toBeNull();
    expect(uraiKueri("PHK pesangon").sitasi).toBeNull();
  });

  it("menjembatani kosakata awam dan istilah resmi lewat sinonim", () => {
    // UU 13/2003 Pasal 82 memakai kata "istirahat", bukan "cuti".
    const terms = uraiKueri("cuti melahirkan").terms;
    expect(terms).toEqual(expect.arrayContaining(["istirahat", "persalinan"]));
  });

  it("memperluas singkatan hukum", () => {
    expect(uraiKueri("PHK pesangon").terms).toContain("pemutusan hubungan kerja");
    expect(uraiKueri("Pasal 28 UU ITE").terms).toContain("informasi dan transaksi elektronik");
  });

  it("menjaga frasa dalam tanda kutip sebagai satu kesatuan", () => {
    const hasil = uraiKueri('"pemutusan hubungan kerja" pesangon');
    expect(hasil.frasa).toEqual(["pemutusan hubungan kerja"]);
    expect(hasil.fts.startsWith('"pemutusan hubungan kerja" AND ')).toBe(true);
  });

  it("menghasilkan ekspresi kosong untuk masukan tanpa isi", () => {
    expect(uraiKueri("   ").fts).toBe("");
    expect(uraiKueri("(((").fts).toBe("");
  });

  it("tidak membiarkan operator FTS5 dari pengguna menjadi operator", () => {
    // "OR" huruf besar dari pengguna harus dikutip sebagai frasa biasa.
    expect(uraiKueri('x" OR "y').fts).toContain('"OR"');
    // Operator huruf kecil hanyalah kata biasa; semuanya dikutip.
    expect(uraiKueri("AND OR NOT").fts).toBe('("and") AND ("or") AND ("not")');
  });

  it("mengenali 'Peraturan Pemerintah Nomor 35 Tahun 2021' (nama panjang) sebagai sitasi PP", () => {
    expect(uraiKueri("Peraturan Pemerintah Nomor 35 Tahun 2021").sitasi).toEqual({ jenis: "PP", nomor: "35", tahun: 2021 });
  });
});

describe("uraiKueri: kata yang diketik, sinonim, dan pencarian longgar", () => {
  it("tanpa sinonim, ekspresi harfiah sama dengan ekspresi biasa", () => {
    const k = uraiKueri("perundang-undangan");
    expect(k.ftsLiteral).toBe(k.fts);
    expect(k.ftsLonggar).toBe("");
  });

  it("sinonim hanya ada di ekspresi biasa, tidak di ekspresi harfiah", () => {
    const k = uraiKueri("pesangon");
    expect(k.fts).toContain('"kompensasi"');
    expect(k.fts).toContain('"uang pesangon"');
    expect(k.ftsLiteral).not.toContain("kompensasi");
    expect(k.ftsLiteral).toContain('"pesangon"');
  });

  it("singkatan dan ejaan lain dari kata yang sama dihitung sebagai kata yang diketik (bukan sinonim)", () => {
    // Pengguna "PHK" menginginkan pasal tentang pemutusan hubungan kerja; ekspresinya tak perlu dibedakan.
    const phk = uraiKueri("PHK");
    expect(phk.ftsLiteral).toBe(phk.fts);
    expect(phk.ftsLiteral).toContain('"pemutusan hubungan kerja"');
    // "perlindungan" harus menemukan "Pelindungan" (ejaan resmi UU 27/2022) lewat jalur harfiah.
    const lindung = uraiKueri("perlindungan data pribadi");
    expect(lindung.ftsLiteral).toContain('"pelindungan"');
    expect(uraiKueri("pelindungan").ftsLiteral).toContain('"perlindungan"');
    expect(uraiKueri("izin usaha").ftsLiteral).toContain('"ijin"');
  });

  it("frasa berkutip tetap di kedua ekspresi dan wajib pada ekspresi longgar", () => {
    const k = uraiKueri('"pemutusan hubungan kerja" pesangon karyawan kontrak');
    for (const e of [k.fts, k.ftsLiteral, k.ftsLonggar]) expect(e.startsWith('"pemutusan hubungan kerja" AND ')).toBe(true);
  });

  it("kata tanya dan kata ganti orang tidak dicari", () => {
    const k = uraiKueri("berapa lama cuti melahirkan bagi pekerja perempuan? apakah saya boleh");
    expect(k.terms).not.toEqual(expect.arrayContaining(["berapa", "apakah", "saya", "bagi"]));
    expect(k.terms).toEqual(expect.arrayContaining(["lama", "cuti", "melahirkan", "pekerja", "perempuan", "boleh"]));
  });

  it("ekspresi longgar: kueri pendek (kurang dari tiga kata) tidak dilonggarkan", () => {
    expect(uraiKueri("kapal selam").ftsLonggar).toBe("");
    expect(uraiKueri("cuti").ftsLonggar).toBe("");
    expect(uraiKueri("").ftsLonggar).toBe("");
  });

  it("ekspresi longgar: tiga kata menjadi tiga pasangan 'dua dari tiga', empat kata enam pasangan", () => {
    const pasangan = (e: string) => (e.match(/\) AND \(/g) ?? []).length; // satu "AND" antar-kelompok per pasangan
    expect(uraiKueri("sanksi pidana korupsi").ftsLonggar.split(" OR (").length).toBeGreaterThan(1);
    expect(pasangan(uraiKueri("sanksi pidana korupsi").ftsLonggar)).toBe(3);
    expect(pasangan(uraiKueri("sanksi pidana korupsi negara").ftsLonggar)).toBe(6);
  });

  it("ekspresi longgar dibatasi enam kata pertama (15 pasangan)", () => {
    const k = uraiKueri("satu dua tiga empat lima enam tujuh delapan sembilan");
    expect((k.ftsLonggar.match(/\) AND \(/g) ?? []).length).toBe(15);
    expect(k.ftsLonggar).not.toContain("tujuh");
    // Ekspresi biasa tetap memuat semua kata.
    expect(k.fts).toContain("sembilan");
  });
});

describe("kueriUntukEmbedding", () => {
  it("merapikan spasi dan membuang tanda kurung tanpa membuang kata", () => {
    expect(kueriUntukEmbedding("PHK dan pesangon?  (sanksi)")).toBe("PHK dan pesangon? sanksi");
  });
});

describe("kompatibilitas ekspresi dengan FTS5 sungguhan", () => {
  const indeks = bukaIndeksUji([
    "uang pesangon pekerja apabila terjadi pemutusan hubungan kerja",
    "dasar peraturan perundang-undangan nasional",
    "cuti istirahat melahirkan persalinan",
  ]);
  const fts5Ada = indeks !== null;

  const aman = [
    "pesangon",
    "cuti melahirkan",
    "UU 13 Tahun 2003",
    "PHK pesangon",
    "Pasal 28 UU ITE",
    '"pemutusan hubungan kerja" pesangon',
    "AND OR NOT",
    "a:b NEAR(c d) *",
    'x" OR "y',
  ];

  it.skipIf(!fts5Ada).each(aman)("ekspresi untuk %j valid di FTS5", (kueri) => {
    const { fts } = uraiKueri(kueri);
    expect(fts).not.toBe("");
    expect(() => indeks!.cocok(fts)).not.toThrow();
  });

  it.skipIf(!fts5Ada)("kueri yang bermakna benar-benar menemukan dokumennya", () => {
    expect(indeks!.cocok(uraiKueri("pesangon").fts)).toBe(1);
    expect(indeks!.cocok(uraiKueri("cuti melahirkan").fts)).toBe(1);
  });

  // Bug v0.1 yang sudah diperbaiki: kata bertanda hubung dan token berawalan "-"
  // ditulis tanpa tanda kutip, sehingga FTS5 membacanya sebagai filter kolom dan
  // melempar "no such column". Di produksi galat ini ditelan (`.catch(() => [])`),
  // jadi jalur kata kunci diam-diam kosong untuk kueri seperti
  // "peraturan perundang-undangan".
  it.skipIf(!fts5Ada).each([
    "pesangon", "PHK pesangon", "berapa lama cuti melahirkan bagi pekerja perempuan", "sanksi pidana korupsi",
    '"pemutusan hubungan kerja" uang pesangon karyawan kontrak', "perundang-undangan nasional dasar peraturan", "a-b c-d e-f",
  ])("ekspresi harfiah dan longgar untuk %j juga valid di FTS5", (kueri) => {
    const { ftsLiteral, ftsLonggar } = uraiKueri(kueri);
    expect(() => indeks!.cocok(ftsLiteral)).not.toThrow();
    if (ftsLonggar) expect(() => indeks!.cocok(ftsLonggar)).not.toThrow();
  });

  it.skipIf(!fts5Ada)("ekspresi longgar menemukan dokumen yang hanya memuat sebagian kata, ekspresi ketat tidak", () => {
    const { fts, ftsLonggar } = uraiKueri("pesangon pekerja kapal");
    expect(indeks!.cocok(fts)).toBe(0);
    expect(indeks!.cocok(ftsLonggar)).toBeGreaterThan(0);
  });

  it.skipIf(!fts5Ada)("kata bertanda hubung ('perundang-undangan') menghasilkan ekspresi valid yang menemukan dokumennya", () => {
    const { fts } = uraiKueri("peraturan perundang-undangan");
    expect(() => indeks!.cocok(fts)).not.toThrow();
    expect(indeks!.cocok(fts)).toBe(1);
    expect(indeks!.cocok(uraiKueri("perundang-undangan").fts)).toBe(1);
  });

  it.skipIf(!fts5Ada)("kata bertanda hubung ikut dicari lewat awalan ('perundang-undang')", () => {
    expect(indeks!.cocok(uraiKueri("perundang-undang").fts)).toBe(1);
  });

  it.skipIf(!fts5Ada)("token berawalan atau berakhiran '-' diperlakukan sebagai katanya", () => {
    expect(uraiKueri("-pesangon").terms).toContain("pesangon");
    expect(uraiKueri("pesangon-").terms).toContain("pesangon");
    expect(indeks!.cocok(uraiKueri("-pesangon").fts)).toBe(1);
    expect(indeks!.cocok(uraiKueri("pesangon-").fts)).toBe(1);
  });

  it.skipIf(!fts5Ada)("tanda hubung sendirian atau berderet tidak menghasilkan ekspresi", () => {
    for (const kueri of ["-", "--", "- -", "---"]) expect(uraiKueri(kueri).fts, kueri).toBe("");
  });

  it.skipIf(!fts5Ada).each(["a-b", "x-y-z foo", "pasal 28-29", "(foo-bar)", "foo-", "-foo-bar-"])("kombinasi tanda hubung %j valid di FTS5", (kueri) => {
    const { fts } = uraiKueri(kueri);
    expect(() => indeks!.cocok(fts)).not.toThrow();
  });
});
