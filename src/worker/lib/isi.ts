/**
 * Isi peraturan: mengambil detail dari pasal.id, mengarsipkan responsnya, dan menyimpan pasal ke D1.
 *
 * Tiap peraturan membawa statusnya sendiri di tabel `laws` (migrasi 0005-0006), dan tik (lib/tik.ts) mengerjakannya
 * satu per satu menurut `isi_giliran`:
 *
 *   menunggu : isinya perlu diambil dari pasal.id (isi_arsip = 0) atau cukup diuraikan ulang dari arsip (isi_arsip = 1)
 *   lengkap  : pasal tersimpan dari sumber
 *   kosong   : sumber menjawab tanpa pasal; dicoba lagi tiap bulan oleh pemeliharaan harian
 *   gagal    : galat berulang; dicoba lagi tiap beberapa hari
 *
 * Jawaban pasal.id tanpa naskah karena pembatasan akses (lib/akses.ts) bukan peraturan 'kosong': peraturannya dibiarkan
 * 'menunggu', jawabannya tidak diarsipkan, dan pengambilan detail dijeda sampai pemeriksaan berkala memutuskan lain.
 *
 * Dua hal menjaga data yang sudah ada. Penyimpanan tidak pernah mengganti pasal yang tersimpan dengan hasil yang
 * lebih sedikit (respons kosong atau terpotong dari sumber tak boleh menghapus naskah yang baik). Dan respons detail
 * diarsipkan apa adanya di R2 sebelum diuraikan, jadi perbaikan pengurai cukup menguraikan ulang arsip tanpa
 * meminta jatah pasal.id lagi.
 */

import type { Article, Law } from "../../shared/types";
import { dalamCakupan } from "../../shared/cakupan";
import {
  adaSimpulPasal, catatanAksesTerbatas, PasalApiError, PasalRateLimitError, uraiDetail, type DetailPeraturan,
} from "./pasal";
import {
  bacaAkses, periksaAkses, tandaiAksesPulih, tandaiAksesTerbatas, tundaPeriksaAkses, type KeadaanAkses,
} from "./akses";
import { catatDiagnosaIsi } from "./diagnosa";
import type { KonteksIngest } from "./ingest";

export const MAKS_PERCOBAAN = 5;
/** Detail yang dijawab 404 untuk peraturan yang ada di daftar: dua kali cukup untuk menyimpulkan tak ada isinya. */
export const MAKS_PERCOBAAN_404 = 2;
/** Penambah giliran tiap kegagalan: lebih besar dari seluruh rentang giliran normal, jadi yang gagal mengantre paling belakang. */
const DENDA_GAGAL = 1_000_000_000;

// ---------------------------------------------------------------------------
// Urutan pengambilan
// ---------------------------------------------------------------------------

/** Peringkat jenis: makin kecil makin didahulukan. Jenis lain (di luar cakupan sekalipun) paling akhir. */
const PERINGKAT_JENIS: Record<string, number> = { UUD: 0, TAP_MPR: 1, UU: 2, PERPPU: 3, PP: 4 };

/**
 * Giliran pengambilan (kecil dikerjakan dulu): yang terverifikasi pasal.id lebih dulu (pasti punya isi), lalu yang
 * belum diketahui atau tak terverifikasi (sering naskah lama tanpa isi); di dalamnya UUD, Tap MPR, UU, Perppu, PP;
 * di dalamnya yang terbaru. Sama dengan SQL_GILIRAN di bawah, dijaga oleh test.
 */
export function hitungGiliran(jenis: string, tahun: number, diverifikasi: boolean | null): number {
  const tingkat = diverifikasi === true ? 100_000_000 : 200_000_000;
  const tahunTerbatas = Math.min(Math.max(Math.trunc(tahun) || 0, 0), 9999);
  return tingkat + (PERINGKAT_JENIS[jenis] ?? 9) * 10_000_000 + (9999 - tahunTerbatas) * 1_000;
}

