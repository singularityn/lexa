/**
 * Pemeliharaan harian (Cron 02:00 WIB), satu-satunya pekerjaan terjadwal: mengosongkan daftar hapus (berkas R2 dan vektor
 * Vectorize), memangkas log lama, dan membuang sisa keadaan pekerjaan sumber lama.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { baris, buatLingkungan, CRON_HARIAN, jalankanCron, satu, sqliteAda, type Lingkungan } from "./harness";
import { BATAS_HAPUS_MS, jalankanPemeliharaan, SIMPAN_LOG_HARI } from "../../src/worker/lib/pemeliharaan";

describe.skipIf(!sqliteAda)("pemeliharaan harian", () => {
  let l: Lingkungan;
  beforeEach(() => {
    l = buatLingkungan();
  });
  afterEach(() => {
    vi.useRealTimers();
    l.tutup();
  });

  const jalan = () => jalankanPemeliharaan({ db: l.env.DB, docs: l.env.DOCS, vectorize: l.env.VECTORIZE });
  const tanamTandaHapus = async (jenis: "r2" | "vektor", kunci: string[]) => {
    for (const k of kunci) await l.db.prepare(`INSERT INTO daftar_hapus (jenis_objek, kunci) VALUES (?, ?)`).bind(jenis, k).run();
  };
  const sisaHapus = async (jenis: "r2" | "vektor") =>
    (await satu<{ n: number }>(l, `SELECT COUNT(*) AS n FROM daftar_hapus WHERE jenis_objek = ?`, jenis))?.n;
  const logPemeliharaan = () => baris(l, `SELECT status, detail, jumlah FROM sync_log WHERE job = 'pemeliharaan' ORDER BY id`);
  const kunciState = async () => (await baris<{ key: string }>(l, `SELECT key FROM sync_state ORDER BY key`)).map((r) => r.key);

  describe("daftar hapus", () => {
    it("menghapus berkas R2 dan vektor sampai kosong, lalu melepas barisnya", async () => {
      await l.r2.put("teks/akn/id/act/perpres/2022/1.txt", "isi");
      await l.r2.put("teks/akn/id/act/uu/2003/13.txt", "tetap");
      await l.vektor.upsert([
        { id: "/akn/id/act/perpres/2022/1", values: [1], metadata: {} },
        { id: "/akn/id/act/perpres/2022/1#pasal-1", values: [1], metadata: {} },
        { id: "/akn/id/act/uu/2003/13", values: [1], metadata: {} },
      ]);
      await tanamTandaHapus("r2", ["teks/akn/id/act/perpres/2022/1.txt", "teks/akn/id/act/perpres/2022/1.md"]);
      await tanamTandaHapus("vektor", ["/akn/id/act/perpres/2022/1", "/akn/id/act/perpres/2022/1#pasal-1", "/akn/id/act/perpres/2022/1#pasal-9~1"]);

      const laporan = await jalan();
      expect(laporan.hapus).toEqual({ r2: 2, vektor: 3, dilepas: 0, selesai: true });
      expect([...l.r2.objek.keys()]).toEqual(["teks/akn/id/act/uu/2003/13.txt"]);
      expect([...l.vektor.simpan.keys()]).toEqual(["/akn/id/act/uu/2003/13"]);
      expect(await sisaHapus("r2")).toBe(0);
      expect(await sisaHapus("vektor")).toBe(0);
      expect(await logPemeliharaan()).toEqual([{ status: "sukses", detail: "R2 2, vektor 3; log dipangkas 0", jumlah: 5 }]);
    });

    it("daftar besar dikosongkan bertahap dalam satu pemeliharaan: 500 kunci R2 dan sampai 1.000 id vektor per putaran", async () => {
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

      const laporan = await jalan();
      expect(laporan.hapus).toEqual({ r2: 1200, vektor: 1500, dilepas: 0, selesai: true });
      expect(l.r2.panggilanHapus.map((p) => p.length)).toEqual([500, 500, 200]);
      expect(l.vektor.panggilanHapus.every((p) => p.length <= 100)).toBe(true);
      expect(await sisaHapus("r2")).toBe(0);
      expect(await sisaHapus("vektor")).toBe(0);
    });

    it("id vektor yang ditolak Vectorize diisolasi: yang lain terhapus, dan ia dilepas agar tak menahan antrean", async () => {
      const ids = ["/a#1", "/a#2", "/a#racun", "/a#4", "/a#5"];
      await l.vektor.upsert(ids.map((id) => ({ id, values: [1], metadata: {} })));
      l.vektor.idRacun.add("/a#racun");
      await tanamTandaHapus("vektor", ids);

      const laporan = await jalan();
      expect(laporan.hapus).toEqual({ r2: 0, vektor: 4, dilepas: 1, selesai: true });
      expect([...l.vektor.simpan.keys()]).toEqual(["/a#racun"]);
      expect(await sisaHapus("vektor")).toBe(0);
      expect(await logPemeliharaan()).toEqual([{ status: "sukses", detail: "R2 0, vektor 4, dilepas 1; log dipangkas 0", jumlah: 5 }]);
    });

    it("galat R2: kunci tetap di daftar, dicatat sebagai gagal, dan pemeliharaan lain tetap berjalan; besoknya dilanjutkan", async () => {
      await l.r2.put("teks/a.txt", "isi");
      await tanamTandaHapus("r2", ["teks/a.txt"]);
      await l.db.prepare(`INSERT INTO sync_log (job, status, created_at) VALUES ('lama', 'sukses', datetime('now', '-200 days'))`).run();
      const asli = l.r2.delete.bind(l.r2);
      l.r2.delete = async () => {
        throw new Error("R2 sedang gangguan");
      };

      const gagal = await jalan();
      expect(gagal.hapus.selesai).toBe(false);
      expect(gagal.hapusGalat).toContain("R2 sedang gangguan");
      expect(gagal.logDipangkas).toBe(1); // pemangkasan log tidak ikut gagal
      expect(await sisaHapus("r2")).toBe(1);
      expect(await logPemeliharaan()).toEqual([
        { status: "gagal", detail: expect.stringMatching(/\(belum selesai\).*log dipangkas 1.*galat: .*R2 sedang gangguan/), jumlah: 0 },
      ]);

      l.r2.delete = asli;
      const pulih = await jalan();
      expect(pulih.hapus).toMatchObject({ r2: 1, selesai: true });
      expect(l.r2.objek.has("teks/a.txt")).toBe(false);
    });

    it("berhenti sesudah batas waktu dan melanjutkan hari berikutnya; putaran tanpa kemajuan tidak berputar selamanya", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-14T19:00:00Z"));
      await l.db.batch(
        Array.from({ length: 1200 }, (_, i) =>
          l.db.prepare(`INSERT INTO daftar_hapus (jenis_objek, kunci) VALUES ('r2', ?)`).bind(`teks/x/${String(i).padStart(4, "0")}.txt`),
        ),
      );
      // Tiap panggilan R2 menghabiskan satu menit waktu dinding.
      const asli = l.r2.delete.bind(l.r2);
      l.r2.delete = async (kunci) => {
        vi.setSystemTime(Date.now() + BATAS_HAPUS_MS + 1);
        return asli(kunci);
      };
      const laporan = await jalan();
      expect(laporan.hapus).toMatchObject({ r2: 500, selesai: false });
      expect(await sisaHapus("r2")).toBe(700);
    });
  });

  describe("catatan lama", () => {
    it(`log lebih tua dari ${SIMPAN_LOG_HARI} hari dipangkas, yang lebih baru tetap`, async () => {
      for (const [job, selang] of [["tua", "-91 days"], ["batas", "-89 days"], ["baru", "-1 days"]] as const) {
        await l.db.prepare(`INSERT INTO sync_log (job, status, created_at) VALUES (?, 'sukses', datetime('now', ?))`).bind(job, selang).run();
      }
      const laporan = await jalan();
      expect(laporan.logDipangkas).toBe(1);
      expect((await baris<{ job: string }>(l, `SELECT job FROM sync_log WHERE job <> 'pemeliharaan' ORDER BY id`)).map((r) => r.job)).toEqual(["batas", "baru"]);
    });

    it("sisa keadaan pekerjaan sumber lama dibuang; penanda BPK dan denyut harian tetap", async () => {
      const lama = [
        "katalog_selesai:UU", "katalog_offset:PP", "katalog_total:PP", "katalog_dukungan:UUD", "diag:laws_daftar", "diagisi:/akn/id/act/uu/2003/13",
        "statistik:2026-10-11", "log:akses_isi:gagal", "pinjaman:tik", "offset:PERMEN", "tik_generasi", "tik_antre_sampai",
        "denyut:* * * * *", "denyut:antrean", "akses_isi", "akses_diperiksa", "pasal_tunda_sampai", "jenis_awal",
      ];
      const tetap = [`denyut:${CRON_HARIAN}`, "bpk_tanpa_berkas:/akn/id/act/pp/1960/1", "bpk_tanpa_berkas:/akn/id/act/uu/1950/2", "kunci_lain", "katalogX"];
      for (const k of [...lama, ...tetap]) await l.db.prepare(`INSERT INTO sync_state (key, value) VALUES (?, 'x')`).bind(k).run();

      const laporan = await jalan();
      expect(laporan.kunciLamaDibuang).toBe(lama.length);
      expect(await kunciState()).toEqual([...tetap].sort());
      expect(await logPemeliharaan()).toEqual([{ status: "sukses", detail: `R2 0, vektor 0; log dipangkas 0; keadaan lama dibuang ${lama.length}`, jumlah: 0 }]);
    });
  });

  describe("hari yang sepi", () => {
    it("tidak mengubah apa pun dan tidak menambah baris log", async () => {
      const sebelum = Number(l.sqlite.prepare("SELECT total_changes() AS n").get()?.n);
      const laporan = await jalan();
      expect(laporan).toEqual({ hapus: { r2: 0, vektor: 0, dilepas: 0, selesai: true }, logDipangkas: 0, kunciLamaDibuang: 0 });
      expect(Number(l.sqlite.prepare("SELECT total_changes() AS n").get()?.n)).toBe(sebelum);
      expect(await logPemeliharaan()).toEqual([]);
    });
  });

  describe("pemicu Cron di Worker", () => {
    it("pemicu harian meninggalkan jejak denyut dan menjalankan pemeliharaan", async () => {
      await l.r2.put("teks/a.txt", "isi");
      await tanamTandaHapus("r2", ["teks/a.txt"]);
      await jalankanCron(l, CRON_HARIAN);
      expect(l.r2.objek.has("teks/a.txt")).toBe(false);
      expect(await satu<{ value: string }>(l, `SELECT value FROM sync_state WHERE key = ?`, `denyut:${CRON_HARIAN}`)).toEqual({ value: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
    });

    it("pemicu lain (sisa konfigurasi lama, mis. per menit) diabaikan: tak ada denyut, tak ada pekerjaan, tak menyentuh sumber mana pun", async () => {
      await l.r2.put("teks/a.txt", "isi");
      await tanamTandaHapus("r2", ["teks/a.txt"]);
      const sebelum = Number(l.sqlite.prepare("SELECT total_changes() AS n").get()?.n);
      await jalankanCron(l, "* * * * *");
      expect(l.r2.objek.has("teks/a.txt")).toBe(true);
      expect(Number(l.sqlite.prepare("SELECT total_changes() AS n").get()?.n)).toBe(sebelum);
      expect(await kunciState()).toEqual([]);
    });
  });
});
