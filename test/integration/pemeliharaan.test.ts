/** Pemeliharaan harian: percobaan ulang yang jarang, dan pemangkasan catatan lama. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buatLingkungan, CRON_HARIAN, jalankanCron, konteksIngestUji, sqliteAda, type Lingkungan } from "./harness";
import { baris, hitungBaris, satu, sisipkanAntre } from "./tik-bantu";
import { hitungGiliran } from "../../src/worker/lib/isi";
import { jalankanPemeliharaan } from "../../src/worker/lib/pemeliharaan";

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
      status: "sukses", detail: "diantrekan ulang: 0 kosong, 0 gagal; log dipangkas 1",
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
