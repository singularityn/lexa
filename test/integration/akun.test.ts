/**
 * Akun: status sesi, alur login Google (tanpa jaringan: token ditandatangani
 * kunci RSA buatan tes), profil, keluar, dan koleksi tersinkron.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/worker/index";
import {
  buatLingkungan, json, kirim, KORPUS, masukSebagai, panggil, sisipkan, sqliteAda, type Lingkungan,
} from "./harness";

interface Status {
  masuk: boolean;
  login_tersedia: boolean;
  redirect_uri: string | null;
  pengguna: { id: string; email: string; nama: string | null; foto_url: string | null } | null;
}

describe.skipIf(!sqliteAda)("akun", () => {
  let l: Lingkungan;
  beforeEach(async () => {
    l = buatLingkungan();
    await sisipkan(l, KORPUS);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    l.tutup();
  });

  const dengan = (cookie: string, init: RequestInit = {}): RequestInit => ({
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), cookie },
  });

  describe("GET /api/auth/status", () => {
    it("tamu: belum masuk, login tidak tersedia bila Google belum dikonfigurasi", async () => {
      const res = await panggil(l, "/api/auth/status");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ masuk: false, login_tersedia: false, redirect_uri: null, pengguna: null });
    });

    it("login_tersedia true bila GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET terpasang", async () => {
      Object.assign(l.env, { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "rahasia" });
      expect((await json<Status>(await panggil(l, "/api/auth/status"))).login_tersedia).toBe(true);
      Object.assign(l.env, { GOOGLE_CLIENT_SECRET: "" });
      expect((await json<Status>(await panggil(l, "/api/auth/status"))).login_tersedia).toBe(false);
    });

    it("redirect_uri: alamat yang harus terdaftar persis di Google Cloud Console; null selama login belum tersedia", async () => {
      expect((await json<Status>(await panggil(l, "/api/auth/status"))).redirect_uri).toBeNull();
      Object.assign(l.env, { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "rahasia" });
      expect((await json<Status>(await panggil(l, "/api/auth/status"))).redirect_uri).toBe("https://lexa.test/api/auth/google/callback");
    });

    it("redirect_uri mengikuti host yang dipakai pengunjung (workers.dev dan domain sendiri perlu entri masing-masing); jalur dan kueri tak ikut", async () => {
      Object.assign(l.env, { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "rahasia" });
      const dari = async (url: string) =>
        (await (await worker.fetch(new Request(url), l.env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext)).json() as Status).redirect_uri;
      expect(await dari("https://lexa.fariqhfebrian18.workers.dev/api/auth/status?x=1#y")).toBe("https://lexa.fariqhfebrian18.workers.dev/api/auth/google/callback");
      expect(await dari("https://hukum.example.id/api/auth/status")).toBe("https://hukum.example.id/api/auth/google/callback");
      expect(await dari("http://localhost:8787/api/auth/status")).toBe("http://localhost:8787/api/auth/google/callback");
    });

    it("pengguna yang masuk: profil dikembalikan tanpa membocorkan data sesi lain", async () => {
      const { cookie } = await masukSebagai(l, { id: "u7", email: "tujuh@example.test", nama: "Tujuh" });
      const b = await json<Status>(await panggil(l, "/api/auth/status", dengan(cookie)));
      expect(b).toEqual({
        masuk: true,
        login_tersedia: false,
        redirect_uri: null,
        pengguna: { id: "u7", email: "tujuh@example.test", nama: "Tujuh", foto_url: null },
      });
    });

    it("cookie yang tidak dikenal atau sesi yang sudah dihapus = tamu", async () => {
      expect((await json<Status>(await panggil(l, "/api/auth/status", dengan("lexa_sesi=palsu")))).masuk).toBe(false);
      const { cookie } = await masukSebagai(l);
      l.kv.isi.delete("sesi:sesi-u1");
      expect((await json<Status>(await panggil(l, "/api/auth/status", dengan(cookie)))).masuk).toBe(false);
    });

    it("cookie lain di header tidak mengganggu pembacaan cookie sesi", async () => {
      const { cookie } = await masukSebagai(l);
      const b = await json<Status>(await panggil(l, "/api/auth/status", dengan(`a=1; ${cookie}; b=2`)));
      expect(b.masuk).toBe(true);
    });
  });

  describe("alur Google OAuth", () => {
    const CLIENT_ID = "klien-uji.apps.googleusercontent.com";
    const aktifkan = () => Object.assign(l.env, { GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: "rahasia" });

    const b64url = (data: ArrayBuffer | Uint8Array | string) => {
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
      return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    };

    async function kunciRsa() {
      const pasangan = (await crypto.subtle.generateKey(
        { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
        true,
        ["sign", "verify"],
      )) as CryptoKeyPair;
      const jwk = (await crypto.subtle.exportKey("jwk", pasangan.publicKey)) as JsonWebKey & { kid?: string };
      return { privat: pasangan.privateKey, jwk };
    }

    async function buatIdToken(
      kunci: Awaited<ReturnType<typeof kunciRsa>>,
      klaim: Record<string, unknown> = {},
      kid = "kid-uji",
    ) {
      const kepala = b64url(JSON.stringify({ alg: "RS256", kid }));
      const muatan = b64url(JSON.stringify({
        sub: "google-123", email: "pengguna@example.test", email_verified: true, name: "Pengguna Uji",
        picture: "https://foto.example/p.png", aud: CLIENT_ID, iss: "https://accounts.google.com",
        exp: Math.floor(Date.now() / 1000) + 3600, ...klaim,
      }));
      const tanda = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kunci.privat, new TextEncoder().encode(`${kepala}.${muatan}`));
      return `${kepala}.${muatan}.${b64url(tanda)}`;
    }

    /** Stub fetch ke Google: endpoint token mengembalikan `idToken`, JWKS memuat kunci publik tes. */
    function stubGoogle(opsi: { idToken?: string | null; jwk?: JsonWebKey; tokenStatus?: number }) {
      const panggilan: Array<{ url: string; body?: string }> = [];
      vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        panggilan.push({ url, body: init?.body ? String(init.body) : undefined });
        if (url === "https://oauth2.googleapis.com/token") {
          if (opsi.tokenStatus && opsi.tokenStatus !== 200) return new Response("galat", { status: opsi.tokenStatus });
          return Response.json(opsi.idToken === null ? {} : { id_token: opsi.idToken });
        }
        if (url === "https://www.googleapis.com/oauth2/v3/certs") {
          return Response.json({ keys: opsi.jwk ? [{ ...opsi.jwk, kid: "kid-uji", alg: "RS256", use: "sig" }] : [] });
        }
        throw new Error(`fetch tak terduga: ${url}`);
      });
      return panggilan;
    }

    /** Mulai alur dan kembalikan `state` yang dikeluarkan server. */
    async function mulai(kembali?: string) {
      const res = await panggil(l, `/api/auth/google${kembali !== undefined ? `?kembali=${encodeURIComponent(kembali)}` : ""}`);
      const lokasi = new URL(res.headers.get("location")!);
      return { res, lokasi, state: lokasi.searchParams.get("state")! };
    }

    it("belum dikonfigurasi -> 503 dengan petunjuk; mode tamu tetap jalan", async () => {
      const res = await panggil(l, "/api/auth/google");
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ error: "belum_dikonfigurasi" });
    });

    it("mengalihkan ke Google dengan parameter yang benar dan menyimpan state sekali pakai", async () => {
      aktifkan();
      const { res, lokasi, state } = await mulai("/peraturan?uri=x");
      expect(res.status).toBe(302);
      expect(lokasi.origin + lokasi.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
      expect(Object.fromEntries(lokasi.searchParams)).toMatchObject({
        client_id: CLIENT_ID,
        redirect_uri: "https://lexa.test/api/auth/google/callback",
        response_type: "code",
        scope: "openid email profile",
        prompt: "select_account",
      });
      expect(state).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.parse(l.kv.isi.get(`oauth:${state}`)!.nilai)).toEqual({ kembaliKe: "/peraturan?uri=x" });
      expect(l.kv.isi.get(`oauth:${state}`)!.kedaluwarsa).toBeGreaterThan(Date.now());
    });

    it("alamat di /api/auth/status sama persis dengan yang dikirim ke Google di awal alur dan saat menukar kode (selisih sekecil apa pun = redirect_uri_mismatch)", async () => {
      aktifkan();
      const kunci = await kunciRsa();
      const panggilan = stubGoogle({ idToken: await buatIdToken(kunci), jwk: kunci.jwk });
      const terdaftar = (await json<Status>(await panggil(l, "/api/auth/status"))).redirect_uri;
      const { lokasi, state } = await mulai();
      expect(lokasi.searchParams.get("redirect_uri")).toBe(terdaftar);
      await panggil(l, `/api/auth/google/callback?code=kode-uji&state=${state}`);
      const tukar = new URLSearchParams(panggilan.find((p) => p.url.endsWith("/token"))!.body);
      expect(tukar.get("redirect_uri")).toBe(terdaftar);
      // Bentuk yang selalu dituntut Google: https (atau localhost), tanpa garis miring penutup, tanpa kueri atau fragmen.
      expect(terdaftar).toMatch(/^https:\/\/[^/?#]+\/api\/auth\/google\/callback$/);
    });

    it("pembatalan atau penolakan dari Google (error=access_denied) -> /akun?galat=ditolak; state hangus, tanpa cookie", async () => {
      aktifkan();
      const { state } = await mulai();
      const res = await panggil(l, `/api/auth/google/callback?error=access_denied&state=${state}`);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/akun?galat=ditolak");
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(l.kv.isi.has(`oauth:${state}`)).toBe(false);
    });

    it("galat lain dari Google, dengan atau tanpa state -> /akun?galat=google", async () => {
      aktifkan();
      const { state } = await mulai();
      expect((await panggil(l, `/api/auth/google/callback?error=server_error&state=${state}`)).headers.get("location")).toBe("/akun?galat=google");
      expect((await panggil(l, "/api/auth/google/callback?error=temporarily_unavailable")).headers.get("location")).toBe("/akun?galat=google");
      expect(l.kv.isi.has(`oauth:${state}`)).toBe(false);
    });

    it("callback sukses: pengguna dibuat, sesi disimpan, cookie aman dipasang, state hangus", async () => {
      aktifkan();
      const kunci = await kunciRsa();
      const panggilan = stubGoogle({ idToken: await buatIdToken(kunci), jwk: kunci.jwk });
      const { state } = await mulai("/koleksi");

      const res = await panggil(l, `/api/auth/google/callback?code=kode-uji&state=${state}`);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/koleksi");

      const cookie = res.headers.get("set-cookie")!;
      expect(cookie).toMatch(/^lexa_sesi=[0-9a-f]{64}; /);
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("Max-Age=2592000");

      const idSesi = cookie.match(/lexa_sesi=([0-9a-f]+)/)![1];
      expect(JSON.parse(l.kv.isi.get(`sesi:${idSesi}`)!.nilai)).toMatchObject({
        pengguna_id: "google-123", email: "pengguna@example.test", nama: "Pengguna Uji",
      });
      expect(await l.db.prepare(`SELECT id, email, nama, foto_url FROM pengguna`).all()).toMatchObject({
        results: [{ id: "google-123", email: "pengguna@example.test", nama: "Pengguna Uji", foto_url: "https://foto.example/p.png" }],
      });

      // Pertukaran kode memakai rahasia klien dan redirect_uri yang sama dengan awal alur.
      const tukar = new URLSearchParams(panggilan.find((p) => p.url.endsWith("/token"))!.body);
      expect(Object.fromEntries(tukar)).toEqual({
        code: "kode-uji", client_id: CLIENT_ID, client_secret: "rahasia",
        redirect_uri: "https://lexa.test/api/auth/google/callback", grant_type: "authorization_code",
      });

      // State hanya berlaku sekali.
      expect(l.kv.isi.has(`oauth:${state}`)).toBe(false);
      const ulang = await panggil(l, `/api/auth/google/callback?code=kode-uji&state=${state}`);
      expect(ulang.headers.get("location")).toBe("/akun?galat=state");

      // Cookie yang diterbitkan benar-benar membuka sesi.
      const status = await json<Status>(await panggil(l, "/api/auth/status", dengan(`lexa_sesi=${idSesi}`)));
      expect(status.pengguna).toMatchObject({ id: "google-123", nama: "Pengguna Uji" });
    });

    it("masuk berulang memperbarui akun yang sama, bukan menggandakannya", async () => {
      aktifkan();
      const kunci = await kunciRsa();
      for (const nama of ["Nama Lama", "Nama Baru"]) {
        stubGoogle({ idToken: await buatIdToken(kunci, { name: nama }), jwk: kunci.jwk });
        const { state } = await mulai();
        await panggil(l, `/api/auth/google/callback?code=c&state=${state}`);
      }
      const { results } = await l.db.prepare(`SELECT id, nama FROM pengguna`).all();
      expect(results).toEqual([{ id: "google-123", nama: "Nama Baru" }]);
    });

    it("parameter kurang atau state tidak dikenal -> kembali ke /akun dengan galat", async () => {
      aktifkan();
      expect((await panggil(l, "/api/auth/google/callback")).headers.get("location")).toBe("/akun?galat=parameter");
      expect((await panggil(l, "/api/auth/google/callback?code=c")).headers.get("location")).toBe("/akun?galat=parameter");
      expect((await panggil(l, "/api/auth/google/callback?code=c&state=ngawur")).headers.get("location")).toBe("/akun?galat=state");
    });

    it("Google menolak pertukaran kode, atau tidak memberi id_token -> galat token", async () => {
      aktifkan();
      const kunci = await kunciRsa();
      for (const opsi of [{ tokenStatus: 400 }, { idToken: null, jwk: kunci.jwk }]) {
        stubGoogle(opsi);
        const { state } = await mulai();
        const res = await panggil(l, `/api/auth/google/callback?code=c&state=${state}`);
        expect(res.headers.get("location")).toBe("/akun?galat=token");
        expect(res.headers.get("set-cookie")).toBeNull();
      }
    });

    describe("id_token yang tidak sah ditolak tanpa membuat sesi", () => {
      const kasus: Array<[string, (k: Awaited<ReturnType<typeof kunciRsa>>) => Promise<string>]> = [
        ["audiens (aud) milik aplikasi lain", (k) => buatIdToken(k, { aud: "klien-lain" })],
        ["penerbit (iss) bukan Google", (k) => buatIdToken(k, { iss: "https://jahat.example" })],
        ["sudah kedaluwarsa", (k) => buatIdToken(k, { exp: Math.floor(Date.now() / 1000) - 10 })],
        ["email belum terverifikasi", (k) => buatIdToken(k, { email_verified: false })],
        ["kid tidak ada di JWKS", (k) => buatIdToken(k, {}, "kid-asing")],
        [
          "ditandatangani kunci lain",
          async () => buatIdToken(await kunciRsa()),
        ],
      ];

      it.each(kasus)("%s", async (_nama, buat) => {
        aktifkan();
        const kunci = await kunciRsa();
        stubGoogle({ idToken: await buat(kunci), jwk: kunci.jwk });
        const { state } = await mulai();
        const res = await panggil(l, `/api/auth/google/callback?code=c&state=${state}`);
        expect(res.headers.get("location")).toBe("/akun?galat=verifikasi");
        expect(res.headers.get("set-cookie")).toBeNull();
        expect((await l.db.prepare(`SELECT COUNT(*) AS n FROM pengguna`).first<{ n: number }>())?.n).toBe(0);
        expect([...l.kv.isi.keys()].filter((k) => k.startsWith("sesi:"))).toEqual([]);
      });
    });

    describe("tujuan setelah masuk", () => {
      async function selesaikan(kembali: string) {
        aktifkan();
        const kunci = await kunciRsa();
        stubGoogle({ idToken: await buatIdToken(kunci), jwk: kunci.jwk });
        const { state } = await mulai(kembali);
        return (await panggil(l, `/api/auth/google/callback?code=c&state=${state}`)).headers.get("location");
      }

      it("jalur relatif diteruskan; tujuan absolut jatuh ke beranda", async () => {
        expect(await selesaikan("/peraturan?uri=%2Fakn%2Fid")).toBe("/peraturan?uri=%2Fakn%2Fid");
        expect(await selesaikan("https://jahat.example/")).toBe("/");
      });

      // Bug v0.1 yang sudah diperbaiki: "//jahat.example" diawali "/" sehingga lolos pemeriksaan, padahal
      // peramban membacanya sebagai URL protokol-relatif ke situs lain (open redirect setelah login).
      it.each([
        ["//jahat.example/", "protokol-relatif"],
        ["/\\jahat.example", "garis miring terbalik yang dinormalkan peramban menjadi '//'"],
        ["/\t/jahat.example", "tab yang dibuang parser URL sehingga menjadi '//'"],
        ["/\n/jahat.example", "baris baru yang dibuang parser URL"],
        ["///jahat.example", "tiga garis miring"],
        ["javascript:alert(1)", "skema javascript"],
        ["jahat.example", "tanpa garis miring awal"],
      ])("tujuan %j (%s) jatuh ke beranda", async (kembali) => {
        expect(await selesaikan(kembali)).toBe("/");
      });

      it("kueri dan hash pada jalur lokal dipertahankan", async () => {
        expect(await selesaikan("/cari?q=pesangon&mode=keyword#hasil")).toBe("/cari?q=pesangon&mode=keyword#hasil");
      });
    });
  });

  describe("PATCH /api/auth/profil", () => {
    const ubah = (badan: unknown, cookie: string) => panggil(l, "/api/auth/profil", dengan(cookie, kirim("PATCH", badan)));

    it("butuh sesi", async () => {
      const res = await panggil(l, "/api/auth/profil", kirim("PATCH", { nama: "x" }));
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: "belum_masuk" });
    });

    it("mengubah nama dan foto di D1 sekaligus di sesi KV", async () => {
      const { cookie } = await masukSebagai(l);
      const res = await ubah({ nama: "  Nama Baru  ", foto_url: "https://foto.example/a.png" }, cookie);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        status: "tersimpan",
        pengguna: { id: "u1", nama: "Nama Baru", foto_url: "https://foto.example/a.png" },
      });
      expect(await l.db.prepare(`SELECT nama, foto_url FROM pengguna`).first()).toEqual({ nama: "Nama Baru", foto_url: "https://foto.example/a.png" });
      const status = await json<Status>(await panggil(l, "/api/auth/status", dengan(cookie)));
      expect(status.pengguna).toMatchObject({ nama: "Nama Baru", foto_url: "https://foto.example/a.png" });
    });

    it("foto_url kosong atau null menghapus foto; tidak menyebutnya membiarkan foto lama", async () => {
      const { cookie } = await masukSebagai(l);
      await ubah({ foto_url: "https://foto.example/a.png" }, cookie);
      await ubah({ nama: "Hanya Nama" }, cookie);
      expect((await l.db.prepare(`SELECT foto_url FROM pengguna`).first<{ foto_url: string }>())?.foto_url).toBe("https://foto.example/a.png");
      await ubah({ foto_url: null }, cookie);
      expect((await l.db.prepare(`SELECT foto_url FROM pengguna`).first<{ foto_url: string | null }>())?.foto_url).toBeNull();
    });

    it("hanya tautan http(s) yang diterima sebagai foto", async () => {
      const { cookie } = await masukSebagai(l);
      for (const foto of ["javascript:alert(1)", "data:image/svg+xml;base64,AAAA", "bukan url", "ftp://x/y.png"]) {
        const res = await ubah({ foto_url: foto }, cookie);
        expect(res.status, foto).toBe(400);
        expect(await res.json()).toMatchObject({ error: "foto_tidak_sah" });
      }
      expect((await l.db.prepare(`SELECT foto_url FROM pengguna`).first<{ foto_url: string | null }>())?.foto_url).toBeNull();
    });

    it("nama kosong ditolak; nama terlalu panjang dipotong 80 karakter", async () => {
      const { cookie } = await masukSebagai(l);
      const kosong = await ubah({ nama: "   " }, cookie);
      expect(kosong.status).toBe(400);
      expect(await kosong.json()).toMatchObject({ error: "nama_kosong" });
      await ubah({ nama: "n".repeat(200) }, cookie);
      expect((await l.db.prepare(`SELECT nama FROM pengguna`).first<{ nama: string }>())?.nama.length).toBe(80);
    });

    it("tidak menyentuh akun lain", async () => {
      const { cookie } = await masukSebagai(l, { id: "u1", nama: "Satu" });
      await masukSebagai(l, { id: "u2", nama: "Dua" });
      await ubah({ nama: "Satu Baru" }, cookie);
      const { results } = await l.db.prepare(`SELECT id, nama FROM pengguna ORDER BY id`).all();
      expect(results).toEqual([{ id: "u1", nama: "Satu Baru" }, { id: "u2", nama: "Dua" }]);
    });
  });

  describe("POST /api/auth/keluar", () => {
    it("menghapus sesi di KV dan menghapus cookie", async () => {
      const { cookie } = await masukSebagai(l);
      const res = await panggil(l, "/api/auth/keluar", dengan(cookie, { method: "POST" }));
      expect(await res.json()).toEqual({ status: "keluar" });
      expect(res.headers.get("set-cookie")).toBe("lexa_sesi=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0");
      expect(l.kv.isi.has("sesi:sesi-u1")).toBe(false);
      expect((await json<Status>(await panggil(l, "/api/auth/status", dengan(cookie)))).masuk).toBe(false);
    });

    it("tanpa sesi tetap berhasil (idempoten)", async () => {
      const res = await panggil(l, "/api/auth/keluar", { method: "POST" });
      expect(res.status).toBe(200);
    });
  });

  describe("koleksi (/api/koleksi)", () => {
    const entri = { uri: "/akn/id/act/uu/2003/13", sitasi: "UU 13/2003", judul: "Ketenagakerjaan" };
    const simpan = (badan: unknown, cookie: string) => panggil(l, "/api/koleksi", dengan(cookie, kirim("PUT", badan)));
    const daftar = async (cookie?: string) =>
      json<{ masuk: boolean; koleksi: Array<{ uri: string; sitasi: string; judul: string; catatan: string | null }> }>(
        await panggil(l, "/api/koleksi", cookie ? dengan(cookie) : undefined),
      );

    it("tamu: daftar kosong tanpa galat; menulis atau menghapus -> 401", async () => {
      expect(await daftar()).toEqual({ masuk: false, koleksi: [] });
      const put = await panggil(l, "/api/koleksi", kirim("PUT", entri));
      expect(put.status).toBe(401);
      expect(await put.json()).toMatchObject({ error: "belum_masuk" });
      expect((await panggil(l, "/api/koleksi?uri=/x", { method: "DELETE" })).status).toBe(401);
      expect((await panggil(l, "/api/koleksi/gabung", kirim("POST", { koleksi: [entri] }))).status).toBe(401);
    });

    it("menyimpan, mendaftar, memperbarui catatan, lalu menghapus", async () => {
      const { cookie } = await masukSebagai(l);
      expect((await simpan({ ...entri, catatan: "penting" }, cookie)).status).toBe(200);
      expect((await daftar(cookie)).koleksi).toEqual([
        { uri: entri.uri, sitasi: "UU 13/2003", judul: "Ketenagakerjaan", catatan: "penting", disimpan_pada: expect.any(String) },
      ]);

      await simpan({ ...entri, catatan: "diperbarui" }, cookie); // upsert, bukan duplikat
      const setelah = (await daftar(cookie)).koleksi;
      expect(setelah).toHaveLength(1);
      expect(setelah[0].catatan).toBe("diperbarui");

      const hapus = await panggil(l, `/api/koleksi?uri=${encodeURIComponent(entri.uri)}`, dengan(cookie, { method: "DELETE" }));
      expect(await hapus.json()).toEqual({ status: "dihapus" });
      expect((await daftar(cookie)).koleksi).toEqual([]);
    });

    it("uri atau judul kosong -> 400; DELETE tanpa uri -> 400", async () => {
      const { cookie } = await masukSebagai(l);
      for (const b of [{}, { uri: entri.uri }, { judul: "x" }, null]) {
        const res = await simpan(b, cookie);
        expect(res.status, JSON.stringify(b)).toBe(400);
        expect(await res.json()).toMatchObject({ error: "tidak_lengkap" });
      }
      const hapus = await panggil(l, "/api/koleksi", dengan(cookie, { method: "DELETE" }));
      expect(hapus.status).toBe(400);
    });

    it("koleksi terpisah per pengguna: tidak terlihat dan tidak terhapus oleh orang lain", async () => {
      const a = await masukSebagai(l, { id: "ua" });
      const b = await masukSebagai(l, { id: "ub" });
      await simpan({ ...entri, catatan: "milik A" }, a.cookie);
      expect((await daftar(b.cookie)).koleksi).toEqual([]);
      await panggil(l, `/api/koleksi?uri=${encodeURIComponent(entri.uri)}`, dengan(b.cookie, { method: "DELETE" }));
      expect((await daftar(a.cookie)).koleksi).toHaveLength(1);
    });

    it("satu pasal bisa disimpan sebagai entri tersendiri (alamat peraturan + #jangkar), terpisah dari peraturannya", async () => {
      const { cookie } = await masukSebagai(l);
      const pasal = { uri: `${entri.uri}#pasal-82`, sitasi: "UU 13/2003 Pasal 82", judul: "Ketenagakerjaan" };
      await simpan(entri, cookie);
      expect((await simpan({ ...pasal, catatan: "cuti melahirkan" }, cookie)).status).toBe(200);
      expect((await daftar(cookie)).koleksi.map((k) => k.uri).sort()).toEqual([entri.uri, pasal.uri].sort());

      // Catatan pasal diperbarui tanpa menyentuh entri peraturan.
      await simpan({ ...pasal, catatan: "lihat juga Pasal 83" }, cookie);
      const semua = (await daftar(cookie)).koleksi;
      expect(semua.find((k) => k.uri === pasal.uri)?.catatan).toBe("lihat juga Pasal 83");
      expect(semua.find((k) => k.uri === entri.uri)?.catatan).toBeNull();

      // Menghapus pasal (jangkar ikut di-encode di query) tidak menghapus peraturannya, dan sebaliknya.
      const hapus = await panggil(l, `/api/koleksi?uri=${encodeURIComponent(pasal.uri)}`, dengan(cookie, { method: "DELETE" }));
      expect(await hapus.json()).toEqual({ status: "dihapus" });
      expect((await daftar(cookie)).koleksi.map((k) => k.uri)).toEqual([entri.uri]);
    });

    it("penggabungan koleksi tamu membawa entri pasal apa adanya", async () => {
      const { cookie } = await masukSebagai(l);
      const lokal = [
        { uri: `${entri.uri}#pasal-156`, sitasi: "UU 13/2003 Pasal 156", judul: "Ketenagakerjaan", catatan: "pesangon" },
        { uri: `${entri.uri}#pasal-1~2`, sitasi: "UU 13/2003 Penjelasan Pasal 1", judul: "Ketenagakerjaan", catatan: null },
      ];
      const res = await panggil(l, "/api/koleksi/gabung", dengan(cookie, kirim("POST", { koleksi: lokal })));
      expect(await res.json()).toEqual({ status: "digabung", ditambahkan: 2 });
      expect((await daftar(cookie)).koleksi.map((k) => k.uri).sort()).toEqual(lokal.map((k) => k.uri).sort());
    });

    it("sitasi dan catatan boleh kosong; sitasi tersimpan sebagai teks kosong", async () => {
      const { cookie } = await masukSebagai(l);
      await simpan({ uri: entri.uri, judul: entri.judul }, cookie);
      expect((await daftar(cookie)).koleksi[0]).toMatchObject({ sitasi: "", catatan: null });
    });

    describe("POST /gabung (koleksi tamu dibawa saat masuk pertama kali)", () => {
      const gabung = (koleksi: unknown, cookie: string) => panggil(l, "/api/koleksi/gabung", dengan(cookie, kirim("POST", { koleksi })));

      it("menambahkan entri lokal ke akun", async () => {
        const { cookie } = await masukSebagai(l);
        const res = await gabung([entri, { uri: "/akn/id/act/uu/2020/11", sitasi: "UU 11/2020", judul: "Cipta Kerja", catatan: "dari tamu" }], cookie);
        expect(await res.json()).toEqual({ status: "digabung", ditambahkan: 2 });
        expect((await daftar(cookie)).koleksi.map((k) => k.uri).sort()).toEqual(["/akn/id/act/uu/2003/13", "/akn/id/act/uu/2020/11"]);
      });

      it("tidak menimpa catatan yang sudah ada di akun", async () => {
        const { cookie } = await masukSebagai(l);
        await simpan({ ...entri, catatan: "catatan akun" }, cookie);
        await gabung([{ ...entri, catatan: "catatan tamu" }], cookie);
        expect((await daftar(cookie)).koleksi[0].catatan).toBe("catatan akun");
      });

      it("mengisi catatan akun yang kosong dengan catatan tamu", async () => {
        const { cookie } = await masukSebagai(l);
        await simpan(entri, cookie);
        await gabung([{ ...entri, catatan: "catatan tamu" }], cookie);
        expect((await daftar(cookie)).koleksi[0].catatan).toBe("catatan tamu");
      });

      it("melewati entri tak lengkap dan membatasi 500 entri", async () => {
        const { cookie } = await masukSebagai(l);
        const banyak = Array.from({ length: 600 }, (_, i) => ({ uri: `/akn/id/act/uu/2000/${i}`, sitasi: `UU ${i}/2000`, judul: `Judul ${i}` }));
        await gabung([{ uri: "", judul: "tanpa uri" }, { uri: "/x" }, ...banyak], cookie);
        expect((await daftar(cookie)).koleksi).toHaveLength(498); // 500 dibaca, 2 di antaranya tak lengkap
      });

      it("daftar kosong -> 'kosong'", async () => {
        const { cookie } = await masukSebagai(l);
        expect(await (await gabung([], cookie)).json()).toEqual({ status: "kosong", ditambahkan: 0 });
      });
    });
  });
});
