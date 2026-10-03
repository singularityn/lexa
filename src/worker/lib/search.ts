/**
 * Pencarian hybrid: FTS5 (BM25) + Vectorize (kemiripan makna), digabung dengan
 * Reciprocal Rank Fusion.
 *
 * Mengapa RRF dan bukan penjumlahan skor berbobot: skor BM25 dan skor kosinus
 * hidup di skala yang sama sekali berbeda dan tidak stabil antar-kueri, jadi
 * menjumlahkannya butuh normalisasi yang rapuh. RRF hanya memakai *peringkat*,
 * sehingga kebal terhadap perbedaan skala dan tidak perlu ditera ulang.
 */

import type { SearchHit, SearchFilters, SearchMode, SearchResponse, StatusPeraturan } from "../../shared/types";
import { uraiKueri, kueriUntukEmbedding } from "./query";
import { klausaBidang } from "./bidang";
import { pilihDalam } from "./d1";
import type { Sitasi } from "./sitasi";

/** Konstanta peredam RRF. 60 adalah nilai standar dari makalah Cormack dkk. */
const RRF_K = 60;

/**
 * Bobot per-sumber. FTS sedikit diunggulkan karena istilah legal harus persis.
 *
 * `sitasi` jauh lebih tinggi dan itu disengaja: bila pengguna mengetik
 * "UU 13/2003", ia sudah tahu persis dokumen yang dicarinya. Tidak ada hasil
 * peringkat-teratas dari indeks mana pun yang boleh menggesernya.
 */
const BOBOT = { sitasi: 12.0, fts: 1.0, vector: 0.8 } as const;

export interface KandidatMentah {
  frbr_uri: string;
  article_id: string | null;
  peringkat: number;
  snippet: string | null;
  sumber: "fts" | "vector" | "sitasi";
}

function kunciKandidat(k: { frbr_uri: string; article_id: string | null }): string {
  return k.article_id ?? k.frbr_uri;
}

/** Bangun klausa WHERE untuk filter, beserta parameter terikatnya. */
function bangunFilter(f: SearchFilters, alias = "l"): { sql: string; params: unknown[] } {
  const klausa: string[] = [];
  const params: unknown[] = [];

  if (f.jenis?.length) {
    klausa.push(`${alias}.jenis IN (${f.jenis.map(() => "?").join(",")})`);
    params.push(...f.jenis);
  }
  if (f.status?.length) {
    klausa.push(`${alias}.status IN (${f.status.map(() => "?").join(",")})`);
    params.push(...f.status);
  }
  if (f.tahun_min !== undefined) {
    klausa.push(`${alias}.tahun >= ?`);
    params.push(f.tahun_min);
  }
  if (f.tahun_max !== undefined) {
    klausa.push(`${alias}.tahun <= ?`);
    params.push(f.tahun_max);
  }
  if (f.instansi) {
    klausa.push(`${alias}.instansi = ?`);
    params.push(f.instansi);
  }
  if (f.bidang) {
    // Nilai kolomnya bisa gabungan ("APBN - BUMN"), jadi kecocokannya per
    // bagian — lihat lib/bidang.ts.
    const kb = klausaBidang(`${alias}.bidang`);
    klausa.push(kb.sql);
    params.push(...kb.params(f.bidang));
  }

  return { sql: klausa.length ? ` AND ${klausa.join(" AND ")}` : "", params };
}

/** Cari di level judul/tentang peraturan. */
async function cariFtsPeraturan(
  db: D1Database,
  ekspresi: string,
  filters: SearchFilters,
  limit: number,
): Promise<KandidatMentah[]> {
  const f = bangunFilter(filters);
  // Bobot bm25: judul 3x, tentang 2x, ringkasan 1x — judul paling menentukan.
  const sql = `
    SELECT l.frbr_uri AS frbr_uri,
           snippet(laws_fts, 0, '<mark>', '</mark>', '…', 18) AS snip
      FROM laws_fts
      JOIN laws l ON l.rowid = laws_fts.rowid
     WHERE laws_fts MATCH ?${f.sql}
     ORDER BY bm25(laws_fts, 3.0, 2.0, 1.0)
     LIMIT ?`;

  const { results } = await db
    .prepare(sql)
    .bind(ekspresi, ...f.params, limit)
    .all<{ frbr_uri: string; snip: string | null }>();

  return results.map((r, i) => ({
    frbr_uri: r.frbr_uri,
    article_id: null,
    peringkat: i + 1,
    snippet: r.snip,
    sumber: "fts" as const,
  }));
}

