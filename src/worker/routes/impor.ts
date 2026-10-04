/**
 * Jalur impor data hasil panen BPK.
 *
 * Worker tidak pernah menghubungi peraturan.bpk.go.id. Pengambilan dilakukan
 * dari sesi peramban pengguna (scripts/bpk-console-harvest.js), lalu hasilnya
 * dikirim ke sini. Endpoint di sini hanya menerima, memetakan, dan menyimpan.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { petakanDokumen, type Manifest } from "../lib/bpk";
import { tokenSah } from "../lib/auth";
import { pilihDalam } from "../lib/d1";
import { headerCors as corsUntuk } from "../lib/cors";
import type { PesanIngest } from "../lib/ingest";
import { bacaCakupan, dalamCakupan } from "../../shared/cakupan";

type Bindings = Env;

export const impor = new Hono<{ Bindings: Bindings }>();

/** Hanya origin BPK yang boleh mengirim; sisanya tetap bisa lewat curl/CLI. */
function headerCors(c: Context<{ Bindings: Bindings }>): Record<string, string> {
  return corsUntuk(c.req.header("origin"));
}

impor.options("/*", (c) => c.body(null, 204, headerCors(c)));

impor.use("/*", async (c, next) => {
  if (!tokenSah(c.req.header("x-admin-token"), c.env.ADMIN_TOKEN)) {
    return c.json(
      { error: "tidak_berwenang", message: "Header x-admin-token tidak valid." },
      401,
      headerCors(c),
    );
  }
  await next();
});

// ---------------------------------------------------------------------------
// POST /api/impor/manifest — metadata + relasi hasil panen
// ---------------------------------------------------------------------------
impor.post("/manifest", async (c) => {
  const body = await c.req.json<Manifest>().catch(() => null);
  if (!body?.dokumen?.length) {
    return c.json(
      { error: "manifest_kosong", message: "Body harus memuat { dokumen: [...] }." },
      400,
      headerCors(c),
    );
  }
  if (body.dokumen.length > 500) {
    return c.json(
      { error: "manifest_terlalu_besar", message: "Kirim maksimal 500 dokumen per permintaan." },
      413,
      headerCors(c),
    );
  }

  const cakupan = bacaCakupan(c.env.CAKUPAN_JENIS);
  const statements: D1PreparedStatement[] = [];
  const diterima: string[] = [];
  const ditolak: Array<{ bpk_id: string; alasan: string }> = [];

  for (const doc of body.dokumen) {
    const hasil = petakanDokumen(doc);
    if (!hasil) {
      ditolak.push({ bpk_id: doc.bpk_id, alasan: "metadata inti tidak lengkap" });
      continue;
    }
    const { law, relasi } = hasil;
    // Skrip panen tidak perlu tahu cakupan: ia mengirim apa adanya dan membaca `ditolak` untuk tahu mana yang
    // tak dipakai (dan tak perlu diunggah PDF-nya).
    if (!dalamCakupan(cakupan, law.jenis)) {
      ditolak.push({ bpk_id: doc.bpk_id, alasan: `di luar cakupan (${law.jenis}); cakupan: ${cakupan.join(", ")}` });
      continue;
    }

    statements.push(
      c.env.DB.prepare(
        `INSERT INTO laws (
           frbr_uri, jenis, nomor, tahun, judul, tentang, status,
           tanggal_penetapan, tanggal_berlaku, instansi, bidang,
           bpk_id, sumber_url, ringkasan, jumlah_pasal, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0, datetime('now'))
         ON CONFLICT(frbr_uri) DO UPDATE SET
           judul=excluded.judul,
           tentang=COALESCE(excluded.tentang, laws.tentang),
           status=excluded.status,
           tanggal_penetapan=COALESCE(excluded.tanggal_penetapan, laws.tanggal_penetapan),
           tanggal_berlaku=COALESCE(excluded.tanggal_berlaku, laws.tanggal_berlaku),
           instansi=COALESCE(excluded.instansi, laws.instansi),
           bidang=COALESCE(excluded.bidang, laws.bidang),
           -- bpk_id dari panen selalu menang: inilah satu-satunya sumber yang
           -- memilikinya, dan ia yang menghidupkan tautan ke naskah resmi.
           bpk_id=excluded.bpk_id,
           sumber_url=COALESCE(excluded.sumber_url, laws.sumber_url),
           ringkasan=COALESCE(laws.ringkasan, excluded.ringkasan),
           updated_at=datetime('now')`,
      ).bind(
        law.frbr_uri, law.jenis, law.nomor, law.tahun, law.judul, law.tentang,
        law.status, law.tanggal_penetapan, law.tanggal_berlaku, law.instansi,
        law.bidang, law.bpk_id, law.sumber_url, law.ringkasan,
      ),
    );

    for (const r of relasi) {
      statements.push(
        c.env.DB.prepare(
          `INSERT OR IGNORE INTO relations (from_uri, to_uri, jenis_relasi, keterangan)
           VALUES (?,?,?,?)`,
        ).bind(law.frbr_uri, r.to_uri, r.jenis_relasi, r.keterangan),
      );
    }

    diterima.push(law.frbr_uri);
  }

  if (statements.length) await c.env.DB.batch(statements);

  // Beri tahu pemanggil mana yang masih butuh PDF, supaya skrip panen tahu
  // dokumen mana yang perlu diunggah dan tidak mengirim ulang yang sudah ada.
  let butuhPdf: string[] = [];
  if (diterima.length) {
    // Sampai 500 dokumen per kiriman; D1 membatasi 100 parameter per kueri, jadi dipecah.
    const kosong = await pilihDalam<{ frbr_uri: string }>(
      c.env.DB,
      diterima,
      (t) => `SELECT frbr_uri FROM laws WHERE frbr_uri IN (${t}) AND jumlah_pasal = 0`,
    );
    butuhPdf = kosong.map((r) => r.frbr_uri);
  }

  await c.env.DB.prepare(
    `INSERT INTO sync_log (job, status, detail, jumlah) VALUES ('impor_bpk','sukses',?,?)`,
  ).bind(`ditolak ${ditolak.length}`, diterima.length).run().catch(() => {});

  return c.json(
    { diterima: diterima.length, ditolak, butuh_pdf: butuhPdf },
    200,
    headerCors(c),
  );
});

