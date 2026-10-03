/**
 * Fitur penunjang yang berdiri di atas data yang sudah ada:
 * bidang hukum, peta relasi, laporan kesalahan, dan analitik kueri nihil.
 */

import { Hono } from "hono";
import { tokenSah } from "../lib/auth";
import { pilihDalam } from "../lib/d1";
import { gabungkanBidang, type RingkasBidang } from "../lib/bidang";
import type { JenisRelasi, StatusPeraturan } from "../../shared/types";

type Bindings = Env;

export const fitur = new Hono<{ Bindings: Bindings }>();

// ---------------------------------------------------------------------------
// GET /api/bidang — daftar bidang hukum beserta jumlahnya
// ---------------------------------------------------------------------------
fitur.get("/bidang", async (c) => {
  // LIMIT dilepas: pengelompokan dilakukan setelah nama gabungan dipecah, jadi
  // memotong di SQL akan membuang bagian yang seharusnya menambah hitungan
  // bidang lain. Jumlah barisnya puluhan, bukan ribuan.
  const { results } = await c.env.DB.prepare(
    `SELECT bidang AS nama, COUNT(*) AS jumlah,
            SUM(CASE WHEN status = 'berlaku' THEN 1 ELSE 0 END) AS berlaku,
            MAX(tahun) AS tahun_terbaru
       FROM laws
      WHERE bidang IS NOT NULL AND TRIM(bidang) != ''
      GROUP BY bidang`,
  ).all<RingkasBidang>();

  return c.json({ bidang: gabungkanBidang(results) }, 200, {
    "Cache-Control": "public, max-age=3600",
  });
});

// ---------------------------------------------------------------------------
// GET /api/relasi/graf?uri=&kedalaman= — peta relasi antarperaturan
//
// Daftar relasi di halaman detail menjawab "apa saja yang terkait". Graf
// menjawab pertanyaan yang tidak bisa dijawab daftar: aturan turunan apa yang
// lahir dari sebuah undang-undang, dan lewat rantai mana sebuah pasal sampai
// pada bentuknya sekarang.
// ---------------------------------------------------------------------------
interface Simpul {
  uri: string;
  label: string;
  jenis: string | null;
  tahun: number | null;
  status: StatusPeraturan | null;
  ada_di_indeks: boolean;
  jarak: number;
}
interface Sisi {
  dari: string;
  ke: string;
  jenis: JenisRelasi;
}

