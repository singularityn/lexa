/**
 * Pipeline ingest di sisi Worker: PDF hasil panen BPK -> pasal di D1 -> vektor di Vectorize dan ringkasan AI.
 *
 * Worker tidak pernah menghubungi sumber data mana pun. PDF diunggah dari sesi peramban pengelola
 * (scripts/bpk-console-harvest.js, lewat PUT /api/impor/pdf), lalu pekerjaan di bawah dikerjakan konsumer antrean
 * Cloudflare Queues; semuanya aman diulang:
 *   - `ekstrak_pdf`   : PDF dari impor BPK -> teks (Workers AI toMarkdown) -> pasal terstruktur dan Penjelasan-nya;
 *   - `indeks_vektor` : embedding semua pasal sebuah peraturan lalu upsert ke Vectorize (Workers AI);
 *   - `ringkas`       : ringkasan AI sebuah peraturan.
 * Pesan jenis lain (sisa antrean dari alur sumber lama: `peraturan`, `tik`) dibuang tanpa dikerjakan.
 */

import { labelSitasi } from "../../shared/label";
import { dalamCakupan, uriJelasDiLuarCakupan, type Cakupan } from "../../shared/cakupan";
import {
  idPasalUnik, nilaiKualitasEkstraksi, periksaKecocokanNaskah, uraikanPasal, VERSI_PARSER, type LaporanKualitas, type PasalTerurai,
} from "./bpk";
import { bersihkanHalaman } from "./halaman";
import { barisPenjelasan, uraikanPenjelasan } from "./penjelasan";

export type PesanIngest =
  | { tipe: "indeks_vektor"; frbr_uri: string }
  | { tipe: "ekstrak_pdf"; frbr_uri: string; r2_key: string; dari_teks?: boolean }
  | { tipe: "ringkas"; frbr_uri: string };

/** Ukuran potongan teks untuk embedding. bge-m3 kuat di teks pendek-menengah. */
const MAKS_KARAKTER_CHUNK = 1200;

export interface KonteksIngest {
  db: D1Database;
  vectorize: VectorizeIndex;
  ai: Ai;
  docs: R2Bucket;
  queue: Queue<PesanIngest>;
  embeddingModel: string;
  summaryModel: string;
  /** Jenis peraturan yang boleh masuk (shared/cakupan.ts). Yang lain tidak diimpor, diekstrak, maupun diindeks. */
  cakupan: Cakupan;
}

