/**
 * Gemini otomatis (lib/geminiOtomatis.ts): Cron 15 menit mengantrekan pembacaan PDF peraturan yang teksnya tak layak, dalam mode
 * `uji` (percobaan kering) atau `ya` (membaca sungguhan). Cron dijalankan lewat handler `scheduled` Worker; pesannya dikerjakan
 * konsumer antrean yang sama dengan jalur manual. Tak ada jaringan: `fetch` global diganti jawaban palsu.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BATAS_OTOMATIS_BAWAAN, bacaKonfigOtomatis, jalankanGeminiOtomatis, KUNCI_PUTARAN, MAKS_UMUR_PUTARAN_MS, UJI_OTOMATIS_BAWAAN,
} from "../../src/worker/lib/geminiOtomatis";
import { CRON_GEMINI as CRON_KODE } from "../../src/worker/lib/jadwal";
import {
  baris, buatLingkungan, CRON_GEMINI, jalankanAntrean, jalankanCron, json, panggil, satu, sisipkan, sqliteAda, TOKEN_ADMIN, type Lingkungan,
} from "./harness";

const adm = { "x-admin-token": TOKEN_ADMIN };
const KUNCI = "AIzaRAHASIA-otomatis-0987654321";

describe("bacaKonfigOtomatis", () => {
  it("mati kecuali bernilai uji atau ya; huruf besar-kecil dan spasi tak berpengaruh", () => {
    expect(bacaKonfigOtomatis({}).mode).toBe("mati");
    expect(bacaKonfigOtomatis({ GEMINI_OTOMATIS: "" }).mode).toBe("mati");
    expect(bacaKonfigOtomatis({ GEMINI_OTOMATIS: "mungkin" }).mode).toBe("mati");
    expect(bacaKonfigOtomatis({ GEMINI_OTOMATIS: " UJI " }).mode).toBe("uji");
    expect(bacaKonfigOtomatis({ GEMINI_OTOMATIS: "kering" }).mode).toBe("uji");
    for (const v of ["ya", "YA", "1", "true", "aktif", "on"]) expect(bacaKonfigOtomatis({ GEMINI_OTOMATIS: v }).mode).toBe("ya");
  });

  it("batas dan maksimum uji: bawaan, dibatasi, dan nilai rusak dibaca bawaan", () => {
    expect(bacaKonfigOtomatis({})).toMatchObject({ batas: BATAS_OTOMATIS_BAWAAN, ujiMaks: UJI_OTOMATIS_BAWAAN, vonis: ["tanpa_pasal", "berat", "gagal"] });
    expect(bacaKonfigOtomatis({ GEMINI_OTOMATIS_BATAS: "5", GEMINI_OTOMATIS_UJI_MAKS: "3" })).toMatchObject({ batas: 5, ujiMaks: 3 });
    expect(bacaKonfigOtomatis({ GEMINI_OTOMATIS_BATAS: "500", GEMINI_OTOMATIS_UJI_MAKS: "9999" })).toMatchObject({ batas: 10, ujiMaks: 50 });
    expect(bacaKonfigOtomatis({ GEMINI_OTOMATIS_BATAS: "0", GEMINI_OTOMATIS_UJI_MAKS: "-4" })).toMatchObject({ batas: 1, ujiMaks: 1 });
    expect(bacaKonfigOtomatis({ GEMINI_OTOMATIS_BATAS: "banyak", GEMINI_OTOMATIS_UJI_MAKS: "" })).toMatchObject({ batas: BATAS_OTOMATIS_BAWAAN, ujiMaks: UJI_OTOMATIS_BAWAAN });
  });

  it("vonis calon: daftar dari variabel, yang tak sah dibuang, kosong atau semuanya tak sah memakai bawaan", () => {
    expect(bacaKonfigOtomatis({ GEMINI_OTOMATIS_VONIS: "berat, ringan" }).vonis).toEqual(["berat", "ringan"]);
    expect(bacaKonfigOtomatis({ GEMINI_OTOMATIS_VONIS: "berat,ngawur" }).vonis).toEqual(["berat"]);
    expect(bacaKonfigOtomatis({ GEMINI_OTOMATIS_VONIS: "ngawur" }).vonis).toEqual(["tanpa_pasal", "berat", "gagal"]);
    expect(bacaKonfigOtomatis({ GEMINI_OTOMATIS_VONIS: "" }).vonis).toEqual(["tanpa_pasal", "berat", "gagal"]);
  });

  it("konstanta Cron di kode sama dengan yang dipakai harness", () => {
    expect(CRON_GEMINI).toBe(CRON_KODE);
  });
});

// --- Naskah dan Gemini palsu -------------------------------------------------

/** PDF palsu dengan `n` objek halaman (dihitung perkirakanHalamanPdf). */
const pdf = (n = 2) => new TextEncoder().encode(`%PDF-1.4\n${"<< /Type /Page >>\n".repeat(n)}%%EOF`);

