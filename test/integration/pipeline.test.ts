/**
 * Pipeline data: impor dari BPK -> antrean -> ekstraksi PDF -> pengindeksan ->
 * ringkasan, serta sinkronisasi terjadwal dari pasal.id (Cron + konsumer
 * antrean), termasuk jalur kena batas laju 429.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buatLingkungan, jalankanAntrean, jalankanCron, json, kirim, kurasSemua, panggil, sisipkan,
  sqliteAda, TOKEN_ADMIN, type Lingkungan,
} from "./harness";
import { PasalClient } from "../../src/worker/lib/pasal";
import type { PesanIngest } from "../../src/worker/lib/ingest";

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
  });

  describe("PUT /api/impor/pdf", () => {
    beforeEach(async () => {
      await manifest([dokumenBpk()]);
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

    it("kiriman ulang PDF mengganti pasal lama, bukan menambahnya", async () => {
      await kurasSemua(l);
      l.ai.markdown.set("99.pdf", "Pasal 1\nIsi tunggal yang baru.");
      await unggahPdf();
      await kurasSemua(l);
      expect((await l.db.prepare(`SELECT nomor_pasal, isi FROM articles`).all()).results).toEqual([{ nomor_pasal: "1", isi: "Isi tunggal yang baru." }]);
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

// ---------------------------------------------------------------------------
// Sinkronisasi terjadwal dari pasal.id
// ---------------------------------------------------------------------------

const hukumPasal = (jenis: string, tahun: number, nomor: number, judul: string, status = "berlaku") => ({
  id: tahun * 100 + nomor, frbr_uri: `/akn/id/act/${jenis.toLowerCase()}/${tahun}/${nomor}`,
  title: judul, type: jenis, number: String(nomor), year: tahun, status,
});

describe.skipIf(!sqliteAda)("sinkronisasi pasal.id", () => {
  let l: Lingkungan;
  let panggilanPasal: URL[];

  beforeEach(() => {
    l = buatLingkungan();
    panggilanPasal = [];
    // Bentuk URL detail yang berhasil diingat PasalClient lintas instans; reset agar tes saling lepas.
    (PasalClient as unknown as { bentukDetail: string | null }).bentukDetail = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    l.tutup();
  });

  /** Stub pasal.id: `daftar[jenis]` dilayani pada /laws, `detail[uri]` pada /laws/<uri>. */
  function stubPasal(opsi: {
    daftar?: Record<string, unknown[]>;
    detail?: Record<string, unknown>;
    batasLaju?: (url: URL) => boolean;
  }) {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      panggilanPasal.push(url);
      if (opsi.batasLaju?.(url)) return new Response("lambat", { status: 429, headers: { "retry-after": "120" } });
      if (url.pathname === "/api/laws" && !url.searchParams.has("uri")) {
        const semua = opsi.daftar?.[url.searchParams.get("type") ?? ""] ?? [];
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 50);
        return Response.json({ data: semua.slice(offset, offset + limit), total: semua.length });
      }
      const uri = url.pathname.replace(/^\/api\/laws/, "") || url.searchParams.get("uri") || "";
      const d = opsi.detail?.[uri];
      return d ? Response.json(d) : new Response("tidak ada", { status: 404 });
    });
  }

  const log = async (job: string) =>
    (await l.db.prepare(`SELECT status, detail, jumlah FROM sync_log WHERE job = ? ORDER BY id`).bind(job).all()).results;

  describe("Cron (jadwalkanSinkronisasi)", () => {
    it("tanpa PASAL_API_TOKEN, sinkronisasi dilewati tanpa menghubungi siapa pun", async () => {
      (l.env as { PASAL_API_TOKEN: string }).PASAL_API_TOKEN = "";
      stubPasal({});
      await jalankanCron(l);
      expect(panggilanPasal).toEqual([]);
      expect(l.antrean.pesan).toEqual([]);
    });

    it("mengantrekan peraturan baru per jenis dan mencatat jalannya", async () => {
      stubPasal({
        daftar: {
          UU: [hukumPasal("UU", 2003, 13, "Ketenagakerjaan"), hukumPasal("UU", 2020, 11, "Cipta Kerja", "dicabut")],
          PP: [hukumPasal("PP", 2021, 35, "PKWT, Alih Daya")],
        },
      });
      await jalankanCron(l);

      expect(l.antrean.pesan).toEqual([
        { tipe: "peraturan", frbr_uri: "/akn/id/act/uu/2003/13", alasan: "baru", pasal_id: 200313 },
        { tipe: "peraturan", frbr_uri: "/akn/id/act/uu/2020/11", alasan: "baru", pasal_id: 202011 },
        { tipe: "peraturan", frbr_uri: "/akn/id/act/pp/2021/35", alasan: "baru", pasal_id: 202135 },
      ]);
      // Seluruh jenis prioritas disapu, dengan token pada setiap permintaan.
      expect(new Set(panggilanPasal.map((u) => u.searchParams.get("type")))).toEqual(
        new Set(["UU", "PERPPU", "PP", "PERPRES", "PERMEN", "POJK", "PBI"]),
      );
      expect(await log("jadwal_sinkronisasi")).toEqual([
        { status: "mulai", detail: "UU,PERPPU,PP,PERPRES,PERMEN,POJK,PBI", jumlah: 0 },
        { status: "sukses", detail: "diperiksa 3", jumlah: 3 },
      ]);
    });

    it("kursor offset dimajukan dan di-reset ke 0 setelah jenis itu habis", async () => {
      const banyak = Array.from({ length: 120 }, (_, i) => hukumPasal("UU", 1990 + (i % 30), i + 1, `Judul ${i}`));
      stubPasal({ daftar: { UU: banyak } });
      const kursor = async () => (await l.db.prepare(`SELECT value FROM sync_state WHERE key = 'offset:UU'`).first<{ value: string }>())?.value;

      await jalankanCron(l); // 4 halaman x 50 -> 120 habis pada halaman ke-3
      expect(l.antrean.pesan).toHaveLength(120);
      expect(await kursor()).toBe("0");

      // Halaman kedua/ketiga memakai offset hasil halaman sebelumnya, bukan nomor halaman.
      const offsetUU = panggilanPasal.filter((u) => u.searchParams.get("type") === "UU").map((u) => u.searchParams.get("offset"));
      expect(offsetUU).toEqual(["0", "50", "100"]);
      expect(panggilanPasal.every((u) => !u.searchParams.has("page"))).toBe(true);
    });

    it("hanya mengantrekan yang baru, berubah status, atau masih kosong; yang sudah mutakhir dilewati", async () => {
      await sisipkan(l, [
        { uri: "/akn/id/act/uu/2003/13", jenis: "UU", nomor: "13", tahun: 2003, judul: "Ketenagakerjaan", pasal: [{ nomor: "1", isi: "Isi." }] },
        { uri: "/akn/id/act/uu/2020/11", jenis: "UU", nomor: "11", tahun: 2020, judul: "Cipta Kerja", pasal: [{ nomor: "1", isi: "Isi." }] },
        { uri: "/akn/id/act/uu/2019/1", jenis: "UU", nomor: "1", tahun: 2019, judul: "Metadata saja" },
      ]);
      stubPasal({
        daftar: {
          UU: [
            hukumPasal("UU", 2003, 13, "Ketenagakerjaan"), // mutakhir
            hukumPasal("UU", 2020, 11, "Cipta Kerja", "dicabut"), // status berubah
            hukumPasal("UU", 2019, 1, "Metadata saja"), // isi kosong
          ],
        },
      });
      await jalankanCron(l);
      expect(l.antrean.pesan.map((p) => [(p as PesanIngest & { frbr_uri: string }).frbr_uri, (p as { alasan: string }).alasan])).toEqual([
        ["/akn/id/act/uu/2020/11", "perubahan"],
        ["/akn/id/act/uu/2019/1", "perubahan"],
      ]);
    });

    it("kena 429: berhenti rapi, kursor disimpan, jalan berikutnya melanjutkan", async () => {
      const banyak = Array.from({ length: 120 }, (_, i) => hukumPasal("UU", 2000, i + 1, `Judul ${i}`));
      let kenaBatas = true;
      stubPasal({
        daftar: { UU: banyak },
        batasLaju: (u) => kenaBatas && u.searchParams.get("type") === "UU" && u.searchParams.get("offset") === "50",
      });
      await jalankanCron(l);

      // Halaman pertama (50) sudah diperiksa; permintaan kedua kena 429 dan seluruh sapuan berhenti.
      expect(await log("jadwal_sinkronisasi")).toEqual([
        { status: "mulai", detail: "UU,PERPPU,PP,PERPRES,PERMEN,POJK,PBI", jumlah: 0 },
        { status: "gagal", detail: "rate limit pada UU", jumlah: 50 },
      ]);
      expect((await l.db.prepare(`SELECT value FROM sync_state WHERE key = 'offset:UU'`).first<{ value: string }>())?.value).toBe("50");
      expect(panggilanPasal.map((u) => u.searchParams.get("type"))).toEqual(["UU", "UU"]); // jenis lain tidak dicoba

      kenaBatas = false;
      panggilanPasal.length = 0;
      await jalankanCron(l);
      expect(panggilanPasal[0].searchParams.get("offset")).toBe("50"); // melanjutkan, bukan mengulang
    });

    // Bug v0.1: kena 429 membuat fungsi `return` sebelum antrean lokal dikirim, padahal kursor
    // offset sudah dimajukan dan log mengaku "diantrekan 50". Peraturan di halaman yang sudah
    // dilewati hilang sampai kursor berputar penuh. Ini kandidat utama penyebab sinkronisasi
    // yang "sering terhenti".
    it.fails("pesan yang sudah terkumpul sebelum kena 429 tetap dikirim ke antrean", async () => {
      const banyak = Array.from({ length: 120 }, (_, i) => hukumPasal("UU", 2000, i + 1, `Judul ${i}`));
      stubPasal({
        daftar: { UU: banyak },
        batasLaju: (u) => u.searchParams.get("type") === "UU" && u.searchParams.get("offset") === "50",
      });
      await jalankanCron(l);
      expect(l.antrean.pesan).toHaveLength(50);
    });

    it("error selain 429 pada satu jenis dicatat, jenis lain tetap diproses", async () => {
      vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.searchParams.get("type") === "UU") return new Response("rusak", { status: 500 });
        return Response.json({ data: [], total: 0 });
      });
      await jalankanCron(l);
      const entri = await log("jadwal_sinkronisasi");
      expect(entri.some((e) => String(e.detail).startsWith("UU: PasalApiError"))).toBe(true);
      expect(entri.at(-1)).toMatchObject({ status: "sukses" });
    });

    it("tekanan balik: antrean yang belum tuntas (>400 peraturan kosong) menunda penjadwalan baru", async () => {
      for (let i = 0; i < 401; i++) {
        await l.db
          .prepare(`INSERT INTO laws (frbr_uri, jenis, nomor, tahun, judul, jumlah_pasal) VALUES (?,?,?,?,?,0)`)
          .bind(`/akn/id/act/uu/2000/${i}`, "UU", String(i), 2000, `Judul ${i}`)
          .run();
      }
      stubPasal({ daftar: { UU: [hukumPasal("UU", 2024, 1, "Baru")] } });
      await jalankanCron(l);
      expect(panggilanPasal).toEqual([]);
      expect(l.antrean.pesan).toEqual([]);
      expect(await log("jadwal_sinkronisasi")).toEqual([
        { status: "gagal", detail: "dilewati: 401 peraturan masih menunggu isi (batas 400)", jumlah: 0 },
      ]);
    });

    it("POST /api/admin/sync menjalankan sapuan yang sama atas jenis yang dipilih", async () => {
      stubPasal({ daftar: { PP: [hukumPasal("PP", 2021, 35, "PKWT")] } });
      const res = await panggil(l, "/api/admin/sync", kirim("POST", { jenis: ["PP"], maks_halaman: 1 }, adm));
      expect(await res.json()).toEqual({ status: "selesai", diantrekan: 1, diperiksa: 1 });
      expect(panggilanPasal.map((u) => u.searchParams.get("type"))).toEqual(["PP"]);
    });
  });

  describe("konsumer antrean (prosesPesanIngest)", () => {
    const detailUU13 = {
      work: { id: 200313, frbr_uri: "/akn/id/act/uu/2003/13", title: "Ketenagakerjaan", type: "UU", number: "13", year: 2003, status: "berlaku" },
      articles: [
        { id: 1, type: "bab", number: "X", heading: "PERLINDUNGAN", sort_order: 1 },
        { id: 2, type: "pasal", number: "82", parent_id: 1, sort_order: 1 },
        { id: 3, type: "ayat", number: "1", content: "Pekerja perempuan berhak memperoleh istirahat 1,5 bulan sebelum melahirkan.", parent_id: 2, sort_order: 1 },
        { id: 4, type: "pasal", number: "156", content: "Pengusaha wajib membayar uang pesangon.", sort_order: 2 },
      ],
      relationships: [{ frbr_uri: "/akn/id/act/uu/2020/11", relationship_type: "Diubah Oleh", note: "UU 11/2020" }],
    };
    const pesanUU13: PesanIngest = { tipe: "peraturan", frbr_uri: "/akn/id/act/uu/2003/13", alasan: "baru" };

    it("menyimpan peraturan, pasal, relasi, dan arsip teks, lalu mengantrekan pengindeksan vektor", async () => {
      stubPasal({ detail: { "/akn/id/act/uu/2003/13": detailUU13 } });
      const hasil = await jalankanAntrean(l, [pesanUU13]);
      expect(hasil).toEqual({ diakui: 1, diulang: [] });

      expect(await l.db.prepare(`SELECT judul, jumlah_pasal, r2_text_key FROM laws`).first()).toEqual({
        judul: "Ketenagakerjaan", jumlah_pasal: 2, r2_text_key: "teks/akn/id/act/uu/2003/13.txt",
      });
      expect((await l.db.prepare(`SELECT id, bab FROM articles ORDER BY urutan`).all()).results).toEqual([
        { id: "/akn/id/act/uu/2003/13#pasal-82-ayat-1", bab: "BAB X PERLINDUNGAN" },
        { id: "/akn/id/act/uu/2003/13#pasal-156", bab: null },
      ]);
      expect((await l.db.prepare(`SELECT to_uri, jenis_relasi, keterangan FROM relations`).all()).results).toEqual([
        { to_uri: "/akn/id/act/uu/2020/11", jenis_relasi: "diubah_oleh", keterangan: "UU 11/2020" },
      ]);
      expect(await l.r2.get("teks/akn/id/act/uu/2003/13.txt").then((o) => o?.text())).toContain("Pasal 156\nPengusaha wajib membayar uang pesangon.");
      expect(l.antrean.pesan).toEqual([{ tipe: "indeks_vektor", frbr_uri: "/akn/id/act/uu/2003/13" }]);

      await kurasSemua(l);
      expect(l.vektor.simpan.has("/akn/id/act/uu/2003/13#pasal-82-ayat-1")).toBe(true);
      expect((await l.db.prepare(`SELECT indexed_at FROM laws`).first<{ indexed_at: string | null }>())?.indexed_at).toEqual(expect.any(String));
    });

    it("memproses ulang peraturan yang sama mengganti pasal dan relasi lama dengan yang baru", async () => {
      const detail: Record<string, unknown> = { "/akn/id/act/uu/2003/13": detailUU13 };
      stubPasal({ detail });
      expect(await jalankanAntrean(l, [pesanUU13])).toMatchObject({ diakui: 1 });

      // Hulu mengubah susunan: Pasal 82 dan 156 hilang, Pasal 99 muncul, relasinya berganti.
      detail["/akn/id/act/uu/2003/13"] = {
        ...detailUU13,
        articles: [{ id: 9, type: "pasal", number: "99", content: "Isi baru." }],
        relationships: [{ frbr_uri: "/akn/id/act/uu/2021/2", relationship_type: "Mencabut" }],
      };
      expect(await jalankanAntrean(l, [pesanUU13])).toMatchObject({ diakui: 1, diulang: [] });

      expect((await l.db.prepare(`SELECT id, isi FROM articles`).all()).results).toEqual([
        { id: "/akn/id/act/uu/2003/13#pasal-99", isi: "Isi baru." },
      ]);
      expect((await l.db.prepare(`SELECT to_uri, jenis_relasi FROM relations`).all()).results).toEqual([
        { to_uri: "/akn/id/act/uu/2021/2", jenis_relasi: "mencabut" },
      ]);
      expect((await l.db.prepare(`SELECT jumlah_pasal FROM laws`).first<{ jumlah_pasal: number }>())?.jumlah_pasal).toBe(1);
      expect((await l.db.prepare(`SELECT COUNT(*) AS n FROM laws`).first<{ n: number }>())?.n).toBe(1);
      // Indeks FTS ikut mengikuti: pasal lama tidak lagi bisa ditemukan.
      const fts = await l.db.prepare(`SELECT COUNT(*) AS n FROM articles_fts WHERE articles_fts MATCH 'pesangon'`).first<{ n: number }>();
      expect(fts?.n).toBe(0);
    });

    it("kena 429: seluruh sisa batch ditunda sekaligus (bukan satu per satu), dan dicatat", async () => {
      stubPasal({ batasLaju: () => true });
      const pesan: PesanIngest[] = ["1", "2", "3"].map((n) => ({ tipe: "peraturan", frbr_uri: `/akn/id/act/uu/2000/${n}`, alasan: "baru" }));
      const hasil = await jalankanAntrean(l, pesan);
      expect(hasil.diakui).toBe(0);
      expect(hasil.diulang).toEqual([{ penundaanDetik: 120 }, { penundaanDetik: 120 }, { penundaanDetik: 120 }]);
      expect(panggilanPasal).toHaveLength(1); // pesan pertama kena 429; sisanya tidak dicoba sama sekali
      expect(await log("antrean_ingest")).toEqual([{ status: "gagal", detail: "rate limit pasal.id — 3 pesan ditunda 120 detik", jumlah: 3 }]);
    });

    it("penundaan 429 minimal 60 detik dan maksimal 1 jam", async () => {
      for (const [retryAfter, harapan] of [["5", 60], ["99999", 3600]] as const) {
        vi.stubGlobal("fetch", async () => new Response("lambat", { status: 429, headers: { "retry-after": retryAfter } }));
        const hasil = await jalankanAntrean(l, [pesanUU13]);
        expect(hasil.diulang).toEqual([{ penundaanDetik: harapan }]);
      }
    });

    it("429 di tengah batch: yang sudah selesai di-ack, mulai dari pesan yang gagal ditunda", async () => {
      const kedua = { ...detailUU13, work: { ...detailUU13.work, frbr_uri: "/akn/id/act/uu/2020/11", title: "Cipta Kerja", year: 2020, number: "11" }, articles: [], relationships: [] };
      let n = 0;
      vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        n++;
        if (n === 1) return Response.json(url.pathname.includes("2003/13") ? detailUU13 : kedua);
        return new Response("lambat", { status: 429 });
      });
      const hasil = await jalankanAntrean(l, [
        pesanUU13,
        { tipe: "peraturan", frbr_uri: "/akn/id/act/uu/2020/11", alasan: "baru" },
        { tipe: "peraturan", frbr_uri: "/akn/id/act/uu/2019/9", alasan: "baru" },
      ]);
      expect(hasil.diakui).toBe(1);
      expect(hasil.diulang).toHaveLength(2);
      expect(await log("antrean_ingest")).toEqual([{ status: "gagal", detail: "rate limit pasal.id — 2 pesan ditunda 60 detik", jumlah: 2 }]);
    });

    it("galat lain: hanya pesan itu yang di-retry (backoff bawaan), pesan sehat tetap diproses", async () => {
      stubPasal({ detail: { "/akn/id/act/uu/2003/13": detailUU13 } }); // uu/1999/8 -> 404
      const hasil = await jalankanAntrean(l, [
        { tipe: "peraturan", frbr_uri: "/akn/id/act/uu/1999/8", alasan: "baru" },
        pesanUU13,
      ]);
      expect(hasil).toEqual({ diakui: 1, diulang: [{ penundaanDetik: undefined }] });
      expect((await l.db.prepare(`SELECT frbr_uri FROM laws`).all()).results).toEqual([{ frbr_uri: "/akn/id/act/uu/2003/13" }]);
    });

    it("respons detail yang tak terpetakan (tanpa judul) di-retry, tidak menyimpan setengah data", async () => {
      stubPasal({ detail: { "/akn/id/act/uu/2003/13": { work: { frbr_uri: "/akn/id/act/uu/2003/13" } } } });
      const hasil = await jalankanAntrean(l, [pesanUU13]);
      expect(hasil.diulang).toHaveLength(1);
      expect((await l.db.prepare(`SELECT COUNT(*) AS n FROM laws`).first<{ n: number }>())?.n).toBe(0);
    });
  });
});
