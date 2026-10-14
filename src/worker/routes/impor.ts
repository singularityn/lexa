/**
 * Jalur impor data hasil panen BPK.
 *
 * Worker tidak pernah menghubungi peraturan.bpk.go.id. Pengambilan dilakukan
 * dari sesi peramban pengguna (scripts/bpk-console-harvest.js), lalu hasilnya
 * dikirim ke sini. Endpoint di sini hanya menerima, memetakan, dan menyimpan:
 *
 *   GET  /butuh-teks     daftar kerja: peraturan yang masih perlu PDF-nya
 *   GET  /ringkasan      kemajuan per jenis: bertaut ke BPK, ber-PDF, berpasal
 *   POST /tautan         entri daftar BPK -> peraturan Lexa (bpk_id dan alamat rincian)
 *   POST /manifest       metadata dan relasi dari halaman rincian BPK
 *   PUT  /pdf            berkas PDF sebuah peraturan; diantrekan untuk diekstrak menjadi pasal
 *   POST /tanpa-berkas   tandai peraturan yang di BPK memang tak berkas PDF (tak diminta lagi)
 *   POST /ekstrak-ulang  antrekan ulang ekstraksi PDF yang sudah tersimpan: yang belum menghasilkan pasal, atau (`usang`) yang
 *                        diurai dengan versi pengurai lama
 *   POST /ringkas        antrekan ringkasan AI untuk peraturan yang sudah berteks tetapi belum beringkasan
 *   GET  /gemini-cek     uji kunci, model, dan alamat Gemini (secret GEMINI_API) dengan satu permintaan kecil
 *   POST /gemini-uji     percobaan kering: Gemini membaca PDF satu peraturan dan Lexa melaporkan apa yang akan terjadi
 *                        (tak menulis pasal); lalu ekstrak-ulang `gemini` untuk membaca sungguhan di latar belakang
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { petakanDokumen, VERSI_PARSER, type DokumenBpk, type Manifest } from "../lib/bpk";
import { tokenSah } from "../lib/auth";
import { batchBerkelompok, pilihDalam } from "../lib/d1";
import { headerCors as corsUntuk } from "../lib/cors";
import { bacaKonfigGemini, catatPemakaian, GalatGemini, pemakaianHariIni, pingGemini } from "../lib/gemini";
import { statusOtomatis } from "../lib/geminiOtomatis";
import { buatKonteksIngest, ujiGemini, type PesanIngest } from "../lib/ingest";
import { kunciSitasi, samaSitasi } from "../lib/nomor";
import { cariSitasi, pilihUtama, tautkanBpk, type TautanMasuk } from "../lib/tautanBpk";
import { sqlPrioritas } from "../lib/prioritas";
import { bacaCakupan, dalamCakupan, klausaCakupan } from "../../shared/cakupan";

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

/**
 * Penanda "di BPK tak ada berkas PDF-nya" disimpan di sync_state (tanpa migrasi): peraturan Perppu dan PP tahun
 * 1940-an sampai 1960-an banyak yang di BPK hanya berupa metadata. Tanpa penanda, tiap putaran panen mengulang
 * peraturan yang sama di urutan terdepan dan kehabisan jatahnya di sana.
 */
const AWALAN_TANPA_BERKAS = "bpk_tanpa_berkas:";
const kunciTanpaBerkas = (uri: string) => `${AWALAN_TANPA_BERKAS}${uri}`;
/** Rentang kunci untuk penanda di atas; memakai indeks kunci utama, bukan LIKE. */
const RENTANG_TANPA_BERKAS = [AWALAN_TANPA_BERKAS, "bpk_tanpa_berkas;"] as const;

