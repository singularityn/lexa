/**
 * Endpoint admin (dijaga header x-admin-token), diagnosis token, dan laporan
 * kesalahan dari pengguna.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buatLingkungan, json, kirim, KORPUS, panggil, sisipkan, sqliteAda, TOKEN_ADMIN, type Lingkungan,
} from "./harness";

const adm = { "x-admin-token": TOKEN_ADMIN };

describe.skipIf(!sqliteAda)("admin dan laporan", () => {
  let l: Lingkungan;
  beforeEach(async () => {
    l = buatLingkungan();
    await sisipkan(l, KORPUS);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    l.tutup();
  });

  describe("pagar token", () => {
    const terlindungi: Array<[string, string, RequestInit?]> = [
      ["GET", "/api/admin/laporan"],
      ["GET", "/api/admin/ukur"],
      ["GET", "/api/admin/kueri-nihil"],
      ["POST", "/api/admin/sync", kirim("POST", {})],
      ["POST", "/api/impor/manifest", kirim("POST", { dokumen: [] })],
      ["PUT", "/api/impor/pdf?uri=/x", { method: "PUT", body: "x" }],
    ];

    it.each(terlindungi)("%s %s tanpa token -> 401", async (metode, path, init) => {
      const res = await panggil(l, path, init ?? { method: metode });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: "tidak_berwenang" });
    });

    it("token salah -> 401, token benar -> lolos", async () => {
      expect((await panggil(l, "/api/admin/laporan", { headers: { "x-admin-token": "salah" } })).status).toBe(401);
      expect((await panggil(l, "/api/admin/laporan", { headers: adm })).status).toBe(200);
    });

    it("toleran terhadap newline di ujung secret (`echo xxx | wrangler secret put`)", async () => {
      (l.env as { ADMIN_TOKEN: string }).ADMIN_TOKEN = `${TOKEN_ADMIN}\n`;
      const res = await panggil(l, "/api/admin/laporan", { headers: adm });
      expect(res.status).toBe(200);
    });

    it("tanpa ADMIN_TOKEN terpasang, semua endpoint admin tertutup", async () => {
      (l.env as { ADMIN_TOKEN: string }).ADMIN_TOKEN = "";
      const res = await panggil(l, "/api/admin/laporan", { headers: { "x-admin-token": "" } });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/admin/cek-token", () => {
    it("tanpa header: 401, menjelaskan header tidak sampai", async () => {
      const res = await panggil(l, "/api/admin/cek-token");
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ header_diterima: false, secret_terpasang: true, cocok: false });
    });

    it("token benar: 200 dan hanya boolean yang keluar", async () => {
      const res = await panggil(l, "/api/admin/cek-token", { headers: adm });
      expect(res.status).toBe(200);
      const b = await json<Record<string, unknown>>(res);
      expect(b).toMatchObject({ header_diterima: true, secret_terpasang: true, panjang_cocok: true, cocok: true, saran: "Token cocok." });
      expect(JSON.stringify(b)).not.toContain(TOKEN_ADMIN);
    });

    it("secret berspasi berlebih: ditoleransi tetapi ditandai (peramban sudah memangkas header)", async () => {
      // Header HTTP dipangkas oleh Fetch API sebelum sampai ke kode, jadi spasi
      // berlebih hanya bisa berasal dari nilai secret yang tersimpan.
      (l.env as { ADMIN_TOKEN: string }).ADMIN_TOKEN = `${TOKEN_ADMIN}\n`;
      const res = await panggil(l, "/api/admin/cek-token", { headers: adm });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ada_spasi_berlebih: true, cocok: true });
    });

    it("panjang berbeda dan panjang sama tetapi isi berbeda dibedakan", async () => {
      const pendek = await panggil(l, "/api/admin/cek-token", { headers: { "x-admin-token": "pendek" } });
      expect(await pendek.json()).toMatchObject({ panjang_cocok: false, cocok: false });
      const sama = await panggil(l, "/api/admin/cek-token", { headers: { "x-admin-token": "x".repeat(TOKEN_ADMIN.length) } });
      expect(await sama.json()).toMatchObject({ panjang_cocok: true, cocok: false, saran: "Panjang sama tetapi isinya berbeda." });
    });

    it("ADMIN_TOKEN belum terpasang -> saran memberi tahu cara memasangnya", async () => {
      (l.env as { ADMIN_TOKEN: string }).ADMIN_TOKEN = "";
      const b = await json<{ secret_terpasang: boolean; saran: string }>(await panggil(l, "/api/admin/cek-token", { headers: adm }));
      expect(b.secret_terpasang).toBe(false);
      expect(b.saran).toContain("wrangler secret put ADMIN_TOKEN");
    });
  });

  describe("CORS untuk skrip panen di peramban", () => {
    const BPK = "https://peraturan.bpk.go.id";

    it("preflight dari origin BPK diizinkan dengan header x-admin-token", async () => {
      const res = await panggil(l, "/api/impor/manifest", { method: "OPTIONS", headers: { origin: BPK } });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe(BPK);
      expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("x-admin-token");
    });

    it("origin lain tidak mendapat Access-Control-Allow-Origin", async () => {
      const res = await panggil(l, "/api/impor/manifest", { method: "OPTIONS", headers: { origin: "https://jahat.example" } });
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("jawaban 401 dari endpoint impor tetap memuat CORS agar skrip bisa membaca galatnya", async () => {
      const res = await panggil(l, "/api/impor/manifest", { ...kirim("POST", {}), headers: { origin: BPK, "content-type": "application/json" } });
      expect(res.status).toBe(401);
      expect(res.headers.get("access-control-allow-origin")).toBe(BPK);
    });

    it("cek-token dapat dipanggil lintas-origin dari BPK", async () => {
      const res = await panggil(l, "/api/admin/cek-token", { headers: { origin: BPK, ...adm } });
      expect(res.headers.get("access-control-allow-origin")).toBe(BPK);
    });
  });

  describe("POST /api/admin/sync (dihentikan)", () => {
    it("dijaga token, lalu menjawab 410 dengan petunjuk endpoint pengganti; tidak mengubah data maupun antrean", async () => {
      expect((await panggil(l, "/api/admin/sync", kirim("POST", {}))).status).toBe(401);
      const sebelum = Number(l.sqlite.prepare("SELECT total_changes() AS n").get()?.n);
      for (const badan of [{}, { tik: true }, { uri: "/akn/id/act/uu/1999/8" }, { jenis: ["UU"] }, { ringkas_kosong: true }]) {
        const res = await panggil(l, "/api/admin/sync", kirim("POST", badan, adm));
        expect(res.status, JSON.stringify(badan)).toBe(410);
        const b = await json<{ error: string; message: string }>(res);
        expect(b.error).toBe("dihentikan");
        expect(b.message).toContain("/api/impor/ringkas");
        expect(b.message).toContain("/api/impor/butuh-teks");
      }
      expect(Number(l.sqlite.prepare("SELECT total_changes() AS n").get()?.n)).toBe(sebelum);
      expect(l.antrean.pesan).toEqual([]);
    });
  });

  describe("POST /api/impor/ringkas", () => {
    const ringkas = (badan: unknown, header: Record<string, string> = adm) => panggil(l, "/api/impor/ringkas", kirim("POST", badan, header));

    it("hanya mengantrekan peraturan yang punya isi tetapi belum punya ringkasan, dan mencatatnya di sync_log", async () => {
      await l.db.prepare(`UPDATE laws SET ringkasan = 'sudah ada' WHERE frbr_uri = ?`).bind("/akn/id/act/uu/2003/13").run();
      await l.db.prepare(`UPDATE laws SET jumlah_pasal = 0 WHERE frbr_uri = ?`).bind("/akn/id/act/uu/2023/6").run();
      const b = await json<{ status: string; peraturan: number }>(await ringkas({}));
      expect(b).toEqual({ status: "diantrekan", peraturan: 2 }); // UU 11/2020 dan PP 35/2021
      const uris = (l.antrean.pesan as Array<{ tipe: string; frbr_uri: string }>).map((p) => p.frbr_uri).sort();
      expect(uris).toEqual(["/akn/id/act/pp/2021/35", "/akn/id/act/uu/2020/11"]);
      expect((l.antrean.pesan as Array<{ tipe: string }>).every((p) => p.tipe === "ringkas")).toBe(true);
      const log = await l.db.prepare(`SELECT job, status, jumlah FROM sync_log`).all();
      expect(log.results).toEqual([{ job: "ringkas", status: "sukses", jumlah: 2 }]);
    });

    it("batas dijepit pada rentang yang diizinkan, dan badan yang rusak dibaca sebagai bawaan", async () => {
      for (let i = 0; i < 3; i++) {
        await l.db
          .prepare(`INSERT INTO laws (frbr_uri, jenis, nomor, tahun, judul, jumlah_pasal) VALUES (?,?,?,?,?,1)`)
          .bind(`/akn/id/act/uu/2000/${i + 1}`, "UU", String(i + 1), 2000, `Uji ${i}`)
          .run();
      }
      await l.db.prepare(`UPDATE laws SET ringkasan = 'ada' WHERE frbr_uri NOT LIKE '/akn/id/act/uu/2000/%'`).run();
      expect((await json<{ peraturan: number }>(await ringkas({ batas: -10 }))).peraturan).toBe(1); // batas minimum 1
      expect((await json<{ peraturan: number }>(await ringkas({ batas: 2 }))).peraturan).toBe(2);
      expect((await json<{ peraturan: number }>(await ringkas({ batas: "banyak" }))).peraturan).toBe(3); // bukan angka: bawaan
      const res = await panggil(l, "/api/impor/ringkas", { method: "POST", headers: adm, body: "bukan json" });
      expect((await json<{ peraturan: number }>(res)).peraturan).toBe(3);
    });

    it("hanya jenis dalam cakupan; dijaga token admin", async () => {
      await sisipkan(l, [{ uri: "/akn/id/act/perpres/2020/1", jenis: "PERPRES", nomor: "1", tahun: 2020, judul: "Perpres", pasal: [{ nomor: "1", isi: "Isi." }] }]);
      await ringkas({});
      expect((l.antrean.pesan as Array<{ frbr_uri: string }>).map((p) => p.frbr_uri)).not.toContain("/akn/id/act/perpres/2020/1");
      expect((await panggil(l, "/api/impor/ringkas", kirim("POST", {}))).status).toBe(401);
    });
  });

  describe("POST /api/laporan", () => {
    const lapor = (badan: unknown, ip = "9.9.9.9") => panggil(l, "/api/laporan", kirim("POST", badan, { "cf-connecting-ip": ip }));
    const baris = async () => (await l.db.prepare(`SELECT frbr_uri, jenis, keterangan, konteks, status FROM laporan_kesalahan ORDER BY id`).all()).results;

    it("menyimpan laporan dan membalas 201", async () => {
      const res = await lapor({ uri: "/akn/id/act/uu/2003/13", jenis: "teks_salah", keterangan: "  Pasal 156 salah ketik  ", konteks: "ayat 1" });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ status: "diterima", pesan: "Terima kasih, laporan Anda tercatat." });
      expect(await baris()).toEqual([
        { frbr_uri: "/akn/id/act/uu/2003/13", jenis: "teks_salah", keterangan: "Pasal 156 salah ketik", konteks: "ayat 1", status: "baru" },
      ]);
    });

    it("jenis yang tidak dikenal menjadi 'lainnya'", async () => {
      await lapor({ uri: "/akn/id/act/uu/2003/13", jenis: "ngawur", keterangan: "x" });
      expect((await baris())[0]).toMatchObject({ jenis: "lainnya" });
    });

    it("uri atau keterangan kosong -> 400 dan tidak ada yang tersimpan", async () => {
      for (const b of [{}, { uri: "/x" }, { keterangan: "x" }, { uri: "/x", keterangan: "   " }]) {
        const res = await lapor(b);
        expect(res.status, JSON.stringify(b)).toBe(400);
      }
      expect(await baris()).toEqual([]);
    });

    it("keterangan dipotong 2000 karakter dan konteks 500", async () => {
      await lapor({ uri: "/a", keterangan: "k".repeat(5000), konteks: "c".repeat(900) });
      const [r] = await baris();
      expect((r.keterangan as string).length).toBe(2000);
      expect((r.konteks as string).length).toBe(500);
    });

    it("satu laporan per peraturan per menit per alamat; peraturan atau alamat lain tidak terhalang", async () => {
      expect((await lapor({ uri: "/a", keterangan: "satu" })).status).toBe(201);
      const ulang = await lapor({ uri: "/a", keterangan: "dua" });
      expect(ulang.status).toBe(429);
      expect(await ulang.json()).toMatchObject({ error: "terlalu_sering" });
      expect((await lapor({ uri: "/b", keterangan: "lain" })).status).toBe(201);
      expect((await lapor({ uri: "/a", keterangan: "alamat lain" }, "8.8.8.8")).status).toBe(201);
      expect(await baris()).toHaveLength(3);
    });

    it("badan yang bukan JSON -> 400", async () => {
      const res = await panggil(l, "/api/laporan", { method: "POST", body: "bukan json" });
      expect(res.status).toBe(400);
    });

    it("laporan muncul di /api/admin/laporan dengan judul peraturannya, yang baru lebih dulu", async () => {
      await lapor({ uri: "/akn/id/act/uu/2003/13", keterangan: "satu" });
      await l.db.prepare(`UPDATE laporan_kesalahan SET status = 'ditutup'`).run();
      await lapor({ uri: "/akn/id/act/uu/2020/11", keterangan: "dua" });
      const b = await json<{ laporan: Array<{ judul: string; status: string }> }>(
        await panggil(l, "/api/admin/laporan", { headers: adm }),
      );
      expect(b.laporan.map((r) => [r.judul, r.status])).toEqual([["Cipta Kerja", "baru"], ["Ketenagakerjaan", "ditutup"]]);
    });
  });

  describe("analitik admin", () => {
    it("kueri-nihil menghitung pencarian tanpa hasil per kueri, terbanyak dulu", async () => {
      for (const teks of ["pesawat antariksa", "Pesawat Antariksa ", "pesangon", "kapal selam"]) {
        await panggil(l, `/api/search?q=${encodeURIComponent(teks)}&mode=keyword`);
      }
      await panggil(l, `/api/search?q=${encodeURIComponent("pesawat antariksa")}&mode=keyword`);
      const b = await json<{
        total_pencarian: number; pencarian_nihil: number; persen_nihil: number;
        kueri: Array<{ query: string; frekuensi: number }>;
      }>(await panggil(l, "/api/admin/kueri-nihil", { headers: adm }));
      expect(b.total_pencarian).toBe(5);
      expect(b.pencarian_nihil).toBe(4);
      expect(b.persen_nihil).toBe(80);
      expect(b.kueri[0].frekuensi).toBe(3);
      expect(b.kueri.map((k) => k.query.trim().toLowerCase())).toEqual(["pesawat antariksa", "kapal selam"]);
    });

    it("ukur memberi ringkasan mutu ekstraksi (kosong bila belum ada dokumen)", async () => {
      const b = await json<Record<string, unknown>>(await panggil(l, "/api/admin/ukur", { headers: adm }));
      expect(b).toMatchObject({ total_diukur: 0, layak_pakai: 0, persen_layak: 0, per_vonis: [], dokumen: [] });
      expect(Object.keys(b.keterangan_vonis as object)).toEqual(["bersih", "ringan", "berat", "tanpa_pasal", "gagal"]);
    });
  });
});
