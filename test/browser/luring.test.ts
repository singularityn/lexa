import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../public/js/api.js";
import { CACHE_SIMPAN, GalatLuring, luring, luringDidukung, MAKS_SIMPANAN } from "../../public/js/luring.js";
import { pantau, penyimpanan } from "../../public/js/state.js";

// Penyimpanan luring dijalankan di Node dengan Cache API, `fetch`, dan `location` tiruan.
// Yang dijaga: kunci cache PERSIS sama dengan alamat yang diminta halaman (kalau tidak, service worker
// tidak pernah menemukan simpanannya), peraturan hanya "tersimpan" bila isinya ada, dan jaringan yang
// buruk tidak meninggalkan simpanan setengah jadi.

class CacheTiruan {
  isi = new Map<string, Response>();
  async put(r: string, res: Response) {
    this.isi.set(r, res);
  }
  async match(r: string | { url: string }) {
    return this.isi.get(typeof r === "string" ? r : r.url)?.clone();
  }
  async keys() {
    return [...this.isi.keys()].map((url) => ({ url }));
  }
  async delete(r: string) {
    return this.isi.delete(r);
  }
}

const URI = "/akn/id/act/uu/2003/13";
let cache: CacheTiruan;
let jaringan: (url: string) => Response | Promise<Response>;
let diminta: string[];