async function hitungTanpaBerkas(db: D1Database): Promise<number> {
  const r = await db
    .prepare(`SELECT COUNT(*) AS n FROM sync_state WHERE key >= ? AND key < ?`)
    .bind(...RENTANG_TANPA_BERKAS)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

// ---------------------------------------------------------------------------
// GET /api/impor/butuh-teks — peraturan yang masih perlu teksnya, untuk skrip panen BPK
//
// Satu-satunya sumber teks peraturan adalah PDF resmi BPK, jadi teks UUD, Tap MPR, UU, Perppu, dan PP yang belum ada
// datang dari sana. Skrip panen (scripts/bpk-console-harvest.js) bertanya di sini peraturan
// mana yang perlu PDF-nya, mengambilnya dari sesi peramban pemiliknya di situs BPK, lalu mengunggahnya lewat PUT /pdf.
//   ?jenis=UU,PP   saring jenis (bawaan: seluruh cakupan)
//   ?batas=50      paling banyak berapa (1-200, bawaan 50)
//   ?celah=1       sertakan juga peraturan yang teksnya sebagian (nomor pasalnya bercelah)
//   ?lama=1        sertakan juga peraturan berpasal dari teks lama (sumber yang sudah dihentikan), supaya naskah BPK
//                  menggantikannya; didahulukan yang belum punya teks sama sekali
//   ?semua=1       sertakan juga yang sudah ditandai "tanpa berkas" di BPK (untuk memeriksa ulang)
// Yang sudah diunggah PDF-nya (r2_pdf_key) tak muncul lagi, jadi pemanggilan berikutnya mengembalikan yang baru.
// ---------------------------------------------------------------------------
impor.get("/butuh-teks", async (c) => {
  const cakupan = bacaCakupan(c.env.CAKUPAN_JENIS);
  const diminta = (c.req.query("jenis") ?? "").split(",").map((j) => j.trim().toUpperCase()).filter(Boolean);
  const jenis = diminta.length ? cakupan.filter((j) => diminta.includes(j)) : cakupan;
  // Bilangan pecahan dibulatkan ke bawah: LIMIT menolak "7.9" ("datatype mismatch").
  const batas = Math.min(Math.max(Math.floor(Number(c.req.query("batas"))) || 50, 1), 200);
  const denganCelah = c.req.query("celah") === "1";
  const denganLama = c.req.query("lama") === "1";
  const semua = c.req.query("semua") === "1";
  if (!jenis.length) {
    return c.json({ error: "di_luar_cakupan", message: `Jenis di luar cakupan Lexa: ${cakupan.join(", ")}.`, cakupan }, 400, headerCors(c));
  }

  const dalam = klausaCakupan(jenis, "l.jenis");
  // Tanpa teks sama sekali, atau (bila diminta) yang teksnya sebagian, dengan nomor pasal bercelah (`celah`), atau yang
  // berpasal dari teks lama sumber yang sudah dihentikan, bukan dari BPK (`lama`): naskah BPK akan menggantikannya bila cukup
  // utuh. Yang PDF-nya sudah diunggah tak diulang.
  const kondisi = `(${[
    "l.jumlah_pasal = 0",
    ...(denganCelah
      ? [`l.frbr_uri IN (
         SELECT a.frbr_uri FROM articles a WHERE a.nomor_pasal GLOB '[0-9]*'
          GROUP BY a.frbr_uri HAVING MAX(CAST(a.nomor_pasal AS INTEGER)) - COUNT(DISTINCT a.nomor_pasal) >= 2)`]
      : []),
    ...(denganLama ? ["(l.jumlah_pasal > 0 AND (l.r2_text_key IS NULL OR l.r2_text_key NOT LIKE '%.md'))"] : []),
  ].join(" OR ")})`;
  const tanpaTanda = semua ? "" : `AND NOT EXISTS (SELECT 1 FROM sync_state s WHERE s.key = '${AWALAN_TANPA_BERKAS}' || l.frbr_uri)`;
  const dasar = `FROM laws l WHERE ${dalam} AND ${kondisi} AND l.r2_pdf_key IS NULL ${tanpaTanda}`;

  const { results } = await c.env.DB.prepare(
    `SELECT l.frbr_uri, l.jenis, l.nomor, l.tahun, l.judul, l.bpk_id, l.sumber_url, l.jumlah_pasal, l.isi_status
       ${dasar}
      ORDER BY (CASE WHEN l.jumlah_pasal > 0 THEN 1 ELSE 0 END), (CASE WHEN l.bpk_id IS NOT NULL AND l.bpk_id <> '' THEN 0 ELSE 1 END),
               ${sqlPrioritas("l.")}, l.frbr_uri
      LIMIT ?`,
  ).bind(batas).all<{
    frbr_uri: string; jenis: string; nomor: string; tahun: number; judul: string; bpk_id: string | null;
    sumber_url: string | null; jumlah_pasal: number; isi_status: string;
  }>();
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n ${dasar}`).first<{ n: number }>();
  const tanpaBpk = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n ${dasar} AND (l.bpk_id IS NULL OR l.bpk_id = '') AND (l.sumber_url IS NULL OR l.sumber_url NOT LIKE '%bpk.go.id%')`,
  ).first<{ n: number }>();

  const bpk = c.env.BPK_BASE.replace(/\/$/, "");
  const daftar = results.map((r) => {
    const sumberBpk = r.sumber_url && /^https:\/\/(www\.)?peraturan\.bpk\.go\.id\//i.test(r.sumber_url) ? r.sumber_url : null;
    return {
      frbr_uri: r.frbr_uri, jenis: r.jenis, nomor: r.nomor, tahun: r.tahun, judul: r.judul, jumlah_pasal: r.jumlah_pasal,
      isi_status: r.isi_status, bpk_id: r.bpk_id || null,
      // Alamat halaman rincian di BPK: tautan sumber bila memang BPK (memuat slug), selain itu dari bpk_id; null bila tak ada.
      detail_url: sumberBpk ?? (r.bpk_id ? `${bpk}/Details/${r.bpk_id}` : null),
    };
  });
  return c.json(
    { cakupan: jenis, total: total?.n ?? 0, tanpa_bpk: tanpaBpk?.n ?? 0, tanpa_berkas: await hitungTanpaBerkas(c.env.DB), daftar },
    200,
    headerCors(c),
  );
});

// ---------------------------------------------------------------------------
// GET /api/impor/ringkasan — kemajuan panen per jenis
// ---------------------------------------------------------------------------
impor.get("/ringkasan", async (c) => {
  const cakupan = bacaCakupan(c.env.CAKUPAN_JENIS);
  const { results } = await c.env.DB.prepare(
    `SELECT jenis, COUNT(*) AS total,
            SUM(CASE WHEN bpk_id IS NOT NULL AND bpk_id <> '' THEN 1 ELSE 0 END) AS bertaut_bpk,
            SUM(CASE WHEN r2_pdf_key IS NOT NULL THEN 1 ELSE 0 END) AS ber_pdf,
            SUM(CASE WHEN jumlah_pasal > 0 THEN 1 ELSE 0 END) AS berpasal,
            SUM(CASE WHEN jumlah_pasal = 0 AND r2_pdf_key IS NOT NULL THEN 1 ELSE 0 END) AS pdf_belum_berpasal,
            SUM(CASE WHEN jumlah_pasal = 0 AND r2_pdf_key IS NULL THEN 1 ELSE 0 END) AS perlu_pdf
       FROM laws WHERE ${klausaCakupan(cakupan, "jenis")} GROUP BY jenis`,
  ).all();
  return c.json({ cakupan, per_jenis: results, tanpa_berkas: await hitungTanpaBerkas(c.env.DB), gemini: await ringkasanGemini(c.env) }, 200, headerCors(c));
});

