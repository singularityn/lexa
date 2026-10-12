import { Hono } from "hono";
import type { Context } from "hono";
import type { BrowseResponse, LawDetailResponse, Law, Article, Relation, SearchMode, SearchFilters, StatusPeraturan } from "../../shared/types";
import { cariDenganCache, type KonteksPencarian } from "../lib/search";
import { pilahBerjudul } from "../lib/judul";
import { uraiKueri } from "../lib/query";
import { tokenSah, diagnosaToken } from "../lib/auth";
import { headerCors } from "../lib/cors";
import { klausaBidang } from "../lib/bidang";
import { PasalApiError, PasalClient, PasalRateLimitError, adaSimpulPasal, catatanAksesTerbatas, uraiDetail, urlBpk } from "../lib/pasal";
import { uraiAkses } from "../lib/akses";
import type { KonteksIngest } from "../lib/ingest";
import { jalankanTik } from "../lib/tik";
import { arsipkanMentah, arsipkanTeksDanIndeks, SQL_GILIRAN, simpanIsi } from "../lib/isi";
import { labelSitasi, rapikanArtikel, rapikanLaw } from "../../shared/label";
import { pilihDalam } from "../lib/d1";
import { aliasUri, selesaikanUri } from "../lib/uri";
import { bacaCakupan, dalamCakupan, klausaCakupan, uriJelasDiLuarCakupan } from "../../shared/cakupan";

type Bindings = Env;

export const api = new Hono<{ Bindings: Bindings }>();

const STATUS_VALID: StatusPeraturan[] = ["berlaku", "dicabut", "diubah"];

/** Berapa judul yang diambil sebagai bahan saran ketik sebelum diurutkan dan dipotong menjadi enam. */
const KANDIDAT_SARAN = 60;