// ---------------------------------------------------------------------------
// PUT /api/impor/pdf?uri=<frbr_uri> — badan permintaan adalah berkas PDF
// ---------------------------------------------------------------------------
impor.put("/pdf", async (c) => {
  const uri = c.req.query("uri");
  if (!uri) {
    return c.json(
      { error: "uri_kosong", message: "Parameter `uri` wajib diisi." },
      400,
      headerCors(c),
    );
  }

  const law = await c.env.DB.prepare(`SELECT frbr_uri, jenis FROM laws WHERE frbr_uri = ?`)
    .bind(uri).first<{ frbr_uri: string; jenis: string }>();
  if (!law) {
    return c.json(
      { error: "tidak_dikenal", message: `Kirim manifest untuk ${uri} lebih dulu.` },
      409,
      headerCors(c),
    );
  }
  // Baris lama di luar cakupan masih ada di D1 (disembunyikan, bukan dihapus); PDF-nya tidak boleh menambah R2.
  const cakupan = bacaCakupan(c.env.CAKUPAN_JENIS);
  if (!dalamCakupan(cakupan, law.jenis)) {
    return c.json(
      { error: "di_luar_cakupan", message: `${uri} (${law.jenis}) di luar cakupan Lexa: ${cakupan.join(", ")}.` },
      422,
      headerCors(c),
    );
  }

  const isi = await c.req.arrayBuffer();
  if (isi.byteLength === 0) {
    return c.json({ error: "berkas_kosong", message: "Badan permintaan kosong." }, 400, headerCors(c));
  }

  // Tolak yang bukan PDF lebih awal; toMarkdown akan gagal dan memicu retry
  // yang sia-sia kalau isinya ternyata halaman HTML challenge.
  const kepala = new Uint8Array(isi.slice(0, 5));
  if (String.fromCharCode(...kepala) !== "%PDF-") {
    return c.json(
      {
        error: "bukan_pdf",
        message: "Isi bukan berkas PDF. Sesi BPK mungkin kedaluwarsa dan yang terunduh adalah halaman challenge.",
      },
      415,
      headerCors(c),
    );
  }

  const kunci = `pdf/${uri.replace(/^\//, "")}.pdf`;
  await c.env.DOCS.put(kunci, isi, {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: { frbr_uri: uri },
  });

  await c.env.DB.prepare(`UPDATE laws SET r2_pdf_key = ? WHERE frbr_uri = ?`)
    .bind(kunci, uri).run();

  const pesan: PesanIngest = { tipe: "ekstrak_pdf", frbr_uri: uri, r2_key: kunci };
  await c.env.INGEST_QUEUE.send(pesan);

  return c.json(
    { status: "diantrekan", uri, r2_key: kunci, ukuran: isi.byteLength },
    200,
    headerCors(c),
  );
});
