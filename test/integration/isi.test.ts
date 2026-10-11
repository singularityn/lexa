/**
 * Isi peraturan: pengambilan detail dari pasal.id menurut giliran, arsip respons, aturan penjaga penyimpanan,
 * kegagalan dan batas laju, serta penguraian ulang dari arsip tanpa pasal.id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buatLingkungan, sqliteAda, type Lingkungan } from "./harness";
import { detailPeraturan, pasangPasalPalsu, type PasalPalsu } from "./pasal-palsu";
import { baris, hitungBaris, menit, satu, sisipkanAntre, tanamKatalogSelesai, tanamSemuaDiagnosa, tik, WAKTU } from "./tik-bantu";
import { PasalClient } from "../../src/worker/lib/pasal";
import { arsipkanMentah, bacaMentah, hitungGiliran, kunciMentah, SQL_GILIRAN } from "../../src/worker/lib/isi";
import { tundaPasal } from "../../src/worker/lib/keadaan";

const UU13 = "/akn/id/act/uu/2003/13";
const PP35 = "/akn/id/act/pp/2021/35";
const UU54 = "/akn/id/act/uu/1954/19";

describe.skipIf(!sqliteAda)("isi peraturan", () => {
  let l: Lingkungan;
  let pasal: PasalPalsu;

  beforeEach(async () => {
    l = buatLingkungan();
    (PasalClient as unknown as { bentukDetail: string | null }).bentukDetail = null;
    await tanamSemuaDiagnosa(l);
    await tanamKatalogSelesai(l);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    l.tutup();
  });

  const detailUU13 = () =>
    detailPeraturan("UU", 2003, 13, "Ketenagakerjaan", 3, {
      relationships: [{ frbr_uri: "/akn/id/act/uu/2020/11", relationship_type: "Diubah Oleh", note: "UU 11/2020" }],
    });
  const log = (job: string) => baris(l, `SELECT status, detail, jumlah FROM sync_log WHERE job = ? ORDER BY id`, job);

  describe("pengambilan dan penyimpanan", () => {
    it("menyimpan pasal, relasi, arsip teks, dan arsip respons, lalu mengantrekan pengindeksan vektor", async () => {
      await sisipkanAntre(l, [{ uri: UU13, jenis: "UU", tahun: 2003, verifikasi: true }]);
      pasal = pasangPasalPalsu({ detail: { [UU13]: detailUU13() } });

      const laporan = await tik(l);
      expect(laporan.isi).toMatchObject({ diambil: 1, diurai: 0, lengkap: 1, kosong: 0, gagal: 0 });

      expect(await satu(l, `SELECT judul, jumlah_pasal, isi_status, isi_arsip, isi_akses, isi_percobaan, isi_catatan, r2_text_key FROM laws`)).toEqual({
        judul: "Ketenagakerjaan", jumlah_pasal: 4, isi_status: "lengkap", isi_arsip: 1, isi_akses: "full", isi_percobaan: 0,
        isi_catatan: null, r2_text_key: "teks/akn/id/act/uu/2003/13.txt",
      });
      expect((await baris<{ id: string }>(l, `SELECT id FROM articles ORDER BY urutan`)).map((r) => r.id)).toEqual([
        `${UU13}#pasal-1`, `${UU13}#pasal-2-ayat-1`, `${UU13}#pasal-2-ayat-2`, `${UU13}#pasal-3`,
      ]);
      expect(await baris(l, `SELECT to_uri, jenis_relasi, keterangan FROM relations`)).toEqual([
        { to_uri: "/akn/id/act/uu/2020/11", jenis_relasi: "diubah_oleh", keterangan: "UU 11/2020" },
      ]);
      expect(await l.r2.get("teks/akn/id/act/uu/2003/13.txt").then((o) => o?.text())).toContain("Pasal 2 ayat (1)\nIsi ayat satu pasal 2.");
      expect(l.r2.objek.has(kunciMentah(UU13))).toBe(true);
      expect(l.antrean.pesan).toEqual([{ tipe: "indeks_vektor", frbr_uri: UU13 }]);
      expect((await satu<{ n: number }>(l, `SELECT COUNT(*) AS n FROM articles_fts WHERE articles_fts MATCH 'ayat'`))?.n).toBe(2);
      expect(await log("isi_peraturan")).toEqual([
        { status: "sukses", detail: "diambil 1, diuraikan ulang 0: lengkap 1, kosong 0, dipertahankan 0, gagal 0", jumlah: 1 },
      ]);
    });

    it("pasal berayat yang kosong di respons (pola data produksi) kini menjadi baris per ayat, dan arsip menyimpan respons utuh", async () => {
      await sisipkanAntre(l, [{ uri: UU13, jenis: "UU", tahun: 2003 }]);
      const mentah = detailUU13();
      pasal = pasangPasalPalsu({ detail: { [UU13]: mentah } });
      await tik(l);
      const arsip = await bacaMentah(l.r2 as never, UU13);
      expect(arsip).toEqual(mentah);
    });

    it("urutan pengambilan mengikuti giliran: terverifikasi dulu, UU sebelum PP, lalu yang tak terverifikasi", async () => {
      await sisipkanAntre(l, [
        { uri: UU54, jenis: "UU", tahun: 1954, verifikasi: false },
        { uri: PP35, jenis: "PP", tahun: 2021, verifikasi: true },
        { uri: UU13, jenis: "UU", tahun: 2003, verifikasi: true },
      ]);
      pasal = pasangPasalPalsu({
        detail: { [UU13]: detailUU13(), [PP35]: detailPeraturan("PP", 2021, 35, "PKWT"), [UU54]: detailPeraturan("UU", 1954, 19, "Lama") },
      });
      await tik(l);
      expect(pasal.detailDiminta()).toEqual([UU13, PP35, UU54]);
    });

    it("paling banyak tiga detail per tik; sisanya menunggu tik berikutnya", async () => {
      const uris = [1, 2, 3, 4, 5].map((n) => `/akn/id/act/uu/2000/${n}`);
      await sisipkanAntre(l, uris.map((uri, i) => ({ uri, jenis: "UU", tahun: 2000, nomor: String(i + 1) })));
      pasal = pasangPasalPalsu({ detail: Object.fromEntries(uris.map((u, i) => [u, detailPeraturan("UU", 2000, i + 1, `Judul ${i + 1}`)])) });

      expect((await tik(l, menit(0))).isi).toMatchObject({ diambil: 3, lengkap: 3 });
      expect(await hitungBaris(l, "laws", "isi_status = 'menunggu'")).toBe(2);
      expect((await tik(l, menit(1))).isi).toMatchObject({ diambil: 2, lengkap: 2 });
      expect(await tik(l, menit(2))).toEqual({ dilewati: "sepi" });
    });

    it("pembaruan metadata dari detail tidak menghapus ringkasan AI maupun nilai yang tak ada di respons", async () => {
      await sisipkanAntre(l, [{ uri: UU13, jenis: "UU", tahun: 2003 }]);
      await l.db.prepare(`UPDATE laws SET ringkasan = 'ringkasan lama', instansi = 'Indonesia', bpk_id = '1001'`).run();
      pasal = pasangPasalPalsu({ detail: { [UU13]: detailUU13() } });
      await tik(l);
      expect(await satu(l, `SELECT ringkasan, instansi, bpk_id FROM laws`)).toEqual({ ringkasan: "ringkasan lama", instansi: "Indonesia", bpk_id: "1001" });
    });
  });

  describe("aturan penjaga: data yang sudah ada tidak boleh memburuk", () => {
    const tanamPasalLama = async (jumlah: number) => {
      await sisipkanAntre(l, [{ uri: UU13, jenis: "UU", tahun: 2003, jumlahPasal: jumlah }]);
      for (let n = 1; n <= jumlah; n++) {
        await l.db.prepare(`INSERT INTO articles (id, frbr_uri, nomor_pasal, isi, urutan) VALUES (?,?,?,?,?)`)
          .bind(`${UU13}#pasal-${n}`, UU13, String(n), `Isi lama pasal ${n}.`, n).run();
      }
    };

    it("respons tanpa pasal tidak menghapus pasal yang tersimpan, dan dicatat", async () => {
      await tanamPasalLama(3);
      pasal = pasangPasalPalsu({ detail: { [UU13]: { ...detailUU13(), articles: [] } } });
      const laporan = await tik(l);
      expect(laporan.isi).toMatchObject({ dipertahankan: 1, lengkap: 0, kosong: 0 });
      expect(await hitungBaris(l, "articles")).toBe(3);
      expect(await satu(l, `SELECT jumlah_pasal, isi_status, isi_catatan FROM laws`)).toEqual({
        jumlah_pasal: 3, isi_status: "lengkap", isi_catatan: expect.stringContaining("3 pasal tersimpan dipertahankan"),
      });
      expect(l.antrean.pesan).toEqual([]); // tak ada yang diganti, jadi tak ada yang perlu diindeks ulang
    });

    it("respons dengan pasal lebih sedikit dari yang tersimpan tidak menggantikannya", async () => {
      await tanamPasalLama(6);
      pasal = pasangPasalPalsu({ detail: { [UU13]: detailPeraturan("UU", 2003, 13, "Ketenagakerjaan", 3) } }); // 4 baris < 6
      await tik(l);
      expect(await hitungBaris(l, "articles")).toBe(6);
      expect((await baris<{ isi: string }>(l, `SELECT isi FROM articles ORDER BY urutan LIMIT 1`))[0].isi).toBe("Isi lama pasal 1.");
      expect(await satu(l, `SELECT isi_status, isi_catatan FROM laws`)).toEqual({
        isi_status: "lengkap", isi_catatan: expect.stringContaining("kurang dari 6 tersimpan"),
      });
    });

    it("respons dengan pasal sama banyak atau lebih menggantikan, dan id vektor yang lenyap masuk daftar hapus (termasuk potongan lanjutan)", async () => {
      await tanamPasalLama(3); // id lama: #pasal-1, #pasal-2, #pasal-3
      await l.db.prepare(`UPDATE articles SET isi = ? WHERE id = ?`).bind("x".repeat(1300), `${UU13}#pasal-2`).run();
      pasal = pasangPasalPalsu({ detail: { [UU13]: detailPeraturan("UU", 2003, 13, "Ketenagakerjaan", 3) } }); // #pasal-1, 2-ayat-1/2, #pasal-3

      await tik(l);
      expect((await baris<{ id: string }>(l, `SELECT id FROM articles ORDER BY urutan`)).map((r) => r.id)).toEqual([
        `${UU13}#pasal-1`, `${UU13}#pasal-2-ayat-1`, `${UU13}#pasal-2-ayat-2`, `${UU13}#pasal-3`,
      ]);
      expect((await baris<{ kunci: string }>(l, `SELECT kunci FROM daftar_hapus WHERE jenis_objek = 'vektor' ORDER BY kunci`)).map((r) => r.kunci)).toEqual([
        `${UU13}#pasal-2`, `${UU13}#pasal-2~1`, `${UU13}#pasal-2~2`, `${UU13}#pasal-2~3`,
      ]);
    });

    it("relasi lama tidak dihapus bila respons tidak memuat relasi", async () => {
      await sisipkanAntre(l, [{ uri: UU13, jenis: "UU", tahun: 2003 }]);
      await l.db.prepare(`INSERT INTO relations (from_uri, to_uri, jenis_relasi) VALUES (?, '/akn/id/act/uu/2020/11', 'diubah_oleh')`).bind(UU13).run();
      pasal = pasangPasalPalsu({ detail: { [UU13]: detailPeraturan("UU", 2003, 13, "Ketenagakerjaan", 3) } }); // relationships: []
      await tik(l);
      expect(await hitungBaris(l, "relations")).toBe(1);
    });

    it("peraturan tanpa pasal dan tak punya pasal tersimpan menjadi 'kosong' dengan catatan bentuk pohon, dan tidak diambil lagi", async () => {
      await sisipkanAntre(l, [{ uri: UU54, jenis: "UU", tahun: 1954, verifikasi: false }]);
      const kosong = detailPeraturan("UU", 1954, 19, "Lama", 0);
      pasal = pasangPasalPalsu({ detail: { [UU54]: kosong } });
      const laporan = await tik(l, menit(0));
      expect(laporan.isi).toMatchObject({ kosong: 1, lengkap: 0 });
      expect(await satu(l, `SELECT isi_status, jumlah_pasal, isi_catatan FROM laws`)).toEqual({
        isi_status: "kosong", jumlah_pasal: 0, isi_catatan: "1 simpul: bab 1; 0 berisi; 0 yatim",
      });
      expect(await tik(l, menit(1))).toEqual({ dilewati: "sepi" });
      expect(pasal.detailDiminta()).toEqual([UU54]);
    });
  });

  describe("kegagalan", () => {
    it("galat 5xx pada satu peraturan menggeser gilirannya ke belakang; yang lain tetap dikerjakan; sesudah lima kali menjadi 'gagal'", async () => {
      await sisipkanAntre(l, [
        { uri: UU13, jenis: "UU", tahun: 2003, verifikasi: true },
        { uri: PP35, jenis: "PP", tahun: 2021, verifikasi: true },
      ]);
      pasal = pasangPasalPalsu({
        detail: { [PP35]: detailPeraturan("PP", 2021, 35, "PKWT") },
        galat: (u) => (u.pathname.endsWith(UU13) ? 500 : undefined),
      });

      const awal = hitungGiliran("UU", 2003, true);
      await tik(l, menit(0));
      expect(await satu(l, `SELECT isi_status, isi_percobaan, isi_giliran, isi_catatan FROM laws WHERE frbr_uri = ?`, UU13)).toEqual({
        isi_status: "menunggu", isi_percobaan: 1, isi_giliran: awal + 1_000_000_000, isi_catatan: expect.stringContaining("500"),
      });
      expect(await satu(l, `SELECT isi_status FROM laws WHERE frbr_uri = ?`, PP35)).toEqual({ isi_status: "lengkap" });

      for (let i = 1; i < 5; i++) await tik(l, menit(i));
      expect(await satu(l, `SELECT isi_status, isi_percobaan FROM laws WHERE frbr_uri = ?`, UU13)).toEqual({ isi_status: "gagal", isi_percobaan: 5 });
      expect(await tik(l, menit(6))).toEqual({ dilewati: "sepi" });
    });

    it("404 pada detail: dua kali percobaan, lalu 'kosong' (daftar mencantumkannya tetapi detailnya tak ada)", async () => {
      await sisipkanAntre(l, [{ uri: UU13, jenis: "UU", tahun: 2003 }]);
      pasal = pasangPasalPalsu({}); // semua detail 404
      await tik(l, menit(0));
      expect(await satu(l, `SELECT isi_status, isi_percobaan FROM laws`)).toEqual({ isi_status: "menunggu", isi_percobaan: 1 });
      await tik(l, menit(1));
      expect(await satu(l, `SELECT isi_status, isi_percobaan FROM laws`)).toEqual({ isi_status: "kosong", isi_percobaan: 2 });
    });

    it("peraturan yang sudah punya pasal (diantrekan ulang untuk diperbaiki) kembali 'lengkap', bukan 'kosong' atau 'gagal', bila pengambilannya gagal terus", async () => {
      await sisipkanAntre(l, [
        { uri: UU13, jenis: "UU", tahun: 2003, jumlahPasal: 6 },
        { uri: PP35, jenis: "PP", tahun: 2021, jumlahPasal: 4 },
        { uri: UU54, jenis: "UU", tahun: 1954 },
      ]);
      pasal = pasangPasalPalsu({ galat: (u) => (u.pathname.endsWith("/uu/2003/13") ? 404 : 500) });
      for (let i = 0; i < 5; i++) await tik(l, menit(i));
      expect(await baris(l, `SELECT frbr_uri, isi_status, jumlah_pasal FROM laws ORDER BY frbr_uri`)).toEqual([
        { frbr_uri: PP35, isi_status: "lengkap", jumlah_pasal: 4 },
        { frbr_uri: UU54, isi_status: "gagal", jumlah_pasal: 0 }, // tanpa pasal tersimpan: 'gagal' seperti biasa
        { frbr_uri: UU13, isi_status: "lengkap", jumlah_pasal: 6 }, // 404 dua kali: bukan 'kosong'
      ]);
    });

    it("kena 429 di tengah: yang sudah selesai tersimpan, yang kena batas tanpa penalti, sisanya tak disentuh, dan jeda disimpan", async () => {
      const uris = [1, 2, 3].map((n) => `/akn/id/act/uu/2000/${n}`);
      await sisipkanAntre(l, uris.map((uri, i) => ({ uri, jenis: "UU", tahun: 2000 - i, nomor: String(i + 1), verifikasi: true })));
      pasal = pasangPasalPalsu({
        detail: Object.fromEntries(uris.map((u, i) => [u, detailPeraturan("UU", 2000, i + 1, `Judul ${i + 1}`)])),
        batasLaju: (u) => u.pathname.endsWith("/2000/2") || u.pathname.endsWith("/1999/2"),
      });
      // Giliran: tahun lebih baru dulu, jadi urutannya uu/2000/1 (2000), uu/2000/2 (1999), uu/2000/3 (1998).
      const laporan = await tik(l, menit(0));
      expect(laporan.jedaPasalSampai).toBe(new Date(menit(0) + 120_000).toISOString());
      expect(await baris(l, `SELECT frbr_uri, isi_status, isi_percobaan FROM laws ORDER BY frbr_uri`)).toEqual([
        { frbr_uri: uris[0], isi_status: "lengkap", isi_percobaan: 0 },
        { frbr_uri: uris[1], isi_status: "menunggu", isi_percobaan: 0 },
        { frbr_uri: uris[2], isi_status: "menunggu", isi_percobaan: 0 },
      ]);
      expect(pasal.detailDiminta()).toEqual([uris[0], uris[1]]); // yang ketiga tidak dicoba sesudah 429

      // Dalam jeda: tik tak menghubungi pasal.id. Sesudahnya melanjutkan dari yang kena batas.
      const jumlah = pasal.panggilan.length;
      await tik(l, menit(1));
      expect(pasal.panggilan).toHaveLength(jumlah);
      pasal.atur({ batasLaju: undefined });
      await tik(l, menit(3));
      expect(await hitungBaris(l, "laws", "isi_status = 'lengkap'")).toBe(3);
    });

    it("token ditolak (403): jeda tiga puluh menit, dicatat, dan peraturannya tidak dihukum", async () => {
      await sisipkanAntre(l, [{ uri: UU13, jenis: "UU", tahun: 2003 }]);
      pasal = pasangPasalPalsu({ galat: () => 403 });
      const laporan = await tik(l, menit(0));
      expect(laporan.galatPasal).toBe("HTTP 403");
      expect(laporan.jedaPasalSampai).toBe(new Date(menit(0) + 30 * 60_000).toISOString());
      expect(await satu(l, `SELECT isi_status, isi_percobaan FROM laws`)).toEqual({ isi_status: "menunggu", isi_percobaan: 0 });
      expect(await log("pasal_laju")).toEqual([{ status: "gagal", detail: expect.stringContaining("token pasal.id ditolak (HTTP 403)"), jumlah: 0 }]);
    });

    it("batas laju yang berulang tidak memenuhi log: satu baris tiap setengah jam", async () => {
      await sisipkanAntre(l, [{ uri: UU13, jenis: "UU", tahun: 2003 }]);
      pasal = pasangPasalPalsu({ batasLaju: () => true });
      for (let i = 0; i < 12; i += 3) await tik(l, menit(i)); // tiap tiga menit: jeda 2 menit habis, kena lagi
      expect((await log("pasal_laju")).length).toBe(1);
      await tik(l, menit(40));
      expect((await log("pasal_laju")).length).toBe(2);
    });
  });

  describe("cakupan dan keutuhan respons", () => {
    it("baris di luar cakupan (cakupan dipersempit sesudah katalog terisi) tidak diambil dari pasal.id", async () => {
      l.env.CAKUPAN_JENIS = "UU";
      await sisipkanAntre(l, [{ uri: PP35, jenis: "PP", tahun: 2021 }]);
      pasal = pasangPasalPalsu({ detail: { [PP35]: detailPeraturan("PP", 2021, 35, "PKWT") } });
      await tik(l);
      expect(pasal.panggilan).toEqual([]);
      expect(await satu(l, `SELECT isi_status, isi_catatan FROM laws`)).toEqual({ isi_status: "kosong", isi_catatan: "di luar cakupan" });
    });

    it("jenis di respons di luar cakupan: tidak disimpan, ditandai kosong dengan alasannya", async () => {
      await sisipkanAntre(l, [{ uri: UU13, jenis: "UU", tahun: 2003 }]);
      const d = detailUU13();
      pasal = pasangPasalPalsu({ detail: { [UU13]: { ...d, work: { ...d.work, type: "PERPRES" } } } });
      await tik(l);
      expect(await satu(l, `SELECT isi_status, isi_catatan, jumlah_pasal FROM laws`)).toEqual({
        isi_status: "kosong", isi_catatan: "di luar cakupan (PERPRES)", jumlah_pasal: 0,
      });
      expect(await hitungBaris(l, "articles")).toBe(0);
      expect(l.antrean.pesan).toEqual([]);
    });

    it("selisih huruf besar/kecil dan garis miring pada URI tidak membuat baris katalog menggantung; peraturan lain ditolak", async () => {
      await sisipkanAntre(l, [
        { uri: UU13, jenis: "UU", tahun: 2003, verifikasi: true },
        { uri: PP35, jenis: "PP", tahun: 2021, verifikasi: true },
      ]);
      const ejaan = detailUU13();
      ejaan.work.frbr_uri = "/AKN/id/act/uu/2003/13/";
      const lain = detailPeraturan("PP", 2021, 99, "Peraturan lain");
      pasal = pasangPasalPalsu({ detail: { [UU13]: ejaan, [PP35]: lain } });
      await tik(l);
      expect(await satu(l, `SELECT isi_status, jumlah_pasal FROM laws WHERE frbr_uri = ?`, UU13)).toEqual({ isi_status: "lengkap", jumlah_pasal: 4 });
      expect(await hitungBaris(l, "laws")).toBe(2); // tak ada baris ganda
      expect(await satu(l, `SELECT isi_status, isi_percobaan, isi_catatan FROM laws WHERE frbr_uri = ?`, PP35)).toEqual({
        isi_status: "menunggu", isi_percobaan: 1, isi_catatan: expect.stringContaining("menjawab peraturan lain"),
      });
    });

    it("arsip respons yang gagal ditulis tidak menghalangi penyimpanan pasal (penandanya tetap 0)", async () => {
      await sisipkanAntre(l, [{ uri: UU13, jenis: "UU", tahun: 2003 }]);
      pasal = pasangPasalPalsu({ detail: { [UU13]: detailUU13() } });
      const asli = l.r2.put.bind(l.r2);
      l.r2.put = (async (kunci: string, ...sisa: unknown[]) => {
        if (kunci.startsWith("mentah/")) throw new Error("R2 penuh");
        return (asli as (...a: unknown[]) => Promise<unknown>)(kunci, ...sisa);
      }) as never;
      await tik(l);
      expect(await satu(l, `SELECT isi_status, jumlah_pasal, isi_arsip FROM laws`)).toEqual({ isi_status: "lengkap", jumlah_pasal: 4, isi_arsip: 0 });
    });
  });

  describe("penguraian ulang dari arsip", () => {
    it("peraturan 'menunggu' yang responsnya sudah diarsipkan diuraikan ulang tanpa menghubungi pasal.id", async () => {
      await sisipkanAntre(l, [{ uri: UU13, jenis: "UU", tahun: 2003, arsip: true, status: "menunggu" }]);
      await arsipkanMentah(l.r2 as never, UU13, detailUU13());
      pasal = pasangPasalPalsu({});
      const laporan = await tik(l);
      expect(pasal.panggilan).toEqual([]);
      expect(laporan.isi).toMatchObject({ diambil: 0, diurai: 1, lengkap: 1 });
      expect(await satu(l, `SELECT isi_status, jumlah_pasal, isi_arsip FROM laws`)).toEqual({ isi_status: "lengkap", jumlah_pasal: 4, isi_arsip: 1 });
    });

    it("tetap berjalan saat pasal.id sedang dijeda, dan saat token belum dipasang", async () => {
      await sisipkanAntre(l, [{ uri: UU13, jenis: "UU", tahun: 2003, arsip: true }]);
      await arsipkanMentah(l.r2 as never, UU13, detailUU13());
      pasal = pasangPasalPalsu({});
      await tundaPasal(l.env.DB, 600_000, WAKTU);
      expect((await tik(l, WAKTU + 1000)).isi).toMatchObject({ diurai: 1 });

      await sisipkanAntre(l, [{ uri: PP35, jenis: "PP", tahun: 2021, arsip: true }]);
      await arsipkanMentah(l.r2 as never, PP35, detailPeraturan("PP", 2021, 35, "PKWT"));
      await l.db.prepare(`DELETE FROM sync_state WHERE key = 'pasal_tunda_sampai'`).run();
      expect((await tik(l, WAKTU + 2000, false)).isi).toMatchObject({ diurai: 1 });
      expect(pasal.panggilan).toEqual([]);
    });

    it("arsip yang hilang mengembalikan peraturan ke antrean pengambilan (isi_arsip = 0), lalu diambil dari pasal.id", async () => {
      await sisipkanAntre(l, [{ uri: UU13, jenis: "UU", tahun: 2003, arsip: true }]);
      pasal = pasangPasalPalsu({ detail: { [UU13]: detailUU13() } });
      await tik(l, menit(0), false); // tanpa pasal.id: hanya penguraian arsip yang dicoba
      expect(await satu(l, `SELECT isi_status, isi_arsip FROM laws`)).toEqual({ isi_status: "menunggu", isi_arsip: 0 });
      await tik(l, menit(1));
      expect(await satu(l, `SELECT isi_status, isi_arsip, jumlah_pasal FROM laws`)).toEqual({ isi_status: "lengkap", isi_arsip: 1, jumlah_pasal: 4 });
    });

    it("arsip yang rusak diperlakukan seperti hilang", async () => {
      await sisipkanAntre(l, [{ uri: UU13, jenis: "UU", tahun: 2003, arsip: true }]);
      await l.r2.put(kunciMentah(UU13), "bukan gzip");
      expect(await bacaMentah(l.r2 as never, UU13)).toBeNull();
    });

    it("bukti perbaikan pengurai: arsip dengan ayat bersaudara pasal dan simpul yatim kini menghasilkan pasal lengkap", async () => {
      await sisipkanAntre(l, [{ uri: UU13, jenis: "UU", tahun: 2003, arsip: true }]);
      // Bentuk yang dulu menghilangkan hampir seluruh isi: ayat sejajar dengan pasalnya, dan satu simpul yatim.
      await arsipkanMentah(l.r2 as never, UU13, {
        work: { id: 1, frbr_uri: UU13, title: "Ketenagakerjaan", type: "UU", number: "13", year: 2003, status: "berlaku" },
        articles: [
          { id: 1, type: "bab", number: "I", heading: "KETENTUAN UMUM", content: "", parent_id: null, sort_order: 1 },
          { id: 2, type: "pasal", number: "1", content: "", parent_id: 1, sort_order: 10 },
          { id: 3, type: "ayat", number: "1", content: "Ayat satu pasal satu.", parent_id: 1, sort_order: 11 },
          { id: 4, type: "ayat", number: "2", content: "Ayat dua pasal satu.", parent_id: 1, sort_order: 12 },
          { id: 5, type: "pasal", number: "2", content: "Pasal dua tunggal.", parent_id: 1, sort_order: 20 },
          { id: 6, type: "pasal", number: "3", content: "Pasal tiga yatim.", parent_id: 999, sort_order: 30 },
        ],
      });
      await tik(l);
      expect(await baris(l, `SELECT nomor_pasal, ayat, isi FROM articles ORDER BY urutan`)).toEqual([
        { nomor_pasal: "1", ayat: "1", isi: "Ayat satu pasal satu." },
        { nomor_pasal: "1", ayat: "2", isi: "Ayat dua pasal satu." },
        { nomor_pasal: "2", ayat: null, isi: "Pasal dua tunggal." },
        { nomor_pasal: "3", ayat: null, isi: "Pasal tiga yatim." },
      ]);
    });
  });

  describe("urutan giliran", () => {
    it("SQL_GILIRAN sama dengan hitungGiliran() untuk semua jenis dan tahun", async () => {
      const contoh: Array<[string, number, boolean | null]> = [
        ["UUD", 1945, true], ["TAP_MPR", 1998, false], ["UU", 2003, true], ["UU", 1954, null], ["PERPPU", 2022, false],
        ["PP", 2021, true], ["PP", 1950, false], ["PERPRES", 2020, null], ["UU", 0, true],
      ];
      await sisipkanAntre(l, contoh.map(([jenis, tahun, verifikasi], i) => ({ uri: `/akn/id/act/x/${tahun}/${i}`, jenis, tahun, nomor: String(i), verifikasi })));
      for (const [jenis, tahun, verifikasi] of contoh) {
        const baru = await satu<{ g: number }>(l, `SELECT ${SQL_GILIRAN} AS g FROM laws WHERE jenis = ? AND tahun = ?`, jenis, tahun);
        expect(baru?.g, `${jenis} ${tahun} ${verifikasi}`).toBe(hitungGiliran(jenis, tahun, verifikasi));
      }
    });

    it("tingkat giliran tidak saling menimpa: terverifikasi < tak terverifikasi < yang gagal", () => {
      const terburukTerverifikasi = hitungGiliran("PERPRES", 0, true);
      const terbaikTakTerverifikasi = hitungGiliran("UUD", 9999, false);
      expect(terburukTerverifikasi).toBeLessThan(terbaikTakTerverifikasi);
      expect(hitungGiliran("PP", 1900, false)).toBeLessThan(1_000_000_000);
    });
  });
});
