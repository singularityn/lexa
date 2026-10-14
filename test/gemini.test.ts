/**
 * Klien Gemini (lib/gemini.ts): konfigurasi, pemanggilan dan penanganan galat, pembacaan PDF berputaran, pemeriksaan hasil, dan
 * anggaran token. Tak ada jaringan: `fetch` diganti jawaban palsu, jeda ulang diganti pencatat.
 */
import { describe, expect, it, vi } from "vitest";
import {
  ANGGARAN_HARIAN_BAWAAN, BASE_URL_BAWAAN, GalatGemini, MAKS_BYTE_PDF, MAKS_PUTARAN, MODEL_BAWAAN, PETUNJUK_TRANSKRIPSI, bacaKonfigGemini,
  bacaPdfDenganGemini, catatPemakaian, keBase64, keMarkdownHalaman, nomorPenanda, panggilGemini, pemakaianHariIni, perintahLanjut,
  perkirakanHalamanPdf, periksaTranskripsi, pingGemini, type KonfigGemini,
} from "../src/worker/lib/gemini";

const KUNCI = "AIzaRAHASIA-uji-1234567890";
const K: KonfigGemini = { kunci: KUNCI, model: "gemini-uji", baseUrl: "https://gemini.test/v1beta", anggaranHarian: 1_000_000 };

interface Panggilan {
  url: string;
  metode: string | undefined;
  header: Record<string, string>;
  badan: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** `fetch` palsu: menjawab berurutan; objek Error dilempar, fungsi dipanggil dengan panggilannya. */
function fetchPalsu(jawaban: Array<Response | Error | ((p: Panggilan) => Response)>) {
  const panggilan: Panggilan[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const p: Panggilan = { url: String(url), metode: init?.method, header: Object.fromEntries(new Headers(init?.headers).entries()), badan: JSON.parse(String(init?.body ?? "{}")) };
    panggilan.push(p);
    const j = jawaban.shift();
    if (!j) throw new Error("tak ada jawaban palsu tersisa");
    if (j instanceof Error) throw j;
    return typeof j === "function" ? j(p) : j;
  }) as unknown as typeof fetch;
  return { fn, panggilan };
}

const ok = (teks: string, o: { selesai?: string; masuk?: number; keluar?: number; pikir?: number; model?: string } = {}) =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: teks }] }, finishReason: o.selesai ?? "STOP" }],
      usageMetadata: {
        promptTokenCount: o.masuk ?? 1000, candidatesTokenCount: o.keluar ?? 500, thoughtsTokenCount: o.pikir ?? 0,
        totalTokenCount: (o.masuk ?? 1000) + (o.keluar ?? 500) + (o.pikir ?? 0),
      },
      modelVersion: o.model ?? "gemini-uji-001",
    }),
    { status: 200 },
  );

const galat = (status: number, pesan: string, header: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { code: status, message: pesan, status: "GALAT" } }), { status, headers: header });

/** PDF palsu dengan `n` objek halaman (dan satu simpul "/Pages", yang tak boleh dihitung). */
const pdf = (n: number) => new TextEncoder().encode(`%PDF-1.4\n${"<< /Type /Page /Parent 1 0 R >>\n".repeat(n)}<< /Type /Pages /Count ${n} >>`);

const ISI = "Setiap orang wajib mematuhi ketentuan peraturan perundang-undangan yang berlaku dan menjaga ketertiban umum di wilayahnya.";
const halaman = (n: number, isi = `Pasal ${n}\n${ISI}`) => `=== HALAMAN ${n} ===\n${isi}`;
const tanpaTidur = vi.fn(async (_ms: number) => {});