/**
 * Keadaan jalur Gemini: terpasang atau tidak, anggaran hari ini, hasil percobaan sejauh ini, berapa calon yang belum dicoba
 * (vonis bawaan: tanpa_pasal, berat, gagal), dan pengaturan Gemini otomatis. Tabel belum ada (migrasi 0008) = tanpa hitungan.
 */
async function ringkasanGemini(env: Env) {
  const k = bacaKonfigGemini(env);
  const pembacaan = await env.DB.prepare(`SELECT hasil, COUNT(*) AS n FROM pembacaan_ai GROUP BY hasil`)
    .all<{ hasil: string; n: number }>()
    .then((r) => Object.fromEntries(r.results.map((x) => [x.hasil, x.n])))
    .catch(() => null);
  const calon = pembacaan
    ? await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM laws l JOIN ekstraksi_log e ON e.frbr_uri = l.frbr_uri
          WHERE ${klausaCakupan(bacaCakupan(env.CAKUPAN_JENIS), "l.jenis")} AND l.r2_pdf_key IS NOT NULL
            AND e.vonis IN (${VONIS_GEMINI_BAWAAN.map((v) => `'${v}'`).join(",")})
            AND NOT EXISTS (SELECT 1 FROM pembacaan_ai p WHERE p.frbr_uri = l.frbr_uri AND p.hasil <> 'uji')`,
      )
        .first<{ n: number }>()
        .then((r) => r?.n ?? 0)
        .catch(() => null)
    : null;
  return {
    terpasang: k !== null,
    model: k?.model ?? null,
    anggaran: k ? { terpakai: await pemakaianHariIni(env.CACHE), batas: k.anggaranHarian } : null,
    pembacaan,
    calon_belum_dicoba: calon,
    otomatis: await statusOtomatis(env),
  };
}

// ---------------------------------------------------------------------------
// POST /api/impor/tautan — entri daftar BPK -> peraturan Lexa
//
// Dikirim skrip panen sambil menjelajahi daftar peraturan di situs BPK (mode `jelajah`): tiap entri dikenali sitasinya,
// dicocokkan dengan peraturan Lexa, dan bpk_id serta alamat rinciannya disimpan. Hanya itu yang berubah; metadata lain
// tetap. Badan: { tautan: [...], buat?: boolean } (maksimal 200 entri; `buat` membuat baris untuk peraturan dalam
// cakupan yang dikenali tetapi belum ada di Lexa). Jawabannya memuat status tiap entri.
// ---------------------------------------------------------------------------
const MAKS_TAUTAN = 200;

impor.post("/tautan", async (c) => {
  const body = await c.req.json<{ tautan?: TautanMasuk[]; buat?: boolean }>().catch(() => null);
  if (!Array.isArray(body?.tautan) || !body.tautan.length) {
    return c.json({ error: "tautan_kosong", message: "Body harus memuat { tautan: [...] }." }, 400, headerCors(c));
  }
  if (body.tautan.length > MAKS_TAUTAN) {
    return c.json({ error: "tautan_terlalu_banyak", message: `Kirim maksimal ${MAKS_TAUTAN} entri per permintaan.` }, 413, headerCors(c));
  }

  const { ringkas, hasil } = await tautkanBpk(c.env.DB, body.tautan, {
    base: c.env.BPK_BASE,
    cakupan: bacaCakupan(c.env.CAKUPAN_JENIS),
    buat: body.buat === true,
  });

  const rincian = Object.entries(ringkas).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(", ");
  await c.env.DB.prepare(`INSERT INTO sync_log (job, status, detail, jumlah) VALUES ('impor_bpk_tautan','sukses',?,?)`)
    .bind(rincian || "kosong", ringkas.ditautkan + ringkas.dibuat).run().catch(() => {});

  return c.json({ ringkas, hasil }, 200, headerCors(c));
});

// ---------------------------------------------------------------------------
// POST /api/impor/manifest — metadata + relasi hasil panen
//
// Dokumen dicocokkan dengan baris yang sudah ada menurut SITASI (jenis, nomor, tahun yang dinormalkan), bukan menurut
// frbr_uri turunan: baris yang sudah ada menulis "perpu" dan "perppu", "01" dan "1", "xvi-mpr-1998" bagi Tap MPR XVI/MPR/1998, dan
// indeks unik laws(jenis, nomor, tahun) membuat INSERT dengan URI turunan yang berbeda menggagalkan SELURUH kiriman.
// Dokumen yang sitasinya sudah ada memperbarui barisnya; yang belum ada dibuat baru. Dokumen yang menyimpan gagal
// dilaporkan di `ditolak`, tidak menjatuhkan yang lain.
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

  const db = c.env.DB;
  const cakupan = bacaCakupan(c.env.CAKUPAN_JENIS);
  const ditolak: Array<{ bpk_id: string; alasan: string }> = [];
  const dipetakan: Array<{ doc: DokumenBpk } & NonNullable<ReturnType<typeof petakanDokumen>>> = [];

  for (const doc of body.dokumen) {
    // Larik JSON dari peramban bisa memuat apa saja; yang bukan objek ditolak, tak menjatuhkan kiriman.
    if (!doc || typeof doc !== "object") {
      ditolak.push({ bpk_id: "", alasan: "entri bukan objek" });
      continue;
    }
    const hasil = petakanDokumen(doc);
    if (!hasil) {
      ditolak.push({ bpk_id: doc.bpk_id, alasan: "metadata inti tidak lengkap" });
      continue;
    }
    // Skrip panen tidak perlu tahu cakupan: ia mengirim apa adanya dan membaca `ditolak` untuk tahu mana yang
    // tak dipakai (dan tak perlu diunggah PDF-nya).
    if (!dalamCakupan(cakupan, hasil.law.jenis)) {
      ditolak.push({ bpk_id: doc.bpk_id, alasan: `di luar cakupan (${hasil.law.jenis}); cakupan: ${cakupan.join(", ")}` });
      continue;
    }
    dipetakan.push({ doc, ...hasil });
  }

  // Baris yang sudah ada untuk tiap dokumen (menurut sitasi), baris yang dituju lewat lexa_uri, dan baris tujuan relasi.
  const sudahAda = await cariSitasi(db, dipetakan.map((d) => d.law));
  const uriTerikat = [...new Set(dipetakan.flatMap((d) => (typeof d.doc.lexa_uri === "string" ? [d.doc.lexa_uri] : [])))];
  const terikat = new Map<string, { frbr_uri: string; jenis: string; nomor: string; tahun: number }>();
  if (uriTerikat.length) {
    for (const b of await pilihDalam<{ frbr_uri: string; jenis: string; nomor: string; tahun: number }>(
      db, uriTerikat, (t) => `SELECT frbr_uri, jenis, nomor, tahun FROM laws WHERE frbr_uri IN (${t})`,
    )) terikat.set(b.frbr_uri, b);
  }
  const sasaranRelasi = new Map<string, { jenis: string; nomor: string; tahun: number }>();
  for (const d of dipetakan) for (const r of d.relasi) sasaranRelasi.set(`${r.sasaran.jenis}|${r.sasaran.nomor}|${r.sasaran.tahun}`, r.sasaran);
  const daftarSasaran = [...sasaranRelasi.values()];
  const barisSasaran = await cariSitasi(db, daftarSasaran);
  /** URI tujuan relasi menurut data Lexa (bila peraturannya ada); kalau tidak, URI turunan. */
  const uriSasaran = new Map(daftarSasaran.map((s, i) => [`${s.jenis}|${s.nomor}|${s.tahun}`, pilihUtama(barisSasaran[i])?.frbr_uri]));

  const kelompok: Array<{ id: string; pernyataan: D1PreparedStatement[] }> = [];
  const target: string[] = [];
  const bpkIdPer: string[] = [];
  dipetakan.forEach((d, i) => {
    const { doc, law, relasi } = d;
    let uri: string;
    if (typeof doc.lexa_uri === "string") {
      const b = terikat.get(doc.lexa_uri);
      if (!b) {
        ditolak.push({ bpk_id: doc.bpk_id, alasan: `${doc.lexa_uri} tidak ada di Lexa` });
        return;
      }
      if (!samaSitasi(kunciSitasi(law.jenis, law.nomor, law.tahun), kunciSitasi(b.jenis, b.nomor, b.tahun))) {
        ditolak.push({ bpk_id: doc.bpk_id, alasan: `sitasi dokumen (${law.jenis} ${law.nomor}/${law.tahun}) tidak cocok dengan ${doc.lexa_uri}` });
        return;
      }
      uri = b.frbr_uri;
    } else {
      uri = pilihUtama(sudahAda[i], law.frbr_uri)?.frbr_uri ?? law.frbr_uri;
    }

    const pernyataan: D1PreparedStatement[] = [
      db.prepare(
        `INSERT INTO laws (
           frbr_uri, jenis, nomor, tahun, judul, tentang, status,
           tanggal_penetapan, tanggal_berlaku, instansi, bidang,
           bpk_id, sumber_url, ringkasan, jumlah_pasal, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0, datetime('now'))
         ON CONFLICT(frbr_uri) DO UPDATE SET
           -- Judul BPK menggantikan yang lama, kecuali bila yang lama memuat pokok ("... tentang ...") dan yang baru
           -- tidak: judul tanpa pokok lebih buruk untuk pencarian daripada judul bersampah dengan pokok.
           judul=CASE WHEN excluded.judul LIKE '% tentang %' OR laws.judul NOT LIKE '% tentang %' THEN excluded.judul ELSE laws.judul END,
           tentang=COALESCE(excluded.tentang, laws.tentang),
           -- Halaman yang tak menyebut Status (susunan berubah, galat baca) tidak boleh menjadikan semuanya "berlaku".
           status=CASE WHEN ? = 1 THEN excluded.status ELSE laws.status END,
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
        uri, law.jenis, law.nomor, law.tahun, law.judul, law.tentang,
        law.status, law.tanggal_penetapan, law.tanggal_berlaku, law.instansi,
        law.bidang, law.bpk_id, law.sumber_url, law.ringkasan,
        d.adaStatus ? 1 : 0,
      ),
    ];
    for (const r of relasi) {
      const tujuan = uriSasaran.get(`${r.sasaran.jenis}|${r.sasaran.nomor}|${r.sasaran.tahun}`) ?? r.to_uri;
      if (tujuan === uri) continue;
      pernyataan.push(
        db.prepare(
          `INSERT OR IGNORE INTO relations (from_uri, to_uri, jenis_relasi, keterangan)
           VALUES (?,?,?,?)`,
        ).bind(uri, tujuan, r.jenis_relasi, r.keterangan),
      );
    }
    kelompok.push({ id: String(target.length), pernyataan });
    target.push(uri);
    bpkIdPer.push(doc.bpk_id);
  });

  const gagal = await batchBerkelompok(db, kelompok);
  const diterima: string[] = [];
  target.forEach((uri, i) => {
    const alasan = gagal.get(String(i));
    if (alasan) ditolak.push({ bpk_id: bpkIdPer[i], alasan: `gagal disimpan: ${alasan}` });
    else diterima.push(uri);
  });

  // Beri tahu pemanggil mana yang masih butuh PDF, supaya skrip panen tahu
  // dokumen mana yang perlu diunggah dan tidak mengirim ulang yang sudah ada.
  let butuhPdf: string[] = [];
  if (diterima.length) {
    // Sampai 500 dokumen per kiriman; D1 membatasi 100 parameter per kueri, jadi dipecah.
    const kosong = await pilihDalam<{ frbr_uri: string }>(
      db,
      diterima,
      (t) => `SELECT frbr_uri FROM laws WHERE frbr_uri IN (${t}) AND jumlah_pasal = 0`,
    );
    butuhPdf = kosong.map((r) => r.frbr_uri);
  }

  await db.prepare(
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
  // Berkasnya ternyata ada: penanda "tanpa berkas" (bila pernah dipasang) tak berlaku lagi.
  await c.env.DB.prepare(`DELETE FROM sync_state WHERE key = ?`).bind(kunciTanpaBerkas(uri)).run().catch(() => {});

  const pesan: PesanIngest = { tipe: "ekstrak_pdf", frbr_uri: uri, r2_key: kunci };
  await c.env.INGEST_QUEUE.send(pesan);

  return c.json(
    { status: "diantrekan", uri, r2_key: kunci, ukuran: isi.byteLength },
    200,
    headerCors(c),
  );
});

