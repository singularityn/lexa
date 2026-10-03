import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, GalatApi } from "../../public/js/api.js";
import { sesi } from "../../public/js/state.js";

// Klien API peramban dijalankan di Node dengan `fetch` dan `location` tiruan.
// Fokusnya: jawaban yang tak bisa dipercaya tidak boleh berubah menjadi "data" kosong.

function balasDengan(badan: string | null, init: ResponseInit = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(badan, { status: 200, headers: { "content-type": "application/json" }, ...init })),
  );
}

beforeEach(() => {
  vi.stubGlobal("location", { origin: "http://lexa.test" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("klien API: jawaban 2xx yang tak terbaca", () => {
  it("badan kosong pada 200 adalah galat, bukan null", async () => {
    balasDengan("");
    await expect(api.statusAuth()).rejects.toMatchObject({ name: "GalatApi", kode: "respons_tidak_valid", status: 200 });
  });

  it("badan HTML pada 200 (perantara/gerbang) adalah galat, bukan null", async () => {
    balasDengan("<html>Bad gateway</html>", { headers: { "content-type": "text/html" } });
    await expect(api.statusAuth()).rejects.toBeInstanceOf(GalatApi);
  });

  it("badan terpotong di tengah JSON adalah galat", async () => {
    balasDengan('{"masuk": tr');
    await expect(api.statusAuth()).rejects.toMatchObject({ kode: "respons_tidak_valid" });
  });

  it("JSON yang sah tetap dikembalikan apa adanya, termasuk null yang sah", async () => {
    balasDengan(JSON.stringify({ masuk: false, login_tersedia: true, pengguna: null }));
    await expect(api.statusAuth()).resolves.toEqual({ masuk: false, login_tersedia: true, pengguna: null });
    balasDengan("null");
    await expect(api.statusAuth()).resolves.toBeNull();
  });

  it("204 tanpa badan bukan galat", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    await expect(api.statusAuth()).resolves.toBeNull();
  });

  it("galat server tetap memakai pesan dari badan JSON-nya, dan halaman galat HTML memakai pesan umum", async () => {
    balasDengan(JSON.stringify({ error: "batas_laju", message: "Terlalu sering." }), { status: 429 });
    await expect(api.statusAuth()).rejects.toMatchObject({ status: 429, kode: "batas_laju", message: "Terlalu sering." });
    balasDengan("<html>502</html>", { status: 502, headers: { "content-type": "text/html" } });
    await expect(api.statusAuth()).rejects.toMatchObject({ status: 502, kode: "galat_server" });
  });

  it("pembatalan oleh pemanggil saat badan dibaca diteruskan sebagai pembatalan, bukan dilaporkan sebagai jawaban rusak", async () => {
    const batal = new DOMException("dibatalkan", "AbortError");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw batal; }, text: async () => "" }) as unknown as Response),
    );
    await expect(api.statusAuth()).rejects.toBe(batal);
  });
});

describe("sesi.muat", () => {
  const tamu = { masuk: false, login_tersedia: false, pengguna: null };

  it("bentuk jawaban yang salah dianggap tanpa sesi; sesi.data tidak pernah null", async () => {
    for (const rusak of [null, undefined, "", "bukan objek", 42, {}, { masuk: "ya" }]) {
      vi.spyOn(api, "statusAuth").mockResolvedValueOnce(rusak as never);
      await sesi.muat();
      expect(sesi.data, `jawaban ${JSON.stringify(rusak)}`).toEqual(tamu);
    }
  });

  it("galat jaringan atau jawaban tak terbaca juga menjadi tamu", async () => {
    vi.spyOn(api, "statusAuth").mockRejectedValueOnce(new GalatApi(0, "jaringan", "putus"));
    await sesi.muat();
    expect(sesi.data).toEqual(tamu);

    balasDengan("");
    await sesi.muat();
    expect(sesi.data).toEqual(tamu);
  });

  it("jawaban yang sah diterima", async () => {
    const masuk = { masuk: true, login_tersedia: true, pengguna: { id: "1", email: "a@b.c", nama: "A", foto_url: null } };
    vi.spyOn(api, "statusAuth").mockResolvedValueOnce(masuk);
    await sesi.muat();
    expect(sesi.data).toEqual(masuk);
  });
});
