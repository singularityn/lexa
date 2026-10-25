/**
 * Penyajian berkas dokumen dari R2.
 *
 * Tidak semua peraturan punya PDF: hanya yang sudah dipanen dari BPK yang membawa
 * berkasnya. Karena itu setiap endpoint di sini membedakan "tidak ada berkas" dari
 * "gagal mengambil", supaya antarmuka bisa menawarkan tautan ke naskah resmi
 * alih-alih menampilkan error.
 */

import { Hono } from "hono";
import { urlBpk } from "../lib/bpk";
import { bacaCakupan, klausaCakupan, type Cakupan } from "../../shared/cakupan";

type Bindings = Env;

export const dokumen = new Hono<{ Bindings: Bindings }>();

interface BarisBerkas {
  frbr_uri: string;
  jenis: string;
  nomor: string;
  tahun: number;
  judul: string;
  bpk_id: string | null;
  r2_pdf_key: string | null;
  r2_text_key: string | null;
}

/** Peraturan di luar cakupan (shared/cakupan.ts) diperlakukan seperti tidak ada: berkasnya pun tidak disajikan. */
async function ambilBaris(db: D1Database, uri: string, cakupan: Cakupan): Promise<BarisBerkas | null> {
  return db
    .prepare(
      `SELECT frbr_uri, jenis, nomor, tahun, judul, bpk_id, r2_pdf_key, r2_text_key
         FROM laws WHERE frbr_uri = ? AND ${klausaCakupan(cakupan, "jenis")}`,
    )
    .bind(uri)
    .first<BarisBerkas>();
}

/** Nama berkas yang enak dibaca saat diunduh, bukan kunci R2 mentah. */
function namaUnduhan(l: BarisBerkas): string {
  const bersih = `${l.jenis}-${l.nomor}-${l.tahun}`.replace(/[^A-Za-z0-9._-]/g, "");
  return `${bersih}.pdf`;
}

// ---------------------------------------------------------------------------
// GET /api/dokumen/status?uri= — apakah ada berkasnya, dan dari mana
// ---------------------------------------------------------------------------
dokumen.get("/status", async (c) => {
  const uri = c.req.query("uri");
  if (!uri) return c.json({ error: "uri_kosong", message: "Parameter `uri` wajib diisi." }, 400);

  const l = await ambilBaris(c.env.DB, uri, bacaCakupan(c.env.CAKUPAN_JENIS));
  if (!l) return c.json({ error: "tidak_ditemukan", message: `${uri} tidak ada di indeks.` }, 404);

  return c.json({
    uri: l.frbr_uri,
    ada_pdf: Boolean(l.r2_pdf_key),
    ada_teks: Boolean(l.r2_text_key),
    pdf_url: l.r2_pdf_key ? `/api/dokumen/pdf?uri=${encodeURIComponent(uri)}` : null,
    teks_url: l.r2_text_key ? `/api/dokumen/teks?uri=${encodeURIComponent(uri)}` : null,
    bpk_url: urlBpk(c.env.BPK_BASE, l.bpk_id),
  }, 200, { "Cache-Control": "public, max-age=300" });
});

// ---------------------------------------------------------------------------
// POST /api/dokumen/minta — { uri }: pembaca meminta PDF peraturan yang belum diarsipkan
//
// Panen PDF hanya bisa dilakukan dari peramban pengelola (BPK menolak alamat server), jadi yang bisa dilakukan pembaca adalah
// memberi tahu mana yang paling dibutuhkan. Permintaan dicatat (tabel `permintaan_pdf`, migrasi 0010) dan didahulukan di antrean
// panen. Satu alamat hanya dihitung sekali per peraturan per hari (permintaan ulang dijawab 200 tanpa menambah hitungan), dan
// paling banyak MAKS_MINTA_PER_JAM peraturan berbeda per jam, supaya antrean tak bisa dibanjiri.
// ---------------------------------------------------------------------------
const MAKS_MINTA_PER_JAM = 30;

