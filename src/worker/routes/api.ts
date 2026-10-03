import { Hono } from "hono";
import type { Context } from "hono";
import type { BrowseResponse, LawDetailResponse, Law, Article, Relation, SearchMode, SearchFilters, StatusPeraturan } from "../../shared/types";
import { cariDenganCache, type KonteksPencarian } from "../lib/search";
import { tokenSah, diagnosaToken } from "../lib/auth";
import { headerCors } from "../lib/cors";
import { klausaBidang } from "../lib/bidang";
import { PasalClient, urlBpk } from "../lib/pasal";
import { jadwalkanSinkronisasi, type KonteksIngest, type PesanIngest } from "../lib/ingest";
import { labelSitasi, rapikanArtikel, rapikanLaw } from "../../shared/label";
import { pilihDalam } from "../lib/d1";
import { aliasUri, selesaikanUri } from "../lib/uri";

type Bindings = Env;

export const api = new Hono<{ Bindings: Bindings }>();

const STATUS_VALID: StatusPeraturan[] = ["berlaku", "dicabut", "diubah"];

function konteksPencarian(env: Env): KonteksPencarian {
  return {
    db: env.DB,
    ai: env.AI,
    vectorize: env.VECTORIZE,
    cache: env.CACHE,
    embeddingModel: env.EMBEDDING_MODEL,
    cacheTtl: Number(env.SEARCH_CACHE_TTL) || 3600,
  };
}

function konteksIngest(env: Env): KonteksIngest {
  return {
    db: env.DB,
    vectorize: env.VECTORIZE,
    ai: env.AI,
    docs: env.DOCS,
    queue: env.INGEST_QUEUE,
    pasal: new PasalClient({ base: env.PASAL_API_BASE, token: env.PASAL_API_TOKEN }),
    embeddingModel: env.EMBEDDING_MODEL,
    summaryModel: env.SUMMARY_MODEL,
  };
}

type Ctx = Context<{ Bindings: Bindings }>;

/** Ambil daftar dari query string: `?jenis=UU&jenis=PP` atau `?jenis=UU,PP`. */
function daftarParam(c: Ctx, nama: string): string[] | undefined {
  const nilai = c.req.queries(nama);
  if (!nilai?.length) return undefined;
  const hasil = nilai.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
  return hasil.length ? hasil : undefined;
}

function bacaFilters(c: Ctx): SearchFilters {
  const tahunMin = Number(c.req.query("tahun_min"));
  const tahunMax = Number(c.req.query("tahun_max"));
  const status = daftarParam(c, "status")?.filter((s): s is StatusPeraturan =>
    (STATUS_VALID as string[]).includes(s),
  );

  return {
    // Jenis peraturan yang ada hanya belasan; daftar yang lebih panjang berarti masukan
    // sembarangan, dan tiap butir menjadi parameter terikat (batas D1: 100 per kueri).
    jenis: daftarParam(c, "jenis")?.slice(0, 30),
    status: status?.length ? status : undefined,
    tahun_min: Number.isFinite(tahunMin) && tahunMin > 0 ? tahunMin : undefined,
    tahun_max: Number.isFinite(tahunMax) && tahunMax > 0 ? tahunMax : undefined,
    instansi: c.req.query("instansi") || undefined,
    bidang: c.req.query("bidang") || undefined,
  };
}