/** Rumus yang sama sebagai ekspresi SQL atas kolom laws (jenis, tahun, isi_diverifikasi). */
export const SQL_GILIRAN =
  "(CASE WHEN isi_diverifikasi = 1 THEN 100000000 ELSE 200000000 END)" +
  " + (CASE jenis WHEN 'UUD' THEN 0 WHEN 'TAP_MPR' THEN 1 WHEN 'UU' THEN 2 WHEN 'PERPPU' THEN 3 WHEN 'PP' THEN 4 ELSE 9 END) * 10000000" +
  " + (9999 - MIN(MAX(tahun, 0), 9999)) * 1000";

// ---------------------------------------------------------------------------
// Arsip respons (R2)
// ---------------------------------------------------------------------------

export const kunciMentah = (uri: string) => `mentah/${uri.replace(/^\//, "")}.json.gz`;

async function mampatkan(teks: string): Promise<ArrayBuffer> {
  return new Response(new Blob([teks]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
}

async function uraikanMampat(isi: ArrayBuffer): Promise<string> {
  return new Response(new Blob([isi]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
}

/** Simpan respons detail pasal.id apa adanya (gzip). Mengembalikan ukuran tersimpan. */
export async function arsipkanMentah(docs: R2Bucket, uri: string, json: unknown): Promise<number> {
  const mampat = await mampatkan(JSON.stringify(json));
  await docs.put(kunciMentah(uri), mampat, {
    httpMetadata: { contentType: "application/gzip" },
    customMetadata: { diambil: new Date().toISOString(), sumber: "pasal.id /laws/<uri>" },
  });
  return mampat.byteLength;
}

/** Baca arsip respons; null bila tak ada atau tak terbaca. */
export async function bacaMentah(docs: R2Bucket, uri: string): Promise<unknown | null> {
  const objek = await docs.get(kunciMentah(uri));
  if (!objek) return null;
  try {
    return JSON.parse(await uraikanMampat(await objek.arrayBuffer()));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Penyimpanan
// ---------------------------------------------------------------------------

export interface HasilSimpan {
  /** Jumlah baris pasal tersimpan sesudahnya. */
  jumlah: number;
  /** Baris pasal diganti dengan hasil ini (bukan dipertahankan). */
  diganti: boolean;
  status: "lengkap" | "kosong";
  catatan: string | null;
}

const KARAKTER_PER_POTONGAN = 500;

/** Id vektor potongan lanjutan (`id~n`) yang mungkin ada untuk pasal sepanjang `panjang` karakter (batas atas). */
function idPotongan(id: string, panjang: number, mulai = 1): string[] {
  if (panjang <= 1200) return [];
  const maks = Math.ceil(panjang / KARAKTER_PER_POTONGAN);
  const hasil: string[] = [];
  for (let n = mulai; n <= maks; n++) hasil.push(`${id}~${n}`);
  return hasil;
}

/**
 * Simpan satu peraturan beserta pasal dan relasinya, atomik. Aturan penjaga:
 *  - hasil tanpa pasal tidak menghapus pasal yang sudah tersimpan;
 *  - hasil dengan pasal lebih sedikit dari yang tersimpan tidak menggantinya;
 *  - relasi hanya diganti bila respons memuat relasi.
 * Id vektor pasal yang lenyap karena penggantian dicatat ke daftar hapus (lib/hapus.ts), supaya vektor yatim tak
 * menumpuk di Vectorize.
 */
export async function simpanIsi(
  db: D1Database,
  detail: DetailPeraturan,
  arsip: boolean,
  /** Catatan sumber untuk peraturan tanpa naskah (mis. `content_note` pasal.id), dilekatkan ke catatan hasil. */
  catatanSumber: string | null = null,
): Promise<HasilSimpan> {
  const { law, articles, relations } = detail;
  const ada = await db
    .prepare(`SELECT jumlah_pasal FROM laws WHERE frbr_uri = ?`)
    .bind(law.frbr_uri)
    .first<{ jumlah_pasal: number }>();
  const lama = ada?.jumlah_pasal ?? 0;
  const baru = articles.length;
  const diganti = baru > 0 && baru >= lama;
  const jumlah = diganti ? baru : lama;
  const status: "lengkap" | "kosong" = jumlah > 0 ? "lengkap" : "kosong";

  let catatan: string | null = null;
  if (baru === 0) {
    catatan = lama > 0 ? `sumber tak memberi pasal; ${lama} pasal tersimpan dipertahankan (${detail.pohon})` : detail.pohon;
    if (catatanSumber) catatan = `${catatan} [${catatanSumber}]`.slice(0, 600);
  } else if (!diganti) catatan = `sumber memberi ${baru} pasal, kurang dari ${lama} tersimpan; yang tersimpan dipertahankan (${detail.pohon})`;

  const pernyataan: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO laws (
           frbr_uri, jenis, nomor, tahun, judul, tentang, status,
           tanggal_penetapan, tanggal_berlaku, instansi, bidang,
           bpk_id, sumber_url, ringkasan, jumlah_pasal, isi_giliran, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
         ON CONFLICT(frbr_uri) DO UPDATE SET
           jenis=excluded.jenis, nomor=excluded.nomor, tahun=excluded.tahun,
           judul=excluded.judul, tentang=COALESCE(excluded.tentang, laws.tentang), status=excluded.status,
           tanggal_penetapan=COALESCE(excluded.tanggal_penetapan, laws.tanggal_penetapan),
           tanggal_berlaku=COALESCE(excluded.tanggal_berlaku, laws.tanggal_berlaku),
           instansi=COALESCE(excluded.instansi, laws.instansi), bidang=COALESCE(excluded.bidang, laws.bidang),
           bpk_id=COALESCE(excluded.bpk_id, laws.bpk_id), sumber_url=COALESCE(excluded.sumber_url, laws.sumber_url),
           jumlah_pasal=excluded.jumlah_pasal, updated_at=datetime('now')`,
      )
      .bind(
        law.frbr_uri, law.jenis, law.nomor, law.tahun, law.judul, law.tentang,
        law.status, law.tanggal_penetapan, law.tanggal_berlaku, law.instansi,
        law.bidang, law.bpk_id, law.sumber_url, law.ringkasan, jumlah,
        hitungGiliran(law.jenis, law.tahun, detail.terverifikasi),
      ),
  ];

  if (diganti) {
    const { results: lamaBaris } = await db
      .prepare(`SELECT id, length(isi) AS panjang FROM articles WHERE frbr_uri = ?`)
      .bind(law.frbr_uri)
      .all<{ id: string; panjang: number }>();
    const idBaru = new Map(articles.map((a) => [a.id, a.isi.length]));
    const yatim: string[] = [];
    for (const r of lamaBaris) {
      if (!idBaru.has(r.id)) yatim.push(r.id, ...idPotongan(r.id, r.panjang));
      else {
        // Id yang bertahan tetapi pasalnya kini lebih pendek: potongan lanjutan di atas batas atas yang baru yatim.
        const maksBaru = idPotongan(r.id, idBaru.get(r.id) ?? 0).length;
        yatim.push(...idPotongan(r.id, r.panjang, maksBaru + 1));
      }
    }

    pernyataan.push(db.prepare(`DELETE FROM articles WHERE frbr_uri = ?`).bind(law.frbr_uri));
    for (const a of articles) {
      pernyataan.push(
        db
          .prepare(
            `INSERT INTO articles (id, frbr_uri, nomor_pasal, ayat, bab, bagian, judul, isi, urutan)
             VALUES (?,?,?,?,?,?,?,?,?)`,
          )
          .bind(a.id, a.frbr_uri, a.nomor_pasal, a.ayat, a.bab, a.bagian, a.judul, a.isi, a.urutan),
      );
    }
    for (let i = 0; i < yatim.length; i += 90) {
      const potong = yatim.slice(i, i + 90);
      pernyataan.push(
        db
          .prepare(`INSERT OR IGNORE INTO daftar_hapus (jenis_objek, kunci) VALUES ${potong.map(() => "('vektor', ?)").join(",")}`)
          .bind(...potong),
      );
    }
  }

  if (relations.length) {
    pernyataan.push(db.prepare(`DELETE FROM relations WHERE from_uri = ?`).bind(law.frbr_uri));
    for (const r of relations) {
      pernyataan.push(
        db
          .prepare(`INSERT OR IGNORE INTO relations (from_uri, to_uri, jenis_relasi, keterangan) VALUES (?,?,?,?)`)
          .bind(law.frbr_uri, r.to_uri, r.jenis_relasi, r.keterangan),
      );
    }
  }

  pernyataan.push(
    db
      .prepare(
        `UPDATE laws SET isi_status = ?, isi_percobaan = 0, isi_dicoba_at = datetime('now'), isi_diambil_at = datetime('now'),
                         isi_akses = ?, isi_catatan = ?, isi_arsip = ?, isi_diverifikasi = COALESCE(?, isi_diverifikasi)
          WHERE frbr_uri = ?`,
      )
      .bind(
        status, detail.akses, catatan, arsip ? 1 : 0,
        detail.terverifikasi === null ? null : detail.terverifikasi ? 1 : 0,
        law.frbr_uri,
      ),
  );

  await db.batch(pernyataan);
  return { jumlah, diganti, status, catatan };
}

/** Teks lengkap ke R2 (arsip yang dibaca buatRingkasan dan GET /api/dokumen), lalu antrekan pengindeksan vektor. */
export async function arsipkanTeksDanIndeks(ctx: KonteksIngest, law: Law, articles: Article[]): Promise<void> {
  const teksLengkap = articles
    .map((a) => `Pasal ${a.nomor_pasal}${a.ayat ? ` ayat (${a.ayat})` : ""}\n${a.isi}`)
    .join("\n\n");
  const kunci = `teks/${law.frbr_uri.replace(/^\//, "")}.txt`;
  await ctx.docs
    .put(kunci, teksLengkap, {
      httpMetadata: { contentType: "text/plain; charset=utf-8" },
      customMetadata: { judul: law.judul.slice(0, 200), jenis: law.jenis },
    })
    .then(() => ctx.db.prepare(`UPDATE laws SET r2_text_key = ? WHERE frbr_uri = ?`).bind(kunci, law.frbr_uri).run())
    .catch(() => {});
  // Pengindeksan vektor dipisah ke pesan sendiri: ia memanggil Workers AI dan bisa jauh lebih lambat, jadi tidak
  // boleh membuat penyimpanan D1 ikut diulang.
  await ctx.queue.send({ tipe: "indeks_vektor", frbr_uri: law.frbr_uri });
}

/**
 * Catat satu percobaan yang gagal: giliran mundur, dan sesudah cukup percobaan statusnya menjadi 'gagal' (404: 'kosong').
 * Peraturan yang sudah punya pasal tersimpan (diantrekan ulang untuk diperbaiki) kembali menjadi 'lengkap': teksnya
 * tetap ada, dan percobaan berikutnya ditentukan pemeliharaan harian.
 */
export async function catatKegagalan(db: D1Database, uri: string, e: unknown): Promise<void> {
  const tidakAda = e instanceof PasalApiError && e.status === 404;
  const batas = tidakAda ? MAKS_PERCOBAAN_404 : MAKS_PERCOBAAN;
  const sudah = tidakAda ? "kosong" : "gagal";
  await db
    .prepare(
      `UPDATE laws SET isi_percobaan = isi_percobaan + 1, isi_dicoba_at = datetime('now'),
              isi_catatan = ?, isi_giliran = isi_giliran + ?,
              isi_status = CASE WHEN isi_percobaan + 1 >= ? THEN (CASE WHEN jumlah_pasal > 0 THEN 'lengkap' ELSE ? END) ELSE 'menunggu' END
        WHERE frbr_uri = ?`,
    )
    .bind(String(e).slice(0, 300), DENDA_GAGAL, batas, sudah, uri)
    .run();
}

// ---------------------------------------------------------------------------
// Langkah tik
// ---------------------------------------------------------------------------

export interface OpsiIsi {
  /** Paling banyak berapa detail diambil dari pasal.id. Nol bila pasal.id sedang dijeda atau tak boleh dihubungi. */
  maksAmbil: number;
  /** Paling banyak berapa peraturan diuraikan ulang dari arsip (tanpa pasal.id). */
  maksUrai: number;
  /** Batas waktu langkah ini; sesudahnya berhenti walau anggaran belum habis. */
  batasMs: number;
  /** Waktu tik (ms); bawaannya sekarang. Menentukan kapan pemeriksaan akses isi berikut jatuh tempo. */
  sekarang?: number;
}

export interface LaporanIsi {
  diambil: number;
  diurai: number;
  lengkap: number;
  kosong: number;
  dipertahankan: number;
  gagal: number;
  /** pasal.id minta jeda sekian milidetik (429). */
  tundaMs?: number;
  /** 401/403: token ditolak; langkah berhenti dan tik menunda pasal.id lebih lama. */
  ditolak?: number;
  /** pasal.id tidak memberi naskah (lib/akses.ts): catatannya. Pengambilan detail berhenti dan dijeda. */
  aksesTerbatas?: string;
  /** Pembatasan akses yang tercatat sebelumnya sudah lepas. */
  aksesPulih?: boolean;
}

interface BarisAntre {
  frbr_uri: string;
  jenis: string;
}

/** Simpan hasil uraian satu peraturan, lalu lanjutkan ke arsip teks dan pengindeksan. Melempar bila gagal. */
async function kerjakan(
  ctx: KonteksIngest,
  baris: BarisAntre,
  detail: DetailPeraturan,
  arsip: boolean,
  laporan: LaporanIsi,
  catatanSumber: string | null = null,
): Promise<void> {
  if (detail.law.frbr_uri !== baris.frbr_uri) {
    // Selisih huruf besar/kecil atau garis miring di ujung bukan peraturan lain: kunci katalog yang dipakai, supaya baris
    // yang diminta itulah yang terisi dan keluar dari antrean. Selisih yang lain berarti sumber menjawab peraturan lain.
    const bentuk = (u: string) => String(u).trim().toLowerCase().replace(/\/+$/, "");
    if (bentuk(detail.law.frbr_uri) !== bentuk(baris.frbr_uri)) {
      throw new Error(`pasal.id menjawab peraturan lain: diminta ${baris.frbr_uri}, diterima ${detail.law.frbr_uri}`);
    }
    detail.law.frbr_uri = baris.frbr_uri;
    for (const a of detail.articles) a.frbr_uri = baris.frbr_uri;
  }
  // Jenis di baris D1 dan di respons seharusnya sama; bila tidak, yang menentukan adalah jenis dari sumber.
  if (!dalamCakupan(ctx.cakupan, detail.law.jenis)) {
    await ctx.db
      .prepare(`UPDATE laws SET isi_status = 'kosong', isi_catatan = ?, isi_dicoba_at = datetime('now') WHERE frbr_uri = ?`)
      .bind(`di luar cakupan (${detail.law.jenis})`, baris.frbr_uri)
      .run();
    laporan.kosong++;
    return;
  }

  const hasil = await simpanIsi(ctx.db, detail, arsip, catatanSumber);
  if (hasil.status === "kosong") laporan.kosong++;
  else if (hasil.diganti) laporan.lengkap++;
  else laporan.dipertahankan++;
  if (hasil.diganti) await arsipkanTeksDanIndeks(ctx, detail.law, detail.articles);
}

/**
 * Kerjakan antrean isi: ambil detail yang belum ada dari pasal.id (paling banyak `maksAmbil`), lalu uraikan ulang
 * dari arsip (paling banyak `maksUrai`). Kegagalan satu peraturan hanya menggeser giliran peraturan itu; 429 dan
 * 401/403 menghentikan pengambilan dan dilaporkan ke tik, yang menyimpan jedanya. Jawaban tanpa naskah karena
 * pembatasan akses (lib/akses.ts) juga menghentikan pengambilan, tanpa menyentuh peraturan yang diminta.
 */
export async function langkahIsi(ctx: KonteksIngest, opsi: OpsiIsi): Promise<LaporanIsi> {
  const mulai = Date.now();
  const sekarang = opsi.sekarang ?? mulai;
  const laporan: LaporanIsi = { diambil: 0, diurai: 0, lengkap: 0, kosong: 0, dipertahankan: 0, gagal: 0 };
  // Satu peraturan dicoba paling banyak sekali per tik: yang gagal tak boleh langsung dicoba lagi (peraturan yang
  // gilirannya sudah mundur tetap bisa jadi yang terdepan bila antreannya pendek), karena itu menghabiskan jatah
  // pasal.id dan percobaannya sekaligus dalam satu menit.
  const sudahDicoba: string[] = [];
  const berikut = (arsip: 0 | 1) =>
    ctx.db
      .prepare(
        `SELECT frbr_uri, jenis FROM laws WHERE isi_status = 'menunggu' AND isi_arsip = ?
            ${sudahDicoba.length ? `AND frbr_uri NOT IN (${sudahDicoba.map(() => "?").join(",")})` : ""}
          ORDER BY isi_giliran LIMIT 1`,
      )
      .bind(arsip, ...sudahDicoba)
      .first<BarisAntre>();
  /** Galat pasal.id yang menghentikan pengambilan dan diteruskan ke tik; true bila galat ini salah satunya. */
  const hentikan = (e: unknown): boolean => {
    if (e instanceof PasalRateLimitError) {
      laporan.tundaMs = e.retryAfterMs;
      return true;
    }
    if (e instanceof PasalApiError && (e.status === 401 || e.status === 403)) {
      laporan.ditolak = e.status;
      return true;
    }
    return false;
  };

  let anggaran = opsi.maksAmbil;
  let akses: KeadaanAkses | null = anggaran > 0 ? await bacaAkses(ctx.db) : null;
  if (akses && akses.periksa_lagi > new Date(sekarang).toISOString()) anggaran = 0; // masih dijeda
  else if (akses) {
    // Jeda habis: tanya pasal.id lagi lewat peraturan pembanding sebelum menyentuh antrean.
    try {
      const { putusan, catatan } = await periksaAkses(ctx.db, ctx.pasal);
      if (putusan === "terbatas") {
        laporan.aksesTerbatas = (await tandaiAksesTerbatas(ctx.db, catatan ?? akses.catatan, sekarang)).catatan;
        anggaran = 0;
      } else if (putusan === "baik") {
        await tandaiAksesPulih(ctx.db);
        laporan.aksesPulih = true;
        akses = null;
        anggaran--; // permintaan pembanding memakai jatah
      }
      // "tak_diketahui": tak ada pembanding; peraturan di depan antrean yang memutuskan.
    } catch (e) {
      anggaran = 0;
      if (!hentikan(e)) await tundaPeriksaAkses(ctx.db, sekarang);
    }
  }

  for (let i = 0; i < anggaran && Date.now() - mulai < opsi.batasMs; i++) {
    const baris = await berikut(0);
    if (!baris) break;
    sudahDicoba.push(baris.frbr_uri);
    if (!dalamCakupan(ctx.cakupan, baris.jenis)) {
      // Cakupan dipersempit sesudah katalog terisi: peraturannya tak perlu diambil.
      await ctx.db
        .prepare(`UPDATE laws SET isi_status = 'kosong', isi_catatan = 'di luar cakupan' WHERE frbr_uri = ?`)
        .bind(baris.frbr_uri)
        .run();
      continue;
    }
    try {
      const mentah = await ctx.pasal.getLawMentah(baris.frbr_uri);
      const tanpaNaskah = catatanAksesTerbatas(mentah);
      if (tanpaNaskah !== null) {
        // Pembatasan menyeluruh atau peraturan yang memang tanpa naskah? Pembanding yang naskahnya sudah tersimpan
        // memutuskan. Tanpa kepastian, yang aman adalah menganggapnya pembatasan: peraturan ini tidak disentuh.
        let putusan: Awaited<ReturnType<typeof periksaAkses>>["putusan"] = "tak_diketahui";
        try {
          putusan = (await periksaAkses(ctx.db, ctx.pasal)).putusan;
        } catch (e) {
          if (hentikan(e)) break;
        }
        if (putusan !== "baik") {
          laporan.aksesTerbatas = (await tandaiAksesTerbatas(ctx.db, tanpaNaskah, sekarang)).catatan;
          break;
        }
        if (akses) {
          await tandaiAksesPulih(ctx.db);
          laporan.aksesPulih = true;
          akses = null;
        }
      }
      laporan.diambil++;
      const adaNaskah = adaSimpulPasal(mentah);
      if (adaNaskah && akses) {
        await tandaiAksesPulih(ctx.db);
        laporan.aksesPulih = true;
        akses = null;
      }
      // Arsip lebih dulu dari penguraian: sesudah ini jatah pasal.id tak perlu dipakai lagi untuk peraturan ini, dan
      // jawaban yang belum terurai dengan benar tetap bisa diuraikan ulang oleh pengurai yang lebih baik. Jawaban
      // tanpa simpul pasal tidak diarsipkan: tak ada yang bisa diuraikan ulang darinya.
      const diarsipkan = adaNaskah
        ? await arsipkanMentah(ctx.docs, baris.frbr_uri, mentah).then(() => true, () => false)
        : false;
      if (adaNaskah) await catatDiagnosaIsi(ctx.db, baris.frbr_uri, mentah).catch(() => {});
      await kerjakan(ctx, baris, uraiDetail(mentah), diarsipkan, laporan, tanpaNaskah);
    } catch (e) {
      if (hentikan(e)) break;
      laporan.gagal++;
      console.error("Lexa: isi peraturan gagal diambil", baris.frbr_uri, e);
      await catatKegagalan(ctx.db, baris.frbr_uri, e);
    }
  }

  for (let i = 0; i < opsi.maksUrai && Date.now() - mulai < opsi.batasMs; i++) {
    const baris = await berikut(1);
    if (!baris) break;
    sudahDicoba.push(baris.frbr_uri);
    try {
      const mentah = await bacaMentah(ctx.docs, baris.frbr_uri);
      if (mentah === null) {
        // Arsipnya hilang atau rusak: kembali ke antrean pengambilan.
        await ctx.db.prepare(`UPDATE laws SET isi_arsip = 0 WHERE frbr_uri = ?`).bind(baris.frbr_uri).run();
        continue;
      }
      laporan.diurai++;
      await kerjakan(ctx, baris, uraiDetail(mentah), true, laporan);
    } catch (e) {
      laporan.gagal++;
      console.error("Lexa: arsip peraturan gagal diuraikan", baris.frbr_uri, e);
      await catatKegagalan(ctx.db, baris.frbr_uri, e);
    }
  }
  return laporan;
}
