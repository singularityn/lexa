/**
 * POST /api/impor/tautan: entri daftar BPK -> peraturan Lexa (bpk_id dan alamat rincian), dan hubungannya dengan daftar
 * kerja GET /api/impor/butuh-teks. Data uji meniru keadaan produksi yang membuat pencocokan sitasi perlu normalisasi:
 * nomor "01" dan "1", "perpu" dan "perppu", Tap MPR yang tiga baris untuk satu ketetapan.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buatLingkungan, json, kirim, panggil, sisipkan, sqliteAda, TOKEN_ADMIN, type Lingkungan, type PeraturanUji } from "./harness";
import type { HasilTautan, RingkasTautan } from "../../src/worker/lib/tautanBpk";

const adm = { "x-admin-token": TOKEN_ADMIN };
const BPK = "https://peraturan.bpk.go.id";

const pp = (nomor: string, tahun = 2021, ubah: Partial<PeraturanUji> = {}): PeraturanUji => ({
  uri: `/akn/id/act/pp/${tahun}/${nomor}`, jenis: "PP", nomor, tahun, judul: `Peraturan Pemerintah Nomor ${nomor} Tahun ${tahun} tentang Contoh`, ...ubah,
});

interface Jawaban { ringkas: RingkasTautan; hasil: HasilTautan[] }

describe.skipIf(!sqliteAda)("POST /api/impor/tautan", () => {
  let l: Lingkungan;
  beforeEach(() => {
    l = buatLingkungan();
  });
  afterEach(() => l.tutup());

  const tautan = async (daftar: unknown[], buat = false) => json<Jawaban>(await panggil(l, "/api/impor/tautan", kirim("POST", { tautan: daftar, buat }, adm)));
  const baris = (uri: string) => l.db.prepare(`SELECT bpk_id, sumber_url FROM laws WHERE frbr_uri = ?`).bind(uri).first<{ bpk_id: string | null; sumber_url: string | null }>();
  const jumlahLaws = async () => (await l.db.prepare(`SELECT COUNT(*) AS n FROM laws`).first<{ n: number }>())?.n;

  describe("akses dan bentuk permintaan", () => {
    it("tanpa token -> 401", async () => {
      const res = await panggil(l, "/api/impor/tautan", kirim("POST", { tautan: [{ url: "/Details/1/pp-no-5-tahun-2021" }] }));
      expect(res.status).toBe(401);
    });

    it("badan kosong -> 400; lebih dari 200 entri -> 413", async () => {
      const kosong = await panggil(l, "/api/impor/tautan", kirim("POST", { tautan: [] }, adm));
      expect(kosong.status).toBe(400);
      expect(await kosong.json()).toMatchObject({ error: "tautan_kosong" });
      const tanpaBadan = await panggil(l, "/api/impor/tautan", { method: "POST", headers: adm, body: "bukan json" });
      expect(tanpaBadan.status).toBe(400);
      const besar = await panggil(l, "/api/impor/tautan", kirim("POST", { tautan: Array.from({ length: 201 }, (_, i) => ({ bpk_id: i + 1, teks: "PP No. 1 Tahun 2020" })) }, adm));
      expect(besar.status).toBe(413);
      expect(await besar.json()).toMatchObject({ error: "tautan_terlalu_banyak" });
    });

    it("CORS: origin BPK diizinkan mengirim", async () => {
      const res = await panggil(l, "/api/impor/tautan", kirim("POST", { tautan: [{ url: "/Details/1/pp-no-5-tahun-2021" }] }, { ...adm, origin: BPK }));
      expect(res.headers.get("access-control-allow-origin")).toBe(BPK);
    });
  });

  describe("menautkan", () => {
    it("peraturan yang cocok menurut slug mendapat bpk_id dan alamat rincian (dibangun dari id dan slug, bukan disalin)", async () => {
      await sisipkan(l, [pp("5")]);
      const b = await tautan([{ url: "https://peraturan.bpk.go.id/Details/1234/pp-no-5-tahun-2021?x=1", teks: "PP No. 5 Tahun 2021" }]);
      expect(b.ringkas).toMatchObject({ ditautkan: 1, sudah: 0, tidak_ada: 0 });
      expect(b.hasil).toEqual([{ bpk_id: "1234", status: "ditautkan", uri: "/akn/id/act/pp/2021/5", uris: ["/akn/id/act/pp/2021/5"], sitasi: "PP 5/2021" }]);
      expect(await baris("/akn/id/act/pp/2021/5")).toEqual({ bpk_id: "1234", sumber_url: `${BPK}/Details/1234/pp-no-5-tahun-2021` });
    });

    it("alamat peraturan.go.id atau pasal.id diganti alamat BPK; alamat BPK yang sudah ada dipertahankan", async () => {
      await sisipkan(l, [pp("5"), pp("6")]);
      await l.db.prepare(`UPDATE laws SET sumber_url = 'https://peraturan.go.id/id/pp-5-2021' WHERE frbr_uri = '/akn/id/act/pp/2021/5'`).run();
      await l.db.prepare(`UPDATE laws SET sumber_url = ? WHERE frbr_uri = '/akn/id/act/pp/2021/6'`).bind(`${BPK}/Details/77/pp-no-6-tahun-2021`).run();
      await tautan([{ url: "/Details/1/pp-no-5-tahun-2021" }, { url: "/Details/77/pp-no-6-tahun-2021" }]);
      expect((await baris("/akn/id/act/pp/2021/5"))?.sumber_url).toBe(`${BPK}/Details/1/pp-no-5-tahun-2021`);
      expect((await baris("/akn/id/act/pp/2021/6"))?.sumber_url).toBe(`${BPK}/Details/77/pp-no-6-tahun-2021`);
    });

    it("tidak mengubah metadata lain (judul, status, jumlah pasal)", async () => {
      await sisipkan(l, [pp("5", 2021, { status: "dicabut", pasal: [{ nomor: "1", isi: "Isi." }] })]);
      const sebelum = await l.db.prepare(`SELECT judul, status, jumlah_pasal, tentang, bidang FROM laws`).first();
      await tautan([{ url: "/Details/1/pp-no-5-tahun-2021" }]);
      expect(await l.db.prepare(`SELECT judul, status, jumlah_pasal, tentang, bidang FROM laws`).first()).toEqual(sebelum);
    });

    it("kiriman ulang: sudah tertaut; dokumen BPK lain untuk peraturan yang sama: bentrok dan tak menimpa", async () => {
      await sisipkan(l, [pp("5")]);
      await tautan([{ url: "/Details/1/pp-no-5-tahun-2021" }]);
      const ulang = await tautan([{ url: "/Details/1/pp-no-5-tahun-2021" }]);
      expect(ulang.hasil[0]).toMatchObject({ status: "sudah", uri: "/akn/id/act/pp/2021/5" });
      const lain = await tautan([{ url: "/Details/2/pp-no-5-tahun-2021" }]);
      expect(lain.hasil[0]).toMatchObject({ status: "bentrok", alasan: "peraturan ini sudah tertaut ke dokumen BPK 1" });
      expect((await baris("/akn/id/act/pp/2021/5"))?.bpk_id).toBe("1");
    });

    it("dua entri dalam satu permintaan untuk peraturan yang sama: yang pertama menang, yang kedua bentrok", async () => {
      await sisipkan(l, [pp("5")]);
      const b = await tautan([{ url: "/Details/1/pp-no-5-tahun-2021" }, { url: "/Details/2/pp-no-5-tahun-2021" }]);
      expect(b.hasil.map((h) => h.status)).toEqual(["ditautkan", "bentrok"]);
      expect((await baris("/akn/id/act/pp/2021/5"))?.bpk_id).toBe("1");
    });

    it("peraturan yang sudah berpasal pun ditautkan (tautan 'naskah resmi' di halaman bacanya)", async () => {
      await sisipkan(l, [pp("5", 2021, { pasal: [{ nomor: "1", isi: "Isi." }] })]);
      const b = await tautan([{ url: "/Details/1/pp-no-5-tahun-2021" }]);
      expect(b.hasil[0].status).toBe("ditautkan");
      const detail = await json<{ bpk_url: string | null }>(await panggil(l, `/api/dokumen/status?uri=${encodeURIComponent("/akn/id/act/pp/2021/5")}`));
      expect(detail.bpk_url).toBe(`${BPK}/Details/1`);
    });
  });

  describe("pencocokan sitasi lintas penulisan", () => {
    it("duplikat data ('01' dan '1') sama-sama tertaut: satu peraturan", async () => {
      await sisipkan(l, [pp("01", 2022), pp("1", 2022, { pasal: [{ nomor: "1", isi: "Isi." }] })]);
      const b = await tautan([{ url: "/Details/9/pp-no-1-tahun-2022" }]);
      expect(b.hasil[0]).toMatchObject({ status: "ditautkan", uri: "/akn/id/act/pp/2022/1" }); // yang berpasal jadi utama
      expect(b.hasil[0].uris?.sort()).toEqual(["/akn/id/act/pp/2022/01", "/akn/id/act/pp/2022/1"]);
      expect((await baris("/akn/id/act/pp/2022/01"))?.bpk_id).toBe("9");
      expect((await baris("/akn/id/act/pp/2022/1"))?.bpk_id).toBe("9");
    });

    it("Perppu: slug 'perppu' menemukan baris yang URI-nya memakai 'perpu' (indeks unik tak memeriksa URI)", async () => {
      await sisipkan(l, [{ uri: "/akn/id/act/perpu/2022/2", jenis: "PERPPU", nomor: "2", tahun: 2022, judul: "Peraturan Pemerintah Pengganti Undang-Undang Nomor 2 Tahun 2022 tentang Cipta Kerja" }]);
      const b = await tautan([{ url: "/Details/234926/perppu-no-2-tahun-2022" }]);
      expect(b.hasil[0]).toMatchObject({ status: "ditautkan", uri: "/akn/id/act/perpu/2022/2" });
      expect(await jumlahLaws()).toBe(1);
    });

    it("Tap MPR: tiga baris untuk satu ketetapan, semuanya tertaut ke dokumen BPK yang sama", async () => {
      const tap = (uri: string, nomor: string, ubah: Partial<PeraturanUji> = {}): PeraturanUji => ({ uri, jenis: "TAP_MPR", nomor, tahun: 1998, judul: `Ketetapan MPR Nomor ${nomor} Tahun 1998`, ...ubah });
      await sisipkan(l, [
        tap("/akn/id/act/tap-mpr/1998/XVI/MPR/1998", "XVI/MPR/1998", { bpkId: "210109", pasal: [{ nomor: "1", isi: "Isi." }] }),
        tap("/akn/id/act/tap_mpr/1998/XVI-MPR-1998", "XVI-MPR-1998"),
        tap("/akn/id/act/tap-mpr/1998/xvi-mpr-1998", "xvi-mpr-1998"),
        tap("/akn/id/act/tap-mpr/1998/xvii-mpr-1998", "xvii-mpr-1998"), // ketetapan lain di tahun yang sama: tak boleh ikut
      ]);
      const b = await tautan([{ url: `${BPK}/Details/210109/tap-mpr-no-xvimpr1998` }]);
      expect(b.hasil[0].status).toBe("ditautkan");
      expect(b.hasil[0].uris).toHaveLength(3);
      expect(b.hasil[0].uri).toBe("/akn/id/act/tap-mpr/1998/XVI/MPR/1998");
      expect((await baris("/akn/id/act/tap-mpr/1998/xvii-mpr-1998"))?.bpk_id).toBeNull();
      expect((await baris("/akn/id/act/tap_mpr/1998/XVI-MPR-1998"))?.bpk_id).toBe("210109");
    });

    it("Tap MPR yang di BPK hanya bernomor 'I': tahun dari teks kartu, cocok dengan baris 'i-mpr-2003'", async () => {
      await sisipkan(l, [{ uri: "/akn/id/act/tap-mpr/2003/i-mpr-2003", jenis: "TAP_MPR", nomor: "i-mpr-2003", tahun: 2003, judul: "Ketetapan MPR Nomor I/MPR/2003" }]);
      const b = await tautan([{ url: "/Details/95809/tap-mpr-no-i", konteks: "TAP MPR No. I Ketetapan MPR Tahun 2003 Berlaku" }]);
      expect(b.hasil[0]).toMatchObject({ status: "ditautkan", uri: "/akn/id/act/tap-mpr/2003/i-mpr-2003" });
    });

    it("UUD 1945 dan Amandemen ditautkan ke naskah asli saja, bukan ke keempat perubahannya", async () => {
      const uud = (uri: string, nomor: string): PeraturanUji => ({ uri, jenis: "UUD", nomor, tahun: 1945, judul: `UUD 1945 ${nomor}` });
      await sisipkan(l, [uud("/akn/id/act/uud/1945/original", "1945"), uud("/akn/id/act/uud/1945/perubahan-1", "1945/P1"), uud("/akn/id/act/uud/1945/perubahan-2", "1945/P2")]);
      const b = await tautan([{ url: "/Details/101646/uud-no--", teks: "UUD No. - tentang UUD 1945 dan Amandemen" }]);
      expect(b.hasil[0]).toMatchObject({ status: "ditautkan", uris: ["/akn/id/act/uud/1945/original"] });
      expect((await baris("/akn/id/act/uud/1945/perubahan-1"))?.bpk_id).toBeNull();
    });

    it("slug dan teks yang berselisih jenis: data Lexa memutuskan; bila dua-duanya ada di Lexa, hasilnya ambigu dan tak ada yang ditulis", async () => {
      const entri = { url: "/Details/50288/uu-no-7-tahun-1964", teks: "Peraturan Pemerintah Pengganti Undang-Undang (Perpu) No. 7 Tahun 1964" };
      await sisipkan(l, [{ uri: "/akn/id/act/uu/1964/7", jenis: "PERPPU", nomor: "7", tahun: 1964, judul: "Perpu 7/1964" }]);
      expect((await tautan([entri])).hasil[0]).toMatchObject({ status: "ditautkan", uri: "/akn/id/act/uu/1964/7" });

      const l2 = buatLingkungan();
      try {
        await sisipkan(l2, [
          { uri: "/akn/id/act/uu/1964/7", jenis: "UU", nomor: "7", tahun: 1964, judul: "UU 7/1964" },
          { uri: "/akn/id/act/perppu/1964/7", jenis: "PERPPU", nomor: "7", tahun: 1964, judul: "Perpu 7/1964" },
        ]);
        const b = await json<Jawaban>(await panggil(l2, "/api/impor/tautan", kirim("POST", { tautan: [entri] }, adm)));
        expect(b.hasil[0]).toMatchObject({ status: "ambigu", sitasi: "UU 7/1964 / PERPPU 7/1964" });
        expect((await l2.db.prepare(`SELECT COUNT(*) AS n FROM laws WHERE bpk_id IS NOT NULL`).first<{ n: number }>())?.n).toBe(0);
      } finally {
        l2.tutup();
      }
    });
  });

  describe("yang tidak bisa ditautkan", () => {
    it("peraturan yang tak ada di Lexa: tidak_ada, tanpa membuat apa pun", async () => {
      const b = await tautan([{ url: "/Details/5/pp-no-24-tahun-2026", teks: "PP No. 24 Tahun 2026" }]);
      expect(b.hasil[0]).toEqual({ bpk_id: "5", status: "tidak_ada", sitasi: "PP 24/2026" });
      expect(await jumlahLaws()).toBe(0);
    });

    it("di luar cakupan dan tidak dikenali dilaporkan, tidak menggagalkan entri lain", async () => {
      await sisipkan(l, [pp("5")]);
      const b = await tautan([
        { url: "/Details/1/perpres-no-5-tahun-2021", teks: "Perpres No. 5 Tahun 2021" },
        { url: "/Details/2/selengkapnya", teks: "Selengkapnya" },
        { teks: "PP No. 5 Tahun 2021" },
        { url: "https://contoh.example/Details/3/pp-no-5-tahun-2021" },
        "bukan objek",
        { url: "/Details/4/pp-no-5-tahun-2021" },
      ]);
      expect(b.hasil.map((h) => h.status)).toEqual(["luar_cakupan", "tidak_dikenali", "tidak_dikenali", "tidak_dikenali", "tidak_dikenali", "ditautkan"]);
      expect(b.hasil[0].sitasi).toBe("PERPRES 5/2021");
      expect(b.ringkas).toMatchObject({ luar_cakupan: 1, tidak_dikenali: 4, ditautkan: 1 });
    });

    it("pemetaan manual (uri) menautkan tanpa sitasi; uri yang tak ada atau di luar cakupan dilaporkan", async () => {
      await sisipkan(l, [{ uri: "/akn/id/act/uud/1945/perubahan-4", jenis: "UUD", nomor: "1945/P4", tahun: 1945, judul: "UUD 1945 Perubahan Keempat" }]);
      await l.db.prepare(`INSERT INTO laws (frbr_uri, jenis, nomor, tahun, judul) VALUES ('/akn/id/act/perpres/2020/1','PERPRES','1',2020,'Komisi')`).run();
      const b = await tautan([
        { url: "/Details/101646/uud-no--", uri: "/akn/id/act/uud/1945/perubahan-4" },
        { url: "/Details/2/x", uri: "/akn/id/act/uud/1945/tidak-ada" },
        { url: "/Details/3/x", uri: "/akn/id/act/perpres/2020/1" },
      ]);
      expect(b.hasil.map((h) => h.status)).toEqual(["ditautkan", "tidak_ada", "luar_cakupan"]);
      expect((await baris("/akn/id/act/uud/1945/perubahan-4"))?.bpk_id).toBe("101646");
    });

    it("cakupan yang dilebarkan lewat CAKUPAN_JENIS ikut menentukan", async () => {
      l.env.CAKUPAN_JENIS = "UU,PP,PERPRES";
      await l.db.prepare(`INSERT INTO laws (frbr_uri, jenis, nomor, tahun, judul) VALUES ('/akn/id/act/perpres/2021/5','PERPRES','5',2021,'Perpres 5/2021')`).run();
      const b = await tautan([{ url: "/Details/1/perpres-no-5-tahun-2021" }]);
      expect(b.hasil[0].status).toBe("ditautkan");
    });
  });

  describe("membuat baris untuk peraturan yang belum ada (buat: true)", () => {
    it("PP dalam cakupan dibuat dengan judul sementara dari teks tautan, antre pengambilan isi, dan langsung masuk daftar kerja panen", async () => {
      const b = await tautan([{ url: `${BPK}/Details/5/pp-no-24-tahun-2026`, teks: "PP No. 24 Tahun 2026 tentang Tata Kelola Ekspor" }], true);
      expect(b.hasil[0]).toEqual({ bpk_id: "5", status: "dibuat", uri: "/akn/id/act/pp/2026/24", uris: ["/akn/id/act/pp/2026/24"], sitasi: "PP 24/2026" });
      expect(await l.db.prepare(`SELECT jenis, nomor, tahun, judul, status, bpk_id, sumber_url, jumlah_pasal, isi_status, isi_giliran FROM laws`).first()).toEqual({
        jenis: "PP", nomor: "24", tahun: 2026, judul: "PP No. 24 Tahun 2026 tentang Tata Kelola Ekspor", status: "berlaku", bpk_id: "5",
        sumber_url: `${BPK}/Details/5/pp-no-24-tahun-2026`, jumlah_pasal: 0, isi_status: "menunggu", isi_giliran: 200_000_000 + 4 * 10_000_000 + (9999 - 2026) * 1000,
      });
      const kerja = await json<{ daftar: Array<{ frbr_uri: string; detail_url: string }> }>(await panggil(l, "/api/impor/butuh-teks", { headers: adm }));
      expect(kerja.daftar).toEqual([expect.objectContaining({ frbr_uri: "/akn/id/act/pp/2026/24", detail_url: `${BPK}/Details/5/pp-no-24-tahun-2026` })]);
    });

    it("tanpa teks yang memuat tahun, judul dirangkai dari sitasi", async () => {
      await tautan([{ url: "/Details/5/pp-no-24-tahun-2026", teks: "Selengkapnya" }], true);
      expect((await l.db.prepare(`SELECT judul FROM laws`).first<{ judul: string }>())?.judul).toBe("Peraturan Pemerintah Nomor 24 Tahun 2026");
    });

    it("Tap MPR baru ditulis seperti pasal.id: URI dan nomor 'xvi-mpr-1998'", async () => {
      await tautan([{ url: "/Details/210109/tap-mpr-no-xvimpr1998" }], true);
      expect(await l.db.prepare(`SELECT frbr_uri, nomor, tahun FROM laws`).first()).toEqual({ frbr_uri: "/akn/id/act/tap-mpr/1998/xvi-mpr-1998", nomor: "xvi-mpr-1998", tahun: 1998 });
    });

    it("hanya dalam cakupan, hanya yang sitasinya tak meragukan, dan tidak berulang", async () => {
      const b = await tautan([
        { url: "/Details/1/perpres-no-5-tahun-2021" }, // luar cakupan
        { url: "/Details/50288/uu-no-7-tahun-1964", teks: "Peraturan Pemerintah Pengganti Undang-Undang (Perpu) No. 7 Tahun 1964" }, // dua kandidat
        { url: "/Details/2/pp-no-24-tahun-2026" },
        { url: "/Details/3/pp-no-24-tahun-2026" }, // dokumen BPK kedua untuk peraturan yang sama
      ], true);
      expect(b.hasil.map((h) => h.status)).toEqual(["luar_cakupan", "tidak_ada", "dibuat", "sudah"]);
      expect(b.hasil[1].alasan).toBe("sitasi meragukan; tidak dibuat");
      expect(await jumlahLaws()).toBe(1);
    });

    it("tanpa buat: true tidak ada baris yang dibuat", async () => {
      await tautan([{ url: "/Details/2/pp-no-24-tahun-2026" }]);
      expect(await jumlahLaws()).toBe(0);
    });
  });

  describe("kegagalan satu peraturan tak menjatuhkan yang lain", () => {
    it("kendala basis data pada satu baris: statusnya gagal, yang lain tetap tertaut", async () => {
      await sisipkan(l, [pp("5"), pp("6"), pp("7")]);
      l.sqlite.exec(`CREATE TRIGGER uji_gagal BEFORE UPDATE ON laws WHEN new.frbr_uri = '/akn/id/act/pp/2021/6' BEGIN SELECT RAISE(ABORT, 'uji: ditolak'); END`);
      const b = await tautan([{ url: "/Details/1/pp-no-5-tahun-2021" }, { url: "/Details/2/pp-no-6-tahun-2021" }, { url: "/Details/3/pp-no-7-tahun-2021" }]);
      expect(b.hasil.map((h) => h.status)).toEqual(["ditautkan", "gagal", "ditautkan"]);
      expect(b.hasil[1].alasan).toContain("gagal disimpan");
      expect((await baris("/akn/id/act/pp/2021/5"))?.bpk_id).toBe("1");
      expect((await baris("/akn/id/act/pp/2021/6"))?.bpk_id).toBeNull();
      expect((await baris("/akn/id/act/pp/2021/7"))?.bpk_id).toBe("3");
    });
  });

  describe("hubungan dengan daftar kerja dan catatan", () => {
    it("peraturan yang baru tertaut muncul di daftar kerja dengan alamat berslug; yang bertaut didahulukan", async () => {
      await sisipkan(l, [pp("5"), pp("6")]);
      await l.db.prepare(`UPDATE laws SET isi_giliran = 1 WHERE frbr_uri = '/akn/id/act/pp/2021/5'`).run(); // PP 5 lebih dulu menurut giliran
      let kerja = await json<{ daftar: Array<{ frbr_uri: string; detail_url: string | null }>; tanpa_bpk: number }>(await panggil(l, "/api/impor/butuh-teks", { headers: adm }));
      expect(kerja.tanpa_bpk).toBe(2);
      expect(kerja.daftar.map((d) => d.detail_url)).toEqual([null, null]);
      await tautan([{ url: "/Details/66/pp-no-6-tahun-2021" }]);
      kerja = await json(await panggil(l, "/api/impor/butuh-teks", { headers: adm }));
      expect(kerja.tanpa_bpk).toBe(1);
      expect(kerja.daftar.map((d) => [d.frbr_uri, d.detail_url])).toEqual([
        ["/akn/id/act/pp/2021/6", `${BPK}/Details/66/pp-no-6-tahun-2021`],
        ["/akn/id/act/pp/2021/5", null],
      ]);
    });

    it("mencatat ringkasan di sync_log", async () => {
      await sisipkan(l, [pp("5")]);
      await tautan([{ url: "/Details/1/pp-no-5-tahun-2021" }, { url: "/Details/2/pp-no-9-tahun-2021" }]);
      expect((await l.db.prepare(`SELECT job, status, detail, jumlah FROM sync_log WHERE job = 'impor_bpk_tautan'`).first())).toEqual({
        job: "impor_bpk_tautan", status: "sukses", detail: "ditautkan 1, tidak_ada 1", jumlah: 1,
      });
    });
  });
});