// ---------------------------------------------------------------------------
// GET /api/search
// ---------------------------------------------------------------------------
api.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (!q) {
    return c.json({ error: "kueri_kosong", message: "Parameter `q` wajib diisi." }, 400);
  }
  if (q.length > 300) {
    return c.json({ error: "kueri_terlalu_panjang", message: "Kueri maksimal 300 karakter." }, 400);
  }

  const modeRaw = c.req.query("mode");
  const mode: SearchMode =
    modeRaw === "keyword" || modeRaw === "semantic" ? modeRaw : "hybrid";

  const hasil = await cariDenganCache(konteksPencarian(c.env), {
    query: q,
    mode,
    limit: Number(c.req.query("limit")) || 20,
    filters: bacaFilters(c),
  });

  // Analitik ditulis di luar jalur respons agar tidak menambah latensi.
  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      `INSERT INTO search_log (query, jumlah_hasil, mode, durasi_ms) VALUES (?,?,?,?)`,
    )
      .bind(q.slice(0, 200), hasil.hits.length, mode, hasil.durasi_ms)
      .run()
      .catch(() => {}),
  );

  return c.json(hasil, 200, {
    "Cache-Control": "public, max-age=60, stale-while-revalidate=600",
  });
});

// ---------------------------------------------------------------------------
// GET /api/laws — penelusuran berfaset
// ---------------------------------------------------------------------------
api.get("/laws", async (c) => {
  const page = Math.max(Number(c.req.query("page")) || 1, 1);
  const perPage = Math.min(Math.max(Number(c.req.query("per_page")) || 20, 1), 100);
  const f = bacaFilters(c);

  const where: string[] = ["1=1"];
  const params: unknown[] = [];

  if (f.jenis?.length) {
    where.push(`jenis IN (${f.jenis.map(() => "?").join(",")})`);
    params.push(...f.jenis);
  }
  if (f.status?.length) {
    where.push(`status IN (${f.status.map(() => "?").join(",")})`);
    params.push(...f.status);
  }
  if (f.tahun_min !== undefined) { where.push(`tahun >= ?`); params.push(f.tahun_min); }
  if (f.tahun_max !== undefined) { where.push(`tahun <= ?`); params.push(f.tahun_max); }
  if (f.instansi) { where.push(`instansi = ?`); params.push(f.instansi); }
  if (f.bidang) {
    const kb = klausaBidang("bidang");
    where.push(kb.sql);
    params.push(...kb.params(f.bidang));
  }

  const klausa = where.join(" AND ");

  const urutRaw = c.req.query("urut");
  // Whitelist eksplisit — kolom urutan tidak boleh datang langsung dari input.
  const urutan =
    urutRaw === "tahun_asc" ? "tahun ASC, jenis, CAST(nomor AS INTEGER)"
    : urutRaw === "judul" ? "judul COLLATE NOCASE ASC"
    : "tahun DESC, jenis, CAST(nomor AS INTEGER) DESC";

  const [rows, total, fJenis, fTahun, fStatus] = await Promise.all([
    c.env.DB.prepare(
      `SELECT frbr_uri, jenis, nomor, tahun, judul, tentang, status,
              tanggal_penetapan, tanggal_berlaku, instansi, bidang,
              bpk_id, sumber_url, ringkasan, jumlah_pasal
         FROM laws WHERE ${klausa}
        ORDER BY ${urutan} LIMIT ? OFFSET ?`,
    ).bind(...params, perPage, (page - 1) * perPage).all<Law>(),

    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM laws WHERE ${klausa}`)
      .bind(...params).first<{ n: number }>(),

    c.env.DB.prepare(
      `SELECT jenis AS value, COUNT(*) AS count FROM laws WHERE ${klausa}
        GROUP BY jenis ORDER BY count DESC LIMIT 30`,
    ).bind(...params).all<{ value: string; count: number }>(),

    c.env.DB.prepare(
      `SELECT CAST(tahun AS TEXT) AS value, COUNT(*) AS count FROM laws WHERE ${klausa}
        GROUP BY tahun ORDER BY tahun DESC LIMIT 40`,
    ).bind(...params).all<{ value: string; count: number }>(),

    c.env.DB.prepare(
      `SELECT status AS value, COUNT(*) AS count FROM laws WHERE ${klausa}
        GROUP BY status ORDER BY count DESC`,
    ).bind(...params).all<{ value: string; count: number }>(),
  ]);

  const body: BrowseResponse = {
    laws: rows.results.map(rapikanLaw),
    total: total?.n ?? 0,
    page,
    per_page: perPage,
    facets: {
      jenis: fJenis.results.map((r) => ({ ...r, label: r.value })),
      tahun: fTahun.results.map((r) => ({ ...r, label: r.value })),
      status: fStatus.results.map((r) => ({ ...r, label: r.value })),
    },
  };

  return c.json(body, 200, { "Cache-Control": "public, max-age=300" });
});

/**
 * Relasi yang tujuannya tampak belum ter-ingest padahal ada di indeks dengan ejaan URI lain
 * (PERPPU "perppu" vs "perpu", lihat lib/uri.ts) dilengkapi: URI dan metadata tujuan diganti
 * dengan yang di indeks, lalu urutannya dikembalikan seperti kueri aslinya.
 */
async function perbaikiRelasiBeralias(db: D1Database, relasi: Relation[]): Promise<Relation[]> {
  const menggantung = relasi.filter((r) => r.judul === null && aliasUri(r.to_uri) !== null);
  if (!menggantung.length) return relasi;

  const peta = await selesaikanUri(db, menggantung.map((r) => r.to_uri));
  const tujuan = [...new Set(menggantung.map((r) => peta.get(r.to_uri) as string).filter((u, i) => u !== menggantung[i].to_uri))];
  if (!tujuan.length) return relasi;

  const meta = await pilihDalam<Pick<Relation, "judul" | "jenis" | "nomor" | "tahun" | "status"> & { frbr_uri: string }>(
    db,
    tujuan,
    (t) => `SELECT frbr_uri, judul, jenis, nomor, tahun, status FROM laws WHERE frbr_uri IN (${t})`,
  );
  const petaMeta = new Map(meta.map((m) => [m.frbr_uri, m]));

  const hasil = relasi.map((r) => {
    const m = petaMeta.get(peta.get(r.to_uri) ?? r.to_uri);
    return r.judul === null && m
      ? { ...r, to_uri: m.frbr_uri, judul: m.judul, jenis: m.jenis, nomor: m.nomor, tahun: m.tahun, status: m.status }
      : r;
  });
  // Kueri asli: ORDER BY jenis_relasi, tahun DESC (NULL terakhir); sort JS stabil.
  return hasil.sort((a, b) =>
    a.jenis_relasi === b.jenis_relasi ? (b.tahun ?? -1) - (a.tahun ?? -1) : a.jenis_relasi < b.jenis_relasi ? -1 : 1,
  );
}

// ---------------------------------------------------------------------------
// GET /api/laws/detail?uri=... — detail satu peraturan
//
// FRBR URI mengandung banyak "/", sehingga memakai path parameter akan
// bertabrakan dengan routing. Karena itu URI dikirim lewat query string.
// ---------------------------------------------------------------------------
api.get("/laws/detail", async (c) => {
  const uriMinta = c.req.query("uri");
  if (!uriMinta) {
    return c.json({ error: "uri_kosong", message: "Parameter `uri` wajib diisi." }, 400);
  }

  const ambilLaw = (u: string) =>
    c.env.DB.prepare(
      `SELECT frbr_uri, jenis, nomor, tahun, judul, tentang, status,
              tanggal_penetapan, tanggal_berlaku, instansi, bidang,
              bpk_id, sumber_url, ringkasan, jumlah_pasal
         FROM laws WHERE frbr_uri = ?`,
    ).bind(u).first<Law>();

  // PERPPU punya dua ejaan URI (lihat lib/uri.ts); tautan lama bisa memakai yang lain.
  let law = await ambilLaw(uriMinta);
  const alias = aliasUri(uriMinta);
  if (!law && alias) law = await ambilLaw(alias);

  if (!law) {
    return c.json({ error: "tidak_ditemukan", message: `Peraturan ${uriMinta} belum ada di indeks.` }, 404);
  }
  const uri = law.frbr_uri;

  const [articles, relations] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, frbr_uri, nomor_pasal, ayat, bab, bagian, judul, isi, urutan
         FROM articles WHERE frbr_uri = ? ORDER BY urutan`,
    ).bind(uri).all<Article>(),

    // LEFT JOIN supaya relasi ke peraturan yang belum ter-ingest tetap tampil,
    // hanya saja tanpa judul.
    c.env.DB.prepare(
      `SELECT r.to_uri, r.jenis_relasi, r.keterangan,
              l.judul, l.jenis, l.nomor, l.tahun, l.status
         FROM relations r
         LEFT JOIN laws l ON l.frbr_uri = r.to_uri
        WHERE r.from_uri = ?
        ORDER BY r.jenis_relasi, l.tahun DESC`,
    ).bind(uri).all<Relation>(),
  ]);

  const body: LawDetailResponse = {
    law: rapikanLaw(law),
    articles: articles.results.map(rapikanArtikel),
    relations: await perbaikiRelasiBeralias(c.env.DB, relations.results),
    bpk_url: urlBpk(c.env.BPK_BASE, law.bpk_id),
  };

  return c.json(body, 200, { "Cache-Control": "public, max-age=3600" });
});