beforeEach(() => {
  penyimpanan.hapus("lexa:luring:v1");
  cache = new CacheTiruan();
  diminta = [];
  jaringan = () => new Response('{"v":1}', { headers: { "content-type": "application/json" } });
  vi.stubGlobal("location", { origin: "http://lexa.test" });
  vi.stubGlobal("caches", { open: vi.fn(async (nama: string) => (nama === CACHE_SIMPAN ? cache : new CacheTiruan())) });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    diminta.push(url);
    return jaringan(url);
  }));
  vi.stubGlobal("navigator", { storage: { persist: vi.fn(async () => true) } });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("simpanan luring", () => {
  it("menyimpan isi, status dokumen, dan peta relasi dengan alamat yang sama dengan yang diminta halaman", async () => {
    const ukuran = await luring.simpan(URI);
    expect(ukuran).toBe(3 * '{"v":1}'.length);
    expect([...cache.isi.keys()].sort()).toEqual([api.alamat.detail(URI), api.alamat.graf(URI, 1), api.alamat.statusDokumen(URI)].sort());
    expect(api.alamat.detail(URI)).toBe("http://lexa.test/api/laws/detail?uri=%2Fakn%2Fid%2Fact%2Fuu%2F2003%2F13");
    expect(api.alamat.graf(URI, 1)).toBe("http://lexa.test/api/relasi/graf?uri=%2Fakn%2Fid%2Fact%2Fuu%2F2003%2F13&kedalaman=1");
    expect(await luring.tersimpan(URI)).toBe(true);
    expect(await luring.tersimpan("/akn/id/act/uu/2020/11")).toBe(false);
  });

  it("meminta peramban tidak membuang simpanan (storage.persist) dan memberi tahu pemantau", async () => {
    const peristiwa: unknown[] = [];
    const berhenti = pantau("luring", (d) => peristiwa.push(d));
    await luring.simpan(URI);
    await luring.hapus(URI);
    berhenti();
    expect(navigator.storage.persist).toHaveBeenCalledTimes(1);
    expect(peristiwa).toEqual([{ uri: URI, tersimpan: true }, { uri: URI, tersimpan: false }]);
  });

  it("daftar: terbaru dulu, dengan ukuran gabungan ketiga salinan; hanya yang isinya tersimpan", async () => {
    await luring.simpan("/akn/id/act/uu/2003/13");
    await luring.simpan("/akn/id/act/uu/2020/11");
    // Sisa tanpa isi (mis. hanya peta relasi) bukan peraturan tersimpan.
    await cache.put(api.alamat.graf("/akn/id/act/uu/1999/99", 1), new Response("x"));
    const daftar = await luring.daftar();
    expect(daftar.map((e) => e.uri)).toEqual(["/akn/id/act/uu/2020/11", "/akn/id/act/uu/2003/13"]);
    expect(daftar[0].ukuran).toBe(3 * '{"v":1}'.length);
  });

  it("judul untuk daftar dicatat saat menyimpan dan dibuang saat menghapus; tanpa catatan daftar tetap tampil", async () => {
    await luring.simpan("/akn/id/act/uu/2003/13", { sitasi: "UU 13/2003", judul: "Ketenagakerjaan" });
    await luring.simpan("/akn/id/act/uu/2020/11");
    expect(await luring.daftar()).toEqual([
      { uri: "/akn/id/act/uu/2020/11", sitasi: "", judul: "", ukuran: expect.any(Number) },
      { uri: "/akn/id/act/uu/2003/13", sitasi: "UU 13/2003", judul: "Ketenagakerjaan", ukuran: expect.any(Number) },
    ]);
    await luring.hapus("/akn/id/act/uu/2003/13");
    penyimpanan.tulis("lexa:luring:v1", "bukan json");
    expect((await luring.daftar()).map((e) => [e.uri, e.sitasi])).toEqual([["/akn/id/act/uu/2020/11", ""]]);
  });

  it("hapus membuang ketiga salinan sekaligus dan tidak menyentuh peraturan lain", async () => {
    await luring.simpan("/akn/id/act/uu/2003/13");
    await luring.simpan("/akn/id/act/uu/2020/11");
    await luring.hapus("/akn/id/act/uu/2003/13");
    expect(await luring.tersimpan("/akn/id/act/uu/2003/13")).toBe(false);
    expect(await luring.tersimpan("/akn/id/act/uu/2020/11")).toBe(true);
    expect(cache.isi.size).toBe(3);
  });

  it("isi peraturan gagal diambil: galat jaringan, tidak ada simpanan setengah jadi", async () => {
    jaringan = (url) => (url.includes("/laws/detail") ? new Response("{}", { status: 503 }) : new Response("{}"));
    await expect(luring.simpan(URI)).rejects.toMatchObject({ name: "GalatLuring", kode: "jaringan" });
    expect(await luring.tersimpan(URI)).toBe(false);
  });

  it("jaringan putus total: galat jaringan yang bisa dibaca pengguna", async () => {
    jaringan = () => {
      throw new TypeError("Failed to fetch");
    };
    await expect(luring.simpan(URI)).rejects.toMatchObject({ kode: "jaringan", message: expect.stringContaining("jaringan") });
  });

  it("status dokumen atau peta relasi gagal: isi tetap tersimpan (hanya pelengkap)", async () => {
    jaringan = (url) => (url.includes("/laws/detail") ? new Response('{"isi":1}') : new Response("galat", { status: 500 }));
    const ukuran = await luring.simpan(URI);
    expect(ukuran).toBe('{"isi":1}'.length);
    expect(await luring.tersimpan(URI)).toBe(true);
    expect(cache.isi.size).toBe(1);
  });

  it("salinan dari service worker (jaringan lambat) bukan data terbaru dan tidak disimpan", async () => {
    jaringan = () => new Response('{"v":0}', { headers: { "x-lexa-salinan": "1" } });
    await expect(luring.simpan(URI)).rejects.toMatchObject({ kode: "jaringan" });
    expect(cache.isi.size).toBe(0);
  });

  it(`dibatasi ${MAKS_SIMPANAN} peraturan; yang sudah tersimpan tetap boleh diperbarui`, async () => {
    for (let i = 1; i <= MAKS_SIMPANAN; i++) await luring.simpan(`/akn/id/act/uu/2000/${i}`);
    await expect(luring.simpan("/akn/id/act/uu/2000/999")).rejects.toMatchObject({ kode: "penuh" });
    await expect(luring.simpan("/akn/id/act/uu/2000/7")).resolves.toBeGreaterThan(0);
    expect((await luring.daftar()).length).toBe(MAKS_SIMPANAN);
  });

  it("tanpa Cache API (konteks tidak aman): tidak didukung, daftar kosong, tidak melempar saat bertanya", async () => {
    vi.stubGlobal("caches", undefined);
    expect(luringDidukung()).toBe(false);
    expect(await luring.daftar()).toEqual([]);
    expect(await luring.tersimpan(URI)).toBe(false);
    await expect(luring.simpan(URI)).rejects.toBeInstanceOf(GalatLuring);
    await expect(luring.simpan(URI)).rejects.toMatchObject({ kode: "tidak_didukung" });
    await expect(luring.hapus(URI)).resolves.toBeUndefined();
  });

  it("permintaan storage.persist yang ditolak atau melempar tidak menggagalkan penyimpanan", async () => {
    vi.stubGlobal("navigator", { storage: { persist: vi.fn(async () => { throw new Error("ditolak"); }) } });
    await expect(luring.simpan(URI)).resolves.toBeGreaterThan(0);
    vi.stubGlobal("navigator", {});
    await expect(luring.simpan(URI)).resolves.toBeGreaterThan(0);
  });
});