describe("bacaKonfigGemini", () => {
  it("tanpa kunci atau kunci kosong: null (fitur tak aktif)", () => {
    expect(bacaKonfigGemini({})).toBeNull();
    expect(bacaKonfigGemini({ GEMINI_API: "   " })).toBeNull();
  });

  it("nilai bawaan: model, alamat, dan anggaran harian", () => {
    expect(bacaKonfigGemini({ GEMINI_API: ` ${KUNCI} ` })).toEqual({
      kunci: KUNCI, model: MODEL_BAWAAN, baseUrl: BASE_URL_BAWAAN, anggaranHarian: ANGGARAN_HARIAN_BAWAAN,
    });
  });

  it("model, alamat, dan anggaran dari variabel; 'models/' di depan nama model dibuang; garis miring akhir dibuang", () => {
    expect(bacaKonfigGemini({ GEMINI_API: KUNCI, GEMINI_MODEL: "models/gemini-2.5-flash", GEMINI_BASE_URL: "https://gateway.ai.cloudflare.com/v1/a/b/google-ai-studio/v1beta//", GEMINI_BATAS_HARIAN: "250000" })).toEqual({
      kunci: KUNCI, model: "gemini-2.5-flash", baseUrl: "https://gateway.ai.cloudflare.com/v1/a/b/google-ai-studio/v1beta", anggaranHarian: 250000,
    });
  });

  it("nilai yang tak sah jatuh ke bawaan, bukan ditolak atau disisipkan ke alamat", () => {
    const k = bacaKonfigGemini({ GEMINI_API: KUNCI, GEMINI_MODEL: "../../x?y=1", GEMINI_BASE_URL: "http://tidak-aman.test", GEMINI_BATAS_HARIAN: "-5" });
    expect(k).toMatchObject({ model: MODEL_BAWAAN, baseUrl: BASE_URL_BAWAAN, anggaranHarian: ANGGARAN_HARIAN_BAWAAN });
    expect(bacaKonfigGemini({ GEMINI_API: KUNCI, GEMINI_BATAS_HARIAN: "abc" })?.anggaranHarian).toBe(ANGGARAN_HARIAN_BAWAAN);
    expect(bacaKonfigGemini({ GEMINI_API: KUNCI, GEMINI_BATAS_HARIAN: "0" })?.anggaranHarian).toBe(ANGGARAN_HARIAN_BAWAAN); // nol bukan "tanpa batas"
    expect(bacaKonfigGemini({ GEMINI_API: KUNCI, GEMINI_BASE_URL: "https://x.test/a b" })?.baseUrl).toBe(BASE_URL_BAWAAN);
  });
});

describe("pembantu PDF", () => {
  it("keBase64 sama dengan base64 baku pada ukuran di sekitar batas potongan", () => {
    const acuan = (b: Uint8Array) => btoa(Array.from(b, (x) => String.fromCharCode(x)).join(""));
    for (const n of [0, 1, 2, 3, 29_999, 30_000, 30_001, 60_000, 100_003]) {
      const b = new Uint8Array(n).map((_, i) => (i * 31 + 7) % 256);
      expect(keBase64(b), `n=${n}`).toBe(acuan(b));
    }
  });

  it("perkirakanHalamanPdf menghitung '/Type /Page' dan tidak '/Pages'; null bila tak terbaca", () => {
    expect(perkirakanHalamanPdf(pdf(7))).toBe(7);
    expect(perkirakanHalamanPdf(new TextEncoder().encode("%PDF-1.5\n/Type/Page\n/Type /Page\n/Type  /Pages"))).toBe(2);
    expect(perkirakanHalamanPdf(new TextEncoder().encode("%PDF-1.7 aliran terkompresi saja"))).toBeNull();
  });
});

describe("keMarkdownHalaman dan nomorPenanda", () => {
  it("penanda '=== HALAMAN n ===' menjadi '### Page n' seperti hasil toMarkdown", () => {
    const md = keMarkdownHalaman("=== HALAMAN 1 ===\nIsi satu.\n=== HALAMAN 2 ===\nIsi dua.");
    expect(md).toBe("### Page 1\nIsi satu.\n\n\n\n\n### Page 2\nIsi dua.");
    expect(nomorPenanda(md)).toEqual([1, 2]);
  });

  it("penanda yang dihiasi markdown, berspasi, atau huruf kecil tetap dikenali", () => {
    const md = keMarkdownHalaman("**=== HALAMAN 1 ===**\nA\n  === halaman 2 ===  \nB\n# === HALAMAN 3 ===\nC");
    expect(nomorPenanda(md)).toEqual([1, 2, 3]);
    expect(md).not.toMatch(/===/);
  });

  it("pagar kode yang membungkus seluruh jawaban, BOM, dan CRLF dibuang", () => {
    const md = keMarkdownHalaman("\uFEFF```markdown\r\n=== HALAMAN 1 ===\r\nBaris satu.\r\nBaris dua.\r\n```");
    expect(md).toBe("### Page 1\nBaris satu.\nBaris dua.");
  });

  it("'===' yang bukan penanda dibiarkan; pagar kode di tengah teks dibiarkan", () => {
    const teks = "Tabel:\n=====\nHALAMAN ini penting\n```\nkode\n```\nakhir";
    expect(keMarkdownHalaman(teks)).toBe(teks);
  });
});

