/**
 * Uraian ulang otomatis (lib/uraianUlang.ts): Cron 15 menit mengantrekan peraturan yang terakhir diurai dengan versi pengurai lama,
 * paling banyak URAIAN_ULANG_BATAS per putaran menurut urutan alamat, lalu antrean menguraikan arsip teksnya (mode `dari_teks`).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VERSI_PARSER } from "../../src/worker/lib/bpk";
import { BATAS_URAIAN_BAWAAN, bacaBatasUraian, JEDA_SIKLUS_MS, jalankanUraianUlang, KUNCI_KURSOR_URAIAN } from "../../src/worker/lib/uraianUlang";
import { baris, buatLingkungan, CRON_GEMINI, jalankanCron, kurasSemua, satu, sisipkan, sqliteAda, type Lingkungan } from "./harness";

const P = (n: number) => `\n\n\n\n### Page ${n}\n`;
const NASKAH = `Pasal 1\nIsi satu yang cukup panjang untuk diuji.${P(2)}Pasal 2\nIsi dua yang cukup panjang untuk diuji.`;

const PERATURAN = [
  { uri: "/akn/id/act/pp/2020/1", jenis: "PP", nomor: "1", tahun: 2020 },
  { uri: "/akn/id/act/pp/2020/2", jenis: "PP", nomor: "2", tahun: 2020 },
  { uri: "/akn/id/act/pp/2020/3", jenis: "PP", nomor: "3", tahun: 2020 },
  { uri: "/akn/id/act/uu/2020/4", jenis: "UU", nomor: "4", tahun: 2020 },
  { uri: "/akn/id/act/uu/2020/5", jenis: "UU", nomor: "5", tahun: 2020 },
];

describe("bacaBatasUraian", () => {
  it("bawaan 20; dijepit ke 1-100; yang bukan angka memakai bawaan", () => {
    expect(bacaBatasUraian(undefined)).toBe(BATAS_URAIAN_BAWAAN);
    expect(bacaBatasUraian("abc")).toBe(20);
    expect(bacaBatasUraian("7")).toBe(7);
    expect(bacaBatasUraian("0")).toBe(1);
    expect(bacaBatasUraian("-5")).toBe(1);
    expect(bacaBatasUraian("500")).toBe(100);
  });
});

describe.skipIf(!sqliteAda)("uraian ulang otomatis (Cron)", () => {
  let l: Lingkungan;
  const kunciPdf = (uri: string) => `pdf/${uri.replace(/^\//, "")}.pdf`;
  const kunciTeks = (uri: string) => `teks/${uri.replace(/^\//, "")}.md`;

  /** Peraturan ber-PDF dan berarsip teks, dengan baris log berversi pengurai `versi` (usang bila di bawah VERSI_PARSER). */
  async function tanam(p: { uri: string; jenis: string; nomor: string; tahun: number }, o: { versi?: number; vonis?: string; pdf?: boolean; arsip?: boolean } = {}) {
    await sisipkan(l, [{ uri: p.uri, jenis: p.jenis, nomor: p.nomor, tahun: p.tahun, judul: `Peraturan ${p.nomor}/${p.tahun}` }]);
    if (o.pdf !== false) {
      await l.db.prepare(`UPDATE laws SET r2_pdf_key = ? WHERE frbr_uri = ?`).bind(kunciPdf(p.uri), p.uri).run();
      l.r2.objek.set(kunciPdf(p.uri), { bytes: new TextEncoder().encode("%PDF-1.4 palsu") });
    }
    if (o.arsip !== false) await l.r2.put(kunciTeks(p.uri), NASKAH);
    await l.db.prepare(`INSERT INTO ekstraksi_log (frbr_uri, vonis, versi_parser) VALUES (?,?,?)`).bind(p.uri, o.vonis ?? "bersih", o.versi ?? 0).run();
  }

  beforeEach(async () => {
    l = buatLingkungan();
    l.ai.jawaban = "Ringkasan AI.";
  });
  afterEach(() => l.tutup());

  const keluar = () => l.antrean.kuras() as Array<{ tipe: string; frbr_uri: string; dari_teks?: boolean }>;
  const uriKeluar = () => keluar().map((m) => m.frbr_uri);

  it("tak ada yang usang: tak ada pesan, tak ada tulisan ke D1, dan tak ada operasi KV sama sekali (keadaan tetap yang berulang tiap 15 menit)", async () => {
    for (const p of PERATURAN) await tanam(p, { versi: VERSI_PARSER });
    const sebelum = (await satu<{ n: number }>(l, `SELECT COUNT(*) AS n FROM sync_log`))?.n;
    const operasiKv: string[] = [];
    for (const nama of ["put", "delete"] as const) {
      const asli = l.kv[nama].bind(l.kv) as (...a: unknown[]) => Promise<unknown>;
      (l.kv as unknown as Record<string, unknown>)[nama] = (...a: unknown[]) => (operasiKv.push(nama), asli(...a));
    }
    const h = await jalankanUraianUlang(l.env);
    expect(h).toEqual({ dikerjakan: false, alasan: "tidak ada yang usang" });
    expect(keluar()).toEqual([]);
    expect(operasiKv).toEqual([]);
    expect(l.kv.isi.size).toBe(0);
    expect((await satu<{ n: number }>(l, `SELECT COUNT(*) AS n FROM sync_log`))?.n).toBe(sebelum);
  });

  it("urutannya menurut alamat, bukan urutan masuk ke D1", async () => {
    for (const p of [...PERATURAN].reverse()) await tanam(p);
    l.env.URAIAN_ULANG_BATAS = "3";
    const h = await jalankanUraianUlang(l.env);
    expect(h).toMatchObject({ dikerjakan: true, diantrekan: ["/akn/id/act/pp/2020/1", "/akn/id/act/pp/2020/2", "/akn/id/act/pp/2020/3"] });
  });

  it("mengantrekan yang usang menurut urutan alamat, paling banyak URAIAN_ULANG_BATAS per putaran; kursor maju tiap putaran", async () => {
    for (const p of PERATURAN) await tanam(p);
    l.env.URAIAN_ULANG_BATAS = "2";

    const h1 = await jalankanUraianUlang(l.env, 1_000);
    expect(h1).toMatchObject({ dikerjakan: true, diantrekan: ["/akn/id/act/pp/2020/1", "/akn/id/act/pp/2020/2"], tersisa: 5 });
    expect(keluar()).toEqual([
      { tipe: "ekstrak_pdf", frbr_uri: "/akn/id/act/pp/2020/1", r2_key: kunciPdf("/akn/id/act/pp/2020/1"), dari_teks: true },
      { tipe: "ekstrak_pdf", frbr_uri: "/akn/id/act/pp/2020/2", r2_key: kunciPdf("/akn/id/act/pp/2020/2"), dari_teks: true },
    ]);

    const h2 = await jalankanUraianUlang(l.env, 2_000);
    expect(h2).toMatchObject({ dikerjakan: true, diantrekan: ["/akn/id/act/pp/2020/3", "/akn/id/act/uu/2020/4"] });
    const h3 = await jalankanUraianUlang(l.env, 3_000);
    expect(h3).toMatchObject({ dikerjakan: true, diantrekan: ["/akn/id/act/uu/2020/5"] });
    keluar();
    // Semua sudah diantrekan sekali; yang berikutnya menunggu siklus baru, bukan mengulang segera.
    expect(await jalankanUraianUlang(l.env, 4_000)).toEqual({ dikerjakan: false, alasan: "siklus ini selesai; yang masih usang diulang pada siklus berikutnya" });
    expect(keluar()).toEqual([]);
  });

  it("peraturan yang tetap usang (gagal diurai) diulang paling cepat satu siklus (6 jam) kemudian, bukan tiap 15 menit", async () => {
    await tanam(PERATURAN[0]);
    const t0 = 10_000_000;
    expect((await jalankanUraianUlang(l.env, t0)).dikerjakan).toBe(true);
    keluar(); // tak dikerjakan antrean: tetap usang
    expect((await jalankanUraianUlang(l.env, t0 + 15 * 60_000)).dikerjakan).toBe(false);
    expect((await jalankanUraianUlang(l.env, t0 + JEDA_SIKLUS_MS - 1)).dikerjakan).toBe(false);
    const ulang = await jalankanUraianUlang(l.env, t0 + JEDA_SIKLUS_MS);
    expect(ulang).toMatchObject({ dikerjakan: true, diantrekan: [PERATURAN[0].uri] });
  });

  it("antrean mengerjakannya: versi pengurai naik, halaman pasal terisi, dan yang sudah terkini tak diantrekan lagi", async () => {
    for (const p of PERATURAN.slice(0, 3)) await tanam(p);
    await jalankanCron(l, CRON_GEMINI);
    await kurasSemua(l);
    expect(await baris(l, `SELECT frbr_uri, versi_parser FROM ekstraksi_log ORDER BY frbr_uri`)).toEqual(
      PERATURAN.slice(0, 3).map((p) => ({ frbr_uri: p.uri, versi_parser: VERSI_PARSER })),
    );
    expect(await baris(l, `SELECT frbr_uri, nomor_pasal, halaman FROM articles ORDER BY frbr_uri, urutan`)).toEqual(
      PERATURAN.slice(0, 3).flatMap((p) => [{ frbr_uri: p.uri, nomor_pasal: "1", halaman: 1 }, { frbr_uri: p.uri, nomor_pasal: "2", halaman: 2 }]),
    );
    l.antrean.kuras();
    // Kursor masih menunjuk peraturan terakhir yang diantrekan; begitu tak ada yang usang lagi, ia dibersihkan.
    expect(l.kv.isi.has(KUNCI_KURSOR_URAIAN)).toBe(true);
    expect(await jalankanUraianUlang(l.env, Date.now() + 1000)).toEqual({ dikerjakan: false, alasan: "tidak ada yang usang" });
    expect(l.kv.isi.has(KUNCI_KURSOR_URAIAN)).toBe(false);
  });

  it("dilewati: tanpa PDF, vonis gagal, jenis di luar cakupan, dan yang sudah berversi terkini", async () => {
    await tanam(PERATURAN[0], { pdf: false });
    await tanam(PERATURAN[1], { vonis: "gagal" });
    await tanam(PERATURAN[2], { versi: VERSI_PARSER });
    await tanam({ uri: "/akn/id/act/perpres/2020/9", jenis: "PERPRES", nomor: "9", tahun: 2020 });
    expect(await jalankanUraianUlang(l.env)).toEqual({ dikerjakan: false, alasan: "tidak ada yang usang" });
    expect(keluar()).toEqual([]);
  });

  it("URAIAN_ULANG_OTOMATIS=mati (dan padanannya): tak mengerjakan apa pun", async () => {
    await tanam(PERATURAN[0]);
    for (const nilai of ["mati", "OFF", "0", "false", "tidak"]) {
      l.env.URAIAN_ULANG_OTOMATIS = nilai;
      expect(await jalankanUraianUlang(l.env)).toEqual({ dikerjakan: false, alasan: "mati" });
    }
    expect(keluar()).toEqual([]);
    expect(l.kv.isi.has(KUNCI_KURSOR_URAIAN)).toBe(false);
  });

  it("mencatat satu baris sync_log 'uraian_ulang' per putaran yang mengantrekan, dengan sisa yang usang", async () => {
    for (const p of PERATURAN) await tanam(p);
    l.env.URAIAN_ULANG_BATAS = "2";
    await jalankanUraianUlang(l.env);
    const log = await baris<{ job: string; status: string; detail: string; jumlah: number }>(l, `SELECT job, status, detail, jumlah FROM sync_log WHERE job = 'uraian_ulang'`);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ status: "sukses", jumlah: 2 });
    expect(log[0].detail).toContain(`pengurai v${VERSI_PARSER}`);
    expect(log[0].detail).toContain("usang tersisa 5");
  });

  it("kursor di KV yang rusak tak menghentikan apa pun: dimulai dari awal", async () => {
    await tanam(PERATURAN[0]);
    await l.kv.put(KUNCI_KURSOR_URAIAN, "bukan json{");
    expect(await jalankanUraianUlang(l.env)).toMatchObject({ dikerjakan: true, diantrekan: [PERATURAN[0].uri] });
  });

  it("pemicu harian dan pemicu tak dikenal tidak menjalankannya", async () => {
    await tanam(PERATURAN[0]);
    await jalankanCron(l, "7 7 * * *");
    expect(keluar()).toEqual([]);
  });
});