async function catatLog(
  db: D1Database,
  job: string,
  status: "mulai" | "sukses" | "gagal",
  detail: string | null,
  jumlah = 0,
  durasiMs?: number,
) {
  await db
    .prepare(
      `INSERT INTO sync_log (job, status, detail, jumlah, durasi_ms)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(job, status, detail, jumlah, durasiMs ?? null)
    .run()
    .catch(() => {});
}

/** Potong teks panjang di batas kalimat agar embedding tidak terputus di tengah. */
export function potongTeks(teks: string, maks = MAKS_KARAKTER_CHUNK): string[] {
  if (teks.length <= maks) return [teks];

  const potongan: string[] = [];
  let sisa = teks;

  while (sisa.length > maks) {
    const jendela = sisa.slice(0, maks);
    // Cari batas kalimat terakhir; kalau tak ada, jatuh ke spasi terakhir.
    const batas = Math.max(
      jendela.lastIndexOf(". "),
      jendela.lastIndexOf(";"),
      jendela.lastIndexOf("\n"),
    );
    const titik = batas > maks * 0.5 ? batas + 1 : jendela.lastIndexOf(" ");
    const potong = titik > 0 ? titik : maks;
    potongan.push(sisa.slice(0, potong).trim());
    sisa = sisa.slice(potong).trim();
  }
  if (sisa) potongan.push(sisa);

  return potongan.filter((p) => p.length > 0);
}

/** Bangun vektor untuk seluruh pasal sebuah peraturan lalu upsert ke Vectorize. */
export async function indeksVektor(ctx: KonteksIngest, frbrUri: string): Promise<number> {
  const law = await ctx.db
    .prepare(`SELECT jenis, nomor, tahun, judul, status FROM laws WHERE frbr_uri = ?`)
    .bind(frbrUri)
    .first<{ jenis: string; nomor: string; tahun: number; judul: string; status: string }>();
  // Peraturan di luar cakupan tidak diindeks: panggilan embedding Workers AI dan vektor tersimpan adalah beban terbesar.
  if (!law || !dalamCakupan(ctx.cakupan, law.jenis)) return 0;

  const { results: articles } = await ctx.db
    .prepare(`SELECT id, nomor_pasal, ayat, isi FROM articles WHERE frbr_uri = ? ORDER BY urutan`)
    .bind(frbrUri)
    .all<{ id: string; nomor_pasal: string; ayat: string | null; isi: string }>();

  const sitasi = labelSitasi(law);

  // Selalu indeks judul peraturan sebagai satu vektor tersendiri, supaya kueri
  // bergaya "aturan tentang X" tetap menemukan dokumen meski tanpa pasal.
  const teksUntukEmbed: Array<{ id: string; teks: string }> = [
    { id: frbrUri, teks: `${sitasi} — ${law.judul}` },
  ];

  for (const a of articles) {
    const konteks = `${sitasi} Pasal ${a.nomor_pasal}${a.ayat ? ` ayat (${a.ayat})` : ""}`;
    // Sertakan konteks di teks yang di-embed: tanpa itu, pasal pendek seperti
    // "Cukup jelas." jadi tak terbedakan antar-peraturan.
    for (const [i, potongan] of potongTeks(a.isi).entries()) {
      teksUntukEmbed.push({
        id: i === 0 ? a.id : `${a.id}~${i}`,
        teks: `${konteks}. ${potongan}`,
      });
    }
  }

  let jumlah = 0;
  // Workers AI membatasi jumlah teks per panggilan; 25 aman dan tetap efisien.
  for (let i = 0; i < teksUntukEmbed.length; i += 25) {
    const batch = teksUntukEmbed.slice(i, i + 25);
    const hasil = (await ctx.ai.run(ctx.embeddingModel as keyof AiModels, {
      text: batch.map((b) => b.teks),
    } as never)) as unknown as { data: number[][] };

    const vektor: VectorizeVector[] = batch.map((b, j) => ({
      id: b.id,
      values: hasil.data[j],
      metadata: {
        frbr_uri: frbrUri,
        jenis: law.jenis,
        tahun: law.tahun,
        status: law.status,
      },
    }));

    await ctx.vectorize.upsert(vektor);
    jumlah += vektor.length;
  }

  await ctx.db
    .prepare(`UPDATE laws SET indexed_at = datetime('now') WHERE frbr_uri = ?`)
    .bind(frbrUri)
    .run();

  return jumlah;
}

/** Simpan hasil pengukuran mutu ekstraksi untuk satu dokumen. */
async function catatEkstraksi(
  db: D1Database,
  frbrUri: string,
  r2Key: string,
  ukuranPdf: number,
  laporan: LaporanKualitas | null,
  durasiMs: number,
  catatan: string | null,
) {
  await db
    .prepare(
      `INSERT INTO ekstraksi_log (
         frbr_uri, r2_pdf_key, ukuran_pdf, panjang_teks, jumlah_pasal, jumlah_ayat,
         pasal_tertinggi, celah_pasal, angka_tercemar, simbol_liar, artefak_halaman,
         kerusakan_per_1000, vonis, durasi_ms, catatan, tahun_dokumen, created_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
                 (SELECT tahun FROM laws WHERE frbr_uri = ?), datetime('now'))
       ON CONFLICT(frbr_uri) DO UPDATE SET
         r2_pdf_key=excluded.r2_pdf_key, ukuran_pdf=excluded.ukuran_pdf,
         panjang_teks=excluded.panjang_teks, jumlah_pasal=excluded.jumlah_pasal,
         jumlah_ayat=excluded.jumlah_ayat, pasal_tertinggi=excluded.pasal_tertinggi,
         celah_pasal=excluded.celah_pasal, angka_tercemar=excluded.angka_tercemar,
         simbol_liar=excluded.simbol_liar, artefak_halaman=excluded.artefak_halaman,
         kerusakan_per_1000=excluded.kerusakan_per_1000, vonis=excluded.vonis,
         durasi_ms=excluded.durasi_ms, catatan=excluded.catatan,
         created_at=datetime('now')`,
    )
    .bind(
      frbrUri, r2Key, ukuranPdf,
      laporan?.panjang_teks ?? 0, laporan?.jumlah_pasal ?? 0, laporan?.jumlah_ayat ?? 0,
      laporan?.pasal_tertinggi ?? 0, laporan?.celah_pasal ?? 0,
      laporan?.angka_tercemar ?? 0, laporan?.simbol_liar ?? 0, laporan?.artefak_halaman ?? 0,
      laporan?.kerusakan_per_1000 ?? 0, laporan?.vonis ?? "gagal",
      durasiMs, catatan, frbrUri,
    )
    .run()
    .catch(() => {});
}

/**
 * Catat versi pengurai yang memproses naskah ini (VERSI_PARSER), pada setiap hasil penguraian: berhasil, tanpa pasal,
 * ditolak, maupun hasil yang tidak dipakai. Peraturan yang sudah diurai dengan versi terkini tak ditawarkan lagi oleh
 * ekstrak-ulang mode `usang`. Pernyataan terpisah dan galatnya ditahan: kolom ini baru ada setelah migrasi 0007.
 */
async function catatVersiParser(db: D1Database, frbrUri: string) {
  await db
    .prepare(`UPDATE ekstraksi_log SET versi_parser = ? WHERE frbr_uri = ?`)
    .bind(VERSI_PARSER, frbrUri)
    .run()
    .catch(() => {});
}

/**
 * Penjelasan peraturan menggantikan yang tersimpan (tabel `penjelasan`, migrasi 0007). Ditulis terpisah dari pasal dan galatnya
 * ditahan: tabel baru ada setelah migrasi, dan pasal yang sudah tersimpan tak boleh gagal karenanya.
 */
async function simpanPenjelasan(db: D1Database, frbrUri: string, baris: ReturnType<typeof barisPenjelasan>): Promise<boolean> {
  try {
    await db.batch([
      db.prepare(`DELETE FROM penjelasan WHERE frbr_uri = ?`).bind(frbrUri),
      ...baris.map((b) =>
        db
          .prepare(`INSERT INTO penjelasan (frbr_uri, nomor_pasal, isi, urutan) VALUES (?,?,?,?)`)
          .bind(frbrUri, b.nomor_pasal, b.isi, b.urutan),
      ),
    ]);
    return true;
  } catch (e) {
    console.warn("Lexa: Penjelasan tidak tersimpan (migrasi 0007 belum diterapkan?):", String(e).slice(0, 200));
    return false;
  }
}

const KARAKTER_PER_POTONGAN = 500;

/**
 * Id vektor potongan lanjutan (`id~n`) yang mungkin ada untuk pasal sepanjang `panjang` karakter, dari potongan ke-`mulai`.
 * Batas atas yang longgar (potongTeks memotong di sekitar 1200 karakter): menghapus id yang tak pernah ada tidak berakibat apa
 * pun di Vectorize, sedangkan melewatkan satu id meninggalkan vektor yatim.
 */
export function idPotongan(id: string, panjang: number, mulai = 1): string[] {
  if (panjang <= MAKS_KARAKTER_CHUNK) return [];
  const maks = Math.ceil(panjang / KARAKTER_PER_POTONGAN);
  const hasil: string[] = [];
  for (let n = mulai; n <= maks; n++) hasil.push(`${id}~${n}`);
  return hasil;
}

/** Id vektor yang PASTI dibuat indeksVektor untuk sebuah pasal: potongan pertama memakai id pasal, lanjutannya `id~n`. */
function idVektorTepat(id: string, isi: string): string[] {
  const jumlah = potongTeks(isi).length;
  return [id, ...Array.from({ length: Math.max(jumlah - 1, 0) }, (_, i) => `${id}~${i + 1}`)];
}

export type Vonis = LaporanKualitas["vonis"];

export type Keputusan = { ganti: true } | { ganti: false; alasan: string };

/**
 * Apakah hasil penguraian ini menggantikan pasal yang sudah tersimpan? Dihitung dengan NOMOR pasal berbeda, bukan baris:
 * naskah lama yang menyimpan Penjelasan sebagai pasal kembar punya jauh lebih banyak baris daripada nomor.
 *
 *  - belum ada pasal tersimpan: ganti;
 *  - uraian ulang arsip BPK yang sama (pengurai yang lebih baru): ganti, kecuali nomornya menyusut lebih dari separuh pada
 *    naskah yang cukup besar, yang lebih mungkin kerusakan pengurai daripada perbaikan;
 *  - hasil PDF baru: dipertahankan yang lama bila teks PDF rusak berat atau nomornya lebih sedikit (pindaian yang terbaca
 *    buruk tak boleh menimpa naskah yang lebih utuh), selain itu ganti. Yang tersimpan bisa teks lama dari sumber yang sudah
 *    dihentikan; teks BPK menggantikannya begitu cukup utuh.
 */
export function putuskanPenggantian(p: { nomorLama: number; nomorBaru: number; vonis: Vonis; sumberSama: boolean }): Keputusan {
  const { nomorLama, nomorBaru } = p;
  if (nomorLama === 0) return { ganti: true };
  if (p.sumberSama) {
    if (nomorLama >= 10 && nomorBaru * 2 < nomorLama) {
      return { ganti: false, alasan: `dipertahankan: uraian ulang hanya ${nomorBaru} dari ${nomorLama} nomor pasal tersimpan` };
    }
    return { ganti: true };
  }
  if (p.vonis === "berat") {
    return { ganti: false, alasan: `dipertahankan: teks PDF rusak berat; ${nomorLama} nomor pasal tersimpan` };
  }
  if (nomorBaru < nomorLama) {
    return { ganti: false, alasan: `dipertahankan: ${nomorLama} nomor pasal tersimpan lebih banyak dari ${nomorBaru} hasil PDF` };
  }
  return { ganti: true };
}

interface BarisLama {
  id: string;
  nomor_pasal: string;
  ayat: string | null;
  bab: string | null;
  bagian: string | null;
  isi: string;
}

/** Pasal tersimpan persis sama dengan hasil penguraian: tak ada yang perlu ditulis ulang, diindeks ulang, atau dihapus. */
function samaDenganTersimpan(lama: BarisLama[], baru: PasalTerurai[]): boolean {
  return (
    lama.length === baru.length &&
    lama.every((r, i) => r.nomor_pasal === baru[i].nomor_pasal && r.ayat === baru[i].ayat && r.bab === baru[i].bab && r.bagian === baru[i].bagian && r.isi === baru[i].isi)
  );
}

const POTONGAN_DAFTAR_HAPUS = 90;

/**
 * Ubah PDF di R2 menjadi pasal terstruktur.
 *
 * Dokumen datang dari panen BPK: metadata + berkas PDF. `env.AI.toMarkdown()` menangani ekstraksi teksnya, lalu
 * `uraikanPasal` memecahnya menjadi pasal dan ayat, dan `uraikanPenjelasan` mengurai Penjelasan-nya (tabel `penjelasan`).
 * Keputusan menimpa pasal yang sudah tersimpan ada di `putuskanPenggantian`; yang digantikan membuang vektor dan teks
 * arsipnya lewat `daftar_hapus`. Mode `dariTeks` menguraikan ulang arsip teks BPK di R2 tanpa membaca PDF-nya.
 */
export async function ekstrakPdf(
  ctx: KonteksIngest,
  frbrUri: string,
  r2Key: string,
  opsi: { dariTeks?: boolean } = {},
): Promise<number> {
  const mulai = Date.now();
  // Peraturan di luar cakupan tidak diekstrak (konversi PDF memakai Workers AI).
  const baris = await ctx.db
    .prepare(`SELECT jenis, nomor, tahun, jumlah_pasal, r2_text_key FROM laws WHERE frbr_uri = ?`)
    .bind(frbrUri)
    .first<{ jenis: string; nomor: string; tahun: number; jumlah_pasal: number; r2_text_key: string | null }>();
  if (baris && !dalamCakupan(ctx.cakupan, baris.jenis)) return 0;

  const kunciTeks = `teks/${frbrUri.replace(/^\//, "")}.md`;
  let markdown = "";
  let ukuranPdf = 0;
  /** Kunci arsip teks yang diuraikan ulang (mode dari_teks); null bila teksnya datang dari konversi PDF. */
  let kunciArsip: string | null = null;

  // Mode dari_teks (ekstrak-ulang setelah pengurai diperbaiki): uraikan arsip teks yang sudah ada, tanpa membaca PDF dan tanpa
  // konversi Workers AI. Arsip BPK (teks/<uri>.md) didahulukan; arsip lain yang tercatat (sisa sumber lama, .txt) hanya
  // dipakai bila arsip BPK tak ada. Arsip yang tak ada atau kosong jatuh ke jalur biasa di bawah.
  if (opsi.dariTeks) {
    for (const kunci of new Set([kunciTeks, baris?.r2_text_key ?? ""])) {
      if (!kunci) continue;
      const arsip = await ctx.docs.get(kunci).catch(() => null);
      const teksArsip = arsip ? await arsip.text() : "";
      if (teksArsip.trim()) {
        markdown = teksArsip;
        kunciArsip = kunci;
        break;
      }
    }
    if (kunciArsip) {
      const log = await ctx.db
        .prepare(`SELECT ukuran_pdf FROM ekstraksi_log WHERE frbr_uri = ?`)
        .bind(frbrUri)
        .first<{ ukuran_pdf: number }>()
        .catch(() => null);
      ukuranPdf = log?.ukuran_pdf ?? 0;
    }
  }

  if (!kunciArsip) {
    const objek = await ctx.docs.get(r2Key);
    if (!objek) throw new Error(`Berkas ${r2Key} tidak ada di R2`);

    const bytes = await objek.arrayBuffer();
    ukuranPdf = bytes.byteLength;

    let hasil;
    try {
      hasil = await ctx.ai.toMarkdown([
        {
          name: r2Key.split("/").pop() ?? "dokumen.pdf",
          blob: new Blob([bytes], { type: "application/pdf" }),
        },
      ]);
    } catch (e) {
      // Kegagalan konversi tetap dicatat: dokumen yang tidak bisa dibaca sama
      // pentingnya bagi pengukuran seperti dokumen yang berhasil.
      await catatEkstraksi(ctx.db, frbrUri, r2Key, ukuranPdf, null, Date.now() - mulai, String(e).slice(0, 300));
      throw e;
    }

    // `toMarkdown` mengembalikan union: keberhasilan membawa `data`, kegagalan
    // membawa `format: "error"`. Kegagalan dilaporkan apa adanya, bukan dibiarkan
    // lolos sebagai teks kosong yang menyesatkan.
    const konversi = Array.isArray(hasil) ? hasil[0] : undefined;
    if (!konversi) throw new Error(`Konversi ${r2Key} tidak mengembalikan hasil`);
    if (konversi.format === "error") {
      await catatEkstraksi(ctx.db, frbrUri, r2Key, ukuranPdf, null, Date.now() - mulai, konversi.error.slice(0, 300));
      throw new Error(`Konversi ${r2Key} gagal: ${konversi.error}`);
    }

    markdown = konversi.data ?? "";
    if (!markdown.trim()) {
      await catatEkstraksi(ctx.db, frbrUri, r2Key, ukuranPdf, null, Date.now() - mulai, "teks hasil konversi kosong");
      throw new Error(`Konversi ${r2Key} menghasilkan teks kosong`);
    }

    // Teks disimpan lebih dulu, apa pun hasil penguraiannya. Sebelumnya
    // penyimpanan terjadi setelah penulisan ke D1, sehingga dokumen yang gagal
    // disimpan juga kehilangan teksnya — justru dokumen yang paling perlu
    // diperiksa manual.
    await ctx.docs
      .put(kunciTeks, markdown, {
        httpMetadata: { contentType: "text/markdown; charset=utf-8" },
      })
      .catch(() => {});
  }

  // Kunci arsip yang dicatat di D1. Mode dari_teks memakai arsip yang sudah ada, yang kuncinya bisa berbeda dari kunci
  // baku (arsip .txt sisa sumber lama), jadi tautan ke arsipnya tidak boleh diganti.
  const kunciSimpan = kunciArsip ?? kunciTeks;
  /** Pasal tersimpan berasal dari arsip BPK yang sama dengan yang diurai sekarang: ini uraian ulang, bukan naskah baru. */
  const sumberSama = kunciArsip !== null && kunciArsip === kunciTeks && baris?.r2_text_key === kunciTeks;

  // PDF yang bukan naskah peraturan ini (tautan BPK keliru, berkas lain di halaman rincian) tak boleh menghasilkan pasalnya:
  // pasal yang keliru lebih buruk daripada pasal yang kosong. Teks konversi tetap diarsipkan di atas, untuk diperiksa;
  // PDF-nya tetap tersimpan, jadi ekstrak-ulang bisa mencobanya lagi bila pemeriksaannya kelak diperbaiki.
  if (baris) {
    const cocok = periksaKecocokanNaskah(markdown, baris);
    if (cocok.hasil === "tidak_cocok") {
      const d = cocok.ditemukan;
      const catatan = `PDF memuat judul ${d.jenis} ${d.nomor}/${d.tahun}, bukan ${baris.jenis} ${baris.nomor}/${baris.tahun}: pasal tidak disimpan`;
      await catatEkstraksi(ctx.db, frbrUri, r2Key, ukuranPdf, null, Date.now() - mulai, catatan);
      await catatVersiParser(ctx.db, frbrUri);
      await catatLog(ctx.db, "ekstrak_pdf", "gagal", `${frbrUri}: ${catatan}`);
      await ctx.db.prepare(`UPDATE laws SET isi_catatan = ? WHERE frbr_uri = ?`).bind(catatan, frbrUri).run().catch(() => {});
      return 0;
    }
  }

  const pasal = uraikanPasal(markdown);
  const laporan = nilaiKualitasEkstraksi(bersihkanHalaman(markdown), pasal);

  if (!pasal.length) {
    // Bukan kegagalan sistem: sebagian PDF adalah pindaian tanpa struktur yang
    // bisa dikenali. Catat, lalu berhenti — jangan retry, hasilnya akan sama.
    await catatEkstraksi(ctx.db, frbrUri, r2Key, ukuranPdf, laporan, Date.now() - mulai, "tidak ada pasal terdeteksi");
    await catatVersiParser(ctx.db, frbrUri);
    await catatLog(ctx.db, "ekstrak_pdf", "gagal", `${frbrUri}: tidak ada pasal terdeteksi`);
    // Teksnya milik PDF ini, hanya pengurainya yang belum mengenali strukturnya. Kuncinya dicatat supaya teks bisa dibaca
    // (tab Dokumen) dan diperiksa untuk memperbaiki pengurai, lalu diuraikan ulang tanpa konversi (dari_teks). Peraturan yang
    // sudah punya pasal dari jalur lain tidak disentuh: arsipnya sudah milik jalur itu.
    await ctx.db
      .prepare(`UPDATE laws SET r2_text_key = ? WHERE frbr_uri = ? AND jumlah_pasal = 0`)
      .bind(kunciSimpan, frbrUri)
      .run()
      .catch(() => {});
    return 0;
  }

  // Pasal yang tersimpan, untuk memutuskan penggantian dan, bila diganti, membersihkan vektornya yang tak terpakai lagi.
  const { results: lamaBaris } = await ctx.db
    .prepare(`SELECT id, nomor_pasal, ayat, bab, bagian, isi FROM articles WHERE frbr_uri = ? ORDER BY urutan`)
    .bind(frbrUri)
    .all<BarisLama>();
  const keputusan = putuskanPenggantian({
    nomorLama: new Set(lamaBaris.map((r) => r.nomor_pasal)).size,
    nomorBaru: new Set(pasal.map((p) => p.nomor_pasal)).size,
    vonis: laporan.vonis,
    sumberSama,
  });
  if (!keputusan.ganti) {
    await catatEkstraksi(ctx.db, frbrUri, r2Key, ukuranPdf, laporan, Date.now() - mulai, keputusan.alasan);
    await catatVersiParser(ctx.db, frbrUri);
    await catatLog(ctx.db, "ekstrak_pdf", "gagal", `${frbrUri}: ${keputusan.alasan}`);
    return 0;
  }

  const identik = samaDenganTersimpan(lamaBaris, pasal);
  const statements: D1PreparedStatement[] = [];

  if (!identik) {
    // Id dijamin unik lebih dulu: satu tabrakan PRIMARY KEY membatalkan seluruh
    // batch, dan bersamanya seluruh pasal dokumen ini.
    const ids = idPasalUnik(frbrUri, pasal);

    // Vektor pasal yang lenyap atau memendek tidak ikut terhapus dengan baris D1-nya; keduanya dicatat untuk dibersihkan
    // pemeliharaan harian. Calonnya semua id vektor pasal lama (batas atas yang longgar: menghapus id yang tak pernah ada tak
    // berakibat apa pun); id yang dipakai lagi oleh hasil baru tak boleh dihapus, termasuk yang tertunda dari penggantian
    // sebelumnya (pemeliharaan akan menghapus vektor yang baru dibuat).
    const vektorBaru = new Set(pasal.flatMap((p, i) => idVektorTepat(ids[i], p.isi)));
    const kunciYatim = [...new Set(lamaBaris.flatMap((r) => [r.id, ...idPotongan(r.id, r.isi.length)]))].filter((k) => !vektorBaru.has(k));
    const tertunda = await ctx.db
      .prepare(`SELECT kunci FROM daftar_hapus WHERE jenis_objek = 'vektor' AND kunci >= ? AND kunci < ?`)
      .bind(`${frbrUri}#`, `${frbrUri}$`)
      .all<{ kunci: string }>();
    const dipakaiLagi = tertunda.results.map((r) => r.kunci).filter((k) => vektorBaru.has(k));

    statements.push(ctx.db.prepare(`DELETE FROM articles WHERE frbr_uri = ?`).bind(frbrUri));
    pasal.forEach((p, i) => {
      statements.push(
        ctx.db
          .prepare(
            `INSERT INTO articles (id, frbr_uri, nomor_pasal, ayat, bab, bagian, judul, isi, urutan)
             VALUES (?,?,?,?,?,?,NULL,?,?)`,
          )
          .bind(ids[i], frbrUri, p.nomor_pasal, p.ayat, p.bab, p.bagian, p.isi, p.urutan),
      );
    });
    for (let i = 0; i < kunciYatim.length; i += POTONGAN_DAFTAR_HAPUS) {
      const potong = kunciYatim.slice(i, i + POTONGAN_DAFTAR_HAPUS);
      statements.push(
        ctx.db
          .prepare(`INSERT OR IGNORE INTO daftar_hapus (jenis_objek, kunci) VALUES ${potong.map(() => "('vektor', ?)").join(",")}`)
          .bind(...potong),
      );
    }
    for (let i = 0; i < dipakaiLagi.length; i += POTONGAN_DAFTAR_HAPUS) {
      const potong = dipakaiLagi.slice(i, i + POTONGAN_DAFTAR_HAPUS);
      statements.push(
        ctx.db
          .prepare(`DELETE FROM daftar_hapus WHERE jenis_objek = 'vektor' AND kunci IN (${potong.map(() => "?").join(",")})`)
          .bind(...potong),
      );
    }
  }

  statements.push(
    ctx.db
      .prepare(
        `UPDATE laws SET jumlah_pasal = ?, r2_text_key = ?, isi_status = 'lengkap', isi_percobaan = 0,
                         isi_diambil_at = datetime('now'), isi_catatan = NULL
          WHERE frbr_uri = ?`,
      )
      .bind(pasal.length, kunciSimpan, frbrUri),
  );

  // Teks arsip yang digantikan (mis. .txt sisa sumber lama) tak lagi ditunjuk siapa pun.
  const kunciLama = baris?.r2_text_key;
  if (kunciLama && kunciLama !== kunciSimpan && kunciLama.startsWith("teks/")) {
    statements.push(ctx.db.prepare(`INSERT OR IGNORE INTO daftar_hapus (jenis_objek, kunci) VALUES ('r2', ?)`).bind(kunciLama));
  }

  // Pencatatan mutu dilakukan SETELAH penyimpanan berhasil. Urutan sebaliknya
  // membuat laporan menyatakan "210 pasal, ringan" untuk dokumen yang
  // sesungguhnya tidak menyimpan satu baris pun — kesalahan paling menyesatkan
  // yang bisa dilakukan sebuah alat ukur.
  try {
    await ctx.db.batch(statements);
  } catch (e) {
    await catatEkstraksi(
      ctx.db, frbrUri, r2Key, ukuranPdf, null, Date.now() - mulai,
      `gagal menyimpan ${pasal.length} pasal: ${String(e).slice(0, 200)}`,
    );
    throw e;
  }

  await simpanPenjelasan(ctx.db, frbrUri, barisPenjelasan(uraikanPenjelasan(markdown)));
  await catatEkstraksi(ctx.db, frbrUri, r2Key, ukuranPdf, laporan, Date.now() - mulai, null);
  await catatVersiParser(ctx.db, frbrUri);
  if (!identik) {
    // Uraian ulang naskah BPK yang sama tak mengubah isi peraturan, jadi ringkasan AI-nya (Workers AI berbayar, dan satu
    // putaran `usang` menyentuh ribuan peraturan) tidak disusun lagi. Naskah baru, atau yang tadinya belum berpasal, diringkas.
    const uraianUlang = sumberSama && lamaBaris.length > 0;
    await ctx.queue.sendBatch([
      { body: { tipe: "indeks_vektor", frbr_uri: frbrUri } },
      ...(uraianUlang ? [] : [{ body: { tipe: "ringkas", frbr_uri: frbrUri } as PesanIngest }]),
    ]);
  }
  await catatLog(ctx.db, "ekstrak_pdf", "sukses", frbrUri, pasal.length);

  return pasal.length;
}

/**
 * Susun ringkasan pendek sebuah peraturan dengan Workers AI.
 *
 * Dijalankan sekali saat ingest, bukan per permintaan: ringkasan tidak berubah
 * sementara biaya pemanggilan model nyata. Hasilnya memperbaiki halaman hasil
 * pencarian sekaligus ikut terindeks FTS lewat kolom `ringkasan`.
 */
export async function buatRingkasan(ctx: KonteksIngest, frbrUri: string): Promise<boolean> {
  const law = await ctx.db
    .prepare(`SELECT judul, jenis, nomor, tahun, r2_text_key FROM laws WHERE frbr_uri = ?`)
    .bind(frbrUri)
    .first<{ judul: string; jenis: string; nomor: string; tahun: number; r2_text_key: string | null }>();
  if (!law || !dalamCakupan(ctx.cakupan, law.jenis)) return false;

  // Sumber teks: arsip R2 bila ada, kalau tidak rangkai dari pasal di D1.
  let teks = "";
  if (law.r2_text_key) {
    const objek = await ctx.docs.get(law.r2_text_key);
    if (objek) teks = await objek.text();
  }
  if (!teks) {
    const { results } = await ctx.db
      .prepare(`SELECT isi FROM articles WHERE frbr_uri = ? ORDER BY urutan LIMIT 40`)
      .bind(frbrUri)
      .all<{ isi: string }>();
    teks = results.map((r) => r.isi).join("\n");
  }
  if (!teks.trim()) return false;

  // Model punya batas konteks; bagian awal peraturan memuat ketentuan umum dan
  // ruang lingkup, yang paling menentukan isi ringkasan.
  const potongan = teks.slice(0, 12000);

  const hasil = (await ctx.ai.run(ctx.summaryModel as keyof AiModels, {
    messages: [
      {
        role: "system",
        content:
          "Anda meringkas peraturan perundang-undangan Indonesia. Jawab dalam bahasa Indonesia " +
          "formal, dua sampai tiga kalimat, menjelaskan apa yang diatur dan siapa yang terikat. " +
          "Jangan menambahkan penilaian, saran hukum, atau informasi yang tidak ada di teks.",
      },
      {
        role: "user",
        content: `Ringkas peraturan berikut.\n\nJudul: ${law.judul}\n\nIsi:\n${potongan}`,
      },
    ],
    max_tokens: 320,
  } as never)) as unknown as { response?: string };

  const ringkasan = (hasil?.response ?? "").trim();
  if (!ringkasan) return false;

  await ctx.db
    .prepare(`UPDATE laws SET ringkasan = ?, updated_at = datetime('now') WHERE frbr_uri = ?`)
    .bind(ringkasan.slice(0, 1200), frbrUri)
    .run();

  return true;
}

/** Konsumer antrean. Pesan yang jenisnya tak dikenal (sisa alur sumber lama) dibuang: melempar hanya akan mengulangnya sia-sia. */
export async function prosesPesanIngest(ctx: KonteksIngest, pesan: PesanIngest): Promise<void> {
  const tipe = (pesan as { tipe?: unknown } | null)?.tipe;
  if (tipe !== "indeks_vektor" && tipe !== "ringkas" && tipe !== "ekstrak_pdf") {
    console.log("Lexa: pesan antrean dibuang, jenisnya tak dikenal:", String(tipe));
    return;
  }

  // Pesan lama untuk peraturan yang jelas di luar cakupan dibuang tanpa menyentuh Workers AI. Jenis yang segmen
  // URI-nya tak baku (POJK, PERMEN) tak bisa dinilai dari URI; sisanya dinilai oleh baris D1 (indeksVektor,
  // buatRingkasan, ekstrakPdf).
  if (uriJelasDiLuarCakupan(ctx.cakupan, pesan.frbr_uri)) {
    console.log("Lexa: pesan ingest dilewati, di luar cakupan:", pesan.tipe, pesan.frbr_uri);
    return;
  }

  if (pesan.tipe === "indeks_vektor") {
    await indeksVektor(ctx, pesan.frbr_uri);
    return;
  }

  if (pesan.tipe === "ringkas") {
    await buatRingkasan(ctx, pesan.frbr_uri);
    return;
  }

  await ekstrakPdf(ctx, pesan.frbr_uri, pesan.r2_key, { dariTeks: pesan.dari_teks === true });
}
