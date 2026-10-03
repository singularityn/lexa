/**
 * Koleksi tersinkron untuk pengguna yang masuk.
 *
 * Tamu tetap memakai penyimpanan peramban dan tidak pernah menyentuh endpoint
 * ini. Saat seseorang masuk untuk pertama kali, klien mengirim koleksi lokalnya
 * ke `/gabung` sehingga pekerjaan yang sudah terkumpul tidak hilang hanya
 * karena ia membuat akun.
 */

import { Hono } from "hono";
import { bacaSesi } from "../lib/sesi";

type Bindings = Env;

export const koleksi = new Hono<{ Bindings: Bindings }>();

interface EntriKoleksi {
  uri: string;
  sitasi: string;
  judul: string;
  catatan?: string;
  waktu?: number;
}

koleksi.get("/", async (c) => {
  const sesi = await bacaSesi(c.env.CACHE, c.req.header("cookie"));
  if (!sesi) return c.json({ masuk: false, koleksi: [] }, 200, { "Cache-Control": "no-store" });

  const { results } = await c.env.DB.prepare(
    `SELECT frbr_uri AS uri, sitasi, judul, catatan, disimpan_pada
       FROM koleksi WHERE pengguna_id = ? ORDER BY disimpan_pada DESC LIMIT 500`,
  ).bind(sesi.pengguna_id).all<Record<string, unknown>>();

  return c.json({ masuk: true, koleksi: results }, 200, { "Cache-Control": "no-store" });
});

koleksi.put("/", async (c) => {
  const sesi = await bacaSesi(c.env.CACHE, c.req.header("cookie"));
  if (!sesi) return c.json({ error: "belum_masuk", message: "Perlu masuk untuk menyimpan." }, 401);

  const e = await c.req.json<EntriKoleksi>().catch(() => null);
  if (!e?.uri || !e.judul) {
    return c.json({ error: "tidak_lengkap", message: "`uri` dan `judul` wajib diisi." }, 400);
  }

  await c.env.DB.prepare(
    `INSERT INTO koleksi (pengguna_id, frbr_uri, sitasi, judul, catatan)
     VALUES (?,?,?,?,?)
     ON CONFLICT(pengguna_id, frbr_uri) DO UPDATE SET
       catatan = excluded.catatan, sitasi = excluded.sitasi, judul = excluded.judul`,
  ).bind(sesi.pengguna_id, e.uri, e.sitasi ?? "", e.judul, e.catatan ?? null).run();

  return c.json({ status: "tersimpan" });
});

koleksi.delete("/", async (c) => {
  const sesi = await bacaSesi(c.env.CACHE, c.req.header("cookie"));
  if (!sesi) return c.json({ error: "belum_masuk", message: "Perlu masuk." }, 401);

  const uri = c.req.query("uri");
  if (!uri) return c.json({ error: "uri_kosong", message: "Parameter `uri` wajib." }, 400);

  await c.env.DB.prepare(`DELETE FROM koleksi WHERE pengguna_id = ? AND frbr_uri = ?`)
    .bind(sesi.pengguna_id, uri).run();

  return c.json({ status: "dihapus" });
});

/**
 * Gabungkan koleksi lokal ke akun saat pertama kali masuk.
 *
 * Penggabungan tidak pernah menimpa: bila sebuah peraturan sudah ada di akun,
 * catatan yang tersimpan di sana dipertahankan. Kehilangan catatan pribadi
 * karena login adalah kejutan yang tidak boleh terjadi.
 */
koleksi.post("/gabung", async (c) => {
  const sesi = await bacaSesi(c.env.CACHE, c.req.header("cookie"));
  if (!sesi) return c.json({ error: "belum_masuk", message: "Perlu masuk." }, 401);

  const body = await c.req.json<{ koleksi?: EntriKoleksi[] }>().catch(() => null);
  const masuk = (body?.koleksi ?? []).slice(0, 500);
  if (!masuk.length) return c.json({ status: "kosong", ditambahkan: 0 });

  await c.env.DB.batch(
    masuk
      .filter((e) => e.uri && e.judul)
      .map((e) =>
        c.env.DB.prepare(
          `INSERT INTO koleksi (pengguna_id, frbr_uri, sitasi, judul, catatan)
           VALUES (?,?,?,?,?)
           ON CONFLICT(pengguna_id, frbr_uri) DO UPDATE SET
             catatan = COALESCE(koleksi.catatan, excluded.catatan)`,
        ).bind(sesi.pengguna_id, e.uri, e.sitasi ?? "", e.judul, e.catatan ?? null),
      ),
  );

  return c.json({ status: "digabung", ditambahkan: masuk.length });
});
