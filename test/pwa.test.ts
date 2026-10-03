/**
 * PWA: manifest, ikon, daftar precache, dan perilaku service worker (public/sw.js).
 *
 * Service worker dijalankan di sini dengan Cache API dan jaringan tiruan, supaya setiap cabang
 * strateginya teruji tanpa peramban: jaringan dulu, salinan hanya bila jaringan gagal atau lambat,
 * dan permintaan yang tak boleh disentuh (tulis, lintas-origin, sesi, tanya jawab) lolos apa adanya.
 * Perilaku di Chromium sungguhan (pemasangan, luring) diuji di e2e/pwa.test.mjs.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gantiBlok, hitungDaftar } from "../scripts/sw-daftar.mjs";

const PUBLIK = "public";
const sumberSW = readFileSync(join(PUBLIK, "sw.js"), "utf8");
const baca = (p: string) => readFileSync(join(PUBLIK, p), "utf8");

function berkasRekursif(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? berkasRekursif(p) : [p];
  });
}

/** Daftar cangkang yang benar-benar tertulis di sw.js (bukan hasil hitung ulang). */
function cangkangDiSW(): string[] {
  const blok = /const CANGKANG = \[([\s\S]*?)\];/.exec(sumberSW)?.[1] ?? "";
  return [...blok.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** Lebar dan tinggi PNG dari kepala IHDR. */
function ukuranPng(path: string) {
  const b = readFileSync(path);
  expect(new TextDecoder().decode(b.subarray(1, 4)), `${path} bukan PNG`).toBe("PNG");
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { lebar: v.getUint32(16), tinggi: v.getUint32(20) };
}

describe("daftar precache service worker", () => {
  it("public/sw.js mutakhir: jalankan `npm run sw` setelah mengubah berkas di public/", async () => {
    expect(gantiBlok(sumberSW, await hitungDaftar(PUBLIK))).toBe(sumberSW);
  });

  it("memuat cangkang yang dibutuhkan untuk membuka aplikasi tanpa jaringan", () => {
    const daftar = cangkangDiSW();
    for (const wajib of ["/", "/css/app.css", "/js/main.js", "/js/tema.js", "/manifest.webmanifest", "/favicon.svg", "/ikon/ikon-192.png", "/ikon/apple-touch-icon.png"]) {
      expect(daftar, wajib).toContain(wajib);
    }
  });

  it("tidak memuat berkas yang bukan aset (sw.js sendiri, _headers) dan tanpa duplikat", () => {
    const daftar = cangkangDiSW();
    expect(daftar).not.toContain("/sw.js");
    expect(daftar).not.toContain("/_headers");
    expect(daftar).not.toContain("/index.html");
    expect(new Set(daftar).size).toBe(daftar.length);
    for (const u of daftar) {
      const berkas = u === "/" ? join(PUBLIK, "index.html") : join(PUBLIK, u);
      expect(existsSync(berkas), `${u} tercantum tetapi tidak ada`).toBe(true);
    }
  });

  it("setiap modul yang diimpor modul lain (termasuk import() dinamis) ada di precache", () => {
    const daftar = new Set(cangkangDiSW());
    const pola = [/\bfrom\s*["'](\.{1,2}\/[^"']+)["']/g, /\bimport\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g, /\bimport\s*["'](\.{1,2}\/[^"']+)["']/g];
    const hilang: string[] = [];
    for (const berkas of berkasRekursif(join(PUBLIK, "js")).filter((b) => b.endsWith(".js"))) {
      // Komentar JSDoc memuat import("...") untuk tipe saja; itu bukan pemuatan modul.
      const sumber = readFileSync(berkas, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const dir = dirname(berkas.slice(PUBLIK.length));
      for (const re of pola) {
        for (const m of sumber.matchAll(re)) {
          const target = posix.normalize(posix.join(dir.split("\\").join("/"), m[1]));
          if (!daftar.has(target)) hilang.push(`${berkas} -> ${target}`);
        }
      }
    }
    expect(hilang).toEqual([]);
  });
});

describe("manifest dan ikon", () => {
  const manifest = JSON.parse(baca("manifest.webmanifest"));

  it("memenuhi syarat dapat dipasang: nama, start_url dalam scope, mode mandiri, ikon 192 dan 512", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.display).toBe("standalone");
    expect(manifest.lang).toBe("id");
    expect(manifest.scope).toBe("/");
    expect(new URL(manifest.start_url, "https://x.test").pathname.startsWith(manifest.scope)).toBe(true);
    expect(manifest.id).toBeTruthy();
    const ukuran = manifest.icons.filter((i: { type: string }) => i.type === "image/png").map((i: { sizes: string }) => i.sizes);
    expect(ukuran).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });

  it("setiap ikon ada, bertipe benar, dan berukuran sesuai yang diklaim; ada satu ikon maskable", () => {
    for (const ikon of manifest.icons as Array<{ src: string; sizes: string; type: string }>) {
      const berkas = join(PUBLIK, ikon.src);
      expect(existsSync(berkas), ikon.src).toBe(true);
      if (ikon.type === "image/png") {
        const { lebar, tinggi } = ukuranPng(berkas);
        expect(`${lebar}x${tinggi}`, ikon.src).toBe(ikon.sizes);
      }
    }
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  });

  it("pintasan dan target bagikan mengarah ke jalur dalam scope", () => {
    for (const p of manifest.shortcuts as Array<{ url: string; name: string }>) {
      expect(p.url.startsWith("/"), p.name).toBe(true);
    }
    expect(manifest.share_target.method).toBe("GET");
    expect(manifest.share_target.action.startsWith("/")).toBe(true);
    expect(Object.values(manifest.share_target.params)).toEqual(["q"]);
  });

  it("ikon layar utama iOS 180x180 dan buram (iOS menolak transparansi)", () => {
    expect(ukuranPng(join(PUBLIK, "ikon/apple-touch-icon.png"))).toEqual({ lebar: 180, tinggi: 180 });
    // Tipe warna PNG pada byte 25: 2 = RGB, 6 = RGBA. Tanpa kanal alfa berarti tidak transparan.
    expect(readFileSync(join(PUBLIK, "ikon/apple-touch-icon.png"))[25]).toBe(2);
  });
});

describe("index.html", () => {
  const html = baca("index.html");

  it("menautkan manifest, ikon iOS, dan favicon PNG yang ada", () => {
    for (const href of ["/manifest.webmanifest", "/ikon/apple-touch-icon.png", "/ikon/favicon-32.png"]) {
      expect(html, href).toContain(`href="${href}"`);
      expect(existsSync(join(PUBLIK, href)), href).toBe(true);
    }
    expect(html).toContain('name="apple-mobile-web-app-capable"');
    expect(html).toContain('name="mobile-web-app-capable"');
  });

  it("viewport memakai seluruh layar (area aman) tetapi tidak mengunci zoom pengguna", () => {
    const viewport = /<meta name="viewport" content="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(viewport).toContain("width=device-width");
    expect(viewport).toContain("viewport-fit=cover");
    expect(viewport).not.toMatch(/user-scalable\s*=\s*(no|0)/);
    expect(viewport).not.toMatch(/maximum-scale/);
  });

  it("_headers menjaga sw.js dan manifest agar selalu divalidasi", () => {
    const headers = baca("_headers");
    expect(headers).toMatch(/\/sw\.js\s*\n\s+Cache-Control: no-cache/);
    expect(headers).toMatch(/\/manifest\.webmanifest\s*\n\s+Cache-Control: no-cache/);
  });
});

// --- Perilaku service worker -------------------------------------------------------------

const ASAL = "https://lexa.test";

class CacheTiruan {
  isi = new Map<string, Response>();
  constructor(private ambil: (r: unknown) => Promise<Response>) {}
  static kunci(r: unknown) {
    return new URL(typeof r === "string" ? r : (r as { url: string }).url, ASAL).href;
  }
  async put(r: unknown, res: Response) {
    // Seperti Cache API sungguhan: entri yang diperbarui pindah ke ujung urutan.
    const k = CacheTiruan.kunci(r);
    this.isi.delete(k);
    this.isi.set(k, res);
  }
  async match(r: unknown) {
    return this.isi.get(CacheTiruan.kunci(r))?.clone();
  }
  async keys() {
    return [...this.isi.keys()].map((url) => ({ url }));
  }
  async delete(r: unknown) {
    return this.isi.delete(typeof r === "string" ? r : CacheTiruan.kunci(r));
  }
  async addAll(daftar: unknown[]) {
    const hasil = await Promise.all(daftar.map((r) => this.ambil(r)));
    hasil.forEach((res, i) => {
      if (!res.ok) throw new TypeError(`addAll gagal: ${res.status}`);
      void this.put(daftar[i], res);
    });
  }
}

class PenyimpananTiruan {
  daftar = new Map<string, CacheTiruan>();
  constructor(private ambil: (r: unknown) => Promise<Response>) {}
  async open(nama: string) {
    let c = this.daftar.get(nama);
    if (!c) this.daftar.set(nama, (c = new CacheTiruan(this.ambil)));
    return c;
  }
  async keys() {
    return [...this.daftar.keys()];
  }
  async delete(nama: string) {
    return this.daftar.delete(nama);
  }
  async match(r: unknown, opsi?: { cacheName?: string }) {
    const sumber = opsi?.cacheName ? [this.daftar.get(opsi.cacheName)] : [...this.daftar.values()];
    for (const c of sumber) {
      const ada = await c?.match(r);
      if (ada) return ada;
    }
    return undefined;
  }
}

/** Respons dari origin yang sama ("basic"), satu-satunya jenis yang boleh disalin. */
function jawab(badan: string, init: ResponseInit = {}) {
  const res = new Response(badan, init);
  Object.defineProperty(res, "type", { value: "basic" });
  return res;
}

type Peta = (req: { url: string }) => Response | Promise<Response>;

function muatSW(jaringan: Peta) {
  const pendengar: Record<string, (e: unknown) => void> = {};
  const permintaan: string[] = [];
  const objek: Array<{ url: string; cache?: string }> = [];
  const ambil = async (r: unknown) => {
    const url = CacheTiruan.kunci(r);
    permintaan.push(url);
    objek.push(r as { url: string; cache?: string });
    return jaringan({ url });
  };
  const caches = new PenyimpananTiruan(ambil);
  const self = {
    location: new URL(`${ASAL}/sw.js`),
    addEventListener: (nama: string, fn: (e: unknown) => void) => void (pendengar[nama] = fn),
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
  };
  class RequestTiruan {
    url: string;
    cache?: string;
    constructor(u: string, init?: { cache?: string }) {
      this.url = new URL(u, ASAL).href;
      this.cache = init?.cache;
    }
  }
  new Function("self", "caches", "fetch", "Request", sumberSW)(self, caches, ambil, RequestTiruan);

  async function jalankan(nama: "install" | "activate") {
    const tugas: Promise<unknown>[] = [];
    pendengar[nama]({ waitUntil: (p: Promise<unknown>) => tugas.push(Promise.resolve(p)) });
    await Promise.all(tugas);
  }

  /** Kirim satu permintaan; `dijawab` undefined berarti service worker tidak mencegatnya. */
  async function minta(url: string, opsi: { method?: string; mode?: string } = {}) {
    const tugas: Promise<unknown>[] = [];
    let dijawab: Promise<Response> | undefined;
    pendengar.fetch({
      request: { method: "GET", mode: "cors", url: new URL(url, ASAL).href, ...opsi },
      respondWith: (p: Promise<Response>) => void (dijawab = Promise.resolve(p)),
      waitUntil: (p: Promise<unknown>) => tugas.push(Promise.resolve(p)),
    });
    return {
      intersep: dijawab !== undefined,
      respons: async () => dijawab!,
      /** Seperti peramban: peristiwa hidup sampai jawaban dan semua waitUntil-nya (yang bisa ditambah belakangan) selesai. */
      selesai: async () => {
        await dijawab?.catch(() => undefined);
        let jumlah = -1;
        while (jumlah !== tugas.length) {
          jumlah = tugas.length;
          await Promise.allSettled(tugas);
        }
      },
    };
  }

  return { self, caches, permintaan, objek, jalankan, minta };
}

const bacaCache = async (sw: ReturnType<typeof muatSW>, nama: string, url: string) => (await (await sw.caches.open(nama)).match(url))?.text();

afterEach(() => vi.useRealTimers());

describe("service worker: pemasangan dan pembaruan", () => {
  it("install menyimpan seluruh cangkang ke cache versi ini lalu langsung aktif", async () => {
    const sw = muatSW(() => jawab("ok"));
    await sw.jalankan("install");
    const { versi, url } = await hitungDaftar(PUBLIK);
    const cache = await sw.caches.open(`lexa-cangkang-${versi}`);
    expect((await cache.keys()).length).toBe(url.length);
    expect(sw.self.skipWaiting).toHaveBeenCalled();
    // Melewati cache HTTP, agar salinan luring pasti dari rilis ini dan bukan sisa rilis sebelumnya.
    expect(sw.objek.every((r) => r.cache === "reload")).toBe(true);
  });

  it("install gagal bila satu berkas cangkang tak terambil, sehingga versi lama tetap dipakai", async () => {
    const sw = muatSW((r) => (r.url.endsWith("/js/main.js") ? jawab("tidak ada", { status: 404 }) : jawab("ok")));
    await expect(sw.jalankan("install")).rejects.toThrow();
    expect(sw.self.skipWaiting).not.toHaveBeenCalled();
  });

  it("activate membuang cache lexa versi lama, menyisakan yang aktif dan cache milik pihak lain", async () => {
    const sw = muatSW(() => jawab("ok"));
    const { versi } = await hitungDaftar(PUBLIK);
    for (const n of ["lexa-cangkang-lama", `lexa-cangkang-${versi}`, "lexa-baca-v1", "lexa-simpan-v1", "lexa-baca-v0", "punya-orang-lain"]) await sw.caches.open(n);
    await sw.jalankan("activate");
    expect((await sw.caches.keys()).sort()).toEqual([`lexa-cangkang-${versi}`, "lexa-baca-v1", "lexa-simpan-v1", "punya-orang-lain"].sort());
    expect(sw.self.clients.claim).toHaveBeenCalled();
  });
});

describe("service worker: permintaan yang tidak boleh disentuh", () => {
  it.each([
    ["POST", "/api/tanya", "tulis"],
    ["PUT", "/api/koleksi", "tulis"],
    ["DELETE", "/api/koleksi?uri=x", "tulis"],
    ["POST", "/api/laws/detail?uri=x", "jalur baca pun bila bukan GET (Cache API menolak)"],
    ["POST", "/js/main.js", "berkas statis bukan GET"],
    ["POST", "/", "kirim formulir ke halaman"],
    ["GET", "/api/search?q=pesangon", "pencarian harus segar"],
    ["GET", "/api/suggest?q=uu", "saran harus segar"],
    ["GET", "/api/tanya", "tanya jawab"],
    ["GET", "/api/auth/status", "sesi"],
    ["GET", "/api/auth/google", "alur masuk"],
    ["GET", "/api/koleksi", "milik pengguna"],
    ["GET", "/api/admin/status", "admin"],
    ["GET", "/sw.js", "dirinya sendiri"],
    ["GET", "/robots.txt", "dilayani Worker"],
    ["GET", "/sitemap.xml", "dilayani Worker"],
    ["GET", "https://orang.lain/api/laws/detail?uri=x", "lintas-origin"],
    ["GET", "https://cdn.contoh/lib.js", "lintas-origin"],
  ])("%s %s lolos ke jaringan (%s)", async (method, url) => {
    const sw = muatSW(() => jawab("x"));
    const r = await sw.minta(url, { method });
    expect(r.intersep).toBe(false);
    expect(sw.permintaan).toEqual([]);
  });
});

describe("service worker: API baca (jaringan dulu, salinan sebagai cadangan)", () => {
  const DETAIL = "/api/laws/detail?uri=%2Fakn%2Fid%2Fact%2Fuu%2F2003%2F13";

  it("daring: jawaban jaringan yang dipakai dan disimpan; tidak ada penanda salinan", async () => {
    const sw = muatSW(() => jawab('{"v":1}', { headers: { "content-type": "application/json" } }));
    const r = await sw.minta(DETAIL);
    const res = await r.respons();
    expect(await res.text()).toBe('{"v":1}');
    expect(res.headers.get("x-lexa-salinan")).toBeNull();
    await r.selesai();
    expect(await bacaCache(sw, "lexa-baca-v1", DETAIL)).toBe('{"v":1}');
  });

  it("daring dan salinan sudah usang: pengguna mendapat yang terbaru, salinan diperbarui (tidak pernah usang saat daring)", async () => {
    let versi = 1;
    const sw = muatSW(() => jawab(`{"v":${versi}}`));
    await (await sw.minta(DETAIL)).selesai();
    versi = 2;
    const r = await sw.minta(DETAIL);
    expect(await (await r.respons()).text()).toBe('{"v":2}');
    await r.selesai();
    expect(await bacaCache(sw, "lexa-baca-v1", DETAIL)).toBe('{"v":2}');
  });

  it("luring dengan salinan: salinan dikirim dengan penanda x-lexa-salinan", async () => {
    let daring = true;
    const sw = muatSW(() => {
      if (!daring) throw new TypeError("Failed to fetch");
      return jawab('{"v":1}');
    });
    await (await sw.minta(DETAIL)).selesai();
    daring = false;
    const res = await (await sw.minta(DETAIL)).respons();
    expect(await res.text()).toBe('{"v":1}');
    expect(res.headers.get("x-lexa-salinan")).toBe("1");
  });

  it("luring tanpa salinan: 503 JSON yang bisa dibaca klien", async () => {
    const sw = muatSW(() => {
      throw new TypeError("Failed to fetch");
    });
    const res = await (await sw.minta(DETAIL)).respons();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "luring" });
  });

  it("jaringan lambat (>5 dtk) memakai salinan, lalu menyegarkannya saat jaringan akhirnya menjawab", async () => {
    vi.useFakeTimers();
    let lepas: (r: Response) => void = () => {};
    let lambat = false;
    const sw = muatSW(() => (lambat ? new Promise<Response>((selesai) => (lepas = selesai)) : jawab('{"v":1}')));
    await (await sw.minta(DETAIL)).selesai();
    lambat = true;
    const r = await sw.minta(DETAIL);
    const jawaban = r.respons();
    await vi.advanceTimersByTimeAsync(5000);
    const res = await jawaban;
    expect(await res.text()).toBe('{"v":1}');
    expect(res.headers.get("x-lexa-salinan")).toBe("1");
    lepas(jawab('{"v":2}'));
    await r.selesai();
    expect(await bacaCache(sw, "lexa-baca-v1", DETAIL)).toBe('{"v":2}');
  });

  it("server 5xx dengan salinan tersedia: salinan dipakai; tanpa salinan: galat servernya diteruskan", async () => {
    let galat = false;
    const sw = muatSW(() => (galat ? jawab("rusak", { status: 502 }) : jawab('{"v":1}')));
    const tanpa = await (await sw.minta("/api/stats")).respons();
    expect(tanpa.status).toBe(200);
    galat = true;
    const dariCache = await (await sw.minta("/api/stats")).respons();
    expect(dariCache.status).toBe(200);
    expect(dariCache.headers.get("x-lexa-salinan")).toBe("1");
    const diteruskan = await (await sw.minta("/api/bidang")).respons();
    expect(diteruskan.status).toBe(502);
  });

  it("jawaban 4xx (mis. peraturan tidak ditemukan) diteruskan dan tidak pernah disimpan", async () => {
    const sw = muatSW(() => jawab('{"error":"tidak_ditemukan"}', { status: 404 }));
    const r = await sw.minta(DETAIL);
    expect((await r.respons()).status).toBe(404);
    await r.selesai();
    expect(await bacaCache(sw, "lexa-baca-v1", DETAIL)).toBeUndefined();
  });

  it("jawaban non-basic (mis. opaque) tidak disimpan", async () => {
    const res = new Response("x");
    Object.defineProperty(res, "type", { value: "opaque" });
    const sw = muatSW(() => res);
    const r = await sw.minta(DETAIL);
    await r.respons();
    await r.selesai();
    expect(await bacaCache(sw, "lexa-baca-v1", DETAIL)).toBeUndefined();
  });

  it("cache baca dibatasi 80 entri: yang terlama dibuang, yang baru dibuka ulang dipertahankan", async () => {
    const sw = muatSW((r) => jawab(r.url));
    for (let i = 0; i < 80; i++) await (await sw.minta(`/api/laws/detail?uri=${i}`)).selesai();
    // Buka ulang entri 0 sehingga ia menjadi yang terbaru, lalu tambahkan dua entri baru.
    await (await sw.minta("/api/laws/detail?uri=0")).selesai();
    await (await sw.minta("/api/laws/detail?uri=80")).selesai();
    await (await sw.minta("/api/laws/detail?uri=81")).selesai();
    const kunci = (await (await sw.caches.open("lexa-baca-v1")).keys()).map((k) => new URL(k.url).search);
    expect(kunci).toHaveLength(80);
    expect(kunci).toContain("?uri=0");
    expect(kunci).toContain("?uri=81");
    expect(kunci).not.toContain("?uri=1");
    expect(kunci).not.toContain("?uri=2");
  });

  it("salinan yang sengaja disimpan pengguna didahulukan dan tidak ikut terbuang oleh batas cache baca", async () => {
    const sw = muatSW(() => {
      throw new TypeError("Failed to fetch");
    });
    await (await sw.caches.open("lexa-simpan-v1")).put(DETAIL, jawab('{"simpanan":true}'));
    await (await sw.caches.open("lexa-baca-v1")).put(DETAIL, jawab('{"simpanan":false}'));
    const res = await (await sw.minta(DETAIL)).respons();
    expect(await res.text()).toBe('{"simpanan":true}');
  });
});

