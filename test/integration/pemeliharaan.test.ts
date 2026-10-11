/** Pemeliharaan harian: percobaan ulang yang jarang, dan pemangkasan catatan lama. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buatLingkungan, CRON_HARIAN, jalankanCron, konteksIngestUji, sqliteAda, type Lingkungan } from "./harness";
import { baris, hitungBaris, satu, sisipkanAntre } from "./tik-bantu";
import { hitungGiliran } from "../../src/worker/lib/isi";
import { CELAH_PER_HARI, jalankanPemeliharaan } from "../../src/worker/lib/pemeliharaan";

describe.skipIf(!sqliteAda)("pemeliharaan harian", () => {
  let l: Lingkungan;
  beforeEach(() => {
    l = buatLingkungan();
  });
  afterEach(() => l.tutup());

  const dicobaPada = (uri: string, selang: string) =>
    l.db.prepare(`UPDATE laws SET isi_dicoba_at = datetime('now', ?) WHERE frbr_uri = ?`).bind(selang, uri).run();

  it("peraturan 'kosong' dicoba lagi sesudah 30 hari dan 'gagal' sesudah 3 hari, dengan giliran dan percobaan diulang dari awal", async () => {
    await sisipkanAntre(l, [
      { uri: "/akn/id/act/pp/1960/1", jenis: "PP", tahun: 1960, status: "kosong", verifikasi: false, percobaan: 2 },
      { uri: "/akn/id/act/pp/1960/2", jenis: "PP", tahun: 1960, status: "kosong", verifikasi: false },
      { uri: "/akn/id/act/uu/1990/1", jenis: "UU", tahun: 1990, status: "gagal", verifikasi: true, percobaan: 5, giliran: 9_000_000_000 },
      { uri: "/akn/id/act/uu/1990/2", jenis: "UU", tahun: 1990, status: "gagal", verifikasi: true, percobaan: 5 },
      { uri: "/akn/id/act/uu/2000/1", jenis: "UU", tahun: 2000, status: "lengkap", jumlahPasal: 3 },
    ]);
    await dicobaPada("/akn/id/act/pp/1960/1", "-31 days");
    await dicobaPada("/akn/id/act/pp/1960/2", "-29 days");
    await dicobaPada("/akn/id/act/uu/1990/1", "-4 days");
    await dicobaPada("/akn/id/act/uu/1990/2", "-2 days");
    await dicobaPada("/akn/id/act/uu/2000/1", "-400 days");

    const laporan = await jalankanPemeliharaan(konteksIngestUji(l));
    expect(laporan).toMatchObject({ kosongDiulang: 1, gagalDiulang: 1 });
    expect(await baris(l, `SELECT frbr_uri, isi_status, isi_percobaan, isi_giliran FROM laws ORDER BY frbr_uri`)).toEqual([
      { frbr_uri: "/akn/id/act/pp/1960/1", isi_status: "menunggu", isi_percobaan: 0, isi_giliran: hitungGiliran("PP", 1960, false) },
      { frbr_uri: "/akn/id/act/pp/1960/2", isi_status: "kosong", isi_percobaan: 0, isi_giliran: hitungGiliran("PP", 1960, false) },
      { frbr_uri: "/akn/id/act/uu/1990/1", isi_status: "menunggu", isi_percobaan: 0, isi_giliran: hitungGiliran("UU", 1990, true) },
      { frbr_uri: "/akn/id/act/uu/1990/2", isi_status: "gagal", isi_percobaan: 5, isi_giliran: hitungGiliran("UU", 1990, true) },
      { frbr_uri: "/akn/id/act/uu/2000/1", isi_status: "lengkap", isi_percobaan: 0, isi_giliran: hitungGiliran("UU", 2000, null) },
    ]);
  });

  it("peraturan di luar cakupan tidak diantrekan lagi", async () => {
    await sisipkanAntre(l, [{ uri: "/akn/id/act/perpres/2020/1", jenis: "PERPRES", tahun: 2020, status: "kosong" }]);
    await dicobaPada("/akn/id/act/perpres/2020/1", "-60 days");
    expect(await jalankanPemeliharaan(konteksIngestUji(l))).toMatchObject({ kosongDiulang: 0 });
    expect(await satu(l, `SELECT isi_status FROM laws`)).toEqual({ isi_status: "kosong" });
  });

  it("memangkas sync_log lebih tua dari 90 hari dan statistik harian lebih tua dari 14 hari, dan mencatat dirinya", async () => {
    await l.db.prepare(`INSERT INTO sync_log (job, status, detail, jumlah, created_at) VALUES ('x','sukses','lama',0, datetime('now','-91 days')), ('x','sukses','baru',0, datetime('now','-89 days'))`).run();
    const hari = (selisih: number) => new Date(Date.now() - selisih * 86_400_000).toISOString().slice(0, 10);
    await l.db.prepare(`INSERT INTO sync_state (key, value) VALUES (?, '{}'), (?, '{}'), (?, '{}'), ('katalog_selesai:UU', 'x')`)
      .bind(`statistik:${hari(20)}`, `statistik:${hari(13)}`, `statistik:${hari(0)}`).run();

    const laporan = await jalankanPemeliharaan(konteksIngestUji(l));
    expect(laporan.logDipangkas).toBe(1);
    expect((await baris<{ detail: string }>(l, `SELECT detail FROM sync_log WHERE job = 'x'`)).map((r) => r.detail)).toEqual(["baru"]);
    expect((await baris<{ key: string }>(l, `SELECT key FROM sync_state ORDER BY key`)).map((r) => r.key)).toEqual([
      "katalog_selesai:UU", `statistik:${hari(13)}`, `statistik:${hari(0)}`,
    ]);
    expect(await satu(l, `SELECT status, detail FROM sync_log WHERE job = 'pemeliharaan'`)).toEqual({
      status: "sukses", detail: "diantrekan ulang: 0 kosong, 0 gagal, 0 bercelah; log dipangkas 1",
    });
  });

  describe("peraturan 'lengkap' yang nomor pasalnya bercelah", () => {
    /** Peraturan 'lengkap' dengan baris pasal bernomor tertentu. */
    const tanam = async (uri: string, nomor: Array<number | string>, ekstra: { judul?: string; jenis?: string; arsip?: boolean; dicoba?: string } = {}) => {
      await sisipkanAntre(l, [{ uri, jenis: ekstra.jenis ?? "UU", tahun: 2000, judul: ekstra.judul, status: "lengkap", jumlahPasal: nomor.length, arsip: ekstra.arsip }]);
      for (const n of nomor) {
        await l.db.prepare(`INSERT INTO articles (id, frbr_uri, nomor_pasal, isi, urutan) VALUES (?,?,?,?,?)`).bind(`${uri}#pasal-${n}`, uri, String(n), `Isi ${n}.`, Number(n) || 0).run();
      }
      if (ekstra.dicoba) await l.db.prepare(`UPDATE laws SET isi_dicoba_at = datetime('now', ?) WHERE frbr_uri = ?`).bind(ekstra.dicoba, uri).run();
    };
    const status = (uri: string) => satu(l, `SELECT isi_status, isi_giliran, isi_arsip, isi_percobaan, jumlah_pasal FROM laws WHERE frbr_uri = ?`, uri);

    it("yang bercelah diantrekan, terparah paling depan, dan teksnya tetap ada; yang utuh atau bercelah kecil tidak", async () => {
      await tanam("/akn/id/act/uu/2000/1", [1, 2, 3, 4, 5, 50]); // hilang 44
      await tanam("/akn/id/act/uu/2000/2", [1, 2, 10]); // hilang 7
      await tanam("/akn/id/act/uu/2000/3", [1, 2, 3]); // utuh
      await tanam("/akn/id/act/uu/2000/4", [1, 3]); // hilang 1: wajar
      await tanam("/akn/id/act/uu/2000/5", ["I", "II"]); // nomor Romawi tak dihitung

      const laporan = await jalankanPemeliharaan(konteksIngestUji(l));
      expect(laporan.celahDiantrekan).toBe(2);
      expect(await status("/akn/id/act/uu/2000/1")).toEqual({ isi_status: "menunggu", isi_giliran: 1_000_000, isi_arsip: 0, isi_percobaan: 0, jumlah_pasal: 6 });
      expect(await status("/akn/id/act/uu/2000/2")).toEqual({ isi_status: "menunggu", isi_giliran: 1_000_001, isi_arsip: 0, isi_percobaan: 0, jumlah_pasal: 3 });
      for (const n of [3, 4, 5]) expect(await satu(l, `SELECT isi_status FROM laws WHERE frbr_uri = ?`, `/akn/id/act/uu/2000/${n}`)).toEqual({ isi_status: "lengkap" });
      expect(await hitungBaris(l, "articles")).toBe(6 + 3 + 3 + 2 + 2); // pasalnya tidak disentuh
      expect(await satu(l, `SELECT status, detail, jumlah FROM sync_log WHERE job = 'pemeliharaan'`)).toEqual({
        status: "sukses", detail: expect.stringContaining("2 bercelah"), jumlah: 2,
      });
    });

    it("tidak diantrekan: sudah diambil pipeline ini (arsip), peraturan perubahan, di luar cakupan, baru dicoba; yang dicobanya sudah lama diantrekan", async () => {
      const celah = [1, 2, 3, 40];
      await tanam("/akn/id/act/uu/2000/10", celah, { arsip: true });
      await tanam("/akn/id/act/uu/2000/11", celah, { judul: "Undang-Undang Nomor 11 Tahun 2000 tentang Perubahan Atas Undang-Undang Nomor 5 Tahun 1990" });
      await tanam("/akn/id/act/perpres/2000/12", celah, { jenis: "PERPRES" });
      await tanam("/akn/id/act/uu/2000/13", celah, { dicoba: "-3 days" });
      await tanam("/akn/id/act/uu/2000/14", celah, { dicoba: "-20 days" });
      expect((await jalankanPemeliharaan(konteksIngestUji(l))).celahDiantrekan).toBe(1);
      expect((await satu<{ isi_status: string }>(l, `SELECT isi_status FROM laws WHERE frbr_uri = ?`, "/akn/id/act/uu/2000/14"))?.isi_status).toBe("menunggu");
      for (const n of [10, 11, 13]) expect((await satu<{ isi_status: string }>(l, `SELECT isi_status FROM laws WHERE frbr_uri = ?`, `/akn/id/act/uu/2000/${n}`))?.isi_status).toBe("lengkap");
      expect((await satu<{ isi_status: string }>(l, `SELECT isi_status FROM laws WHERE frbr_uri = ?`, "/akn/id/act/perpres/2000/12"))?.isi_status).toBe("lengkap");
    });

    it(`paling banyak ${CELAH_PER_HARI} sehari, yang terparah dulu`, async () => {
      for (let i = 0; i < CELAH_PER_HARI + 10; i++) await tanam(`/akn/id/act/uu/2001/${i + 1}`, [1, 2, 100 + i]); // celah makin parah menurut i
      expect((await jalankanPemeliharaan(konteksIngestUji(l))).celahDiantrekan).toBe(CELAH_PER_HARI);
      expect((await satu<{ isi_status: string }>(l, `SELECT isi_status FROM laws WHERE frbr_uri = ?`, `/akn/id/act/uu/2001/${CELAH_PER_HARI + 10}`))?.isi_status).toBe("menunggu");
      expect((await satu<{ isi_status: string }>(l, `SELECT isi_status FROM laws WHERE frbr_uri = ?`, "/akn/id/act/uu/2001/1"))?.isi_status).toBe("lengkap");
      expect(await hitungBaris(l, "laws", "isi_status = 'menunggu'")).toBe(CELAH_PER_HARI);
    });

    it("tidak diantrekan selama akses isi pasal.id dibatasi: peraturannya cuma menumpuk di antrean", async () => {
      await tanam("/akn/id/act/uu/2000/20", [1, 2, 3, 40]);
      await l.db.prepare(`INSERT INTO sync_state (key, value) VALUES ('akses_isi', ?)`).bind(JSON.stringify({ sejak: "2026-10-11T00:00:00.000Z", periksa_lagi: "2026-10-11T01:00:00.000Z", catatan: "x" })).run();
      expect((await jalankanPemeliharaan(konteksIngestUji(l))).celahDiantrekan).toBe(0);
      expect((await satu<{ isi_status: string }>(l, `SELECT isi_status FROM laws WHERE frbr_uri = ?`, "/akn/id/act/uu/2000/20"))?.isi_status).toBe("lengkap");
    });
  });

  it("dijalankan oleh pemicu Cron harian di Worker", async () => {
    await sisipkanAntre(l, [{ uri: "/akn/id/act/pp/1960/1", jenis: "PP", tahun: 1960, status: "kosong" }]);
    await dicobaPada("/akn/id/act/pp/1960/1", "-40 days");
    await jalankanCron(l, CRON_HARIAN);
    expect(await satu(l, `SELECT isi_status FROM laws`)).toEqual({ isi_status: "menunggu" });
    expect(await hitungBaris(l, "sync_log", "job = 'pemeliharaan'")).toBe(1);
  });
});