/** Transkripsi dua halaman dengan judul resmi yang cocok dengan peraturannya, tiga pasal berurutan. */
function naskahUntuk(jenis: "UU" | "PP", nomor: string, tahun: number): string {
  return [
    "=== HALAMAN 1 ===",
    jenis === "UU" ? "UNDANG-UNDANG REPUBLIK INDONESIA" : "PERATURAN PEMERINTAH REPUBLIK INDONESIA",
    `NOMOR ${nomor} TAHUN ${tahun}`, "TENTANG", "PENGELOLAAN SAMPAH", "BAB I", "KETENTUAN UMUM", "Pasal 1",
    "Sampah rumah tangga adalah sampah dari kegiatan sehari-hari.",
    "=== HALAMAN 2 ===",
    "Pasal 2", "(1) Setiap orang wajib memilah sampah.", "(2) Pemerintah daerah menyediakan fasilitas pengelolaan sampah.",
    "Pasal 3", "Ketentuan lebih lanjut mengenai pengelolaan sampah diatur dengan Peraturan Menteri.",
    "Agar setiap orang mengetahuinya, memerintahkan pengundangan peraturan ini dengan penempatannya dalam Lembaran Negara Republik Indonesia.",
  ].join("\n");
}

const jawabanOk = (teks: string) =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: teks }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500, totalTokenCount: 1500 },
      modelVersion: "gemini-uji-001",
    }),
    { status: 200 },
  );

/** `fetch` palsu: naskah menurut nomor peraturan yang tertera di `uris`, atau satu jawaban tetap. Mencatat tiap panggilan. */
function pasangGemini(naskah: (n: number) => string = () => naskahUntuk("PP", "99", 2025)) {
  const panggilan: number[] = [];
  vi.stubGlobal("fetch", async () => {
    panggilan.push(panggilan.length);
    return jawabanOk(naskah(panggilan.length - 1));
  });
  return panggilan;
}

