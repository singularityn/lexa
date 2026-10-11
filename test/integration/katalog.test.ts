/**
 * Katalog: sapuan daftar peraturan dari pasal.id yang menyimpan metadata lebih dulu (baris 'menunggu'), terpisah dari
 * pengambilan isinya.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buatLingkungan, sqliteAda, type Lingkungan } from "./harness";
import { itemDaftar, pasangPasalPalsu, type PasalPalsu } from "./pasal-palsu";
import { baris, hitungBaris, menit, satu, sisipkanAntre, tanamKatalogSelesai, tanamSemuaDiagnosa, tik, WAKTU } from "./tik-bantu";
import { PasalClient } from "../../src/worker/lib/pasal";
import { hitungGiliran } from "../../src/worker/lib/isi";
import { jenisJatuhTempo, SIKLUS_HARI } from "../../src/worker/lib/katalog";
import { CAKUPAN_BAWAAN } from "../../src/shared/cakupan";

const HARI = 86_400_000;

describe.skipIf(!sqliteAda)("katalog peraturan", () => {
  let l: Lingkungan;
  let pasal: PasalPalsu;

  beforeEach(async () => {
    l = buatLingkungan();
    (PasalClient as unknown as { bentukDetail: string | null }).bentukDetail = null;
    await tanamSemuaDiagnosa(l);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    l.tutup();
  });

  const state = async (kunci: string) => (await satu<{ value: string }>(l, `SELECT value FROM sync_state WHERE key = ?`, kunci))?.value;

  describe("menyimpan metadata", () => {
    beforeEach(() => {
      pasal = pasangPasalPalsu({
        daftar: {
          UU: [
            itemDaftar("UU", 2003, 13, "Ketenagakerjaan", { verifikasi: true }),
            itemDaftar("UU", 1954, 19, "Peraturan Lama", { verifikasi: false }),
          ],
          PERPPU: [itemDaftar("PERPPU", 2022, 2, "Cipta Kerja")],
          PP: [itemDaftar("PP", 2021, 35, "PKWT, Alih Daya", { verifikasi: true })],
        },
      });
    });

    it("tik menyapu UU, PERPPU, dan PP, dan menyimpan tiap peraturan sebagai baris 'menunggu' tanpa pasal", async () => {
      const laporan = await tik(l);
      expect(laporan.katalog?.map((k) => [k.jenis, k.diperiksa, k.selesai])).toEqual([["UU", 2, true], ["PERPPU", 1, true], ["PP", 1, true]]);
      expect(pasal.daftarDiminta()).toEqual([
        { jenis: "UU", offset: "0" }, { jenis: "PERPPU", offset: "0" }, { jenis: "PP", offset: "0" },
      ]);

      expect(await baris(l, `SELECT frbr_uri, jenis, tahun, judul, isi_status, jumlah_pasal, isi_diverifikasi, isi_giliran FROM laws ORDER BY frbr_uri`)).toEqual([
        { frbr_uri: "/akn/id/act/perppu/2022/2", jenis: "PERPPU", tahun: 2022, judul: "Cipta Kerja", isi_status: "menunggu", jumlah_pasal: 0, isi_diverifikasi: null, isi_giliran: hitungGiliran("PERPPU", 2022, null) },
        { frbr_uri: "/akn/id/act/pp/2021/35", jenis: "PP", tahun: 2021, judul: "PKWT, Alih Daya", isi_status: "menunggu", jumlah_pasal: 0, isi_diverifikasi: 1, isi_giliran: hitungGiliran("PP", 2021, true) },
        { frbr_uri: "/akn/id/act/uu/1954/19", jenis: "UU", tahun: 1954, judul: "Peraturan Lama", isi_status: "menunggu", jumlah_pasal: 0, isi_diverifikasi: 0, isi_giliran: hitungGiliran("UU", 1954, false) },
        { frbr_uri: "/akn/id/act/uu/2003/13", jenis: "UU", tahun: 2003, judul: "Ketenagakerjaan", isi_status: "menunggu", jumlah_pasal: 0, isi_diverifikasi: 1, isi_giliran: hitungGiliran("UU", 2003, true) },
      ]);
      // Indeks teks penuh ikut terisi lewat pemicu: peraturan yang isinya belum diambil sudah bisa ditemukan lewat judulnya.
      expect((await satu<{ n: number }>(l, `SELECT COUNT(*) AS n FROM laws_fts WHERE laws_fts MATCH 'Ketenagakerjaan'`))?.n).toBe(1);
      expect(await state("katalog_selesai:UU")).toBe(new Date(WAKTU).toISOString());
      expect(await state("katalog_total:UU")).toBe("2");
    });

    it("urutan giliran: yang terverifikasi dulu, lalu UU sebelum Perppu sebelum PP di dalam tiap tingkat, lalu yang terbaru", async () => {
      await tik(l);
      const urut = (await baris<{ frbr_uri: string }>(l, `SELECT frbr_uri FROM laws WHERE isi_status = 'menunggu' ORDER BY isi_giliran`)).map((r) => r.frbr_uri);
      expect(urut).toEqual([
        "/akn/id/act/uu/2003/13", // terverifikasi: UU
        "/akn/id/act/pp/2021/35", // terverifikasi: PP (sesudah UU)
        "/akn/id/act/uu/1954/19", // tak terverifikasi: UU
        "/akn/id/act/perppu/2022/2", // belum diketahui: Perppu (sesudah UU)
      ]);
    });

    it("peraturan di luar cakupan yang ikut di halaman (filter hulu diabaikan) tidak disimpan", async () => {
      pasal.atur({ daftar: { UU: [itemDaftar("UU", 2003, 13, "Ketenagakerjaan"), itemDaftar("PERPRES", 2020, 1, "Komisi"), itemDaftar("POJK", 2019, 1, "Bank")] } });
      await tik(l);
      expect((await baris<{ jenis: string }>(l, `SELECT jenis FROM laws`)).map((r) => r.jenis)).toEqual(["UU"]);
    });

    it("kutipan ganda (jenis, nomor, tahun sama, URI lain) dilewati tanpa membatalkan sisa halaman", async () => {
      pasal.atur({
        daftar: {
          UU: [
            itemDaftar("UU", 2003, 13, "Pertama"),
            { ...itemDaftar("UU", 2003, 13, "Kembaran"), frbr_uri: "/akn/id/act/uu-x/2003/13" },
            itemDaftar("UU", 2004, 1, "Sesudahnya"),
          ],
        },
      });
      await tik(l);
      expect((await baris<{ judul: string }>(l, `SELECT judul FROM laws WHERE jenis = 'UU' ORDER BY tahun`)).map((r) => r.judul)).toEqual(["Pertama", "Sesudahnya"]);
    });
  });

  describe("kemajuan dan siklus", () => {
    it("kursor offset maju per halaman (100 peraturan per permintaan), dan jenis ditandai selesai di halaman terakhir", async () => {
      const banyak = Array.from({ length: 350 }, (_, i) => itemDaftar("UU", 1950 + (i % 70), i + 1, `Judul ${i}`));
      pasal = pasangPasalPalsu({ daftar: { UU: banyak } });

      // Anggaran tiga permintaan per tik: tiga halaman pertama.
      await tik(l, menit(0));
      expect(pasal.daftarDiminta().map((d) => d.offset)).toEqual(["0", "100", "200"]);
      expect(await state("katalog_offset:UU")).toBe("300");
      expect(await state("katalog_selesai:UU")).toBeUndefined();
      expect(await hitungBaris(l, "laws")).toBe(300);

      await tik(l, menit(1));
      const kedua = pasal.daftarDiminta().slice(3);
      expect(kedua.map((d) => [d.jenis, d.offset])).toEqual([["UU", "300"], ["PERPPU", "0"], ["PP", "0"]]);
      expect(await state("katalog_offset:UU")).toBe("0");
      expect(await state("katalog_selesai:UU")).toBe(new Date(menit(1)).toISOString());
      expect(await state("katalog_total:UU")).toBe("350");
      expect(await hitungBaris(l, "laws")).toBe(350);
    });

    it("sapuan penuh tidak diulang sebelum siklus tiga hari, lalu mulai lagi", async () => {
      pasal = pasangPasalPalsu({ daftar: { UU: [itemDaftar("UU", 2003, 13, "Ketenagakerjaan")] } });
      await tanamKatalogSelesai(l, WAKTU);

      expect(await tik(l, WAKTU + 2 * HARI)).toEqual({ dilewati: "sepi" });
      expect(pasal.panggilan).toEqual([]);

      const lagi = await tik(l, WAKTU + SIKLUS_HARI * HARI + 60_000);
      expect(lagi.katalog?.[0]).toMatchObject({ jenis: "UU", selesai: true });
      expect(pasal.daftarDiminta()[0]).toEqual({ jenis: "UU", offset: "0" });
    });

    it("jenisJatuhTempo: sapuan yang sedang berjalan didahulukan, dan jenis di luar cakupan tak pernah", () => {
      const sekarang = WAKTU + 10 * HARI;
      const selesaiSemua = new Map(["UU", "PERPPU", "PP", "UUD", "TAP_MPR"].map((j) => [`katalog_selesai:${j}`, new Date(sekarang).toISOString()]));
      expect(jenisJatuhTempo(selesaiSemua, CAKUPAN_BAWAAN, sekarang)).toBeNull();
      expect(jenisJatuhTempo(new Map([...selesaiSemua, ["katalog_offset:PP", "200"]]), CAKUPAN_BAWAAN, sekarang)).toBe("PP");
      expect(jenisJatuhTempo(new Map(), ["UU"], sekarang)).toBe("UU");
      expect(jenisJatuhTempo(new Map([["katalog_selesai:UU", new Date(sekarang).toISOString()]]), ["UU"], sekarang)).toBeNull();
    });

    it("sapuan ulang atas data yang sama tidak menulis apa pun ke baris peraturan", async () => {
      pasal = pasangPasalPalsu({ daftar: { UU: [itemDaftar("UU", 2003, 13, "Ketenagakerjaan", { verifikasi: true })] } });
      await tik(l, menit(0));
      await l.db.prepare(`UPDATE laws SET updated_at = '2000-01-01 00:00:00'`).run();
      await l.db.prepare(`DELETE FROM sync_state WHERE key LIKE 'katalog_%'`).run();

      await tik(l, menit(5));
      expect(await satu(l, `SELECT updated_at FROM laws`)).toEqual({ updated_at: "2000-01-01 00:00:00" });
    });

    it("tanpa pekerjaan sama sekali (katalog selesai, antrean kosong), tik sepi dan tak menghubungi pasal.id", async () => {
      pasal = pasangPasalPalsu({});
      await tanamKatalogSelesai(l);
      expect(await tik(l)).toEqual({ dilewati: "sepi" });
      expect(pasal.panggilan).toEqual([]);
    });
  });

  describe("perubahan di sumber", () => {
    it("judul dan status yang berubah memperbarui metadata, tetapi isi yang sudah lengkap tidak diambil ulang", async () => {
      await sisipkanAntre(l, [{ uri: "/akn/id/act/uu/2003/13", jenis: "UU", tahun: 2003, status: "lengkap", jumlahPasal: 5, arsip: true, verifikasi: true }]);
      pasal = pasangPasalPalsu({ daftar: { UU: [itemDaftar("UU", 2003, 13, "Judul Baru", { status: "dicabut", verifikasi: true })] } });
      await tik(l);
      expect(await satu(l, `SELECT judul, status, isi_status, jumlah_pasal, isi_arsip FROM laws`)).toEqual({
        judul: "Judul Baru", status: "dicabut", isi_status: "lengkap", jumlah_pasal: 5, isi_arsip: 1,
      });
    });

    it("peraturan 'kosong' yang kini terverifikasi pasal.id diantrekan lagi dengan giliran terhitung ulang", async () => {
      await sisipkanAntre(l, [
        { uri: "/akn/id/act/pp/1999/1", jenis: "PP", tahun: 1999, status: "kosong", verifikasi: false, percobaan: 1 },
        { uri: "/akn/id/act/pp/1999/2", jenis: "PP", tahun: 1999, status: "kosong", verifikasi: false },
      ]);
      pasal = pasangPasalPalsu({
        daftar: { PP: [itemDaftar("PP", 1999, 1, "Sudah ada isi", { verifikasi: true }), itemDaftar("PP", 1999, 2, "Masih kosong", { verifikasi: false })] },
      });
      await tik(l);
      expect(await baris(l, `SELECT frbr_uri, isi_status, isi_percobaan, isi_giliran FROM laws ORDER BY frbr_uri`)).toEqual([
        { frbr_uri: "/akn/id/act/pp/1999/1", isi_status: "menunggu", isi_percobaan: 0, isi_giliran: hitungGiliran("PP", 1999, true) },
        { frbr_uri: "/akn/id/act/pp/1999/2", isi_status: "kosong", isi_percobaan: 0, isi_giliran: hitungGiliran("PP", 1999, false) },
      ]);
    });

    it("peraturan yang masih menunggu mendapat giliran baru bila bendera verifikasinya berubah", async () => {
      await sisipkanAntre(l, [{ uri: "/akn/id/act/uu/2003/13", jenis: "UU", tahun: 2003, verifikasi: false }]);
      pasal = pasangPasalPalsu({ daftar: { UU: [itemDaftar("UU", 2003, 13, "Ketenagakerjaan", { verifikasi: true })] } });
      await tik(l);
      expect(await satu(l, `SELECT isi_diverifikasi, isi_giliran FROM laws`)).toEqual({ isi_diverifikasi: 1, isi_giliran: hitungGiliran("UU", 2003, true) });
    });
  });

  describe("UUD dan Tap MPR (kode filter belum terbukti)", () => {
    it("filter dikenal: halaman memuat jenis yang diminta, jadi disimpan dan dicatat 'ya'", async () => {
      pasal = pasangPasalPalsu({ daftar: { UUD: [itemDaftar("UUD", 1945, 1, "Undang-Undang Dasar 1945", { verifikasi: true })] } });
      await tanamKatalogSelesai(l, WAKTU - 10 * HARI); // semua jatuh tempo
      await l.db.prepare(`DELETE FROM sync_state WHERE key IN ('katalog_selesai:UU','katalog_selesai:PERPPU','katalog_selesai:PP')`).run();
      await l.db.prepare(`INSERT INTO sync_state (key, value) VALUES ('katalog_selesai:UU', ?), ('katalog_selesai:PERPPU', ?), ('katalog_selesai:PP', ?)`)
        .bind(new Date(WAKTU).toISOString(), new Date(WAKTU).toISOString(), new Date(WAKTU).toISOString()).run();
      await tik(l);
      expect(await satu(l, `SELECT jenis, judul FROM laws`)).toEqual({ jenis: "UUD", judul: "Undang-Undang Dasar 1945" });
      expect(await state("katalog_dukungan:UUD")).toBe("ya");
    });

    it("filter diabaikan hulu (halaman berisi jenis lain): dicatat tidak didukung dan tak diulang; yang dalam cakupan tetap disimpan", async () => {
      pasal = pasangPasalPalsu({
        abaikanFilter: true,
        daftar: { UU: [itemDaftar("UU", 2003, 13, "Ketenagakerjaan")], PERPRES: [itemDaftar("PERPRES", 2020, 1, "Komisi")] },
      });
      await tanamKatalogSelesai(l);
      await l.db.prepare(`DELETE FROM sync_state WHERE key = 'katalog_selesai:UUD'`).run();

      const laporan = await tik(l);
      expect(laporan.katalog).toEqual([{ jenis: "UUD", diperiksa: 2, disimpan: 1, selesai: true, tidakDidukung: true }]);
      expect(await state("katalog_dukungan:UUD")).toBe("tidak: filter diabaikan");
      expect((await baris<{ jenis: string }>(l, `SELECT jenis FROM laws`)).map((r) => r.jenis)).toEqual(["UU"]);

      // Sapuan UUD tidak diulang pada tik berikutnya (yang kini mencoba mengambil isi UU yang baru tercatat).
      await tik(l, menit(1));
      expect(pasal.daftarDiminta()).toEqual([{ jenis: "UUD", offset: "0" }]);
    });

    it("kode ditolak hulu dengan 4xx: jawaban, bukan gangguan; jenis lain tetap disapu", async () => {
      pasal = pasangPasalPalsu({ galat: (u) => (u.searchParams.get("type") === "TAP_MPR" ? 400 : undefined) });
      await tanamKatalogSelesai(l);
      await l.db.prepare(`DELETE FROM sync_state WHERE key = 'katalog_selesai:TAP_MPR'`).run();
      const laporan = await tik(l);
      expect(laporan.katalog).toEqual([{ jenis: "TAP_MPR", diperiksa: 0, disimpan: 0, selesai: true, tidakDidukung: true }]);
      expect(await state("katalog_dukungan:TAP_MPR")).toBe("tidak: HTTP 400");
      expect(laporan.jedaPasalSampai).toBeUndefined();
    });
  });

  describe("kena batas laju", () => {
    it("kursor tidak maju melewati halaman yang gagal, jeda disimpan, dan tik dalam jeda tak menghubungi pasal.id", async () => {
      const banyak = Array.from({ length: 150 }, (_, i) => itemDaftar("UU", 2000, i + 1, `Judul ${i}`));
      pasal = pasangPasalPalsu({ daftar: { UU: banyak }, batasLaju: (u) => u.searchParams.get("type") === "UU" && u.searchParams.get("offset") === "100" });

      const kena = await tik(l, menit(0));
      expect(kena.katalog).toHaveLength(1);
      expect(kena.jedaPasalSampai).toBe(new Date(menit(0) + 120_000).toISOString());
      expect(await state("katalog_offset:UU")).toBe("100");
      expect(await hitungBaris(l, "laws")).toBe(100);

      const dalamJeda = pasal.panggilan.length;
      expect(await tik(l, menit(1))).toEqual({ dilewati: "sepi" });
      expect(pasal.panggilan).toHaveLength(dalamJeda);

      pasal.atur({ batasLaju: undefined });
      const lanjut = await tik(l, menit(3));
      expect(lanjut.katalog?.[0]).toMatchObject({ jenis: "UU", diperiksa: 50, selesai: true });
      expect(pasal.daftarDiminta().slice(dalamJeda).map((d) => d.offset)[0]).toBe("100"); // melanjutkan, bukan mengulang
      expect(await hitungBaris(l, "laws")).toBe(150);
    });

    it("galat 5xx pada daftar: pasal.id dijeda sebentar dan tak dihantam terus, kursor tetap", async () => {
      pasal = pasangPasalPalsu({ galat: () => 503 });
      const laporan = await tik(l);
      expect(laporan.galatPasal).toContain("503");
      expect(laporan.jedaPasalSampai).toBe(new Date(WAKTU + 120_000).toISOString());
      expect(pasal.panggilan).toHaveLength(1);
      expect(await state("katalog_offset:UU")).toBeUndefined();
    });
  });
});
