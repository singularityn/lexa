/**
 * Pipeline ingest: pasal.id -> D1 -> Vectorize/R2.
 *
 * Bagian yang bergantung pada laju pasal.id (daftar peraturan dan detail) kini dikerjakan tik (lib/tik.ts,
 * lib/katalog.ts, lib/isi.ts) dengan status per peraturan di D1 dan jeda yang dipatuhi. Yang tersisa di sini
 * dikerjakan konsumer antrean Cloudflare Queues, karena tak menyentuh pasal.id dan aman diulang:
 *   - `indeks_vektor` : embedding semua pasal sebuah peraturan lalu upsert ke Vectorize (Workers AI);
 *   - `ringkas`       : ringkasan AI sebuah peraturan;
 *   - `ekstrak_pdf`   : PDF dari impor BPK -> pasal terstruktur.
 * Pesan `peraturan` dari alur lama (daftar yang mengantrekan tiap peraturan) tidak lagi dibuat; sisa yang masih di
 * antrean dibuang tanpa menyentuh pasal.id, karena katalog menemukan ulang semuanya.
 */

import { labelSitasi } from "../../shared/label";
import { dalamCakupan, uriJelasDiLuarCakupan, type Cakupan } from "../../shared/cakupan";
import type { PasalClient } from "./pasal";
import { uraikanPasal, idPasalUnik, nilaiKualitasEkstraksi, periksaKecocokanNaskah, type LaporanKualitas } from "./bpk";

export type PesanIngest =
  /** Alur lama (tidak lagi dibuat); sisa di antrean dibuang. Lihat komentar di atas. */
  | { tipe: "peraturan"; frbr_uri: string; alasan?: string; pasal_id?: number; jenis?: string }
  | { tipe: "indeks_vektor"; frbr_uri: string }
  | { tipe: "ekstrak_pdf"; frbr_uri: string; r2_key: string; dari_teks?: boolean }
  | { tipe: "ringkas"; frbr_uri: string }
  /** Satu tik pekerjaan latar; rantai cadangan bila Cron per menit tak berjalan (lib/cadangan.ts). */
  | { tipe: "tik"; g?: number };

/** Ukuran potongan teks untuk embedding. bge-m3 kuat di teks pendek-menengah. */
const MAKS_KARAKTER_CHUNK = 1200;

export interface KonteksIngest {
  db: D1Database;
  vectorize: VectorizeIndex;
  ai: Ai;
  docs: R2Bucket;
  queue: Queue<PesanIngest>;
  pasal: PasalClient;
  embeddingModel: string;
  summaryModel: string;
  /** Jenis peraturan yang boleh masuk (shared/cakupan.ts). Yang lain tidak disinkronkan maupun disimpan. */
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

/**
 * Ubah PDF di R2 menjadi pasal terstruktur.
 *
 * Dipakai untuk dokumen yang datang dari panen BPK, yang hanya berisi metadata
 * + berkas PDF — berbeda dari jalur pasal.id yang sudah memberi pasal terurai.
 * `env.AI.toMarkdown()` menangani ekstraksi teksnya, lalu `uraikanPasal`
 * memecahnya menjadi pasal dan ayat.
 */
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
  let dariArsip = false;

  // Mode dari_teks (ekstrak-ulang setelah pengurai pasal diperbaiki): uraikan arsip teks yang sudah ada, tanpa membaca
  // PDF-nya dan tanpa konversi Workers AI. Arsip yang tak ada atau kosong jatuh ke jalur biasa di bawah.
  if (opsi.dariTeks && baris?.r2_text_key) {
    const arsip = await ctx.docs.get(baris.r2_text_key).catch(() => null);
    const teksArsip = arsip ? await arsip.text() : "";
    if (teksArsip.trim()) {
      markdown = teksArsip;
      dariArsip = true;
      const log = await ctx.db
        .prepare(`SELECT ukuran_pdf FROM ekstraksi_log WHERE frbr_uri = ?`)
        .bind(frbrUri)
        .first<{ ukuran_pdf: number }>()
        .catch(() => null);
      ukuranPdf = log?.ukuran_pdf ?? 0;
    }
  }

