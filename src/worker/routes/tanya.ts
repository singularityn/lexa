/**
 * Asisten tanya-jawab peraturan.
 *
 * Aturan yang tidak boleh dilanggar: **setiap jawaban wajib bersandar pada
 * pasal yang benar-benar ada di indeks, dan sitasinya dikembalikan terpisah
 * agar bisa ditelusuri.** Aplikasi hukum yang mengarang lebih berbahaya
 * daripada aplikasi hukum yang menolak menjawab — orang mengambil keputusan
 * nyata dari apa yang mereka baca di sini.
 *
 * Karena itu bila pencarian tidak menemukan dasar yang cukup, model tidak
 * dipanggil sama sekali. Menolak menjawab adalah hasil yang sah.
 */

import { Hono } from "hono";
import { cari, type KonteksPencarian } from "../lib/search";
import { bacaSesi } from "../lib/sesi";
import type { SearchHit } from "../../shared/types";
import { labelSitasi, rapikanNomorPasal } from "../../shared/label";
import { bacaCakupan } from "../../shared/cakupan";

type Bindings = Env;

export const tanya = new Hono<{ Bindings: Bindings }>();

/** Skor RRF minimum agar sebuah pasal layak dijadikan dasar jawaban. */
const AMBANG_RELEVAN = 0.012;
const MAKS_KONTEKS = 6;
const MAKS_KARAKTER_PASAL = 1500;

export interface SitasiJawaban {
  frbr_uri: string;
  sitasi: string;
  judul: string;
  nomor_pasal: string | null;
  ayat: string | null;
  status: string;
}

function ringkasSitasi(h: SearchHit): SitasiJawaban {
  return {
    frbr_uri: h.frbr_uri,
    sitasi: labelSitasi(h),
    judul: h.judul,
    nomor_pasal: h.nomor_pasal,
    ayat: h.ayat,
    status: h.status,
  };
}

const INSTRUKSI = `Anda asisten riset hukum Indonesia bernama Lexa.

ATURAN MUTLAK:
1. Jawab HANYA berdasarkan kutipan pasal yang diberikan. Jangan menambahkan
   ketentuan, angka, sanksi, atau tenggat yang tidak ada di kutipan.
2. Setiap pernyataan hukum harus menyebut sumbernya, mis. "menurut UU 13/2003
   Pasal 156 ayat (1)".
3. Bila kutipan tidak cukup menjawab, katakan terus terang bahwa dasarnya belum
   ditemukan. JANGAN menebak.
4. Bila sebuah pasal berasal dari peraturan berstatus "dicabut" atau "diubah",
   sebutkan itu — pembaca perlu tahu ia mungkin tidak lagi berlaku.
5. Anda bukan penasihat hukum. Untuk keputusan penting, sarankan memeriksa
   naskah resmi dan berkonsultasi dengan ahli.

Jawab dalam bahasa Indonesia yang jelas dan ringkas.`;

