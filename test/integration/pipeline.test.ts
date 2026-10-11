/**
 * Pipeline data dari impor BPK: manifest -> PDF -> antrean -> ekstraksi PDF -> pengindeksan -> ringkasan.
 * Sinkronisasi dari pasal.id (katalog, isi, tik, rantai antrean) diuji di katalog.test.ts, isi.test.ts, tik.test.ts,
 * dan antrean.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buatLingkungan, jalankanAntrean, json, kirim, kurasSemua, panggil, sqliteAda, TOKEN_ADMIN, type Lingkungan,
} from "./harness";

const adm = { "x-admin-token": TOKEN_ADMIN };
const URI_PP99 = "/akn/id/act/pp/2025/99";
const uriEnc = encodeURIComponent(URI_PP99);

const dokumenBpk = (ubah: Record<string, unknown> = {}) => ({
  bpk_id: "555",
  detail_url: "https://peraturan.bpk.go.id/Details/555/pp-no-99-tahun-2025",
  meta: {
    Judul: "Pengelolaan Sampah Rumah Tangga", "Bentuk Singkat": "PP", Nomor: "99", Tahun: "2025",
    Status: "Berlaku", "T.E.U.": "Indonesia", Bidang: "LINGKUNGAN HIDUP", "Tanggal Penetapan": "1 Maret 2025",
  },
  relasi: [{ label: "Mengubah", bpk_id: null, teks: "Peraturan Pemerintah Nomor 35 Tahun 2021" }],
  abstrak: ["Mengatur pengelolaan sampah."],
  ...ubah,
});

const PDF = new TextEncoder().encode("%PDF-1.4\n...isi pdf palsu...");
const NASKAH = [
  "# PP 99/2025", "BAB I", "KETENTUAN UMUM", "Pasal 1",
  "Sampah rumah tangga adalah sampah yang berasal dari kegiatan sehari-hari dalam rumah tangga.",
  "Pasal 2", "(1) Setiap orang wajib memilah sampah.", "(2) Pemerintah daerah menyediakan fasilitas pengelolaan sampah.",
].join("\n");

describe.skipIf(!sqliteAda)("impor BPK -> pengindeksan", () => {
  let l: Lingkungan;
  beforeEach(() => {
    l = buatLingkungan();
    l.ai.markdown.set("99.pdf", NASKAH);
    l.ai.jawaban = "Peraturan ini mengatur pengelolaan sampah rumah tangga dan kewajiban memilah sampah.";
  });
  afterEach(() => l.tutup());

  const manifest = (dokumen: unknown[]) => panggil(l, "/api/impor/manifest", kirim("POST", { versi: 1, dokumen }, adm));
  const unggahPdf = (isi: BodyInit = PDF, uri = URI_PP99) =>
    panggil(l, `/api/impor/pdf?uri=${encodeURIComponent(uri)}`, { method: "PUT", headers: adm, body: isi });

  describe("POST /api/impor/manifest", () => {
    it("memetakan metadata BPK ke skema Lexa dan melaporkan dokumen yang masih butuh PDF", async () => {
      const res = await manifest([dokumenBpk()]);
      expect(await res.json()).toEqual({ diterima: 1, ditolak: [], butuh_pdf: [URI_PP99] });
      expect(await l.db.prepare(`SELECT jenis, nomor, tahun, judul, status, instansi, bidang, bpk_id, jumlah_pasal, tanggal_penetapan FROM laws`).first()).toEqual({
        jenis: "PP", nomor: "99", tahun: 2025, judul: "Pengelolaan Sampah Rumah Tangga", status: "berlaku",
        instansi: "Indonesia", bidang: "LINGKUNGAN HIDUP", bpk_id: "555", jumlah_pasal: 0, tanggal_penetapan: "2025-03-01",
      });
    });

    it("relasi dari label BPK dipetakan ke peraturan tujuan", async () => {
      await manifest([dokumenBpk()]);
      expect((await l.db.prepare(`SELECT from_uri, to_uri, jenis_relasi FROM relations`).all()).results).toEqual([
        { from_uri: URI_PP99, to_uri: "/akn/id/act/pp/2021/35", jenis_relasi: "mengubah" },
      ]);
    });

    it("relasi ke Perppu dipetakan ke PERPPU, bukan ke UU bernomor dan bertahun sama", async () => {
      // Kekeliruan lama: "Peraturan Pemerintah Pengganti Undang-Undang Nomor 2 Tahun 2022" terbaca UU 2/2022.
      await manifest([dokumenBpk({
        relasi: [
          { label: "Diubah dengan", bpk_id: null, teks: "Peraturan Pemerintah Pengganti Undang-Undang Nomor 2 Tahun 2022 tentang Cipta Kerja" },
          { label: "Mengubah", bpk_id: null, teks: "Peraturan Menteri Nomor 29 Tahun 2025 tentang Pedoman" },
        ],
      })]);
      const baris = (await l.db.prepare(`SELECT to_uri, jenis_relasi FROM relations ORDER BY to_uri`).all()).results;
      expect(baris).toEqual([
        { to_uri: "/akn/id/act/permen/2025/29", jenis_relasi: "mengubah" },
        { to_uri: "/akn/id/act/perppu/2022/2", jenis_relasi: "diubah_oleh" },
      ]);
    });

    it("dokumen dengan metadata inti tak lengkap ditolak, sisanya tetap diterima", async () => {
      const rusak = dokumenBpk({ bpk_id: "556", meta: { Judul: "Tanpa nomor dan tahun" } });
      const b = await json<{ diterima: number; ditolak: Array<{ bpk_id: string; alasan: string }> }>(await manifest([rusak, dokumenBpk()]));
      expect(b.diterima).toBe(1);
      expect(b.ditolak).toEqual([{ bpk_id: "556", alasan: "metadata inti tidak lengkap" }]);
    });

    it("kiriman ulang memperbarui metadata, mempertahankan ringkasan yang sudah ada, dan tidak menggandakan relasi", async () => {
      await manifest([dokumenBpk()]);
      await l.db.prepare(`UPDATE laws SET ringkasan = 'ringkasan lama' WHERE frbr_uri = ?`).bind(URI_PP99).run();
      await manifest([dokumenBpk({ bpk_id: "777", meta: { ...dokumenBpk().meta, Judul: "Judul Diperbarui", Status: "Dicabut" } })]);
      expect(await l.db.prepare(`SELECT judul, status, bpk_id, ringkasan FROM laws`).first()).toEqual({
        judul: "Judul Diperbarui", status: "dicabut", bpk_id: "777", ringkasan: "ringkasan lama",
      });
      expect((await l.db.prepare(`SELECT COUNT(*) AS n FROM relations`).first<{ n: number }>())?.n).toBe(1);
    });

    it("dokumen yang isinya sudah ada tidak diminta PDF-nya lagi", async () => {
      await manifest([dokumenBpk()]);
      await l.db.prepare(`UPDATE laws SET jumlah_pasal = 3 WHERE frbr_uri = ?`).bind(URI_PP99).run();
      expect((await json<{ butuh_pdf: string[] }>(await manifest([dokumenBpk()]))).butuh_pdf).toEqual([]);
    });

    it("manifest besar (sampai 500 dokumen) diterima utuh walau D1 membatasi 100 parameter per kueri", async () => {
      const dokumen = Array.from({ length: 300 }, (_, i) =>
        dokumenBpk({ bpk_id: String(1000 + i), meta: { ...dokumenBpk().meta, Nomor: String(i + 1), Judul: `Judul ${i}` }, relasi: [] }),
      );
      const res = await manifest(dokumen);
      expect(res.status).toBe(200);
      const b = await json<{ diterima: number; butuh_pdf: string[] }>(res);
      expect(b.diterima).toBe(300);
      expect(b.butuh_pdf).toHaveLength(300);
    });

    it("badan kosong -> 400; lebih dari 500 dokumen -> 413", async () => {
      const kosong = await manifest([]);
      expect(kosong.status).toBe(400);
      expect(await kosong.json()).toMatchObject({ error: "manifest_kosong" });
      const besar = await manifest(Array.from({ length: 501 }, (_, i) => dokumenBpk({ bpk_id: String(i) })));
      expect(besar.status).toBe(413);
      expect(await besar.json()).toMatchObject({ error: "manifest_terlalu_besar" });
    });

    it("mencatat impor di sync_log", async () => {
      await manifest([dokumenBpk()]);
      expect((await l.db.prepare(`SELECT job, status, detail, jumlah FROM sync_log`).all()).results).toEqual([
        { job: "impor_bpk", status: "sukses", detail: "ditolak 0", jumlah: 1 },
      ]);
    });

    describe("cakupan peraturan (UUD, Tap MPR, UU, Perppu, PP)", () => {
      const jenisLain = (bpk_id: string, bentuk: string, nomor = "7") =>
        dokumenBpk({ bpk_id, meta: { ...dokumenBpk().meta, "Bentuk Singkat": bentuk, Nomor: nomor, Judul: `Contoh ${bentuk} ${nomor}` }, relasi: [] });

      it("dokumen jenis lain ditolak dengan alasan; yang dalam cakupan di kiriman yang sama tetap diterima", async () => {
        const b = await json<{ diterima: number; ditolak: Array<{ bpk_id: string; alasan: string }>; butuh_pdf: string[] }>(
          await manifest([jenisLain("801", "PERPRES"), jenisLain("802", "POJK"), jenisLain("803", "PERMEN"), jenisLain("804", "PERDA"), dokumenBpk()]),
        );
        expect(b.diterima).toBe(1);
        expect(b.butuh_pdf).toEqual([URI_PP99]);
        expect(b.ditolak.map((d) => d.bpk_id)).toEqual(["801", "802", "803", "804"]);
        expect(b.ditolak[0].alasan).toBe("di luar cakupan (PERPRES); cakupan: UUD, TAP_MPR, UU, PERPPU, PP");
        expect((await l.db.prepare(`SELECT COUNT(*) AS n FROM laws`).first<{ n: number }>())?.n).toBe(1);
      });

      it("UUD, Tap MPR, UU, Perppu (kedua ejaan sumber), dan PP diterima", async () => {
        const b = await json<{ diterima: number; ditolak: unknown[] }>(
          await manifest([
            jenisLain("811", "UUD", "1945"), jenisLain("812", "TAP MPR", "16"), jenisLain("813", "UU"),
            jenisLain("814", "PERPPU"), jenisLain("815", "PERPU", "8"), jenisLain("816", "PP"), jenisLain("817", "UU DRT", "3"),
          ]),
        );
        expect(b).toMatchObject({ diterima: 7, ditolak: [] });
        expect((await l.db.prepare(`SELECT jenis FROM laws ORDER BY jenis`).all()).results.map((r) => r.jenis)).toEqual(
          ["PERPPU", "PERPPU", "PP", "TAP_MPR", "UU", "UU", "UUD"],
        );
      });

      it("jenis yang tak dikenal (LAIN) pun ditolak, dan dengan cakupan dilebarkan Perpres diterima", async () => {
        const b = await json<{ diterima: number; ditolak: unknown[] }>(await manifest([jenisLain("821", "KEPUTUSAN ANEH")]));
        expect(b).toMatchObject({ diterima: 0 });
        expect(b.ditolak).toHaveLength(1);

        l.env.CAKUPAN_JENIS = "UU,PP,PERPRES";
        expect(await json(await manifest([jenisLain("801", "PERPRES")]))).toMatchObject({ diterima: 1, ditolak: [] });
      });

      it("kiriman yang seluruhnya di luar cakupan dijawab 200 dengan semua dokumen di ditolak, tanpa menulis apa pun", async () => {
        const res = await manifest([jenisLain("801", "PERPRES"), jenisLain("802", "POJK")]);
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ diterima: 0, butuh_pdf: [] });
        expect((await l.db.prepare(`SELECT COUNT(*) AS n FROM laws`).first<{ n: number }>())?.n).toBe(0);
      });
    });
  });

  describe("PUT /api/impor/pdf", () => {
    beforeEach(async () => {
      await manifest([dokumenBpk()]);
    });

    it("PDF untuk baris lama di luar cakupan ditolak: R2 tidak bertambah dan tidak ada yang diantrekan", async () => {
      const uri = "/akn/id/act/perpres/2020/1";
      await l.db.prepare(`INSERT INTO laws (frbr_uri, jenis, nomor, tahun, judul) VALUES (?,?,?,?,?)`).bind(uri, "PERPRES", "1", 2020, "Komisi Contoh").run();
      const res = await unggahPdf(PDF, uri);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ error: "di_luar_cakupan" });
      expect(l.r2.objek.size).toBe(0);
      expect(l.antrean.pesan).toEqual([]);
      expect((await l.db.prepare(`SELECT r2_pdf_key FROM laws WHERE frbr_uri = ?`).bind(uri).first<{ r2_pdf_key: string | null }>())?.r2_pdf_key).toBeNull();
    });

    it("menyimpan PDF ke R2, mencatat kuncinya, dan mengantrekan ekstraksi", async () => {
      const res = await unggahPdf();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "diantrekan", uri: URI_PP99, r2_key: "pdf/akn/id/act/pp/2025/99.pdf", ukuran: PDF.byteLength });
      expect(l.r2.objek.get("pdf/akn/id/act/pp/2025/99.pdf")).toMatchObject({
        httpMetadata: { contentType: "application/pdf" }, customMetadata: { frbr_uri: URI_PP99 },
      });
      expect((await l.db.prepare(`SELECT r2_pdf_key FROM laws`).first<{ r2_pdf_key: string }>())?.r2_pdf_key).toBe("pdf/akn/id/act/pp/2025/99.pdf");
      expect(l.antrean.pesan).toEqual([{ tipe: "ekstrak_pdf", frbr_uri: URI_PP99, r2_key: "pdf/akn/id/act/pp/2025/99.pdf" }]);
    });

    it("isi yang bukan PDF (mis. halaman challenge) -> 415 dan tidak ada yang disimpan", async () => {
      const res = await unggahPdf("<html>Just a moment...</html>");
      expect(res.status).toBe(415);
      expect(await res.json()).toMatchObject({ error: "bukan_pdf" });
      expect(l.r2.objek.size).toBe(0);
      expect(l.antrean.pesan).toEqual([]);
    });

    it("badan kosong -> 400; uri kosong -> 400; uri belum punya manifest -> 409", async () => {
      expect((await unggahPdf("")).status).toBe(400);
      expect((await panggil(l, "/api/impor/pdf", { method: "PUT", headers: adm, body: PDF })).status).toBe(400);
      const asing = await unggahPdf(PDF, "/akn/id/act/uu/1999/9");
      expect(asing.status).toBe(409);
      expect(await asing.json()).toMatchObject({ error: "tidak_dikenal" });
    });
  });

  describe("rantai antrean: ekstrak_pdf -> indeks_vektor + ringkas", () => {
    beforeEach(async () => {
      await manifest([dokumenBpk()]);
      await unggahPdf();
    });

    it("mengurai naskah menjadi pasal dan ayat, menyimpan teks, mengindeks vektor, dan meringkas", async () => {
      const diproses = await kurasSemua(l);
      expect(diproses).toBe(3); // ekstrak_pdf, lalu indeks_vektor dan ringkas

      expect(await l.db.prepare(`SELECT jumlah_pasal, r2_text_key, ringkasan, indexed_at FROM laws`).first()).toMatchObject({
        jumlah_pasal: 3, r2_text_key: "teks/akn/id/act/pp/2025/99.md",
        ringkasan: expect.stringContaining("pengelolaan sampah rumah tangga"), indexed_at: expect.any(String),
      });
      expect((await l.db.prepare(`SELECT id, nomor_pasal, ayat, bab FROM articles ORDER BY urutan`).all()).results).toEqual([
        { id: `${URI_PP99}#pasal-1`, nomor_pasal: "1", ayat: null, bab: "BAB I" },
        { id: `${URI_PP99}#pasal-2-ayat-1`, nomor_pasal: "2", ayat: "1", bab: "BAB I" },
        { id: `${URI_PP99}#pasal-2-ayat-2`, nomor_pasal: "2", ayat: "2", bab: "BAB I" },
      ]);
      expect([...l.vektor.simpan.keys()].sort()).toEqual([
        URI_PP99, `${URI_PP99}#pasal-1`, `${URI_PP99}#pasal-2-ayat-1`, `${URI_PP99}#pasal-2-ayat-2`,
      ]);
      expect([...l.vektor.simpan.values()][1].metadata).toEqual({ frbr_uri: URI_PP99, jenis: "PP", tahun: 2025, status: "berlaku" });
      expect(await l.r2.get("teks/akn/id/act/pp/2025/99.md").then((o) => o?.text())).toBe(NASKAH);
    });

    it("peraturan yang terisi lewat PDF berstatus 'lengkap' (bukan lagi menunggu diambil dari pasal.id)", async () => {
      expect(await l.db.prepare(`SELECT isi_status FROM laws`).first()).toEqual({ isi_status: "menunggu" });
      await kurasSemua(l);
      expect(await l.db.prepare(`SELECT isi_status, isi_percobaan, isi_catatan FROM laws`).first()).toEqual({
        isi_status: "lengkap", isi_percobaan: 0, isi_catatan: null,
      });
    });

    it("hasil PDF yang lebih sedikit dari pasal yang sudah tersimpan (mis. dari pasal.id) tidak menggantikannya", async () => {
      // Naskah yang sudah ada punya lima pasal; pindaian PDF hanya terbaca tiga.
      for (let n = 1; n <= 5; n++) {
        await l.db.prepare(`INSERT INTO articles (id, frbr_uri, nomor_pasal, isi, urutan) VALUES (?,?,?,?,?)`)
          .bind(`${URI_PP99}#pasal-${n}`, URI_PP99, String(n), `Isi lama ${n}.`, n).run();
      }
      await l.db.prepare(`UPDATE laws SET jumlah_pasal = 5 WHERE frbr_uri = ?`).bind(URI_PP99).run();

      await kurasSemua(l);
      expect((await l.db.prepare(`SELECT isi FROM articles ORDER BY urutan`).all()).results.map((r) => r.isi)).toEqual([
        "Isi lama 1.", "Isi lama 2.", "Isi lama 3.", "Isi lama 4.", "Isi lama 5.",
      ]);
      expect(await l.db.prepare(`SELECT jumlah_pasal FROM laws`).first()).toEqual({ jumlah_pasal: 5 });
      expect(await l.db.prepare(`SELECT catatan FROM ekstraksi_log`).first()).toEqual({
        catatan: "dipertahankan: 5 pasal tersimpan lebih banyak dari 3 hasil PDF",
      });
      expect(await l.r2.get("teks/akn/id/act/pp/2025/99.md").then((o) => o?.text())).toBe(NASKAH); // teks konversi tetap diarsipkan
    });

    it("mencatat mutu ekstraksi (vonis, jumlah pasal) dan keberhasilan di sync_log", async () => {
      await kurasSemua(l);
      expect(await l.db.prepare(`SELECT vonis, jumlah_pasal, jumlah_ayat, tahun_dokumen, catatan FROM ekstraksi_log`).first()).toEqual({
        vonis: "bersih", jumlah_pasal: 3, jumlah_ayat: 2, tahun_dokumen: 2025, catatan: null,
      });
      expect((await l.db.prepare(`SELECT job, status, detail, jumlah FROM sync_log WHERE job = 'ekstrak_pdf'`).all()).results).toEqual([
        { job: "ekstrak_pdf", status: "sukses", detail: URI_PP99, jumlah: 3 },
      ]);
      const ukur = await json<{ total_diukur: number; layak_pakai: number; persen_layak: number }>(
        await panggil(l, "/api/admin/ukur", { headers: adm }),
      );
      expect(ukur).toMatchObject({ total_diukur: 1, layak_pakai: 1, persen_layak: 100 });
    });

    it("hasilnya langsung bisa dicari, dibaca, dan diunduh", async () => {
      await kurasSemua(l);
      const cari = await json<{ hits: Array<{ article_id: string | null; snippet: string }> }>(
        await panggil(l, `/api/search?q=${encodeURIComponent("memilah sampah")}&mode=keyword`),
      );
      // "memilah" distem menjadi "pilah" dan tetap cocok dengan bentuk aslinya di teks.
      expect(cari.hits.map((h) => h.article_id)).toEqual(expect.arrayContaining([null, `${URI_PP99}#pasal-2-ayat-1`]));

      const status = await json<Record<string, unknown>>(await panggil(l, `/api/dokumen/status?uri=${uriEnc}`));
      expect(status).toEqual({
        uri: URI_PP99, ada_pdf: true, ada_teks: true,
        pdf_url: `/api/dokumen/pdf?uri=${uriEnc}`, teks_url: `/api/dokumen/teks?uri=${uriEnc}`,
        bpk_url: "https://peraturan.bpk.go.id/Details/555",
      });
      const teks = await panggil(l, `/api/dokumen/teks?uri=${uriEnc}`);
      expect(teks.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(await teks.text()).toBe(NASKAH);

      const pdf = await panggil(l, `/api/dokumen/pdf?uri=${uriEnc}`);
      expect(pdf.status).toBe(200);
      expect(pdf.headers.get("content-type")).toBe("application/pdf");
      expect(pdf.headers.get("content-disposition")).toBe('inline; filename="PP-99-2025.pdf"');
      expect(pdf.headers.get("cache-control")).toContain("immutable");
      expect(new Uint8Array(await pdf.arrayBuffer())).toEqual(PDF);
    });

    it("kiriman ulang PDF yang menghasilkan pasal sama banyak atau lebih mengganti pasal lama, bukan menambahnya", async () => {
      await kurasSemua(l); // tiga baris: Pasal 1, Pasal 2 ayat 1 dan 2
      l.ai.markdown.set("99.pdf", ["Pasal 1", "Isi baru satu.", "Pasal 2", "Isi baru dua.", "Pasal 3", "Isi baru tiga."].join("\n"));
      await unggahPdf();
      await kurasSemua(l);
      expect((await l.db.prepare(`SELECT nomor_pasal, isi FROM articles ORDER BY urutan`).all()).results).toEqual([
        { nomor_pasal: "1", isi: "Isi baru satu." }, { nomor_pasal: "2", isi: "Isi baru dua." }, { nomor_pasal: "3", isi: "Isi baru tiga." },
      ]);
      expect((await l.db.prepare(`SELECT COUNT(*) AS n FROM ekstraksi_log`).first<{ n: number }>())?.n).toBe(1);
    });
  });

  describe("kegagalan ekstraksi", () => {
    beforeEach(async () => {
      await manifest([dokumenBpk()]);
      await unggahPdf();
    });

    it("teks tanpa struktur pasal: dicatat 'tanpa_pasal', tidak di-retry, tidak ada vektor", async () => {
      l.ai.markdown.set("99.pdf", "Halaman pindaian tanpa struktur apa pun yang bisa dikenali sebagai pasal.");
      const [pesan] = l.antrean.kuras();
      const hasil = await jalankanAntrean(l, [pesan]);
      expect(hasil).toEqual({ diakui: 1, diulang: [] });
      expect(await l.db.prepare(`SELECT vonis, jumlah_pasal, catatan FROM ekstraksi_log`).first()).toEqual({
        vonis: "tanpa_pasal", jumlah_pasal: 0, catatan: "tidak ada pasal terdeteksi",
      });
      expect((await l.db.prepare(`SELECT status, detail FROM sync_log WHERE job = 'ekstrak_pdf'`).first())).toEqual({
        status: "gagal", detail: `${URI_PP99}: tidak ada pasal terdeteksi`,
      });
      expect(l.antrean.pesan).toEqual([]);
      expect(l.vektor.simpan.size).toBe(0);
      // Teks tetap diarsipkan agar bisa diperiksa manual.
      expect(l.r2.objek.has("teks/akn/id/act/pp/2025/99.md")).toBe(true);
    });

    it("konversi PDF gagal: pesan di-retry dan kegagalan dicatat dengan vonis 'gagal'", async () => {
      l.ai.galatKonversi = "PDF terenkripsi";
      const hasil = await jalankanAntrean(l, l.antrean.kuras());
      expect(hasil.diakui).toBe(0);
      expect(hasil.diulang).toHaveLength(1);
      expect(await l.db.prepare(`SELECT vonis, catatan FROM ekstraksi_log`).first()).toEqual({ vonis: "gagal", catatan: "PDF terenkripsi" });
    });

    it("teks hasil konversi kosong diperlakukan sebagai kegagalan yang bisa di-retry", async () => {
      l.ai.markdown.set("99.pdf", "   ");
      const hasil = await jalankanAntrean(l, l.antrean.kuras());
      expect(hasil.diulang).toHaveLength(1);
      expect(await l.db.prepare(`SELECT vonis, catatan FROM ekstraksi_log`).first()).toEqual({ vonis: "gagal", catatan: "teks hasil konversi kosong" });
    });

    it("berkas hilang dari R2: di-retry", async () => {
      l.r2.objek.clear();
      const hasil = await jalankanAntrean(l, l.antrean.kuras());
      expect(hasil.diulang).toHaveLength(1);
    });

    it("kegagalan ringkasan tidak menggagalkan pasal yang sudah tersimpan", async () => {
      l.ai.galatObrolan = new Error("model ringkas mati");
      const [ekstrak] = l.antrean.kuras();
      await jalankanAntrean(l, [ekstrak]);
      const hasil = await jalankanAntrean(l, l.antrean.kuras()); // indeks_vektor + ringkas
      expect(hasil.diakui).toBe(1);
      expect(hasil.diulang).toHaveLength(1); // hanya ringkasan yang diulang
      expect((await l.db.prepare(`SELECT jumlah_pasal, indexed_at FROM laws`).first())).toMatchObject({ jumlah_pasal: 3, indexed_at: expect.any(String) });
    });
  });
});