function konteksPencarian(env: Env): KonteksPencarian {
  return {
    db: env.DB,
    ai: env.AI,
    vectorize: env.VECTORIZE,
    cache: env.CACHE,
    embeddingModel: env.EMBEDDING_MODEL,
    cacheTtl: Number(env.SEARCH_CACHE_TTL) || 3600,
    cakupan: bacaCakupan(env.CAKUPAN_JENIS),
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
    cakupan: bacaCakupan(env.CAKUPAN_JENIS),
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
  const cakupan = bacaCakupan(c.env.CAKUPAN_JENIS);

  // Cakupan selalu berlaku, di samping filter jenis pengguna (irisannya yang lolos).
  const where: string[] = [klausaCakupan(cakupan, "jenis")];
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

  // Tautan lama seperti /telusuri?jenis=PERPRES tidak menghasilkan apa pun; pemanggil diberi tahu sebabnya.
  const luarCakupan = f.jenis?.filter((j) => !dalamCakupan(cakupan, j)).slice(0, 5);

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
    cakupan: [...cakupan],
    ...(luarCakupan?.length ? { di_luar_cakupan: luarCakupan } : {}),
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
  // Baris di luar cakupan masih tersimpan (disembunyikan, bukan dihapus), tetapi tidak disajikan.
  const cakupan = bacaCakupan(c.env.CAKUPAN_JENIS);
  if (!dalamCakupan(cakupan, law.jenis)) {
    return c.json({
      error: "di_luar_cakupan",
      message: `${labelSitasi(law)} di luar cakupan Lexa saat ini (${cakupan.join(", ")}).`,
      cakupan,
    }, 404);
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
    // Relasi ke peraturan di luar cakupan disembunyikan: tautannya hanya akan berujung "di luar cakupan". Tujuan yang
    // barisnya ada dinilai dari kolom `jenis`-nya; yang belum ter-ingest dari URI-nya (hanya yang jelas di luar yang disembunyikan).
    relations: await perbaikiRelasiBeralias(
      c.env.DB,
      relations.results.filter((r) => (r.jenis !== null ? dalamCakupan(cakupan, r.jenis) : !uriJelasDiLuarCakupan(cakupan, r.to_uri))),
    ),
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
  const cakupan = bacaCakupan(c.env.CAKUPAN_JENIS);
  const [laws, populer] = await Promise.all([
    // Kandidatnya lebih banyak dari yang ditampilkan (judul pendek dulu: yang pokoknya sempit lebih mungkin yang dicari),
    // lalu diurutkan seperti tingkat judul pencarian (lib/judul.ts). Tanpa itu, kata yang ada di puluhan judul hanya
    // menampilkan enam yang terbaru, dan peraturan yang memang bernama kata itu ("Kelautan") bisa terpotong.
    c.env.DB.prepare(
      `SELECT frbr_uri, jenis, nomor, tahun, judul, status FROM laws
        WHERE judul LIKE ? COLLATE NOCASE AND ${klausaCakupan(cakupan, "jenis")}
        ORDER BY length(judul), tahun DESC LIMIT ${KANDIDAT_SARAN}`,
    ).bind(`%${pola}`).all<{ frbr_uri: string; jenis: string; nomor: string; tahun: number; judul: string; status: StatusPeraturan }>(),

    c.env.DB.prepare(
      `SELECT query, COUNT(*) AS n FROM search_log
        WHERE query LIKE ? COLLATE NOCASE AND jumlah_hasil > 0
        GROUP BY query ORDER BY n DESC LIMIT 4`,
    ).bind(pola).all<{ query: string; n: number }>(),
  ]);

  const { cocok, lain } = pilahBerjudul(laws.results, uraiKueri(q));
  return c.json({
    suggestions: [
      ...[...cocok, ...lain.sort((a, b) => b.tahun - a.tahun)].slice(0, 6).map((l) => ({
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
type StatusIsi = "lengkap" | "menunggu" | "kosong" | "gagal";
const STATUS_ISI: readonly StatusIsi[] = ["lengkap", "menunggu", "kosong", "gagal"];

api.get("/stats", async (c) => {
  const cakupan = bacaCakupan(c.env.CAKUPAN_JENIS);
  const dalam = klausaCakupan(cakupan, "jenis");
  const hari = new Date().toISOString().slice(0, 10);
  const [ringkasan, terbaru, sync, keadaan] = await Promise.all([
    // Satu pemindaian laws untuk semuanya: jumlah peraturan, pasal, yang terindeks, dan kemajuan isi per jenis dan status.
    // Jumlah pasal dari `laws.jumlah_pasal` (sama dengan COUNT(*) pada articles), bukan menghitung tabel articles:
    // beranda memanggil ini pada setiap kunjungan, dan menghitung puluhan ribu baris pasal setiap kali membebani kuota
    // baca D1 tanpa menambah ketelitian.
    c.env.DB.prepare(
      `SELECT jenis, isi_status, COUNT(*) AS n, COALESCE(SUM(jumlah_pasal), 0) AS pasal,
              COALESCE(SUM(CASE WHEN jumlah_pasal > 0 THEN 1 ELSE 0 END), 0) AS berisi,
              COALESCE(SUM(CASE WHEN indexed_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS terindeks
         FROM laws WHERE ${dalam} GROUP BY jenis, isi_status`,
    ).all<{ jenis: string; isi_status: string; n: number; pasal: number; berisi: number; terindeks: number }>(),

    c.env.DB.prepare(
      `SELECT frbr_uri, jenis, nomor, tahun, judul FROM laws WHERE ${dalam}
        ORDER BY created_at DESC LIMIT 8`,
    ).all<{ frbr_uri: string; jenis: string; nomor: string; tahun: number; judul: string }>(),

    c.env.DB.prepare(
      `SELECT job, status, jumlah, detail, created_at FROM sync_log
        ORDER BY created_at DESC LIMIT 10`,
    ).all<{ job: string; status: string; jumlah: number; detail: string | null; created_at: string }>(),

    // Kemajuan katalog, jeda pasal.id, jejak pemicu, dan statistik hari ini: baris kecil di sync_state.
    c.env.DB.prepare(
      `SELECT key, value FROM sync_state
        WHERE key LIKE 'katalog_%' OR key LIKE 'denyut:%' OR key = 'pasal_tunda_sampai' OR key = 'akses_isi' OR key = ?`,
    ).bind(`statistik:${hari}`).all<{ key: string; value: string }>(),
  ]);

  let laws = 0, articles = 0, terindeks = 0;
  const perJenisMap = new Map<string, number>();
  const isiPerJenis: Record<string, Record<string, number>> = {};
  for (const r of ringkasan.results) {
    laws += r.n;
    articles += r.pasal;
    terindeks += r.terindeks;
    perJenisMap.set(r.jenis, (perJenisMap.get(r.jenis) ?? 0) + r.n);
    // `berisi`: peraturan yang punya teks pasal tersimpan, apa pun statusnya (yang diantrekan ulang untuk diperbaiki tetap berisi).
    const j = (isiPerJenis[r.jenis] ??= { total: 0, pasal: 0, berisi: 0, ...Object.fromEntries(STATUS_ISI.map((st) => [st, 0])) });
    j.total += r.n;
    j.pasal += r.pasal;
    j.berisi += r.berisi;
    if ((STATUS_ISI as readonly string[]).includes(r.isi_status)) j[r.isi_status] += r.n;
  }
  const perJenis = [...perJenisMap.entries()].map(([jenis, n]) => ({ jenis, n })).sort((a, b) => b.n - a.n).slice(0, 15);

  const kv = new Map(keadaan.results.map((r) => [r.key, r.value]));
  const katalog: Record<string, { total_sumber: number | null; selesai: string | null; dukungan: string | null }> = {};
  for (const jenis of Object.keys(isiPerJenis).concat(["UU", "PERPPU", "PP", "UUD", "TAP_MPR"])) {
    if (katalog[jenis]) continue;
    const total = kv.get(`katalog_total:${jenis}`);
    katalog[jenis] = {
      total_sumber: total === undefined ? null : Number(total),
      selesai: kv.get(`katalog_selesai:${jenis}`) ?? null,
      dukungan: kv.get(`katalog_dukungan:${jenis}`) ?? null,
    };
  }
  let hariIni: Record<string, number> = {};
  try {
    hariIni = JSON.parse(kv.get(`statistik:${hari}`) ?? "{}") as Record<string, number>;
  } catch {
    hariIni = {};
  }
  const jeda = kv.get("pasal_tunda_sampai");
  const akses = uraiAkses(kv.get("akses_isi"));

  return c.json({
    cakupan,
    total_peraturan: laws,
    total_pasal: articles,
    terindeks_vektor: terindeks,
    per_jenis: perJenis,
    terbaru: terbaru.results,
    sinkronisasi_terakhir: sync.results,
    // Kemajuan pengisian data: berapa peraturan per jenis yang sudah punya pasal, masih menunggu, kosong di sumber,
    // atau gagal; kemajuan katalog; jeda dari pasal.id; dan kapan tiap pemicu terakhir berjalan.
    isi: {
      per_jenis: isiPerJenis,
      katalog,
      pasal_dijeda_sampai: jeda && jeda > new Date().toISOString() ? jeda : null,
      // pasal.id tak memberi naskah peraturan (token tanpa hak teks lengkap atau kuota baca habis); null bila akses baik.
      akses: akses && { sejak: akses.sejak, terakhir: akses.terakhir, periksa_lagi: akses.periksa_lagi, catatan: akses.catatan.slice(0, 300) },
      hari_ini: hariIni,
      denyut: {
        menit: kv.get("denyut:* * * * *") ?? null,
        harian: kv.get("denyut:0 19 * * *") ?? null,
        antrean: kv.get("denyut:antrean") ?? null,
      },
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/sync — pemicu manual untuk pipeline isi peraturan
//
//   { tik: true }                    jalankan satu tik sekarang dan kembalikan laporannya
//   { uri }                          dahulukan satu peraturan (diambil di tik berikutnya; bila belum ada di D1, diambil sekarang)
//   { jenis: ["UU", ...] }           mulai sapuan katalog ulang untuk jenis itu (tanpa jenis: semua yang dalam cakupan)
//   { perbaiki_celah: true }         dahulukan pengambilan ulang peraturan yang penomoran pasalnya bercelah
//   { ulang_arsip: true }            uraikan ulang semua peraturan yang responsnya sudah diarsipkan (tanpa pasal.id)
//   { ringkas_kosong: true }         susun ringkasan AI untuk yang belum punya
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
    tik?: boolean;
    jenis?: string[];
    uri?: string;
    perbaiki_celah?: boolean;
    ulang_arsip?: boolean;
    ringkas_kosong?: boolean;
    batas?: number;
  };
  const body = await c.req.json<BodySync>().catch(() => ({}) as BodySync);
  const cakupan = bacaCakupan(c.env.CAKUPAN_JENIS);
  const dalam = klausaCakupan(cakupan, "jenis");
  const luarCakupan = (extra: Record<string, unknown>) =>
    c.json({ error: "di_luar_cakupan", message: `Di luar cakupan Lexa saat ini: ${cakupan.join(", ")}.`, cakupan, ...extra }, 400);

  // Satu tik sekarang, untuk diagnosis: laporannya menunjukkan apa yang dikerjakan atau mengapa tidak.
  if (body.tik) {
    const laporan = await jalankanTik(konteksIngest(c.env), { pasalSiap: true });
    return c.json({ status: "selesai", laporan });
  }

  // Dahulukan satu peraturan tertentu.
  if (body.uri) {
    if (uriJelasDiLuarCakupan(cakupan, body.uri)) return luarCakupan({ uri: body.uri });
    const ada = await c.env.DB.prepare(
      `UPDATE laws SET isi_status = 'menunggu', isi_giliran = 0, isi_percobaan = 0 WHERE frbr_uri = ? AND ${dalam}`,
    ).bind(body.uri).run();
    if (ada.meta.changes) return c.json({ status: "didahulukan", uri: body.uri });

    // Belum ada di D1 (katalog belum menjangkaunya): ambil sekarang. Satu permintaan, atas perintah admin.
    const ctx = konteksIngest(c.env);
    let mentah: unknown;
    try {
      mentah = await ctx.pasal.getLawMentah(body.uri);
    } catch (e) {
      if (e instanceof PasalRateLimitError) {
        return c.json({ error: "pasal_batas_laju", message: "pasal.id meminta jeda.", coba_lagi_dalam_ms: e.retryAfterMs }, 429);
      }
      const status = e instanceof PasalApiError ? e.status : 0;
      return c.json({ error: "pasal_galat", message: String(e).slice(0, 300), status_pasal: status || null }, status === 404 ? 404 : 502);
    }
    // Jawaban tanpa naskah karena pembatasan akses bukan peraturan tanpa pasal: tidak disimpan (lib/akses.ts).
    const tanpaNaskah = catatanAksesTerbatas(mentah);
    if (tanpaNaskah !== null) {
      return c.json({ error: "akses_terbatas", message: "pasal.id tidak memberi naskah peraturan ini.", catatan: tanpaNaskah }, 503);
    }
    const detail = uraiDetail(mentah);
    if (!dalamCakupan(cakupan, detail.law.jenis)) return luarCakupan({ uri: body.uri, jenis: detail.law.jenis });
    const arsip = adaSimpulPasal(mentah) && (await arsipkanMentah(ctx.docs, detail.law.frbr_uri, mentah).then(() => true, () => false));
    const hasil = await simpanIsi(ctx.db, detail, arsip);
    if (hasil.diganti) await arsipkanTeksDanIndeks(ctx, detail.law, detail.articles);
    return c.json({ status: "disimpan", uri: detail.law.frbr_uri, pasal: hasil.jumlah, isi_status: hasil.status });
  }

  // Susun ringkasan untuk peraturan yang belum punya.
  if (body.ringkas_kosong) {
    const batas = Math.min(Math.max(body.batas ?? 100, 1), 500);
    const { results } = await c.env.DB.prepare(
      `SELECT frbr_uri FROM laws
        WHERE (ringkasan IS NULL OR TRIM(ringkasan) = '')
          AND (r2_text_key IS NOT NULL OR jumlah_pasal > 0)
          AND ${dalam}
        ORDER BY tahun DESC LIMIT ?`,
    ).bind(batas).all<{ frbr_uri: string }>();

    const pesan = results.map((r) => ({ tipe: "ringkas" as const, frbr_uri: r.frbr_uri }));
    for (let i = 0; i < pesan.length; i += 100) {
      await c.env.INGEST_QUEUE.sendBatch(pesan.slice(i, i + 100).map((b) => ({ body: b })));
    }

    await c.env.DB.prepare(
      `INSERT INTO sync_log (job, status, detail, jumlah) VALUES ('ringkas','sukses',?,?)`,
    ).bind("diantrekan untuk diringkas", results.length).run().catch(() => {});

    return c.json({ status: "diantrekan", peraturan: results.length });
  }

  // Dahulukan pengambilan ulang peraturan yang penomoran pasalnya bercelah.
  //
  // Peraturan yang `isi_status`-nya sudah 'lengkap' tak diambil lagi oleh tik, sehingga dokumen yang tersimpan tidak
  // utuh akan diam di sana selamanya. Celah dideteksi dengan membandingkan nomor pasal tertinggi terhadap jumlah
  // pasal yang benar-benar ada: kalau UU punya Pasal 13 tetapi hanya 12 baris tersimpan, ada yang hilang. (UU
  // perubahan memuat nomor pasal peraturan lain di dalam isinya, jadi sebagian celah wajar; pengambilan ulangnya
  // tak merugikan, hasil yang lebih sedikit tidak menggantikan yang tersimpan.)
  if (body.perbaiki_celah) {
    const batas = Math.min(Math.max(body.batas ?? 200, 1), 1000);
    const { results } = await c.env.DB.prepare(
      `SELECT a.frbr_uri AS frbr_uri,
              MAX(CAST(a.nomor_pasal AS INTEGER)) - COUNT(DISTINCT a.nomor_pasal) AS hilang
         FROM articles a JOIN laws l ON l.frbr_uri = a.frbr_uri
        WHERE a.nomor_pasal GLOB '[0-9]*' AND ${klausaCakupan(cakupan, "l.jenis")}
        GROUP BY a.frbr_uri
       HAVING hilang > 0
        ORDER BY hilang DESC
        LIMIT ?`,
    ).bind(batas).all<{ frbr_uri: string; hilang: number }>();

    const perubahan: D1PreparedStatement[] = results.map((r, i) =>
      c.env.DB.prepare(
        `UPDATE laws SET isi_status = 'menunggu', isi_giliran = ?, isi_percobaan = 0, isi_arsip = 0 WHERE frbr_uri = ?`,
      ).bind(1_000_000 + i, r.frbr_uri),
    );
    for (let i = 0; i < perubahan.length; i += 100) await c.env.DB.batch(perubahan.slice(i, i + 100));

    const perkiraanHilang = results.reduce((n, r) => n + r.hilang, 0);

    // Dicatat supaya terlihat di /status. Tanpa ini tidak ada cara membedakan "perintah tidak pernah dijalankan"
    // dari "sudah dijalankan tapi antreannya masih tertahan rate limit".
    await c.env.DB.prepare(
      `INSERT INTO sync_log (job, status, detail, jumlah)
       VALUES ('perbaiki_celah', 'sukses', ?, ?)`,
    ).bind(`perkiraan ${perkiraanHilang} pasal hilang`, results.length).run().catch(() => {});

    return c.json({
      status: "didahulukan",
      peraturan: results.length,
      perkiraan_pasal_hilang: perkiraanHilang,
    });
  }

  // Uraikan ulang semua peraturan yang responsnya sudah diarsipkan (mis. sesudah pengurai pasal diperbaiki).
  if (body.ulang_arsip) {
    const hasil = await c.env.DB.prepare(
      `UPDATE laws SET isi_status = 'menunggu', isi_percobaan = 0, isi_giliran = ${SQL_GILIRAN}
        WHERE isi_status IN ('lengkap', 'kosong', 'gagal') AND isi_arsip = 1 AND ${dalam}`,
    ).run();
    await c.env.DB.prepare(
      `INSERT INTO sync_log (job, status, detail, jumlah) VALUES ('ulang_arsip','sukses','diuraikan ulang dari arsip',?)`,
    ).bind(hasil.meta.changes).run().catch(() => {});
    return c.json({ status: "dijadwalkan", peraturan: hasil.meta.changes });
  }

  // Sapuan katalog ulang: hapus tanda selesai dan kursornya; tik berikutnya memulai dari awal.
  const diminta = body.jenis?.length ? body.jenis : undefined;
  const diabaikan = diminta?.filter((j) => !dalamCakupan(cakupan, j));
  if (diminta && diabaikan?.length === diminta.length) return luarCakupan({ jenis: diminta });
  const sasaran = (diminta ?? cakupan).filter((j) => dalamCakupan(cakupan, j));
  for (const jenis of sasaran) {
    await c.env.DB.prepare(`DELETE FROM sync_state WHERE key IN (?, ?)`)
      .bind(`katalog_selesai:${jenis}`, `katalog_offset:${jenis}`).run();
  }
  return c.json({ status: "dijadwalkan", jenis: sasaran, ...(diabaikan?.length ? { diabaikan } : {}) });
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