dokumen.post("/minta", async (c) => {
  const body = await c.req.json<{ uri?: unknown }>().catch(() => null);
  const uri = typeof body?.uri === "string" ? body.uri : "";
  if (!uri) return c.json({ error: "uri_kosong", message: "Body harus memuat { uri }." }, 400);

  const l = await ambilBaris(c.env.DB, uri, bacaCakupan(c.env.CAKUPAN_JENIS));
  if (!l) return c.json({ error: "tidak_ditemukan", message: `${uri} tidak ada di indeks.` }, 404);
  if (l.r2_pdf_key) return c.json({ status: "sudah_ada", pdf_url: `/api/dokumen/pdf?uri=${encodeURIComponent(l.frbr_uri)}` });

  const ip = c.req.header("cf-connecting-ip") ?? "tanpa-ip";
  const kunciUri = `minta-pdf:${ip}:${l.frbr_uri}`;
  if (await c.env.CACHE.get(kunciUri)) return c.json({ status: "tercatat", ulang: true });
  const kunciJam = `minta-pdf-jam:${ip}`;
  const dalamJam = Number(await c.env.CACHE.get(kunciJam)) || 0;
  if (dalamJam >= MAKS_MINTA_PER_JAM) {
    return c.json({ error: "terlalu_sering", message: "Terlalu banyak permintaan dalam satu jam. Coba lagi nanti." }, 429);
  }

  await c.env.DB.prepare(
    `INSERT INTO permintaan_pdf (frbr_uri) VALUES (?)
     ON CONFLICT(frbr_uri) DO UPDATE SET jumlah = jumlah + 1, terakhir = datetime('now')`,
  ).bind(l.frbr_uri).run();
  await Promise.all([
    c.env.CACHE.put(kunciUri, "1", { expirationTtl: 86_400 }),
    c.env.CACHE.put(kunciJam, String(dalamJam + 1), { expirationTtl: 3_600 }),
  ]).catch(() => {});
  return c.json({ status: "tercatat" }, 201);
});

// ---------------------------------------------------------------------------
// GET /api/dokumen/pdf?uri= — sajikan PDF dari R2
// ---------------------------------------------------------------------------
dokumen.get("/pdf", async (c) => {
  const uri = c.req.query("uri");
  if (!uri) return c.json({ error: "uri_kosong", message: "Parameter `uri` wajib diisi." }, 400);

  const l = await ambilBaris(c.env.DB, uri, bacaCakupan(c.env.CAKUPAN_JENIS));
  if (!l) return c.json({ error: "tidak_ditemukan", message: `${uri} tidak ada di indeks.` }, 404);

  if (!l.r2_pdf_key) {
    // Bukan kesalahan: sebagian besar peraturan memang belum dipanen dari BPK.
    // Balasan menyertakan tautan resmi supaya klien punya jalan keluar.
    return c.json(
      {
        error: "pdf_belum_diarsipkan",
        message: "Berkas PDF peraturan ini belum diarsipkan di Lexa.",
        bpk_url: urlBpk(c.env.BPK_BASE, l.bpk_id),
      },
      404,
    );
  }

  // Penampil PDF meminta potongan byte, bukan seluruh berkas sekaligus.
  // Tanpa dukungan Range, dokumen besar harus diunduh utuh sebelum halaman
  // pertama tampil.
  const range = c.req.header("range");
  const objek = range
    ? await c.env.DOCS.get(l.r2_pdf_key, { range: c.req.raw.headers })
    : await c.env.DOCS.get(l.r2_pdf_key);

  if (!objek) {
    return c.json(
      { error: "berkas_hilang", message: "Kunci berkas tercatat tetapi objeknya tidak ada di R2." },
      502,
    );
  }

  const headers = new Headers();
  objek.writeHttpMetadata(headers);
  headers.set("Content-Type", "application/pdf");
  headers.set("Content-Disposition", `inline; filename="${namaUnduhan(l)}"`);
  headers.set("etag", objek.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  // Naskah resmi tidak pernah berubah setelah diundangkan.
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  // 206 hanya bila klien memang meminta potongan. R2 selalu mengisi `objek.range`
  // meski permintaannya utuh, jadi properti itu sendiri bukan penanda yang sah —
  // memakainya membuat setiap GET biasa dijawab 206 tanpa diminta.
  if (range && objek.range && "offset" in objek.range) {
    const mulai = objek.range.offset ?? 0;
    const panjang = objek.range.length ?? objek.size - mulai;
    headers.set("Content-Range", `bytes ${mulai}-${mulai + panjang - 1}/${objek.size}`);
    headers.set("Content-Length", String(panjang));
    return new Response(objek.body, { status: 206, headers });
  }

  headers.set("Content-Length", String(objek.size));
  return new Response(objek.body, { status: 200, headers });
});

// ---------------------------------------------------------------------------
// GET /api/dokumen/teks?uri= — teks hasil konversi, untuk pencarian dalam
// dokumen dan pembacaan tanpa PDF
// ---------------------------------------------------------------------------
dokumen.get("/teks", async (c) => {
  const uri = c.req.query("uri");
  if (!uri) return c.json({ error: "uri_kosong", message: "Parameter `uri` wajib diisi." }, 400);

  const l = await ambilBaris(c.env.DB, uri, bacaCakupan(c.env.CAKUPAN_JENIS));
  if (!l?.r2_text_key) {
    return c.json({ error: "teks_belum_ada", message: "Teks peraturan ini belum tersedia." }, 404);
  }

  const objek = await c.env.DOCS.get(l.r2_text_key);
  if (!objek) {
    return c.json({ error: "berkas_hilang", message: "Objek teks tidak ada di R2." }, 502);
  }

  return new Response(objek.body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
});