/** Cari di level isi pasal — ini yang biasanya paling berguna bagi pengguna. */
async function cariFtsPasal(
  db: D1Database,
  ekspresi: string,
  filters: SearchFilters,
  limit: number,
): Promise<KandidatMentah[]> {
  const f = bangunFilter(filters);
  const sql = `
    SELECT a.id AS article_id,
           a.frbr_uri AS frbr_uri,
           snippet(articles_fts, 0, '<mark>', '</mark>', '…', 26) AS snip
      FROM articles_fts
      JOIN articles a ON a.rowid = articles_fts.rowid
      JOIN laws l ON l.frbr_uri = a.frbr_uri
     WHERE articles_fts MATCH ?${f.sql}
     ORDER BY bm25(articles_fts, 1.0, 2.0)
     LIMIT ?`;

  const { results } = await db
    .prepare(sql)
    .bind(ekspresi, ...f.params, limit)
    .all<{ article_id: string; frbr_uri: string; snip: string | null }>();

  return results.map((r, i) => ({
    frbr_uri: r.frbr_uri,
    article_id: r.article_id,
    peringkat: i + 1,
    snippet: r.snip,
    sumber: "fts" as const,
  }));
}

/**
 * Pencarian sitasi langsung: "UU 13/2003", "Peraturan Pemerintah Nomor 35 Tahun 2021".
 *
 * Ini cara paling lazim praktisi mencari peraturan, dan indeks teks penuh
 * menanganinya dengan buruk — "13" dan "2003" hanyalah token biasa yang cocok
 * dengan ribuan dokumen lain. Pencarian ini memakai indeks unik
 * `idx_laws_citation` sehingga biayanya satu baris, bukan pemindaian.
 */
async function cariSitasi(db: D1Database, sitasi: Sitasi, filters: SearchFilters): Promise<KandidatMentah[]> {
  const f = bangunFilter(filters);

  // Jenis dicocokkan longgar. Pengurai memetakan "perda" menjadi "PERDA_PROV",
  // sementara basis data bisa menyimpannya sebagai "PERDA" — kalau dicocokkan
  // ketat, sitasi yang sah justru tidak menemukan apa pun.
  const varianJenis = [...new Set([sitasi.jenis, sitasi.jenis.split("_")[0]])];

  // Nomor POJK lama tersimpan sebagai slug ("48-pojk-04-2016"; 422 dari 547 POJK produksi),
  // yang baru polos ("23"). "POJK 48/2016" harus menemukan semua yang berawalan "48-"; bila
  // sektornya disebut ("48/POJK.04/2016") cukup yang persis itu. Rentang [n-, n.) = semua
  // string berawalan "n-" ("." tepat setelah "-"), jadi tetap bisa memakai indeks nomor.
  const slug = sitasi.sub ? `${sitasi.nomor}-pojk-${sitasi.sub}-${sitasi.tahun}` : null;
  const syaratNomor = slug ? "l.nomor IN (?, ?)" : "(l.nomor = ? OR (l.nomor >= ? AND l.nomor < ?))";
  const nomorTerikat = slug ? [slug, sitasi.nomor] : [sitasi.nomor, `${sitasi.nomor}-`, `${sitasi.nomor}.`];

  const { results } = await db
    .prepare(
      `SELECT l.frbr_uri FROM laws l
        WHERE l.jenis IN (${varianJenis.map(() => "?").join(",")})
          AND ${syaratNomor} AND l.tahun = ?${f.sql}
        ORDER BY (l.nomor = ?) DESC, l.nomor
        LIMIT 5`,
    )
    .bind(...varianJenis, ...nomorTerikat, sitasi.tahun, ...f.params, slug ?? sitasi.nomor)
    .all<{ frbr_uri: string }>();

  return results.map((r, i) => ({
    frbr_uri: r.frbr_uri,
    article_id: null,
    peringkat: i + 1,
    snippet: null,
    sumber: "sitasi" as const,
  }));
}

