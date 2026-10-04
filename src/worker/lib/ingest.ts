/**
 * Pipeline ingest: pasal.id -> D1 -> Vectorize/R2.
 *
 * Dipecah menjadi dua tahap yang berkomunikasi lewat Queue:
 *   1. `jadwalkanSinkronisasi` (dipicu Cron) — hanya menarik *daftar* peraturan
 *      yang berubah lalu menitipkan tiap URI ke antrean.
 *   2. `prosesPesanIngest` (konsumer antrean) — menarik detail satu peraturan,
 *      menyimpannya, lalu mengindeks ke Vectorize.
 *
 * Pemisahan ini disengaja: rate limit pasal.id untuk endpoint detail hanya
 * 60/menit. Kalau semuanya dikerjakan di dalam satu invokasi Cron, satu batch
 * besar pasti kena 429 dan kehilangan progres. Dengan antrean, `max_concurrency`
 * dan retry bawaan Queues yang menahan laju, dan kegagalan satu dokumen tidak
 * menjatuhkan seluruh sinkronisasi.
 */

import type { Article, Law } from "../../shared/types";
import { labelSitasi } from "../../shared/label";
import { dalamCakupan, klausaCakupan, uriJelasDiLuarCakupan, type Cakupan } from "../../shared/cakupan";
import { PasalClient, PasalRateLimitError } from "./pasal";
import { uraikanPasal, idPasalUnik, nilaiKualitasEkstraksi, type LaporanKualitas } from "./bpk";

export type PesanIngest =
  | {
      tipe: "peraturan";
      frbr_uri: string;
      alasan: "baru" | "perubahan" | "manual";
      /** Id internal pasal.id, bila diketahui dari hasil pendaftaran. */
      pasal_id?: number;
      /**
       * Kode jenis dari daftar pasal.id (diisi Cron). Konsumer memakainya untuk membuang peraturan di luar cakupan
       * tanpa memanggil pasal.id; pesan tanpa ini (lama, atau dari sapuan manual per URI) dinilai dari URI-nya.
       */
      jenis?: string;
    }
  | { tipe: "indeks_vektor"; frbr_uri: string }
  | { tipe: "ekstrak_pdf"; frbr_uri: string; r2_key: string }
  | { tipe: "ringkas"; frbr_uri: string };

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