fitur.get("/relasi/graf", async (c) => {
  const uri = c.req.query("uri");
  if (!uri) return c.json({ error: "uri_kosong", message: "Parameter `uri` wajib diisi." }, 400);

  // Kedalaman dibatasi 2: pada peraturan yang banyak diubah, kedalaman 3 sudah
  // menghasilkan ratusan simpul yang tidak terbaca lagi sebagai gambar.
  const kedalaman = Math.min(Math.max(Number(c.req.query("kedalaman")) || 1, 1), 2);

  // Penelusuran dipisah dari pelabelan.
  //
  // Versi sebelumnya menggabungkan metadata lewat JOIN di dalam kueri relasi
  // dua arah. Itu keliru: pada cabang kedua (relasi masuk), baris yang ter-JOIN
  // adalah milik `from_uri`, tetapi kode melabelinya seolah milik `to_uri`.
  // Akibatnya simpul yang ditemukan lewat relasi masuk kehilangan sitasinya dan
  // tampil sebagai potongan URI mentah seperti "pp/2021/35".
  //
  // Sekarang: kumpulkan sisi dulu, baru ambil metadata seluruh simpul sekaligus.
  const sisi: Sisi[] = [];
  const jarakSimpul = new Map<string, number>([[uri, 0]]);
  const sudahDitelusuri = new Set<string>();
  const sisiTercatat = new Set<string>();
  let lapisan = [uri];

  // Batas pengaman: peraturan yang dirujuk ratusan peraturan lain (mis. UU induk bidang
  // tertentu) membuat kedalaman 2 meledak menjadi ribuan simpul dan puluhan kueri D1.
  // Antarmuka pun hanya menggambar sebagian kecil dari itu.
  const MAKS_SIMPUL = 200;

  for (let d = 0; d < kedalaman && lapisan.length; d++) {
    const belum = lapisan.filter((u) => !sudahDitelusuri.has(u));
    if (!belum.length) break;
    belum.forEach((u) => sudahDitelusuri.add(u));

    // Relasi dua arah: sebuah peraturan sama pentingnya dilihat dari apa yang
    // ia ubah maupun apa yang mengubahnya. Daftar `belum` bisa panjang, jadi
    // dipecah (D1 membatasi 100 parameter per kueri); sisi yang sama bisa muncul
    // dari dua potongan dan dibuang duplikatnya di bawah.
    const hasil = await pilihDalam<{ from_uri: string; to_uri: string; jenis_relasi: JenisRelasi }>(
      c.env.DB,
      belum,
      (t) => `SELECT from_uri, to_uri, jenis_relasi FROM relations WHERE from_uri IN (${t}) OR to_uri IN (${t})`,
      { ulang: 2 },
    );

    const berikut: string[] = [];
    for (const r of hasil) {
      for (const u of [r.from_uri, r.to_uri]) {
        if (jarakSimpul.has(u) || jarakSimpul.size >= MAKS_SIMPUL) continue;
        jarakSimpul.set(u, d + 1);
        berikut.push(u);
      }
      // Sisi hanya dicatat bila kedua ujungnya masuk dalam graf yang dikembalikan.
      const kunci = `${r.from_uri}\u0000${r.to_uri}\u0000${r.jenis_relasi}`;
      if (jarakSimpul.has(r.from_uri) && jarakSimpul.has(r.to_uri) && !sisiTercatat.has(kunci)) {
        sisiTercatat.add(kunci);
        sisi.push({ dari: r.from_uri, ke: r.to_uri, jenis: r.jenis_relasi });
      }
    }
    lapisan = berikut;
  }

  // Satu kueri metadata untuk seluruh simpul, arah relasinya tidak lagi relevan.
  const semuaUri = [...jarakSimpul.keys()];
  const meta = await pilihDalam<{
    frbr_uri: string; jenis: string; nomor: string; tahun: number; status: StatusPeraturan;
  }>(
    c.env.DB,
    semuaUri,
    (t) => `SELECT frbr_uri, jenis, nomor, tahun, status FROM laws WHERE frbr_uri IN (${t})`,
  );

  const petaMeta = new Map(meta.map((m) => [m.frbr_uri, m]));

  const simpul: Simpul[] = semuaUri.map((u) => {
    const m = petaMeta.get(u);
    return {
      uri: u,
      // Peraturan yang belum ter-ingest tetap ditampilkan — keberadaan
      // relasinya adalah informasi, meski judulnya belum diketahui.
      label: m ? `${m.jenis} ${m.nomor}/${m.tahun}` : u.split("/").slice(-3).join("/"),
      jenis: m?.jenis ?? null,
      tahun: m?.tahun ?? null,
      status: m?.status ?? null,
      ada_di_indeks: Boolean(m),
      jarak: jarakSimpul.get(u) ?? 0,
    };
  });

  return c.json({ pusat: uri, simpul, sisi }, 200, {
    "Cache-Control": "public, max-age=1800",
  });
});

// ---------------------------------------------------------------------------
// POST /api/laporan — pelaporan kesalahan data oleh pengguna
// ---------------------------------------------------------------------------
const JENIS_LAPORAN = new Set([
  "teks_salah", "metadata_salah", "pasal_hilang", "status_salah", "pdf_rusak", "lainnya",
]);