  if (!dariArsip) {
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
  // baku (mis. arsip .txt dari jalur pasal.id), jadi tautan ke arsipnya tidak boleh diganti.
  const kunciSimpan = dariArsip && baris?.r2_text_key ? baris.r2_text_key : kunciTeks;

  // PDF yang bukan naskah peraturan ini (tautan BPK keliru, berkas lain di halaman rincian) tak boleh menghasilkan pasalnya:
  // pasal yang keliru lebih buruk daripada pasal yang kosong. Teks konversi tetap diarsipkan di atas, untuk diperiksa;
  // PDF-nya tetap tersimpan, jadi ekstrak-ulang bisa mencobanya lagi bila pemeriksaannya kelak diperbaiki.
  if (baris) {
    const cocok = periksaKecocokanNaskah(markdown, baris);
    if (cocok.hasil === "tidak_cocok") {
      const d = cocok.ditemukan;
      const catatan = `PDF memuat judul ${d.jenis} ${d.nomor}/${d.tahun}, bukan ${baris.jenis} ${baris.nomor}/${baris.tahun}: pasal tidak disimpan`;
      await catatEkstraksi(ctx.db, frbrUri, r2Key, ukuranPdf, null, Date.now() - mulai, catatan);
      await catatLog(ctx.db, "ekstrak_pdf", "gagal", `${frbrUri}: ${catatan}`);
      await ctx.db.prepare(`UPDATE laws SET isi_catatan = ? WHERE frbr_uri = ?`).bind(catatan, frbrUri).run().catch(() => {});
      return 0;
    }
  }

  const pasal = uraikanPasal(markdown);
  const laporan = nilaiKualitasEkstraksi(markdown, pasal);

  if (!pasal.length) {
    // Bukan kegagalan sistem: sebagian PDF adalah pindaian tanpa struktur yang
    // bisa dikenali. Catat, lalu berhenti — jangan retry, hasilnya akan sama.
    await catatEkstraksi(ctx.db, frbrUri, r2Key, ukuranPdf, laporan, Date.now() - mulai, "tidak ada pasal terdeteksi");
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

  // Hasil PDF yang lebih sedikit dari pasal yang sudah tersimpan (mis. dari pasal.id) tidak menggantikannya:
  // pindaian yang terbaca buruk tak boleh menimpa naskah yang lebih utuh. Teks hasil konversi tetap diarsipkan di R2.
  const lama = baris?.jumlah_pasal ?? 0;
  if (pasal.length < lama) {
    await catatEkstraksi(
      ctx.db, frbrUri, r2Key, ukuranPdf, laporan, Date.now() - mulai,
      `dipertahankan: ${lama} pasal tersimpan lebih banyak dari ${pasal.length} hasil PDF`,
    );
    await catatLog(ctx.db, "ekstrak_pdf", "gagal", `${frbrUri}: hasil PDF ${pasal.length} pasal < ${lama} tersimpan, dipertahankan`);
    return 0;
  }

  // Id dijamin unik lebih dulu: satu tabrakan PRIMARY KEY membatalkan seluruh
  // batch, dan bersamanya seluruh pasal dokumen ini.
  const ids = idPasalUnik(frbrUri, pasal);

  const statements: D1PreparedStatement[] = [
    ctx.db.prepare(`DELETE FROM articles WHERE frbr_uri = ?`).bind(frbrUri),
  ];

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

  statements.push(
    ctx.db
      .prepare(
        `UPDATE laws SET jumlah_pasal = ?, r2_text_key = ?, isi_status = 'lengkap', isi_percobaan = 0,
                         isi_diambil_at = datetime('now'), isi_catatan = NULL
          WHERE frbr_uri = ?`,
      )
      .bind(pasal.length, kunciSimpan, frbrUri),
  );

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

  await catatEkstraksi(ctx.db, frbrUri, r2Key, ukuranPdf, laporan, Date.now() - mulai, null);
  await ctx.queue.sendBatch([
    { body: { tipe: "indeks_vektor", frbr_uri: frbrUri } },
    { body: { tipe: "ringkas", frbr_uri: frbrUri } },
  ]);
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

/** Konsumer antrean untuk pesan yang tak menyentuh pasal.id. Pesan `tik` ditangani index.ts. */
export async function prosesPesanIngest(
  ctx: KonteksIngest,
  pesan: Exclude<PesanIngest, { tipe: "tik" }>,
): Promise<void> {
  // Pesan lama `peraturan` (alur sebelum katalog) dibuang: mengerjakannya berarti menarik detail dari pasal.id di luar
  // jeda dan giliran yang kini dikelola tik, dan katalog menemukan ulang peraturannya. Sengaja tidak dicatat ke
  // sync_log: ribuan baris "dilewati" menutupi catatan sinkronisasi yang berarti.
  if (pesan.tipe === "peraturan") {
    console.log("Lexa: pesan peraturan dari alur lama dibuang:", pesan.frbr_uri);
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