async function bacaState(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare(`SELECT value FROM sync_state WHERE key = ?`)
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

async function tulisState(db: D1Database, key: string, value: string) {
  await db
    .prepare(
      `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value)
    .run();
}

/**
 * Jenis yang dikenal sebagai filter `type` pada `GET /laws` pasal.id (terbukti di produksi), diurutkan dari yang
 * paling sering dicari. Cron hanya menyapu irisannya dengan cakupan (shared/cakupan.ts). UUD dan TAP_MPR tidak ada
 * di daftar ini karena kode filternya belum terbukti: keduanya masuk lewat impor BPK, dan sapuan manual
 * (`POST /api/admin/sync {"jenis":["UUD"]}`) boleh mencobanya.
 */
const JENIS_PRIORITAS = ["UU", "PERPPU", "PP", "PERPRES", "PERMEN", "POJK", "PBI"];

/**
 * Tahap 1 — dijalankan Cron.
 * Menyapu daftar peraturan per jenis (hanya yang dalam cakupan) dan mengantrekan yang baru/berubah.
 */
export async function jadwalkanSinkronisasi(
  ctx: KonteksIngest,
  opsi: { jenis?: string[]; maksHalaman?: number } = {},
): Promise<{ diantrekan: number; diperiksa: number }> {
  const mulai = Date.now();
  const maksHalaman = opsi.maksHalaman ?? 4; // 4 x 50 = 200 dokumen per jenis per jalan
  const UKURAN = 50;

  // Jenis di luar cakupan tidak pernah ditarik, juga bila diminta lewat sapuan manual.
  const jenisCron = JENIS_PRIORITAS.filter((j) => dalamCakupan(ctx.cakupan, j));
  const jenisManual = opsi.jenis?.filter((j) => dalamCakupan(ctx.cakupan, j));

  // Urutan jenis diputar agar tidak ada yang kelaparan. Dengan urutan tetap, satu jenis di depan
  // yang selalu kena batas laju (di produksi: PERPRES, setelah ±12 permintaan) menghentikan
  // seluruh sapuan sebelum jenis di belakangnya sempat disentuh: kursor PERMEN, POJK, dan PBI
  // tidak bergerak sejak 2 Sep 2026. Kini sapuan berikutnya dimulai dari jenis tempat sapuan
  // sebelumnya terhenti, dan kembali ke awal hanya setelah satu putaran penuh selesai.
  // Sapuan manual untuk jenis tertentu (opsi.jenis) tidak memutar apa pun.
  const putar = !opsi.jenis;
  let daftarJenis = jenisManual ?? jenisCron;
  if (putar) {
    const i = jenisCron.indexOf((await bacaState(ctx.db, "jenis_awal")) ?? "");
    if (i > 0) daftarJenis = [...jenisCron.slice(i), ...jenisCron.slice(0, i)];
  }
  if (!daftarJenis.length) {
    await catatLog(ctx.db, "jadwal_sinkronisasi", "gagal", "dilewati: tidak ada jenis dalam cakupan yang diminta", 0);
    return { diantrekan: 0, diperiksa: 0 };
  }

  // Tekanan balik. Kapasitas nyata pipeline dibatasi rate limit pasal.id
  // (360 detail/jam), sedangkan satu kali penjadwalan bisa mengantrekan lebih
  // dari seribu pesan. Menjalankannya berulang tanpa memeriksa sisa pekerjaan
  // menumpuk antrean sampai pesan kehabisan jatah retry dan terbuang ke
  // dead-letter queue — kehilangan yang tidak terlihat di mana pun.
  //
  // Peraturan dengan `jumlah_pasal = 0` adalah yang metadatanya sudah masuk
  // tetapi isinya belum, jadi ia menjadi ukuran kasar antrean yang belum tuntas.
  // Hanya yang dalam cakupan: sisa lama di luar cakupan tidak akan pernah diisi dan tak boleh menahan sapuan.
  const tertunda = await ctx.db
    .prepare(`SELECT COUNT(*) AS n FROM laws WHERE jumlah_pasal = 0 AND ${klausaCakupan(ctx.cakupan, "jenis")}`)
    .first<{ n: number }>();

  const BATAS_TERTUNDA = 400;
  if ((tertunda?.n ?? 0) > BATAS_TERTUNDA) {
    await catatLog(
      ctx.db, "jadwal_sinkronisasi", "gagal",
      `dilewati: ${tertunda?.n} peraturan masih menunggu isi (batas ${BATAS_TERTUNDA})`, 0,
    );
    return { diantrekan: 0, diperiksa: 0 };
  }

  await catatLog(ctx.db, "jadwal_sinkronisasi", "mulai", daftarJenis.join(","));

  let diantrekan = 0;
  let diperiksa = 0;
  const antrean: PesanIngest[] = [];
  /** Kursor yang baru ditulis SETELAH pesannya masuk antrean, bukan sebelum. */
  const kursorBaru = new Map<string, string>();

  // Queues menerima maksimal 100 pesan per panggilan sendBatch.
  const kirimAntrean = async () => {
    for (let i = 0; i < antrean.length; i += 100) {
      await ctx.queue.sendBatch(antrean.slice(i, i + 100).map((body) => ({ body })));
    }
    antrean.length = 0;
  };
  const simpanKursor = async () => {
    for (const [kunci, nilai] of kursorBaru) await tulisState(ctx.db, kunci, nilai);
  };

  for (const jenis of daftarJenis) {
    // Kursor menyimpan OFFSET, bukan nomor halaman: API memakai limit/offset,
    // dan mengirim `page` hanya membuatnya diabaikan tanpa peringatan.
    const kunciOffset = `offset:${jenis}`;
    let offset = Number((await bacaState(ctx.db, kunciOffset)) ?? "0");
    if (!Number.isFinite(offset) || offset < 0) offset = 0;

    for (let i = 0; i < maksHalaman; i++) {
      let hasil;
      try {
        hasil = await ctx.pasal.listLaws({ jenis, offset, limit: UKURAN });
      } catch (e) {
        if (e instanceof PasalRateLimitError) {
          // Berhenti rapi; Cron berikutnya melanjutkan dari kursor yang sama.
          // Pesan yang sudah terkumpul HARUS tetap dikirim: kursornya sudah maju, jadi
          // membuangnya berarti peraturan di halaman-halaman itu terlewat sampai
          // kursor berputar penuh.
          kursorBaru.set(kunciOffset, String(offset));
          if (putar) kursorBaru.set("jenis_awal", jenis);
          await kirimAntrean();
          await simpanKursor();
          await catatLog(ctx.db, "jadwal_sinkronisasi", "gagal", `rate limit pada ${jenis}`, diantrekan);
          return { diantrekan, diperiksa };
        }
        await catatLog(ctx.db, "jadwal_sinkronisasi", "gagal", `${jenis}: ${String(e)}`, diantrekan);
        break;
      }

      if (!hasil.laws.length) {
        // Habis — mulai lagi dari awal pada siklus berikutnya agar perubahan
        // pada peraturan lama juga tertangkap.
        kursorBaru.set(kunciOffset, "0");
        break;
      }

      diperiksa += hasil.laws.length;

      // Tanya D1 sekali untuk seluruh halaman, bukan sekali per dokumen.
      const uriList = hasil.laws.map((l) => l.frbr_uri);
      const { results: sudahAda } = await ctx.db
        .prepare(
          `SELECT frbr_uri, status, jumlah_pasal
             FROM laws WHERE frbr_uri IN (${uriList.map(() => "?").join(",")})`,
        )
        .bind(...uriList)
        .all<{ frbr_uri: string; status: string; jumlah_pasal: number }>();

      const petaAda = new Map(sudahAda.map((r) => [r.frbr_uri, r]));

      for (const law of hasil.laws) {
        // Filter `type` pasal.id yang salah nama diabaikan diam-diam (lihat lib/pasal.ts), jadi daftar yang
        // diterima tetap diperiksa: satu peraturan di luar cakupan lolos sama dengan beban yang tak diinginkan.
        if (!dalamCakupan(ctx.cakupan, law.jenis)) continue;
        const ada = petaAda.get(law.frbr_uri);
        // Ambil ulang bila belum ada, statusnya berubah, atau isinya kosong
        // (mis. ingest sebelumnya gagal di tengah jalan).
        if (!ada || ada.status !== law.status || ada.jumlah_pasal === 0) {
          antrean.push({
            tipe: "peraturan",
            frbr_uri: law.frbr_uri,
            alasan: ada ? "perubahan" : "baru",
            pasal_id: hasil.idNumerik.get(law.frbr_uri),
            jenis: law.jenis,
          });
          diantrekan++;
        }
      }

      // Maju dengan jumlah yang benar-benar diterima. Kalau API memaksakan
      // limit lebih kecil dari yang diminta, offset tetap tidak melompati data.
      offset = hasil.offsetBerikut;
      kursorBaru.set(kunciOffset, hasil.hasMore ? String(offset) : "0");
      if (!hasil.hasMore) break;
    }
  }

  // Satu putaran penuh selesai tanpa kena batas laju: mulai dari awal lagi.
  if (putar) kursorBaru.set("jenis_awal", jenisCron[0]);
  await kirimAntrean();
  await simpanKursor();

  await catatLog(
    ctx.db, "jadwal_sinkronisasi", "sukses",
    `diperiksa ${diperiksa}`, diantrekan, Date.now() - mulai,
  );
  return { diantrekan, diperiksa };
}

/** Simpan satu peraturan beserta pasal dan relasinya, secara atomik. */
export async function simpanPeraturan(
  db: D1Database,
  law: Law,
  articles: Article[],
  relations: Array<{ to_uri: string; jenis_relasi: string; keterangan: string | null }>,
) {
  const statements: D1PreparedStatement[] = [];

  statements.push(
    db
      .prepare(
        `INSERT INTO laws (
           frbr_uri, jenis, nomor, tahun, judul, tentang, status,
           tanggal_penetapan, tanggal_berlaku, instansi, bidang,
           bpk_id, sumber_url, ringkasan, jumlah_pasal, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
         ON CONFLICT(frbr_uri) DO UPDATE SET
           jenis=excluded.jenis, nomor=excluded.nomor, tahun=excluded.tahun,
           judul=excluded.judul, tentang=excluded.tentang, status=excluded.status,
           tanggal_penetapan=excluded.tanggal_penetapan,
           tanggal_berlaku=excluded.tanggal_berlaku,
           instansi=excluded.instansi, bidang=excluded.bidang,
           bpk_id=excluded.bpk_id, sumber_url=excluded.sumber_url,
           jumlah_pasal=excluded.jumlah_pasal, updated_at=datetime('now')`,
      )
      .bind(
        law.frbr_uri, law.jenis, law.nomor, law.tahun, law.judul, law.tentang,
        law.status, law.tanggal_penetapan, law.tanggal_berlaku, law.instansi,
        law.bidang, law.bpk_id, law.sumber_url, law.ringkasan, articles.length,
      ),
  );

  // Ganti total pasal: lebih sederhana dan lebih benar daripada diff, karena
  // penomoran pasal bisa bergeser saat peraturan diubah.
  statements.push(db.prepare(`DELETE FROM articles WHERE frbr_uri = ?`).bind(law.frbr_uri));
  for (const a of articles) {
    statements.push(
      db
        .prepare(
          `INSERT INTO articles (id, frbr_uri, nomor_pasal, ayat, bab, bagian, judul, isi, urutan)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .bind(a.id, a.frbr_uri, a.nomor_pasal, a.ayat, a.bab, a.bagian, a.judul, a.isi, a.urutan),
    );
  }

  statements.push(db.prepare(`DELETE FROM relations WHERE from_uri = ?`).bind(law.frbr_uri));
  for (const r of relations) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO relations (from_uri, to_uri, jenis_relasi, keterangan)
           VALUES (?,?,?,?)`,
        )
        .bind(law.frbr_uri, r.to_uri, r.jenis_relasi, r.keterangan),
    );
  }

  await db.batch(statements);
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
): Promise<number> {
  const mulai = Date.now();
  // Peraturan di luar cakupan tidak diekstrak (konversi PDF memakai Workers AI).
  const baris = await ctx.db.prepare(`SELECT jenis FROM laws WHERE frbr_uri = ?`).bind(frbrUri).first<{ jenis: string }>();
  if (baris && !dalamCakupan(ctx.cakupan, baris.jenis)) return 0;
  const objek = await ctx.docs.get(r2Key);
  if (!objek) throw new Error(`Berkas ${r2Key} tidak ada di R2`);

  const bytes = await objek.arrayBuffer();
  const ukuranPdf = bytes.byteLength;

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

  const markdown = konversi.data ?? "";
  if (!markdown.trim()) {
    await catatEkstraksi(ctx.db, frbrUri, r2Key, ukuranPdf, null, Date.now() - mulai, "teks hasil konversi kosong");
    throw new Error(`Konversi ${r2Key} menghasilkan teks kosong`);
  }

  const kunciTeks = `teks/${frbrUri.replace(/^\//, "")}.md`;

  // Teks disimpan lebih dulu, apa pun hasil penguraiannya. Sebelumnya
  // penyimpanan terjadi setelah penulisan ke D1, sehingga dokumen yang gagal
  // disimpan juga kehilangan teksnya — justru dokumen yang paling perlu
  // diperiksa manual.
  await ctx.docs
    .put(kunciTeks, markdown, {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    })
    .catch(() => {});

  const pasal = uraikanPasal(markdown);
  const laporan = nilaiKualitasEkstraksi(markdown, pasal);

  if (!pasal.length) {
    // Bukan kegagalan sistem: sebagian PDF adalah pindaian tanpa struktur yang
    // bisa dikenali. Catat, lalu berhenti — jangan retry, hasilnya akan sama.
    await catatEkstraksi(ctx.db, frbrUri, r2Key, ukuranPdf, laporan, Date.now() - mulai, "tidak ada pasal terdeteksi");
    await catatLog(ctx.db, "ekstrak_pdf", "gagal", `${frbrUri}: tidak ada pasal terdeteksi`);
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
      .prepare(`UPDATE laws SET jumlah_pasal = ?, r2_text_key = ? WHERE frbr_uri = ?`)
      .bind(pasal.length, kunciTeks, frbrUri),
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

/** Tahap 2 — konsumer antrean. */
export async function prosesPesanIngest(
  ctx: KonteksIngest,
  pesan: PesanIngest,
): Promise<void> {
  // Pesan lama yang masih tertinggal di antrean untuk peraturan yang jelas di luar cakupan dibuang tanpa menyentuh
  // pasal.id (jatah 60 permintaan per menitnya dipakai bersama daftar dan detail) maupun Workers AI. Jenis yang
  // segmen URI-nya tak baku (POJK, PERMEN) tidak bisa dinilai dari URI: pesan `peraturan` dari Cron membawa kode
  // jenisnya, dan sisanya dinilai oleh baris D1 (indeksVektor, buatRingkasan, ekstrakPdf) atau setelah detailnya
  // diambil. Sengaja tidak dicatat ke sync_log: ribuan baris "dilewati" menutupi catatan sinkronisasi yang berarti.
  const luarCakupan =
    pesan.tipe === "peraturan" && pesan.jenis !== undefined
      ? !dalamCakupan(ctx.cakupan, pesan.jenis)
      : uriJelasDiLuarCakupan(ctx.cakupan, pesan.frbr_uri);
  if (luarCakupan) {
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

  if (pesan.tipe === "ekstrak_pdf") {
    await ekstrakPdf(ctx, pesan.frbr_uri, pesan.r2_key);
    return;
  }

  const { law, articles, relations } = await ctx.pasal.getLaw(pesan.frbr_uri);
  // URI dan jenis yang dilaporkan pasal.id seharusnya sejalan; bila tidak, yang menentukan adalah jenisnya.
  if (!dalamCakupan(ctx.cakupan, law.jenis)) {
    console.log("Lexa: peraturan tidak disimpan, di luar cakupan:", law.jenis, law.frbr_uri);
    return;
  }
  await simpanPeraturan(ctx.db, law, articles, relations);

  // Arsipkan teks lengkap ke R2 supaya tetap punya salinan bila sumber hilang.
  if (articles.length) {
    const teksLengkap = articles
      .map((a) => `Pasal ${a.nomor_pasal}${a.ayat ? ` ayat (${a.ayat})` : ""}\n${a.isi}`)
      .join("\n\n");
    const kunci = `teks/${law.frbr_uri.replace(/^\//, "")}.txt`;
    await ctx.docs
      .put(kunci, teksLengkap, {
        httpMetadata: { contentType: "text/plain; charset=utf-8" },
        customMetadata: { judul: law.judul.slice(0, 200), jenis: law.jenis },
      })
      .catch(() => {});
    await ctx.db
      .prepare(`UPDATE laws SET r2_text_key = ? WHERE frbr_uri = ?`)
      .bind(kunci, law.frbr_uri)
      .run()
      .catch(() => {});
  }

  // Pengindeksan vektor dipisah ke pesan sendiri: ia memanggil Workers AI dan
  // bisa jauh lebih lambat, jadi tidak boleh membuat penyimpanan D1 ikut retry.
  await ctx.queue.send({ tipe: "indeks_vektor", frbr_uri: law.frbr_uri });
}