describe("panggilGemini", () => {
  it("mengirim ke alamat model dengan kunci di header (bukan di URL) dan menguraikan jawaban, token, dan versi model", async () => {
    const { fn, panggilan } = fetchPalsu([ok("jawaban", { masuk: 1200, keluar: 300, pikir: 80, model: "gemini-uji-007" })]);
    const hasil = await panggilGemini(K, { contents: [{ role: "user", parts: [{ text: "hai" }] }] }, { fetchFn: fn, tidur: tanpaTidur });
    expect(hasil).toEqual({ teks: "jawaban", selesai: "STOP", token: { masuk: 1200, keluar: 300, pikir: 80, total: 1580 }, versiModel: "gemini-uji-007" });
    expect(panggilan).toHaveLength(1);
    expect(panggilan[0].url).toBe("https://gemini.test/v1beta/models/gemini-uji:generateContent");
    expect(panggilan[0].url).not.toContain(KUNCI);
    expect(panggilan[0].header["x-goog-api-key"]).toBe(KUNCI);
    expect(panggilan[0].metode).toBe("POST");
    expect(panggilan[0].header["content-type"]).toBe("application/json");
    expect(panggilan[0].badan.contents[0].parts[0].text).toBe("hai");
  });

  it("bagian 'berpikir' tak ikut menjadi teks; bagian teks digabung berurutan", async () => {
    const jawab = new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: "pikiran", thought: true }, { text: "satu " }, { text: "dua" }] }, finishReason: "STOP" }] }),
    );
    const { fn } = fetchPalsu([jawab]);
    const hasil = await panggilGemini(K, {}, { fetchFn: fn });
    expect(hasil.teks).toBe("satu dua");
    expect(hasil.versiModel).toBe("gemini-uji");
    expect(hasil.token.total).toBe(0);
  });

  it("429: langsung dilaporkan sebagai kuota sementara, dengan jeda dari Retry-After; tanpa mengulang di tempat", async () => {
    const { fn, panggilan } = fetchPalsu([galat(429, "Resource exhausted", { "retry-after": "45" })]);
    const e = await panggilGemini(K, {}, { fetchFn: fn, tidur: tanpaTidur }).catch((x) => x);
    expect(e).toBeInstanceOf(GalatGemini);
    expect(e).toMatchObject({ jenis: "kuota", sementara: true, status: 429, jedaDetik: 45 });
    expect(panggilan).toHaveLength(1);
    const lain = await panggilGemini(K, {}, { fetchFn: fetchPalsu([galat(429, "x")]).fn }).catch((x) => x);
    expect(lain.jedaDetik).toBe(120);
  });

  it("5xx diulang dengan jeda 4 dan 12 detik, lalu berhasil", async () => {
    tanpaTidur.mockClear();
    const { fn, panggilan } = fetchPalsu([galat(503, "tidak tersedia"), galat(500, "galat"), ok("akhirnya")]);
    expect((await panggilGemini(K, {}, { fetchFn: fn, tidur: tanpaTidur })).teks).toBe("akhirnya");
    expect(panggilan).toHaveLength(3);
    expect(tanpaTidur.mock.calls.map((c) => c[0])).toEqual([4000, 12000]);
  });

  it("5xx terus-menerus: tiga percobaan lalu galat 'server' sementara", async () => {
    tanpaTidur.mockClear();
    const { fn, panggilan } = fetchPalsu([galat(503, "a"), galat(503, "b"), galat(503, "c")]);
    const e = await panggilGemini(K, {}, { fetchFn: fn, tidur: tanpaTidur }).catch((x) => x);
    expect(e).toMatchObject({ jenis: "server", sementara: true, status: 503 });
    expect(panggilan).toHaveLength(3);
    expect(tanpaTidur).toHaveBeenCalledTimes(2);
  });

  it("gangguan jaringan diulang; lewat batas waktu tidak diulang di tempat", async () => {
    tanpaTidur.mockClear();
    const a = fetchPalsu([new TypeError("fetch failed"), ok("pulih")]);
    expect((await panggilGemini(K, {}, { fetchFn: a.fn, tidur: tanpaTidur })).teks).toBe("pulih");
    expect(a.panggilan).toHaveLength(2);

    const waktu = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const b = fetchPalsu([waktu, ok("tak terpakai")]);
    const e = await panggilGemini(K, {}, { fetchFn: b.fn, tidur: tanpaTidur }).catch((x) => x);
    expect(e).toMatchObject({ jenis: "jaringan", sementara: true });
    expect(b.panggilan).toHaveLength(1);
  });

  it("pembatalan (AbortError) diperlakukan seperti lewat batas waktu: tidak diulang di tempat", async () => {
    const batal = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    const { fn, panggilan } = fetchPalsu([batal, ok("tak terpakai")]);
    expect(await panggilGemini(K, {}, { fetchFn: fn, tidur: tanpaTidur }).catch((x) => x)).toMatchObject({ jenis: "jaringan", sementara: true, jedaDetik: 60 });
    expect(panggilan).toHaveLength(1);
  });

  it("408 diperlakukan seperti gangguan server (diulang), bukan permintaan yang salah", async () => {
    tanpaTidur.mockClear();
    const { fn, panggilan } = fetchPalsu([galat(408, "a"), galat(408, "b"), galat(408, "c")]);
    expect(await panggilGemini(K, {}, { fetchFn: fn, tidur: tanpaTidur }).catch((x) => x)).toMatchObject({ jenis: "server", status: 408, sementara: true });
    expect(panggilan).toHaveLength(3);
  });

  it("jeda yang disarankan: 60 detik bawaan untuk 5xx, Retry-After bila ada (dibulatkan ke atas, paling lama 15 menit)", async () => {
    const tanpa = await panggilGemini(K, {}, { fetchFn: fetchPalsu([galat(503, "a"), galat(503, "b"), galat(503, "c")]).fn, tidur: tanpaTidur }).catch((x) => x);
    expect(tanpa.jedaDetik).toBe(60);
    const dengan = await panggilGemini(K, {}, { fetchFn: fetchPalsu([galat(503, "a", { "retry-after": "30" }), galat(503, "b", { "retry-after": "30" }), galat(503, "c", { "retry-after": "30" })]).fn, tidur: tanpaTidur }).catch((x) => x);
    expect(dengan.jedaDetik).toBe(30);
    const pecahan = await panggilGemini(K, {}, { fetchFn: fetchPalsu([galat(429, "x", { "retry-after": "45.2" })]).fn }).catch((x) => x);
    expect(pecahan.jedaDetik).toBe(46);
    const besar = await panggilGemini(K, {}, { fetchFn: fetchPalsu([galat(429, "x", { "retry-after": "5000" })]).fn }).catch((x) => x);
    expect(besar.jedaDetik).toBe(900);
    const tidakSah = await panggilGemini(K, {}, { fetchFn: fetchPalsu([galat(429, "x", { "retry-after": "segera" })]).fn }).catch((x) => x);
    expect(tidakSah.jedaDetik).toBe(120);
  });

  it("pesan galat dari Google dirapatkan spasinya dan dipotong 300 karakter", async () => {
    const e = await panggilGemini(K, {}, { fetchFn: fetchPalsu([galat(400, `kalimat   pertama\n\n  kedua ${"x".repeat(600)}`)]).fn }).catch((x) => x);
    expect(e.message).toContain("kalimat pertama kedua xxx");
    const isi = e.message.split("): ")[1];
    expect(isi).toHaveLength(300);
  });

  it("jawaban tanpa finishReason dianggap selesai normal; total token dijumlah bila Google tak mengirimnya (berpikir ikut)", async () => {
    const jawab = new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "x" }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 3 } }));
    const hasil = await panggilGemini(K, {}, { fetchFn: fetchPalsu([jawab]).fn });
    expect(hasil.selesai).toBe("STOP");
    expect(hasil.token).toEqual({ masuk: 10, keluar: 5, pikir: 3, total: 18 });
  });

  it("kunci salah (400 'API key not valid'), 401, dan 403 dilaporkan sebagai galat kunci yang tetap, tanpa mengulang", async () => {
    for (const j of [galat(400, "API key not valid. Please pass a valid API key."), galat(401, "x"), galat(403, "The caller does not have permission")]) {
      const { fn, panggilan } = fetchPalsu([j]);
      const e = await panggilGemini(K, {}, { fetchFn: fn, tidur: tanpaTidur }).catch((x) => x);
      expect(e).toMatchObject({ jenis: "kunci", sementara: false });
      expect(panggilan).toHaveLength(1);
    }
  });

  it("404 = model tak ada; 400 lain = permintaan ditolak; keduanya tetap", async () => {
    expect(await panggilGemini(K, {}, { fetchFn: fetchPalsu([galat(404, "models/gemini-uji is not found")]).fn }).catch((x) => x)).toMatchObject({ jenis: "model", sementara: false });
    expect(await panggilGemini(K, {}, { fetchFn: fetchPalsu([galat(400, "The document has no pages.")]).fn }).catch((x) => x)).toMatchObject({ jenis: "permintaan", sementara: false, status: 400 });
  });

  it("kunci tak pernah muncul di pesan galat, walau Google atau jaringan mengulanginya", async () => {
    const dari = [
      galat(400, `API key not valid: ${KUNCI} salah`),
      galat(403, `denied for key=${KUNCI}`),
      new Error(`fetch failed https://gemini.test/?key=${KUNCI}`),
    ];
    for (const j of dari) {
      const e = (await panggilGemini(K, {}, { fetchFn: fetchPalsu([j, j, j]).fn, tidur: tanpaTidur }).catch((x) => x)) as GalatGemini;
      expect(e).toBeInstanceOf(GalatGemini);
      expect(e.message).not.toContain(KUNCI);
      expect(JSON.stringify(e)).not.toContain(KUNCI);
    }
  });

  it("permintaan yang diblokir sebelum dijawab (tanpa kandidat) dan badan bukan JSON", async () => {
    const blok = () => new Response(JSON.stringify({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } }));
    expect(await panggilGemini(K, {}, { fetchFn: fetchPalsu([blok()]).fn }).catch((x) => x)).toMatchObject({ jenis: "diblokir", sementara: false });
    expect((await panggilGemini(K, {}, { fetchFn: fetchPalsu([blok()]).fn }).catch((x) => x)).message).toContain("PROHIBITED_CONTENT");
    expect(await panggilGemini(K, {}, { fetchFn: fetchPalsu([new Response("<html>")]).fn }).catch((x) => x)).toMatchObject({ jenis: "server", sementara: true });
  });

  it("pingGemini mengembalikan balasan, versi model, dan token", async () => {
    const { fn } = fetchPalsu([ok("siap\n", { masuk: 12, keluar: 2, model: "gemini-uji-009" })]);
    const hasil = await pingGemini(K, { fetchFn: fn });
    expect(hasil).toMatchObject({ balasan: "siap", selesai: "STOP", versiModel: "gemini-uji-009", token: { total: 14 } });
    expect(hasil.durasiMs).toBeGreaterThanOrEqual(0);
  });
});

