/**
 * Gemini sebagai pembaca PDF yang tak punya lapisan teks: pesan antrean `pembaca: "gemini"` (ekstrakPdf), uji kering
 * (/api/impor/gemini-uji), uji sambungan (/gemini-cek), dan pengantrean massal (/ekstrak-ulang { gemini: true }).
 * Klien dan pemeriksaan hasilnya diuji di test/gemini.test.ts; di sini yang dibuktikan adalah penyimpanan dan keputusannya.
 *
 * Tak ada jaringan: `fetch` global diganti jawaban palsu.
 */
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bacaKonfigGemini } from "../../src/worker/lib/gemini";
import { bacaNaskahGemini, catatPembacaanAi, cuplikanNaskah, kesesuaianTeks, nomorLamaHilang, putuskanPenerimaanAi } from "../../src/worker/lib/ingest";
import worker from "../../src/worker/index";
import {
  ASAL, baris, buatLingkungan, jalankanAntrean, json, kirim, konteksIngestUji, panggil, satu, sisipkan, sqliteAda, TOKEN_ADMIN, type Lingkungan,
} from "./harness";

const adm = { "x-admin-token": TOKEN_ADMIN };
const KUNCI = "AIzaRAHASIA-integrasi-0987654321";
const URI = "/akn/id/act/pp/2025/99";
const KUNCI_PDF = "pdf/akn/id/act/pp/2025/99.pdf";
const KUNCI_MD = "teks/akn/id/act/pp/2025/99.md";
const KUNCI_AI = "teks-ai/akn/id/act/pp/2025/99.md";
const KUNCI_BAWAAN = "teks-bawaan/akn/id/act/pp/2025/99.md";

/** PDF palsu dengan `n` objek halaman (dihitung perkirakanHalamanPdf). */
const pdf = (n = 2) => new TextEncoder().encode(`%PDF-1.4\n${"<< /Type /Page >>\n".repeat(n)}%%EOF`);

const NASKAH_AI = [
  "=== HALAMAN 1 ===",
  "PERATURAN PEMERINTAH REPUBLIK INDONESIA", "NOMOR 99 TAHUN 2025", "TENTANG", "PENGELOLAAN SAMPAH",
  "BAB I", "KETENTUAN UMUM", "Pasal 1", "Sampah rumah tangga adalah sampah dari kegiatan sehari-hari.",
  "=== HALAMAN 2 ===",
  "Pasal 2", "(1) Setiap orang wajib memilah sampah.", "(2) Pemerintah daerah menyediakan fasilitas pengelolaan sampah.",
  "Pasal 3", "Ketentuan lebih lanjut mengenai pengelolaan sampah diatur dengan Peraturan Menteri.",
  "Agar setiap orang mengetahuinya, memerintahkan pengundangan Peraturan Pemerintah ini dengan penempatannya dalam Lembaran Negara Republik Indonesia.",
].join("\n");

const ok = (teks: string, o: { selesai?: string; masuk?: number; keluar?: number; model?: string } = {}) =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: teks }] }, finishReason: o.selesai ?? "STOP" }],
      usageMetadata: { promptTokenCount: o.masuk ?? 1000, candidatesTokenCount: o.keluar ?? 500, totalTokenCount: (o.masuk ?? 1000) + (o.keluar ?? 500) },
      modelVersion: o.model ?? "gemini-uji-001",
    }),
    { status: 200 },
  );
const galatHttp = (status: number, pesan: string, header: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { code: status, message: pesan, status: "GALAT" } }), { status, headers: header });

interface PanggilanGemini { url: string; header: Record<string, string>; badan: any } // eslint-disable-line @typescript-eslint/no-explicit-any

/** Pasang `fetch` palsu yang menjawab berurutan (fungsi dipanggil sesuai gilirannya); jawaban habis = tes gagal. */
function pasangGemini(jawaban: Array<Response | ((p: PanggilanGemini) => Response)>) {
  const panggilan: PanggilanGemini[] = [];
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    const p: PanggilanGemini = { url: String(url), header: Object.fromEntries(new Headers(init?.headers).entries()), badan: JSON.parse(String(init?.body ?? "{}")) };
    panggilan.push(p);
    const j = jawaban.shift();
    if (!j) throw new Error("panggilan Gemini tak terduga");
    return typeof j === "function" ? j(p) : j;
  });
  return panggilan;
}

describe("putuskanPenerimaanAi", () => {
  const dasar = { masalah: [] as string[], jumlahPasal: 5, vonis: "bersih" as const, nomorLama: 0, nomorBaru: 5 };

  it("bersih dan belum ada pasal tersimpan: dipakai", () => {
    expect(putuskanPenerimaanAi(dasar)).toEqual({ hasil: "dipakai" });
    expect(putuskanPenerimaanAi({ ...dasar, vonis: "ringan" })).toEqual({ hasil: "dipakai" });
  });

  it("pembacaan bermasalah, tanpa pasal, atau mutu berat ditolak, bahkan bila belum ada apa pun yang tersimpan", () => {
    expect(putuskanPenerimaanAi({ ...dasar, masalah: ["tanpa penanda halaman", "teks terlalu sedikit (10 karakter)"] })).toEqual({
      hasil: "ditolak", alasan: "pembacaan bermasalah: tanpa penanda halaman; teks terlalu sedikit (10 karakter)",
    });
    expect(putuskanPenerimaanAi({ ...dasar, jumlahPasal: 0, nomorBaru: 0 })).toMatchObject({ hasil: "ditolak" });
    expect(putuskanPenerimaanAi({ ...dasar, vonis: "berat" })).toMatchObject({ hasil: "ditolak", alasan: expect.stringContaining("berat") });
  });

  it("tak boleh mengurangi nomor pasal yang tersimpan: dipertahankan; menambah atau menyamai boleh", () => {
    expect(putuskanPenerimaanAi({ ...dasar, nomorLama: 10, nomorBaru: 3 })).toEqual({
      hasil: "dipertahankan", alasan: "dipertahankan: 10 nomor pasal tersimpan lebih banyak dari 3 hasil PDF",
    });
    expect(putuskanPenerimaanAi({ ...dasar, nomorLama: 5, nomorBaru: 5 })).toEqual({ hasil: "dipakai" });
    expect(putuskanPenerimaanAi({ ...dasar, nomorLama: 5, nomorBaru: 9 })).toEqual({ hasil: "dipakai" });
  });
});

describe("nomorLamaHilang dan putuskanPenerimaanAi dengan himpunan nomor", () => {
  const dasar = { masalah: [] as string[], jumlahPasal: 5, vonis: "bersih" as const, nomorLama: 40, nomorBaru: 5 };

  it("nomor tersimpan dibandingkan menurut bilangannya; sisipan, romawi, dan sampah tak berangka tak dihitung", () => {
    expect(nomorLamaHilang(["1", "2", "3"], ["1", "2", "3"])).toEqual({ hilang: 0, dasar: 3 });
    expect(nomorLamaHilang(["1", "2", "3"], ["1", "2"])).toEqual({ hilang: 1, dasar: 3 });
    // "12A" sama dengan "12": bacaan yang memuat 12 tak kehilangan 12A.
    expect(nomorLamaHilang(["11", "12", "12A", "13"], ["11", "12", "13"])).toEqual({ hilang: 0, dasar: 3 });
    // Pasal berangka romawi (undang-undang perubahan) dan sisa OCR tak berangka tak punya bilangan.
    expect(nomorLamaHilang(["I", "II", "III"], ["1"])).toEqual({ hilang: 0, dasar: 0 });
    expect(nomorLamaHilang(["1", "2", "I", "pasai"], ["1", "2"])).toEqual({ hilang: 0, dasar: 2 });
  });

  it("pencilan pada yang tersimpan dibuang: satu 'Pasal 107' salah baca tak menjadi nomor yang 'hilang'", () => {
    const tersimpan = [...Array.from({ length: 45 }, (_, i) => String(i + 1)), "107"];
    const bacaan = Array.from({ length: 45 }, (_, i) => String(i + 1));
    expect(nomorLamaHilang(tersimpan, bacaan)).toEqual({ hilang: 0, dasar: 45 });
  });

  it("nomor sampah dan Penjelasan sebagai pasal pada baris lama tak menggelembungkan: '2O' dibaca 2, nomor yang berulang satu kali", () => {
    const tersimpan = ["2O", "3", "4", "6", "8", "9", "3", "4", "5", "6", "8", "I", "2", "7", "9", "10"];
    const bacaan = Array.from({ length: 10 }, (_, i) => String(i + 1));
    expect(nomorLamaHilang(tersimpan, bacaan)).toEqual({ hilang: 0, dasar: 9 });
  });

  it("dengan himpunan: boleh kehilangan paling banyak 5% nomor tersimpan; lebih dari itu dipertahankan, berapa pun jumlah barunya", () => {
    expect(putuskanPenerimaanAi({ ...dasar, hilangDariLama: { hilang: 0, dasar: 40 } })).toEqual({ hasil: "dipakai" });
    expect(putuskanPenerimaanAi({ ...dasar, hilangDariLama: { hilang: 2, dasar: 40 } })).toEqual({ hasil: "dipakai" }); // tepat 5%
    expect(putuskanPenerimaanAi({ ...dasar, hilangDariLama: { hilang: 3, dasar: 40 } })).toEqual({
      hasil: "dipertahankan", alasan: "dipertahankan: 3 dari 40 nomor pasal tersimpan tidak ada pada hasil Gemini",
    });
    // Himpunan kecil: tak ada toleransi. Kehilangan satu dari tiga nomor adalah kehilangan.
    expect(putuskanPenerimaanAi({ ...dasar, hilangDariLama: { hilang: 1, dasar: 3 } })).toMatchObject({ hasil: "dipertahankan" });
    // Jumlah yang menyusut tak lagi menentukan bila nomor tersimpan seluruhnya terbaca.
    expect(putuskanPenerimaanAi({ ...dasar, nomorLama: 90, nomorBaru: 77, hilangDariLama: { hilang: 0, dasar: 77 } })).toEqual({ hasil: "dipakai" });
  });

  it("pemeriksaan lain tetap lebih dulu: bermasalah, tanpa pasal, mutu berat", () => {
    const h = { hilang: 0, dasar: 10 };
    expect(putuskanPenerimaanAi({ ...dasar, masalah: ["x"], hilangDariLama: h })).toMatchObject({ hasil: "ditolak" });
    expect(putuskanPenerimaanAi({ ...dasar, jumlahPasal: 0, hilangDariLama: h })).toMatchObject({ hasil: "ditolak" });
    expect(putuskanPenerimaanAi({ ...dasar, vonis: "berat", hilangDariLama: h })).toMatchObject({ hasil: "ditolak" });
  });
});

describe("cuplikanNaskah", () => {
  it("naskah pendek utuh; yang panjang: 600 karakter awal, penanda, dan 600 karakter dari tengah", () => {
    expect(cuplikanNaskah("  Pendek.\n\n\n\nSaja.  ")).toBe("Pendek.\n\nSaja.");
    // 3.000 karakter: tengahnya di posisi 1.500, jadi bagian tengah yang diambil adalah 1.500-2.099.
    const panjang = "a".repeat(1500) + "b".repeat(600) + "c".repeat(900);
    const c = cuplikanNaskah(panjang);
    expect(c).toBe(`${"a".repeat(600)}\n[...]\n${"b".repeat(600)}`);
    expect(cuplikanNaskah("x".repeat(1200))).toHaveLength(1200); // tepat di batas: utuh
    expect(cuplikanNaskah("x".repeat(1201))).toHaveLength(600 + 7 + 600);
  });
});

