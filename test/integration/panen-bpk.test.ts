/**
 * Panen BPK, sisi server selain /tautan: manifest yang digabung menurut sitasi (bukan URI turunan), dokumen yang gagal
 * disimpan tak menjatuhkan yang lain, penanda "tanpa berkas", ringkasan kemajuan, dan ekstraksi ulang PDF.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VERSI_PARSER } from "../../src/worker/lib/bpk";
import { buatLingkungan, json, kirim, kurasSemua, panggil, sisipkan, sqliteAda, TOKEN_ADMIN, type Lingkungan, type PeraturanUji } from "./harness";

const adm = { "x-admin-token": TOKEN_ADMIN };
const PDF = new TextEncoder().encode("%PDF-1.4\n...isi pdf palsu...");

const dokumen = (bpkId: string, meta: Record<string, string>, ubah: Record<string, unknown> = {}) => ({
  bpk_id: bpkId,
  detail_url: `https://peraturan.bpk.go.id/Details/${bpkId}/x`,
  meta: { "Bentuk Singkat": "PP", Status: "Berlaku", ...meta },
  ...ubah,
});

interface HasilManifest { diterima: number; ditolak: Array<{ bpk_id: string; alasan: string }>; butuh_pdf: string[] }

describe.skipIf(!sqliteAda)("panen BPK (sisi server)", () => {
  let l: Lingkungan;
  beforeEach(() => {
    l = buatLingkungan();
  });
  afterEach(() => l.tutup());

  const manifest = async (daftar: unknown[]) => json<HasilManifest>(await panggil(l, "/api/impor/manifest", kirim("POST", { versi: 1, dokumen: daftar }, adm)));
  const semuaLaws = async () => (await l.db.prepare(`SELECT frbr_uri, jenis, nomor, tahun, judul, status, bpk_id FROM laws ORDER BY frbr_uri`).all()).results;
  const perpu: PeraturanUji = { uri: "/akn/id/act/perpu/2022/2", jenis: "PERPPU", nomor: "2", tahun: 2022, judul: "Peraturan Pemerintah Pengganti Undang-Undang Nomor 2 Tahun 2022 tentang Cipta Kerja" };

  describe("manifest digabung menurut sitasi", () => {
    it("Perppu yang di Lexa ber-URI 'perpu' diperbarui di tempat; tidak ada baris baru, tidak ada kegagalan indeks unik", async () => {
      await sisipkan(l, [perpu]);
      const b = await manifest([dokumen("234926", { Judul: "Peraturan Pemerintah Pengganti Undang-Undang Nomor 2 Tahun 2022 tentang Cipta Kerja", "Bentuk Singkat": "PERPPU", Nomor: "2", Tahun: "2022" })]);
      expect(b).toEqual({ diterima: 1, ditolak: [], butuh_pdf: ["/akn/id/act/perpu/2022/2"] });
      expect(await semuaLaws()).toEqual([expect.objectContaining({ frbr_uri: "/akn/id/act/perpu/2022/2", bpk_id: "234926" })]);
    });

    it("nomor '01' yang sudah ada dan dokumen bernomor '1' adalah peraturan yang sama", async () => {
      await sisipkan(l, [{ uri: "/akn/id/act/pp/2022/01", jenis: "PP", nomor: "01", tahun: 2022, judul: "PP 01/2022" }]);
      const b = await manifest([dokumen("9", { Judul: "Peraturan Pemerintah Nomor 1 Tahun 2022 tentang Contoh", Nomor: "1", Tahun: "2022" })]);
      expect(b.diterima).toBe(1);
      expect((await semuaLaws()).map((r) => r.frbr_uri)).toEqual(["/akn/id/act/pp/2022/01"]);
    });

    it("Tap MPR: dokumen 'XVI/MPR/1998' masuk ke baris yang paling berisi di antara tiga duplikat", async () => {
      const tap = (uri: string, nomor: string, ubah: Partial<PeraturanUji> = {}): PeraturanUji => ({ uri, jenis: "TAP_MPR", nomor, tahun: 1998, judul: `Ketetapan MPR ${nomor}`, ...ubah });
      await sisipkan(l, [
        tap("/akn/id/act/tap_mpr/1998/XVI-MPR-1998", "XVI-MPR-1998"),
        tap("/akn/id/act/tap-mpr/1998/xvi-mpr-1998", "xvi-mpr-1998", { pasal: [{ nomor: "1", isi: "Isi." }] }),
      ]);
      const b = await manifest([dokumen("210109", { Judul: "Ketetapan MPR Nomor XVI/MPR/1998 tentang Politik Ekonomi", "Bentuk Singkat": "TAP MPR", Nomor: "XVI/MPR/1998", Tahun: "1998" })]);
      expect(b.diterima).toBe(1);
      const baris = await semuaLaws();
      expect(baris).toHaveLength(2);
      expect(baris.find((r) => r.bpk_id === "210109")?.frbr_uri).toBe("/akn/id/act/tap-mpr/1998/xvi-mpr-1998");
    });

    it("Tap MPR yang belum ada dibuat dengan URI dan nomor ala baris yang sudah ada, bukan URI bergaris miring", async () => {
      await manifest([dokumen("210109", { Judul: "Ketetapan MPR Nomor XVI/MPR/1998 tentang Politik Ekonomi", "Bentuk Singkat": "TAP MPR", Nomor: "XVI/MPR/1998", Tahun: "1998" })]);
      expect(await semuaLaws()).toEqual([expect.objectContaining({ frbr_uri: "/akn/id/act/tap-mpr/1998/xvi-mpr-1998", nomor: "xvi-mpr-1998", jenis: "TAP_MPR" })]);
    });

    it("kiriman ulang dokumen Tap MPR tidak menggandakan baris", async () => {
      const d = dokumen("210109", { Judul: "Ketetapan MPR Nomor XVI/MPR/1998 tentang Politik Ekonomi", "Bentuk Singkat": "TAP MPR", Nomor: "XVI/MPR/1998", Tahun: "1998" });
      await manifest([d]);
      await manifest([d]);
      expect(await semuaLaws()).toHaveLength(1);
    });

    it("relasi menuju peraturan yang sudah ada memakai URI-nya yang ada (bukan URI turunan yang tak dikenal)", async () => {
      await sisipkan(l, [perpu]);
      await manifest([dokumen("1", { Judul: "Peraturan Pemerintah Nomor 5 Tahun 2023 tentang Contoh", Nomor: "5", Tahun: "2023" }, {
        relasi: [
          { label: "Mengubah", bpk_id: null, teks: "Peraturan Pemerintah Pengganti Undang-Undang Nomor 2 Tahun 2022 tentang Cipta Kerja" },
          { label: "Mengubah", bpk_id: null, teks: "Peraturan Pemerintah Nomor 35 Tahun 2021" }, // belum ada di Lexa: URI turunan
          { label: "Terkait", bpk_id: null, teks: "Peraturan Pemerintah Nomor 5 Tahun 2023" }, // dirinya sendiri: dilewati
        ],
      })]);
      expect((await l.db.prepare(`SELECT to_uri, jenis_relasi FROM relations ORDER BY to_uri`).all()).results).toEqual([
        { to_uri: "/akn/id/act/perpu/2022/2", jenis_relasi: "mengubah" },
        { to_uri: "/akn/id/act/pp/2021/35", jenis_relasi: "mengubah" },
      ]);
    });
  });

  describe("kiriman yang berisi entri aneh", () => {
    it("null, angka, dan metadata bukan objek ditolak satu per satu; dokumen yang sah tetap tersimpan (bukan 500)", async () => {
      const res = await panggil(l, "/api/impor/manifest", kirim("POST", {
        versi: 1,
        dokumen: [null, 5, { bpk_id: "7", meta: "bukan objek" }, dokumen("1", { Judul: "Peraturan Pemerintah Nomor 5 Tahun 2021 tentang Contoh", Nomor: "5", Tahun: "2021" })],
      }, adm));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        diterima: 1,
        ditolak: [
          { bpk_id: "", alasan: "entri bukan objek" },
          { bpk_id: "", alasan: "entri bukan objek" },
          { bpk_id: "7", alasan: "metadata inti tidak lengkap" },
        ],
        butuh_pdf: ["/akn/id/act/pp/2021/5"],
      });
    });
  });

  describe("pembaruan metadata yang hati-hati", () => {
    const awal: PeraturanUji = { uri: "/akn/id/act/pp/2021/5", jenis: "PP", nomor: "5", tahun: 2021, judul: "Peraturan Pemerintah Nomor 5 Tahun 2021 tentang Penyelenggaraan Perizinan", status: "dicabut" };

    it("halaman tanpa Status tidak menjadikan peraturan 'berlaku'; yang menyebut Status memperbaruinya", async () => {
      await sisipkan(l, [awal]);
      const tanpaStatus = dokumen("1", { Judul: "Peraturan Pemerintah Nomor 5 Tahun 2021 tentang Penyelenggaraan Perizinan", Nomor: "5", Tahun: "2021" });
      delete (tanpaStatus.meta as Record<string, string>).Status;
      await manifest([tanpaStatus]);
      expect((await semuaLaws())[0].status).toBe("dicabut");
      await manifest([dokumen("1", { Judul: "Peraturan Pemerintah Nomor 5 Tahun 2021 tentang Penyelenggaraan Perizinan", Nomor: "5", Tahun: "2021", Status: "Berlaku" })]);
      expect((await semuaLaws())[0].status).toBe("berlaku");
    });

    it("judul BPK tanpa pokok ('tentang') tidak menggantikan judul lama yang memilikinya; judul baru yang berpokok menggantikan judul bersampah", async () => {
      await sisipkan(l, [awal]);
      await manifest([dokumen("1", { Judul: "PP No. 5 Tahun 2021", Nomor: "5", Tahun: "2021" })]);
      expect((await semuaLaws())[0].judul).toBe(awal.judul);
      await l.db.prepare(`UPDATE laws SET judul = 'Peraturan Pemerintah Nomor 5 Tahun 2021 tentang PERATURANPEMERINTAH REPUBLIK INDONESIANOMOR 5' WHERE frbr_uri = ?`).bind(awal.uri).run();
      await manifest([dokumen("1", { Judul: "Peraturan Pemerintah Nomor 5 Tahun 2021 tentang Penyelenggaraan Perizinan", Nomor: "5", Tahun: "2021" })]);
      expect((await semuaLaws())[0].judul).toBe(awal.judul);
    });

    it("judul lama tanpa pokok digantikan judul BPK mana pun", async () => {
      await sisipkan(l, [{ ...awal, judul: "Peraturan Pemerintah Nomor 5 Tahun 2021" }]);
      await manifest([dokumen("1", { Judul: "PP No. 5 Tahun 2021 resmi", Nomor: "5", Tahun: "2021" })]);
      expect((await semuaLaws())[0].judul).toBe("PP No. 5 Tahun 2021 resmi");
    });
  });

  describe("lexa_uri: memperkaya peraturan yang sedang dipanen", () => {
    const awal: PeraturanUji = { uri: "/akn/id/act/pp/2021/5", jenis: "PP", nomor: "5", tahun: 2021, judul: "Peraturan Pemerintah Nomor 5 Tahun 2021" };

    it("memperbarui baris yang dituju", async () => {
      await sisipkan(l, [awal]);
      const b = await manifest([dokumen("1", { Judul: "Peraturan Pemerintah Nomor 5 Tahun 2021 tentang Perizinan", Nomor: "5", Tahun: "2021", Bidang: "PERIZINAN" }, { lexa_uri: awal.uri })]);
      expect(b).toMatchObject({ diterima: 1, ditolak: [], butuh_pdf: [awal.uri] });
      expect(await l.db.prepare(`SELECT judul, bidang, bpk_id FROM laws`).first()).toEqual({ judul: "Peraturan Pemerintah Nomor 5 Tahun 2021 tentang Perizinan", bidang: "PERIZINAN", bpk_id: "1" });
    });

    it("tidak pernah membuat baris: uri yang tak ada ditolak", async () => {
      const b = await manifest([dokumen("1", { Judul: "Peraturan Pemerintah Nomor 5 Tahun 2021", Nomor: "5", Tahun: "2021" }, { lexa_uri: "/akn/id/act/pp/2021/5" })]);
      expect(b.diterima).toBe(0);
      expect(b.ditolak).toEqual([{ bpk_id: "1", alasan: "/akn/id/act/pp/2021/5 tidak ada di Lexa" }]);
      expect(await semuaLaws()).toEqual([]);
    });

    it("metadata yang salah baca (sitasi tak cocok) tidak menimpa peraturan yang dituju", async () => {
      await sisipkan(l, [awal]);
      const b = await manifest([dokumen("1", { Judul: "Peraturan Pemerintah Nomor 9 Tahun 2020 tentang Lain", Nomor: "9", Tahun: "2020" }, { lexa_uri: awal.uri })]);
      expect(b.diterima).toBe(0);
      expect(b.ditolak[0].alasan).toBe("sitasi dokumen (PP 9/2020) tidak cocok dengan /akn/id/act/pp/2021/5");
      expect((await semuaLaws())[0]).toMatchObject({ judul: awal.judul, bpk_id: null });
    });
  });

  describe("kegagalan satu dokumen", () => {
    it("tidak menjatuhkan dokumen lain: yang gagal ada di ditolak, yang sehat tersimpan", async () => {
      await sisipkan(l, [1, 2, 3].map((n): PeraturanUji => ({ uri: `/akn/id/act/pp/2021/${n}`, jenis: "PP", nomor: String(n), tahun: 2021, judul: `PP ${n}/2021 tentang Contoh` })));
      l.sqlite.exec(`CREATE TRIGGER uji_gagal BEFORE UPDATE ON laws WHEN new.frbr_uri = '/akn/id/act/pp/2021/2' BEGIN SELECT RAISE(ABORT, 'uji: ditolak'); END`);
      const b = await manifest([1, 2, 3].map((n) => dokumen(String(n), { Judul: `PP ${n}/2021 tentang Contoh`, Nomor: String(n), Tahun: "2021" })));
      expect(b.diterima).toBe(2);
      expect(b.ditolak).toEqual([{ bpk_id: "2", alasan: expect.stringContaining("gagal disimpan") }]);
      expect((await semuaLaws()).map((r) => r.bpk_id)).toEqual(["1", null, "3"]);
    });
  });

  describe("urutan daftar kerja", () => {
    const hukum = (jenis: string, nomor: string, tahun: number, ubah: Partial<PeraturanUji> = {}): PeraturanUji => ({
      uri: `/akn/id/act/${jenis === "TAP_MPR" ? "tap-mpr" : jenis.toLowerCase()}/${tahun}/${nomor}`, jenis, nomor, tahun, judul: `${jenis} ${nomor}/${tahun}`, ...ubah,
    });
    const urutan = async (q = "") => (await json<{ daftar: Array<{ frbr_uri: string }> }>(await panggil(l, `/api/impor/butuh-teks${q}`, { headers: adm }))).daftar.map((d) => d.frbr_uri);

    it("yang bertaut ke BPK dahulu; lalu menurut jenis (UUD, Tap MPR, UU, Perppu, PP); di dalam jenis yang terbaru; sisanya menurut URI", async () => {
      await sisipkan(l, [
        hukum("PP", "1", 2020), hukum("PP", "2", 2023), hukum("PERPPU", "1", 2022), hukum("UU", "7", 1999), hukum("UU", "9", 2021),
        hukum("TAP_MPR", "I", 1998), hukum("UUD", "1945", 1945), hukum("PP", "3", 2023, { bpkId: "77" }), hukum("UU", "8", 2021),
      ]);
      expect(await urutan()).toEqual([
        "/akn/id/act/pp/2023/3", // bertaut ke BPK
        "/akn/id/act/uud/1945/1945",
        "/akn/id/act/tap-mpr/1998/I",
        "/akn/id/act/uu/2021/8", // tahun sama: menurut URI
        "/akn/id/act/uu/2021/9",
        "/akn/id/act/uu/1999/7",
        "/akn/id/act/perppu/2022/1",
        "/akn/id/act/pp/2023/2",
        "/akn/id/act/pp/2020/1",
      ]);
    });

    it("tahun yang tak diketahui (0) paling akhir di dalam jenisnya, tetapi jenis tetap didahulukan", async () => {
      await sisipkan(l, [hukum("PP", "1", 2024), hukum("UU", "1", 0), hukum("UU", "2", 2024)]);
      expect(await urutan()).toEqual(["/akn/id/act/uu/2024/2", "/akn/id/act/uu/0/1", "/akn/id/act/pp/2024/1"]);
    });
  });

  describe("POST /api/impor/tanpa-berkas dan daftar kerja", () => {
    const urut = (n: number): PeraturanUji => ({ uri: `/akn/id/act/perppu/1960/${n}`, jenis: "PERPPU", nomor: String(n), tahun: 1960, judul: `Perppu ${n}/1960 tentang Contoh` });
    const kerja = async (q = "") => json<{ daftar: Array<{ frbr_uri: string }>; total: number; tanpa_berkas: number }>(await panggil(l, `/api/impor/butuh-teks${q}`, { headers: adm }));
    const tandai = (badan: unknown) => panggil(l, "/api/impor/tanpa-berkas", kirim("POST", badan, adm));

    beforeEach(async () => {
      await sisipkan(l, [urut(1), urut(2), urut(3)]);
    });

    it("yang ditandai tak muncul lagi di daftar kerja (kecuali ?semua=1) dan dihitung terpisah", async () => {
      const res = await tandai({ uris: [urut(1).uri, urut(2).uri, "/akn/id/act/perppu/1960/99"] });
      expect(await res.json()).toEqual({ ditandai: 2, tidak_dikenal: 1 });
      const b = await kerja();
      expect(b.daftar.map((d) => d.frbr_uri)).toEqual([urut(3).uri]);
      expect(b).toMatchObject({ total: 1, tanpa_berkas: 2 });
      expect((await kerja("?semua=1")).daftar).toHaveLength(3);
    });

    it("menandai ulang tidak menggandakan, dan alasan dicatat", async () => {
      await tandai({ uris: [urut(1).uri], alasan: "BPK: berkas belum diunggah" });
      await tandai({ uris: [urut(1).uri] });
      expect((await kerja()).tanpa_berkas).toBe(1);
    });

    it("mengunggah PDF-nya kemudian menghapus penanda", async () => {
      await tandai({ uris: [urut(1).uri] });
      const res = await panggil(l, `/api/impor/pdf?uri=${encodeURIComponent(urut(1).uri)}`, { method: "PUT", headers: adm, body: PDF });
      expect(res.status).toBe(200);
      expect((await kerja()).tanpa_berkas).toBe(0);
    });

    it("badan salah -> 400; terlalu banyak -> 413; tanpa token -> 401", async () => {
      expect((await tandai({ uris: [] })).status).toBe(400);
      expect((await tandai({ uris: ["bukan-uri", 5, null] })).status).toBe(400);
      expect((await tandai({})).status).toBe(400);
      expect((await tandai({ uris: Array.from({ length: 201 }, (_, i) => `/akn/id/act/pp/2020/${i}`) })).status).toBe(413);
      expect((await panggil(l, "/api/impor/tanpa-berkas", kirim("POST", { uris: [urut(1).uri] }))).status).toBe(401);
    });
  });

  describe("GET /api/impor/ringkasan", () => {
    it("kemajuan per jenis: bertaut ke BPK, ber-PDF, berpasal, dan yang masih perlu PDF", async () => {
      await sisipkan(l, [
        { uri: "/akn/id/act/pp/2021/1", jenis: "PP", nomor: "1", tahun: 2021, judul: "A", bpkId: "11" },
        { uri: "/akn/id/act/pp/2021/2", jenis: "PP", nomor: "2", tahun: 2021, judul: "B", pasal: [{ nomor: "1", isi: "Isi." }] },
        { uri: "/akn/id/act/pp/2021/3", jenis: "PP", nomor: "3", tahun: 2021, judul: "C" },
        { uri: "/akn/id/act/uu/2020/1", jenis: "UU", nomor: "1", tahun: 2020, judul: "D" },
      ]);
      await l.db.prepare(`UPDATE laws SET r2_pdf_key = 'pdf/x.pdf' WHERE frbr_uri = '/akn/id/act/pp/2021/3'`).run();
      await panggil(l, "/api/impor/tanpa-berkas", kirim("POST", { uris: ["/akn/id/act/uu/2020/1"] }, adm));
      const b = await json<{ per_jenis: Array<Record<string, unknown>>; tanpa_berkas: number }>(await panggil(l, "/api/impor/ringkasan", { headers: adm }));
      expect(b.per_jenis.find((r) => r.jenis === "PP")).toEqual({ jenis: "PP", total: 3, bertaut_bpk: 1, ber_pdf: 1, berpasal: 1, pdf_belum_berpasal: 1, perlu_pdf: 1 });
      expect(b.per_jenis.find((r) => r.jenis === "UU")).toMatchObject({ total: 1, perlu_pdf: 1 });
      expect(b.tanpa_berkas).toBe(1);
      expect((await panggil(l, "/api/impor/ringkasan")).status).toBe(401);
    });
  });

  describe("PDF yang bukan naskah peraturannya", () => {
    const URI = "/akn/id/act/pp/2025/99";
    const baris = (judul: string) => ["PRESIDEN", "REPUBLIK INDONESIA", judul, "TENTANG PENGELOLAAN SAMPAH", "BAB I", "Pasal 1", "Sampah dikelola.", "Pasal 2", "Setiap orang wajib memilah sampah."].join("\n");
    const unggah = () => panggil(l, `/api/impor/pdf?uri=${encodeURIComponent(URI)}`, { method: "PUT", headers: adm, body: PDF });

    beforeEach(async () => {
      await manifest([dokumen("555", { Judul: "Peraturan Pemerintah Nomor 99 Tahun 2025 tentang Pengelolaan Sampah", Nomor: "99", Tahun: "2025" })]);
    });

    it("judul resmi milik peraturan lain: pasal tidak disimpan, dicatat dengan jelas, dan tak masuk daftar kerja lagi", async () => {
      l.ai.markdown.set("99.pdf", baris("PERATURAN PEMERINTAH REPUBLIK INDONESIA NOMOR 5 TAHUN 2021"));
      await unggah();
      await kurasSemua(l);
      expect(await l.db.prepare(`SELECT jumlah_pasal, isi_status, r2_text_key FROM laws`).first()).toEqual({ jumlah_pasal: 0, isi_status: "menunggu", r2_text_key: null });
      expect((await l.db.prepare(`SELECT COUNT(*) AS n FROM articles`).first<{ n: number }>())?.n).toBe(0);
      const catatan = "PDF memuat judul PP 5/2021, bukan PP 99/2025: pasal tidak disimpan";
      expect(await l.db.prepare(`SELECT vonis, jumlah_pasal, catatan FROM ekstraksi_log`).first()).toEqual({ vonis: "gagal", jumlah_pasal: 0, catatan });
      expect(await l.db.prepare(`SELECT isi_catatan FROM laws`).first()).toEqual({ isi_catatan: catatan });
      expect((await l.db.prepare(`SELECT status, detail FROM sync_log WHERE job = 'ekstrak_pdf'`).all()).results).toEqual([{ status: "gagal", detail: `${URI}: ${catatan}` }]);
      expect(l.vektor.simpan.size).toBe(0);
      // Teks konversi diarsipkan untuk diperiksa, PDF-nya tetap ada, dan peraturannya tak diminta PDF lagi.
      expect(await l.r2.get("teks/akn/id/act/pp/2025/99.md").then((o) => o?.text())).toContain("NOMOR 5 TAHUN 2021");
      expect(l.r2.objek.has("pdf/akn/id/act/pp/2025/99.pdf")).toBe(true);
      expect((await json<{ daftar: unknown[] }>(await panggil(l, "/api/impor/butuh-teks", { headers: adm }))).daftar).toEqual([]);
    });

    it("judul resmi milik peraturannya: diproses seperti biasa", async () => {
      l.ai.markdown.set("99.pdf", baris("PERATURAN PEMERINTAH REPUBLIK INDONESIA NOMOR 99 TAHUN 2025"));
      await unggah();
      await kurasSemua(l);
      expect(await l.db.prepare(`SELECT jumlah_pasal, isi_status FROM laws`).first()).toEqual({ jumlah_pasal: 2, isi_status: "lengkap" });
      expect(await l.db.prepare(`SELECT vonis, catatan FROM ekstraksi_log`).first()).toEqual({ vonis: "bersih", catatan: null });
    });

    it("tanpa judul resmi yang dikenali: diproses seperti biasa (tak ada bukti yang jelas untuk menolak)", async () => {
      l.ai.markdown.set("99.pdf", ["# PP 99/2025", "Pasal 1", "Sampah dikelola."].join("\n"));
      await unggah();
      await kurasSemua(l);
      expect((await l.db.prepare(`SELECT jumlah_pasal FROM laws`).first<{ jumlah_pasal: number }>())?.jumlah_pasal).toBe(1);
    });

    it("ekstrak-ulang mencoba lagi dari PDF yang tersimpan, dan lolos bila naskahnya kini cocok", async () => {
      l.ai.markdown.set("99.pdf", baris("PERATURAN PEMERINTAH REPUBLIK INDONESIA NOMOR 5 TAHUN 2021"));
      await unggah();
      await kurasSemua(l);
      expect((await l.db.prepare(`SELECT jumlah_pasal FROM laws`).first<{ jumlah_pasal: number }>())?.jumlah_pasal).toBe(0);
      l.ai.markdown.set("99.pdf", baris("PERATURAN PEMERINTAH REPUBLIK INDONESIA NOMOR 99 TAHUN 2025"));
      await panggil(l, "/api/impor/ekstrak-ulang", kirim("POST", {}, adm));
      await kurasSemua(l);
      expect((await l.db.prepare(`SELECT jumlah_pasal FROM laws`).first<{ jumlah_pasal: number }>())?.jumlah_pasal).toBe(2);
    });
  });

  describe("POST /api/impor/ekstrak-ulang", () => {
    const pdfBerisi = async (n: number, ubah: { pasal?: boolean } = {}) => {
      const p: PeraturanUji = { uri: `/akn/id/act/pp/2021/${n}`, jenis: "PP", nomor: String(n), tahun: 2021, judul: `PP ${n}/2021`, pasal: ubah.pasal ? [{ nomor: "1", isi: "Isi." }] : undefined };
      await sisipkan(l, [p]);
      await l.db.prepare(`UPDATE laws SET r2_pdf_key = ? WHERE frbr_uri = ?`).bind(`pdf/akn/id/act/pp/2021/${n}.pdf`, p.uri).run();
      return p.uri;
    };
    const ulang = (badan: unknown = {}) => panggil(l, "/api/impor/ekstrak-ulang", kirim("POST", badan, adm));

    it("`batas` pecahan dibulatkan ke bawah, bukan galat 500 (LIMIT menolak bilangan pecahan) di semua route yang memakainya", async () => {
      await pdfBerisi(1);
      await pdfBerisi(2);
      await pdfBerisi(3);
      const res = await ulang({ batas: 2.5 });
      expect(res.status).toBe(200);
      expect(await json(res)).toMatchObject({ diantrekan: 2 });
      expect((await ulang({ usang: true, batas: 2.5 })).status).toBe(200);
      expect((await panggil(l, "/api/impor/butuh-teks?batas=2.5", { headers: adm })).status).toBe(200);
      expect((await panggil(l, "/api/impor/ringkas", kirim("POST", { batas: 2.5 }, adm))).status).toBe(200);
    });

    it("mengantrekan peraturan ber-PDF yang belum berpasal; yang berpasal atau tanpa PDF tidak", async () => {
      const a = await pdfBerisi(1);
      await pdfBerisi(2, { pasal: true });
      await sisipkan(l, [{ uri: "/akn/id/act/pp/2021/3", jenis: "PP", nomor: "3", tahun: 2021, judul: "PP 3/2021" }]);
      const res = await ulang();
      expect(await res.json()).toEqual({ diantrekan: 1, belum_berpasal: 1, uris: [a] });
      expect(l.antrean.pesan).toEqual([{ tipe: "ekstrak_pdf", frbr_uri: a, r2_key: "pdf/akn/id/act/pp/2021/1.pdf" }]);
    });

    it("dariTeks: true menandai pesan agar arsip teks diuraikan tanpa konversi; nilai lain diabaikan dan pesan lama tak berubah", async () => {
      const a = await pdfBerisi(1);
      await ulang({ dariTeks: true });
      expect(l.antrean.kuras()).toEqual([{ tipe: "ekstrak_pdf", frbr_uri: a, r2_key: "pdf/akn/id/act/pp/2021/1.pdf", dari_teks: true }]);
      await ulang({ dariTeks: "ya" });
      await ulang({ dariTeks: false });
      expect(l.antrean.kuras()).toEqual([
        { tipe: "ekstrak_pdf", frbr_uri: a, r2_key: "pdf/akn/id/act/pp/2021/1.pdf" },
        { tipe: "ekstrak_pdf", frbr_uri: a, r2_key: "pdf/akn/id/act/pp/2021/1.pdf" },
      ]);
    });

    it("dariTeks: true memulihkan pasal dari arsip teks yang ada, tanpa konversi dan tanpa PDF", async () => {
      const uri = await pdfBerisi(1);
      await l.r2.put("teks/akn/id/act/pp/2021/1.md", ["BAB I", "Pasal 1.", "Sampah rumah tangga dikelola.", "Pasal 2.", "Setiap orang wajib memilah sampah."].join("\n"));
      await l.db.prepare(`UPDATE laws SET r2_text_key = 'teks/akn/id/act/pp/2021/1.md' WHERE frbr_uri = ?`).bind(uri).run();
      await ulang({ dariTeks: true });
      const { jalankanAntrean } = await import("./harness");
      await jalankanAntrean(l, l.antrean.kuras());
      expect(l.ai.konversi).toEqual([]);
      expect((await l.db.prepare(`SELECT jumlah_pasal FROM laws WHERE frbr_uri = ?`).bind(uri).first<{ jumlah_pasal: number }>())?.jumlah_pasal).toBe(2);
    });

    it("yang belum pernah dicoba didahulukan, dan batas dihormati", async () => {
      const uris = [await pdfBerisi(1), await pdfBerisi(2), await pdfBerisi(3)];
      await l.db.prepare(`INSERT INTO ekstraksi_log (frbr_uri, vonis, created_at) VALUES (?, 'tanpa_pasal', '2026-10-01 00:00:00')`).bind(uris[0]).run();
      await l.db.prepare(`INSERT INTO ekstraksi_log (frbr_uri, vonis, created_at) VALUES (?, 'tanpa_pasal', '2026-10-02 00:00:00')`).bind(uris[1]).run();
      const b = await json<{ diantrekan: number; uris: string[] }>(await ulang({ batas: 2 }));
      expect(b.uris).toEqual([uris[2], uris[0]]); // belum pernah dicoba, lalu yang percobaannya paling lama
      expect(b.diantrekan).toBe(2);
    });

    it("dengan uri: peraturan itu saja, walau sudah berpasal; tanpa PDF tidak diantrekan", async () => {
      const berpasal = await pdfBerisi(2, { pasal: true });
      await sisipkan(l, [{ uri: "/akn/id/act/pp/2021/3", jenis: "PP", nomor: "3", tahun: 2021, judul: "PP 3/2021" }]);
      expect(((await (await ulang({ uri: berpasal })).json()) as { diantrekan: number }).diantrekan).toBe(1);
      expect(((await (await ulang({ uri: "/akn/id/act/pp/2021/3" })).json()) as { diantrekan: number }).diantrekan).toBe(0);
      expect(l.antrean.pesan).toHaveLength(1);
    });

    it("jenis di luar cakupan -> 400; tanpa token -> 401; tanpa yang perlu diulang -> 0", async () => {
      expect((await ulang({ jenis: ["PERPRES"] })).status).toBe(400);
      expect((await panggil(l, "/api/impor/ekstrak-ulang", kirim("POST", {}))).status).toBe(401);
      expect(await (await ulang()).json()).toEqual({ diantrekan: 0, belum_berpasal: 0, uris: [] });
    });

    describe("usang: uraikan ulang yang terakhir diurai dengan versi pengurai lama", () => {
      const kode = VERSI_PARSER;
      const dengan = async (n: number, o: { versi?: number; vonis?: string; pdf?: boolean; jenis?: string } = {}) => {
        const uri = `/akn/id/act/${(o.jenis ?? "PP").toLowerCase()}/2021/${n}`;
        await sisipkan(l, [{ uri, jenis: o.jenis ?? "PP", nomor: String(n), tahun: 2021, judul: `P ${n}/2021` }]);
        if (o.pdf !== false) await l.db.prepare(`UPDATE laws SET r2_pdf_key = ? WHERE frbr_uri = ?`).bind(`pdf${uri}.pdf`, uri).run();
        await l.db.prepare(`INSERT INTO ekstraksi_log (frbr_uri, vonis, versi_parser) VALUES (?, ?, ?)`).bind(uri, o.vonis ?? "bersih", o.versi ?? 0).run();
        return uri;
      };
      const pesanUsang = (uri: string) => ({ tipe: "ekstrak_pdf", frbr_uri: uri, r2_key: `pdf${uri}.pdf`, dari_teks: true });

      it("hanya yang versinya lebih lama, ber-PDF, dan bukan hasil gagal; semuanya dari arsip teks; menurut urutan alamat", async () => {
        const b = await dengan(2);
        const a = await dengan(1);
        await dengan(3, { versi: kode });
        await dengan(4, { pdf: false });
        await dengan(5, { vonis: "gagal" });
        const tanpaPasal = await dengan(6, { vonis: "tanpa_pasal" });
        const res = await ulang({ usang: true });
        expect(await res.json()).toEqual({
          diantrekan: 3, usang_tersisa: 3, versi_parser: kode, terakhir: tanpaPasal, uris: [a, b, tanpaPasal],
        });
        expect(l.antrean.kuras()).toEqual([pesanUsang(a), pesanUsang(b), pesanUsang(tanpaPasal)]);
      });

      it("setelah dan batas memotong putaran: satu panggilan demi satu sampai diantrekan 0", async () => {
        const uris = [await dengan(1), await dengan(2), await dengan(3), await dengan(4), await dengan(5)];
        const dikumpulkan: string[] = [];
        let setelah: string | undefined;
        for (let putaran = 0; putaran < 5; putaran++) {
          const b = await json<{ diantrekan: number; terakhir: string | null; uris: string[] }>(await ulang({ usang: true, batas: 2, setelah }));
          if (!b.diantrekan) break;
          dikumpulkan.push(...b.uris);
          setelah = b.terakhir ?? undefined;
        }
        expect(dikumpulkan).toEqual(uris);
        expect(l.antrean.pesan).toHaveLength(5);
      });

      it("yang sudah diurai ulang tak ditawarkan lagi (usang_tersisa menyusut), walau diproses dengan galat versi tak berubah", async () => {
        const uri = await dengan(1);
        l.r2.objek.set(`pdf${uri}.pdf`, { bytes: PDF });
        await l.r2.put("teks/akn/id/act/pp/2021/1.md", "Pasal 1\nSatu.");
        await l.db.prepare(`UPDATE laws SET r2_text_key = 'teks/akn/id/act/pp/2021/1.md' WHERE frbr_uri = ?`).bind(uri).run();
        expect(await json(await ulang({ usang: true }))).toMatchObject({ diantrekan: 1, usang_tersisa: 1 });
        const { jalankanAntrean } = await import("./harness");
        await jalankanAntrean(l, l.antrean.kuras());
        expect(l.ai.konversi).toEqual([]);
        expect(await json(await ulang({ usang: true }))).toEqual({ diantrekan: 0, usang_tersisa: 0, versi_parser: kode, terakhir: null, uris: [] });
      });

      it("jenis menyaring dan dijepit pada cakupan; tanpa token 401", async () => {
        await dengan(1);
        await dengan(2, { jenis: "UU" });
        expect(await json(await ulang({ usang: true, jenis: ["UU"] }))).toMatchObject({ diantrekan: 1, usang_tersisa: 1 });
        expect((await ulang({ usang: true, jenis: ["PERPRES"] })).status).toBe(400);
        expect((await panggil(l, "/api/impor/ekstrak-ulang", kirim("POST", { usang: true }))).status).toBe(401);
      });

      it("migrasi 0007 belum diterapkan: 503 dengan petunjuk, tanpa mengantrekan apa pun", async () => {
        await dengan(1);
        await l.db.exec(`DROP INDEX idx_ekstraksi_versi`);
        await l.db.exec(`ALTER TABLE ekstraksi_log DROP COLUMN versi_parser`);
        const res = await ulang({ usang: true });
        expect(res.status).toBe(503);
        expect(await res.json()).toMatchObject({ error: "migrasi_belum_diterapkan", message: expect.stringContaining("migrasi 0007") });
        expect(l.antrean.pesan).toEqual([]);
      });
    });

    it("pesan yang diantrekan benar-benar diproses konsumer antrean dan menghasilkan pasal", async () => {
      const uri = await pdfBerisi(1);
      l.r2.objek.set("pdf/akn/id/act/pp/2021/1.pdf", { bytes: PDF });
      l.ai.markdown.set("1.pdf", ["BAB I", "Pasal 1", "Sampah rumah tangga dikelola.", "Pasal 2", "Setiap orang wajib memilah sampah."].join("\n"));
      await ulang();
      const { jalankanAntrean } = await import("./harness");
      await jalankanAntrean(l, l.antrean.kuras());
      expect((await l.db.prepare(`SELECT jumlah_pasal FROM laws WHERE frbr_uri = ?`).bind(uri).first<{ jumlah_pasal: number }>())?.jumlah_pasal).toBe(2);
    });
  });
});
