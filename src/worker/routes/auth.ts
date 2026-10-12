/**
 * Masuk dengan Google, dengan mode tamu tetap sebagai jalur utama.
 *
 * Aplikasi ini berfungsi penuh tanpa akun — pencarian, membaca naskah, koleksi
 * lokal, semuanya. Akun hanya menambah satu hal yang tidak bisa dilakukan
 * penyimpanan peramban: melanjutkan pekerjaan di perangkat lain. Karena itu
 * seluruh endpoint di sini boleh gagal tanpa merusak apa pun; bila
 * `GOOGLE_CLIENT_ID` belum dipasang, aplikasi tetap jalan sebagai tamu.
 */

import { Hono } from "hono";
import {
  idSesiBaru, simpanSesi, hapusSesi, bacaSesi, idSesiDariCookie,
  cookieSesi, cookieHapus, tujuanAman,
} from "../lib/sesi";
import { uriCallback } from "../lib/google";

type Bindings = Env;

export const auth = new Hono<{ Bindings: Bindings }>();

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS = "https://www.googleapis.com/oauth2/v3/certs";

function terkonfigurasi(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function asalAman(url: string): boolean {
  return new URL(url).protocol === "https:";
}

// ---------------------------------------------------------------------------
// GET /api/auth/status — siapa yang sedang masuk, dan apakah login tersedia
// ---------------------------------------------------------------------------
auth.get("/status", async (c) => {
  const sesi = await bacaSesi(c.env.CACHE, c.req.header("cookie"));
  const tersedia = terkonfigurasi(c.env);
  return c.json({
    masuk: Boolean(sesi),
    login_tersedia: tersedia,
    // Alamat yang harus terdaftar PERSIS di Google Cloud Console (lib/google.ts); halaman Akun menampilkannya untuk
    // pengelola yang menemui "redirect_uri_mismatch". Bukan rahasia: Google menampilkannya juga pada setiap alur masuk.
    redirect_uri: tersedia ? uriCallback(c.req.url) : null,
    pengguna: sesi
      ? { id: sesi.pengguna_id, email: sesi.email, nama: sesi.nama, foto_url: sesi.foto_url }
      : null,
  }, 200, { "Cache-Control": "no-store" });
});

// ---------------------------------------------------------------------------
// GET /api/auth/google — mulai alur OAuth
// ---------------------------------------------------------------------------
auth.get("/google", async (c) => {
  if (!terkonfigurasi(c.env)) {
    return c.json(
      {
        error: "belum_dikonfigurasi",
        message:
          "Login Google belum diaktifkan. Pasang GOOGLE_CLIENT_ID dan " +
          "GOOGLE_CLIENT_SECRET, lalu coba lagi. Mode tamu tetap bisa dipakai.",
      },
      503,
    );
  }

  // `state` mengikat permintaan ini dengan callback-nya. Tanpa itu, penyerang
  // bisa memancing korban menyelesaikan alur OAuth milik akun penyerang.
  const state = idSesiBaru();
  const kembaliKe = tujuanAman(c.req.query("kembali"));

  await c.env.CACHE.put(
    `oauth:${state}`,
    JSON.stringify({ kembaliKe }),
    { expirationTtl: 600 },
  );

  const url = new URL(GOOGLE_AUTH);
  url.searchParams.set("client_id", c.env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", uriCallback(c.req.url));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  // Hanya meminta yang benar-benar dipakai: identitas. Tidak ada akses ke
  // Gmail, Drive, atau apa pun milik pengguna.
  url.searchParams.set("prompt", "select_account");

  return c.redirect(url.toString(), 302);
});

/** Verifikasi tanda tangan ID token terhadap kunci publik Google. */
async function verifikasiIdToken(idToken: string, clientId: string): Promise<{
  sub: string; email: string; name?: string; picture?: string;
} | null> {
  const [kepalaB64, muatanB64, tandaB64] = idToken.split(".");
  if (!kepalaB64 || !muatanB64 || !tandaB64) return null;

  const b64url = (s: string) =>
    Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (ch) => ch.charCodeAt(0));

  const kepala = JSON.parse(new TextDecoder().decode(b64url(kepalaB64))) as { kid: string; alg: string };
  const muatan = JSON.parse(new TextDecoder().decode(b64url(muatanB64))) as {
    sub: string; email: string; email_verified?: boolean; name?: string;
    picture?: string; aud: string; iss: string; exp: number;
  };

  // Klaim diperiksa sebelum kriptografi: pemeriksaan murah lebih dulu.
  if (muatan.aud !== clientId) return null;
  if (!["accounts.google.com", "https://accounts.google.com"].includes(muatan.iss)) return null;
  if (muatan.exp * 1000 < Date.now()) return null;
  if (muatan.email_verified === false) return null;

  const jwks = (await (await fetch(GOOGLE_JWKS)).json()) as { keys: JsonWebKey[] & { kid?: string }[] };
  const jwk = jwks.keys.find((k) => (k as { kid?: string }).kid === kepala.kid);
  if (!jwk) return null;

  const kunci = await crypto.subtle.importKey(
    "jwk", jwk as JsonWebKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["verify"],
  );

  const sah = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    kunci,
    b64url(tandaB64),
    new TextEncoder().encode(`${kepalaB64}.${muatanB64}`),
  );
  if (!sah) return null;

  return { sub: muatan.sub, email: muatan.email, name: muatan.name, picture: muatan.picture };
}

