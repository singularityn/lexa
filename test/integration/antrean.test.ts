/**
 * Konsumer antrean: pesan indeks vektor, ringkasan, dan ekstraksi PDF; pesan sisa alur sumber lama (`peraturan`, `tik`)
 * dibuang tanpa dikerjakan; pesan di luar cakupan di-ack tanpa menyentuh AI atau Vectorize.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buatLingkungan, jalankanAntrean, satu, sisipkan, sqliteAda, type Lingkungan } from "./harness";
import type { PesanIngest } from "../../src/worker/lib/ingest";

const UU13 = "/akn/id/act/uu/2003/13";

describe.skipIf(!sqliteAda)("konsumer antrean", () => {
  let l: Lingkungan;

  beforeEach(() => {
    l = buatLingkungan();
  });
  afterEach(() => l.tutup());

  const pesan = (tipe: string, uri: string) =>
    (tipe === "ekstrak_pdf" ? { tipe, frbr_uri: uri, r2_key: "pdf/x.pdf" } : { tipe, frbr_uri: uri }) as PesanIngest;
  const seksiAman = async () => ({
    ai: l.ai.panggilan.length,
    vektor: l.vektor.simpan.size,
    r2: l.r2.objek.size,
    laws: (await satu<{ n: number }>(l, `SELECT COUNT(*) AS n FROM laws`))?.n,
    log: (await satu<{ n: number }>(l, `SELECT COUNT(*) AS n FROM sync_log`))?.n,
  });

  describe("pesan sisa alur sumber lama", () => {
    it("`peraturan` dan `tik` dibuang tanpa menyentuh AI, Vectorize, R2, D1, maupun antrean (untuk jenis apa pun), dan tak mengisi log", async () => {
      const lama = [
        ...[UU13, "/akn/id/act/perpres/2020/1", "/akn/id/act/peraturan-ojk/2019/1-pojk-04-2019"].map(
          (u) => ({ tipe: "peraturan", frbr_uri: u, alasan: "baru", jenis: "UU" }) as unknown as PesanIngest,
        ),
        { tipe: "tik", g: 123 } as unknown as PesanIngest,
        { tipe: "tik" } as unknown as PesanIngest,
      ];
      expect(await jalankanAntrean(l, lama)).toEqual({ diakui: 5, diulang: [] });
      expect(await seksiAman()).toEqual({ ai: 0, vektor: 0, r2: 0, laws: 0, log: 0 });
      expect(l.antrean.pesan).toEqual([]);
      expect(l.antrean.dikirim).toEqual([]); // rantai tik tidak lagi disambung
    });

    it("pesan tanpa badan yang bisa dibaca (null, bukan objek, jenis ngawur) juga dibuang, bukan di-retry", async () => {
      const aneh = [null, "teks", 42, {}, { tipe: 7 }, { tipe: "ngawur", frbr_uri: UU13 }] as unknown as PesanIngest[];
      expect(await jalankanAntrean(l, aneh)).toEqual({ diakui: aneh.length, diulang: [] });
      expect(await seksiAman()).toEqual({ ai: 0, vektor: 0, r2: 0, laws: 0, log: 0 });
    });
  });

  describe("pesan yang masih dikerjakan", () => {
    it("pesan indeks, ringkasan, dan ekstraksi untuk peraturan yang jelas di luar cakupan di-ack tanpa menyentuh AI atau Vectorize", async () => {
      const semua = ["indeks_vektor", "ringkas", "ekstrak_pdf"].flatMap((t) =>
        ["/akn/id/act/perpres/2020/1", "/akn/id/act/permen/2024/5", "/akn/id/act/keppres/2000/1"].map((u) => pesan(t, u)),
      );
      expect(await jalankanAntrean(l, semua)).toEqual({ diakui: semua.length, diulang: [] });
      expect(l.ai.panggilan).toEqual([]);
      expect(l.vektor.simpan.size).toBe(0);
      expect(l.r2.objek.size).toBe(0);
    });

    it("pesan untuk baris D1 di luar cakupan (segmen URI tak baku, mis. POJK) tidak memanggil AI atau Vectorize", async () => {
      const uri = "/akn/id/act/peraturan-ojk/2019/1-pojk-04-2019";
      await sisipkan(l, [{ uri, jenis: "POJK", nomor: "1-pojk-04-2019", tahun: 2019, judul: "Pesangon Pegawai", pasal: [{ nomor: "1", isi: "Pegawai berhak atas uang pesangon." }] }]);
      await l.r2.put("pdf/x.pdf", new TextEncoder().encode("%PDF-1.4 uji"));
      expect(await jalankanAntrean(l, ["indeks_vektor", "ringkas", "ekstrak_pdf"].map((t) => pesan(t, uri)))).toEqual({ diakui: 3, diulang: [] });
      expect(l.ai.panggilan).toEqual([]);
      expect(l.vektor.simpan.size).toBe(0);
      expect(await satu(l, `SELECT indexed_at, ringkasan FROM laws WHERE frbr_uri = ?`, uri)).toEqual({ indexed_at: null, ringkasan: null });
    });

    it("pesan dalam cakupan tetap diproses: pengindeksan vektor sebuah peraturan", async () => {
      await sisipkan(l, [{ uri: UU13, jenis: "UU", nomor: "13", tahun: 2003, judul: "Ketenagakerjaan", pasal: [{ nomor: "156", isi: "Pengusaha wajib membayar uang pesangon." }] }]);
      expect(await jalankanAntrean(l, [pesan("indeks_vektor", UU13)])).toEqual({ diakui: 1, diulang: [] });
      expect(l.vektor.simpan.has(`${UU13}#pasal-156`)).toBe(true);
    });

    it("galat pengolahan (AI mati): hanya pesan itu yang di-retry dengan backoff bawaan, yang sehat tetap diproses", async () => {
      await sisipkan(l, [{ uri: UU13, jenis: "UU", nomor: "13", tahun: 2003, judul: "Ketenagakerjaan", pasal: [{ nomor: "1", isi: "Isi." }] }]);
      l.ai.galat = new Error("AI sedang gangguan");
      const hasil = await jalankanAntrean(l, [pesan("indeks_vektor", UU13), pesan("indeks_vektor", "/akn/id/act/perpres/2020/1")]);
      expect(hasil).toEqual({ diakui: 1, diulang: [{ penundaanDetik: undefined }] });
    });
  });
});
