/**
 * Penyimpanan hasil ekstraksi (ekstrakPdf): Penjelasan di tabel sendiri, versi pengurai, aturan penggantian pasal yang sudah
 * tersimpan, serta pembersihan vektor dan arsip teks yang tak terpakai lagi. Pipeline dasarnya diuji di pipeline.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VERSI_PARSER } from "../../src/worker/lib/bpk";
import { putuskanPenggantian, idPotongan } from "../../src/worker/lib/ingest";
import { baris, buatLingkungan, jalankanAntrean, satu, sisipkan, sqliteAda, type Lingkungan } from "./harness";

const URI = "/akn/id/act/pp/2025/99";
const KUNCI_PDF = "pdf/akn/id/act/pp/2025/99.pdf";
const KUNCI_MD = "teks/akn/id/act/pp/2025/99.md";
const KUNCI_TXT = "teks/akn/id/act/pp/2025/99.txt";
const PDF = new TextEncoder().encode("%PDF-1.4\n...isi pdf palsu...");

const BADAN = [
  "BAB I", "KETENTUAN UMUM", "Pasal 1", "Sampah rumah tangga adalah sampah dari kegiatan sehari-hari.",
  "Pasal 2", "(1) Setiap orang wajib memilah sampah.", "(2) Pemerintah daerah menyediakan fasilitas pengelolaan sampah.",
].join("\n");
const PENJELASAN = [
  "PENJELASAN", "ATAS", "PERATURAN PEMERINTAH REPUBLIK INDONESIA", "NOMOR 99 TAHUN 2025", "TENTANG", "PENGELOLAAN SAMPAH",
  "I. UMUM", "Sampah menimbulkan masalah lingkungan.", "II. PASAL DEMI PASAL",
  "Pasal 1", "Cukup jelas.", "Pasal 2", "Ayat (1)", "Yang dimaksud dengan memilah adalah memisahkan jenis sampah.", "Ayat (2)", "Cukup jelas.",
].join("\n");
const NASKAH = `${BADAN}\n${PENJELASAN}`;

const pesan = (ubah: Record<string, unknown> = {}) => ({ tipe: "ekstrak_pdf", frbr_uri: URI, r2_key: KUNCI_PDF, ...ubah });

describe.skipIf(!sqliteAda)("penyimpanan hasil ekstraksi", () => {
  let l: Lingkungan;
  beforeEach(async () => {
    l = buatLingkungan();
    await sisipkan(l, [{ uri: URI, jenis: "PP", nomor: "99", tahun: 2025, judul: "Pengelolaan Sampah", bpkId: "555" }]);
    await l.db.prepare(`UPDATE laws SET r2_pdf_key = ? WHERE frbr_uri = ?`).bind(KUNCI_PDF, URI).run();
    l.r2.objek.set(KUNCI_PDF, { bytes: PDF });
    l.ai.markdown.set("99.pdf", NASKAH);
    l.ai.jawaban = "Ringkasan AI.";
  });
  afterEach(() => l.tutup());

  const ekstrak = (ubah: Record<string, unknown> = {}) => jalankanAntrean(l, [pesan(ubah)]);
  const pasalTersimpan = () => baris(l, `SELECT nomor_pasal, ayat, isi FROM articles ORDER BY urutan`);
  const daftarHapus = async (jenis: "vektor" | "r2") =>
    (await baris<{ kunci: string }>(l, `SELECT kunci FROM daftar_hapus WHERE jenis_objek = ? ORDER BY kunci`, jenis)).map((r) => r.kunci);
  /** Tanam keadaan "sudah pernah diekstrak": pasal tersimpan, arsip teks, dan baris log dengan versi pengurai tertentu. */
  const tanamEkstraksi = async (o: { arsip?: string; kunci?: string; versi?: number; pasal?: Array<{ id: string; nomor: string; ayat?: string | null; isi: string }> } = {}) => {
    const kunci = o.kunci ?? KUNCI_MD;
    if (o.arsip !== undefined) await l.r2.put(kunci, o.arsip);
    const pasal = o.pasal ?? [];
    for (const [i, p] of pasal.entries()) {
      await l.db.prepare(`INSERT INTO articles (id, frbr_uri, nomor_pasal, ayat, isi, urutan) VALUES (?,?,?,?,?,?)`).bind(p.id, URI, p.nomor, p.ayat ?? null, p.isi, i).run();
    }
    await l.db.prepare(`UPDATE laws SET jumlah_pasal = ?, r2_text_key = ?, isi_status = 'lengkap' WHERE frbr_uri = ?`).bind(pasal.length, o.arsip !== undefined ? kunci : null, URI).run();
    await l.db.prepare(`INSERT INTO ekstraksi_log (frbr_uri, vonis, versi_parser) VALUES (?, 'bersih', ?)`).bind(URI, o.versi ?? 0).run();
  };

  describe("Penjelasan dan versi pengurai", () => {
    it("Penjelasan disimpan di tabel sendiri, bukan sebagai pasal kembar; pasal batang tubuh bersih", async () => {
      expect(await ekstrak()).toEqual({ diakui: 1, diulang: [] });
      expect(await pasalTersimpan()).toEqual([
        { nomor_pasal: "1", ayat: null, isi: "Sampah rumah tangga adalah sampah dari kegiatan sehari-hari." },
        { nomor_pasal: "2", ayat: "1", isi: "Setiap orang wajib memilah sampah." },
        { nomor_pasal: "2", ayat: "2", isi: "Pemerintah daerah menyediakan fasilitas pengelolaan sampah." },
      ]);
      expect(await baris(l, `SELECT nomor_pasal, isi, urutan FROM penjelasan ORDER BY urutan`)).toEqual([
        { nomor_pasal: "Umum", isi: "Sampah menimbulkan masalah lingkungan.", urutan: 0 },
        { nomor_pasal: "1", isi: "Cukup jelas.", urutan: 1 },
        { nomor_pasal: "2", isi: "Ayat (1)\nYang dimaksud dengan memilah adalah memisahkan jenis sampah.\nAyat (2)\nCukup jelas.", urutan: 2 },
      ]);
      // Penjelasan tidak ikut terindeks sebagai pasal: tak ada vektornya, tak ada di pencarian teks penuh.
      expect([...l.vektor.simpan.keys()].some((k) => k.includes("~"))).toBe(false);
      expect(await satu(l, `SELECT COUNT(*) AS n FROM articles WHERE isi LIKE '%Cukup jelas%'`)).toEqual({ n: 0 });
    });

    it("versi pengurai dicatat pada setiap hasil penguraian: berhasil, tanpa pasal, dan hasil yang tidak dipakai", async () => {
      await ekstrak();
      expect(await satu(l, `SELECT versi_parser FROM ekstraksi_log`)).toEqual({ versi_parser: VERSI_PARSER });

      await l.db.prepare(`UPDATE ekstraksi_log SET versi_parser = 0`).run();
      l.ai.markdown.set("99.pdf", "Halaman pindaian tanpa struktur apa pun.");
      await ekstrak();
      expect(await satu(l, `SELECT vonis, versi_parser FROM ekstraksi_log`)).toEqual({ vonis: "tanpa_pasal", versi_parser: VERSI_PARSER });

      // Kegagalan konversi bukan hasil penguraian: versinya tak dicatat, jadi tetap ditawarkan sampai berhasil.
      await l.db.prepare(`UPDATE ekstraksi_log SET versi_parser = 0`).run();
      l.ai.galatKonversi = "PDF terenkripsi";
      await ekstrak();
      expect(await satu(l, `SELECT vonis, versi_parser FROM ekstraksi_log`)).toEqual({ vonis: "gagal", versi_parser: 0 });
    });

    it("alasan vonis kerapian dicatat di ekstraksi_log.catatan: pasal hilang membuat berat; naskah utuh tak mencatat apa pun", async () => {
      await ekstrak();
      expect(await satu(l, `SELECT vonis, catatan FROM ekstraksi_log`)).toEqual({ vonis: "bersih", catatan: null });

      // Pasal 1-20 tanpa 3, 7, 12, 15, 17: lima nomor dari duapuluh (25%).
      await l.db.prepare(`DELETE FROM ekstraksi_log`).run();
      await l.db.prepare(`DELETE FROM articles`).run();
      const nomor = Array.from({ length: 20 }, (_, i) => i + 1).filter((n) => ![3, 7, 12, 15, 17].includes(n));
      l.ai.markdown.set("99.pdf", nomor.map((n) => `Pasal ${n}\nIsi pasal ${n} yang cukup panjang dan bersih.`).join("\n"));
      await ekstrak();
      expect(await satu(l, `SELECT vonis, pasal_tertinggi, celah_pasal, catatan FROM ekstraksi_log`)).toEqual({
        vonis: "berat", pasal_tertinggi: 20, celah_pasal: 5, catatan: "5 dari 20 nomor pasal tak terbaca",
      });
    });

    it("uraian ulang menggantikan Penjelasan lama, dan naskah tanpa Penjelasan mengosongkannya", async () => {
      await ekstrak();
      l.ai.markdown.set("99.pdf", BADAN);
      await l.db.prepare(`UPDATE laws SET r2_text_key = ? WHERE frbr_uri = ?`).bind(KUNCI_MD, URI).run();
      await ekstrak();
      expect(await satu(l, `SELECT COUNT(*) AS n FROM penjelasan`)).toEqual({ n: 0 });
      expect(await satu(l, `SELECT COUNT(*) AS n FROM articles`)).toEqual({ n: 3 });
    });

    it("migrasi 0007 belum diterapkan: pasal tetap tersimpan, tanpa galat", async () => {
      await l.db.exec(`DROP TABLE penjelasan`);
      await l.db.exec(`DROP INDEX idx_ekstraksi_versi`);
      await l.db.exec(`ALTER TABLE ekstraksi_log DROP COLUMN versi_parser`);
      expect(await ekstrak()).toEqual({ diakui: 1, diulang: [] });
      expect((await pasalTersimpan()).length).toBe(3);
      expect(await satu(l, `SELECT jumlah_pasal, isi_status FROM laws`)).toEqual({ jumlah_pasal: 3, isi_status: "lengkap" });
      expect(await satu(l, `SELECT vonis FROM ekstraksi_log`)).toEqual({ vonis: "bersih" });
    });
  });

  describe("uraian ulang naskah BPK yang pengurainya diperbaiki", () => {
    // Bentuk di produksi (701 peraturan): Penjelasan tersimpan sebagai pasal kembar berakhiran ~2 di ujung peraturan.
    const KEMBAR = [
      { id: `${URI}#pasal-1`, nomor: "1", isi: "Sampah rumah tangga adalah sampah dari kegiatan sehari-hari." },
      { id: `${URI}#pasal-2-ayat-1`, nomor: "2", ayat: "1", isi: "Setiap orang wajib memilah sampah." },
      { id: `${URI}#pasal-2-ayat-2`, nomor: "2", ayat: "2", isi: `Pemerintah daerah menyediakan fasilitas pengelolaan sampah.\n${PENJELASAN}` },
      { id: `${URI}#pasal-1~2`, nomor: "1", isi: "Cukup jelas." },
      { id: `${URI}#pasal-2~2`, nomor: "2", isi: "Cukup jelas." },
    ];

    beforeEach(async () => {
      await tanamEkstraksi({ arsip: NASKAH, pasal: KEMBAR });
      for (const p of KEMBAR) await l.vektor.upsert([{ id: p.id, values: [1], metadata: {} }]);
    });

    it("pasal kembar dari Penjelasan hilang, Penjelasan masuk tabelnya, dan vektor kembarannya dijadwalkan dihapus", async () => {
      expect(await ekstrak({ dari_teks: true })).toEqual({ diakui: 1, diulang: [] });
      expect((await pasalTersimpan()).map((p) => [p.nomor_pasal, p.ayat])).toEqual([["1", null], ["2", "1"], ["2", "2"]]);
      expect((await pasalTersimpan())[2].isi).toBe("Pemerintah daerah menyediakan fasilitas pengelolaan sampah.");
      expect(await satu(l, `SELECT COUNT(*) AS n FROM penjelasan`)).toEqual({ n: 3 });
      expect(await daftarHapus("vektor")).toEqual([`${URI}#pasal-1~2`, `${URI}#pasal-2~2`]);
      expect(await satu(l, `SELECT versi_parser FROM ekstraksi_log`)).toEqual({ versi_parser: VERSI_PARSER });
    });

    it("tanpa konversi PDF, dan tanpa ringkasan AI baru: isi peraturannya tidak berubah; vektor diindeks ulang", async () => {
      await ekstrak({ dari_teks: true });
      expect(l.ai.konversi).toEqual([]);
      expect(l.antrean.pesan).toEqual([{ tipe: "indeks_vektor", frbr_uri: URI }]);
    });

    it("pasal yang tak berubah tidak ditulis ulang, tak diindeks ulang, dan tak ada yang dijadwalkan dihapus", async () => {
      await ekstrak({ dari_teks: true });
      l.antrean.kuras();
      await l.db.prepare(`DELETE FROM daftar_hapus`).run();
      await l.db.prepare(`UPDATE articles SET judul = 'tanda'`).run(); // kolom ini tak dibandingkan; hilang bila barisnya ditulis ulang

      await l.db.prepare(`UPDATE ekstraksi_log SET versi_parser = 0`).run();
      expect(await ekstrak({ dari_teks: true })).toEqual({ diakui: 1, diulang: [] });
      expect(await baris(l, `SELECT DISTINCT judul FROM articles`)).toEqual([{ judul: "tanda" }]);
      expect(l.antrean.pesan).toEqual([]);
      expect(await daftarHapus("vektor")).toEqual([]);
      expect(await satu(l, `SELECT versi_parser FROM ekstraksi_log`)).toEqual({ versi_parser: VERSI_PARSER });
    });

    it("vektor yang tertunda dihapus dari penggantian sebelumnya tidak ikut menghapus vektor yang kini dipakai lagi", async () => {
      await l.db.prepare(`INSERT INTO daftar_hapus (jenis_objek, kunci) VALUES ('vektor', ?), ('vektor', ?), ('vektor', ?)`)
        .bind(`${URI}#pasal-1`, `${URI}#pasal-9`, "/akn/id/act/pp/2025/9#pasal-1").run();
      await ekstrak({ dari_teks: true });
      expect(await daftarHapus("vektor")).toEqual(["/akn/id/act/pp/2025/9#pasal-1", `${URI}#pasal-1~2`, `${URI}#pasal-2~2`, `${URI}#pasal-9`].sort());
    });

    it("uraian ulang yang kehilangan lebih dari separuh nomor pasal (naskah besar) dipertahankan yang lama", async () => {
      const banyak = Array.from({ length: 12 }, (_, i) => ({ id: `${URI}#pasal-${i + 1}`, nomor: String(i + 1), isi: `Isi ${i + 1}.` }));
      await l.db.prepare(`DELETE FROM articles`).run();
      await l.db.prepare(`DELETE FROM ekstraksi_log`).run();
      await tanamEkstraksi({ arsip: NASKAH, pasal: banyak });
      expect(await ekstrak({ dari_teks: true })).toEqual({ diakui: 1, diulang: [] });
      expect((await pasalTersimpan()).length).toBe(12);
      expect(await satu(l, `SELECT catatan, versi_parser FROM ekstraksi_log`)).toEqual({
        catatan: "dipertahankan: uraian ulang hanya 2 dari 12 nomor pasal tersimpan", versi_parser: VERSI_PARSER,
      });
    });

    it("pasal yang sama persis dipindah ke baris tanpa Penjelasan sama saja: nomor yang sama, baris lebih sedikit, tetap diganti", async () => {
      // Dulu 5 baris (dua di antaranya kembar Penjelasan), kini 3 baris: nomor berbeda sama-sama 2.
      await ekstrak({ dari_teks: true });
      expect((await pasalTersimpan()).length).toBe(3);
      expect(await satu(l, `SELECT jumlah_pasal FROM laws`)).toEqual({ jumlah_pasal: 3 });
    });
  });

  describe("naskah baru menggantikan teks lama (sumber yang sudah dihentikan)", () => {
    const LAMA = ["1", "2", "3"].map((n) => ({ id: `${URI}#pasal-${n}`, nomor: n, isi: `Teks lama ${n}.` }));

    it("hasil PDF dengan nomor sama atau lebih banyak menggantikan; arsip lama (.txt) dijadwalkan dihapus dan kunci dialihkan ke .md", async () => {
      await tanamEkstraksi({ arsip: "teks lama", kunci: KUNCI_TXT, pasal: LAMA });
      l.ai.markdown.set("99.pdf", `${BADAN}\nPasal 3\nTiga.`);
      await ekstrak();
      expect((await pasalTersimpan()).map((p) => p.nomor_pasal)).toEqual(["1", "2", "2", "3"]);
      expect(await satu(l, `SELECT r2_text_key FROM laws`)).toEqual({ r2_text_key: KUNCI_MD });
      expect(await daftarHapus("r2")).toEqual([KUNCI_TXT]);
      // Hanya id yang tak dipakai lagi dijadwalkan dihapus: "pasal-2" lama kini bernama "pasal-2-ayat-1" dan "-ayat-2".
      expect(await daftarHapus("vektor")).toEqual([`${URI}#pasal-2`]);
      expect(l.antrean.pesan.map((p) => (p as { tipe: string }).tipe).sort()).toEqual(["indeks_vektor", "ringkas"]);
    });

    it("PDF yang rusak berat tidak menggantikan teks lama walau nomornya cukup; versi pengurainya tetap dicatat", async () => {
      await tanamEkstraksi({ arsip: "teks lama", kunci: KUNCI_TXT, pasal: LAMA });
      l.ai.markdown.set("99.pdf", "Pasal 1\nTarif 5o/o dan 7o/o.\nPasal 2\nIuran 3o/o.\nPasal 3\nBunga 12o/o.");
      await ekstrak();
      expect((await pasalTersimpan()).map((p) => p.isi)).toEqual(["Teks lama 1.", "Teks lama 2.", "Teks lama 3."]);
      expect(await satu(l, `SELECT vonis, catatan, versi_parser FROM ekstraksi_log`)).toEqual({
        vonis: "berat", catatan: "dipertahankan: teks PDF rusak berat; 3 nomor pasal tersimpan", versi_parser: VERSI_PARSER,
      });
      expect(await satu(l, `SELECT r2_text_key FROM laws`)).toEqual({ r2_text_key: KUNCI_TXT });
      expect(await daftarHapus("r2")).toEqual([]);
      expect(l.antrean.pesan).toEqual([]);
      expect(l.r2.objek.has(KUNCI_MD)).toBe(true); // teks konversi tetap diarsipkan untuk diperiksa
    });

    it("peraturan yang belum punya pasal menerima hasil PDF walau rusak berat (lebih baik daripada kosong)", async () => {
      l.ai.markdown.set("99.pdf", "Pasal 1\nTarif 5o/o dan 7o/o.\nPasal 2\nIuran 3o/o.");
      await ekstrak();
      expect((await pasalTersimpan()).length).toBe(2);
      expect(await satu(l, `SELECT vonis FROM ekstraksi_log`)).toEqual({ vonis: "berat" });
    });
  });

  describe("mode dari_teks memakai arsip BPK lebih dulu", () => {
    it("ada arsip .md dan arsip lama .txt: yang diurai .md, dan kunci dialihkan ke .md", async () => {
      await tanamEkstraksi({ arsip: "Pasal 1\nTeks dari arsip lama.", kunci: KUNCI_TXT, pasal: [{ id: `${URI}#pasal-1`, nomor: "1", isi: "Teks dari arsip lama." }] });
      await l.r2.put(KUNCI_MD, NASKAH);
      await ekstrak({ dari_teks: true });
      expect(l.ai.konversi).toEqual([]);
      expect((await pasalTersimpan()).length).toBe(3);
      expect(await satu(l, `SELECT r2_text_key FROM laws`)).toEqual({ r2_text_key: KUNCI_MD });
      expect(await daftarHapus("r2")).toEqual([KUNCI_TXT]);
      // Naskahnya baru bagi peraturan ini (tersimpan dari arsip lain), jadi ringkasannya disusun.
      expect(l.antrean.pesan.map((p) => (p as { tipe: string }).tipe).sort()).toEqual(["indeks_vektor", "ringkas"]);
    });

    it("hanya arsip lama .txt: diurai, dan kuncinya dipertahankan", async () => {
      await tanamEkstraksi({ arsip: NASKAH, kunci: KUNCI_TXT });
      await ekstrak({ dari_teks: true });
      expect(l.ai.konversi).toEqual([]);
      expect(await satu(l, `SELECT r2_text_key, jumlah_pasal FROM laws`)).toEqual({ r2_text_key: KUNCI_TXT, jumlah_pasal: 3 });
      expect(await daftarHapus("r2")).toEqual([]);
    });
  });

  describe("vektor yatim", () => {
    const panjang = (n: number) => "Kalimat uji yang cukup panjang untuk dipotong. ".repeat(Math.ceil(n / 47)).slice(0, n);

    it("pasal yang memendek melepas potongan lanjutannya, dan pasal yang lenyap melepas semua vektornya", async () => {
      const lama = [
        { id: `${URI}#pasal-1`, nomor: "1", isi: panjang(2900) }, // ceil(2900/500) = 6 potongan lanjutan paling banyak
        { id: `${URI}#pasal-3`, nomor: "3", isi: panjang(1500) }, // lenyap
      ];
      await tanamEkstraksi({ arsip: NASKAH, pasal: lama });
      // Pasal 3 berganti nomor menjadi Pasal 2 (jumlah nomor tetap, jadi hasilnya menggantikan); pasal 1 memendek. Nomornya berurutan:
      // lompatan 1 ke 8 dinilai kehilangan enam pasal (vonis berat), dan hasil berat tak menggantikan apa pun.
      l.ai.markdown.set("99.pdf", `Pasal 1\n${panjang(1500)}\nPasal 2\nBaru.`);
      await l.db.prepare(`UPDATE laws SET r2_text_key = NULL`).run(); // naskah baru, bukan uraian ulang
      await ekstrak();
      const hapus = await daftarHapus("vektor");
      // pasal-1 lama (2900 karakter, tiga potongan) kini dua potongan (1500 karakter): "~2" yang pasti ada, dan sisa batas atas
      // sampai "~6", yatim; seluruh pasal-3 (beserta potongannya) yatim; "pasal-1" dan "pasal-1~1" masih dipakai.
      expect(hapus).toEqual(
        expect.arrayContaining([`${URI}#pasal-1~2`, `${URI}#pasal-1~6`, `${URI}#pasal-3`, `${URI}#pasal-3~1`, `${URI}#pasal-3~3`]),
      );
      expect(hapus).not.toContain(`${URI}#pasal-1`);
      expect(hapus).not.toContain(`${URI}#pasal-1~1`);
      expect(hapus).not.toContain(`${URI}#pasal-2`);
    });

    it("idPotongan: tidak ada potongan lanjutan untuk pasal pendek; batas atas longgar untuk yang panjang", () => {
      expect(idPotongan("x", 1200)).toEqual([]);
      expect(idPotongan("x", 1201)).toEqual(["x~1", "x~2", "x~3"]);
      expect(idPotongan("x", 2000, 3)).toEqual(["x~3", "x~4"]);
      expect(idPotongan("x", 2000, 9)).toEqual([]);
    });
  });
});

