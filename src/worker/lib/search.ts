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
import { rapikanNomorPasal } from "../../shared/label";
import { CAKUPAN_BAWAAN, dalamCakupan, klausaCakupan, type Cakupan } from "../../shared/cakupan";
import { uraiKueri, kueriUntukEmbedding, type KueriTerurai } from "./query";
import { pilahBerjudul } from "./judul";
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

/**
 * Kueri yang punya sinonim dicari dua kali: dengan sinonim (`BOBOT_FTS_SINONIM`) dan hanya dengan
 * kata yang diketik pengguna (`BOBOT_FTS_HARFIAH`, lebih berat). Dokumen yang memuat kata itu sendiri
 * dan juga sinonimnya menerima keduanya; yang hanya memuat sinonim, hanya yang pertama. Jumlah
 * keduanya sedikit di atas bobot FTS biasa agar imbangannya terhadap pencarian makna tidak berubah.
 */
const BOBOT_FTS_HARFIAH = 0.9;
const BOBOT_FTS_SINONIM = 0.5;
/** Cadangan longgar (OR) hanya menambah; ia tidak boleh mengalahkan hasil yang cocok seluruh kata. */
const BOBOT_FTS_LONGGAR = 0.4;
/** Bila pencarian ketat (semua kata) menemukan kurang dari ini, pencarian longgar dijalankan. */
const MIN_HASIL_KETAT = 3;
/** Berapa judul teratas menurut BM25 yang diambil sebagai bahan tingkat judul; urutan akhirnya dihitung lib/judul.ts. */
const BAHAN_JUDUL = 100;
/**
 * Daftar judul tidak menyumbang skor RRF: peraturan yang sama sudah dihitung oleh daftar peraturan biasa, dan
 * menghitungnya dua kali membuat judul yang tak kebagian jatah tingkat judul (kata umum, ratusan judul) mengalahkan
 * pasal di tingkat bawah. Daftar ini hanya menjamin peraturannya hadir di fusi (daftar peraturan dipotong pada
 * `kedalaman`, daftar judul sampai `BAHAN_JUDUL`) dan menyediakan cuplikan judul yang menandai kata yang diketik.
 */
const BOBOT_FTS_JUDUL = 0;

export interface KandidatMentah {
  frbr_uri: string;
  article_id: string | null;
  peringkat: number;
  snippet: string | null;
  sumber: "fts" | "vector" | "sitasi";
  /** Menggantikan bobot bawaan sumbernya (lihat BOBOT_FTS_*). */
  bobot?: number;
}

/** Salinan daftar kandidat dengan bobot sendiri. */
const denganBobot = (daftar: KandidatMentah[], bobot: number): KandidatMentah[] => daftar.map((k) => ({ ...k, bobot }));

function kunciKandidat(k: { frbr_uri: string; article_id: string | null }): string {
  return k.article_id ?? k.frbr_uri;
}

/**
 * Bangun klausa WHERE untuk filter, beserta parameter terikatnya.
 *
 * Cakupan (shared/cakupan.ts) selalu ikut, dan sebagai klausa tersendiri di samping filter jenis pengguna: yang
 * lolos adalah irisannya, jadi `?jenis=PERPRES` tidak bisa membuka peraturan di luar cakupan.
 */