// ---------------------------------------------------------------------------
// GET /api/suggest — saran ketik berdasarkan judul + kueri populer
// ---------------------------------------------------------------------------
api.get("/suggest", async (c) => {
  // Wildcard LIKE dibuang lebih dulu, lalu panjangnya diperiksa: "%%" tidak boleh
  // lolos sebagai kueri dua karakter yang kemudian berubah menjadi pola "%" (cocok semua).
  const q = (c.req.query("q") ?? "").trim().replace(/[%_]/g, "");
  // D1 menolak pola LIKE lebih dari 50 byte; pola di bawah adalah "%q%", jadi kueri yang
  // lebih panjang dari ini bukan lagi pencarian awalan judul melainkan kalimat.
  if (q.length < 2 || new TextEncoder().encode(q).length > 44) return c.json({ suggestions: [] });

  const pola = `${q}%`;
  const [laws, populer] = await Promise.all([
    c.env.DB.prepare(
      `SELECT frbr_uri, jenis, nomor, tahun, judul FROM laws
        WHERE judul LIKE ? COLLATE NOCASE ORDER BY tahun DESC LIMIT 6`,
    ).bind(`%${pola}`).all<{ frbr_uri: string; jenis: string; nomor: string; tahun: number; judul: string }>(),

    c.env.DB.prepare(
      `SELECT query, COUNT(*) AS n FROM search_log
        WHERE query LIKE ? COLLATE NOCASE AND jumlah_hasil > 0
        GROUP BY query ORDER BY n DESC LIMIT 4`,
    ).bind(pola).all<{ query: string; n: number }>(),
  ]);

  return c.json({
    suggestions: [
      ...laws.results.map((l) => ({
        tipe: "peraturan" as const,
        teks: `${labelSitasi(l)} — ${l.judul}`,
        uri: l.frbr_uri,
      })),
      ...populer.results.map((p) => ({ tipe: "kueri" as const, teks: p.query, uri: null })),
    ],
  }, 200, { "Cache-Control": "public, max-age=300" });
});