describe("putuskanPenggantian", () => {
  const dasar = { nomorLama: 5, nomorBaru: 5, vonis: "bersih" as const, sumberSama: false };

  it("belum ada pasal tersimpan: selalu ganti, walau rusak berat", () => {
    expect(putuskanPenggantian({ ...dasar, nomorLama: 0, vonis: "berat" })).toEqual({ ganti: true });
  });

  it("hasil PDF baru: ganti bila nomornya sama atau lebih banyak dan tidak rusak berat", () => {
    expect(putuskanPenggantian(dasar)).toEqual({ ganti: true });
    expect(putuskanPenggantian({ ...dasar, nomorBaru: 9, vonis: "ringan" })).toEqual({ ganti: true });
    expect(putuskanPenggantian({ ...dasar, nomorBaru: 4 })).toEqual({
      ganti: false, alasan: "dipertahankan: 5 nomor pasal tersimpan lebih banyak dari 4 hasil PDF",
    });
    expect(putuskanPenggantian({ ...dasar, nomorBaru: 9, vonis: "berat" })).toEqual({
      ganti: false, alasan: "dipertahankan: teks PDF rusak berat; 5 nomor pasal tersimpan",
    });
  });

  it("uraian ulang arsip BPK yang sama: ganti, kecuali nomornya menyusut lebih dari separuh pada naskah dengan sepuluh nomor atau lebih", () => {
    const ulang = { ...dasar, sumberSama: true };
    expect(putuskanPenggantian({ ...ulang, nomorBaru: 3, vonis: "berat" })).toEqual({ ganti: true }); // naskah kecil, mutu tak dipersoalkan
    expect(putuskanPenggantian({ ...ulang, nomorLama: 10, nomorBaru: 5 })).toEqual({ ganti: true }); // tepat separuh
    expect(putuskanPenggantian({ ...ulang, nomorLama: 10, nomorBaru: 4 })).toEqual({
      ganti: false, alasan: "dipertahankan: uraian ulang hanya 4 dari 10 nomor pasal tersimpan",
    });
    expect(putuskanPenggantian({ ...ulang, nomorLama: 9, nomorBaru: 1 })).toEqual({ ganti: true });
  });
});