fitur.post("/laporan", async (c) => {
  const body = await c.req.json<{
    uri?: string; jenis?: string; keterangan?: string; konteks?: string;
  }>().catch(() => null);

  if (!body?.uri || !body?.keterangan?.trim()) {
    return c.json(
      { error: "tidak_lengkap", message: "`uri` dan `keterangan` wajib diisi." },
      400,
    );
  }
  const jenis = JENIS_LAPORAN.has(body.jenis ?? "") ? body.jenis! : "lainnya";
  const keterangan = body.keterangan.trim().slice(0, 2000);

  // Batasi banjir laporan dari satu alamat: satu laporan per peraturan per
  // menit sudah lebih dari cukup untuk penggunaan yang jujur.
  const ip = c.req.header("cf-connecting-ip") ?? "tanpa-ip";
  const kunci = `lapor:${ip}:${body.uri}`;
  if (await c.env.CACHE.get(kunci)) {
    return c.json(
      { error: "terlalu_sering", message: "Laporan untuk peraturan ini baru saja dikirim." },
      429,
    );
  }

  await c.env.DB.prepare(
    `INSERT INTO laporan_kesalahan (frbr_uri, jenis, keterangan, konteks) VALUES (?,?,?,?)`,
  ).bind(body.uri, jenis, keterangan, body.konteks?.slice(0, 500) ?? null).run();

  await c.env.CACHE.put(kunci, "1", { expirationTtl: 60 }).catch(() => {});

  return c.json({ status: "diterima", pesan: "Terima kasih, laporan Anda tercatat." }, 201);
});

// ---------------------------------------------------------------------------
// GET /api/admin/laporan — daftar laporan masuk
// ---------------------------------------------------------------------------
fitur.get("/admin/laporan", async (c) => {
  if (!tokenSah(c.req.header("x-admin-token"), c.env.ADMIN_TOKEN)) {
    return c.json({ error: "tidak_berwenang", message: "Header x-admin-token tidak valid." }, 401);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.frbr_uri, p.jenis, p.keterangan, p.konteks, p.status, p.created_at,
            l.judul
       FROM laporan_kesalahan p
       LEFT JOIN laws l ON l.frbr_uri = p.frbr_uri
      ORDER BY p.status = 'baru' DESC, p.created_at DESC
      LIMIT 200`,
  ).all<Record<string, unknown>>();

  return c.json({ laporan: results });
});

// ---------------------------------------------------------------------------
// GET /api/admin/kueri-nihil — peta lubang data yang paling jujur
//
// Kueri yang berulang kali tidak menghasilkan apa pun memberi tahu persis apa
// yang dicari orang tetapi tidak Anda punya. Ini mengarahkan prioritas panen
// jauh lebih baik daripada tebakan.
// ---------------------------------------------------------------------------
fitur.get("/admin/kueri-nihil", async (c) => {
  if (!tokenSah(c.req.header("x-admin-token"), c.env.ADMIN_TOKEN)) {
    return c.json({ error: "tidak_berwenang", message: "Header x-admin-token tidak valid." }, 401);
  }

  const hari = Math.min(Math.max(Number(c.req.query("hari")) || 30, 1), 365);

  const [nihil, ringkas] = await Promise.all([
    c.env.DB.prepare(
      `SELECT query, COUNT(*) AS frekuensi, MAX(created_at) AS terakhir
         FROM search_log
        WHERE jumlah_hasil = 0
          AND created_at >= datetime('now', ?)
        GROUP BY LOWER(TRIM(query))
        ORDER BY frekuensi DESC, terakhir DESC
        LIMIT 100`,
    ).bind(`-${hari} days`).all<{ query: string; frekuensi: number; terakhir: string }>(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS total_pencarian,
              SUM(CASE WHEN jumlah_hasil = 0 THEN 1 ELSE 0 END) AS nihil,
              ROUND(AVG(durasi_ms)) AS rata_durasi_ms
         FROM search_log WHERE created_at >= datetime('now', ?)`,
    ).bind(`-${hari} days`).first<{ total_pencarian: number; nihil: number; rata_durasi_ms: number }>(),
  ]);

  const total = ringkas?.total_pencarian ?? 0;
  return c.json({
    rentang_hari: hari,
    total_pencarian: total,
    pencarian_nihil: ringkas?.nihil ?? 0,
    persen_nihil: total ? Number((((ringkas?.nihil ?? 0) / total) * 100).toFixed(1)) : 0,
    rata_durasi_ms: ringkas?.rata_durasi_ms ?? 0,
    kueri: nihil.results,
  });
});