// ---------------------------------------------------------------------------
// GET /api/stats — kesehatan indeks, dipakai halaman status
// ---------------------------------------------------------------------------
api.get("/stats", async (c) => {
  const [total, perJenis, terbaru, sync] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS laws,
              (SELECT COUNT(*) FROM articles) AS articles,
              (SELECT COUNT(*) FROM laws WHERE indexed_at IS NOT NULL) AS terindeks
         FROM laws`,
    ).first<{ laws: number; articles: number; terindeks: number }>(),

    c.env.DB.prepare(
      `SELECT jenis, COUNT(*) AS n FROM laws GROUP BY jenis ORDER BY n DESC LIMIT 15`,
    ).all<{ jenis: string; n: number }>(),

    c.env.DB.prepare(
      `SELECT frbr_uri, jenis, nomor, tahun, judul FROM laws
        ORDER BY created_at DESC LIMIT 8`,
    ).all<{ frbr_uri: string; jenis: string; nomor: string; tahun: number; judul: string }>(),

    c.env.DB.prepare(
      `SELECT job, status, jumlah, detail, created_at FROM sync_log
        ORDER BY created_at DESC LIMIT 10`,
    ).all<{ job: string; status: string; jumlah: number; detail: string | null; created_at: string }>(),
  ]);

  return c.json({
    total_peraturan: total?.laws ?? 0,
    total_pasal: total?.articles ?? 0,
    terindeks_vektor: total?.terindeks ?? 0,
    per_jenis: perJenis.results,
    terbaru: terbaru.results,
    sinkronisasi_terakhir: sync.results,
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/sync — pemicu ingest manual
// ---------------------------------------------------------------------------
api.post("/admin/sync", async (c) => {
  if (!tokenSah(c.req.header("x-admin-token"), c.env.ADMIN_TOKEN)) {
    return c.json({ error: "tidak_berwenang", message: "Header x-admin-token tidak valid." }, 401);
  }
  if (!c.env.PASAL_API_TOKEN) {
    return c.json({
      error: "token_belum_diatur",
      message: "PASAL_API_TOKEN belum dipasang. Jalankan: wrangler secret put PASAL_API_TOKEN",
    }, 503);
  }

  type BodySync = {
    jenis?: string[];
    uri?: string;
    maks_halaman?: number;
    perbaiki_celah?: boolean;
    ringkas_kosong?: boolean;
    batas?: number;
  };
  const body = await c.req.json<BodySync>().catch(() => ({}) as BodySync);

  // Ingest satu peraturan spesifik.
  if (body.uri) {
    const pesan: PesanIngest = { tipe: "peraturan", frbr_uri: body.uri, alasan: "manual" };
    await c.env.INGEST_QUEUE.send(pesan);
    return c.json({ status: "diantrekan", uri: body.uri });
  }

  // Susun ringkasan untuk peraturan yang belum punya.
  if (body.ringkas_kosong) {
    const batas = Math.min(Math.max(body.batas ?? 100, 1), 500);
    const { results } = await c.env.DB.prepare(
      `SELECT frbr_uri FROM laws
        WHERE (ringkasan IS NULL OR TRIM(ringkasan) = '')
          AND (r2_text_key IS NOT NULL OR jumlah_pasal > 0)
        ORDER BY tahun DESC LIMIT ?`,
    ).bind(batas).all<{ frbr_uri: string }>();

    const pesan: PesanIngest[] = results.map((r) => ({
      tipe: "ringkas" as const,
      frbr_uri: r.frbr_uri,
    }));
    for (let i = 0; i < pesan.length; i += 100) {
      await c.env.INGEST_QUEUE.sendBatch(pesan.slice(i, i + 100).map((b) => ({ body: b })));
    }

    await c.env.DB.prepare(
      `INSERT INTO sync_log (job, status, detail, jumlah) VALUES ('ringkas','sukses',?,?)`,
    ).bind("diantrekan untuk diringkas", results.length).run().catch(() => {});

    return c.json({ status: "diantrekan", peraturan: results.length });
  }

  // Ambil ulang peraturan yang penomoran pasalnya bercelah.
  //
  // Penyapuan biasa melewatkan peraturan yang `jumlah_pasal`-nya sudah > 0,
  // sehingga dokumen yang tersimpan tidak utuh akan diam di sana selamanya.
  // Celah dideteksi dengan membandingkan nomor pasal tertinggi terhadap jumlah
  // pasal yang benar-benar ada — kalau UU punya Pasal 13 tetapi hanya 12 baris
  // tersimpan, ada yang hilang.
  if (body.perbaiki_celah) {
    const batas = Math.min(Math.max(body.batas ?? 200, 1), 1000);
    const { results } = await c.env.DB.prepare(
      `SELECT frbr_uri,
              MAX(CAST(nomor_pasal AS INTEGER)) - COUNT(DISTINCT nomor_pasal) AS hilang
         FROM articles
        WHERE nomor_pasal GLOB '[0-9]*'
        GROUP BY frbr_uri
       HAVING hilang > 0
        ORDER BY hilang DESC
        LIMIT ?`,
    ).bind(batas).all<{ frbr_uri: string; hilang: number }>();

    const pesan: PesanIngest[] = results.map((r) => ({
      tipe: "peraturan" as const,
      frbr_uri: r.frbr_uri,
      alasan: "manual" as const,
    }));
    for (let i = 0; i < pesan.length; i += 100) {
      await c.env.INGEST_QUEUE.sendBatch(pesan.slice(i, i + 100).map((body) => ({ body })));
    }

    const perkiraanHilang = results.reduce((n, r) => n + r.hilang, 0);

    // Dicatat supaya terlihat di /status. Tanpa ini tidak ada cara membedakan
    // "perintah tidak pernah dijalankan" dari "sudah dijalankan tapi antreannya
    // masih tertahan rate limit".
    await c.env.DB.prepare(
      `INSERT INTO sync_log (job, status, detail, jumlah)
       VALUES ('perbaiki_celah', 'sukses', ?, ?)`,
    ).bind(`perkiraan ${perkiraanHilang} pasal hilang`, results.length).run().catch(() => {});

    return c.json({
      status: "diantrekan",
      peraturan: results.length,
      perkiraan_pasal_hilang: perkiraanHilang,
    });
  }

  const hasil = await jadwalkanSinkronisasi(konteksIngest(c.env), {
    jenis: body.jenis,
    maksHalaman: body.maks_halaman,
  });
  return c.json({ status: "selesai", ...hasil });
});

// ---------------------------------------------------------------------------
// GET /api/admin/cek-token — mendiagnosis kegagalan 401
//
// Sengaja tidak diautentikasi: kalau ia butuh token, ia tidak akan berguna
// justru saat tokennya bermasalah. Balasannya hanya boolean — tidak ada nilai
// maupun panjang token yang keluar.
// ---------------------------------------------------------------------------
api.options("/admin/cek-token", (c) => c.body(null, 204, headerCors(c.req.header("origin"))));

api.get("/admin/cek-token", (c) => {
  const d = diagnosaToken(c.req.header("x-admin-token"), c.env.ADMIN_TOKEN);

  const saran = !d.secret_terpasang
    ? "ADMIN_TOKEN belum dipasang di Worker. Jalankan: wrangler secret put ADMIN_TOKEN"
    : !d.header_diterima
      ? "Header x-admin-token tidak sampai. Periksa ejaan header, dan pada permintaan lintas-origin pastikan preflight OPTIONS berhasil."
      : d.ada_spasi_berlebih
        ? "Ada spasi atau newline berlebih. Ini lazim bila secret dipasang lewat pipa (echo \"xxx\" | wrangler secret put). Sudah ditoleransi versi ini, tetapi sebaiknya pasang ulang tanpa newline."
        : !d.panjang_cocok
          ? "Panjang token berbeda — kemungkinan besar nilainya memang bukan yang tersimpan di Worker."
          : d.cocok
            ? "Token cocok."
            : "Panjang sama tetapi isinya berbeda.";

  return c.json({ ...d, saran }, d.cocok ? 200 : 401, headerCors(c.req.header("origin")));
});

// ---------------------------------------------------------------------------
// GET /api/admin/ukur — laporan mutu ekstraksi PDF
//
// Menjawab satu pertanyaan: layakkah BPK dijadikan sumber utama? Jalur
// PDF → toMarkdown → pasal adalah satu-satunya bagian yang belum terbukti
// dengan dokumen nyata, dan seluruh rencana bertumpu padanya.
// ---------------------------------------------------------------------------
api.get("/admin/ukur", async (c) => {
  if (!tokenSah(c.req.header("x-admin-token"), c.env.ADMIN_TOKEN)) {
    return c.json({ error: "tidak_berwenang", message: "Header x-admin-token tidak valid." }, 401);
  }

  const [ringkas, perAngkatan, contoh] = await Promise.all([
    c.env.DB.prepare(
      `SELECT vonis, COUNT(*) AS n,
              ROUND(AVG(jumlah_pasal), 1) AS rata_pasal,
              ROUND(AVG(kerusakan_per_1000), 2) AS rata_kerusakan,
              ROUND(AVG(durasi_ms)) AS rata_durasi_ms
         FROM ekstraksi_log GROUP BY vonis ORDER BY n DESC`,
    ).all<Record<string, unknown>>(),

    // Pengelompokan yang paling menentukan: dokumen born-digital (2015 ke atas)
    // hampir pasti berbeda jauh dari hasil pindaian lama.
    c.env.DB.prepare(
      `SELECT CASE WHEN tahun_dokumen >= 2015 THEN 'born-digital (>=2015)'
                   WHEN tahun_dokumen >= 2000 THEN 'peralihan (2000-2014)'
                   ELSE 'pindaian lama (<2000)' END AS angkatan,
              COUNT(*) AS n,
              SUM(CASE WHEN vonis = 'tanpa_pasal' THEN 1 ELSE 0 END) AS gagal_urai,
              SUM(CASE WHEN vonis IN ('bersih','ringan') THEN 1 ELSE 0 END) AS layak,
              ROUND(AVG(jumlah_pasal), 1) AS rata_pasal,
              ROUND(AVG(celah_pasal), 1) AS rata_celah,
              ROUND(AVG(kerusakan_per_1000), 2) AS rata_kerusakan
         FROM ekstraksi_log
        WHERE tahun_dokumen IS NOT NULL
        GROUP BY angkatan ORDER BY angkatan DESC`,
    ).all<Record<string, unknown>>(),

    c.env.DB.prepare(
      `SELECT e.frbr_uri, l.jenis || ' ' || l.nomor || '/' || l.tahun AS sitasi,
              e.vonis, e.jumlah_pasal, e.jumlah_ayat, e.pasal_tertinggi, e.celah_pasal,
              e.panjang_teks, e.ukuran_pdf, e.kerusakan_per_1000, e.durasi_ms, e.catatan
         FROM ekstraksi_log e LEFT JOIN laws l ON l.frbr_uri = e.frbr_uri
        ORDER BY e.created_at DESC LIMIT 60`,
    ).all<Record<string, unknown>>(),
  ]);

  const total = ringkas.results.reduce((n, r) => n + Number(r.n ?? 0), 0);
  const layak = ringkas.results
    .filter((r) => r.vonis === "bersih" || r.vonis === "ringan")
    .reduce((n, r) => n + Number(r.n ?? 0), 0);

  return c.json({
    total_diukur: total,
    layak_pakai: layak,
    persen_layak: total ? Number(((layak / total) * 100).toFixed(1)) : 0,
    // Ambang penilaian, ditulis eksplisit agar angkanya bisa ditafsirkan
    // tanpa membaca kode.
    keterangan_vonis: {
      bersih: "<0,5 indikator kerusakan per 1.000 karakter",
      ringan: "0,5–2 indikator per 1.000 karakter",
      berat: ">=2 indikator per 1.000 karakter",
      tanpa_pasal: "teks terbaca tetapi tidak ada pasal terdeteksi",
      gagal: "konversi PDF gagal sama sekali",
    },
    per_vonis: ringkas.results,
    per_angkatan: perAngkatan.results,
    dokumen: contoh.results,
  });
});

api.all("*", (c) => c.json({ error: "rute_tidak_ada", message: "Endpoint tidak dikenal." }, 404));
