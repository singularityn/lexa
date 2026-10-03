/**
 * Penyajian berkas dokumen dari R2.
 *
 * Tidak semua peraturan punya PDF: hanya yang dipanen dari BPK yang membawa
 * berkasnya. Peraturan dari pasal.id sama sekali tidak punya. Karena itu setiap
 * endpoint di sini membedakan "tidak ada berkas" dari "gagal mengambil", supaya
 * antarmuka bisa menawarkan tautan ke naskah resmi alih-alih menampilkan error.
 */

import { Hono } from "hono";
import { urlBpk } from "../lib/pasal";

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

async function ambilBaris(db: D1Database, uri: string): Promise<BarisBerkas | null> {
  return db
    .prepare(
      `SELECT frbr_uri, jenis, nomor, tahun, judul, bpk_id, r2_pdf_key, r2_text_key
         FROM laws WHERE frbr_uri = ?`,
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

  const l = await ambilBaris(c.env.DB, uri);
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
// GET /api/dokumen/pdf?uri= — sajikan PDF dari R2
// ---------------------------------------------------------------------------
dokumen.get("/pdf", async (c) => {
  const uri = c.req.query("uri");
  if (!uri) return c.json({ error: "uri_kosong", message: "Parameter `uri` wajib diisi." }, 400);

  const l = await ambilBaris(c.env.DB, uri);
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

  const l = await ambilBaris(c.env.DB, uri);
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
