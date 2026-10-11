/**
 * Akses isi pasal.id: jawaban detail tanpa naskah (`content: "not_available_via_api"`, tanpa `articles`) bukan
 * peraturan 'kosong'. Pembatasan dicatat, pengambilan detail dijeda sementara katalog jalan terus, satu pembanding
 * (peraturan yang naskahnya sudah tersimpan) membedakan pembatasan menyeluruh dari peraturan yang memang tanpa naskah,
 * dan pengambilan pulih sendiri bila naskah kembali.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buatLingkungan, json, kirim, panggil, sqliteAda, TOKEN_ADMIN, type Lingkungan } from "./harness";
import { CATATAN_TERBATAS, detailPeraturan, detailTerbatas, itemDaftar, pasangPasalPalsu, type PasalPalsu } from "./pasal-palsu";
import { baris, hitungBaris, menit, satu, sisipkanAntre, tanamKatalogSelesai, tanamSemuaDiagnosa, tik } from "./tik-bantu";
import { adaSimpulPasal, catatanAksesTerbatas, PasalClient } from "../../src/worker/lib/pasal";
import { PEMERIKSAAN } from "../../src/worker/lib/diagnosa";
import { bacaAkses, JEDA_PERIKSA_GALAT_MS, JEDA_PERIKSA_MS, tandaiAksesTerbatas, uraiAkses } from "../../src/worker/lib/akses";

const PEMBANDING = "/akn/id/act/uu/2003/13";
const ANTRE_UU = "/akn/id/act/uu/2020/11";
const ANTRE_PP = "/akn/id/act/pp/2021/35";
const CATATAN = `not_available_via_api — ${CATATAN_TERBATAS}`;
const iso = (ms: number) => new Date(ms).toISOString();
const adm = { "x-admin-token": TOKEN_ADMIN };

describe("catatanAksesTerbatas dan adaSimpulPasal", () => {
  const work = { id: 1, frbr_uri: PEMBANDING, title: "UU", type: "UU", number: "13", year: 2003 };

  it("mengenali jawaban tanpa articles yang membawa content/content_note, dan mengembalikan catatannya apa adanya", () => {
    expect(catatanAksesTerbatas(detailTerbatas("UU", 2003, 13, "UU"))).toBe(CATATAN);
    expect(catatanAksesTerbatas({ work, content: "not_available_via_api" })).toBe("not_available_via_api");
    expect(catatanAksesTerbatas({ work, content_note: "hanya catatan" })).toBe("hanya catatan");
    expect(catatanAksesTerbatas({ work, detail_access: { access_via: "token" } })).toContain("access_via");
  });

  it("jawaban yang membawa articles, sekosong apa pun, atau tak menyiratkan pembatasan, bukan pembatasan", () => {
    expect(catatanAksesTerbatas({ work, articles: [] })).toBeNull();
    expect(catatanAksesTerbatas({ work, articles: [{ id: 1 }], content: "x" })).toBeNull();
    expect(catatanAksesTerbatas({ work, pasal: [], content_note: "x" })).toBeNull();
    expect(catatanAksesTerbatas({ work })).toBeNull();
    // Daftar `/laws` membawa content/content_note yang sama, tetapi bukan jawaban detail.
    expect(catatanAksesTerbatas({ total: 9, laws: [], content: "not_available_via_api", content_note: "x" })).toBeNull();
    expect(catatanAksesTerbatas(null)).toBeNull();
    expect(catatanAksesTerbatas([])).toBeNull();
    expect(catatanAksesTerbatas("teks")).toBeNull();
  });

  it("catatan dipotong 500 huruf", () => {
    expect(catatanAksesTerbatas({ work, content_note: "x".repeat(900) })).toHaveLength(500);
  });

  it("adaSimpulPasal: sedikitnya satu simpul di articles atau pasal", () => {
    expect(adaSimpulPasal({ articles: [{ id: 1 }] })).toBe(true);
    expect(adaSimpulPasal({ pasal: [{ id: 1 }] })).toBe(true);
    expect(adaSimpulPasal({ articles: [] })).toBe(false);
    expect(adaSimpulPasal({ work })).toBe(false);
    expect(adaSimpulPasal({ articles: "ada" })).toBe(false);
    expect(adaSimpulPasal(null)).toBe(false);
    expect(adaSimpulPasal([{ id: 1 }])).toBe(false);
  });

  it("uraiAkses: nilai rusak atau tak lengkap dibaca sebagai tak ada pembatasan", () => {
    expect(uraiAkses(null)).toBeNull();
    expect(uraiAkses("")).toBeNull();
    expect(uraiAkses("{bukan json")).toBeNull();
    expect(uraiAkses(JSON.stringify({ catatan: "x" }))).toBeNull();
    expect(uraiAkses(JSON.stringify({ sejak: "a", periksa_lagi: "b" }))).toEqual({
      sejak: "a", terakhir: "a", periksa_lagi: "b", catatan: "", pemeriksaan: 1,
    });
  });
});

describe.skipIf(!sqliteAda)("akses isi pasal.id", () => {
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

  const terbatas = (uri: string) => {
    const [, , , , , t, n] = uri.split("/");
    return detailTerbatas(uri.split("/")[4].toUpperCase(), Number(t), Number(n), `Peraturan ${uri}`);
  };
  const penuh = (uri: string, pasalJumlah = 3) => {
    const [, , , , , t, n] = uri.split("/");
    return detailPeraturan(uri.split("/")[4].toUpperCase(), Number(t), Number(n), `Peraturan ${uri}`, pasalJumlah);
  };
  const semuaTerbatas = () => ({ [PEMBANDING]: terbatas(PEMBANDING), [ANTRE_UU]: terbatas(ANTRE_UU), [ANTRE_PP]: terbatas(ANTRE_PP) });
  const semuaPenuh = () => ({ [PEMBANDING]: penuh(PEMBANDING, 5), [ANTRE_UU]: penuh(ANTRE_UU), [ANTRE_PP]: penuh(ANTRE_PP) });
  const log = (job: string) => baris(l, `SELECT status, detail, jumlah FROM sync_log WHERE job = ? ORDER BY id`, job);
  const arsipMentah = () => [...l.r2.objek.keys()].filter((k) => k.startsWith("mentah/"));
  const peraturanAntre = () =>
    baris(l, `SELECT frbr_uri, isi_status, isi_percobaan, isi_arsip FROM laws WHERE frbr_uri IN (?, ?) ORDER BY frbr_uri`, ANTRE_UU, ANTRE_PP);

  /** Pembanding berpasal tersimpan, dan dua peraturan menunggu (UU lebih dulu dari PP menurut giliran). */
  const tanamAntrean = () =>
    sisipkanAntre(l, [
      { uri: PEMBANDING, jenis: "UU", tahun: 2003, status: "lengkap", jumlahPasal: 5 },
      { uri: ANTRE_UU, jenis: "UU", tahun: 2020 },
      { uri: ANTRE_PP, jenis: "PP", tahun: 2021 },
    ]);

  describe("pembatasan menyeluruh", () => {
    it("peraturan yang diminta tak disentuh dan jawabannya tidak diarsipkan; pembatasan dicatat apa adanya dengan jeda tiga puluh menit", async () => {
      await tanamAntrean();
      pasal = pasangPasalPalsu({ detail: semuaTerbatas() });

      // Pemeriksaan awal: keadaan akses belum diketahui padahal ada yang menunggu, jadi pembanding diminta lebih dulu dan,
      // karena terbatas juga, peraturan di antrean sama sekali tak diminta.
      const laporan = await tik(l, menit(0));
      expect(laporan.isi).toMatchObject({ diambil: 0, lengkap: 0, kosong: 0, gagal: 0 });
      expect(laporan.aksesDijeda).toBe(iso(menit(0) + JEDA_PERIKSA_MS));
      expect(pasal.detailDiminta()).toEqual([PEMBANDING]);
      expect(await bacaAkses(l.env.DB)).toEqual({
        sejak: iso(menit(0)), terakhir: iso(menit(0)), periksa_lagi: iso(menit(0) + JEDA_PERIKSA_MS), catatan: CATATAN, pemeriksaan: 1,
      });
      expect(await peraturanAntre()).toEqual([
        { frbr_uri: ANTRE_PP, isi_status: "menunggu", isi_percobaan: 0, isi_arsip: 0 },
        { frbr_uri: ANTRE_UU, isi_status: "menunggu", isi_percobaan: 0, isi_arsip: 0 },
      ]);
      expect(arsipMentah()).toEqual([]);
      expect(await hitungBaris(l, "articles")).toBe(0);
    });

    it("dicatat ke log (sekali per setengah jam) dan statistik harian", async () => {
      await tanamAntrean();
      pasal = pasangPasalPalsu({ detail: semuaTerbatas() });
      await tik(l, menit(0));
      expect(await log("akses_isi")).toEqual([
        { status: "gagal", detail: expect.stringContaining(`pasal.id tidak memberi naskah peraturan (${CATATAN})`), jumlah: 0 },
      ]);
      const stat = await satu<{ value: string }>(l, `SELECT value FROM sync_state WHERE key = 'statistik:2026-10-11'`);
      expect(JSON.parse(stat!.value)).toMatchObject({ akses_terbatas: 1 });
      expect(JSON.parse(stat!.value).kosong).toBeUndefined();
    });

    it("selama dijeda tak ada permintaan detail dan tik sepi tanpa menulis apa pun; laporannya menyebut kapan diperiksa lagi", async () => {
      await tanamAntrean();
      pasal = pasangPasalPalsu({ detail: semuaTerbatas() });
      await tik(l, menit(0));
      const sebelum = await baris(l, `SELECT key, value, updated_at FROM sync_state ORDER BY key`);
      const panggilan = pasal.panggilan.length;

      for (const m of [1, 10, 29]) {
        expect(await tik(l, menit(m))).toEqual({ aksesDijeda: iso(menit(0) + JEDA_PERIKSA_MS), dilewati: "sepi" });
      }
      expect(pasal.panggilan.length).toBe(panggilan);
      expect(await baris(l, `SELECT key, value, updated_at FROM sync_state ORDER BY key`)).toEqual(sebelum);
    });

    it("katalog jalan terus selama detail dijeda, dan peraturan baru dari katalog menunggu di antrean", async () => {
      await tanamAntrean();
      pasal = pasangPasalPalsu({ detail: semuaTerbatas(), daftar: { UU: [itemDaftar("UU", 2024, 5, "Baru", { verifikasi: true })] } });
      await tik(l, menit(0));
      await l.db.prepare(`DELETE FROM sync_state WHERE key = 'katalog_selesai:UU'`).run();

      const laporan = await tik(l, menit(1));
      expect(laporan.katalog).toEqual([{ jenis: "UU", diperiksa: 1, disimpan: 1, selesai: true }]);
      expect(laporan.isi).toBeUndefined();
      expect(laporan.aksesDijeda).toBe(iso(menit(0) + JEDA_PERIKSA_MS));
      expect(pasal.detailDiminta()).toEqual([PEMBANDING]); // tak bertambah
      expect(await satu(l, `SELECT isi_status FROM laws WHERE frbr_uri = '/akn/id/act/uu/2024/5'`)).toEqual({ isi_status: "menunggu" });
    });

    it("jeda habis tetapi masih terbatas: hanya pembanding yang diminta, keadaan diperbarui (sejak tetap, pemeriksaan naik)", async () => {
      await tanamAntrean();
      pasal = pasangPasalPalsu({ detail: semuaTerbatas() });
      await tik(l, menit(0));

      const laporan = await tik(l, menit(31));
      expect(laporan.isi).toMatchObject({ diambil: 0, aksesTerbatas: CATATAN });
      expect(pasal.detailDiminta().slice(1)).toEqual([PEMBANDING]);
      expect(await bacaAkses(l.env.DB)).toEqual({
        sejak: iso(menit(0)), terakhir: iso(menit(31)), periksa_lagi: iso(menit(31) + JEDA_PERIKSA_MS), catatan: CATATAN, pemeriksaan: 2,
      });
      expect(await peraturanAntre()).toEqual([
        { frbr_uri: ANTRE_PP, isi_status: "menunggu", isi_percobaan: 0, isi_arsip: 0 },
        { frbr_uri: ANTRE_UU, isi_status: "menunggu", isi_percobaan: 0, isi_arsip: 0 },
      ]);
    });
  });

  describe("pemeriksaan awal (keadaan akses belum diketahui)", () => {
    it("tik pertama memeriksa pembanding lebih dulu dan memakai satu dari tiga permintaan; yang terbatas dicatat di log dan statistik", async () => {
      await tanamAntrean();
      await l.db.prepare(`DELETE FROM sync_state WHERE key = 'katalog_selesai:UU'`).run();
      pasal = pasangPasalPalsu({ detail: semuaTerbatas(), daftar: { UU: [itemDaftar("UU", 2024, 5, "Baru")] } });
      const laporan = await tik(l, menit(0));
      expect(pasal.detailDiminta()).toEqual([PEMBANDING]);
      expect(pasal.daftarDiminta()).toEqual([{ jenis: "UU", offset: "0" }]); // katalog tetap jalan
      expect(laporan.aksesDijeda).toBe(iso(menit(0) + JEDA_PERIKSA_MS));
      expect(await bacaAkses(l.env.DB)).toMatchObject({ catatan: CATATAN, pemeriksaan: 1 });
      expect(await log("akses_isi")).toEqual([{ status: "gagal", detail: expect.stringContaining(CATATAN), jumlah: 0 }]);
      expect(JSON.parse((await satu<{ value: string }>(l, `SELECT value FROM sync_state WHERE key = 'statistik:2026-10-11'`))!.value)).toMatchObject({ akses_terbatas: 1 });
    });

    it("akses baik: dicatat sebagai diperiksa (memakai satu dari tiga permintaan), tak diperiksa lagi dalam enam jam, dan diperiksa lagi sesudahnya", async () => {
      await tanamAntrean();
      await sisipkanAntre(l, [{ uri: "/akn/id/act/pp/2018/9", jenis: "PP", tahun: 2018 }]); // yang ketiga menunggu: pemeriksaan memakai jatah
      pasal = pasangPasalPalsu({ detail: { ...semuaPenuh(), "/akn/id/act/pp/2018/9": penuh("/akn/id/act/pp/2018/9") } });
      await tik(l, menit(0));
      expect(pasal.detailDiminta()).toEqual([PEMBANDING, ANTRE_UU, ANTRE_PP]);
      expect(await satu(l, `SELECT isi_status FROM laws WHERE frbr_uri = '/akn/id/act/pp/2018/9'`)).toEqual({ isi_status: "menunggu" });
      await tik(l, menit(1)); // tik berikutnya mengambil yang tersisa, tanpa pemeriksaan awal lagi
      expect(pasal.detailDiminta().slice(3)).toEqual(["/akn/id/act/pp/2018/9"]);
      expect(await bacaAkses(l.env.DB)).toBeNull();
      expect(await satu<{ value: string }>(l, `SELECT value FROM sync_state WHERE key = 'akses_diperiksa'`)).toEqual({ value: iso(menit(0)) });

      // Antrean berikut: tak ada pemeriksaan awal dalam enam jam, jadi ketiga permintaan untuk peraturan di antrean.
      await sisipkanAntre(l, [
        { uri: "/akn/id/act/uu/2019/1", jenis: "UU", tahun: 2019 }, { uri: "/akn/id/act/uu/2019/2", jenis: "UU", tahun: 2019 },
        { uri: "/akn/id/act/uu/2019/3", jenis: "UU", tahun: 2019 }, { uri: "/akn/id/act/uu/2019/4", jenis: "UU", tahun: 2019 },
      ]);
      pasal.atur({ detail: { ...semuaPenuh(), ...Object.fromEntries([1, 2, 3, 4].map((n) => [`/akn/id/act/uu/2019/${n}`, penuh(`/akn/id/act/uu/2019/${n}`)])) } });
      await tik(l, menit(60));
      expect(pasal.detailDiminta().slice(4)).toEqual(["/akn/id/act/uu/2019/1", "/akn/id/act/uu/2019/2", "/akn/id/act/uu/2019/3"]);
      await tik(l, menit(6 * 60 + 1)); // lewat enam jam: pemeriksaan awal lagi (pembanding diundi), lalu satu peraturan tersisa
      const ketiga = pasal.detailDiminta().slice(7);
      expect(ketiga).toHaveLength(2);
      expect(ketiga[1]).toBe("/akn/id/act/uu/2019/4");
      expect(await satu<{ value: string }>(l, `SELECT value FROM sync_state WHERE key = 'akses_diperiksa'`)).toEqual({ value: iso(menit(6 * 60 + 1)) });
    });

    it("tanpa peraturan menunggu, tanpa pembanding, atau saat akses sudah tercatat: tak ada pemeriksaan awal", async () => {
      // Tanpa peraturan menunggu: sepi.
      await sisipkanAntre(l, [{ uri: PEMBANDING, jenis: "UU", tahun: 2003, status: "lengkap", jumlahPasal: 5 }]);
      pasal = pasangPasalPalsu({ detail: semuaPenuh() });
      expect(await tik(l, menit(0))).toEqual({ dilewati: "sepi" });
      expect(pasal.panggilan).toEqual([]);
    });

    it("tanpa pembanding tersimpan: tak ada yang bisa diperiksa, dan tak ada yang dicatat", async () => {
      await sisipkanAntre(l, [{ uri: ANTRE_UU, jenis: "UU", tahun: 2020 }]);
      pasal = pasangPasalPalsu({ detail: { [ANTRE_UU]: penuh(ANTRE_UU) } });
      await tik(l, menit(0));
      expect(await satu(l, `SELECT value FROM sync_state WHERE key = 'akses_diperiksa'`)).toBeNull();
      expect(pasal.detailDiminta()).toEqual([ANTRE_UU]); // langsung diambil
    });

    it("akses sudah tercatat dan jedanya habis: satu pemeriksaan saja (pembanding), bukan pemeriksaan awal ditambah pemeriksaan jeda", async () => {
      await tanamAntrean();
      await tandaiAksesTerbatas(l.env.DB, CATATAN, menit(0)); // tercatat tanpa lewat pemeriksaan awal (tak ada akses_diperiksa)
      pasal = pasangPasalPalsu({ detail: semuaTerbatas() });
      await tik(l, menit(31));
      expect(pasal.detailDiminta()).toEqual([PEMBANDING]);
      expect(await bacaAkses(l.env.DB)).toMatchObject({ pemeriksaan: 2 });
    });

    it("kena 429 pada pemeriksaan awal: jeda disimpan dan tak ada yang dicatat; sesudah jeda diperiksa lagi", async () => {
      await tanamAntrean();
      pasal = pasangPasalPalsu({ detail: semuaTerbatas(), batasLaju: () => true });
      const kena = await tik(l, menit(0));
      expect(kena.jedaPasalSampai).toBe(iso(menit(0) + 120_000));
      expect(await bacaAkses(l.env.DB)).toBeNull();
      expect(await satu(l, `SELECT value FROM sync_state WHERE key = 'akses_diperiksa'`)).toBeNull();
      pasal.atur({ batasLaju: undefined });
      await tik(l, menit(3));
      expect(await bacaAkses(l.env.DB)).not.toBeNull();
    });
  });

  describe("pemulihan", () => {
    it("jeda habis dan pembanding kembali berpasal: keadaan dihapus dan antrean langsung dilanjutkan di tik yang sama", async () => {
      await tanamAntrean();
      pasal = pasangPasalPalsu({ detail: semuaTerbatas() });
      await tik(l, menit(0));

      pasal.atur({ detail: semuaPenuh() });
      const laporan = await tik(l, menit(31));
      expect(laporan.isi).toMatchObject({ aksesPulih: true, diambil: 2, lengkap: 2 });
      expect(laporan.isi?.aksesTerbatas).toBeUndefined();
      expect(await bacaAkses(l.env.DB)).toBeNull();
      expect(pasal.detailDiminta().slice(1)).toEqual([PEMBANDING, ANTRE_UU, ANTRE_PP]);
      expect(await peraturanAntre()).toEqual([
        { frbr_uri: ANTRE_PP, isi_status: "lengkap", isi_percobaan: 0, isi_arsip: 1 },
        { frbr_uri: ANTRE_UU, isi_status: "lengkap", isi_percobaan: 0, isi_arsip: 1 },
      ]);
      expect(arsipMentah().sort()).toEqual(["mentah/akn/id/act/pp/2021/35.json.gz", "mentah/akn/id/act/uu/2020/11.json.gz"]);
      expect(await log("akses_isi")).toEqual([
        expect.objectContaining({ status: "gagal" }),
        { status: "sukses", detail: expect.stringContaining("kembali memberi naskah"), jumlah: 0 },
      ]);
    });

    it("permintaan pembanding memakai jatah tik: dari tiga permintaan, dua peraturan diambil dan sisanya menunggu", async () => {
      const ANTRE_3 = "/akn/id/act/pp/2019/70";
      await tanamAntrean();
      await sisipkanAntre(l, [{ uri: ANTRE_3, jenis: "PP", tahun: 2019 }]);
      pasal = pasangPasalPalsu({ detail: { ...semuaTerbatas(), [ANTRE_3]: terbatas(ANTRE_3) } });
      await tik(l, menit(0));

      pasal.atur({ detail: { ...semuaPenuh(), [ANTRE_3]: penuh(ANTRE_3) } });
      const laporan = await tik(l, menit(31));
      expect(laporan.isi).toMatchObject({ aksesPulih: true, diambil: 2, lengkap: 2 });
      expect(pasal.detailDiminta().slice(1)).toEqual([PEMBANDING, ANTRE_UU, ANTRE_PP]); // MAKS_PANGGILAN_PASAL = 3
      expect(await satu(l, `SELECT isi_status FROM laws WHERE frbr_uri = ?`, ANTRE_3)).toEqual({ isi_status: "menunggu" });
    });

    it("tanpa pembanding, peraturan terdepan yang berpasal membuktikan pulihnya akses", async () => {
      await sisipkanAntre(l, [{ uri: ANTRE_UU, jenis: "UU", tahun: 2020 }]);
      pasal = pasangPasalPalsu({ detail: { [ANTRE_UU]: terbatas(ANTRE_UU) } });
      await tik(l, menit(0));
      expect(pasal.detailDiminta()).toEqual([ANTRE_UU]); // tak ada pembanding untuk diminta
      expect(await bacaAkses(l.env.DB)).toMatchObject({ sejak: iso(menit(0)), pemeriksaan: 1 });
      expect(await satu(l, `SELECT isi_status, isi_percobaan FROM laws`)).toEqual({ isi_status: "menunggu", isi_percobaan: 0 });

      pasal.atur({ detail: { [ANTRE_UU]: penuh(ANTRE_UU) } });
      const laporan = await tik(l, menit(31));
      expect(laporan.isi).toMatchObject({ aksesPulih: true, diambil: 1, lengkap: 1 });
      expect(await bacaAkses(l.env.DB)).toBeNull();
      expect(await satu(l, `SELECT isi_status, jumlah_pasal FROM laws`)).toEqual({ isi_status: "lengkap", jumlah_pasal: 4 });
    });

    it("sesudah pulih, peraturan yang memang tanpa naskah menjadi 'kosong' dan yang lain tetap dikerjakan dalam tik yang sama", async () => {
      await tanamAntrean();
      pasal = pasangPasalPalsu({ detail: semuaTerbatas() });
      await tik(l, menit(0));
      pasal.atur({ detail: { ...semuaPenuh(), [ANTRE_UU]: terbatas(ANTRE_UU) } });

      const laporan = await tik(l, menit(31));
      expect(laporan.isi).toMatchObject({ aksesPulih: true, diambil: 2, lengkap: 1, kosong: 1 });
      expect(await peraturanAntre()).toEqual([
        { frbr_uri: ANTRE_PP, isi_status: "lengkap", isi_percobaan: 0, isi_arsip: 1 },
        { frbr_uri: ANTRE_UU, isi_status: "kosong", isi_percobaan: 0, isi_arsip: 0 },
      ]);
    });
  });

  describe("peraturan yang memang tanpa naskah", () => {
    it("pembanding berpasal berarti akses baik: peraturan itu 'kosong' dengan catatan sumber, tanpa arsip dan tanpa keadaan akses", async () => {
      await sisipkanAntre(l, [
        { uri: PEMBANDING, jenis: "UU", tahun: 2003, status: "lengkap", jumlahPasal: 5 },
        { uri: ANTRE_UU, jenis: "UU", tahun: 2020, verifikasi: false },
      ]);
      pasal = pasangPasalPalsu({ detail: { [PEMBANDING]: penuh(PEMBANDING, 5), [ANTRE_UU]: terbatas(ANTRE_UU) } });

      const laporan = await tik(l, menit(0));
      expect(laporan.isi).toMatchObject({ diambil: 1, kosong: 1, lengkap: 0 });
      expect(laporan.isi?.aksesTerbatas).toBeUndefined();
      // Pemeriksaan awal (pembanding), peraturan di antrean (jawaban tanpa naskah), lalu pembanding lagi untuk membedakan.
      expect(pasal.detailDiminta()).toEqual([PEMBANDING, ANTRE_UU, PEMBANDING]);
      expect(await bacaAkses(l.env.DB)).toBeNull();
      expect(await satu(l, `SELECT isi_status, jumlah_pasal, isi_arsip, isi_catatan FROM laws WHERE frbr_uri = ?`, ANTRE_UU)).toEqual({
        isi_status: "kosong", jumlah_pasal: 0, isi_arsip: 0, isi_catatan: `0 simpul; 0 berisi; 0 yatim [${CATATAN}]`,
      });
      expect(arsipMentah()).toEqual([]);
      expect(await tik(l, menit(1))).toEqual({ dilewati: "sepi" });
    });

    it("articles kosong (bukan jawaban terbatas) tetap peraturan tanpa pasal, tanpa pembanding dan tanpa keadaan akses", async () => {
      await sisipkanAntre(l, [{ uri: ANTRE_UU, jenis: "UU", tahun: 2020 }]);
      pasal = pasangPasalPalsu({ detail: { [ANTRE_UU]: { ...penuh(ANTRE_UU), articles: [] } } });
      const laporan = await tik(l, menit(0));
      expect(laporan.isi).toMatchObject({ diambil: 1, kosong: 1 });
      expect(pasal.detailDiminta()).toEqual([ANTRE_UU]);
      expect(await bacaAkses(l.env.DB)).toBeNull();
      expect(arsipMentah()).toEqual([]);
    });
  });

  describe("galat saat memeriksa", () => {
    it("pembanding kena 429: jeda pasal.id disimpan tik, keadaan akses tak berubah, dan pemeriksaan diulang sesudah jeda", async () => {
      await tanamAntrean();
      pasal = pasangPasalPalsu({ detail: semuaTerbatas() });
      await tik(l, menit(0));
      const sebelum = await bacaAkses(l.env.DB);

      pasal.atur({ batasLaju: () => true });
      const laporan = await tik(l, menit(31));
      expect(laporan.isi).toMatchObject({ tundaMs: 120_000, diambil: 0 });
      expect(laporan.jedaPasalSampai).toBe(iso(menit(31) + 120_000));
      expect(await bacaAkses(l.env.DB)).toEqual(sebelum);

      pasal.atur({ batasLaju: undefined });
      expect(await tik(l, menit(32))).toEqual({ dilewati: "sepi" }); // pasal.id masih dijeda dua menit
      const sesudah = await tik(l, menit(34));
      expect(sesudah.isi).toMatchObject({ aksesTerbatas: CATATAN });
      expect(await bacaAkses(l.env.DB)).toMatchObject({ pemeriksaan: 2, terakhir: iso(menit(34)) });
    });

    it("pembanding yang hilang di sumber (404) tak mengunci pemeriksaan: pembanding diundi, jadi yang lain akhirnya dicoba", async () => {
      const PEMBANDING_2 = "/akn/id/act/uu/2004/1";
      await tanamAntrean();
      await sisipkanAntre(l, [{ uri: PEMBANDING_2, jenis: "UU", tahun: 2004, status: "lengkap", jumlahPasal: 5 }]);
      pasal = pasangPasalPalsu({ detail: { ...semuaTerbatas(), [PEMBANDING_2]: terbatas(PEMBANDING_2) } });
      await tik(l, menit(0));
      expect(await bacaAkses(l.env.DB)).not.toBeNull();

      // PEMBANDING hilang di sumber (tak ada di detail), PEMBANDING_2 kembali berpasal: dari undian ke undian, pemeriksaan
      // yang kebetulan memilih yang hilang ditunda sepuluh menit, dan yang memilih PEMBANDING_2 memulihkan akses.
      pasal.atur({ detail: { [ANTRE_UU]: penuh(ANTRE_UU), [ANTRE_PP]: penuh(ANTRE_PP), [PEMBANDING_2]: penuh(PEMBANDING_2, 5) } });
      let pulih = false;
      for (let i = 0; i < 40 && !pulih; i++) pulih = Boolean((await tik(l, menit(31 + 11 * i))).isi?.aksesPulih);
      expect(pulih).toBe(true);
      expect(await bacaAkses(l.env.DB)).toBeNull();
    });

    it("pembanding gagal 5xx: pemeriksaan ditunda sepuluh menit dan tak ada peraturan yang dihukum", async () => {
      await tanamAntrean();
      pasal = pasangPasalPalsu({ detail: semuaTerbatas() });
      await tik(l, menit(0));

      pasal.atur({ galat: () => 500 });
      const laporan = await tik(l, menit(31));
      expect(laporan.isi).toMatchObject({ diambil: 0, gagal: 0 });
      expect(await bacaAkses(l.env.DB)).toMatchObject({
        sejak: iso(menit(0)), pemeriksaan: 1, periksa_lagi: iso(menit(31) + JEDA_PERIKSA_GALAT_MS),
      });
      expect(await peraturanAntre()).toEqual([
        { frbr_uri: ANTRE_PP, isi_status: "menunggu", isi_percobaan: 0, isi_arsip: 0 },
        { frbr_uri: ANTRE_UU, isi_status: "menunggu", isi_percobaan: 0, isi_arsip: 0 },
      ]);
    });
  });

  describe("diagnosis dari pengambilan nyata", () => {
    it("delapan peraturan pertama yang berisi naskah meninggalkan ringkasan struktur responsnya; yang terbatas tidak", async () => {
      const uris = Array.from({ length: 10 }, (_, i) => `/akn/id/act/uu/${2010 + i}/${i + 1}`);
      await sisipkanAntre(l, uris.map((uri, i) => ({ uri, jenis: "UU", tahun: 2010 + i })));
      pasal = pasangPasalPalsu({ detail: Object.fromEntries(uris.map((u) => [u, penuh(u)])) });
      for (let i = 0; i < 4; i++) await tik(l, menit(i)); // tiga permintaan per tik: sepuluh peraturan

      const baru = await baris<{ key: string; value: string }>(l, `SELECT key, value FROM sync_state WHERE key LIKE 'diagisi:%' ORDER BY key`);
      expect(baru).toHaveLength(8);
      expect(JSON.parse(baru[0].value)).toMatchObject({ uri: expect.stringContaining("/akn/id/act/uu/"), ringkasan: { pasal: { total: 3 } } });
      // Awalannya bukan "diag:", jadi tak terhitung sebagai pemeriksaan yang masih harus dikerjakan.
      expect(await hitungBaris(l, "sync_state", "key LIKE 'diag:%'")).toBe(PEMERIKSAAN.length);
      expect(await hitungBaris(l, "laws", "isi_status = 'lengkap'")).toBe(10);
    });

    it("jawaban terbatas tidak meninggalkan ringkasan", async () => {
      await tanamAntrean();
      pasal = pasangPasalPalsu({ detail: semuaTerbatas() });
      await tik(l, menit(0));
      expect(await hitungBaris(l, "sync_state", "key LIKE 'diagisi:%'")).toBe(0);
    });
  });

  describe("GET /api/stats", () => {
    it("isi.akses memuat pembatasan yang sedang berlaku dan null bila akses baik", async () => {
      const sebelum = await json<{ isi: { akses: unknown } }>(await panggil(l, "/api/stats"));
      expect(sebelum.isi.akses).toBeNull();

      await tanamAntrean();
      pasal = pasangPasalPalsu({ detail: semuaTerbatas() });
      await tik(l, menit(0));
      const b = await json<{ isi: { akses: unknown } }>(await panggil(l, "/api/stats"));
      expect(b.isi.akses).toEqual({
        sejak: iso(menit(0)), terakhir: iso(menit(0)), periksa_lagi: iso(menit(0) + JEDA_PERIKSA_MS), catatan: CATATAN,
      });
    });
  });

  describe("GET /api/stats: peraturan berisi", () => {
    it("berisi menghitung peraturan yang punya pasal tersimpan apa pun statusnya, termasuk yang diantrekan ulang untuk diperbaiki", async () => {
      await sisipkanAntre(l, [
        { uri: PEMBANDING, jenis: "UU", tahun: 2003, status: "lengkap", jumlahPasal: 5 },
        { uri: ANTRE_UU, jenis: "UU", tahun: 2020, status: "menunggu", jumlahPasal: 3 }, // diantrekan ulang: teks sebagian tetap ada
        { uri: ANTRE_PP, jenis: "PP", tahun: 2021, status: "menunggu" },
      ]);
      const b = await json<{ isi: { per_jenis: Record<string, Record<string, number>> } }>(await panggil(l, "/api/stats"));
      expect(b.isi.per_jenis.UU).toMatchObject({ total: 2, berisi: 2, lengkap: 1, menunggu: 1, pasal: 8 });
      expect(b.isi.per_jenis.PP).toMatchObject({ total: 1, berisi: 0, lengkap: 0, menunggu: 1 });
    });
  });

  describe("POST /api/admin/sync {uri}", () => {
    const sync = (badan: unknown) => panggil(l, "/api/admin/sync", kirim("POST", badan, adm));
    const URI_BARU = "/akn/id/act/uu/1999/8";

    it("peraturan yang belum ada di D1 dan dijawab terbatas: 503 akses_terbatas, tak ada yang tersimpan", async () => {
      pasal = pasangPasalPalsu({ detail: { [URI_BARU]: terbatas(URI_BARU) } });
      const res = await sync({ uri: URI_BARU });
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ error: "akses_terbatas", catatan: CATATAN });
      expect(await hitungBaris(l, "laws")).toBe(0);
      expect(arsipMentah()).toEqual([]);
    });

    it("404 dari pasal.id menjadi 404, dan 429 menjadi 429 dengan jeda; bukan 500", async () => {
      pasal = pasangPasalPalsu({ detail: {} });
      const tidakAda = await sync({ uri: URI_BARU });
      expect(tidakAda.status).toBe(404);
      expect(await tidakAda.json()).toMatchObject({ error: "pasal_galat", status_pasal: 404 });

      pasal.atur({ batasLaju: () => true });
      const laju = await sync({ uri: URI_BARU });
      expect(laju.status).toBe(429);
      expect(await laju.json()).toMatchObject({ error: "pasal_batas_laju", coba_lagi_dalam_ms: 120_000 });
    });
  });
});