/** Pencarian makna lewat Vectorize. */
async function cariVektor(
  ai: Ai,
  vectorize: VectorizeIndex,
  model: string,
  kueri: string,
  filters: SearchFilters,
  limit: number,
): Promise<KandidatMentah[]> {
  // `ai.run` bertipe union yang menyertakan ReadableStream (untuk model
  // streaming), sehingga perlu dipersempit lewat unknown.
  const embed = (await ai.run(model as keyof AiModels, {
    text: [kueriUntukEmbedding(kueri)],
  } as never)) as unknown as { data: number[][] };

  const vektor = embed?.data?.[0];
  if (!vektor?.length) return [];

  // Vectorize hanya mendukung filter pada metadata yang sudah diindeks
  // (lihat `npm run vectorize:meta`).
  const filter: VectorizeVectorMetadataFilter = {};
  if (filters.jenis?.length) filter.jenis = { $in: filters.jenis };
  if (filters.status?.length) filter.status = { $in: filters.status };

  const hasil = await vectorize.query(vektor, {
    topK: limit,
    returnMetadata: "indexed",
    ...(Object.keys(filter).length ? { filter } : {}),
  });

  return (hasil.matches ?? []).map((m, i) => {
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    return {
      frbr_uri: String(meta.frbr_uri ?? m.id.split("#")[0]),
      article_id: m.id.includes("#") ? m.id : null,
      peringkat: i + 1,
      snippet: null,
      sumber: "vector" as const,
    };
  });
}

/**
 * Rapikan id pasal pada kandidat vektor sebelum fusi.
 *
 * Id di Vectorize tidak selalu id pasal yang sah:
 *  - pasal panjang dipotong untuk embedding, dan potongan lanjutannya berid
 *    `<id pasal>~n` (lihat `indeksVektor`). Tanpa dipetakan, hasilnya berupa "pasal"
 *    fiktif tanpa nomor, ganda dengan potongan pertama, dan menaut ke jangkar yang tidak ada;
 *  - id berakhiran `~n` juga bisa pasal sah: penyaringan id kembar saat ingest memakai
 *    akhiran yang sama (`...-ayat-2~2`). Karena itu keberadaannya di tabel `articles` diperiksa
 *    lebih dulu; yang ada dibiarkan.
 *
 * Id yang tidak ada di tabel dan punya induk yang ada dipetakan ke induknya; yang lain
 * (induk pun tidak ada) turun menjadi hasil tingkat peraturan. Hasil kembar digabung
 * dengan mempertahankan peringkat terbaik. Peringkat dirapatkan kembali agar skor RRF
 * tidak terpengaruh oleh lubang yang ditinggalkan duplikat.
 */
export async function rapikanKandidatVektor(
  db: D1Database,
  kandidat: KandidatMentah[],
): Promise<KandidatMentah[]> {
  const berakhiran = /~\d+$/;
  const curiga = kandidat.filter((k) => k.article_id !== null && berakhiran.test(k.article_id));
  if (!curiga.length) return kandidat;

  // Periksa id apa adanya dan induknya sekaligus.
  const periksa = [...new Set(curiga.flatMap((k) => [k.article_id!, k.article_id!.replace(berakhiran, "")]))];
  const ada = new Set(
    (await pilihDalam<{ id: string }>(db, periksa, (t) => `SELECT id FROM articles WHERE id IN (${t})`)).map((r) => r.id),
  );

  const hasil: KandidatMentah[] = [];
  const terlihat = new Set<string>();
  for (const k of kandidat) {
    let artikel = k.article_id;
    if (artikel !== null && berakhiran.test(artikel) && !ada.has(artikel)) {
      const induk = artikel.replace(berakhiran, "");
      artikel = ada.has(induk) ? induk : null;
    }
    const kunci = artikel ?? k.frbr_uri;
    if (terlihat.has(kunci)) continue;
    terlihat.add(kunci);
    hasil.push({ ...k, article_id: artikel, peringkat: hasil.length + 1 });
  }
  return hasil;
}

/**
 * Gabungkan beberapa daftar terperingkat menjadi satu.
 * Skor akhir = Σ bobot_sumber / (K + peringkat).
 *
 * Diekspor agar perilaku fusi bisa diuji tanpa D1 maupun Vectorize.
 */
export function gabungRRF(daftar: KandidatMentah[][]): Map<string, {
  frbr_uri: string;
  article_id: string | null;
  score: number;
  snippet: string | null;
  sources: Set<"fts" | "vector" | "sitasi">;
}> {
  const gabungan = new Map<string, {
    frbr_uri: string;
    article_id: string | null;
    score: number;
    snippet: string | null;
    sources: Set<"fts" | "vector" | "sitasi">;
  }>();

  for (const kandidatList of daftar) {
    for (const k of kandidatList) {
      const kunci = kunciKandidat(k);
      const kontribusi = BOBOT[k.sumber] / (RRF_K + k.peringkat);
      const ada = gabungan.get(kunci);

      if (ada) {
        ada.score += kontribusi;
        ada.sources.add(k.sumber);
        // Cuplikan dari FTS lebih informatif (sudah ber-<mark>), jadi diutamakan.
        if (!ada.snippet && k.snippet) ada.snippet = k.snippet;
      } else {
        gabungan.set(kunci, {
          frbr_uri: k.frbr_uri,
          article_id: k.article_id,
          score: kontribusi,
          snippet: k.snippet,
          sources: new Set([k.sumber]),
        });
      }
    }
  }

  return gabungan;
}