describe("bacaPdfDenganGemini", () => {
  it("satu putaran: PDF dikirim sebaris dengan petunjuk transkripsi, penanda diubah, token dan halaman terhitung", async () => {
    const { fn, panggilan } = fetchPalsu([ok(`${halaman(1)}\n${halaman(2)}\n${halaman(3)}`, { masuk: 3000, keluar: 900, model: "gemini-uji-002" })]);
    const sumber = pdf(3);
    const pakai = vi.fn();
    const hasil = await bacaPdfDenganGemini(K, sumber, { fetchFn: fn, tidur: tanpaTidur, pakai });
    expect(hasil).toMatchObject({ halaman: 3, halamanPdf: 3, putaran: 1, versiModel: "gemini-uji-002", token: { masuk: 3000, keluar: 900, total: 3900 } });
    expect(nomorPenanda(hasil.markdown)).toEqual([1, 2, 3]);
    expect(hasil.markdown).not.toContain("===");
    expect(pakai).toHaveBeenCalledTimes(1);

    const b = panggilan[0].badan;
    expect(b.systemInstruction.parts[0].text).toBe(PETUNJUK_TRANSKRIPSI);
    expect(b.contents[0].parts[0].inlineData).toEqual({ mimeType: "application/pdf", data: keBase64(sumber) });
    expect(b.contents[0].parts[1].text).toMatch(/seluruh dokumen/);
    // Naskah hukum: kategori keamanan dilonggarkan, dan tak ada parameter yang bergantung pada versi model.
    expect(b.safetySettings.every((s: { threshold: string }) => s.threshold === "BLOCK_NONE")).toBe(true);
    expect(b.generationConfig).toBeUndefined();
  });

  it("keluaran terpotong (MAX_TOKENS): halaman terakhir dibuang dan dilanjutkan dari halaman itu; tak ada halaman ganda", async () => {
    const putaran1 = `${halaman(1)}\n${halaman(2)}\n${halaman(3, "Pasal 3\nBagian halaman tiga yang terpotong di tengah kali")}`;
    const putaran2 = `${halaman(3)}\n${halaman(4)}`;
    const { fn, panggilan } = fetchPalsu([ok(putaran1, { selesai: "MAX_TOKENS", masuk: 4000, keluar: 2000 }), ok(putaran2, { masuk: 4000, keluar: 1000 })]);
    const hasil = await bacaPdfDenganGemini(K, pdf(4), { fetchFn: fn, tidur: tanpaTidur });
    expect(hasil).toMatchObject({ putaran: 2, halaman: 4, token: { masuk: 8000, keluar: 3000, total: 11000 } });
    expect(nomorPenanda(hasil.markdown)).toEqual([1, 2, 3, 4]);
    expect(hasil.markdown).not.toContain("terpotong di tengah");
    expect(hasil.markdown).toContain(`Pasal 3\n${ISI}`);
    expect(panggilan[1].badan.contents[0].parts[1].text).toBe(perintahLanjut(3));
    // Berkas yang sama dikirim lagi pada putaran lanjutan.
    expect(panggilan[1].badan.contents[0].parts[0].inlineData.data).toBe(panggilan[0].badan.contents[0].parts[0].inlineData.data);
  });

  it("keluaran terpotong tanpa kemajuan (satu halaman memenuhi seluruh jawaban) dilaporkan, bukan diulang tanpa akhir", async () => {
    const { fn, panggilan } = fetchPalsu([ok(halaman(1, "x".repeat(200)), { selesai: "MAX_TOKENS" })]);
    const e = await bacaPdfDenganGemini(K, pdf(1), { fetchFn: fn }).catch((x) => x);
    expect(e).toMatchObject({ jenis: "keluaran", sementara: false });
    expect(panggilan).toHaveLength(1);
  });

  it("sampai enam putaran diterima: lima terpotong lalu satu selesai; urutan halaman tetap utuh", async () => {
    expect(MAKS_PUTARAN).toBe(6);
    const terpotong = Array.from({ length: 5 }, (_, i) => ok(`${halaman(i * 2 + 1)}\n${halaman(i * 2 + 2)}\n${halaman(i * 2 + 3)}`, { selesai: "MAX_TOKENS" }));
    const hasil = await bacaPdfDenganGemini(K, pdf(12), { fetchFn: fetchPalsu([...terpotong, ok(`${halaman(11)}\n${halaman(12)}`)]).fn });
    expect(hasil.putaran).toBe(6);
    expect(nomorPenanda(hasil.markdown)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it("enam putaran terpotong semuanya: dilaporkan sebagai terlalu panjang, tanpa putaran ketujuh", async () => {
    const jawaban = Array.from({ length: 6 }, (_, i) => ok(`${halaman(i * 2 + 1)}\n${halaman(i * 2 + 2)}\n${halaman(i * 2 + 3)}`, { selesai: "MAX_TOKENS" }));
    const e = await bacaPdfDenganGemini(K, pdf(40), { fetchFn: fetchPalsu(jawaban).fn }).catch((x) => x);
    expect(e).toMatchObject({ jenis: "keluaran" });
    expect(e.message).toMatch(/terlalu panjang/);
  });

  it("berhenti karena RECITATION, SAFETY, atau alasan lain: galat 'diblokir' yang tetap, teks sebagian tak dipakai", async () => {
    for (const selesai of ["RECITATION", "SAFETY", "OTHER"]) {
      const e = await bacaPdfDenganGemini(K, pdf(2), { fetchFn: fetchPalsu([ok(halaman(1), { selesai })]).fn }).catch((x) => x);
      expect(e, selesai).toMatchObject({ jenis: "diblokir", sementara: false });
      expect(e.message).toContain(selesai);
    }
  });

  it("petunjuk memuat kontrak dengan pemeriksa dan pengurai: penanda halaman, [tidak terbaca], dan larangan menebak", () => {
    expect(PETUNJUK_TRANSKRIPSI).toContain("=== HALAMAN n ===");
    expect(PETUNJUK_TRANSKRIPSI).toContain("[tidak terbaca]");
    expect(PETUNJUK_TRANSKRIPSI).toMatch(/Jangan menebak/);
    expect(PETUNJUK_TRANSKRIPSI).toMatch(/kata demi kata/);
    expect(perintahLanjut(7)).toContain("=== HALAMAN 7 ===");
    // Bentuk penanda yang diminta itulah yang dikenali pengubahnya.
    expect(nomorPenanda(keMarkdownHalaman("=== HALAMAN 7 ==="))).toEqual([7]);
  });

  it("PDF sebesar tepat batas sebaris masih dikirim", async () => {
    const { fn, panggilan } = fetchPalsu([ok(halaman(1))]);
    const hasil = await bacaPdfDenganGemini(K, new Uint8Array(MAKS_BYTE_PDF), { fetchFn: fn });
    expect(hasil.putaran).toBe(1);
    expect(panggilan).toHaveLength(1);
  });

  it("PDF lebih besar dari batas sebaris ditolak sebelum menyentuh jaringan", async () => {
    const { fn, panggilan } = fetchPalsu([]);
    const e = await bacaPdfDenganGemini(K, new Uint8Array(MAKS_BYTE_PDF + 1), { fetchFn: fn }).catch((x) => x);
    expect(e).toMatchObject({ jenis: "terlalu_besar", sementara: false });
    expect(panggilan).toHaveLength(0);
  });

  it("melampaui sisa anggaran di tengah pembacaan: berhenti dengan galat 'anggaran'; token tetap dilaporkan lewat `pakai`", async () => {
    const { fn, panggilan } = fetchPalsu([ok(`${halaman(1)}\n${halaman(2)}`, { selesai: "MAX_TOKENS", masuk: 5000, keluar: 3000 }), ok(halaman(2))]);
    const pakai = vi.fn();
    const e = await bacaPdfDenganGemini(K, pdf(5), { fetchFn: fn, maksToken: 6000, pakai }).catch((x) => x);
    expect(e).toMatchObject({ jenis: "anggaran" });
    expect(panggilan).toHaveLength(1);
    expect(pakai).toHaveBeenCalledWith(expect.objectContaining({ total: 8000 }));
  });

  it("token tepat sebesar sisa anggaran masih diterima (batasnya 'melampaui', bukan 'mencapai')", async () => {
    const { fn } = fetchPalsu([ok(halaman(1), { masuk: 5000, keluar: 3000 })]);
    await expect(bacaPdfDenganGemini(K, pdf(1), { fetchFn: fn, maksToken: 8000 })).resolves.toMatchObject({ token: { total: 8000 } });
    const { fn: fn2 } = fetchPalsu([ok(halaman(1), { masuk: 5000, keluar: 3001 })]);
    await expect(bacaPdfDenganGemini(K, pdf(1), { fetchFn: fn2, maksToken: 8000 })).rejects.toMatchObject({ jenis: "anggaran" });
  });

  it("halaman terakhir yang dilaporkan adalah nomor penanda tertinggi, bukan jumlah penanda", async () => {
    const hasil = await bacaPdfDenganGemini(K, pdf(3), { fetchFn: fetchPalsu([ok(`${halaman(1)}\n${halaman(3)}`)]).fn });
    expect(hasil.halaman).toBe(3);
    const kosong = await bacaPdfDenganGemini(K, pdf(1), { fetchFn: fetchPalsu([ok(ISI.repeat(2))]).fn });
    expect(kosong.halaman).toBe(0);
  });

  it("galat sementara dari Google merambat apa adanya (konsumer antrean akan mengulang pesannya)", async () => {
    const e = await bacaPdfDenganGemini(K, pdf(1), { fetchFn: fetchPalsu([galat(429, "kuota")]).fn }).catch((x) => x);
    expect(e).toMatchObject({ jenis: "kuota", sementara: true });
  });
});

describe("periksaTranskripsi", () => {
  const baik = keMarkdownHalaman([halaman(1), halaman(2), halaman(3)].join("\n"));

  it("hasil yang utuh lolos", () => {
    expect(periksaTranskripsi(baik, 3)).toEqual([]);
    expect(periksaTranskripsi(baik, null)).toEqual([]);
  });

  it("tanpa penanda halaman, atau penanda tak berurutan dari 1", () => {
    expect(periksaTranskripsi(ISI.repeat(3), null)).toEqual(["tanpa penanda halaman"]);
    expect(periksaTranskripsi(keMarkdownHalaman([halaman(1), halaman(3)].join("\n")), null)[0]).toMatch(/tak berurutan dari 1 \(1, 3\)/);
    expect(periksaTranskripsi(keMarkdownHalaman([halaman(2), halaman(3)].join("\n")), null)[0]).toMatch(/tak berurutan/);
    expect(periksaTranskripsi(keMarkdownHalaman([halaman(1), halaman(1)].join("\n")), null)[0]).toMatch(/tak berurutan/);
  });

  it("halaman yang tak terbaca dibanding PDF: ditolak bila selisih dua atau lebih dan kurang dari 90%", () => {
    expect(periksaTranskripsi(baik, 5)[0]).toMatch(/hanya 3 dari 5 halaman/);
    expect(periksaTranskripsi(baik, 4)).toEqual([]); // selisih satu: perkiraan jumlah halaman bukan angka pasti
    const dua = keMarkdownHalaman([halaman(1), halaman(2)].join("\n"));
    expect(periksaTranskripsi(dua, 20)[0]).toMatch(/hanya 2 dari 20/);
    const banyak = keMarkdownHalaman(Array.from({ length: 19 }, (_, i) => halaman(i + 1)).join("\n"));
    expect(periksaTranskripsi(banyak, 21)).toEqual([]); // 19/21 >= 90%
  });

  it("teks terlalu sedikit untuk naskah peraturan", () => {
    expect(periksaTranskripsi(keMarkdownHalaman("=== HALAMAN 1 ===\nPasal 1\nAda."), 1)[0]).toMatch(/terlalu sedikit/);
  });

  it("batas teks terlalu sedikit: 149 karakter ditolak, 150 diterima", () => {
    expect(periksaTranskripsi(keMarkdownHalaman(`=== HALAMAN 1 ===\n${"x".repeat(149)}`), 1)).toEqual(["teks terlalu sedikit (149 karakter)"]);
    expect(periksaTranskripsi(keMarkdownHalaman(`=== HALAMAN 1 ===\n${"x".repeat(100)}`), 1)[0]).toMatch(/terlalu sedikit \(100 karakter\)/);
    expect(periksaTranskripsi(keMarkdownHalaman(`=== HALAMAN 1 ===\n${"x".repeat(150)}`), 1)).toEqual([]);
  });

  it("[tidak terbaca]: perlu sedikitnya lima kemunculan DAN lebih dari 1,5% kata; kurang dari itu wajar", () => {
    const katakata = (n: number) => Array.from({ length: n }, (_, i) => `kata${i}`).join(" ");
    const tak = (n: number) => Array.from({ length: n }, () => "[tidak terbaca]").join(" ");
    // empat kemunculan, tetapi 2% kata: belum cukup bukti
    expect(periksaTranskripsi(keMarkdownHalaman(`=== HALAMAN 1 ===\n${tak(4)} ${katakata(190)}`), 1)).toEqual([]);
    // lima kemunculan dan 2,5% kata: ditolak
    expect(periksaTranskripsi(keMarkdownHalaman(`=== HALAMAN 1 ===\n${tak(5)} ${katakata(190)}`), 1)[0]).toMatch(/terlalu banyak bagian tak terbaca \(5 dalam 200 kata\)/);
    // lima kemunculan di tengah naskah panjang (0,1%): wajar bagi pindaian
    expect(periksaTranskripsi(keMarkdownHalaman(`=== HALAMAN 1 ===\n${tak(5)} ${katakata(5000)}`), 1)).toEqual([]);
    // huruf besar-kecil tak berpengaruh
    expect(periksaTranskripsi(keMarkdownHalaman(`=== HALAMAN 1 ===\n${tak(5).toUpperCase()} ${katakata(190)}`), 1)[0]).toMatch(/terlalu banyak bagian tak terbaca/);
  });

  it("baris panjang yang berpasangan (A A B B C C D D) bukan pengulangan berturut-turut", () => {
    const b = (n: number) => `Baris nomor ${n} yang cukup panjang untuk diperiksa pengulangannya.`;
    const berpasangan = [1, 1, 2, 2, 3, 3, 4, 4].map(b).join("\n");
    expect(periksaTranskripsi(keMarkdownHalaman(`=== HALAMAN 1 ===\n${berpasangan}`), 1)).toEqual([]);
  });

  it("terlalu banyak [tidak terbaca]: tebakan bukan bacaan", () => {
    const rusak = keMarkdownHalaman(`=== HALAMAN 1 ===\n${Array.from({ length: 12 }, () => "kata [tidak terbaca] kata kata").join("\n")}`);
    expect(periksaTranskripsi(rusak, 1)[0]).toMatch(/terlalu banyak bagian tak terbaca \(12 dalam/);
    // Sedikit saja masih wajar pada pindaian buruk.
    const wajar = keMarkdownHalaman(`=== HALAMAN 1 ===\n${ISI.repeat(30)} [tidak terbaca] [tidak terbaca]`);
    expect(periksaTranskripsi(wajar, 1)).toEqual([]);
  });

  it("baris panjang yang sama diulang berturut-turut: model terjebak", () => {
    const baris = "Setiap orang wajib mematuhi ketentuan yang berlaku.";
    const terjebak = keMarkdownHalaman(`=== HALAMAN 1 ===\nPasal 1\n${ISI}\n${Array.from({ length: 5 }, () => baris).join("\n")}`);
    expect(periksaTranskripsi(terjebak, 1)[0]).toMatch(/diulang 4 kali berturut-turut/);
    // Pengulangan di tempat berjauhan, atau baris pendek berulang ("Cukup jelas."), wajar.
    const wajar = keMarkdownHalaman(`=== HALAMAN 1 ===\n${ISI}\n${baris}\nPasal 2\n${baris}\nPasal 3\n${baris}\n${"Cukup jelas.\n".repeat(6)}`);
    expect(periksaTranskripsi(wajar, 1)).toEqual([]);
  });
});

describe("anggaran token harian", () => {
  const kvPalsu = () => {
    const isi = new Map<string, { nilai: string; ttl?: number }>();
    return {
      isi,
      kv: {
        get: async (k: string) => isi.get(k)?.nilai ?? null,
        put: async (k: string, nilai: string, o?: { expirationTtl?: number }) => void isi.set(k, { nilai, ttl: o?.expirationTtl }),
      } as unknown as KVNamespace,
    };
  };

  it("menjumlahkan pemakaian per hari UTC, berganti hari berganti hitungan, kedaluwarsa tiga hari", async () => {
    const { kv, isi } = kvPalsu();
    const senin = new Date("2026-10-12T23:30:00Z");
    expect(await pemakaianHariIni(kv, senin)).toBe(0);
    expect(await catatPemakaian(kv, 1500, senin)).toBe(1500);
    expect(await catatPemakaian(kv, 2500.4, senin)).toBe(4000);
    expect(await pemakaianHariIni(kv, senin)).toBe(4000);
    expect(await pemakaianHariIni(kv, new Date("2026-10-13T00:00:01Z"))).toBe(0);
    expect(isi.get("gemini:token:2026-10-12")).toEqual({ nilai: "4000", ttl: 3 * 86_400 });
  });

  it("nilai tersimpan yang negatif atau bukan angka dibaca sebagai nol, bukan mengurangi pemakaian", async () => {
    const { kv, isi } = kvPalsu();
    const hari = new Date("2026-10-12T10:00:00Z");
    isi.set("gemini:token:2026-10-12", { nilai: "-500" });
    expect(await pemakaianHariIni(kv, hari)).toBe(0);
    isi.set("gemini:token:2026-10-12", { nilai: "rusak" });
    expect(await pemakaianHariIni(kv, hari)).toBe(0);
    expect(await catatPemakaian(kv, 100, hari)).toBe(100);
  });

  it("jumlah nol, negatif, atau bukan angka tak mengubah apa pun; KV yang galat dibaca sebagai nol", async () => {
    const { kv, isi } = kvPalsu();
    expect(await catatPemakaian(kv, 0)).toBe(0);
    expect(await catatPemakaian(kv, -5)).toBe(0);
    expect(await catatPemakaian(kv, Number.NaN)).toBe(0);
    expect(isi.size).toBe(0);
    const rusak = { get: async () => { throw new Error("KV mati"); }, put: async () => { throw new Error("KV mati"); } } as unknown as KVNamespace;
    expect(await pemakaianHariIni(rusak)).toBe(0);
    await expect(catatPemakaian(rusak, 10)).resolves.toBe(10);
  });
});