describe("kesesuaianTeks", () => {
  it("bagian rangkaian tiga kata yang sama di kedua arah; huruf besar-kecil dan tanda baca tak berpengaruh", () => {
    expect(kesesuaianTeks("satu dua tiga empat lima", "Satu, dua tiga: empat enam")).toEqual({ aDiB: 0.67, bDiA: 0.67 });
    expect(kesesuaianTeks("satu dua tiga empat", "satu dua tiga empat lima enam")).toEqual({ aDiB: 1, bDiA: 0.5 });
    expect(kesesuaianTeks("a b c d", "satu dua tiga")).toEqual({ aDiB: 0, bDiA: 0 });
  });

  it("teks yang terlalu pendek untuk membentuk satu pun rangkaian: nol, bukan galat", () => {
    expect(kesesuaianTeks("satu dua", "satu dua")).toEqual({ aDiB: 0, bDiA: 0 });
    expect(kesesuaianTeks("", "")).toEqual({ aDiB: 0, bDiA: 0 });
  });
});

describe.skipIf(!sqliteAda)("bacaNaskahGemini dan catatPembacaanAi (tanpa antrean)", () => {
  let l: Lingkungan;
  beforeEach(() => {
    l = buatLingkungan();
  });
  afterEach(() => l.tutup());

  it("konteks tanpa konfigurasi Gemini, atau tanpa KV untuk anggaran, ditolak dengan galat 'kunci' sebelum menyentuh jaringan", async () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("tak boleh ada panggilan jaringan");
    });
    try {
      const k = bacaKonfigGemini({ GEMINI_API: KUNCI })!;
      await expect(bacaNaskahGemini(konteksIngestUji(l), pdf(1).buffer as ArrayBuffer)).rejects.toMatchObject({ jenis: "kunci", sementara: false });
      await expect(bacaNaskahGemini({ ...konteksIngestUji(l), gemini: k }, pdf(1).buffer as ArrayBuffer)).rejects.toMatchObject({ jenis: "kunci" });
      await expect(bacaNaskahGemini({ ...konteksIngestUji(l), kv: l.env.CACHE }, pdf(1).buffer as ArrayBuffer)).rejects.toMatchObject({ jenis: "kunci" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("catatan percobaan dipotong 400 karakter dan galat tabel yang belum ada ditahan", async () => {
    await sisipkan(l, [{ uri: URI, jenis: "PP", nomor: "99", tahun: 2025, judul: "Pengelolaan Sampah" }]);
    await catatPembacaanAi(l.env.DB, URI, { hasil: "gagal", catatan: "x".repeat(1000) });
    expect(await satu(l, `SELECT length(catatan) AS n FROM pembacaan_ai`)).toEqual({ n: 400 });
    // Percobaan kering membawa cuplikan transkripsi, jadi batasnya 2.000.
    await catatPembacaanAi(l.env.DB, URI, { hasil: "ditolak", catatan: "x".repeat(1000) });
    expect(await satu(l, `SELECT length(catatan) AS n FROM pembacaan_ai`)).toEqual({ n: 400 });
    await l.db.prepare(`DELETE FROM pembacaan_ai`).run();
    await catatPembacaanAi(l.env.DB, URI, { hasil: "uji", catatan: "y".repeat(5000) });
    expect(await satu(l, `SELECT length(catatan) AS n FROM pembacaan_ai`)).toEqual({ n: 2000 });
    await l.db.exec("DROP TABLE pembacaan_ai");
    await expect(catatPembacaanAi(l.env.DB, URI, { hasil: "gagal" })).resolves.toBeUndefined();
  });
});

describe.skipIf(!sqliteAda)("pembacaan PDF oleh Gemini", () => {
  let l: Lingkungan;
  beforeEach(async () => {
    l = buatLingkungan();
    l.env.GEMINI_API = KUNCI;
    l.env.GEMINI_MODEL = "gemini-uji";
    await sisipkan(l, [{ uri: URI, jenis: "PP", nomor: "99", tahun: 2025, judul: "Pengelolaan Sampah", bpkId: "555" }]);
    await l.db.prepare(`UPDATE laws SET r2_pdf_key = ? WHERE frbr_uri = ?`).bind(KUNCI_PDF, URI).run();
    l.r2.objek.set(KUNCI_PDF, { bytes: pdf(2) });
    l.ai.jawaban = "Ringkasan AI.";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    l.tutup();
  });

  const pesan = (ubah: Record<string, unknown> = {}) => ({ tipe: "ekstrak_pdf", frbr_uri: URI, r2_key: KUNCI_PDF, pembaca: "gemini", ...ubah });
  const jalan = (ubah: Record<string, unknown> = {}) => jalankanAntrean(l, [pesan(ubah)]);
  /** Keadaan "sudah pernah diekstrak dengan konversi bawaan": log dengan vonis tertentu, dan (bila diberi) pasal serta arsip teksnya. */
  const tanamLama = async (o: { vonis: string; pasal?: Array<{ nomor: string; isi: string }>; arsip?: string }) => {
    for (const [i, p] of (o.pasal ?? []).entries()) {
      await l.db.prepare(`INSERT INTO articles (id, frbr_uri, nomor_pasal, isi, urutan) VALUES (?,?,?,?,?)`).bind(`${URI}#${p.nomor}`, URI, p.nomor, p.isi, i).run();
    }
    if (o.arsip !== undefined) await l.r2.put(KUNCI_MD, o.arsip);
    await l.db
      .prepare(`UPDATE laws SET jumlah_pasal = ?, r2_text_key = ?, isi_status = ? WHERE frbr_uri = ?`)
      .bind(o.pasal?.length ?? 0, o.arsip !== undefined ? KUNCI_MD : null, o.pasal?.length ? "lengkap" : "menunggu", URI)
      .run();
    await l.db.prepare(`INSERT INTO ekstraksi_log (frbr_uri, vonis, panjang_teks, jumlah_pasal, catatan) VALUES (?,?,?,?,?)`).bind(URI, o.vonis, 744, o.pasal?.length ?? 0, "lama").run();
  };
  const teksR2 = async (kunci: string) => {
    const o = l.r2.objek.get(kunci);
    return o ? new TextDecoder().decode(o.bytes) : null;
  };
  const pasalTersimpan = () => baris(l, `SELECT nomor_pasal, ayat, isi FROM articles ORDER BY urutan`);
  const pembacaan = () => satu<Record<string, unknown>>(l, `SELECT * FROM pembacaan_ai WHERE frbr_uri = ?`, URI);
  const logEkstraksi = () => satu<Record<string, unknown>>(l, `SELECT vonis, jumlah_pasal, panjang_teks, catatan FROM ekstraksi_log WHERE frbr_uri = ?`, URI);
  const tokenHariIni = () => [...l.kv.isi.entries()].filter(([k]) => k.startsWith("gemini:token:")).map(([, v]) => Number(v.nilai));

  describe("pesan antrean { pembaca: 'gemini' }", () => {
    it("peraturan tanpa pasal: PDF dikirim ke Gemini (bukan toMarkdown), pasal tersimpan, arsip dipromosikan, anggaran dicatat", async () => {
      await tanamLama({ vonis: "tanpa_pasal" });
      const panggilan = pasangGemini([ok(NASKAH_AI)]);

      expect(await jalan()).toEqual({ diakui: 1, diulang: [] });

      expect(panggilan).toHaveLength(1);
      expect(panggilan[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-uji:generateContent");
      expect(panggilan[0].header["x-goog-api-key"]).toBe(KUNCI);
      expect(panggilan[0].badan.contents[0].parts[0].inlineData.mimeType).toBe("application/pdf");
      expect(l.ai.konversi).toEqual([]); // Workers AI toMarkdown tidak dipakai

      expect(await pasalTersimpan()).toEqual([
        { nomor_pasal: "1", ayat: null, isi: "Sampah rumah tangga adalah sampah dari kegiatan sehari-hari." },
        { nomor_pasal: "2", ayat: "1", isi: "Setiap orang wajib memilah sampah." },
        { nomor_pasal: "2", ayat: "2", isi: "Pemerintah daerah menyediakan fasilitas pengelolaan sampah." },
        { nomor_pasal: "3", ayat: null, isi: "Ketentuan lebih lanjut mengenai pengelolaan sampah diatur dengan Peraturan Menteri." },
      ]);
      expect(await satu(l, `SELECT jumlah_pasal, r2_text_key, isi_status FROM laws WHERE frbr_uri = ?`, URI)).toEqual({ jumlah_pasal: 4, r2_text_key: KUNCI_MD, isi_status: "lengkap" });
      expect(await logEkstraksi()).toMatchObject({ vonis: "bersih", jumlah_pasal: 4, catatan: "dibaca Gemini (gemini-uji-001): 2 halaman, 1500 token" });
      expect(await pembacaan()).toMatchObject({
        hasil: "dipakai", model: "gemini-uji-001", halaman: 2, putaran: 1, token_masuk: 1000, token_keluar: 500, vonis_baru: "bersih", pasal_baru: 3, percobaan: 1,
      });

      // Teks Gemini diarsipkan terpisah dan, karena dipakai, dipromosikan ke arsip baku (yang dibaca uraian ulang `usang`).
      expect(await teksR2(KUNCI_AI)).toContain("### Page 1");
      expect(await teksR2(KUNCI_MD)).toBe(await teksR2(KUNCI_AI));
      expect(await teksR2(KUNCI_BAWAAN)).toBeNull(); // tak ada teks bawaan yang tertimpa
      expect(tokenHariIni()).toEqual([1500]);

      // Sisa pipeline berjalan seperti biasa: indeks vektor dan ringkasan AI diantrekan.
      expect(l.antrean.kuras()).toEqual([{ tipe: "indeks_vektor", frbr_uri: URI }, { tipe: "ringkas", frbr_uri: URI }]);
    });

    it("teks bawaan yang tertimpa disimpan sekali di teks-bawaan/, supaya bacaan AI yang keliru bisa dipulihkan", async () => {
      await tanamLama({ vonis: "tanpa_pasal", arsip: "TEKS BAWAAN ASLI" });
      pasangGemini([ok(NASKAH_AI), ok(NASKAH_AI)]);
      await jalan();
      expect(await teksR2(KUNCI_MD)).toContain("### Page 1");
      expect(await teksR2(KUNCI_BAWAAN)).toBe("TEKS BAWAAN ASLI");
      // Pembacaan kedua (ulangi) tak menimpa salinan asli dengan teks Gemini.
      await jalan({ ulangi: true });
      expect(await teksR2(KUNCI_BAWAAN)).toBe("TEKS BAWAAN ASLI");
    });

    it("pesan ganda untuk peraturan yang sama (diantrekan dua kali): Gemini dibayar sekali, yang kedua dilewati", async () => {
      await tanamLama({ vonis: "tanpa_pasal" });
      const panggilan = pasangGemini([ok(NASKAH_AI)]);
      expect(await jalankanAntrean(l, [pesan(), pesan()])).toEqual({ diakui: 2, diulang: [] });
      expect(panggilan).toHaveLength(1);
      expect(await pembacaan()).toMatchObject({ hasil: "dipakai", percobaan: 1 });
      expect(await satu(l, `SELECT detail FROM sync_log WHERE job = 'ekstrak_pdf' AND status = 'gagal' ORDER BY id DESC LIMIT 1`)).toMatchObject({
        detail: expect.stringContaining("sudah pernah dicoba (dipakai)"),
      });
    });

    it("peraturan yang pernah dicoba dilewati tanpa `ulangi`; dengan `ulangi` dibaca ulang; percobaan kering tak menghalangi", async () => {
      await tanamLama({ vonis: "tanpa_pasal" });
      await l.db.prepare(`INSERT INTO pembacaan_ai (frbr_uri, hasil, catatan) VALUES (?, 'gagal', 'lama')`).bind(URI).run();
      let panggilan = pasangGemini([]);
      await jalan();
      expect(panggilan).toHaveLength(0);
      expect(await pembacaan()).toMatchObject({ hasil: "gagal", catatan: "lama" });

      panggilan = pasangGemini([ok(NASKAH_AI)]);
      await jalan({ ulangi: true });
      expect(panggilan).toHaveLength(1);
      expect(await pembacaan()).toMatchObject({ hasil: "dipakai", percobaan: 2 });

      await l.db.prepare(`UPDATE pembacaan_ai SET hasil = 'uji' WHERE frbr_uri = ?`).bind(URI).run();
      panggilan = pasangGemini([ok(NASKAH_AI)]);
      await jalan();
      expect(panggilan).toHaveLength(1);
    });

    it("pengesahan di akhir naskah bukan isi pasal terakhir, seperti pada teks hasil konversi bawaan", async () => {
      await tanamLama({ vonis: "tanpa_pasal" });
      pasangGemini([ok(NASKAH_AI)]);
      await jalan();
      const terakhir = (await pasalTersimpan()).at(-1);
      expect(terakhir?.isi).not.toMatch(/Agar setiap orang|Lembaran Negara/);
    });

    it("pasal tersimpan lebih utuh: hasil Gemini lolos pemeriksaan tetapi dipertahankan; log ekstraksi dan arsip lama tak disentuh", async () => {
      const lama = Array.from({ length: 10 }, (_, i) => ({ nomor: String(i + 1), isi: `Isi lama pasal ${i + 1}.` }));
      await tanamLama({ vonis: "ringan", pasal: lama, arsip: "TEKS LAMA" });
      pasangGemini([ok(NASKAH_AI)]);

      expect(await jalan()).toEqual({ diakui: 1, diulang: [] });

      expect(await pasalTersimpan()).toHaveLength(10);
      expect(await logEkstraksi()).toMatchObject({ vonis: "ringan", panjang_teks: 744, catatan: "lama" });
      expect(await teksR2(KUNCI_MD)).toBe("TEKS LAMA");
      expect(await teksR2(KUNCI_AI)).toContain("Pasal 2");
      expect(await pembacaan()).toMatchObject({
        hasil: "dipertahankan", catatan: "dipertahankan: 7 dari 10 nomor pasal tersimpan tidak ada pada hasil Gemini", pasal_baru: 3,
      });
      expect(l.antrean.kuras()).toEqual([]);
    });

    it("baris lama dari pengurai terdahulu (Penjelasan sebagai pasal, nomor sampah, pencilan) tak membuat bacaan yang lengkap dipertahankan", async () => {
      // Kasus UU 32/2014 (Kelautan): baris tersimpan memuat Penjelasan sebagai pasal berulang, nomor rusak OCR ("2O", "I"), dan
      // satu nomor pencilan, sehingga jumlah nomor berbeda (6) melebihi bacaan Gemini yang lengkap (3) padahal tak ada pasal yang hilang.
      const lama = [
        ...["1", "2", "3"].map((n) => ({ nomor: n, isi: `Isi lama pasal ${n}.` })),
        { nomor: "2O", isi: "Isi lama pasal 2 dengan nomor rusak." },
        { nomor: "I", isi: "Cukup jelas." },
        { nomor: "107", isi: "Cukup jelas." },
      ];
      await tanamLama({ vonis: "ringan", pasal: lama, arsip: "TEKS LAMA" });
      pasangGemini([ok(NASKAH_AI)]);

      expect(await jalan()).toEqual({ diakui: 1, diulang: [] });

      expect((await pasalTersimpan()).map((p) => p.nomor_pasal)).toEqual(["1", "2", "2", "3"]);
      expect(await pembacaan()).toMatchObject({ hasil: "dipakai", pasal_baru: 3 });
      expect(await teksR2(KUNCI_BAWAAN)).toBe("TEKS LAMA");
    });

    it("bacaan yang kehilangan pasal tersimpan (di luar toleransi 5%) tetap dipertahankan walau jumlahnya sama", async () => {
      // Tiga nomor tersimpan (1, 7, 9) dan tiga nomor hasil Gemini (1, 2, 3): jumlahnya sama, tetapi 7 dan 9 hilang.
      await tanamLama({ vonis: "ringan", pasal: ["1", "7", "9"].map((n) => ({ nomor: n, isi: `Isi lama pasal ${n}.` })), arsip: "TEKS LAMA" });
      pasangGemini([ok(NASKAH_AI)]);

      await jalan();

      expect((await pasalTersimpan()).map((p) => p.nomor_pasal)).toEqual(["1", "7", "9"]);
      expect(await pembacaan()).toMatchObject({ hasil: "dipertahankan", catatan: "dipertahankan: 2 dari 3 nomor pasal tersimpan tidak ada pada hasil Gemini" });
    });

    it("pembacaan bermasalah (halaman terlewat dibanding PDF) ditolak: tak ada pasal, log ekstraksi tetap, teks diarsipkan untuk diperiksa", async () => {
      l.r2.objek.set(KUNCI_PDF, { bytes: pdf(12) });
      await tanamLama({ vonis: "tanpa_pasal" });
      pasangGemini([ok(NASKAH_AI)]); // hanya 2 dari 12 halaman

      await jalan();

      expect(await pasalTersimpan()).toEqual([]);
      expect(await logEkstraksi()).toMatchObject({ vonis: "tanpa_pasal", catatan: "lama" });
      expect(await pembacaan()).toMatchObject({ hasil: "ditolak", catatan: expect.stringContaining("hanya 2 dari 12 halaman PDF yang terbaca") });
      expect(await teksR2(KUNCI_AI)).not.toBeNull();
      expect(await teksR2(KUNCI_MD)).toBeNull();
    });

    it("PDF yang ternyata memuat peraturan lain ditolak, bukan disimpan sebagai pasal peraturan ini", async () => {
      await tanamLama({ vonis: "tanpa_pasal" });
      pasangGemini([ok(NASKAH_AI.replace("NOMOR 99 TAHUN 2025", "NOMOR 5 TAHUN 2020"))]);
      await jalan();
      expect(await pasalTersimpan()).toEqual([]);
      expect(await pembacaan()).toMatchObject({ hasil: "ditolak", catatan: expect.stringMatching(/PP 5\/2020, bukan PP 99\/2025/) });
      expect(await logEkstraksi()).toMatchObject({ vonis: "tanpa_pasal", catatan: "lama" });
    });

    it("teks tanpa pasal yang dapat dikenali ditolak tanpa mengubah log atau penunjuk teks", async () => {
      await tanamLama({ vonis: "tanpa_pasal" });
      const prosa = `=== HALAMAN 1 ===\n${"Naskah ini hanya berisi uraian umum tanpa satu pun pasal yang dapat dikenali oleh pengurai. ".repeat(4)}\n=== HALAMAN 2 ===\n${"Lanjutan uraian yang sama panjangnya. ".repeat(5)}`;
      pasangGemini([ok(prosa)]);
      await jalan();
      expect(await pasalTersimpan()).toEqual([]);
      expect(await pembacaan()).toMatchObject({ hasil: "ditolak", catatan: "tidak ada pasal terdeteksi pada teks Gemini" });
      expect(await satu(l, `SELECT r2_text_key FROM laws WHERE frbr_uri = ?`, URI)).toEqual({ r2_text_key: null });
    });

    it("tanpa secret GEMINI_API: pesan dilepas (bukan diulang tanpa akhir), tak ada panggilan jaringan dan tak ada catatan per dokumen", async () => {
      await tanamLama({ vonis: "tanpa_pasal" });
      delete l.env.GEMINI_API;
      const panggilan = pasangGemini([]);
      expect(await jalan()).toEqual({ diakui: 1, diulang: [] });
      expect(panggilan).toHaveLength(0);
      expect(await pembacaan()).toBeNull();
      expect(await satu(l, `SELECT status, detail FROM sync_log WHERE job = 'ekstrak_pdf' ORDER BY id DESC LIMIT 1`)).toMatchObject({ status: "gagal", detail: expect.stringContaining("GEMINI_API belum dipasang") });
    });

    it("anggaran token harian habis: tidak memanggil Gemini, pesan dilepas, dokumen tetap layak dicoba besok", async () => {
      await tanamLama({ vonis: "tanpa_pasal" });
      l.env.GEMINI_BATAS_HARIAN = "100000";
      await l.kv.put(`gemini:token:${new Date().toISOString().slice(0, 10)}`, "100000");
      const panggilan = pasangGemini([]);
      expect(await jalan()).toEqual({ diakui: 1, diulang: [] });
      expect(panggilan).toHaveLength(0);
      expect(await pembacaan()).toBeNull();
      expect(await satu(l, `SELECT detail FROM sync_log WHERE job = 'ekstrak_pdf' ORDER BY id DESC LIMIT 1`)).toMatchObject({ detail: expect.stringContaining("Anggaran token harian") });
    });

    it("sisa anggaran menjadi batas satu dokumen: pembacaan berputar berhenti begitu terlampaui, token tetap tercatat, dokumen tetap layak dicoba", async () => {
      await tanamLama({ vonis: "tanpa_pasal" });
      l.env.GEMINI_BATAS_HARIAN = "2000";
      const panggilan = pasangGemini([
        ok(`=== HALAMAN 1 ===\n${"a".repeat(200)}\n=== HALAMAN 2 ===\n${"b".repeat(200)}\n=== HALAMAN 3 ===\nterpotong`, { selesai: "MAX_TOKENS", masuk: 1500, keluar: 1500 }),
        ok(NASKAH_AI),
      ]);
      expect(await jalan()).toEqual({ diakui: 1, diulang: [] });
      expect(panggilan).toHaveLength(1); // putaran kedua tidak dikirim
      expect(await pembacaan()).toBeNull();
      expect(await pasalTersimpan()).toEqual([]);
      expect(tokenHariIni()).toEqual([3000]);
      expect(await satu(l, `SELECT detail FROM sync_log WHERE job = 'ekstrak_pdf' ORDER BY id DESC LIMIT 1`)).toMatchObject({ detail: expect.stringContaining("gemini anggaran") });
    });

    it("pesan dengan dari_teks dan pembaca gemini sekaligus: yang menang pembaca (PDF dibaca Gemini, arsip teks tak dipakai)", async () => {
      await tanamLama({ vonis: "bersih", pasal: [{ nomor: "1", isi: "Isi lama." }], arsip: "Pasal 1\nIsi lama yang diurai ulang." });
      const panggilan = pasangGemini([ok(NASKAH_AI)]);
      await jalan({ dari_teks: true });
      expect(panggilan).toHaveLength(1);
      expect((await pasalTersimpan()).map((p) => p.nomor_pasal)).toEqual(["1", "2", "2", "3"]);
    });

    it("kuota Google habis (429): pesan dikembalikan ke antrean dengan jeda dari Retry-After; belum ada catatan percobaan", async () => {
      await tanamLama({ vonis: "tanpa_pasal" });
      pasangGemini([galatHttp(429, "quota exceeded", { "retry-after": "45" })]);
      expect(await jalan()).toEqual({ diakui: 0, diulang: [{ penundaanDetik: 45 }] });
      expect(await pembacaan()).toBeNull();
      expect(tokenHariIni()).toEqual([]);
    });

    describe("galat lokasi Google (400 'User location is not supported'): sifat lokasi eksekusi, bukan salah dokumen", () => {
      const lokasi = () => galatHttp(400, "User location is not supported for the API use.");
      /** Jawaban untuk jejak lokasi keluar (cdn-cgi/trace); selebihnya dijawab `gemini`. */
      const pasangDenganJejak = (gemini: Array<Response | (() => Response)>) => {
        const panggilan: string[] = [];
        vi.stubGlobal("fetch", async (url: string | URL | Request) => {
          panggilan.push(String(url));
          if (String(url).includes("cdn-cgi/trace")) return new Response("fl=1\nip=203.0.113.9\ncolo=HKG\nloc=HK\nhttp=http/2\n");
          const j = gemini.shift();
          if (!j) throw new Error("panggilan Gemini tak terduga");
          return typeof j === "function" ? j() : j;
        });
        return panggilan;
      };
      /** Jalankan pesan sambil memajukan jeda ulang di tempat (4 dan 12 detik) tanpa menunggu sungguhan. */
      const jalanDenganJeda = async (ubah: Record<string, unknown> = {}) => {
        vi.useFakeTimers({ toFake: ["setTimeout"] });
        try {
          const p = jalan(ubah);
          await vi.advanceTimersByTimeAsync(30_000);
          return await p;
        } finally {
          vi.useRealTimers();
        }
      };

      it("tiga kali ditolak: pesan dikembalikan ke antrean dengan jeda 120 detik, tanpa catatan 'gagal' dan tanpa anggaran terpakai", async () => {
        await tanamLama({ vonis: "tanpa_pasal" });
        const panggilan = pasangDenganJejak([lokasi(), lokasi(), lokasi()]);
        expect(await jalanDenganJeda()).toEqual({ diakui: 0, diulang: [{ penundaanDetik: 120 }] });
        expect(panggilan.filter((u) => u.includes("generateContent"))).toHaveLength(3);
        expect(await pembacaan()).toBeNull(); // dokumen ini tetap layak dicoba di lokasi lain
        expect(tokenHariIni()).toEqual([]);
        expect(await pasalTersimpan()).toEqual([]);
      });

      it("diulang di tempat dan berhasil pada percobaan kedua: pembacaan selesai seperti biasa", async () => {
        await tanamLama({ vonis: "tanpa_pasal" });
        pasangDenganJejak([lokasi(), ok(NASKAH_AI)]);
        expect(await jalanDenganJeda()).toEqual({ diakui: 1, diulang: [] });
        expect(await pembacaan()).toMatchObject({ hasil: "dipakai", pasal_baru: 3 });
      });

      it("percobaan kering dari antrean (Cron): sama, tidak dicatat 'gagal' sehingga tidak hilang dari daftar calon", async () => {
        pasangDenganJejak([lokasi(), lokasi(), lokasi()]);
        expect(await jalanDenganJeda({ uji: true })).toEqual({ diakui: 0, diulang: [{ penundaanDetik: 120 }] });
        expect(await pembacaan()).toBeNull();
      });

      it("terlihat dari D1: satu baris sync_log 'gemini_galat' memuat jenis, alamat peraturan, dan lokasi keluar Worker; tidak membanjir", async () => {
        await tanamLama({ vonis: "tanpa_pasal" });
        pasangDenganJejak([lokasi(), lokasi(), lokasi(), lokasi(), lokasi(), lokasi()]);
        await jalanDenganJeda();
        await jalanDenganJeda(); // dalam 10 menit: tidak ditulis lagi
        const catatan = await baris<{ detail: string; status: string }>(l, `SELECT detail, status FROM sync_log WHERE job = 'gemini_galat'`);
        expect(catatan).toHaveLength(1);
        expect(catatan[0].status).toBe("gagal");
        expect(catatan[0].detail).toContain(URI);
        expect(catatan[0].detail).toContain("lokasi: Google menolak lokasi tempat Worker berjalan");
        expect(catatan[0].detail).toContain("[colo=HKG loc=HK]");
        expect(catatan[0].detail).not.toContain("203.0.113.9"); // alamat IP tak dicatat
        expect(catatan[0].detail).not.toContain(KUNCI);
        // Pembatasnya kedaluwarsa dalam 10 menit.
        const sisaDetik = ((l.kv.isi.get("gemini:galat:lokasi")?.kedaluwarsa ?? 0) - Date.now()) / 1000;
        expect(sisaDetik).toBeGreaterThan(590);
        expect(sisaDetik).toBeLessThanOrEqual(600);

        // Sesudah 10 menit (kuncinya kedaluwarsa), galat yang sama dicatat lagi.
        for (const k of [...l.kv.isi.keys()]) if (k.startsWith("gemini:galat:")) l.kv.isi.delete(k);
        pasangDenganJejak([lokasi(), lokasi(), lokasi()]);
        await jalanDenganJeda();
        expect(await baris(l, `SELECT detail FROM sync_log WHERE job = 'gemini_galat'`)).toHaveLength(2);
      });

      it("jejak lokasi yang tak terjangkau tidak mengganggu pengulangan pesan (diagnosis hanya pelengkap)", async () => {
        await tanamLama({ vonis: "tanpa_pasal" });
        vi.stubGlobal("fetch", async (url: string | URL | Request) => {
          if (String(url).includes("cdn-cgi/trace")) throw new Error("jaringan putus");
          return lokasi();
        });
        expect(await jalanDenganJeda()).toEqual({ diakui: 0, diulang: [{ penundaanDetik: 120 }] });
        const [catat] = await baris<{ detail: string }>(l, `SELECT detail FROM sync_log WHERE job = 'gemini_galat'`);
        expect(catat.detail).toContain("lokasi:");
        expect(catat.detail).not.toContain("[colo");
      });

      it("galat sementara lain (429) juga dicatat satu kali per 10 menit, tanpa jejak lokasi", async () => {
        await tanamLama({ vonis: "tanpa_pasal" });
        const panggilan = pasangDenganJejak([galatHttp(429, "quota exceeded", { "retry-after": "45" })]);
        expect(await jalan()).toEqual({ diakui: 0, diulang: [{ penundaanDetik: 45 }] });
        expect(panggilan.some((u) => u.includes("cdn-cgi/trace"))).toBe(false);
        const [catat] = await baris<{ detail: string }>(l, `SELECT detail FROM sync_log WHERE job = 'gemini_galat'`);
        expect(catat.detail).toContain("kuota:");
      });
    });

    it("kunci salah: berlaku untuk semua dokumen, jadi dilepas tanpa menandai dokumen ini 'gagal' (tetap layak dicoba setelah kunci diperbaiki)", async () => {
      await tanamLama({ vonis: "tanpa_pasal" });
      pasangGemini([galatHttp(400, `API key not valid. Please pass a valid API key. (${KUNCI})`)]);
      expect(await jalan()).toEqual({ diakui: 1, diulang: [] });
      expect(await pembacaan()).toBeNull();
      const log = await satu<{ detail: string }>(l, `SELECT detail FROM sync_log WHERE job = 'ekstrak_pdf' ORDER BY id DESC LIMIT 1`);
      expect(log?.detail).toContain("gemini kunci");
      expect(log?.detail).not.toContain(KUNCI);
    });

    it("Gemini menolak dokumen ini (PDF tak sah, diblokir, RECITATION): dicatat 'gagal' dan tidak diulang", async () => {
      await tanamLama({ vonis: "tanpa_pasal" });
      pasangGemini([galatHttp(400, "The document has no pages.")]);
      expect(await jalan()).toEqual({ diakui: 1, diulang: [] });
      expect(await pembacaan()).toMatchObject({ hasil: "gagal", catatan: expect.stringContaining("permintaan: Gemini menolak permintaan (HTTP 400): The document has no pages.") });

      pasangGemini([ok("sebagian", { selesai: "RECITATION", masuk: 800, keluar: 50 })]);
      expect(await jalan({ ulangi: true })).toEqual({ diakui: 1, diulang: [] }); // tanpa `ulangi`, yang sudah dicoba dilewati
      expect(await pembacaan()).toMatchObject({ hasil: "gagal", catatan: expect.stringContaining("RECITATION"), percobaan: 2 });
      expect(tokenHariIni()).toEqual([850]); // token pembacaan yang gagal tetap dihitung
    });

    it("galat tak terduga (bukan dari Gemini) tidak ditelan: pesan dikembalikan ke antrean, tanpa catatan 'gagal' palsu", async () => {
      await tanamLama({ vonis: "tanpa_pasal" });
      vi.stubGlobal("fetch", async () => null); // pelanggaran kontrak fetch: bug, bukan jawaban Google
      expect(await jalan()).toEqual({ diakui: 0, diulang: [{ penundaanDetik: undefined }] });
      expect(await pembacaan()).toBeNull();
      expect(await pasalTersimpan()).toEqual([]);
    });

    it("PDF yang ditunjuk laws tetapi tak ada di R2: dicatat gagal (bukan berputar sampai DLQ), tanpa menyentuh jaringan; pembacaan biasa tetap melempar", async () => {
      await tanamLama({ vonis: "tanpa_pasal" });
      l.r2.objek.delete(KUNCI_PDF);
      const panggilan = pasangGemini([]);
      expect(await jalan()).toEqual({ diakui: 1, diulang: [] });
      expect(panggilan).toHaveLength(0);
      expect(await pembacaan()).toMatchObject({ hasil: "gagal", catatan: `Berkas ${KUNCI_PDF} tidak ada di R2` });
      // Jalur biasa (bukan Gemini) tak berubah: galat dilempar dan antrean mengulang.
      expect(await jalankanAntrean(l, [{ tipe: "ekstrak_pdf", frbr_uri: URI, r2_key: KUNCI_PDF }])).toEqual({ diakui: 0, diulang: [{ penundaanDetik: undefined }] });
    });

    it("percobaan kering dari antrean untuk PDF yang hilang dari R2: dicatat gagal dan diakui", async () => {
      await tanamLama({ vonis: "tanpa_pasal" });
      l.r2.objek.delete(KUNCI_PDF);
      expect(await jalan({ uji: true })).toEqual({ diakui: 1, diulang: [] });
      expect(await pembacaan()).toMatchObject({ hasil: "gagal", catatan: expect.stringContaining("tidak ada di R2") });
    });

    it("PDF terlalu besar untuk dikirim sebaris dicatat 'gagal' tanpa menyentuh jaringan", async () => {
      await tanamLama({ vonis: "tanpa_pasal" });
      l.r2.objek.set(KUNCI_PDF, { bytes: new Uint8Array(15 * 1024 * 1024) });
      const panggilan = pasangGemini([]);
      await jalan();
      expect(panggilan).toHaveLength(0);
      expect(await pembacaan()).toMatchObject({ hasil: "gagal", catatan: expect.stringContaining("terlalu_besar") });
    });

    describe("PDF panjang dibaca per potongan (pdf-lib)", () => {
      const ISI = "Setiap orang wajib mematuhi ketentuan peraturan perundang-undangan yang berlaku dan menjaga ketertiban umum di wilayahnya.";
      /** PDF sungguhan dengan `n` halaman. */
      const pdfSungguhan = async (n: number) => {
        const dok = await PDFDocument.create();
        for (let i = 1; i <= n; i++) dok.addPage([100 + i, 200]).drawText(`Halaman ${i}`, { x: 5, y: 100, size: 8 });
        return dok.save();
      };
      /** Jawaban Gemini untuk potongan halaman m..a dari `total`: judul resmi di halaman pertama naskah, "Pasal n" di tiap halaman. */
      const teksPotongan = (m: number, a: number, total: number) =>
        Array.from({ length: a - m + 1 }, (_, i) => {
          const hlm = m + i;
          const kepala = hlm === 1 ? ["PERATURAN PEMERINTAH REPUBLIK INDONESIA", "NOMOR 99 TAHUN 2025", "TENTANG", "PENGELOLAAN SAMPAH", "BAB I", "KETENTUAN UMUM"] : [];
          const penutup = hlm === total ? ["Agar setiap orang mengetahuinya, memerintahkan pengundangan peraturan ini dengan penempatannya dalam Lembaran Negara Republik Indonesia."] : [];
          return [`=== HALAMAN ${i + 1} ===`, ...kepala, `Pasal ${hlm}`, ISI, ...penutup].join("\n");
        }).join("\n");
      /** `fetch` palsu yang menjawab menurut rentang yang diminta; `jawab` mengembalikan Response untuk menyimpang dari jawaban normal. */
      const pasangPotongan = (jawab?: (m: number, a: number, total: number) => Response | undefined) => {
        const rentang: string[] = [];
        vi.stubGlobal("fetch", async (_u: string | URL | Request, init?: RequestInit) => {
          const badan = JSON.parse(String(init?.body));
          const mm = /halaman (\d+) sampai (\d+) dari naskah sepanjang (\d+)/.exec(badan.contents[0].parts[1].text);
          const [m, a, total] = [Number(mm?.[1]), Number(mm?.[2]), Number(mm?.[3])];
          rentang.push(`${m}-${a}`);
          return jawab?.(m, a, total) ?? ok(teksPotongan(m, a, total), { masuk: 700, keluar: 400 });
        });
        return rentang;
      };
      const uji = (badan: unknown) => panggil(l, "/api/impor/gemini-uji", kirim("POST", badan, adm));
      const awalanBagian = (ukuran: number) => `teks-ai-bagian/akn/id/act/pp/2025/99/${ukuran}/`;
      const kunciBagian = () => [...l.r2.objek.keys()].filter((k) => k.startsWith("teks-ai-bagian/")).sort();

      let bytes: Uint8Array;
      beforeEach(async () => {
        bytes = await pdfSungguhan(12);
        l.r2.objek.set(KUNCI_PDF, { bytes });
        await tanamLama({ vonis: "tanpa_pasal" });
      });

      it("12 halaman: tiga panggilan (4 + 4 + 4), pasal 1-12 tersimpan, token dijumlahkan, potongan sementara dibersihkan", async () => {
        const rentang = pasangPotongan();
        expect(await jalan()).toEqual({ diakui: 1, diulang: [] });
        expect(rentang.sort()).toEqual(["1-4", "5-8", "9-12"]);
        expect((await pasalTersimpan()).map((p) => p.nomor_pasal)).toEqual(Array.from({ length: 12 }, (_, i) => String(i + 1)));
        expect(await pembacaan()).toMatchObject({ hasil: "dipakai", halaman: 12, putaran: 3, token_masuk: 2100, token_keluar: 1200, vonis_baru: "bersih", pasal_baru: 12 });
        expect(tokenHariIni()).toEqual([3300]);
        expect(await teksR2(KUNCI_AI)).toContain("### Page 12");
        expect(kunciBagian()).toEqual([]);
      });

      it("kuota di tengah jalan: pesan diulang dengan jeda Retry-After, potongan yang selesai tersimpan, dan percobaan berikutnya hanya membaca sisanya", async () => {
        pasangPotongan((m) => (m === 5 ? galatHttp(429, "quota", { "retry-after": "40" }) : undefined));
        expect(await jalan()).toEqual({ diakui: 0, diulang: [{ penundaanDetik: 40 }] });
        expect(await pasalTersimpan()).toEqual([]);
        expect(await pembacaan()).toBeNull(); // galat sementara tak dicatat sebagai hasil
        expect(kunciBagian()).toEqual([`${awalanBagian(bytes.byteLength)}1-4.md`, `${awalanBagian(bytes.byteLength)}9-12.md`]);

        const kedua = pasangPotongan();
        expect(await jalan()).toEqual({ diakui: 1, diulang: [] });
        expect(kedua).toEqual(["5-8"]);
        expect((await pasalTersimpan()).map((p) => p.nomor_pasal)).toEqual(Array.from({ length: 12 }, (_, i) => String(i + 1)));
        expect(await pembacaan()).toMatchObject({ hasil: "dipakai", halaman: 12, putaran: 1 });
        expect(kunciBagian()).toEqual([]);
        // Anggaran: dua potongan dari percobaan pertama + satu dari kedua, masing-masing 1.100 token.
        expect(tokenHariIni()).toEqual([3300]);
      });

      it("penolakan tetap (SAFETY) pada satu potongan: dicatat gagal, dan potongan yang tersimpan dibersihkan karena tak akan dilanjutkan siapa pun", async () => {
        pasangPotongan((m) => (m === 5 ? ok("x", { selesai: "SAFETY" }) : undefined));
        expect(await jalan()).toEqual({ diakui: 1, diulang: [] });
        expect(await pembacaan()).toMatchObject({ hasil: "gagal", catatan: expect.stringContaining("diblokir") });
        expect(await pasalTersimpan()).toEqual([]);
        expect(kunciBagian()).toEqual([]);
      });

      it("tenggat pesan lewat di tengah pembacaan: diulang dengan jeda 30 detik, bagian yang selesai tersimpan, lalu dilanjutkan", async () => {
        l.env.GEMINI_PARALEL = "1";
        vi.useFakeTimers({ toFake: ["Date"] });
        const rentang = pasangPotongan((m) => {
          if (m === 1) vi.setSystemTime(Date.now() + 8 * 60_000); // potongan pertama memakan delapan menit: tenggat tujuh menit lewat
          return undefined;
        });
        expect(await jalan()).toEqual({ diakui: 0, diulang: [{ penundaanDetik: 30 }] });
        expect(rentang).toEqual(["1-4"]);
        expect(kunciBagian()).toEqual([`${awalanBagian(bytes.byteLength)}1-4.md`]);

        expect(await jalan()).toEqual({ diakui: 1, diulang: [] });
        expect(rentang).toEqual(["1-4", "5-8", "9-12"]);
        expect((await pasalTersimpan()).length).toBe(12);
        expect(kunciBagian()).toEqual([]);
      });

      it("PDF yang diganti (ukuran berbeda) tak memakai potongan PDF yang lama", async () => {
        pasangPotongan((m) => (m === 5 ? galatHttp(429, "quota") : undefined));
        await jalan();
        expect(kunciBagian()).toHaveLength(2);
        // PDF diganti dengan yang lain: potongan lama tak cocok dengan kunci baru, jadi semuanya dibaca ulang.
        const baru = await pdfSungguhan(11);
        l.r2.objek.set(KUNCI_PDF, { bytes: baru });
        const rentang = pasangPotongan();
        await jalan();
        expect(rentang.sort()).toEqual(["1-4", "5-8", "9-11"]);
      });

      it("batas halaman total (GEMINI_HALAMAN_MAKS): PDF yang lebih panjang dicatat 'gagal' tanpa menyentuh Gemini, anggaran, atau pasal tersimpan", async () => {
        l.env.GEMINI_HALAMAN_MAKS = "11";
        const rentang = pasangPotongan();
        expect(await jalan()).toEqual({ diakui: 1, diulang: [] });
        expect(rentang).toEqual([]);
        const baris = await pembacaan();
        expect(baris).toMatchObject({ hasil: "gagal", catatan: expect.stringContaining("terlalu_panjang") });
        expect(baris?.catatan).toContain("12 halaman");
        expect(baris?.catatan).toContain("GEMINI_HALAMAN_MAKS");
        expect(await pasalTersimpan()).toEqual([]);
        expect(tokenHariIni().reduce((a, b) => a + b, 0)).toBe(0);
        expect(kunciBagian()).toEqual([]);
        // Dicatat sehingga putaran berikutnya tak mengulangnya: pesan kedua tak menghasilkan panggilan.
        expect(await jalan()).toEqual({ diakui: 1, diulang: [] });
        expect(rentang).toEqual([]);
      });

      it("tepat sebanyak batas (12 halaman, batas 12): dibaca seperti biasa", async () => {
        l.env.GEMINI_HALAMAN_MAKS = "12";
        const rentang = pasangPotongan();
        expect(await jalan()).toEqual({ diakui: 1, diulang: [] });
        expect(rentang.sort()).toEqual(["1-4", "5-8", "9-12"]);
        expect(await pembacaan()).toMatchObject({ hasil: "dipakai", halaman: 12 });
      });

      it("percobaan kering dari antrean (Cron) pada PDF terlalu panjang: dicatat 'gagal' (bukan 'uji'), jadi tak dipilih lagi dan tak memakan jatah percobaan", async () => {
        l.env.GEMINI_HALAMAN_MAKS = "5";
        const rentang = pasangPotongan();
        expect(await jalan({ uji: true })).toEqual({ diakui: 1, diulang: [] });
        expect(rentang).toEqual([]);
        expect(await pembacaan()).toMatchObject({ hasil: "gagal", catatan: expect.stringContaining("uji: terlalu_panjang") });
        expect((await satu<{ n: number }>(l, `SELECT COUNT(*) AS n FROM pembacaan_ai WHERE hasil = 'uji'`))?.n).toBe(0);
      });

      it("POST /gemini-uji pada PDF terlalu panjang: 502 'terlalu_panjang' yang tetap, tanpa panggilan Gemini dan tanpa catatan", async () => {
        l.env.GEMINI_HALAMAN_MAKS = "5";
        const rentang = pasangPotongan();
        const res = await uji({ uri: URI });
        expect(res.status).toBe(502);
        expect(await json(res)).toMatchObject({ error: "gemini_galat", jenis: "terlalu_panjang", sementara: false });
        expect(rentang).toEqual([]);
        expect(await pembacaan()).toBeNull();
      });

      it("catatan percobaan kering memuat ringkasan dan cuplikan transkripsi (awal dan tengah), dibatasi 2.000 karakter, untuk dinilai dari D1", async () => {
        pasangPotongan();
        await uji({ uri: URI });
        const { catatan } = (await pembacaan()) as { catatan: string };
        expect(catatan.length).toBeLessThanOrEqual(2000);
        const [ringkas, cuplikan] = catatan.split("\n--- cuplikan ---\n");
        expect(ringkas).toContain("akan dipakai");
        expect(ringkas).toContain("pasal 12 (tertinggi 12, hilang 0)");
        expect(cuplikan).toContain("PERATURAN PEMERINTAH REPUBLIK INDONESIA"); // awal naskah
        expect(cuplikan).toContain("[...]");
        expect(cuplikan).toMatch(/Pasal [5-9]/); // bagian dari tengah
        expect(cuplikan).not.toContain("### Page"); // penanda halaman dibersihkan
      });

      it("percobaan kering lewat /gemini-uji: potongan dibaca paralel, laporan menyebut halaman PDF dan jumlah panggilan; tak ada pasal ditulis", async () => {
        pasangPotongan();
        const laporan = await json<Record<string, any>>(await uji({ uri: URI })); // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(laporan).toMatchObject({ halaman: 12, halaman_pdf: 12, putaran: 3, masalah: [], keputusan: { hasil: "dipakai" } });
        expect(laporan.hasil).toMatchObject({ nomor_pasal_berbeda: 12, pasal_tertinggi: 12, celah_pasal: 0, vonis: "bersih" });
        expect(await pasalTersimpan()).toEqual([]);
        expect(kunciBagian()).toEqual([]);
      });
    });

    describe("pesan Gemini yang tersisa dalam satu batch ditunda bila giliran sudah terlalu lama (batas waktu konsumer)", () => {
      const BERIKUTNYA = "/akn/id/act/pp/2025/100";
      /** Pembacaan pertama memakan sembilan menit, jadi pesan kedua tak boleh dimulai. */
      const pasangLambat = () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        return pasangGemini([
          () => {
            vi.setSystemTime(Date.now() + 9 * 60_000);
            return ok(NASKAH_AI);
          },
        ]);
      };

      it("dikirim ulang sebagai pesan baru dengan jeda 30 detik, lalu yang lama diakui: tidak menghabiskan max_retries", async () => {
        await tanamLama({ vonis: "tanpa_pasal" });
        const panggilan = pasangLambat();
        const hasil = await jalankanAntrean(l, [pesan(), pesan({ frbr_uri: BERIKUTNYA })]);
        expect(hasil).toEqual({ diakui: 2, diulang: [] }); // retry() tidak dipakai
        expect(panggilan).toHaveLength(1);
        const ulang = l.antrean.dikirim.filter((d) => (d.badan as { frbr_uri?: string }).frbr_uri === BERIKUTNYA);
        expect(ulang).toEqual([{ badan: pesan({ frbr_uri: BERIKUTNYA }), opsi: { delaySeconds: 30 } }]);
      });

      it("pengiriman ulang gagal: jatuh ke retry() dengan jeda yang sama, pesan tidak hilang", async () => {
        await tanamLama({ vonis: "tanpa_pasal" });
        pasangLambat();
        l.env.INGEST_QUEUE.send = async () => {
          throw new Error("antrean penuh");
        };
        const hasil = await jalankanAntrean(l, [pesan(), pesan({ frbr_uri: BERIKUTNYA })]);
        expect(hasil).toEqual({ diakui: 1, diulang: [{ penundaanDetik: 30 }] });
      });

      it("pesan non-Gemini di batch yang sama tetap dikerjakan walau giliran sudah lama", async () => {
        await tanamLama({ vonis: "tanpa_pasal" });
        pasangLambat();
        const hasil = await jalankanAntrean(l, [pesan(), { tipe: "ringkas", frbr_uri: URI }]);
        expect(hasil).toEqual({ diakui: 2, diulang: [] });
        expect(l.antrean.dikirim.filter((d) => d.opsi?.delaySeconds === 30)).toEqual([]);
      });
    });

    it("uraian ulang dari arsip (dari_teks) tidak pernah memanggil Gemini, walau pesannya membawa pembaca", async () => {
      await tanamLama({ vonis: "bersih", pasal: [{ nomor: "1", isi: "Isi lama." }], arsip: "Pasal 1\nIsi lama yang diurai ulang." });
      const panggilan = pasangGemini([]);
      // Pesan biasa dari_teks tanpa pembaca: jalur lama tetap utuh.
      expect(await jalankanAntrean(l, [{ tipe: "ekstrak_pdf", frbr_uri: URI, r2_key: KUNCI_PDF, dari_teks: true }])).toEqual({ diakui: 1, diulang: [] });
      expect(panggilan).toHaveLength(0);
      expect(l.ai.konversi).toEqual([]);
    });
  });

  describe("GET /api/impor/gemini-cek", () => {
    const cek = () => panggil(l, "/api/impor/gemini-cek", { headers: adm });

    it("menolak tanpa token admin", async () => {
      expect((await panggil(l, "/api/impor/gemini-cek")).status).toBe(401);
    });

    /** Panggil `gemini-cek` seolah-olah Worker berjalan di pusat data `colo` (properti `cf` yang diisi runtime Cloudflare). */
    const cekDi = (colo: string, placement?: string) => {
      const req = new Request(ASAL + "/api/impor/gemini-cek", { headers: { ...adm, ...(placement ? { "cf-placement": placement } : {}) } });
      Object.defineProperty(req, "cf", { value: { colo } });
      return worker.fetch(req, l.env, { waitUntil() {}, passThroughOnException() {} } as never);
    };

    it("melaporkan di pusat data mana Worker berjalan (colo dan placement); di luar Cloudflare keduanya null", async () => {
      pasangGemini([ok("siap"), ok("siap"), ok("siap")]);
      expect((await json<Record<string, unknown>>(await cek())).lokasi_worker).toEqual({ colo: null, placement: null });
      expect((await json<Record<string, unknown>>(await cekDi("IAD"))).lokasi_worker).toEqual({ colo: "IAD", placement: null });
      expect((await json<Record<string, unknown>>(await cekDi("IAD", "remote-IAD"))).lokasi_worker).toEqual({ colo: "IAD", placement: "remote-IAD" });
    });

    it("lokasi ditolak Google: 502 'lokasi' yang sementara, dengan pusat data tempat Worker berjalan, setelah tiga percobaan", async () => {
      const panggilan = pasangGemini([
        galatHttp(400, "User location is not supported for the API use."),
        galatHttp(400, "User location is not supported for the API use."),
        galatHttp(400, "User location is not supported for the API use."),
      ]);
      vi.useFakeTimers({ toFake: ["setTimeout"] });
      try {
        const p = cekDi("HKG", "local-HKG");
        await vi.advanceTimersByTimeAsync(30_000);
        const res = await p;
        expect(res.status).toBe(502);
        expect(await json(res)).toMatchObject({
          error: "gemini_galat", jenis: "lokasi", sementara: true, status: 400,
          message: expect.stringContaining("placement.region"), lokasi_worker: { colo: "HKG", placement: "local-HKG" },
        });
        expect(panggilan).toHaveLength(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it("tanpa secret GEMINI_API: 503 dengan petunjuk pemasangan", async () => {
      delete l.env.GEMINI_API;
      const res = await cek();
      expect(res.status).toBe(503);
      expect(await json(res)).toMatchObject({ error: "gemini_belum_dipasang", message: expect.stringContaining("Secret GEMINI_API") });
    });

    it("kunci dan model benar: melaporkan versi model, token, dan anggaran hari ini; alamat hanya hostnya", async () => {
      const panggilan = pasangGemini([ok("siap", { masuk: 10, keluar: 2, model: "gemini-uji-004" })]);
      const res = await cek();
      expect(res.status).toBe(200);
      expect(await json(res)).toMatchObject({
        tersedia: true, model: "gemini-uji", versi_model: "gemini-uji-004", alamat: "generativelanguage.googleapis.com", balasan: "siap",
        selesai: "STOP", token: { masuk: 10, keluar: 2, total: 12 }, anggaran: { terpakai: 12, batas: 5_000_000 },
      });
      expect(panggilan[0].badan.contents[0].parts[0].text).toMatch(/satu kata/);
      expect(tokenHariIni()).toEqual([12]);
    });

    it("melaporkan pengaturan yang berlaku (berpikir, halaman per panggilan, paralel, batas halaman) dan mengirim pengaturan berpikir yang sama dengan pembacaan", async () => {
      const panggilan = pasangGemini([ok("siap"), ok("siap")]);
      expect(await json(await cek())).toMatchObject({ berpikir: null, halaman_per_panggilan: 4, paralel: 3, halaman_maks: 120 });
      expect(panggilan[0].badan).not.toHaveProperty("generationConfig");

      l.env.GEMINI_BERPIKIR = "LOW";
      l.env.GEMINI_HALAMAN = "6";
      l.env.GEMINI_PARALEL = "2";
      l.env.GEMINI_HALAMAN_MAKS = "300";
      expect(await json(await cek())).toMatchObject({ berpikir: { tingkat: "LOW" }, halaman_per_panggilan: 6, paralel: 2, halaman_maks: 300 });
      expect(panggilan[1].badan.generationConfig).toEqual({ thinkingConfig: { thinkingLevel: "LOW" } });
    });

    it("pengaturan berpikir yang ditolak model: 502 'permintaan' dengan pesan Google, supaya terlihat sebelum ada PDF yang dibaca", async () => {
      l.env.GEMINI_BERPIKIR = "MINIMAL";
      pasangGemini([galatHttp(400, "Thinking level MINIMAL is not supported for this model")]);
      const res = await cek();
      expect(res.status).toBe(502);
      expect(await json(res)).toMatchObject({ jenis: "permintaan", sementara: false, status: 400, message: expect.stringContaining("MINIMAL") });
    });

    it("kunci ditolak Google: 502 berisi jenis dan pesan tanpa kunci", async () => {
      pasangGemini([galatHttp(403, `permission denied for ${KUNCI}`)]);
      const res = await cek();
      expect(res.status).toBe(502);
      const b = await json<{ jenis: string; message: string; sementara: boolean; status: number }>(res);
      expect(b).toMatchObject({ error: "gemini_galat", jenis: "kunci", sementara: false, status: 403 });
      expect(JSON.stringify(b)).not.toContain(KUNCI);
    });
  });

  describe("POST /api/impor/gemini-uji", () => {
    const uji = (badan: unknown) => panggil(l, "/api/impor/gemini-uji", kirim("POST", badan, adm));

    it("masukan tak sah: uri kosong 400, tak dikenal 404, tanpa PDF 409, di luar cakupan 422, tanpa kunci 503, tanpa token 401", async () => {
      expect((await uji({})).status).toBe(400);
      expect((await uji({ uri: "akn/id/act/pp/2025/99" })).status).toBe(400);
      expect((await uji({ uri: "/akn/id/act/pp/2025/404" })).status).toBe(404);
      await l.db.prepare(`UPDATE laws SET r2_pdf_key = NULL WHERE frbr_uri = ?`).bind(URI).run();
      expect((await uji({ uri: URI })).status).toBe(409);
      await sisipkan(l, [{ uri: "/akn/id/act/perpres/2020/1", jenis: "PERPRES", nomor: "1", tahun: 2020, judul: "Perpres" }]);
      expect((await uji({ uri: "/akn/id/act/perpres/2020/1" })).status).toBe(422);
      delete l.env.GEMINI_API;
      expect((await uji({ uri: URI })).status).toBe(503);
      expect((await panggil(l, "/api/impor/gemini-uji", kirim("POST", { uri: URI }))).status).toBe(401);
    });

    it("melaporkan apa yang akan terjadi tanpa menulis pasal, log ekstraksi, atau arsip baku; teks diarsipkan di teks-ai/", async () => {
      await tanamLama({ vonis: "tanpa_pasal", arsip: "Naskah lama yang nyaris kosong." });
      const panggilan = pasangGemini([ok(NASKAH_AI, { masuk: 2500, keluar: 700 })]);

      const res = await uji({ uri: URI });
      expect(res.status).toBe(200);
      const laporan = await json<Record<string, any>>(res); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(laporan).toMatchObject({
        uri: URI, model: "gemini-uji-001", halaman: 2, halaman_pdf: 2, putaran: 1, masalah: [],
        token: { masuk: 2500, keluar: 700, total: 3200 },
        hasil: { jumlah_baris_pasal: 4, nomor_pasal_berbeda: 3, vonis: "bersih", celah_pasal: 0 },
        tersimpan: { nomor_pasal_berbeda: 0, vonis: "tanpa_pasal", panjang_teks: 744 },
        keputusan: { hasil: "dipakai" }, arsip: KUNCI_AI,
      });
      expect(laporan.cuplikan).toContain("PENGELOLAAN SAMPAH");
      expect(laporan.durasi_ms).toBeGreaterThanOrEqual(0);
      expect(laporan.kesesuaian_dengan_teks_lama).toEqual({ gemini_ada_di_lama: 0, lama_ada_di_gemini: 0 });
      expect(panggilan).toHaveLength(1);

      expect(await pasalTersimpan()).toEqual([]);
      expect(await logEkstraksi()).toMatchObject({ vonis: "tanpa_pasal", catatan: "lama" });
      expect(await teksR2(KUNCI_MD)).toBe("Naskah lama yang nyaris kosong.");
      expect(await teksR2(KUNCI_AI)).toContain("### Page 2");
      expect(await pembacaan()).toMatchObject({ hasil: "uji", pasal_baru: 3, vonis_baru: "bersih", token_masuk: 2500 });
      expect(tokenHariIni()).toEqual([3200]);
      expect(l.antrean.kuras()).toEqual([]);
    });

    it("kesesuaian dengan teks bawaan: dua bacaan atas naskah yang sama saling 100% sepakat", async () => {
      await tanamLama({ vonis: "ringan", arsip: NASKAH_AI.replaceAll("=== HALAMAN 1 ===", "### Page 1").replaceAll("=== HALAMAN 2 ===", "### Page 2") });
      pasangGemini([ok(NASKAH_AI)]);
      const laporan = await json<Record<string, any>>(await uji({ uri: URI })); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(laporan.kesesuaian_dengan_teks_lama).toEqual({ gemini_ada_di_lama: 1, lama_ada_di_gemini: 1 });
    });

    it("keputusan dilaporkan sesuai aturan yang sama dengan pembacaan sungguhan (di sini: dipertahankan)", async () => {
      const lama = Array.from({ length: 6 }, (_, i) => ({ nomor: String(i + 1), isi: `Isi lama ${i + 1}.` }));
      await tanamLama({ vonis: "ringan", pasal: lama });
      pasangGemini([ok(NASKAH_AI)]);
      const laporan = await json<Record<string, any>>(await uji({ uri: URI })); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(laporan.keputusan).toEqual({ hasil: "dipertahankan", alasan: "dipertahankan: 3 dari 6 nomor pasal tersimpan tidak ada pada hasil Gemini" });
      expect(laporan.tersimpan).toMatchObject({ nomor_pasal_berbeda: 6, vonis: "ringan" });
      expect(laporan.hilang_dari_tersimpan).toEqual({ hilang: 3, dasar: 6 });
    });

    it("percobaan kering tidak menimpa catatan percobaan sungguhan, tetapi memperbarui catatan 'uji' sebelumnya", async () => {
      await l.db.prepare(`INSERT INTO pembacaan_ai (frbr_uri, hasil, model, pasal_baru) VALUES (?, 'dipakai', 'asli', 7)`).bind(URI).run();
      pasangGemini([ok(NASKAH_AI)]);
      await uji({ uri: URI });
      expect(await pembacaan()).toMatchObject({ hasil: "dipakai", model: "asli", pasal_baru: 7, percobaan: 1 });

      await l.db.prepare(`UPDATE pembacaan_ai SET hasil = 'uji' WHERE frbr_uri = ?`).bind(URI).run();
      pasangGemini([ok(NASKAH_AI, { model: "gemini-uji-baru" })]);
      await uji({ uri: URI });
      expect(await pembacaan()).toMatchObject({ hasil: "uji", model: "gemini-uji-baru", pasal_baru: 3, percobaan: 2 });
    });

    it("galat Gemini: 502 dengan jenisnya; kuota 429 pun 502 (sementara=true)", async () => {
      pasangGemini([galatHttp(429, "quota", { "retry-after": "30" })]);
      const res = await uji({ uri: URI });
      expect(res.status).toBe(502);
      expect(await json(res)).toMatchObject({ error: "gemini_galat", jenis: "kuota", sementara: true, status: 429 });
    });

    it("anggaran harian habis: 429 dengan jenis 'anggaran', tanpa memanggil Gemini", async () => {
      l.env.GEMINI_BATAS_HARIAN = "1000";
      await l.kv.put(`gemini:token:${new Date().toISOString().slice(0, 10)}`, "1000");
      const panggilan = pasangGemini([]);
      const res = await uji({ uri: URI });
      expect(res.status).toBe(429);
      expect(await json(res)).toMatchObject({ jenis: "anggaran" });
      expect(panggilan).toHaveLength(0);
    });
  });

  describe("POST /api/impor/ekstrak-ulang { gemini: true }", () => {
    const antre = (badan: Record<string, unknown> = {}) => panggil(l, "/api/impor/ekstrak-ulang", kirim("POST", { gemini: true, ...badan }, adm));
    const u = (n: number) => `/akn/id/act/pp/2025/${200 + n}`;

    /** Tanam peraturan ber-PDF dengan vonis ekstraksi tertentu. */
    const tanam = async (daftar: Array<[number, string, Partial<{ pdf: boolean; jenis: string }>?]>) => {
      for (const [n, vonis, o] of daftar) {
        const jenis = o?.jenis ?? "PP";
        await sisipkan(l, [{ uri: u(n), jenis, nomor: String(200 + n), tahun: 2025, judul: `Peraturan ${n}` }]);
        if (o?.pdf !== false) await l.db.prepare(`UPDATE laws SET r2_pdf_key = ? WHERE frbr_uri = ?`).bind(`pdf${u(n)}.pdf`, u(n)).run();
        await l.db.prepare(`INSERT INTO ekstraksi_log (frbr_uri, vonis) VALUES (?, ?)`).bind(u(n), vonis).run();
      }
    };

    it("menolak tanpa token admin, dan tanpa secret GEMINI_API menjawab 503", async () => {
      expect((await panggil(l, "/api/impor/ekstrak-ulang", kirim("POST", { gemini: true }))).status).toBe(401);
      delete l.env.GEMINI_API;
      const res = await antre();
      expect(res.status).toBe(503);
      expect(await json(res)).toMatchObject({ error: "gemini_belum_dipasang" });
    });

    it("bawaannya yang tanpa pasal, berat, atau gagal; ber-PDF; urut alamat; pesan membawa pembaca 'gemini'", async () => {
      await tanam([[1, "bersih"], [2, "tanpa_pasal"], [3, "berat"], [4, "ringan"], [5, "gagal"], [6, "tanpa_pasal", { pdf: false }], [7, "tanpa_pasal", { jenis: "PERPRES" }]]);
      const res = await antre();
      expect(res.status).toBe(200);
      expect(await json(res)).toMatchObject({
        diantrekan: 3, gemini_tersisa: 3, terakhir: u(5), uris: [u(2), u(3), u(5)], model: "gemini-uji", vonis: ["tanpa_pasal", "berat", "gagal"],
        anggaran: { terpakai: 0, batas: 5_000_000 },
      });
      expect(l.antrean.kuras()).toEqual([2, 3, 5].map((n) => ({ tipe: "ekstrak_pdf", frbr_uri: u(n), r2_key: `pdf${u(n)}.pdf`, pembaca: "gemini" })));
    });

    it("`batas` dan kursor `setelah`: per putaran paling banyak `batas` (1-20), lalu lanjut sampai habis", async () => {
      await tanam([[1, "tanpa_pasal"], [2, "tanpa_pasal"], [3, "tanpa_pasal"], [4, "tanpa_pasal"], [5, "tanpa_pasal"]]);
      const a = await json<{ diantrekan: number; terakhir: string; gemini_tersisa: number }>(await antre({ batas: 2 }));
      expect(a).toMatchObject({ diantrekan: 2, terakhir: u(2), gemini_tersisa: 5 });
      // Pembacaan diulang oleh pembaca antrean lalu mencatat percobaannya; di sini cukup kursor.
      const b = await json<{ diantrekan: number; terakhir: string }>(await antre({ batas: 2, setelah: a.terakhir }));
      expect(b).toMatchObject({ diantrekan: 2, terakhir: u(4) });
      const c = await json<{ diantrekan: number; terakhir: string }>(await antre({ batas: 2, setelah: b.terakhir }));
      expect(c).toMatchObject({ diantrekan: 1, terakhir: u(5) });
      expect((await json<{ diantrekan: number; terakhir: string | null }>(await antre({ batas: 2, setelah: c.terakhir })))).toMatchObject({ diantrekan: 0, terakhir: null });
      expect((await json<{ diantrekan: number }>(await antre({ batas: 500 }))).diantrekan).toBe(5); // dibatasi 20, di sini hanya ada lima
    });

    it("`batas` dijepit ke 1-20: permintaan 500 hanya mengantrekan 20, 0 dan negatif jatuh ke bawaan 5 atau 1", async () => {
      await tanam(Array.from({ length: 25 }, (_, i) => [i + 1, "tanpa_pasal"] as [number, string]));
      expect((await json<{ diantrekan: number }>(await antre({ batas: 500 }))).diantrekan).toBe(20);
      expect((await json<{ diantrekan: number }>(await antre({ batas: 0 }))).diantrekan).toBe(5);
      expect((await json<{ diantrekan: number }>(await antre({ batas: -3 }))).diantrekan).toBe(1);
      expect((await json<{ diantrekan: number }>(await antre({ batas: 7.9 }))).diantrekan).toBe(7);
      expect((await json<{ diantrekan: number }>(await antre({ batas: "abc" }))).diantrekan).toBe(5);
    });

    it("peraturan yang pernah dicoba dilewati (kecuali ulangi), percobaan kering tak dihitung, vonis dan uri bisa dipilih", async () => {
      await tanam([[1, "tanpa_pasal"], [2, "tanpa_pasal"], [3, "tanpa_pasal"], [4, "ringan"], [5, "bersih"]]);
      await l.db.prepare(`INSERT INTO pembacaan_ai (frbr_uri, hasil) VALUES (?, 'gagal')`).bind(u(1)).run();
      await l.db.prepare(`INSERT INTO pembacaan_ai (frbr_uri, hasil) VALUES (?, 'uji')`).bind(u(2)).run();

      expect((await json<{ uris: string[] }>(await antre())).uris).toEqual([u(2), u(3)]);
      expect((await json<{ uris: string[] }>(await antre({ ulangi: true }))).uris).toEqual([u(1), u(2), u(3)]);
      expect((await json<{ uris: string[] }>(await antre({ vonis: ["ringan"] }))).uris).toEqual([u(4)]);
      expect((await json<{ uris: string[] }>(await antre({ vonis: ["bersih", "ringan"] }))).uris).toEqual([u(4), u(5)]);
      // Dengan uri: peraturan itu saja, apa pun vonis dan riwayatnya.
      expect((await json<{ uris: string[]; diantrekan: number }>(await antre({ uri: u(5) })))).toMatchObject({ diantrekan: 1, uris: [u(5)] });
      expect((await json<{ diantrekan: number }>(await antre({ uri: u(1) }))).diantrekan).toBe(1);
      expect((await json<{ diantrekan: number }>(await antre({ uri: "/akn/id/act/pp/2025/9999" }))).diantrekan).toBe(0);

      const salah = await antre({ vonis: ["tidak_ada"] });
      expect(salah.status).toBe(400);
      expect(await json(salah)).toMatchObject({ error: "vonis_tak_sah" });
    });

    it("pesan membawa `ulangi` bila diminta (ulangi atau uri), selain itu tidak: konsumer melewati yang sudah pernah dicoba", async () => {
      await tanam([[1, "tanpa_pasal"], [2, "tanpa_pasal"]]);
      await antre({ ulangi: true });
      expect((l.antrean.kuras() as Array<Record<string, unknown>>).map((p) => p.ulangi)).toEqual([true, true]);
      await antre({ uri: u(1) });
      expect((l.antrean.kuras() as Array<Record<string, unknown>>).map((p) => p.ulangi)).toEqual([true]);
      await antre();
      expect((l.antrean.kuras() as Array<Record<string, unknown>>).every((p) => !("ulangi" in p))).toBe(true);
    });

    it("anggaran habis: tidak ada yang diantrekan, dengan penjelasan", async () => {
      await tanam([[1, "tanpa_pasal"]]);
      l.env.GEMINI_BATAS_HARIAN = "5000";
      await l.kv.put(`gemini:token:${new Date().toISOString().slice(0, 10)}`, "5000");
      const res = await antre();
      expect(res.status).toBe(200);
      expect(await json(res)).toMatchObject({ diantrekan: 0, anggaran_habis: true, anggaran: { terpakai: 5000, batas: 5000 } });
      expect(l.antrean.kuras()).toEqual([]);
    });

    it("migrasi 0008 belum diterapkan: 503 dengan petunjuk, bukan galat 500", async () => {
      await tanam([[1, "tanpa_pasal"]]);
      await l.db.exec("DROP TABLE pembacaan_ai");
      const res = await antre();
      expect(res.status).toBe(503);
      expect(await json(res)).toMatchObject({ error: "migrasi_belum_diterapkan", message: expect.stringContaining("0008") });
    });

    it("mode lain (usang, biasa) tak terpengaruh dan tak membawa pembaca", async () => {
      await tanam([[1, "tanpa_pasal"]]);
      await panggil(l, "/api/impor/ekstrak-ulang", kirim("POST", {}, adm));
      const pesan = l.antrean.kuras() as Array<Record<string, unknown>>;
      expect(pesan.map((p) => p.frbr_uri).sort()).toEqual([URI, u(1)].sort());
      expect(pesan.every((p) => p.tipe === "ekstrak_pdf" && !("pembaca" in p))).toBe(true);
    });
  });

  describe("catatan 'dibaca AI' pada detail peraturan", () => {
    const detail = async () => (await json<{ pembaca_ai: { model: string } | null }>(await panggil(l, `/api/laws/detail?uri=${encodeURIComponent(URI)}`))).pembaca_ai;
    const tandai = (hasil: string) => l.db.prepare(`INSERT INTO pembacaan_ai (frbr_uri, hasil, model) VALUES (?, ?, 'gemini-uji-001') ON CONFLICT(frbr_uri) DO UPDATE SET hasil = excluded.hasil`).bind(URI, hasil).run();

    it("terisi hanya bila bacaan Gemini dipakai; percobaan kering, ditolak, dipertahankan, gagal, dan digantikan tidak", async () => {
      expect(await detail()).toBeNull();
      for (const hasil of ["uji", "ditolak", "dipertahankan", "gagal", "digantikan"]) {
        await tandai(hasil);
        expect(await detail(), hasil).toBeNull();
      }
      await tandai("dipakai");
      expect(await detail()).toEqual({ model: "gemini-uji-001" });
    });

    it("tanpa tabel pembacaan_ai (migrasi 0008 belum diterapkan) detail tetap tersaji", async () => {
      await l.db.exec("DROP TABLE pembacaan_ai");
      const res = await panggil(l, `/api/laws/detail?uri=${encodeURIComponent(URI)}`);
      expect(res.status).toBe(200);
      expect((await json<{ pembaca_ai: unknown }>(res)).pembaca_ai).toBeNull();
    });

    it("sesudah dibaca Gemini, konversi bawaan tidak menimpa teksnya: dilewati tanpa memanggil Workers AI, penanda dan pasal tetap", async () => {
      await tanamLama({ vonis: "tanpa_pasal" });
      pasangGemini([ok(NASKAH_AI)]);
      await jalan();
      expect(await detail()).toEqual({ model: "gemini-uji-001" });
      const sebelum = await pasalTersimpan();

      // PDF diunggah ulang dan pesan ekstrak biasa datang; hasil konversi yang lebih banyak nomornya pun tak boleh menggantikan.
      l.ai.markdown.set("99.pdf", NASKAH_AI.replace(/=== HALAMAN \d+ ===\n/g, "").replace("Agar setiap orang", "Pasal 4\nPasal tambahan dari konversi bawaan.\nAgar setiap orang"));
      await jalankanAntrean(l, [{ tipe: "ekstrak_pdf", frbr_uri: URI, r2_key: KUNCI_PDF }]);
      expect(await pasalTersimpan()).toEqual(sebelum);
      expect(l.ai.konversi).toEqual([]);
      expect((await pembacaan())?.hasil).toBe("dipakai");
      expect(await detail()).toEqual({ model: "gemini-uji-001" });
      const log = await satu<{ status: string; detail: string }>(l, `SELECT status, detail FROM sync_log WHERE job = 'ekstrak_pdf' ORDER BY id DESC LIMIT 1`);
      expect(log?.detail).toContain("konversi bawaan dilewati, teks sudah hasil bacaan Gemini");
    });

    describe("kesesuaian dengan teks lama dicatat untuk audit", () => {
      it("bacaan yang dipakai: catatan memuat bagian tiga-kata yang sama dengan arsip teks yang digantikan (1/1 bila identik)", async () => {
        await tanamLama({ vonis: "tanpa_pasal" });
        pasangGemini([ok(NASKAH_AI)]);
        await jalan();
        expect((await pembacaan())?.catatan).toBeNull(); // tanpa arsip teks lama: tak ada pembanding

        // Arsip teks kini bacaan Gemini tadi; membaca lagi dengan hasil yang sama sepenuhnya cocok.
        pasangGemini([ok(NASKAH_AI)]);
        await jalan({ ulangi: true });
        expect((await pembacaan())?.catatan).toBe("kesesuaian 1/1");
      });

      it("angkanya searah: bacaan Gemini seluruhnya ada di teks lama (1), tetapi teks lama punya banyak yang tak ada di bacaan Gemini (<1)", async () => {
        await tanamLama({ vonis: "tanpa_pasal" });
        pasangGemini([ok(NASKAH_AI)]);
        await jalan();
        const bacaan = (await teksR2(KUNCI_MD))!;
        await l.r2.put(KUNCI_MD, `${bacaan}\n${Array.from({ length: 120 }, (_, i) => `tambahan${i}`).join(" ")}`);
        pasangGemini([ok(NASKAH_AI)]);
        await jalan({ ulangi: true });
        const catatan = String((await pembacaan())?.catatan);
        expect(catatan).toMatch(/^kesesuaian 1\/0\.\d+$/);
        expect(catatan).not.toBe("kesesuaian 1/1");
      });

      it("hasil yang dipertahankan juga memuatnya, di belakang alasannya; bacaan yang jauh berbeda terlihat dari angkanya", async () => {
        const lama = Array.from({ length: 10 }, (_, i) => ({ nomor: String(i + 1), isi: `Isi lama pasal ${i + 1}.` }));
        const arsipLama = Array.from({ length: 60 }, (_, i) => `kata${i}`).join(" ");
        await tanamLama({ vonis: "bersih", pasal: lama, arsip: arsipLama });
        pasangGemini([ok(NASKAH_AI)]);
        await jalan();
        expect(await pembacaan()).toMatchObject({
          hasil: "dipertahankan", catatan: "dipertahankan: 7 dari 10 nomor pasal tersimpan tidak ada pada hasil Gemini | kesesuaian 0/0",
        });
      });

      it("teks lama yang terlalu pendek untuk dibandingkan (pindaian nyaris kosong): tanpa catatan kesesuaian", async () => {
        await tanamLama({ vonis: "tanpa_pasal", arsip: "Naskah lama yang nyaris kosong." });
        pasangGemini([ok(NASKAH_AI)]);
        await jalan();
        expect(await pembacaan()).toMatchObject({ hasil: "dipakai", catatan: null });
      });
    });

    it("pelindung hanya untuk konversi bawaan: pembacaan Gemini ulang (ulangi) atas bacaan yang dipakai tetap berjalan dan menggantikannya", async () => {
      await tanamLama({ vonis: "tanpa_pasal" });
      const panggilan = pasangGemini([ok(NASKAH_AI)]);
      await jalan();
      expect(await pembacaan()).toMatchObject({ hasil: "dipakai", pasal_baru: 3, percobaan: 1 });

      // Tanpa `ulangi`, yang sudah dibaca dilewati (pesan ganda tak membayar dua kali).
      panggilan.length = 0;
      expect(await jalan()).toEqual({ diakui: 1, diulang: [] });
      expect(panggilan).toHaveLength(0);

      // Dengan `ulangi`, Gemini membaca lagi (di sini hasilnya satu pasal lebih banyak) dan menggantikan bacaan sebelumnya.
      pasangGemini([ok(NASKAH_AI.replace("Agar setiap orang", "Pasal 4\\nPasal tambahan.\\nAgar setiap orang"))]);
      expect(await jalan({ ulangi: true })).toEqual({ diakui: 1, diulang: [] });
      expect(await pembacaan()).toMatchObject({ hasil: "dipakai", percobaan: 2 });
      expect((await pasalTersimpan()).map((p) => p.nomor_pasal)).toEqual(["1", "2", "2", "3", "4"]);
    });

    it("yang dilindungi hanya bacaan yang dipakai: percobaan kering atau gagal sebelumnya tidak menghalangi konversi bawaan", async () => {
      for (const hasil of ["uji", "gagal", "ditolak", "dipertahankan"]) {
        await l.db.prepare(`DELETE FROM pembacaan_ai`).run();
        await l.db.prepare(`DELETE FROM articles`).run();
        await l.db.prepare(`INSERT INTO pembacaan_ai (frbr_uri, hasil) VALUES (?, ?)`).bind(URI, hasil).run();
        l.ai.markdown.set("99.pdf", NASKAH_AI.replace(/=== HALAMAN \d+ ===\n/g, ""));
        await jalankanAntrean(l, [{ tipe: "ekstrak_pdf", frbr_uri: URI, r2_key: KUNCI_PDF }]);
        expect((await pasalTersimpan()).length, hasil).toBeGreaterThan(0);
      }
    });

    it("uraian ulang dari arsip (dari_teks, mis. usang) atas peraturan bacaan Gemini tidak dilewati: arsipnya teks Gemini", async () => {
      await tanamLama({ vonis: "tanpa_pasal" });
      pasangGemini([ok(NASKAH_AI)]);
      await jalan();
      await l.db.prepare(`UPDATE ekstraksi_log SET versi_parser = 0 WHERE frbr_uri = ?`).bind(URI).run();
      await jalankanAntrean(l, [{ tipe: "ekstrak_pdf", frbr_uri: URI, r2_key: KUNCI_PDF, dari_teks: true }]);
      const log = await satu<{ versi_parser: number }>(l, `SELECT versi_parser FROM ekstraksi_log WHERE frbr_uri = ?`, URI);
      expect(log?.versi_parser).toBeGreaterThan(0);
    });

    it("hanya catatan 'dipakai' yang menjadi 'digantikan': percobaan gagal sebelumnya tetap tercatat apa adanya", async () => {
      await tanamLama({ vonis: "tanpa_pasal" });
      await l.db.prepare(`INSERT INTO pembacaan_ai (frbr_uri, hasil, catatan) VALUES (?, 'gagal', 'diblokir')`).bind(URI).run();
      l.ai.markdown.set("99.pdf", NASKAH_AI.replace(/=== HALAMAN \d+ ===\n/g, ""));
      await jalankanAntrean(l, [{ tipe: "ekstrak_pdf", frbr_uri: URI, r2_key: KUNCI_PDF }]);
      expect(await pasalTersimpan()).not.toEqual([]);
      expect(await pembacaan()).toMatchObject({ hasil: "gagal", catatan: "diblokir" });
    });

    it("model tak tercatat: catatan tetap tampil dengan nama 'Gemini'", async () => {
      await l.db.prepare(`INSERT INTO pembacaan_ai (frbr_uri, hasil) VALUES (?, 'dipakai')`).bind(URI).run();
      expect(await detail()).toEqual({ model: "Gemini" });
    });

    it("uraian ulang arsip (dari_teks, mis. usang) atas peraturan bacaan AI tidak mencabut penandanya: teksnya masih bacaan AI", async () => {
      await tanamLama({ vonis: "tanpa_pasal" });
      pasangGemini([ok(NASKAH_AI)]);
      await jalan();
      expect((await pembacaan())?.hasil).toBe("dipakai");

      await l.db.prepare(`UPDATE ekstraksi_log SET versi_parser = 0 WHERE frbr_uri = ?`).bind(URI).run();
      // Pengurai yang diperbaiki menghasilkan sesuatu yang berbeda dari yang tersimpan (di sini: satu pasal lagi dari arsip yang sama).
      await l.r2.put(KUNCI_MD, (await teksR2(KUNCI_MD))!.replace("Pasal 3", "Pasal 4\nPasal tambahan.\nPasal 3"));
      const res = await panggil(l, "/api/impor/ekstrak-ulang", kirim("POST", { usang: true }, adm));
      expect(await json(res)).toMatchObject({ diantrekan: 1 });
      await jalankanAntrean(l, l.antrean.kuras());
      expect((await pasalTersimpan()).map((p) => p.nomor_pasal)).toEqual(["1", "2", "2", "4", "3"]); // hasilnya memang berubah (Pasal 4 disisipkan di arsip sebelum Pasal 3)
      expect((await pembacaan())?.hasil).toBe("dipakai");
      expect(await detail()).toEqual({ model: "gemini-uji-001" });
      expect(l.ai.konversi).toEqual([]);
    });
  });

  describe("GET /api/impor/ringkasan", () => {
    it("tanpa tabel pembacaan_ai (migrasi 0008 belum diterapkan): hitungan percobaan null, bukan galat", async () => {
      await l.db.exec("DROP TABLE pembacaan_ai");
      const res = await panggil(l, "/api/impor/ringkasan", { headers: adm });
      expect(res.status).toBe(200);
      expect((await json<{ gemini: { terpasang: boolean; pembacaan: unknown } }>(res)).gemini).toMatchObject({ terpasang: true, pembacaan: null });
    });

    it("memuat keadaan jalur Gemini: terpasang atau tidak, anggaran hari ini, dan hitungan percobaan", async () => {
      delete l.env.GEMINI_API;
      expect((await json<{ gemini: unknown }>(await panggil(l, "/api/impor/ringkasan", { headers: adm }))).gemini).toMatchObject({ terpasang: false, model: null, anggaran: null, pembacaan: {} });

      l.env.GEMINI_API = KUNCI;
      await l.kv.put(`gemini:token:${new Date().toISOString().slice(0, 10)}`, "4200");
      await l.db.prepare(`INSERT INTO pembacaan_ai (frbr_uri, hasil) VALUES (?, 'dipakai')`).bind(URI).run();
      const g = (await json<{ gemini: Record<string, unknown> }>(await panggil(l, "/api/impor/ringkasan", { headers: adm }))).gemini;
      expect(g).toMatchObject({ terpasang: true, model: "gemini-uji", anggaran: { terpakai: 4200, batas: 5_000_000 }, pembacaan: { dipakai: 1 } });
      // Ringkasan juga menyebut calon yang belum dicoba dan pengaturan Gemini otomatis (lihat gemini-otomatis.test.ts).
      expect(g).toHaveProperty("calon_belum_dicoba");
      expect(g).toHaveProperty("otomatis.mode", "mati");
    });
  });
});