interface BarisHidrasi {
  frbr_uri: string;
  jenis: string;
  nomor: string;
  tahun: number;
  judul: string;
  tentang: string | null;
  status: StatusPeraturan;
  article_id: string | null;
  nomor_pasal: string | null;
  ayat: string | null;
  isi: string | null;
}

/** Ambil metadata lengkap untuk kandidat yang lolos, dalam satu kueri. */
async function hidrasi(
  db: D1Database,
  kunci: Array<{ frbr_uri: string; article_id: string | null }>,
): Promise<Map<string, BarisHidrasi>> {
  if (!kunci.length) return new Map();

  const uriUnik = [...new Set(kunci.map((k) => k.frbr_uri))];
  const artikelUnik = kunci.map((k) => k.article_id).filter((a): a is string => a !== null);

  const peta = new Map<string, BarisHidrasi>();

  // Metadata peraturan.
  const lawRows = await db
    .prepare(
      `SELECT frbr_uri, jenis, nomor, tahun, judul, tentang, status
         FROM laws WHERE frbr_uri IN (${uriUnik.map(() => "?").join(",")})`,
    )
    .bind(...uriUnik)
    .all<Omit<BarisHidrasi, "article_id" | "nomor_pasal" | "ayat" | "isi">>();

  const lawMap = new Map(lawRows.results.map((r) => [r.frbr_uri, r]));

  // Detail pasal, bila ada kandidat level pasal.
  const artMap = new Map<string, { nomor_pasal: string; ayat: string | null; isi: string }>();
  if (artikelUnik.length) {
    const artRows = await db
      .prepare(
        `SELECT id, nomor_pasal, ayat, isi
           FROM articles WHERE id IN (${artikelUnik.map(() => "?").join(",")})`,
      )
      .bind(...artikelUnik)
      .all<{ id: string; nomor_pasal: string; ayat: string | null; isi: string }>();
    for (const r of artRows.results) {
      artMap.set(r.id, { nomor_pasal: r.nomor_pasal, ayat: r.ayat, isi: r.isi });
    }
  }

  for (const k of kunci) {
    const law = lawMap.get(k.frbr_uri);
    if (!law) continue; // kandidat vektor yatim — peraturannya sudah dihapus
    const art = k.article_id ? artMap.get(k.article_id) : undefined;
    peta.set(k.article_id ?? k.frbr_uri, {
      ...law,
      article_id: k.article_id,
      nomor_pasal: art?.nomor_pasal ?? null,
      ayat: art?.ayat ?? null,
      isi: art?.isi ?? null,
    });
  }

  return peta;
}

export interface OpsiPencarian {
  query: string;
  mode?: SearchMode;
  filters?: SearchFilters;
  limit?: number;
}

export interface KonteksPencarian {
  db: D1Database;
  ai: Ai;
  vectorize: VectorizeIndex;
  cache: KVNamespace;
  embeddingModel: string;
  cacheTtl: number;
}

/**
 * Kunci cache harus ikut memuat filter, kalau tidak hasil bisa tertukar.
 *
 * `bidang` sempat tertinggal dari daftar ini, dan akibatnya persis seperti
 * yang diperingatkan kalimat di atas: mencari "APBN" tanpa filter lalu
 * mengulanginya dengan bidang tertentu mengembalikan hasil yang pertama, utuh
 * beserta dokumen yang seharusnya tersaring. Dari sisi pengguna, filter bidang
 * tampak tidak berfungsi sama sekali — padahal kuerinya tidak pernah dijalankan.
 *
 * Versi kunci dinaikkan ke v2 supaya entri lama yang sudah telanjur salah
 * tidak terpakai lagi setelah perbaikan ini disebar.
 */
export function kunciCache(o: OpsiPencarian): string {
  const f = o.filters ?? {};
  const bagian = [
    o.query.toLowerCase().trim(),
    o.mode ?? "hybrid",
    o.limit ?? 20,
    (f.jenis ?? []).slice().sort().join(","),
    (f.status ?? []).slice().sort().join(","),
    f.tahun_min ?? "",
    f.tahun_max ?? "",
    f.instansi ?? "",
    f.bidang ?? "",
  ];
  return `cari:v2:${bagian.join("|")}`;
}

