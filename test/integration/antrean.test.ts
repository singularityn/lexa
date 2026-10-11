/**
 * Konsumer antrean: pesan yang tak menyentuh pasal.id (indeks vektor, ringkasan, ekstraksi PDF), pesan lama dari alur
 * sebelum katalog (dibuang), dan rantai tik cadangan bila Cron per menit tak berjalan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buatLingkungan, CRON_HARIAN, jalankanAntrean, jalankanCron, panggil, sisipkan, sqliteAda, type Lingkungan } from "./harness";
import { detailPeraturan, pasangPasalPalsu, type PasalPalsu } from "./pasal-palsu";
import { baris, satu, sisipkanAntre, tanamKatalogSelesai, tanamSemuaDiagnosa } from "./tik-bantu";
import { PasalClient } from "../../src/worker/lib/pasal";
import type { PesanIngest } from "../../src/worker/lib/ingest";
import { cronMenitSehat, generasiSah, sambungTik, semaiTik } from "../../src/worker/lib/cadangan";
import { catatDenyut } from "../../src/worker/lib/keadaan";
import { CRON_MENIT } from "../../src/worker/lib/jadwal";

const UU13 = "/akn/id/act/uu/2003/13";

describe.skipIf(!sqliteAda)("konsumer antrean", () => {
  let l: Lingkungan;
  let pasal: PasalPalsu;

  beforeEach(() => {
    l = buatLingkungan();
    (PasalClient as unknown as { bentukDetail: string | null }).bentukDetail = null;
    pasal = pasangPasalPalsu({});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    l.tutup();
  });

  describe("pesan yang tak menyentuh pasal.id", () => {
    const luar = (tipe: string, uri: string) =>
      (tipe === "ekstrak_pdf" ? { tipe, frbr_uri: uri, r2_key: "pdf/x.pdf" } : { tipe, frbr_uri: uri }) as PesanIngest;

    it("pesan `peraturan` dari alur lama dibuang tanpa menyentuh pasal.id, AI, Vectorize, R2, maupun D1 (untuk jenis apa pun)", async () => {
      const pesan = [UU13, "/akn/id/act/perpres/2020/1", "/akn/id/act/peraturan-ojk/2019/1-pojk-04-2019"].map(
        (u) => ({ tipe: "peraturan", frbr_uri: u, alasan: "baru", jenis: "UU" }) as PesanIngest,
      );
      expect(await jalankanAntrean(l, pesan)).toEqual({ diakui: 3, diulang: [] });
      expect(pasal.panggilan).toEqual([]);
      expect(l.ai.panggilan).toEqual([]);
      expect(l.vektor.simpan.size).toBe(0);
      expect(l.r2.objek.size).toBe(0);
      expect(l.antrean.pesan).toEqual([]);
      expect((await satu<{ n: number }>(l, `SELECT COUNT(*) AS n FROM laws`))?.n).toBe(0);
      expect((await satu<{ n: number }>(l, `SELECT COUNT(*) AS n FROM sync_log`))?.n).toBe(0); // tak memenuhi log dengan "dilewati"
    });

    it("pesan indeks, ringkasan, dan ekstraksi untuk peraturan yang jelas di luar cakupan di-ack tanpa menyentuh AI atau Vectorize", async () => {
      const pesan = ["indeks_vektor", "ringkas", "ekstrak_pdf"].flatMap((t) =>
        ["/akn/id/act/perpres/2020/1", "/akn/id/act/permen/2024/5", "/akn/id/act/keppres/2000/1"].map((u) => luar(t, u)),
      );
      expect(await jalankanAntrean(l, pesan)).toEqual({ diakui: pesan.length, diulang: [] });
      expect(l.ai.panggilan).toEqual([]);
      expect(l.vektor.simpan.size).toBe(0);
      expect(l.r2.objek.size).toBe(0);
    });

    it("pesan untuk baris D1 di luar cakupan (segmen URI tak baku, mis. POJK) tidak memanggil AI atau Vectorize", async () => {
      const uri = "/akn/id/act/peraturan-ojk/2019/1-pojk-04-2019";
      await sisipkan(l, [{ uri, jenis: "POJK", nomor: "1-pojk-04-2019", tahun: 2019, judul: "Pesangon Pegawai", pasal: [{ nomor: "1", isi: "Pegawai berhak atas uang pesangon." }] }]);
      await l.r2.put("pdf/x.pdf", new TextEncoder().encode("%PDF-1.4 uji"));
      expect(await jalankanAntrean(l, ["indeks_vektor", "ringkas", "ekstrak_pdf"].map((t) => luar(t, uri)))).toEqual({ diakui: 3, diulang: [] });
      expect(l.ai.panggilan).toEqual([]);
      expect(l.vektor.simpan.size).toBe(0);
      expect(await satu(l, `SELECT indexed_at, ringkasan FROM laws WHERE frbr_uri = ?`, uri)).toEqual({ indexed_at: null, ringkasan: null });
    });

    it("pesan dalam cakupan tetap diproses: pengindeksan vektor sebuah peraturan", async () => {
      await sisipkan(l, [{ uri: UU13, jenis: "UU", nomor: "13", tahun: 2003, judul: "Ketenagakerjaan", pasal: [{ nomor: "156", isi: "Pengusaha wajib membayar uang pesangon." }] }]);
      expect(await jalankanAntrean(l, [luar("indeks_vektor", UU13)])).toEqual({ diakui: 1, diulang: [] });
      expect(l.vektor.simpan.has(`${UU13}#pasal-156`)).toBe(true);
    });

    it("galat pengolahan (AI mati): hanya pesan itu yang di-retry dengan backoff bawaan, yang sehat tetap diproses", async () => {
      await sisipkan(l, [{ uri: UU13, jenis: "UU", nomor: "13", tahun: 2003, judul: "Ketenagakerjaan", pasal: [{ nomor: "1", isi: "Isi." }] }]);
      l.ai.galat = new Error("AI sedang gangguan");
      const hasil = await jalankanAntrean(l, [luar("indeks_vektor", UU13), luar("indeks_vektor", "/akn/id/act/perpres/2020/1")]);
      expect(hasil).toEqual({ diakui: 1, diulang: [{ penundaanDetik: undefined }] });
    });
  });

  describe("rantai tik cadangan", () => {
    /** Lingkungan dengan cadangan aktif dan satu peraturan yang menunggu diambil; katalog dianggap selesai. */
    async function siapkan(opsi: { kerja: boolean } = { kerja: true }) {
      (l.env as { TIK_CADANGAN?: string }).TIK_CADANGAN = "antrean";
      await tanamSemuaDiagnosa(l);
      await tanamKatalogSelesai(l, Date.now());
      if (opsi.kerja) {
        await sisipkanAntre(l, [{ uri: UU13, jenis: "UU", tahun: 2003, verifikasi: true }]);
        pasal = pasangPasalPalsu({ detail: { [UU13]: detailPeraturan("UU", 2003, 13, "Ketenagakerjaan", 3) } });
      }
    }
    const tik = (g?: number) => ({ tipe: "tik", ...(g === undefined ? {} : { g }) }) as PesanIngest;
    const kunci = async (k: string) => (await satu<{ value: string }>(l, `SELECT value FROM sync_state WHERE key = ?`, k))?.value;
    const kirimanTik = () => l.antrean.dikirim.filter((d) => (d.badan as { tipe?: string }).tipe === "tik");

    it("tanpa vars.TIK_CADANGAN tidak ada yang disemai: pemicu harian dan permintaan HTTP tidak mengirim pesan tik", async () => {
      await jalankanCron(l, CRON_HARIAN);
      await panggil(l, "/api/stats");
      expect(kirimanTik()).toEqual([]);
    });

    it("pemicu harian menyemai satu pesan tik bila Cron per menit tak sehat, dan tak menyemai lagi selama pesannya beredar", async () => {
      await siapkan();
      await jalankanCron(l, CRON_HARIAN);
      expect(kirimanTik()).toEqual([{ badan: { tipe: "tik", g: expect.any(Number) }, opsi: { delaySeconds: 5 } }]);
      expect(await kunci("tik_generasi")).toBe(String((kirimanTik()[0].badan as { g: number }).g));

      await jalankanCron(l, CRON_HARIAN);
      expect(kirimanTik()).toHaveLength(1);
    });

    it("tidak menyemai bila Cron per menit sehat (denyutnya baru)", async () => {
      await siapkan();
      await catatDenyut(l.env.DB, CRON_MENIT, Date.now());
      expect(await cronMenitSehat(l.env.DB)).toBe(true);
      expect(await semaiTik(l.env.DB, l.env.INGEST_QUEUE)).toBe(false);
      expect(kirimanTik()).toEqual([]);
    });

    it("permintaan HTTP menyemai (sekali semenit per isolat)", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
      await siapkan({ kerja: false });
      await panggil(l, "/api/stats");
      expect(kirimanTik()).toHaveLength(1);

      // Dalam semenit yang sama tidak ada yang dicoba lagi, bahkan bila pesannya dianggap hilang.
      await l.db.prepare(`UPDATE sync_state SET value = '' WHERE key = 'tik_antre_sampai'`).run();
      vi.setSystemTime(new Date("2026-10-11T12:00:30Z"));
      await panggil(l, "/api/stats");
      expect(kirimanTik()).toHaveLength(1);

      vi.setSystemTime(new Date("2026-10-11T12:01:30Z"));
      await panggil(l, "/api/stats");
      expect(kirimanTik()).toHaveLength(2);
    });

    it("konsumer menjalankan satu tik dan menyambung rantai dalam semenit bila ada kerja", async () => {
      await siapkan();
      await semaiTik(l.env.DB, l.env.INGEST_QUEUE);
      const pertama = kirimanTik()[0].badan as { g: number };
      l.antrean.dikirim.length = 0;
      l.antrean.pesan.length = 0;

      expect(await jalankanAntrean(l, [tik(pertama.g)])).toEqual({ diakui: 1, diulang: [] });
      expect(await satu(l, `SELECT isi_status, jumlah_pasal FROM laws`)).toEqual({ isi_status: "lengkap", jumlah_pasal: 4 }); // tiknya bekerja
      const sambungan = kirimanTik();
      expect(sambungan).toHaveLength(1);
      expect(sambungan[0].opsi).toEqual({ delaySeconds: 60 });
      expect((sambungan[0].badan as { g: number }).g).toBeGreaterThan(pertama.g);
      expect(await kunci("denyut:antrean")).toEqual(expect.any(String));
      expect(await generasiSah(l.env.DB, (sambungan[0].badan as { g: number }).g)).toBe(true);
      expect(await generasiSah(l.env.DB, pertama.g)).toBe(false);
    });

    it("tik yang sepi menyambung dengan jarak lima menit", async () => {
      await siapkan({ kerja: false });
      await semaiTik(l.env.DB, l.env.INGEST_QUEUE);
      const g = (kirimanTik()[0].badan as { g: number }).g;
      l.antrean.dikirim.length = 0;
      await jalankanAntrean(l, [tik(g)]);
      expect(kirimanTik()[0].opsi).toEqual({ delaySeconds: 300 });
    });

    it("pesan basi (generasi lama) dan pesan ganda dalam satu batch dibuang tanpa tik dan tanpa menyambung", async () => {
      await siapkan();
      await semaiTik(l.env.DB, l.env.INGEST_QUEUE);
      const g = (kirimanTik()[0].badan as { g: number }).g;
      l.antrean.dikirim.length = 0;

      expect(await jalankanAntrean(l, [tik(g - 12345)])).toEqual({ diakui: 1, diulang: [] }); // basi
      expect(kirimanTik()).toEqual([]);
      expect(pasal.panggilan).toEqual([]);

      expect(await jalankanAntrean(l, [tik(g), tik(g)])).toEqual({ diakui: 2, diulang: [] }); // ganda
      expect(kirimanTik()).toHaveLength(1); // satu sambungan, bukan dua
    });

    it("dua konsumer yang mengerjakan generasi yang sama serentak hanya menghasilkan satu sambungan (tukar-dan-bandingkan)", async () => {
      await siapkan({ kerja: false });
      await semaiTik(l.env.DB, l.env.INGEST_QUEUE);
      const g = (kirimanTik()[0].badan as { g: number }).g;
      l.antrean.dikirim.length = 0;

      await Promise.all([jalankanAntrean(l, [tik(g)]), jalankanAntrean(l, [tik(g)])]);
      expect(kirimanTik()).toHaveLength(1);
    });

    it("rantai berhenti sendiri begitu Cron per menit terlihat sehat", async () => {
      await siapkan();
      await semaiTik(l.env.DB, l.env.INGEST_QUEUE);
      const g = (kirimanTik()[0].badan as { g: number }).g;
      l.antrean.dikirim.length = 0;
      await catatDenyut(l.env.DB, CRON_MENIT, Date.now());

      await jalankanAntrean(l, [tik(g)]);
      expect(kirimanTik()).toEqual([]);
      expect(await kunci("tik_antre_sampai")).toBe("");
    });

    it("gagal menjalankan tik: pesan di-retry sesudah semenit, dan rantai tidak bercabang", async () => {
      await siapkan();
      const asli = l.env.DB.prepare.bind(l.env.DB);
      // Galat D1 pada pembacaan antrean isi menggagalkan tik di tengah jalan.
      (l.env.DB as { prepare: unknown }).prepare = (sql: string) => {
        if (/FROM laws WHERE isi_status = 'menunggu'/.test(sql)) throw new Error("D1 sedang gangguan");
        return asli(sql);
      };
      const hasil = await jalankanAntrean(l, [tik()]);
      expect(hasil).toEqual({ diakui: 0, diulang: [{ penundaanDetik: 60 }] });
      expect(kirimanTik()).toEqual([]);
    });

    it("sambungTik tanpa generasi (pesan dikirim tangan) memulai generasi baru dan menyambung", async () => {
      await siapkan({ kerja: false });
      expect(await sambungTik(l.env.DB, l.env.INGEST_QUEUE, undefined, true, 1_000_000)).toBe(true);
      expect(kirimanTik()).toEqual([{ badan: { tipe: "tik", g: 1_000_000 }, opsi: { delaySeconds: 60 } }]);
      expect(await kunci("tik_generasi")).toBe("1000000");
    });
  });
});