function bangunFilter(f: SearchFilters, cakupan: Cakupan, alias = "l"): { sql: string; params: unknown[] } {
  const klausa: string[] = [klausaCakupan(cakupan, `${alias}.jenis`)];
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
  cakupan: Cakupan,
  limit: number,
): Promise<KandidatMentah[]> {
  const f = bangunFilter(filters, cakupan);
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
  cakupan: Cakupan,
  limit: number,
): Promise<KandidatMentah[]> {
  const f = bangunFilter(filters, cakupan);
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
 * Tingkat judul: peraturan yang NAMANYA memuat kata yang diketik (lib/judul.ts).
 *
 * BM25 hanya memilih bahannya (judul yang memuat semua kata). Urutannya dihitung ulang dari kepadatan kata itu pada
 * pokok judul, sebab BM25 menaruh PP tarif PNBP "... Departemen Kelautan dan Perikanan" di atas UU 32/2014 tentang
 * Kelautan. Hasilnya sudah terurut: peringkat 1 yang paling cocok. Petunjuk jenis dalam kueri ("pp kelautan")
 * menyaring jenisnya di sini saja; pencarian pasal dan peraturan lain tidak dibatasi olehnya.
 */
async function cariJudul(
  db: D1Database,
  kueri: KueriTerurai,
  filters: SearchFilters,
  cakupan: Cakupan,
): Promise<KandidatMentah[]> {
  if (!kueri.ftsJudul) return [];
  const f = bangunFilter(filters, cakupan);
  const petunjuk = kueri.jenisPetunjuk.length ? ` AND l.jenis IN (${kueri.jenisPetunjuk.map(() => "?").join(",")})` : "";
  // `{judul} :` membatasi pencocokan ke kolom judul; tentang (yang di produksi sering berisi bidang) dan ringkasan
  // tetap dicari oleh daftar peraturan biasa, di tingkat bawah.
  const sql = `
    SELECT l.frbr_uri AS frbr_uri, l.jenis AS jenis, l.tahun AS tahun, l.judul AS judul, l.status AS status,
           snippet(laws_fts, 0, '<mark>', '</mark>', '…', 18) AS snip
      FROM laws_fts
      JOIN laws l ON l.rowid = laws_fts.rowid
     WHERE laws_fts MATCH ?${f.sql}${petunjuk}
     ORDER BY bm25(laws_fts, 1.0, 0.0, 0.0)
     LIMIT ?`;

  const { results } = await db
    .prepare(sql)
    .bind(`{judul} : (${kueri.ftsJudul})`, ...f.params, ...kueri.jenisPetunjuk, BAHAN_JUDUL)
    .all<{ frbr_uri: string; jenis: string; tahun: number; judul: string; status: StatusPeraturan; snip: string | null }>();

  const { cocok } = pilahBerjudul(results, kueri);
  return cocok.map((r, i) => ({
    frbr_uri: r.frbr_uri,
    article_id: null,
    peringkat: i + 1,
    snippet: r.snip,
    sumber: "fts" as const,
  }));
}

/**
 * Berapa peraturan tingkat judul yang boleh mengisi satu halaman hasil. Sisanya dipertahankan untuk hasil lain supaya
 * kata yang terlalu umum ("pajak", "tarif" ada di ratusan judul) tidak membuat pasal yang memuatnya hilang sama sekali:
 * 15 dari 20 hasil pertama, 37 dari 50. Judul yang tak kebagian jatah tetap bersaing lewat fusi biasa.
 */
export function jatahJudul(limit: number): number {
  return Math.max(Math.ceil(limit / 2), limit - Math.max(5, Math.ceil(limit / 4)));
}

/** Yang dibutuhkan pengurutan bertingkat dari satu entri hasil fusi. */
interface EntriBertingkat {
  frbr_uri: string;
  article_id: string | null;
  score: number;
  sources: ReadonlySet<string>;
}

/**
 * Urutan akhir hasil: tiga tingkat, bukan satu skor.
 *  0. sitasi (bobot RRF-nya sudah jauh di atas yang lain);
 *  1. peraturan yang NAMANYA memuat kata kunci (`judul`: urutan nilai judulnya, sebanyak `jatahJudul(limit)`);
 *  2. semua yang lain menurut skor fusi.
 * Tingkat judul tidak bersaing dengan skor fusi: pasal bisa menerima sumbangan FTS dan vektor sekaligus sedangkan
 * peraturan hanya dari FTS, dan itulah yang membuat UU Kelautan tenggelam di bawah pasal yang menyebut kata itu.
 *
 * Mengembalikan entri terurut beserta predikat `cocokJudul` (entri tingkat 1). Diekspor agar jaminan ini bisa diuji
 * dengan skor sintetis, tanpa bergantung pada statistik korpus.
 */
export function urutkanBertingkat<T extends EntriBertingkat>(
  entri: Iterable<T>,
  judul: readonly Pick<KandidatMentah, "frbr_uri">[],
  limit: number,
): { terurut: T[]; cocokJudul: (t: Pick<T, "article_id" | "frbr_uri">) => boolean } {
  const unggulan = new Map(judul.slice(0, jatahJudul(limit)).map((k, i) => [k.frbr_uri, i] as const));
  const cocokJudul = (t: Pick<T, "article_id" | "frbr_uri">) => t.article_id === null && unggulan.has(t.frbr_uri);
  const tingkat = (t: T) => (t.sources.has("sitasi") ? 0 : cocokJudul(t) ? 1 : 2);
  const terurut = [...entri].sort((a, b) => {
    const ta = tingkat(a);
    const tb = tingkat(b);
    if (ta !== tb) return ta - tb;
    if (ta === 1) return unggulan.get(a.frbr_uri)! - unggulan.get(b.frbr_uri)!;
    return b.score - a.score;
  });
  return { terurut, cocokJudul };
}

/**
 * Pencarian sitasi langsung: "UU 13/2003", "Peraturan Pemerintah Nomor 35 Tahun 2021".
 *
 * Ini cara paling lazim praktisi mencari peraturan, dan indeks teks penuh
 * menanganinya dengan buruk — "13" dan "2003" hanyalah token biasa yang cocok
 * dengan ribuan dokumen lain. Pencarian ini memakai indeks unik
 * `idx_laws_citation` sehingga biayanya satu baris, bukan pemindaian.
 */
async function cariSitasi(db: D1Database, sitasi: Sitasi, filters: SearchFilters, cakupan: Cakupan): Promise<KandidatMentah[]> {
  const f = bangunFilter(filters, cakupan);

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
      const kontribusi = (k.bobot ?? BOBOT[k.sumber]) / (RRF_K + k.peringkat);
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

/**
 * Ambil metadata lengkap untuk kandidat yang lolos, dalam satu kueri.
 * Kandidat yang peraturannya di luar cakupan tidak ikut terambil, jadi tidak muncul di hasil: kolom `jenis`
 * di sini adalah penentu terakhir (kandidat vektor baru disaring kasar lewat URI-nya, lihat `cari`).
 */
async function hidrasi(
  db: D1Database,
  kunci: Array<{ frbr_uri: string; article_id: string | null }>,
  cakupan: Cakupan,
): Promise<Map<string, BarisHidrasi>> {
  if (!kunci.length) return new Map();

  const uriUnik = [...new Set(kunci.map((k) => k.frbr_uri))];
  const artikelUnik = kunci.map((k) => k.article_id).filter((a): a is string => a !== null);

  const peta = new Map<string, BarisHidrasi>();

  // Metadata peraturan.
  const lawRows = await db
    .prepare(
      `SELECT frbr_uri, jenis, nomor, tahun, judul, tentang, status
         FROM laws WHERE frbr_uri IN (${uriUnik.map(() => "?").join(",")}) AND ${klausaCakupan(cakupan, "jenis")}`,
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
      artMap.set(r.id, { nomor_pasal: rapikanNomorPasal(r.nomor_pasal), ayat: r.ayat, isi: r.isi });
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
  /**
   * Peraturan yang namanya memuat kata kunci didahulukan dari hasil lain (tingkat judul; lib/judul.ts). Bawaannya
   * menyala. Tanya Lexa mematikannya: ia hanya memakai pasal, dan peraturan tingkat judul akan menghabiskan
   * jatah hasilnya tanpa membawa satu pasal pun.
   */
  prioritasJudul?: boolean;
}

export interface KonteksPencarian {
  db: D1Database;
  ai: Ai;
  vectorize: VectorizeIndex;
  cache: KVNamespace;
  embeddingModel: string;
  cacheTtl: number;
  /** Jenis peraturan yang boleh muncul di hasil (shared/cakupan.ts). */
  cakupan: Cakupan;
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
 * tidak terpakai lagi setelah perbaikan ini disebar. v3: peringkat kata-yang-diketik di atas sinonim,
 * cadangan longgar, dan penanda `longgar` pada jawaban. v4: cakupan jenis ikut kunci, sehingga hasil lama
 * yang memuat Perpres, Permen, dan POJK tidak disajikan lagi sesudah cakupan dibatasi (dan mengubah
 * `CAKUPAN_JENIS` di kemudian hari tidak perlu menunggu TTL). v5: tingkat judul (peraturan yang namanya memuat kata
 * kunci di atas pasal) dan penanda `cocok_judul` pada hasil; urutan hasil lama tidak boleh disajikan lagi.
 */
export function kunciCache(o: OpsiPencarian, cakupan: Cakupan = CAKUPAN_BAWAAN): string {
  const f = o.filters ?? {};
  const bagian = [
    [...cakupan].sort().join(","),
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
  return `cari:v5:${bagian.join("|")}`;
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
  let longgar: SearchResponse["longgar"];
  /** Peraturan yang namanya memuat kata yang diketik, terbaik lebih dulu (tingkat judul; lib/judul.ts). */
  let judulTerurut: KandidatMentah[] = [];

  // Sitasi diperiksa pada semua mode, termasuk "makna". Pengguna yang mengetik
  // "UU 13/2003" menginginkan dokumen itu, bukan yang menyerupainya — apa pun
  // mode yang kebetulan sedang aktif.
  //
  // Sitasi ke jenis di luar cakupan ("Perpres 12/2020") tidak dicari, tetapi dikabarkan di jawaban agar
  // antarmuka bisa menyatakan terus terang bahwa peraturannya memang tidak dimuat. Pencarian kata tetap
  // jalan: peraturan dalam cakupan yang menyebutnya masih berguna bagi pencari.
  let luarCakupan: string | undefined;
  if (terurai.sitasi) {
    if (dalamCakupan(ctx.cakupan, terurai.sitasi.jenis)) {
      daftar.push(await cariSitasi(ctx.db, terurai.sitasi, filters, ctx.cakupan).catch(() => []));
    } else {
      luarCakupan = terurai.sitasi.jenis;
    }
  }

  if (mode === "hybrid" || mode === "keyword") {
    const adaSinonim = terurai.ftsLiteral !== terurai.fts;
    // Kueri berbentuk sitasi sudah punya daftarnya sendiri, dan nomor serta tahun di dalamnya bukan kata judul.
    const pakaiJudul = opsi.prioritasJudul !== false && !terurai.sitasi;
    const [peraturan, pasal, peraturanHarfiah, pasalHarfiah, judul] = await Promise.all([
      cariFtsPeraturan(ctx.db, terurai.fts, filters, ctx.cakupan, kedalaman).catch(() => []),
      cariFtsPasal(ctx.db, terurai.fts, filters, ctx.cakupan, kedalaman).catch(() => []),
      adaSinonim ? cariFtsPeraturan(ctx.db, terurai.ftsLiteral, filters, ctx.cakupan, kedalaman).catch(() => []) : [],
      adaSinonim ? cariFtsPasal(ctx.db, terurai.ftsLiteral, filters, ctx.cakupan, kedalaman).catch(() => []) : [],
      pakaiJudul ? cariJudul(ctx.db, terurai, filters, ctx.cakupan).catch(() => []) : [],
    ]);
    if (judul.length) {
      // Paling depan: cuplikan judul yang menandai kata yang diketik dipakai bila peraturan yang sama muncul di daftar lain.
      judulTerurut = judul;
      daftar.push(denganBobot(judul, BOBOT_FTS_JUDUL));
    }
    if (adaSinonim) {
      // Daftar harfiah lebih dulu: bila dokumen yang sama muncul di kedua daftar, cuplikannya (yang
      // menandai kata persis yang diketik) yang dipakai.
      daftar.push(
        denganBobot(peraturanHarfiah, BOBOT_FTS_HARFIAH),
        denganBobot(pasalHarfiah, BOBOT_FTS_HARFIAH),
        denganBobot(peraturan, BOBOT_FTS_SINONIM),
        denganBobot(pasal, BOBOT_FTS_SINONIM),
      );
    } else {
      daftar.push(peraturan, pasal);
    }

    // Kueri berbentuk kalimat ("uang pesangon PHK karyawan kontrak") jarang memuat semua katanya di satu
    // pasal. Bila pencarian ketat nyaris kosong, cari lagi dengan salah satu kata, diurutkan BM25
    // (dokumen yang memuat lebih banyak kata langka naik sendiri).
    const kandidatKetat = new Set([...peraturan, ...pasal, ...peraturanHarfiah, ...pasalHarfiah].map(kunciKandidat));
    if (kandidatKetat.size < MIN_HASIL_KETAT && terurai.ftsLonggar) {
      const [peraturanLonggar, pasalLonggar] = await Promise.all([
        cariFtsPeraturan(ctx.db, terurai.ftsLonggar, filters, ctx.cakupan, kedalaman).catch(() => []),
        cariFtsPasal(ctx.db, terurai.ftsLonggar, filters, ctx.cakupan, kedalaman).catch(() => []),
      ]);
      daftar.push(denganBobot(peraturanLonggar, BOBOT_FTS_LONGGAR), denganBobot(pasalLonggar, BOBOT_FTS_LONGGAR));
      if (peraturanLonggar.length + pasalLonggar.length > 0) longgar = { penuh: kandidatKetat.size };
    }
  }

  if (mode === "hybrid" || mode === "semantic") {
    const vektor = await cariVektor(
      ctx.ai, ctx.vectorize, ctx.embeddingModel, opsi.query, filters, kedalaman,
    ).catch(() => []); // Vectorize/AI gagal tidak boleh menjatuhkan pencarian keyword
    // Vektor peraturan yang kini di luar cakupan masih ada di Vectorize dan tidak disaring di sana (filter metadata
    // hanya bekerja untuk vektor yang diunggah setelah indeks metadatanya dibuat, dan itu tak bisa dipastikan dari
    // luar). Mereka gugur di `hidrasi` menurut kolom `jenis`.
    daftar.push(await rapikanKandidatVektor(ctx.db, vektor).catch(() => vektor));
  }

  const gabungan = gabungRRF(daftar);
  // Hidrasi lebih banyak daripada `limit`: kandidat vektor di luar cakupan gugur di `hidrasi`, dan halaman hasil
  // tetap harus penuh bila masih ada kandidat dalam cakupan di bawahnya. Batas 100 mengikuti batas parameter D1.
  const { terurut: semua, cocokJudul } = urutkanBertingkat(gabungan.values(), judulTerurut, limit);
  const terurut = semua.slice(0, Math.min(limit * 2, 100));
  const meta = await hidrasi(
    ctx.db,
    terurut.map((t) => ({ frbr_uri: t.frbr_uri, article_id: t.article_id })),
    ctx.cakupan,
  );

  const hits: SearchHit[] = [];
  const sudahAda = new Set<string>();
  for (const t of terurut) {
    if (hits.length >= limit) break;
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
      ...(cocokJudul(t) ? { cocok_judul: true as const } : {}),
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
    ...(longgar ? { longgar } : {}),
    ...(luarCakupan ? { di_luar_cakupan: { jenis: luarCakupan, cakupan: [...ctx.cakupan] } } : {}),
  };
}

/** Bungkus `cari` dengan cache KV. */
export async function cariDenganCache(
  ctx: KonteksPencarian,
  opsi: OpsiPencarian,
): Promise<SearchResponse> {
  const kunci = kunciCache(opsi, ctx.cakupan);

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