export async function cari(
  ctx: KonteksPencarian,
  opsi: OpsiPencarian,
): Promise<SearchResponse> {
  const mulai = Date.now();
  const mode = opsi.mode ?? "hybrid";
  const limit = Math.min(Math.max(opsi.limit ?? 20, 1), 50);
  const filters = opsi.filters ?? {};

  const terurai = uraiKueri(opsi.query);
  if (!terurai.fts && mode !== "semantic") {
    return {
      query: opsi.query, mode, hits: [], total: 0,
      durasi_ms: Date.now() - mulai, expanded_terms: [], cached: false,
    };
  }

  // Ambil lebih banyak kandidat dari yang diminta: fusi baru bermakna kalau
  // tiap sumber menyumbang cukup dalam untuk saling melengkapi.
  const kedalaman = Math.min(limit * 3, 100);
  const daftar: KandidatMentah[][] = [];

  // Sitasi diperiksa pada semua mode, termasuk "makna". Pengguna yang mengetik
  // "UU 13/2003" menginginkan dokumen itu, bukan yang menyerupainya — apa pun
  // mode yang kebetulan sedang aktif.
  if (terurai.sitasi) {
    daftar.push(await cariSitasi(ctx.db, terurai.sitasi, filters).catch(() => []));
  }

  if (mode === "hybrid" || mode === "keyword") {
    const [peraturan, pasal] = await Promise.all([
      cariFtsPeraturan(ctx.db, terurai.fts, filters, kedalaman).catch(() => []),
      cariFtsPasal(ctx.db, terurai.fts, filters, kedalaman).catch(() => []),
    ]);
    daftar.push(peraturan, pasal);
  }

  if (mode === "hybrid" || mode === "semantic") {
    const vektor = await cariVektor(
      ctx.ai, ctx.vectorize, ctx.embeddingModel, opsi.query, filters, kedalaman,
    ).catch(() => []); // Vectorize/AI gagal tidak boleh menjatuhkan pencarian keyword
    daftar.push(await rapikanKandidatVektor(ctx.db, vektor).catch(() => vektor));
  }

  const gabungan = gabungRRF(daftar);
  const terurut = [...gabungan.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  const meta = await hidrasi(
    ctx.db,
    terurut.map((t) => ({ frbr_uri: t.frbr_uri, article_id: t.article_id })),
  );

  const hits: SearchHit[] = [];
  const sudahAda = new Set<string>();
  for (const t of terurut) {
    let m = meta.get(t.article_id ?? t.frbr_uri);
    if (!m) continue;
    // Vektor yatim: pasalnya sudah diganti saat peraturan diingest ulang, tetapi vektor lama
    // tidak pernah dihapus dari Vectorize. Tampilkan peraturannya, bukan "pasal" tanpa nomor.
    if (m.article_id !== null && m.nomor_pasal === null) {
      m = { ...m, article_id: null, isi: null };
    }
    const kunciHasil = m.article_id ?? m.frbr_uri;
    if (sudahAda.has(kunciHasil)) continue;
    sudahAda.add(kunciHasil);
    hits.push({
      frbr_uri: m.frbr_uri,
      jenis: m.jenis,
      nomor: m.nomor,
      tahun: m.tahun,
      judul: m.judul,
      tentang: m.tentang,
      status: m.status,
      snippet: t.snippet ?? (m.isi ? `${m.isi.slice(0, 240)}…` : null),
      article_id: m.article_id,
      nomor_pasal: m.nomor_pasal,
      ayat: m.ayat,
      score: Number(t.score.toFixed(6)),
      sources: [...t.sources],
    });
  }

  return {
    query: opsi.query,
    mode,
    hits,
    total: gabungan.size,
    durasi_ms: Date.now() - mulai,
    expanded_terms: terurai.terms,
    cached: false,
  };
}

/** Bungkus `cari` dengan cache KV. */
export async function cariDenganCache(
  ctx: KonteksPencarian,
  opsi: OpsiPencarian,
): Promise<SearchResponse> {
  const kunci = kunciCache(opsi);

  const tersimpan = await ctx.cache.get<SearchResponse>(kunci, "json").catch(() => null);
  if (tersimpan) return { ...tersimpan, cached: true };

  const hasil = await cari(ctx, opsi);

  // Jangan cache hasil kosong: biasanya menandakan indeks belum lengkap,
  // dan menyimpannya akan mengunci pengguna pada jawaban salah selama TTL.
  if (hasil.hits.length > 0) {
    await ctx.cache
      .put(kunci, JSON.stringify(hasil), { expirationTtl: ctx.cacheTtl })
      .catch(() => {});
  }

  return hasil;
}