// ---------------------------------------------------------------------------
// POST /api/tanya — satu putaran tanya-jawab
// ---------------------------------------------------------------------------
tanya.post("/", async (c) => {
  const body = await c.req.json<{ pertanyaan?: string; percakapan_id?: string }>().catch(() => null);
  const pertanyaan = body?.pertanyaan?.trim();

  if (!pertanyaan) {
    return c.json({ error: "kosong", message: "Pertanyaan wajib diisi." }, 400);
  }
  if (pertanyaan.length > 500) {
    return c.json({ error: "terlalu_panjang", message: "Pertanyaan maksimal 500 karakter." }, 400);
  }

  // Batasi laju: pemanggilan model berbiaya nyata, dan halaman ini terbuka
  // untuk siapa saja termasuk tamu.
  const ip = c.req.header("cf-connecting-ip") ?? "tanpa-ip";
  const kunciLaju = `tanya:${ip}`;
  const hitung = Number((await c.env.CACHE.get(kunciLaju)) ?? "0");
  if (hitung >= 20) {
    return c.json(
      { error: "terlalu_sering", message: "Terlalu banyak pertanyaan. Coba lagi beberapa menit lagi." },
      429,
    );
  }
  await c.env.CACHE.put(kunciLaju, String(hitung + 1), { expirationTtl: 300 });

  // --- Ambil dasar hukumnya lebih dulu ------------------------------------
  const ctxCari: KonteksPencarian = {
    db: c.env.DB,
    ai: c.env.AI,
    vectorize: c.env.VECTORIZE,
    cache: c.env.CACHE,
    embeddingModel: c.env.EMBEDDING_MODEL,
    cacheTtl: Number(c.env.SEARCH_CACHE_TTL) || 3600,
    cakupan: bacaCakupan(c.env.CAKUPAN_JENIS),
  };

  const hasil = await cari(ctxCari, { query: pertanyaan, mode: "hybrid", limit: 12 });

  // Hanya pasal yang cukup relevan yang boleh menjadi dasar. Ambang ini yang
  // membedakan "menjawab" dari "mengarang".
  const layak = hasil.hits
    .filter((h) => h.article_id && h.score >= AMBANG_RELEVAN)
    .slice(0, MAKS_KONTEKS);

  if (!layak.length) {
    return c.json({
      jawaban:
        "Saya belum menemukan pasal yang cukup relevan untuk menjawab pertanyaan itu " +
        "di dalam indeks Lexa. Coba susun ulang pertanyaannya dengan istilah yang " +
        "dipakai peraturan, atau telusuri langsung lewat pencarian.",
      sitasi: [],
      cukup_dasar: false,
    });
  }

  // Ambil teks pasalnya. Pencarian hanya mengembalikan cuplikan; model butuh
  // kalimat utuh agar tidak menyimpulkan dari potongan.
  const idPasal = layak.map((h) => h.article_id!).filter(Boolean);
  const { results: isiPasal } = await c.env.DB.prepare(
    `SELECT a.id, a.nomor_pasal, a.ayat, a.isi,
            l.jenis, l.nomor, l.tahun, l.judul, l.status
       FROM articles a JOIN laws l ON l.frbr_uri = a.frbr_uri
      WHERE a.id IN (${idPasal.map(() => "?").join(",")})`,
  ).bind(...idPasal).all<{
    id: string; nomor_pasal: string; ayat: string | null; isi: string;
    jenis: string; nomor: string; tahun: number; judul: string; status: string;
  }>();

  const konteks = isiPasal
    .map((p) => {
      const sitasi = `${labelSitasi(p)} Pasal ${rapikanNomorPasal(p.nomor_pasal)}${p.ayat ? ` ayat (${p.ayat})` : ""}`;
      const tandaStatus = p.status !== "berlaku" ? ` [PERHATIAN: peraturan ini berstatus ${p.status}]` : "";
      return `### ${sitasi}${tandaStatus}\n${p.isi.slice(0, MAKS_KARAKTER_PASAL)}`;
    })
    .join("\n\n");

  // Kegagalan model ditangkap dan diterjemahkan. Sebelumnya galat apa pun dari
  // Workers AI menembus sebagai 500 telanjang, yang tidak memberi tahu apa pun
  // kepada pengguna maupun kepada yang memperbaikinya — persis yang terjadi
  // ketika model lama melewati tanggal deprecation-nya.
  let jawaban = "";
  try {
    const balasan = (await c.env.AI.run(c.env.SUMMARY_MODEL as keyof AiModels, {
      messages: [
        { role: "system", content: INSTRUKSI },
        {
          role: "user",
          content: `Pertanyaan: ${pertanyaan}\n\nKutipan pasal yang tersedia:\n\n${konteks}`,
        },
      ],
      max_tokens: 800,
    } as never)) as unknown as { response?: string };

    jawaban = (balasan?.response ?? "").trim();
  } catch (e) {
    const detail = String(e).slice(0, 300);
    console.error("Lexa: model asisten gagal", c.env.SUMMARY_MODEL, detail);

    await c.env.DB.prepare(
      `INSERT INTO sync_log (job, status, detail, jumlah) VALUES ('asisten','gagal',?,0)`,
    ).bind(`${c.env.SUMMARY_MODEL}: ${detail}`).run().catch(() => {});

    return c.json(
      {
        error: "model_gagal",
        message:
          "Asisten sedang tidak dapat menyusun jawaban. Pasal yang relevan tetap " +
          "ditampilkan di bawah — Anda bisa membacanya langsung.",
        sitasi: layak.map(ringkasSitasi),
        cukup_dasar: true,
      },
      503,
    );
  }

  if (!jawaban) {
    // Balasan kosong tanpa melempar galat: tetap kembalikan sitasinya, karena
    // pasal yang ditemukan sudah bernilai meski rangkumannya gagal.
    return c.json(
      {
        error: "jawaban_kosong",
        message: "Asisten tidak menghasilkan jawaban. Pasal yang relevan ada di bawah.",
        sitasi: layak.map(ringkasSitasi),
        cukup_dasar: true,
      },
      503,
    );
  }

  const sitasi = layak.map(ringkasSitasi);

  // Simpan riwayat hanya untuk pengguna yang masuk — tamu tidak meninggalkan
  // jejak percakapan di server.
  const sesi = await bacaSesi(c.env.CACHE, c.req.header("cookie"));
  let percakapanId = body?.percakapan_id ?? null;

  if (sesi) {
    if (!percakapanId) {
      percakapanId = crypto.randomUUID();
      await c.env.DB.prepare(
        `INSERT INTO percakapan (id, pengguna_id, judul) VALUES (?,?,?)`,
      ).bind(percakapanId, sesi.pengguna_id, pertanyaan.slice(0, 120)).run().catch(() => {});
    }
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO pesan (percakapan_id, peran, isi) VALUES (?,'pengguna',?)`)
        .bind(percakapanId, pertanyaan),
      c.env.DB.prepare(`INSERT INTO pesan (percakapan_id, peran, isi, sitasi) VALUES (?,'asisten',?,?)`)
        .bind(percakapanId, jawaban, JSON.stringify(sitasi)),
    ]).catch(() => {});
  }

  return c.json({
    jawaban,
    sitasi,
    cukup_dasar: true,
    percakapan_id: percakapanId,
  }, 200, { "Cache-Control": "no-store" });
});