describe("service worker: halaman dan berkas statis", () => {
  it("navigasi daring: halaman dari jaringan", async () => {
    const sw = muatSW(() => jawab("<html>baru</html>"));
    const res = await (await sw.minta("/telusuri", { mode: "navigate" })).respons();
    expect(await res.text()).toBe("<html>baru</html>");
  });

  it("navigasi luring: cangkang SPA dari cache, apa pun jalurnya", async () => {
    let daring = true;
    const sw = muatSW(() => {
      if (!daring) throw new TypeError("Failed to fetch");
      return jawab("<html>cangkang</html>");
    });
    await sw.jalankan("install");
    daring = false;
    for (const jalur of ["/", "/telusuri", "/peraturan?uri=%2Fakn%2Fid%2Fact%2Fuu%2F2003%2F13", "/koleksi"]) {
      const res = await (await sw.minta(jalur, { mode: "navigate" })).respons();
      expect(res.status, jalur).toBe(200);
      expect(await res.text(), jalur).toBe("<html>cangkang</html>");
    }
  });

  it("navigasi luring sebelum pernah terpasang: halaman penjelasan 503, bukan layar galat peramban", async () => {
    const sw = muatSW(() => {
      throw new TypeError("Failed to fetch");
    });
    const res = await (await sw.minta("/telusuri", { mode: "navigate" })).respons();
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("Anda sedang luring");
  });

  it("navigasi lambat (>4,5 dtk) menyajikan cangkang tersimpan", async () => {
    vi.useFakeTimers();
    let lambat = false;
    const sw = muatSW(() => (lambat ? new Promise<Response>(() => {}) : jawab("<html>cangkang</html>")));
    await sw.jalankan("install");
    lambat = true;
    const jawaban = (await sw.minta("/telusuri", { mode: "navigate" })).respons();
    await vi.advanceTimersByTimeAsync(4500);
    expect(await (await jawaban).text()).toBe("<html>cangkang</html>");
  });

  it("server 5xx pada navigasi: cangkang tersimpan dipakai", async () => {
    let galat = false;
    const sw = muatSW(() => (galat ? jawab("bad gateway", { status: 502 }) : jawab("<html>cangkang</html>")));
    await sw.jalankan("install");
    galat = true;
    const res = await (await sw.minta("/koleksi", { mode: "navigate" })).respons();
    expect(await res.text()).toBe("<html>cangkang</html>");
  });

  it("berkas statis daring selalu yang terbaru dan menyegarkan salinan; luring memakai salinan", async () => {
    let isi = "v1";
    let daring = true;
    const sw = muatSW(() => {
      if (!daring) throw new TypeError("Failed to fetch");
      return jawab(isi);
    });
    const ambil = async () => {
      const r = await sw.minta("/js/main.js");
      const teks = await (await r.respons()).text();
      await r.selesai();
      return teks;
    };
    expect(await ambil()).toBe("v1");
    isi = "v2";
    expect(await ambil()).toBe("v2");
    daring = false;
    expect(await ambil()).toBe("v2");
  });

  it("berkas statis luring yang belum pernah disimpan gagal sebagai galat jaringan biasa", async () => {
    const sw = muatSW(() => {
      throw new TypeError("Failed to fetch");
    });
    const res = await (await sw.minta("/css/tidak-pernah-dibuka.css")).respons();
    expect(res.type).toBe("error");
  });
});