// ---------------------------------------------------------------------------
// GET /api/auth/google/callback
// ---------------------------------------------------------------------------
auth.get("/google/callback", async (c) => {
  const kode = c.req.query("code");
  const state = c.req.query("state");
  const aman = asalAman(c.req.url);

  // Google mengembalikan peramban ke sini dengan `error` bila pengguna membatalkan atau menolak (access_denied) atau
  // ada galat lain. "redirect_uri_mismatch" TIDAK sampai di sini: Google menampilkannya sendiri dan tak mengalihkan.
  const galatGoogle = c.req.query("error");
  if (galatGoogle) {
    if (state) await c.env.CACHE.delete(`oauth:${state}`).catch(() => {});
    return c.redirect(`/akun?galat=${galatGoogle === "access_denied" ? "ditolak" : "google"}`, 302);
  }

  if (!kode || !state) return c.redirect("/akun?galat=parameter", 302);

  const tersimpan = await c.env.CACHE.get<{ kembaliKe: string }>(`oauth:${state}`, "json");
  if (!tersimpan) return c.redirect("/akun?galat=state", 302);
  await c.env.CACHE.delete(`oauth:${state}`);

  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: kode,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: uriCallback(c.req.url),
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) return c.redirect("/akun?galat=token", 302);
  const token = (await res.json()) as { id_token?: string };
  if (!token.id_token) return c.redirect("/akun?galat=token", 302);

  const profil = await verifikasiIdToken(token.id_token, c.env.GOOGLE_CLIENT_ID);
  if (!profil) return c.redirect("/akun?galat=verifikasi", 302);

  await c.env.DB.prepare(
    `INSERT INTO pengguna (id, email, nama, foto_url, terakhir_masuk)
     VALUES (?,?,?,?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       nama = COALESCE(excluded.nama, pengguna.nama),
       foto_url = COALESCE(excluded.foto_url, pengguna.foto_url),
       terakhir_masuk = datetime('now')`,
  ).bind(profil.sub, profil.email, profil.name ?? null, profil.picture ?? null).run();

  const idSesi = idSesiBaru();
  await simpanSesi(c.env.CACHE, idSesi, {
    pengguna_id: profil.sub,
    email: profil.email,
    nama: profil.name ?? null,
    foto_url: profil.picture ?? null,
    dibuat: Date.now(),
  });

  const tujuan = tujuanAman(tersimpan.kembaliKe);
  return new Response(null, {
    status: 302,
    headers: { Location: tujuan, "Set-Cookie": cookieSesi(idSesi, aman) },
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/auth/profil — ubah nama tampilan dan foto
// ---------------------------------------------------------------------------
auth.patch("/profil", async (c) => {
  const idSesi = idSesiDariCookie(c.req.header("cookie"));
  const sesi = await bacaSesi(c.env.CACHE, c.req.header("cookie"));
  if (!sesi || !idSesi) {
    return c.json({ error: "belum_masuk", message: "Perlu masuk untuk mengubah profil." }, 401);
  }

  const body = await c.req.json<{ nama?: string; foto_url?: string | null }>().catch(() => null);
  if (!body) return c.json({ error: "tidak_sah", message: "Body tidak terbaca." }, 400);

  const nama = body.nama?.trim().slice(0, 80);
  if (nama !== undefined && nama.length === 0) {
    return c.json({ error: "nama_kosong", message: "Nama tidak boleh kosong." }, 400);
  }

  // URL foto harus http(s). Menerima `javascript:` atau `data:` di sini berarti
  // menyimpan muatan yang akan dirender sebagai src gambar bagi pengguna lain
  // kelak — ditolak sejak awal, bukan disaring saat ditampilkan.
  let foto: string | null | undefined = body.foto_url;
  if (typeof foto === "string" && foto.trim()) {
    try {
      const u = new URL(foto.trim());
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("skema");
      foto = u.toString().slice(0, 500);
    } catch {
      return c.json(
        { error: "foto_tidak_sah", message: "URL foto harus berupa tautan http atau https." },
        400,
      );
    }
  } else if (foto === "" || foto === null) {
    foto = null;
  }

  await c.env.DB.prepare(
    `UPDATE pengguna
        SET nama = COALESCE(?, nama),
            foto_url = CASE WHEN ? THEN ? ELSE foto_url END
      WHERE id = ?`,
  ).bind(nama ?? null, foto !== undefined ? 1 : 0, foto ?? null, sesi.pengguna_id).run();

  const baru = await c.env.DB.prepare(
    `SELECT nama, foto_url FROM pengguna WHERE id = ?`,
  ).bind(sesi.pengguna_id).first<{ nama: string | null; foto_url: string | null }>();

  // Sesi di KV ikut diperbarui; kalau tidak, nama lama akan terus tampil
  // sampai sesi kedaluwarsa 30 hari kemudian.
  await simpanSesi(c.env.CACHE, idSesi, {
    ...sesi,
    nama: baru?.nama ?? sesi.nama,
    foto_url: baru?.foto_url ?? null,
  });

  return c.json({
    status: "tersimpan",
    pengguna: {
      id: sesi.pengguna_id,
      email: sesi.email,
      nama: baru?.nama ?? null,
      foto_url: baru?.foto_url ?? null,
    },
  }, 200, { "Cache-Control": "no-store" });
});

// ---------------------------------------------------------------------------
// POST /api/auth/keluar
// ---------------------------------------------------------------------------
auth.post("/keluar", async (c) => {
  const id = idSesiDariCookie(c.req.header("cookie"));
  if (id) await hapusSesi(c.env.CACHE, id);
  return c.json({ status: "keluar" }, 200, {
    "Set-Cookie": cookieHapus(asalAman(c.req.url)),
  });
});
