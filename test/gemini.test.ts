/**
 * Klien Gemini (lib/gemini.ts): konfigurasi, pemanggilan dan penanganan galat, pembacaan PDF berputaran, pemeriksaan hasil, dan
 * anggaran token. Tak ada jaringan: `fetch` diganti jawaban palsu, jeda ulang diganti pencatat.
 */
import { describe, expect, it, vi } from "vitest";
import {
  ANGGARAN_HARIAN_BAWAAN, BASE_URL_BAWAAN, GalatGemini, HALAMAN_PER_PANGGILAN_BAWAAN, MAKS_BYTE_PDF, MAKS_HALAMAN_BAWAAN, MAKS_PUTARAN, MODEL_BAWAAN, PARALEL_BAWAAN,
  PETUNJUK_TRANSKRIPSI, bacaKonfigGemini,
  bacaPdfDenganGemini, catatPemakaian, keBase64, keMarkdownHalaman, nomorPenanda, nomoriBagian, panggilGemini, pemakaianHariIni, pengaturanGenerasi,
  perintahBagian, perintahLanjut, perkirakanHalamanPdf, periksaTranskripsi, pingGemini, type KonfigGemini,
} from "../src/worker/lib/gemini";

const KUNCI = "AIzaRAHASIA-uji-1234567890";
const K: KonfigGemini = {
  kunci: KUNCI, model: "gemini-uji", baseUrl: "https://gemini.test/v1beta", anggaranHarian: 1_000_000, berpikir: null, halamanPerPanggilan: 5, paralel: 3,
  halamanMaks: 120,
};

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
      berpikir: null, halamanPerPanggilan: HALAMAN_PER_PANGGILAN_BAWAAN, paralel: PARALEL_BAWAAN, halamanMaks: MAKS_HALAMAN_BAWAAN,
    });
  });

  it("model, alamat, dan anggaran dari variabel; 'models/' di depan nama model dibuang; garis miring akhir dibuang", () => {
    expect(bacaKonfigGemini({ GEMINI_API: KUNCI, GEMINI_MODEL: "models/gemini-2.5-flash", GEMINI_BASE_URL: "https://gateway.ai.cloudflare.com/v1/a/b/google-ai-studio/v1beta//", GEMINI_BATAS_HARIAN: "250000" })).toEqual({
      kunci: KUNCI, model: "gemini-2.5-flash", baseUrl: "https://gateway.ai.cloudflare.com/v1/a/b/google-ai-studio/v1beta", anggaranHarian: 250000,
      berpikir: null, halamanPerPanggilan: HALAMAN_PER_PANGGILAN_BAWAAN, paralel: PARALEL_BAWAAN, halamanMaks: MAKS_HALAMAN_BAWAAN,
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

describe("bacaKonfigGemini: berpikir, halaman per panggilan, dan paralel", () => {
  const baca = (env: Record<string, string>) => bacaKonfigGemini({ GEMINI_API: KUNCI, ...env })!;

  it("GEMINI_BERPIKIR: angka menjadi anggaran berpikir, kata menjadi tingkat, selain itu (atau kosong) bawaan model", () => {
    expect(baca({}).berpikir).toBeNull();
    expect(baca({ GEMINI_BERPIKIR: "" }).berpikir).toBeNull();
    expect(baca({ GEMINI_BERPIKIR: "0" }).berpikir).toEqual({ anggaran: 0 });
    expect(baca({ GEMINI_BERPIKIR: " 1024 " }).berpikir).toEqual({ anggaran: 1024 });
    expect(baca({ GEMINI_BERPIKIR: "LOW" }).berpikir).toEqual({ tingkat: "LOW" });
    expect(baca({ GEMINI_BERPIKIR: "minimal" }).berpikir).toEqual({ tingkat: "minimal" });
    expect(baca({ GEMINI_BERPIKIR: "THINKING_LEVEL_LOW" }).berpikir).toEqual({ tingkat: "THINKING_LEVEL_LOW" });
    // Yang tak berbentuk angka atau kata tak boleh sampai ke badan permintaan.
    for (const rusak of ["-1", "1.5", "low; drop", "a", "x".repeat(40), '{"a":1}', "1234567"]) expect(baca({ GEMINI_BERPIKIR: rusak }).berpikir, rusak).toBeNull();
  });

  it("GEMINI_HALAMAN dan GEMINI_PARALEL: dibatasi (1-20 dan 1-8), nilai rusak jatuh ke bawaan", () => {
    expect(baca({ GEMINI_HALAMAN: "8", GEMINI_PARALEL: "2" })).toMatchObject({ halamanPerPanggilan: 8, paralel: 2 });
    expect(baca({ GEMINI_HALAMAN: "999", GEMINI_PARALEL: "99" })).toMatchObject({ halamanPerPanggilan: 20, paralel: 8 });
    expect(baca({ GEMINI_HALAMAN: "0", GEMINI_PARALEL: "-3" })).toMatchObject({ halamanPerPanggilan: 1, paralel: 1 });
    expect(baca({ GEMINI_HALAMAN: "banyak", GEMINI_PARALEL: "" })).toMatchObject({ halamanPerPanggilan: HALAMAN_PER_PANGGILAN_BAWAAN, paralel: PARALEL_BAWAAN });
  });

  it("GEMINI_HALAMAN_MAKS: bawaan 120, dibatasi 1-5000, nilai rusak atau kosong jatuh ke bawaan", () => {
    expect(MAKS_HALAMAN_BAWAAN).toBe(120);
    expect(baca({}).halamanMaks).toBe(120);
    expect(baca({ GEMINI_HALAMAN_MAKS: " 300 " }).halamanMaks).toBe(300);
    expect(baca({ GEMINI_HALAMAN_MAKS: "1" }).halamanMaks).toBe(1);
    expect(baca({ GEMINI_HALAMAN_MAKS: "5000" }).halamanMaks).toBe(5000);
    expect(baca({ GEMINI_HALAMAN_MAKS: "5001" }).halamanMaks).toBe(5000);
    expect(baca({ GEMINI_HALAMAN_MAKS: "999999" }).halamanMaks).toBe(5000);
    expect(baca({ GEMINI_HALAMAN_MAKS: "0" }).halamanMaks).toBe(1);
    expect(baca({ GEMINI_HALAMAN_MAKS: "-7" }).halamanMaks).toBe(1);
    for (const rusak of ["", "banyak", "  "]) expect(baca({ GEMINI_HALAMAN_MAKS: rusak }).halamanMaks, rusak).toBe(120);
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
    const e = await bacaPdfDenganGemini(K, pdf(25), { fetchFn: fetchPalsu(jawaban).fn }).catch((x) => x);
    expect(e).toMatchObject({ jenis: "keluaran" });
    expect(e.message).toMatch(/terlalu panjang/);
  });

  it("PDF yang tak bisa dipecah dan lebih dari 30 halaman ditolak tanpa memanggil Gemini; 30 halaman masih dibaca sekaligus", async () => {
    const { fn, panggilan } = fetchPalsu([ok(Array.from({ length: 30 }, (_, i) => halaman(i + 1)).join("\n"))]);
    const e = await bacaPdfDenganGemini(K, pdf(31), { fetchFn: fn }).catch((x) => x);
    expect(e).toMatchObject({ jenis: "terlalu_panjang", sementara: false });
    expect(e.message).toContain("31 halaman");
    expect(panggilan).toHaveLength(0);
    const hasil = await bacaPdfDenganGemini(K, pdf(30), { fetchFn: fn });
    expect(hasil.halaman).toBe(30);
    expect(panggilan).toHaveLength(1);
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

// ---------------------------------------------------------------------------
// Pembacaan per potongan halaman
// ---------------------------------------------------------------------------

describe("nomoriBagian", () => {
  const md = (...n: number[]) => n.map((x) => `### Page ${x}\nIsi ${x}.`).join("\n\n");

  it("penanda relatif menjadi nomor halaman asli menurut urutan kemunculan, bukan menurut angka yang dicetak", () => {
    expect(nomoriBagian(md(1, 2, 3), 11, 3)).toBe("### Page 11\nIsi 1.\n\n### Page 12\nIsi 2.\n\n### Page 13\nIsi 3.");
    // Model memakai nomor asli alih-alih relatif: tetap diurutkan dari `mulai`.
    expect(nomoriBagian(md(11, 12, 13), 11, 3)).toBe("### Page 11\nIsi 11.\n\n### Page 12\nIsi 12.\n\n### Page 13\nIsi 13.");
    // Nomor yang kacau pun dinomori ulang menurut urutan.
    expect(nomoriBagian(md(2, 2, 7), 4, 3)).toBe("### Page 4\nIsi 2.\n\n### Page 5\nIsi 2.\n\n### Page 6\nIsi 7.");
  });

  it("banyak penanda yang tak sama dengan jumlah halaman: null (terlewat atau tertambah)", () => {
    expect(nomoriBagian(md(1, 2), 1, 3)).toBeNull();
    expect(nomoriBagian(md(1, 2, 3, 4), 1, 3)).toBeNull();
    expect(nomoriBagian("tanpa penanda sama sekali", 1, 2)).toBeNull();
  });

  it("satu halaman: penanda selalu dipasang sendiri; penanda yang dicetak model dibuang", () => {
    expect(nomoriBagian("Isi saja.", 9, 1)).toBe("### Page 9\nIsi saja.");
    expect(nomoriBagian(md(1), 9, 1)).toBe("### Page 9\nIsi 1.");
    // Dua penanda pada potongan satu halaman (tak lazim): keduanya dibuang, isinya tetap utuh di bawah satu penanda.
    expect(nomoriBagian(md(1, 2), 9, 1)).toBe("### Page 9\nIsi 1.\n\n\nIsi 2.");
  });
});

describe("pengaturanGenerasi dan pengaturan berpikir di permintaan", () => {
  it("tanpa pengaturan: tak ada generationConfig (tak ada parameter khusus versi yang terkirim tanpa diminta)", () => {
    expect(pengaturanGenerasi({ berpikir: null })).toEqual({});
  });

  it("angka menjadi thinkingBudget, kata menjadi thinkingLevel apa adanya", () => {
    expect(pengaturanGenerasi({ berpikir: { anggaran: 0 } })).toEqual({ generationConfig: { thinkingConfig: { thinkingBudget: 0 } } });
    expect(pengaturanGenerasi({ berpikir: { tingkat: "LOW" } })).toEqual({ generationConfig: { thinkingConfig: { thinkingLevel: "LOW" } } });
  });

  it("uji sambungan (geminiCek) mengirim pengaturan yang sama dengan pembacaan, supaya penolakan model terlihat sejak awal", async () => {
    const { fn, panggilan } = fetchPalsu([ok("siap"), ok("siap")]);
    await pingGemini({ ...K, berpikir: { tingkat: "LOW" } }, { fetchFn: fn });
    expect(panggilan[0].badan.generationConfig).toEqual({ thinkingConfig: { thinkingLevel: "LOW" } });
    await pingGemini(K, { fetchFn: fn });
    expect(panggilan[1].badan).not.toHaveProperty("generationConfig");
  });

  it("pembacaan utuh dan per potongan sama-sama membawa pengaturan; penolakan model (400) menjadi galat 'permintaan' yang tetap", async () => {
    const utuh = fetchPalsu([ok(halaman(1)), galat(400, "Thinking level MINIMAL is not supported for this model")]);
    await bacaPdfDenganGemini({ ...K, berpikir: { anggaran: 128 } }, pdf(1), { fetchFn: utuh.fn });
    expect(utuh.panggilan[0].badan.generationConfig).toEqual({ thinkingConfig: { thinkingBudget: 128 } });
    const e = await pingGemini({ ...K, berpikir: { tingkat: "MINIMAL" } }, { fetchFn: utuh.fn }).catch((x) => x);
    expect(e).toMatchObject({ jenis: "permintaan", sementara: false, status: 400 });
    expect(e.message).toContain("MINIMAL");
  });
});

describe("bacaPdfDenganGemini: per potongan halaman", () => {
  interface Rekam {
    m: number;
    a: number;
    total: number;
    /** Isi PDF yang dikirim (di uji: "RENTANG m-a"). */
    pdf: string;
    badan: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  /** Teks jawaban untuk halaman m..a: penanda relatif (atau asli bila `mutlak`), tiap halaman memuat "Pasal n" dengan n nomor halaman asli. */
  const teksPotongan = (m: number, a: number, o: { mutlak?: boolean } = {}) =>
    Array.from({ length: a - m + 1 }, (_, i) => `=== HALAMAN ${o.mutlak ? m + i : i + 1} ===\nPasal ${m + i}\n${ISI}`).join("\n");

  /** `fetch` palsu yang membaca rentang dari perintah, mencatat tiap panggilan, dan melacak banyaknya yang berjalan bersamaan. */
  function fetchPotongan(jawab: (r: Rekam, ke: number) => Response | Error | Promise<Response | Error>, o: { tunda?: number } = {}) {
    const rekam: Rekam[] = [];
    let berjalan = 0;
    let maks = 0;
    const fn = (async (_url: string | URL | Request, init?: RequestInit) => {
      const badan = JSON.parse(String(init?.body));
      const mm = /halaman (\d+) sampai (\d+) dari naskah sepanjang (\d+)/.exec(badan.contents[0].parts[1].text);
      const r: Rekam = { m: Number(mm?.[1] ?? 1), a: Number(mm?.[2] ?? 0), total: Number(mm?.[3] ?? 0), pdf: atob(badan.contents[0].parts[0].inlineData.data), badan };
      const ke = rekam.push(r) - 1;
      berjalan++;
      maks = Math.max(maks, berjalan);
      try {
        if (o.tunda) await new Promise((selesai) => setTimeout(selesai, o.tunda));
        const j = await jawab(r, ke);
        if (j instanceof Error) throw j;
        return j;
      } finally {
        berjalan--;
      }
    }) as unknown as typeof fetch;
    return { fn, rekam, maksBerjalan: () => maks };
  }

  const pemecahPalsu = (n: number) => ({ halaman: n, ambil: vi.fn(async (m: number, a: number) => new TextEncoder().encode(`RENTANG ${m}-${a}`)) });
  const habisWaktu = () => Object.assign(new Error("tak menjawab"), { name: "TimeoutError" });
  const PDF_UTUH = (n: number) => new TextEncoder().encode(`RENTANG 1-${n}`);
  const rentangDari = (rekam: Rekam[]) => rekam.map((r) => `${r.m}-${r.a}`);

  it("PDF 23 halaman dibaca per lima halaman, paling banyak tiga sekaligus; hasil bergabung berurutan dengan penanda 1..23", async () => {
    const pemecah = pemecahPalsu(23);
    const { fn, rekam, maksBerjalan } = fetchPotongan((r) => ok(teksPotongan(r.m, r.a), { masuk: 3000, keluar: 1500, pikir: 500 }), { tunda: 15 });
    const pakai = vi.fn();

    const hasil = await bacaPdfDenganGemini(K, PDF_UTUH(23), { fetchFn: fn, tidur: tanpaTidur, bukaPdf: async () => pemecah, pakai });

    expect(rentangDari(rekam).sort()).toEqual(["1-5", "11-15", "16-20", "21-23", "6-10"]);
    expect(maksBerjalan()).toBe(3);
    // PDF yang dikirim ke Gemini adalah potongan yang tepat, dan perintahnya menyebut rentang serta panjang naskah.
    for (const r of rekam) expect(r.pdf).toBe(`RENTANG ${r.m}-${r.a}`);
    expect(rekam.find((r) => r.m === 6)?.badan.contents[0].parts[1].text).toBe(perintahBagian(6, 10, 23));
    expect(pemecah.ambil).toHaveBeenCalledTimes(5);

    expect(nomorPenanda(hasil.markdown)).toEqual(Array.from({ length: 23 }, (_, i) => i + 1));
    // Isi tiap halaman berada di bawah penandanya sendiri, menurut urutan naskah.
    for (let n = 1; n <= 23; n++) expect(hasil.markdown).toMatch(new RegExp(`### Page ${n}\\nPasal ${n}\\n`));
    expect(periksaTranskripsi(hasil.markdown, hasil.halamanPdf)).toEqual([]);
    expect(hasil).toMatchObject({ halaman: 23, halamanPdf: 23, putaran: 5, token: { masuk: 15000, keluar: 7500, pikir: 2500, total: 25000 }, versiModel: "gemini-uji-001" });
    expect(pakai).toHaveBeenCalledTimes(5);
  });

  it("halamanPerPanggilan dan paralel dari opsi: 10 per panggilan, satu per satu", async () => {
    const { fn, rekam, maksBerjalan } = fetchPotongan((r) => ok(teksPotongan(r.m, r.a)), { tunda: 5 });
    await bacaPdfDenganGemini(K, PDF_UTUH(23), { fetchFn: fn, bukaPdf: async () => pemecahPalsu(23), halamanPerPanggilan: 10, paralel: 1 });
    expect(rentangDari(rekam)).toEqual(["1-10", "11-20", "21-23"]);
    expect(maksBerjalan()).toBe(1);
  });

  it("nomor halaman yang dicetak model (asli, bukan relatif) diabaikan: yang dihitung urutannya", async () => {
    const { fn } = fetchPotongan((r) => ok(teksPotongan(r.m, r.a, { mutlak: true })));
    const hasil = await bacaPdfDenganGemini(K, PDF_UTUH(12), { fetchFn: fn, bukaPdf: async () => pemecahPalsu(12) });
    expect(nomorPenanda(hasil.markdown)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it("PDF yang tak lebih panjang dari satu potongan dibaca sekali, tanpa dipecah, dengan perintah awal", async () => {
    const pemecah = pemecahPalsu(4);
    const { fn, rekam } = fetchPotongan((r) => ok(Array.from({ length: 4 }, (_, i) => halaman(i + 1)).join("\n")));
    const hasil = await bacaPdfDenganGemini(K, PDF_UTUH(4), { fetchFn: fn, bukaPdf: async () => pemecah });
    expect(rekam).toHaveLength(1);
    expect(rekam[0].pdf).toBe("RENTANG 1-4"); // PDF asli utuh
    expect(rekam[0].badan.contents[0].parts[1].text).toBe("Transkripsikan seluruh dokumen PDF ini sesuai aturan.");
    expect(pemecah.ambil).not.toHaveBeenCalled();
    expect(hasil).toMatchObject({ halaman: 4, halamanPdf: 4, putaran: 1 });
  });

  it("PDF sepanjang tepat satu potongan (5 halaman, bukan lebih) dibaca sekali dengan perintah awal, tanpa dipecah", async () => {
    const pemecah = pemecahPalsu(5);
    const { fn, rekam } = fetchPotongan((r) => ok(Array.from({ length: 5 }, (_, i) => halaman(i + 1)).join("\n")));
    await bacaPdfDenganGemini(K, PDF_UTUH(5), { fetchFn: fn, bukaPdf: async () => pemecah });
    expect(rekam).toHaveLength(1);
    expect(rekam[0].badan.contents[0].parts[1].text).toBe("Transkripsikan seluruh dokumen PDF ini sesuai aturan.");
    expect(pemecah.ambil).not.toHaveBeenCalled();
    // Satu halaman lebih panjang dari potongan: dipecah.
    const enam = fetchPotongan((r) => ok(teksPotongan(r.m, r.a)));
    await bacaPdfDenganGemini(K, PDF_UTUH(6), { fetchFn: enam.fn, bukaPdf: async () => pemecahPalsu(6) });
    expect(rentangDari(enam.rekam)).toEqual(["1-5", "6-6"]);
  });

  it("pembuka PDF yang gagal atau melempar: jatuh ke pembacaan utuh (PDF pendek) atau ditolak (PDF panjang), bukan galat tak terduga", async () => {
    const { fn, rekam } = fetchPotongan(() => ok(`${halaman(1)}\n${halaman(2)}`));
    for (const buka of [async () => null, async () => Promise.reject(new Error("pdf-lib meledak"))]) {
      const hasil = await bacaPdfDenganGemini(K, pdf(2), { fetchFn: fn, bukaPdf: buka });
      expect(hasil.halaman).toBe(2);
    }
    expect(rekam).toHaveLength(2);
    const e = await bacaPdfDenganGemini(K, pdf(40), { fetchFn: fn, bukaPdf: async () => null }).catch((x) => x);
    expect(e).toMatchObject({ jenis: "terlalu_panjang" });
    expect(rekam).toHaveLength(2);
  });

  describe("batas halaman total (halamanMaks)", () => {
    const Kecil: KonfigGemini = { ...K, halamanMaks: 10 };

    it("PDF yang bisa dipecah dan lebih panjang dari batas ditolak 'terlalu_panjang' sebelum satu pun panggilan atau potongan dibuat", async () => {
      const pemecah = pemecahPalsu(11);
      const { fn, rekam } = fetchPotongan((r) => ok(teksPotongan(r.m, r.a)));
      const pakai = vi.fn();
      const e = await bacaPdfDenganGemini(Kecil, PDF_UTUH(11), { fetchFn: fn, bukaPdf: async () => pemecah, pakai }).catch((x) => x);
      expect(e).toBeInstanceOf(GalatGemini);
      expect(e).toMatchObject({ jenis: "terlalu_panjang", sementara: false });
      expect(e.message).toContain("11 halaman");
      expect(e.message).toContain("batas 10 halaman");
      expect(e.message).toContain("GEMINI_HALAMAN_MAKS");
      expect(rekam).toHaveLength(0);
      expect(pemecah.ambil).not.toHaveBeenCalled();
      expect(pakai).not.toHaveBeenCalled();
    });

    it("tepat sebanyak batas masih dibaca (10 halaman, batas 10); 11 halaman ditolak", async () => {
      const { fn, rekam } = fetchPotongan((r) => ok(teksPotongan(r.m, r.a)));
      const hasil = await bacaPdfDenganGemini(Kecil, PDF_UTUH(10), { fetchFn: fn, bukaPdf: async () => pemecahPalsu(10) });
      expect(hasil).toMatchObject({ halaman: 10, halamanPdf: 10 });
      expect(rentangDari(rekam).sort()).toEqual(["1-5", "6-10"]);
    });

    it("PDF yang tak lebih panjang dari satu potongan tetap tunduk pada batas (batas 1, PDF 2 halaman, potongan 5)", async () => {
      const { fn, rekam } = fetchPotongan(() => ok(halaman(1)));
      const e = await bacaPdfDenganGemini({ ...K, halamanMaks: 1 }, PDF_UTUH(2), { fetchFn: fn, bukaPdf: async () => pemecahPalsu(2) }).catch((x) => x);
      expect(e).toMatchObject({ jenis: "terlalu_panjang" });
      expect(rekam).toHaveLength(0);
      // Satu halaman tepat di batas: dibaca.
      const hasil = await bacaPdfDenganGemini({ ...K, halamanMaks: 1 }, PDF_UTUH(1), { fetchFn: fn, bukaPdf: async () => pemecahPalsu(1) });
      expect(hasil).toMatchObject({ halaman: 1, halamanPdf: 1 });
      expect(rekam).toHaveLength(1);
    });

    it("PDF yang tak bisa dipecah: batasnya yang lebih kecil antara batas total dan 30 halaman (batas 10 menolak 11; bawaan 120 masih 30)", async () => {
      const { fn, panggilan } = fetchPalsu([ok(Array.from({ length: 10 }, (_, i) => halaman(i + 1)).join("\n"))]);
      const e = await bacaPdfDenganGemini(Kecil, pdf(11), { fetchFn: fn, bukaPdf: async () => null }).catch((x) => x);
      expect(e).toMatchObject({ jenis: "terlalu_panjang", sementara: false });
      expect(e.message).toContain("11 halaman");
      expect(e.message).toContain("batasnya 10 halaman");
      expect(panggilan).toHaveLength(0);
      const hasil = await bacaPdfDenganGemini(Kecil, pdf(10), { fetchFn: fn, bukaPdf: async () => null });
      expect(hasil.halaman).toBe(10);
      expect(panggilan).toHaveLength(1);

      // Batas total yang lebih longgar tak melonggarkan batas 30 halaman untuk PDF yang tak bisa dipecah.
      const longgar = await bacaPdfDenganGemini({ ...K, halamanMaks: 500 }, pdf(31), { fetchFn: fn, bukaPdf: async () => null }).catch((x) => x);
      expect(longgar).toMatchObject({ jenis: "terlalu_panjang" });
      expect(longgar.message).toContain("batasnya 30 halaman");
      expect(panggilan).toHaveLength(1);
    });

    it("batas dinaikkan: PDF 200 halaman dibaca per potongan (50 panggilan) alih-alih ditolak", async () => {
      const { fn, rekam } = fetchPotongan((r) => ok(teksPotongan(r.m, r.a)));
      const hasil = await bacaPdfDenganGemini({ ...K, halamanMaks: 200, halamanPerPanggilan: 4 }, PDF_UTUH(200), { fetchFn: fn, bukaPdf: async () => pemecahPalsu(200) });
      expect(rekam).toHaveLength(50);
      expect(hasil.halaman).toBe(200);
      const e = await bacaPdfDenganGemini(K, PDF_UTUH(200), { fetchFn: fn, bukaPdf: async () => pemecahPalsu(200) }).catch((x) => x);
      expect(e).toMatchObject({ jenis: "terlalu_panjang" }); // batas bawaan 120
      expect(rekam).toHaveLength(50);
    });
  });

  describe("potongan yang bermasalah dipecah dua, sampai satu halaman", () => {
    it("lewat batas waktu: dipecah 3 + 2, hasilnya tetap berurutan; potongan lain tak terganggu", async () => {
      let gagalSekali = false;
      const { fn, rekam } = fetchPotongan((r) => {
        if (r.m === 6 && r.a === 10 && !gagalSekali) {
          gagalSekali = true;
          return habisWaktu();
        }
        return ok(teksPotongan(r.m, r.a));
      });
      const hasil = await bacaPdfDenganGemini(K, PDF_UTUH(10), { fetchFn: fn, tidur: tanpaTidur, bukaPdf: async () => pemecahPalsu(10), paralel: 1 });
      expect(rentangDari(rekam)).toEqual(["1-5", "6-10", "6-8", "9-10"]);
      expect(nomorPenanda(hasil.markdown)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
      expect(hasil.putaran).toBe(3); // yang habis waktu tak berhasil, jadi tak dihitung
    });

    it("terpotong batas panjang jawaban (MAX_TOKENS): dipecah; satu halaman yang terpotong: galat 'keluaran' yang tetap", async () => {
      const { fn, rekam } = fetchPotongan((r) => (r.a - r.m >= 1 ? ok(teksPotongan(r.m, r.a), { selesai: "MAX_TOKENS" }) : ok(teksPotongan(r.m, r.a))));
      const hasil = await bacaPdfDenganGemini(K, PDF_UTUH(6), { fetchFn: fn, bukaPdf: async () => pemecahPalsu(6), halamanPerPanggilan: 2, paralel: 1 });
      // Tiap potongan dua halaman terpotong, lalu dibagi dua satu halaman.
      expect(rentangDari(rekam)).toEqual(["1-2", "1-1", "2-2", "3-4", "3-3", "4-4", "5-6", "5-5", "6-6"]);
      expect(nomorPenanda(hasil.markdown)).toEqual([1, 2, 3, 4, 5, 6]);

      const padat = fetchPotongan(() => ok("setengah", { selesai: "MAX_TOKENS" }));
      const e = await bacaPdfDenganGemini(K, PDF_UTUH(3), { fetchFn: padat.fn, bukaPdf: async () => pemecahPalsu(3), halamanPerPanggilan: 1 }).catch((x) => x);
      expect(e).toMatchObject({ jenis: "keluaran", sementara: false });
      expect(e.message).toContain("terlalu padat");
    });

    it("banyak penanda tak cocok (halaman terlewat): dipecah dan dibaca ulang; satu halaman selalu diberi penanda sendiri", async () => {
      let sekali = true;
      const { fn, rekam } = fetchPotongan((r) => {
        if (r.m === 1 && r.a === 5 && sekali) {
          sekali = false;
          return ok(teksPotongan(1, 4)); // hanya empat penanda untuk lima halaman
        }
        // Potongan satu halaman tanpa penanda sama sekali.
        return r.m === r.a ? ok(`Pasal ${r.m}\n${ISI}`) : ok(teksPotongan(r.m, r.a));
      });
      const hasil = await bacaPdfDenganGemini(K, PDF_UTUH(5 + 0), { fetchFn: fn, bukaPdf: async () => pemecahPalsu(7), halamanPerPanggilan: 5, paralel: 1 }).catch((x) => x);
      expect(rentangDari(rekam)).toEqual(["1-5", "1-3", "4-5", "6-7"]);
      expect(nomorPenanda(hasil.markdown)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it("dipecah sampai satu halaman yang tetap bermasalah: galat diteruskan, bukan lingkaran tak berujung", async () => {
      const { fn, rekam } = fetchPotongan(() => habisWaktu());
      const e = await bacaPdfDenganGemini(K, PDF_UTUH(6), { fetchFn: fn, tidur: tanpaTidur, bukaPdf: async () => pemecahPalsu(6), halamanPerPanggilan: 3, paralel: 1 }).catch((x) => x);
      expect(e).toMatchObject({ jenis: "jaringan", sementara: true, habisWaktu: true });
      // 3 -> 2 + 1 -> 1 + 1: potongan pertama gagal sampai satu halaman, dan berhenti di sana.
      expect(rentangDari(rekam)).toEqual(["1-3", "1-2", "1-1"]);
    });
  });

  describe("galat", () => {
    it("galat tetap (diblokir) didahulukan atas galat sementara (kuota) dari potongan lain", async () => {
      const { fn } = fetchPotongan((r) => (r.m === 1 ? galat(429, "quota", { "retry-after": "40" }) : ok("x", { selesai: "SAFETY" })), { tunda: 10 });
      const e = await bacaPdfDenganGemini(K, PDF_UTUH(4), { fetchFn: fn, bukaPdf: async () => pemecahPalsu(4), halamanPerPanggilan: 2, paralel: 2 }).catch((x) => x);
      expect(e).toMatchObject({ jenis: "diblokir", sementara: false });
      expect(e.message).toContain("SAFETY");
    });

    it("kuota (429) pada satu potongan: galat sementara dengan jeda Retry-After; potongan lain yang sudah jalan tak dibuang", async () => {
      const simpan = vi.fn(async () => {});
      const { fn } = fetchPotongan((r) => (r.m === 1 ? galat(429, "quota", { "retry-after": "40" }) : ok(teksPotongan(r.m, r.a))), { tunda: 10 });
      const e = await bacaPdfDenganGemini(K, PDF_UTUH(4), { fetchFn: fn, bukaPdf: async () => pemecahPalsu(4), halamanPerPanggilan: 2, paralel: 2, simpanBagian: simpan }).catch((x) => x);
      expect(e).toMatchObject({ jenis: "kuota", sementara: true, jedaDetik: 40 });
      expect(simpan).toHaveBeenCalledWith(3, 4, expect.stringContaining("### Page 3"));
    });

    it("setelah galat pertama, potongan baru tak lagi dimulai", async () => {
      const { fn, rekam } = fetchPotongan((r) => (r.m === 1 ? galat(429, "quota") : ok(teksPotongan(r.m, r.a))), { tunda: 5 });
      await bacaPdfDenganGemini(K, PDF_UTUH(20), { fetchFn: fn, bukaPdf: async () => pemecahPalsu(20), halamanPerPanggilan: 2, paralel: 2 }).catch(() => {});
      // Sepuluh potongan, tetapi hanya yang sudah berjalan saat galat muncul yang diselesaikan.
      expect(rekam.length).toBeLessThan(10);
    });

    it("anggaran token: potongan pertama melampaui sisa, jadi berhenti tanpa memulai yang berikutnya (token tetap dicatat)", async () => {
      const pakai = vi.fn();
      const { fn, rekam } = fetchPotongan((r) => ok(teksPotongan(r.m, r.a), { masuk: 800, keluar: 300 }));
      const e = await bacaPdfDenganGemini(K, PDF_UTUH(15), { fetchFn: fn, bukaPdf: async () => pemecahPalsu(15), paralel: 1, maksToken: 1000, pakai }).catch((x) => x);
      expect(e).toMatchObject({ jenis: "anggaran", sementara: false });
      expect(rekam).toHaveLength(1);
      expect(pakai).toHaveBeenCalledTimes(1);
    });

    it("pembacaan yang SELESAI tak dibuang walau tokennya melampaui sisa anggaran: yang dijaga adalah panggilan baru", async () => {
      // Dua potongan berjalan bersamaan sebelum ada yang selesai, jadi keduanya lolos pemeriksaan sebelum panggilan; total 2.200 > 1.000.
      const pakai = vi.fn();
      const { fn, rekam } = fetchPotongan((r) => ok(teksPotongan(r.m, r.a), { masuk: 800, keluar: 300 }), { tunda: 10 });
      const hasil = await bacaPdfDenganGemini(K, PDF_UTUH(8), { fetchFn: fn, bukaPdf: async () => pemecahPalsu(8), halamanPerPanggilan: 4, paralel: 2, maksToken: 1000, pakai });
      expect(rekam).toHaveLength(2);
      expect(nomorPenanda(hasil.markdown)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(hasil.token.total).toBe(2200);
      expect(pakai).toHaveBeenCalledTimes(2); // tokennya tetap tercatat untuk anggaran harian
    });

    it("anggaran yang sudah habis sebelum potongan pertama: tak ada panggilan", async () => {
      const { fn, rekam } = fetchPotongan((r) => ok(teksPotongan(r.m, r.a)));
      const e = await bacaPdfDenganGemini(K, PDF_UTUH(15), { fetchFn: fn, bukaPdf: async () => pemecahPalsu(15), maksToken: 0 }).catch((x) => x);
      expect(e).toMatchObject({ jenis: "anggaran" });
      expect(rekam).toHaveLength(0);
    });
  });

  describe("melanjutkan yang terputus: tenggat dan potongan tersimpan", () => {
    it("tenggat yang sudah lewat: galat sementara 'tertunda' sebelum memanggil apa pun", async () => {
      const { fn, rekam } = fetchPotongan((r) => ok(teksPotongan(r.m, r.a)));
      const e = await bacaPdfDenganGemini(K, PDF_UTUH(15), { fetchFn: fn, bukaPdf: async () => pemecahPalsu(15), tenggat: Date.now() - 1 }).catch((x) => x);
      expect(e).toMatchObject({ jenis: "tertunda", sementara: true, jedaDetik: 30 });
      expect(rekam).toHaveLength(0);
    });

    it("tenggat lewat di tengah jalan: potongan yang selesai tersimpan, dan percobaan berikutnya memuatnya tanpa membayar ulang", async () => {
      const tersimpan = new Map<string, string>();
      const opsi = {
        bukaPdf: async () => pemecahPalsu(15),
        paralel: 1,
        simpanBagian: async (m: number, a: number, md: string) => void tersimpan.set(`${m}-${a}`, md),
        muatBagian: async (m: number, a: number) => tersimpan.get(`${m}-${a}`) ?? null,
      };
      // Setiap panggilan memakan 30 ms, tenggatnya 20 ms: hanya potongan pertama yang sempat dimulai.
      const pertama = fetchPotongan((r) => ok(teksPotongan(r.m, r.a), { masuk: 100, keluar: 100 }), { tunda: 30 });
      const e = await bacaPdfDenganGemini(K, PDF_UTUH(15), { ...opsi, fetchFn: pertama.fn, tenggat: Date.now() + 20 }).catch((x) => x);
      expect(e).toMatchObject({ jenis: "tertunda", sementara: true });
      expect(e.message).toContain("1 dari 3");
      expect(rentangDari(pertama.rekam)).toEqual(["1-5"]);
      expect([...tersimpan.keys()]).toEqual(["1-5"]);

      // Percobaan berikutnya: potongan 1-5 dimuat, hanya yang tersisa dibaca; hasil akhirnya utuh.
      const kedua = fetchPotongan((r) => ok(teksPotongan(r.m, r.a), { masuk: 100, keluar: 100 }));
      const hasil = await bacaPdfDenganGemini(K, PDF_UTUH(15), { ...opsi, fetchFn: kedua.fn });
      expect(rentangDari(kedua.rekam)).toEqual(["6-10", "11-15"]);
      expect(nomorPenanda(hasil.markdown)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
      expect(hasil.token.total).toBe(400); // hanya dua potongan yang baru dibayar
    });

    it("potongan yang dipecah menyimpan bagian-bagiannya dan juga gabungannya, supaya percobaan berikutnya tak mengulang yang gagal", async () => {
      const tersimpan = new Map<string, string>();
      let sekali = true;
      const { fn } = fetchPotongan((r) => {
        if (r.m === 1 && r.a === 4 && sekali) {
          sekali = false;
          return habisWaktu();
        }
        return ok(teksPotongan(r.m, r.a));
      });
      await bacaPdfDenganGemini(K, PDF_UTUH(4 + 3), {
        fetchFn: fn, tidur: tanpaTidur, bukaPdf: async () => pemecahPalsu(7), halamanPerPanggilan: 4, paralel: 1,
        simpanBagian: async (m, a, md) => void tersimpan.set(`${m}-${a}`, md),
      });
      expect([...tersimpan.keys()].sort()).toEqual(["1-2", "1-4", "3-4", "5-7"]);
      expect(nomorPenanda(tersimpan.get("1-4")!)).toEqual([1, 2, 3, 4]);
    });

    it("galat dari penyimpanan atau pemuatan potongan tak menggagalkan pembacaan", async () => {
      const { fn } = fetchPotongan((r) => ok(teksPotongan(r.m, r.a)));
      const hasil = await bacaPdfDenganGemini(K, PDF_UTUH(10), {
        fetchFn: fn, bukaPdf: async () => pemecahPalsu(10),
        simpanBagian: async () => Promise.reject(new Error("R2 penuh")),
        muatBagian: async () => Promise.reject(new Error("R2 mati")),
      });
      expect(nomorPenanda(hasil.markdown)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    });
  });
});