// ---------------------------------------------------------------------------
// POST /api/impor/tanpa-berkas — { uris: [...], alasan?: string }
//
// Skrip panen melapor peraturan yang halaman rinciannya di BPK dimuat dengan baik tetapi tak punya berkas PDF
// (naskah lama yang hanya berupa metadata). Peraturan itu tak muncul lagi di /butuh-teks (kecuali ?semua=1), dan
// penandanya hilang sendiri bila PDF-nya kelak diunggah.
// ---------------------------------------------------------------------------
impor.post("/tanpa-berkas", async (c) => {
  const body = await c.req.json<{ uris?: unknown; alasan?: unknown }>().catch(() => null);
  const uris = [...new Set(Array.isArray(body?.uris) ? body.uris.filter((u): u is string => typeof u === "string" && u.startsWith("/")) : [])];
  if (!uris.length) {
    return c.json({ error: "uri_kosong", message: "Body harus memuat { uris: [\"/akn/id/act/...\"] }." }, 400, headerCors(c));
  }
  if (uris.length > 200) {
    return c.json({ error: "terlalu_banyak", message: "Kirim maksimal 200 uri per permintaan." }, 413, headerCors(c));
  }
  const ada = await pilihDalam<{ frbr_uri: string }>(c.env.DB, uris, (t) => `SELECT frbr_uri FROM laws WHERE frbr_uri IN (${t})`);
  const catatan = (typeof body?.alasan === "string" && body.alasan.trim() ? body.alasan : "tanpa berkas PDF di BPK").slice(0, 120);
  if (ada.length) {
    await c.env.DB.batch(
      ada.map((r) =>
        c.env.DB.prepare(
          `INSERT INTO sync_state (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        ).bind(kunciTanpaBerkas(r.frbr_uri), catatan),
      ),
    );
  }
  return c.json({ ditandai: ada.length, tidak_dikenal: uris.length - ada.length }, 200, headerCors(c));
});

// ---------------------------------------------------------------------------
// POST /api/impor/ringkas — { batas?: number }
//
// Mengantrekan ringkasan AI untuk peraturan yang sudah punya teks tetapi belum punya ringkasan, yang terbaru dulu
// (paling banyak `batas`, 1-500, bawaan 100). Ringkasan disusun Workers AI di konsumer antrean.
// ---------------------------------------------------------------------------
impor.post("/ringkas", async (c) => {
  const body = await c.req.json<{ batas?: unknown }>().catch(() => null);
  const diminta = typeof body?.batas === "number" && Number.isFinite(body.batas) ? body.batas : 100;
  const batas = Math.min(Math.max(Math.floor(diminta), 1), 500);
  const cakupan = bacaCakupan(c.env.CAKUPAN_JENIS);
  const { results } = await c.env.DB.prepare(
    `SELECT frbr_uri FROM laws
      WHERE (ringkasan IS NULL OR TRIM(ringkasan) = '')
        AND (r2_text_key IS NOT NULL OR jumlah_pasal > 0)
        AND ${klausaCakupan(cakupan, "jenis")}
      ORDER BY tahun DESC, frbr_uri LIMIT ?`,
  ).bind(batas).all<{ frbr_uri: string }>();

  const pesan = results.map((r) => ({ body: { tipe: "ringkas", frbr_uri: r.frbr_uri } satisfies PesanIngest }));
  for (let i = 0; i < pesan.length; i += 100) await c.env.INGEST_QUEUE.sendBatch(pesan.slice(i, i + 100));
  await c.env.DB.prepare(`INSERT INTO sync_log (job, status, detail, jumlah) VALUES ('ringkas','sukses',?,?)`)
    .bind("diantrekan untuk diringkas", results.length).run().catch(() => {});
  return c.json({ status: "diantrekan", peraturan: results.length }, 200, headerCors(c));
});

// ---------------------------------------------------------------------------
// GET /api/impor/gemini-cek, POST /api/impor/gemini-uji — Gemini membaca PDF yang tak punya lapisan teks (lib/gemini.ts)
//
// Kunci ada di secret GEMINI_API (opsional: tanpa itu keduanya menjawab 503 dan fitur lain tak terpengaruh). `gemini-cek`
// mengirim satu permintaan teks kecil untuk memastikan kunci, model, dan alamat benar. `gemini-uji` membaca PDF SATU peraturan
// (`{ uri }`; makan satu sampai beberapa menit) dan melaporkan: pembacaan lolos atau tidak, pasal yang terbaca dibanding yang
// tersimpan, mutu teks, kesesuaian dengan teks bawaan, token yang terpakai, dan keputusan yang akan diambil. Tak ada pasal yang
// ditulis; teks Gemini diarsipkan di teks-ai/ untuk diperiksa. Jalankan ini lebih dulu pada beberapa peraturan sebelum membaca
// sungguhan lewat ekstrak-ulang `gemini`.
// ---------------------------------------------------------------------------
function jawabGalatGemini(c: Context<{ Bindings: Bindings }>, e: GalatGemini) {
  return c.json(
    { error: "gemini_galat", jenis: e.jenis, status: e.status ?? null, sementara: e.sementara, message: e.message },
    e.jenis === "anggaran" ? 429 : 502,
    headerCors(c),
  );
}

const GEMINI_BELUM_DIPASANG = {
  error: "gemini_belum_dipasang",
  message: "Secret GEMINI_API belum dipasang di Worker ini. Cloudflare > Workers > lexa > Settings > Variables and Secrets > Add > tipe Secret.",
};

impor.get("/gemini-cek", async (c) => {
  const k = bacaKonfigGemini(c.env);
  if (!k) return c.json(GEMINI_BELUM_DIPASANG, 503, headerCors(c));
  try {
    const ping = await pingGemini(k);
    const terpakai = await catatPemakaian(c.env.CACHE, ping.token.total);
    return c.json(
      {
        tersedia: true, model: k.model, versi_model: ping.versiModel, alamat: new URL(k.baseUrl).host, balasan: ping.balasan,
        berpikir: k.berpikir, halaman_per_panggilan: k.halamanPerPanggilan, paralel: k.paralel,
        selesai: ping.selesai, token: ping.token, durasi_ms: ping.durasiMs, anggaran: { terpakai, batas: k.anggaranHarian },
      },
      200,
      headerCors(c),
    );
  } catch (e) {
    if (e instanceof GalatGemini) return jawabGalatGemini(c, e);
    throw e;
  }
});

impor.post("/gemini-uji", async (c) => {
  const body = await c.req.json<{ uri?: unknown }>().catch(() => null);
  const uri = typeof body?.uri === "string" ? body.uri : "";
  if (!uri.startsWith("/")) {
    return c.json({ error: "uri_kosong", message: 'Body harus memuat { uri: "/akn/id/act/..." }.' }, 400, headerCors(c));
  }
  if (!bacaKonfigGemini(c.env)) return c.json(GEMINI_BELUM_DIPASANG, 503, headerCors(c));
  const law = await c.env.DB.prepare(`SELECT jenis, r2_pdf_key FROM laws WHERE frbr_uri = ?`).bind(uri).first<{ jenis: string; r2_pdf_key: string | null }>();
  if (!law) return c.json({ error: "tidak_ditemukan", message: `${uri} tidak ada di Lexa.` }, 404, headerCors(c));
  if (!dalamCakupan(bacaCakupan(c.env.CAKUPAN_JENIS), law.jenis)) {
    return c.json({ error: "di_luar_cakupan", message: `${uri} (${law.jenis}) di luar cakupan Lexa.` }, 422, headerCors(c));
  }
  if (!law.r2_pdf_key) return c.json({ error: "tanpa_pdf", message: `${uri} belum punya PDF di Lexa; panen dulu.` }, 409, headerCors(c));
  try {
    return c.json(await ujiGemini(buatKonteksIngest(c.env), uri, law.r2_pdf_key), 200, headerCors(c));
  } catch (e) {
    if (e instanceof GalatGemini) return jawabGalatGemini(c, e);
    throw e;
  }
});

// ---------------------------------------------------------------------------
// POST /api/impor/ekstrak-ulang — { uri?: string, batas?: number, jenis?: string[], dariTeks?: boolean, usang?: boolean, setelah?: string,
//                                    gemini?: boolean, vonis?: string[], ulangi?: boolean }
//
// `gemini: true` mengantrekan pembacaan PDF oleh Gemini (lib/gemini.ts) untuk peraturan yang teksnya tak layak: vonis
// ekstraksinya `tanpa_pasal`, `berat`, atau `gagal` (atau yang diminta lewat `vonis`), diurutkan menurut alamat, `batas` (1-20, bawaan
// 5) sekali jalan dengan kursor `setelah`/`terakhir` seperti `usang`. Peraturan yang pernah dicoba (tabel pembacaan_ai, migrasi
// 0008) dilewati kecuali `ulangi: true`, supaya yang gagal tak membakar token berulang kali. Dengan `uri`: peraturan itu saja,
// apa pun vonisnya. Jawabannya memuat anggaran token hari ini; bila habis, tak ada yang diantrekan. Hasil pembacaan hanya
// dipakai bila lolos pemeriksaan dan tak mengurangi pasal yang tersimpan (lihat putuskanPenerimaanAi).
//
// Mengantrekan ulang ekstraksi PDF yang sudah tersimpan di R2 tetapi belum menghasilkan pasal (mis. setelah pengurai
// pasal diperbaiki). Tanpa `uri`: peraturan ber-PDF yang jumlah_pasal-nya 0, yang belum pernah dicoba didahulukan, paling
// banyak `batas` (1-100, bawaan 25). Dengan `uri`: peraturan itu saja, walau sudah berpasal (hasil yang lebih sedikit dari
// yang tersimpan tidak menggantikannya; lihat ekstrakPdf).
//
// `dariTeks: true` menguraikan arsip teks hasil konversi yang sudah ada (laws.r2_text_key), tanpa membaca PDF dan tanpa
// konversi Workers AI: cukup untuk memulihkan hasil perbaikan pengurai. Peraturan tanpa arsip tetap dikonversi dari PDF-nya.
// Jangan dipakai bila PDF-nya baru diganti dan konversinya belum berhasil: arsip itu milik PDF yang lama.
//
// `usang: true` menguraikan ulang (selalu dari arsip teks, tanpa konversi) peraturan yang terakhir diurai dengan versi pengurai
// lebih lama dari yang berlaku (ekstraksi_log.versi_parser < VERSI_PARSER; migrasi 0007), menurut urutan alamat. `batas` (1-100)
// peraturan per panggilan; jawabannya memuat `terakhir`, yang diteruskan sebagai `setelah` pada panggilan berikutnya, sampai
// `diantrekan` bernilai 0. `usang_tersisa` menyusut seiring antrean dikerjakan. Hasil ekstraksi yang gagal atau PDF yang
// ditolak tak ditawarkan: tak ada yang bisa diperbaiki dari arsip teksnya.
// ---------------------------------------------------------------------------
interface GeminiBadan {
  uri?: unknown;
  batas?: unknown;
  vonis?: unknown;
  ulangi?: unknown;
  setelah?: unknown;
}

const VONIS_GEMINI = ["tanpa_pasal", "berat", "gagal", "ringan", "bersih"];
const VONIS_GEMINI_BAWAAN = ["tanpa_pasal", "berat", "gagal"];

async function antrekanPembacaanGemini(c: Context<{ Bindings: Bindings }>, body: GeminiBadan, dalam: string) {
  const k = bacaKonfigGemini(c.env);
  if (!k) return c.json(GEMINI_BELUM_DIPASANG, 503, headerCors(c));

  const terpakai = await pemakaianHariIni(c.env.CACHE);
  const anggaran = { terpakai, batas: k.anggaranHarian };
  if (terpakai >= k.anggaranHarian) {
    return c.json(
      { diantrekan: 0, anggaran_habis: true, anggaran, model: k.model, message: "Anggaran token harian Gemini habis; lanjutkan besok (UTC) atau naikkan GEMINI_BATAS_HARIAN." },
      200,
      headerCors(c),
    );
  }

  const batas = Math.min(Math.max(Math.floor(Number(body.batas)) || 5, 1), 20);
  const diminta = Array.isArray(body.vonis) ? body.vonis.filter((v): v is string => typeof v === "string") : [];
  const vonis = (diminta.length ? diminta : VONIS_GEMINI_BAWAAN).filter((v) => VONIS_GEMINI.includes(v));
  if (!vonis.length) {
    return c.json({ error: "vonis_tak_sah", message: `vonis harus salah satu dari ${VONIS_GEMINI.join(", ")}.` }, 400, headerCors(c));
  }
  const uri = typeof body.uri === "string" ? body.uri : null;
  const setelah = typeof body.setelah === "string" ? body.setelah : "";
  const belumDicoba = body.ulangi === true ? "" : "AND NOT EXISTS (SELECT 1 FROM pembacaan_ai p WHERE p.frbr_uri = l.frbr_uri AND p.hasil <> 'uji')";
  const dasar = `FROM laws l JOIN ekstraksi_log e ON e.frbr_uri = l.frbr_uri
                  WHERE ${dalam} AND l.r2_pdf_key IS NOT NULL AND e.vonis IN (${vonis.map(() => "?").join(",")}) ${belumDicoba}`;

  try {
    const { results } = uri
      ? await c.env.DB.prepare(`SELECT l.frbr_uri, l.r2_pdf_key FROM laws l WHERE l.frbr_uri = ? AND ${dalam} AND l.r2_pdf_key IS NOT NULL`)
          .bind(uri).all<{ frbr_uri: string; r2_pdf_key: string }>()
      : await c.env.DB.prepare(`SELECT l.frbr_uri, l.r2_pdf_key ${dasar} AND l.frbr_uri > ? ORDER BY l.frbr_uri LIMIT ?`)
          .bind(...vonis, setelah, batas).all<{ frbr_uri: string; r2_pdf_key: string }>();
    if (results.length) {
      await c.env.INGEST_QUEUE.sendBatch(
        // `ulangi` ikut dibawa: tanpanya konsumer melewati peraturan yang sudah pernah dicoba (pesan ganda tak membayar dua kali).
        results.map((r) => ({
          body: { tipe: "ekstrak_pdf", frbr_uri: r.frbr_uri, r2_key: r.r2_pdf_key, pembaca: "gemini", ...(body.ulangi === true || uri ? { ulangi: true } : {}) } satisfies PesanIngest,
        })),
      );
    }
    const sisa = await c.env.DB.prepare(`SELECT COUNT(*) AS n ${dasar}`).bind(...vonis).first<{ n: number }>();
    return c.json(
      {
        diantrekan: results.length, gemini_tersisa: sisa?.n ?? 0, terakhir: results.at(-1)?.frbr_uri ?? null,
        uris: results.slice(0, 20).map((r) => r.frbr_uri), model: k.model, vonis, anggaran,
      },
      200,
      headerCors(c),
    );
  } catch (e) {
    if (!/pembacaan_ai/.test(String(e))) throw e;
    return c.json(
      { error: "migrasi_belum_diterapkan", message: "Tabel pembacaan_ai belum ada: terapkan migrasi 0008 (npm run d1:migrate:remote) lebih dulu." },
      503,
      headerCors(c),
    );
  }
}

impor.post("/ekstrak-ulang", async (c) => {
  const body = await c.req
    .json<{ uri?: unknown; batas?: unknown; jenis?: unknown; dariTeks?: unknown; usang?: unknown; setelah?: unknown; gemini?: unknown }>()
    .catch(() => null);
  const dariTeks = body?.dariTeks === true;
  const cakupan = bacaCakupan(c.env.CAKUPAN_JENIS);
  const batas = Math.min(Math.max(Math.floor(Number(body?.batas)) || 25, 1), 100);
  const diminta = Array.isArray(body?.jenis) ? body.jenis.filter((j): j is string => typeof j === "string").map((j) => j.trim().toUpperCase()) : [];
  const jenis = diminta.length ? cakupan.filter((j) => diminta.includes(j)) : cakupan;
  if (!jenis.length) {
    return c.json({ error: "di_luar_cakupan", message: `Jenis di luar cakupan Lexa: ${cakupan.join(", ")}.`, cakupan }, 400, headerCors(c));
  }

  const dalam = klausaCakupan(jenis, "l.jenis");

  if (body?.gemini === true) return antrekanPembacaanGemini(c, body as GeminiBadan, dalam);

  if (body?.usang === true) {
    const setelah = typeof body.setelah === "string" ? body.setelah : "";
    const dasar = `FROM laws l JOIN ekstraksi_log e ON e.frbr_uri = l.frbr_uri
                   WHERE ${dalam} AND l.r2_pdf_key IS NOT NULL AND e.vonis <> 'gagal' AND e.versi_parser < ?`;
    try {
      const { results } = await c.env.DB.prepare(`SELECT l.frbr_uri, l.r2_pdf_key ${dasar} AND l.frbr_uri > ? ORDER BY l.frbr_uri LIMIT ?`)
        .bind(VERSI_PARSER, setelah, batas)
        .all<{ frbr_uri: string; r2_pdf_key: string }>();
      if (results.length) {
        await c.env.INGEST_QUEUE.sendBatch(
          results.map((r) => ({ body: { tipe: "ekstrak_pdf", frbr_uri: r.frbr_uri, r2_key: r.r2_pdf_key, dari_teks: true } satisfies PesanIngest })),
        );
      }
      const sisa = await c.env.DB.prepare(`SELECT COUNT(*) AS n ${dasar}`).bind(VERSI_PARSER).first<{ n: number }>();
      return c.json(
        {
          diantrekan: results.length, usang_tersisa: sisa?.n ?? 0, versi_parser: VERSI_PARSER,
          terakhir: results.at(-1)?.frbr_uri ?? null, uris: results.slice(0, 20).map((r) => r.frbr_uri),
        },
        200,
        headerCors(c),
      );
    } catch (e) {
      if (!/versi_parser/.test(String(e))) throw e;
      return c.json(
        { error: "migrasi_belum_diterapkan", message: "Kolom ekstraksi_log.versi_parser belum ada: terapkan migrasi 0007 (npm run d1:migrate:remote) lebih dulu." },
        503,
        headerCors(c),
      );
    }
  }

  const uri = typeof body?.uri === "string" ? body.uri : null;
  const { results } = uri
    ? await c.env.DB.prepare(`SELECT l.frbr_uri, l.r2_pdf_key FROM laws l WHERE l.frbr_uri = ? AND ${dalam} AND l.r2_pdf_key IS NOT NULL`)
        .bind(uri).all<{ frbr_uri: string; r2_pdf_key: string }>()
    : await c.env.DB.prepare(
        `SELECT l.frbr_uri, l.r2_pdf_key FROM laws l LEFT JOIN ekstraksi_log e ON e.frbr_uri = l.frbr_uri
          WHERE ${dalam} AND l.r2_pdf_key IS NOT NULL AND l.jumlah_pasal = 0
          ORDER BY (e.created_at IS NOT NULL), e.created_at, ${sqlPrioritas("l.")}, l.frbr_uri
          LIMIT ?`,
      ).bind(batas).all<{ frbr_uri: string; r2_pdf_key: string }>();

  if (results.length) {
    await c.env.INGEST_QUEUE.sendBatch(
      results.map((r) => ({
        body: { tipe: "ekstrak_pdf", frbr_uri: r.frbr_uri, r2_key: r.r2_pdf_key, ...(dariTeks ? { dari_teks: true } : {}) } satisfies PesanIngest,
      })),
    );
  }
  const sisa = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM laws l WHERE ${dalam} AND l.r2_pdf_key IS NOT NULL AND l.jumlah_pasal = 0`,
  ).first<{ n: number }>();
  return c.json({ diantrekan: results.length, belum_berpasal: sisa?.n ?? 0, uris: results.slice(0, 20).map((r) => r.frbr_uri) }, 200, headerCors(c));
});