describe.skipIf(!sqliteAda)("Gemini otomatis (Cron)", () => {
  let l: Lingkungan;

  // Urutan prioritas panen: jenis menurut CAKUPAN_BAWAAN (UU lebih dulu daripada PP), lalu tahun terbaru.
  const PERATURAN = [
    { uri: "/akn/id/act/pp/2025/10", jenis: "PP", nomor: "10", tahun: 2025, vonis: "berat" },
    { uri: "/akn/id/act/pp/2024/20", jenis: "PP", nomor: "20", tahun: 2024, vonis: "tanpa_pasal" },
    // Tahun sama dengan PP 20/2024: urutan alamat ("/2024/20" sebelum "/2024/9") memutus seri, bukan urutan angka atau penyisipan.
    { uri: "/akn/id/act/pp/2024/9", jenis: "PP", nomor: "9", tahun: 2024, vonis: "berat" },
    { uri: "/akn/id/act/pp/2020/30", jenis: "PP", nomor: "30", tahun: 2020, vonis: "gagal" },
    { uri: "/akn/id/act/pp/2023/50", jenis: "PP", nomor: "50", tahun: 2023, vonis: "bersih" },
    { uri: "/akn/id/act/pp/2022/60", jenis: "PP", nomor: "60", tahun: 2022, vonis: "ringan" },
    { uri: "/akn/id/act/uu/2000/7", jenis: "UU", nomor: "7", tahun: 2000, vonis: "berat" },
  ] as const;

  const antreanKeluar = () => l.antrean.kuras() as Array<Record<string, unknown>>;
  const pembacaan = () => baris<{ frbr_uri: string; hasil: string; catatan: string | null }>(l, `SELECT frbr_uri, hasil, catatan FROM pembacaan_ai ORDER BY frbr_uri`);
  const hariIni = () => new Date().toISOString().slice(0, 10);

  beforeEach(async () => {
    l = buatLingkungan();
    l.env.GEMINI_API = KUNCI;
    l.env.GEMINI_MODEL = "gemini-uji";
    for (const p of PERATURAN) {
      const kunci = `pdf/${p.uri.replace(/^\//, "")}.pdf`;
      await sisipkan(l, [{ uri: p.uri, jenis: p.jenis, nomor: p.nomor, tahun: p.tahun, judul: `Peraturan ${p.nomor}/${p.tahun}` }]);
      await l.db.prepare(`UPDATE laws SET r2_pdf_key = ? WHERE frbr_uri = ?`).bind(kunci, p.uri).run();
      await l.db.prepare(`INSERT INTO ekstraksi_log (frbr_uri, vonis, panjang_teks, jumlah_pasal) VALUES (?,?,?,?)`).bind(p.uri, p.vonis, 5000, 0).run();
      l.r2.objek.set(kunci, { bytes: pdf(2) });
    }
    l.ai.jawaban = "Ringkasan AI.";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    l.tutup();
  });

  describe("mati: tak mengerjakan apa pun", () => {
    it("tanpa GEMINI_OTOMATIS: tak ada pesan, tak ada tulisan ke D1 maupun KV, tak ada panggilan jaringan", async () => {
      const panggilan = pasangGemini();
      const logSebelum = await baris(l, `SELECT * FROM sync_log`);
      await jalankanCron(l, CRON_GEMINI);
      expect(antreanKeluar()).toEqual([]);
      expect(panggilan).toEqual([]);
      expect(await baris(l, `SELECT * FROM sync_log`)).toEqual(logSebelum);
      expect(l.kv.isi.has(KUNCI_PUTARAN)).toBe(false);
      expect(await jalankanGeminiOtomatis(l.env)).toEqual({ dikerjakan: false, alasan: "mati" });
    });

    it("nilai yang tak dikenal sama dengan mati", async () => {
      l.env.GEMINI_OTOMATIS = "mungkin";
      await jalankanCron(l, CRON_GEMINI);
      expect(antreanKeluar()).toEqual([]);
    });

    it("menyala tetapi secret GEMINI_API tak ada: tak ada yang diantrekan", async () => {
      l.env.GEMINI_OTOMATIS = "ya";
      delete l.env.GEMINI_API;
      expect(await jalankanGeminiOtomatis(l.env)).toEqual({ dikerjakan: false, alasan: "secret GEMINI_API belum dipasang" });
      expect(antreanKeluar()).toEqual([]);
    });

    it("pemicu Cron lain tak menjalankan Gemini otomatis", async () => {
      l.env.GEMINI_OTOMATIS = "ya";
      await jalankanCron(l, "0 * * * *");
      expect(antreanKeluar()).toEqual([]);
    });
  });

  describe("mode uji (percobaan kering)", () => {
    beforeEach(() => {
      l.env.GEMINI_OTOMATIS = "uji";
    });

    it("mengantrekan calon menurut prioritas (UU lebih dulu, lalu tahun terbaru), hanya vonis tanpa_pasal, berat, gagal", async () => {
      await jalankanCron(l, CRON_GEMINI);
      const pesan = antreanKeluar();
      expect(pesan.map((p) => p.frbr_uri)).toEqual(["/akn/id/act/uu/2000/7", "/akn/id/act/pp/2025/10"]); // batas bawaan 2
      expect(pesan[0]).toEqual({
        tipe: "ekstrak_pdf", frbr_uri: "/akn/id/act/uu/2000/7", r2_key: "pdf/akn/id/act/uu/2000/7.pdf", pembaca: "gemini", otomatis: true, uji: true,
      });
      expect(await satu(l, `SELECT job, status, jumlah FROM sync_log WHERE job = 'gemini_otomatis'`)).toEqual({ job: "gemini_otomatis", status: "sukses", jumlah: 2 });
      const putaran = JSON.parse(l.kv.isi.get(KUNCI_PUTARAN)!.nilai);
      expect(putaran).toMatchObject({ mode: "uji", uris: ["/akn/id/act/uu/2000/7", "/akn/id/act/pp/2025/10"] });
    });

    it("batas per putaran mengikuti GEMINI_OTOMATIS_BATAS", async () => {
      l.env.GEMINI_OTOMATIS_BATAS = "4";
      await jalankanCron(l, CRON_GEMINI);
      expect(antreanKeluar().map((p) => p.frbr_uri)).toEqual([
        "/akn/id/act/uu/2000/7", "/akn/id/act/pp/2025/10", "/akn/id/act/pp/2024/20", "/akn/id/act/pp/2024/9",
      ]);
    });

    it("vonis calon dapat diubah: hanya ringan", async () => {
      l.env.GEMINI_OTOMATIS_VONIS = "ringan";
      await jalankanCron(l, CRON_GEMINI);
      expect(antreanKeluar().map((p) => p.frbr_uri)).toEqual(["/akn/id/act/pp/2022/60"]);
    });

    it("putaran berikutnya menunggu putaran sebelumnya selesai, lalu melanjutkan ke calon yang belum diuji", async () => {
      const panggilan = pasangGemini(() => naskahUntuk("PP", "10", 2025));
      await jalankanCron(l, CRON_GEMINI);
      const putaran1 = antreanKeluar();
      expect(putaran1).toHaveLength(2);

      // Belum dikerjakan konsumer: putaran kedua tak menambah antrean.
      await jalankanCron(l, CRON_GEMINI);
      expect(antreanKeluar()).toEqual([]);
      expect(await jalankanGeminiOtomatis(l.env)).toEqual({ dikerjakan: false, alasan: "putaran sebelumnya masih berjalan" });

      // Konsumer mengerjakan: percobaan kering, pasal tak ditulis, hasilnya tercatat.
      expect(await jalankanAntrean(l, putaran1 as never)).toEqual({ diakui: 2, diulang: [] });
      expect(panggilan).toHaveLength(2);
      expect((await pembacaan()).map((r) => [r.frbr_uri, r.hasil])).toEqual([
        ["/akn/id/act/pp/2025/10", "uji"], ["/akn/id/act/uu/2000/7", "uji"],
      ]);
      expect(await baris(l, `SELECT * FROM articles`)).toEqual([]);

      // Putaran selesai: yang berikutnya mengantrekan calon yang belum diuji.
      await jalankanCron(l, CRON_GEMINI);
      expect(antreanKeluar().map((p) => p.frbr_uri)).toEqual(["/akn/id/act/pp/2024/20", "/akn/id/act/pp/2024/9"]);
    });

    it("PDF yang melebihi GEMINI_HALAMAN_MAKS dicatat gagal tanpa memanggil Gemini, dan putaran berikutnya melanjutkan ke calon lain (tak macet)", async () => {
      l.env.GEMINI_HALAMAN_MAKS = "5";
      l.r2.objek.set("pdf/akn/id/act/uu/2000/7.pdf", { bytes: pdf(6) }); // calon pertama: enam halaman, batasnya lima
      const panggilan = pasangGemini(() => naskahUntuk("PP", "10", 2025));
      await jalankanCron(l, CRON_GEMINI);
      expect(await jalankanAntrean(l, antreanKeluar() as never)).toEqual({ diakui: 2, diulang: [] });
      expect(panggilan).toHaveLength(1); // hanya PP 10/2025; UU 7/2000 ditolak sebelum memanggil
      const tercatat = await pembacaan();
      expect(tercatat.map((r) => [r.frbr_uri, r.hasil])).toEqual([["/akn/id/act/pp/2025/10", "uji"], ["/akn/id/act/uu/2000/7", "gagal"]]);
      expect(tercatat[1].catatan).toContain("terlalu_panjang");
      expect(tercatat[1].catatan).toContain("6 halaman");

      // Keduanya tercatat, jadi putaran dianggap selesai: yang berikutnya langsung maju, dan UU 7/2000 tak dipilih lagi.
      await jalankanCron(l, CRON_GEMINI);
      expect(antreanKeluar().map((p) => p.frbr_uri)).toEqual(["/akn/id/act/pp/2024/20", "/akn/id/act/pp/2024/9"]);
    });

    it("catatan percobaan memuat keputusan, rangkaian pasal, dan token, cukup untuk menilai dari D1 saja", async () => {
      pasangGemini(() => naskahUntuk("PP", "10", 2025));
      l.env.GEMINI_OTOMATIS_BATAS = "1";
      l.env.GEMINI_OTOMATIS_VONIS = "berat";
      await jalankanCron(l, CRON_GEMINI);
      const [uu] = antreanKeluar();
      // UU 7/2000 berjudul lain: judul PP 10/2025 pada naskahnya tak diperiksa pada percobaan kering, hanya pembacaannya.
      await jalankanAntrean(l, [uu] as never);
      const baru = await satu<Record<string, unknown>>(l, `SELECT hasil, vonis_baru, pasal_baru, token_masuk, token_keluar, catatan FROM pembacaan_ai`);
      expect(baru).toMatchObject({ hasil: "uji", vonis_baru: "bersih", pasal_baru: 3, token_masuk: 1000, token_keluar: 500 });
      expect(baru?.catatan).toContain("akan dipakai");
      expect(baru?.catatan).toContain("pasal 3 (tertinggi 3, hilang 0)");
    });

    it("berhenti sendiri setelah GEMINI_OTOMATIS_UJI_MAKS percobaan, dengan petunjuk langkah berikutnya", async () => {
      pasangGemini(() => naskahUntuk("PP", "10", 2025));
      l.env.GEMINI_OTOMATIS_UJI_MAKS = "3";
      await jalankanCron(l, CRON_GEMINI);
      await jalankanAntrean(l, antreanKeluar() as never); // 2 percobaan
      await jalankanCron(l, CRON_GEMINI);
      const kedua = antreanKeluar();
      expect(kedua).toHaveLength(1); // sisa 1 dari batas 3, bukan 2
      await jalankanAntrean(l, kedua as never);
      const hasil = await jalankanGeminiOtomatis(l.env);
      expect(hasil).toMatchObject({ dikerjakan: false, alasan: expect.stringContaining("uji otomatis selesai (3 percobaan)") });
      expect(hasil).toMatchObject({ alasan: expect.stringContaining("GEMINI_OTOMATIS=ya") });
      expect(antreanKeluar()).toEqual([]);
    });

    it("percobaan yang gagal tetap (diblokir) dicatat gagal supaya tak dipilih lagi; galat sementara diulang antrean", async () => {
      l.env.GEMINI_OTOMATIS_BATAS = "1";
      l.env.GEMINI_OTOMATIS_VONIS = "gagal";
      await jalankanCron(l, CRON_GEMINI);
      const [pesan] = antreanKeluar();

      vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ candidates: [{ finishReason: "SAFETY" }] }), { status: 200 }));
      expect(await jalankanAntrean(l, [pesan] as never)).toEqual({ diakui: 1, diulang: [] });
      expect(await pembacaan()).toMatchObject([{ frbr_uri: "/akn/id/act/pp/2020/30", hasil: "gagal", catatan: expect.stringContaining("uji:") }]);

      // Kuota Google (429): bukan penolakan atas dokumen ini, pesan dikembalikan ke antrean dan tak ada catatan baru.
      l.kv.isi.delete(KUNCI_PUTARAN);
      await l.db.prepare(`DELETE FROM pembacaan_ai`).run();
      await jalankanCron(l, CRON_GEMINI);
      vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { code: 429, message: "quota", status: "RESOURCE_EXHAUSTED" } }), { status: 429, headers: { "retry-after": "60" } }));
      const ulang = await jalankanAntrean(l, antreanKeluar() as never);
      expect(ulang.diulang).toHaveLength(1);
      expect(await pembacaan()).toEqual([]);
    });
  });

  describe("mode ya (membaca sungguhan)", () => {
    beforeEach(() => {
      l.env.GEMINI_OTOMATIS = "ya";
    });

    it("pesan tanpa uji; hasil yang lolos pagar menggantikan pasal, dicatat dipakai", async () => {
      pasangGemini(() => naskahUntuk("PP", "10", 2025));
      l.env.GEMINI_OTOMATIS_BATAS = "1";
      l.env.GEMINI_OTOMATIS_VONIS = "berat";
      l.env.GEMINI_OTOMATIS_BATAS = "2";
      await jalankanCron(l, CRON_GEMINI);
      const pesan = antreanKeluar();
      expect(pesan[0]).toEqual({ tipe: "ekstrak_pdf", frbr_uri: "/akn/id/act/uu/2000/7", r2_key: "pdf/akn/id/act/uu/2000/7.pdf", pembaca: "gemini", otomatis: true });

      // Hanya PP 10/2025 yang naskahnya cocok dengan judulnya; UU 7/2000 ditolak karena judul naskahnya milik peraturan lain.
      await jalankanAntrean(l, pesan as never);
      expect((await pembacaan()).map((r) => [r.frbr_uri, r.hasil])).toEqual([
        ["/akn/id/act/pp/2025/10", "dipakai"], ["/akn/id/act/uu/2000/7", "ditolak"],
      ]);
      expect((await baris<{ nomor_pasal: string }>(l, `SELECT nomor_pasal FROM articles WHERE frbr_uri = '/akn/id/act/pp/2025/10' ORDER BY urutan`)).map((r) => r.nomor_pasal)).toEqual(["1", "2", "2", "3"]);
      expect(await satu(l, `SELECT vonis FROM ekstraksi_log WHERE frbr_uri = '/akn/id/act/pp/2025/10'`)).toEqual({ vonis: "bersih" });
    });

    it("melewati peraturan yang sudah pernah dicoba sungguhan, tetapi bukan yang hanya pernah diuji", async () => {
      await l.db.prepare(`INSERT INTO pembacaan_ai (frbr_uri, hasil) VALUES ('/akn/id/act/uu/2000/7', 'gagal')`).run();
      await l.db.prepare(`INSERT INTO pembacaan_ai (frbr_uri, hasil) VALUES ('/akn/id/act/pp/2025/10', 'uji')`).run();
      await jalankanCron(l, CRON_GEMINI);
      expect(antreanKeluar().map((p) => p.frbr_uri)).toEqual(["/akn/id/act/pp/2025/10", "/akn/id/act/pp/2024/20"]);
    });

    it("tak ada calon: tak mengantrekan apa pun dan tak mencatat putaran", async () => {
      await l.db.prepare(`UPDATE ekstraksi_log SET vonis = 'bersih'`).run();
      expect(await jalankanGeminiOtomatis(l.env)).toEqual({ dikerjakan: false, alasan: "tidak ada calon" });
      expect(l.kv.isi.has(KUNCI_PUTARAN)).toBe(false);
    });

    it("peraturan di luar cakupan tak dipilih", async () => {
      l.env.CAKUPAN_JENIS = "PP";
      await jalankanCron(l, CRON_GEMINI);
      expect(antreanKeluar().map((p) => p.frbr_uri)).toEqual(["/akn/id/act/pp/2025/10", "/akn/id/act/pp/2024/20"]);
    });
  });

  describe("pagar biaya dan keadaan macet", () => {
    beforeEach(() => {
      l.env.GEMINI_OTOMATIS = "ya";
    });

    it("anggaran token hari ini habis: tak ada yang diantrekan", async () => {
      l.env.GEMINI_BATAS_HARIAN = "1000";
      await l.env.CACHE.put(`gemini:token:${hariIni()}`, "1000");
      expect(await jalankanGeminiOtomatis(l.env)).toEqual({ dikerjakan: false, alasan: "anggaran token hari ini habis" });
      expect(antreanKeluar()).toEqual([]);
    });

    it("putaran yang tak kunjung selesai dianggap macet sesudah 45 menit, dan putaran baru dimulai", async () => {
      const t0 = Date.now();
      expect(await jalankanGeminiOtomatis(l.env, t0)).toMatchObject({ dikerjakan: true });
      antreanKeluar();
      expect(await jalankanGeminiOtomatis(l.env, t0 + MAKS_UMUR_PUTARAN_MS - 60_000)).toEqual({ dikerjakan: false, alasan: "putaran sebelumnya masih berjalan" });
      const lagi = await jalankanGeminiOtomatis(l.env, t0 + MAKS_UMUR_PUTARAN_MS + 1000);
      expect(lagi).toMatchObject({ dikerjakan: true });
      // Calon yang sama (belum tercatat) dipilih lagi; konsumer melewati yang sudah dicoba sungguhan, jadi tak membayar dua kali.
      expect(antreanKeluar()).toHaveLength(2);
    });

    it("keadaan KV yang rusak tak menghentikan: dianggap tak ada putaran", async () => {
      await l.env.CACHE.put(KUNCI_PUTARAN, "{bukan json");
      expect(await jalankanGeminiOtomatis(l.env)).toMatchObject({ dikerjakan: true });
    });

    it("sampai tabel pembacaan_ai belum ada (migrasi 0008 belum diterapkan): galat dilempar ke Cron, yang mencatatnya tanpa menghentikan Worker", async () => {
      await l.db.exec("DROP TABLE pembacaan_ai");
      await expect(jalankanGeminiOtomatis(l.env)).rejects.toThrow(/pembacaan_ai/);
      await jalankanCron(l, CRON_GEMINI); // tak melempar: dibungkus catch di index.ts
      expect(antreanKeluar()).toEqual([]);
    });
  });

  describe("status di /api/impor/ringkasan", () => {
    it("memuat mode, batas, vonis calon, dan putaran terakhir; calon_belum_dicoba menghitung yang layak", async () => {
      l.env.GEMINI_OTOMATIS = "uji";
      const sebelum = await json<{ gemini: Record<string, any> }>(await panggil(l, "/api/impor/ringkasan", { headers: adm })); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(sebelum.gemini.otomatis).toEqual({ mode: "uji", batas: 2, uji_maks: 8, vonis: ["tanpa_pasal", "berat", "gagal"], putaran_terakhir: null });
      expect(sebelum.gemini.calon_belum_dicoba).toBe(5); // UU 7/2000, PP 10/2025, PP 20/2024, PP 9/2024, PP 30/2020

      await jalankanCron(l, CRON_GEMINI);
      antreanKeluar();
      const sesudah = await json<{ gemini: Record<string, any> }>(await panggil(l, "/api/impor/ringkasan", { headers: adm })); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(sesudah.gemini.otomatis.putaran_terakhir).toMatchObject({ mode: "uji", jumlah: 2, pada: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
    });

    it("mati: mode mati dan putaran kosong", async () => {
      const r = await json<{ gemini: Record<string, any> }>(await panggil(l, "/api/impor/ringkasan", { headers: adm })); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(r.gemini.otomatis).toMatchObject({ mode: "mati", putaran_terakhir: null });
    });
  });
});
