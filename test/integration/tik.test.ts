/**
 * Tik (Cron per menit): pengosongan daftar hapus (berkas R2 dan vektor Vectorize), diagnosis bentuk respons
 * pasal.id, jeda batas laju, dan pinjaman antar-eksekusi.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buatLingkungan, CRON_HARIAN, CRON_MENIT, jalankanCron, konteksIngestUji, sqliteAda, type Lingkungan,
} from "./harness";
import { PasalClient } from "../../src/worker/lib/pasal";
import { jalankanTik } from "../../src/worker/lib/tik";
import { KUNCI_DIAG, PEMERIKSAAN } from "../../src/worker/lib/diagnosa";

const WAKTU = Date.parse("2026-10-11T12:00:00Z");
const menit = (n: number) => WAKTU + n * 60_000;

describe.skipIf(!sqliteAda)("tik (Cron per menit)", () => {
  let l: Lingkungan;
  let panggilanPasal: URL[];

  beforeEach(() => {
    l = buatLingkungan();
    panggilanPasal = [];
    (PasalClient as unknown as { bentukDetail: string | null }).bentukDetail = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    l.tutup();
  });

  const tik = (sekarang = WAKTU, pasalSiap = true) => jalankanTik(konteksIngestUji(l), { pasalSiap, sekarang });
  const tanamTandaHapus = async (jenis: "r2" | "vektor", kunci: string[]) => {
    for (const k of kunci) await l.db.prepare(`INSERT INTO daftar_hapus (jenis_objek, kunci) VALUES (?, ?)`).bind(jenis, k).run();
  };
  const sisaHapus = async (jenis: "r2" | "vektor") =>
    (await l.db.prepare(`SELECT COUNT(*) AS n FROM daftar_hapus WHERE jenis_objek = ?`).bind(jenis).first<{ n: number }>())?.n;
  const tanamSemuaDiagnosa = async () => {
    for (const p of PEMERIKSAAN) await l.db.prepare(`INSERT INTO sync_state (key, value) VALUES (?, '{}')`).bind(KUNCI_DIAG + p.kunci).run();
  };
  const perubahanTotal = () => Number(l.sqlite.prepare("SELECT total_changes() AS n").get()?.n);
  const log = async (job: string) =>
    (await l.db.prepare(`SELECT status, detail, jumlah FROM sync_log WHERE job = ? ORDER BY id`).bind(job).all()).results;

  function stubPasal(opsi: { batasLaju?: boolean } = {}) {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      panggilanPasal.push(url);
      if (opsi.batasLaju) return new Response("lambat", { status: 429, headers: { "retry-after": "120" } });
      if (url.pathname === "/api/laws" && url.searchParams.get("type") === "UUD") return new Response("tidak ada", { status: 404 });
      if (url.pathname === "/api/laws") {
        return Response.json(
          { total: 4, limit: 100, offset: 0, laws: [{ id: 1, frbr_uri: "/akn/id/act/uu/2003/13", title: "A", type: "UU", year: 2003, status: "berlaku", content_verified: true }] },
          { headers: { "x-ratelimit-remaining": "57" } },
        );
      }
      // Detail: pohon dengan pasal berayat yang kosong, seperti pola data produksi.
      return Response.json({
        work: { id: 1, frbr_uri: url.pathname.replace("/api/laws", ""), title: "UU contoh", type: "UU", year: 2023, number: "17" },
        detail_access: "partial",
        articles: [
          { id: 1, type: "pasal", number: "1", heading: null, content: "Ketentuan.", parent_id: null, sort_order: 1 },
          { id: 2, type: "pasal", number: "2", heading: null, content: "", parent_id: null, sort_order: 2 },
          { id: 3, type: "ayat", number: "1", heading: null, content: "", parent_id: 2, sort_order: 3 },
        ],
        relationships: [],
      });
    });
  }

  describe("saat sepi", () => {
    it("tidak menulis apa pun ke D1 dan tidak menghubungi pasal.id", async () => {
      stubPasal();
      await tanamSemuaDiagnosa();
      const sebelum = perubahanTotal();
      expect(await tik()).toEqual({ dilewati: "sepi" });
      expect(perubahanTotal()).toBe(sebelum);
      expect(panggilanPasal).toEqual([]);
    });

    it("pemicu per menit di Worker menjalankan tik, bukan sapuan harian", async () => {
      stubPasal();
      await tanamSemuaDiagnosa();
      await tanamTandaHapus("r2", ["teks/a.txt"]);
      await l.r2.put("teks/a.txt", "isi");
      await jalankanCron(l, CRON_MENIT);
      expect(l.r2.objek.has("teks/a.txt")).toBe(false);
      expect(panggilanPasal).toEqual([]); // sapuan harian akan menghubungi /laws untuk tiap jenis
    });
  });

  describe("daftar hapus", () => {
    it("menghapus berkas R2 dan vektor, lalu melepas barisnya", async () => {
      await tanamSemuaDiagnosa();
      await l.r2.put("teks/akn/id/act/perpres/2022/1.txt", "isi");
      await l.r2.put("teks/akn/id/act/uu/2003/13.txt", "tetap");
      await l.vektor.upsert([
        { id: "/akn/id/act/perpres/2022/1", values: [1], metadata: {} },
        { id: "/akn/id/act/perpres/2022/1#pasal-1", values: [1], metadata: {} },
        { id: "/akn/id/act/uu/2003/13", values: [1], metadata: {} },
      ]);
      await tanamTandaHapus("r2", ["teks/akn/id/act/perpres/2022/1.txt", "teks/akn/id/act/perpres/2022/1.md"]);
      await tanamTandaHapus("vektor", ["/akn/id/act/perpres/2022/1", "/akn/id/act/perpres/2022/1#pasal-1", "/akn/id/act/perpres/2022/1#pasal-9~1"]);

      const laporan = await tik();
      expect(laporan.hapus).toEqual({ r2: 2, vektor: 3, dilepas: 0, selesai: true });
      expect([...l.r2.objek.keys()]).toEqual(["teks/akn/id/act/uu/2003/13.txt"]);
      expect([...l.vektor.simpan.keys()]).toEqual(["/akn/id/act/uu/2003/13"]);
      expect(await sisaHapus("r2")).toBe(0);
      expect(await sisaHapus("vektor")).toBe(0);
      expect(await log("hapus_objek")).toEqual([{ status: "sukses", detail: "selesai; R2 2, vektor 3", jumlah: 5 }]);

      // Sesudahnya tik kembali sepi.
      expect(await tik(menit(1))).toEqual({ dilewati: "sepi" });
    });

    it("daftar besar diproses bertahap: 500 kunci R2 dan sampai 1.000 id vektor per tik", async () => {
      await tanamSemuaDiagnosa();
      await l.db.batch(
        Array.from({ length: 1200 }, (_, i) =>
          l.db.prepare(`INSERT INTO daftar_hapus (jenis_objek, kunci) VALUES ('r2', ?)`).bind(`teks/x/${String(i).padStart(4, "0")}.txt`),
        ),
      );
      await l.db.batch(
        Array.from({ length: 1500 }, (_, i) =>
          l.db.prepare(`INSERT INTO daftar_hapus (jenis_objek, kunci) VALUES ('vektor', ?)`).bind(`/akn/id/act/x/1#p-${String(i).padStart(4, "0")}`),
        ),
      );

      const pertama = await tik(menit(0));
      expect(pertama.hapus).toMatchObject({ r2: 500, vektor: 1000, selesai: false });
      expect(l.r2.panggilanHapus[0]).toHaveLength(500);
      expect(l.vektor.panggilanHapus.every((p) => p.length <= 100)).toBe(true);
      expect(await sisaHapus("r2")).toBe(700);
      expect(await sisaHapus("vektor")).toBe(500);

      await tik(menit(1));
      const ketiga = await tik(menit(2));
      expect(ketiga.hapus).toMatchObject({ selesai: true });
      expect(await sisaHapus("r2")).toBe(0);
      expect(await sisaHapus("vektor")).toBe(0);
    });

    it("id vektor yang ditolak Vectorize diisolasi: yang lain terhapus, dan ia dilepas agar tak menahan antrean", async () => {
      await tanamSemuaDiagnosa();
      const ids = ["/a#1", "/a#2", "/a#racun", "/a#4", "/a#5"];
      await l.vektor.upsert(ids.map((id) => ({ id, values: [1], metadata: {} })));
      l.vektor.idRacun.add("/a#racun");
      await tanamTandaHapus("vektor", ids);

      const laporan = await tik();
      expect(laporan.hapus).toMatchObject({ vektor: 4, dilepas: 1, selesai: true });
      expect([...l.vektor.simpan.keys()]).toEqual(["/a#racun"]);
      expect(await sisaHapus("vektor")).toBe(0);
      expect(await log("hapus_objek")).toEqual([{ status: "sukses", detail: "selesai; R2 0, vektor 4, dilepas 1", jumlah: 4 }]);
    });

    it("galat R2: kunci tetap di daftar, tik berikutnya menunggu sepuluh menit lalu mencoba lagi", async () => {
      await tanamSemuaDiagnosa();
      await l.r2.put("teks/a.txt", "isi");
      await tanamTandaHapus("r2", ["teks/a.txt"]);
      const asli = l.r2.delete.bind(l.r2);
      l.r2.delete = async () => {
        throw new Error("R2 sedang gangguan");
      };

      const gagal = await tik(menit(0));
      expect(gagal.hapusGalat).toContain("R2 sedang gangguan");
      expect(await sisaHapus("r2")).toBe(1);
      expect(await log("hapus_objek")).toEqual([{ status: "gagal", detail: expect.stringContaining("ditunda 10 menit"), jumlah: 0 }]);

      l.r2.delete = asli;
      expect(await tik(menit(5))).toEqual({ dilewati: "sepi" }); // masih dalam jeda
      expect(l.r2.objek.has("teks/a.txt")).toBe(true);

      const pulih = await tik(menit(11));
      expect(pulih.hapus).toMatchObject({ r2: 1, selesai: true });
      expect(l.r2.objek.has("teks/a.txt")).toBe(false);
    });

    it("berjalan walau token pasal.id belum dipasang", async () => {
      stubPasal();
      await l.r2.put("teks/a.txt", "isi");
      await tanamTandaHapus("r2", ["teks/a.txt"]);
      const laporan = await tik(WAKTU, false);
      expect(laporan.hapus).toMatchObject({ r2: 1 });
      expect(laporan.diagnosa).toBeUndefined();
      expect(panggilanPasal).toEqual([]);
    });
  });

  describe("diagnosis bentuk respons pasal.id", () => {
    it("mengerjakan satu pemeriksaan per tik, menyimpan ringkasannya, dan berhenti setelah semuanya ada", async () => {
      stubPasal();
      for (let i = 0; i < PEMERIKSAAN.length; i++) {
        const laporan = await tik(menit(i));
        expect(laporan.diagnosa).toBe(PEMERIKSAAN[i].kunci);
        expect(panggilanPasal).toHaveLength(i + 1);
      }
      expect(await tik(menit(PEMERIKSAAN.length))).toEqual({ dilewati: "sepi" });
      expect(panggilanPasal).toHaveLength(PEMERIKSAAN.length);

      const baca = async (kunci: string) => {
        const baris = await l.db.prepare(`SELECT value FROM sync_state WHERE key = ?`).bind(KUNCI_DIAG + kunci).first<{ value: string }>();
        return JSON.parse(baris?.value ?? "null");
      };
      const detail = await baca("detail:uu/2023/17");
      expect(detail.status_http).toBe(200);
      expect(detail.ringkasan.detail_access).toBe("partial");
      expect(detail.ringkasan.pasal).toMatchObject({ total: 2, tanpa_teks_sama_sekali: 1, kosong_punya_ayat: 1, contoh_tanpa_teks: ["2"] });
      const daftar = await baca("daftar:semua:0");
      expect(daftar.header).toEqual({ "x-ratelimit-remaining": "57" });
      expect(daftar.ringkasan.skalar_atas).toMatchObject({ total: 4 });
    });

    it("galat HTTP (kode jenis UUD tak dikenal) disimpan sebagai temuan dan tidak diulang", async () => {
      stubPasal();
      for (let i = 0; i < PEMERIKSAAN.length; i++) await tik(menit(i));
      const baris = await l.db.prepare(`SELECT value FROM sync_state WHERE key = ?`).bind(`${KUNCI_DIAG}daftar:UUD`).first<{ value: string }>();
      const catatan = JSON.parse(baris?.value ?? "{}");
      expect(catatan.status_http).toBe(404);
      expect(catatan.galat).toContain("404");
      expect(panggilanPasal.filter((u) => u.searchParams.get("type") === "UUD")).toHaveLength(1);
    });

    it("kena 429: pemeriksaan tidak dianggap selesai, jeda dipatuhi semua tik berikutnya, lalu dilanjutkan", async () => {
      stubPasal({ batasLaju: true });
      const kena = await tik(menit(0));
      expect(kena.jedaPasalSampai).toBe(new Date(menit(0) + 120_000).toISOString());
      expect(panggilanPasal).toHaveLength(1);
      expect(await log("pasal_laju")).toEqual([{ status: "gagal", detail: expect.stringContaining("jeda"), jumlah: 0 }]);
      expect((await l.db.prepare(`SELECT COUNT(*) AS n FROM sync_state WHERE key LIKE 'diag:%'`).first<{ n: number }>())?.n).toBe(0);

      // Satu menit kemudian jeda belum habis: pasal.id tidak disentuh.
      expect(await tik(menit(1))).toEqual({ dilewati: "sepi" });
      expect(panggilanPasal).toHaveLength(1);

      stubPasal();
      const pulih = await tik(menit(3));
      expect(pulih.diagnosa).toBe(PEMERIKSAAN[0].kunci);
    });

    it("jeda yang sudah lebih panjang tidak dipendekkan oleh jeda yang lebih pendek", async () => {
      const { tundaPasal, jedaPasalSampai } = await import("../../src/worker/lib/keadaan");
      await tundaPasal(l.env.DB, 1_800_000, WAKTU);
      await tundaPasal(l.env.DB, 60_000, WAKTU);
      expect(await jedaPasalSampai(l.env.DB, WAKTU)).toBe(new Date(WAKTU + 1_800_000).toISOString());
      expect(await jedaPasalSampai(l.env.DB, WAKTU + 1_800_001)).toBeNull();
    });
  });

  describe("denyut (jejak bahwa Cron berjalan)", () => {
    const denyut = async (cron: string) =>
      (await l.db.prepare(`SELECT value FROM sync_state WHERE key = ?`).bind(`denyut:${cron}`).first<{ value: string }>())?.value;

    it("setiap eksekusi Cron meninggalkan jejak per ekspresi, juga saat tik sepi", async () => {
      stubPasal();
      await tanamSemuaDiagnosa();
      await jalankanCron(l, CRON_MENIT);
      expect(await denyut(CRON_MENIT)).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
      expect(await denyut(CRON_HARIAN)).toBeUndefined();
      await jalankanCron(l, CRON_HARIAN);
      expect(await denyut(CRON_HARIAN)).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    });

    it("tidak menulis lagi selama catatannya masih baru, dan menulis ulang sesudah lima menit", async () => {
      const { catatDenyut } = await import("../../src/worker/lib/keadaan");
      await catatDenyut(l.env.DB, CRON_MENIT, WAKTU);
      const sebelum = perubahanTotal();
      await catatDenyut(l.env.DB, CRON_MENIT, WAKTU + 60_000);
      await catatDenyut(l.env.DB, CRON_MENIT, WAKTU + 240_000);
      expect(perubahanTotal()).toBe(sebelum);
      expect(await denyut(CRON_MENIT)).toBe(new Date(WAKTU).toISOString());

      await catatDenyut(l.env.DB, CRON_MENIT, WAKTU + 301_000);
      expect(await denyut(CRON_MENIT)).toBe(new Date(WAKTU + 301_000).toISOString());
    });
  });

  describe("pinjaman antar-eksekusi", () => {
    it("tik yang tumpang tindih dengan tik lain yang masih berjalan dilewati; setelah kedaluwarsa jalan lagi", async () => {
      await tanamSemuaDiagnosa();
      await l.r2.put("teks/a.txt", "isi");
      await tanamTandaHapus("r2", ["teks/a.txt"]);
      await l.db.prepare(`INSERT INTO sync_state (key, value) VALUES ('pinjaman:tik', ?)`).bind(new Date(WAKTU + 120_000).toISOString()).run();

      expect(await tik(menit(1))).toEqual({ dilewati: "tumpang_tindih" });
      expect(l.r2.objek.has("teks/a.txt")).toBe(true);

      const lanjut = await tik(menit(3));
      expect(lanjut.hapus).toMatchObject({ r2: 1 });
    });

    it("pinjaman dilepas setelah tik selesai, juga bila langkah di dalamnya melempar galat", async () => {
      await tanamSemuaDiagnosa();
      await l.r2.put("teks/a.txt", "isi");
      await tanamTandaHapus("r2", ["teks/a.txt"]);
      l.r2.delete = async () => {
        throw new Error("gangguan");
      };
      await tik(menit(0));
      const baris = await l.db.prepare(`SELECT value FROM sync_state WHERE key = 'pinjaman:tik'`).first<{ value: string }>();
      expect(baris?.value).toBe("");
    });
  });
});
