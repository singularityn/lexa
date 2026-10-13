/**
 * Mengenali dokumen BPK dari tautan di daftar hasil situs BPK, dan mencocokkannya dengan peraturan di Lexa.
 *
 * Worker tidak pernah menghubungi peraturan.bpk.go.id. Skrip panen (scripts/bpk-console-harvest.js) menjelajahi daftar
 * peraturan BPK dari peramban pemiliknya dan mengirim tiap entri apa adanya: alamat rincian, teks tautan, dan teks kartu
 * di sekitarnya. Pengenalan sitasinya dikerjakan DI SINI, bukan di skrip, supaya tata bahasanya satu (sitasi.ts, bpk.ts,
 * nomor.ts), bisa diuji, dan bisa diperbaiki tanpa meminta pemilik menempel skrip baru.
 *
 * Mengapa perlu: di produksi hanya 3 dari 5.011 PP yang punya bpk_id, sehingga daftar kerja panen (GET /api/impor/butuh-teks)
 * hampir kosong alamat. Penjelajahan daftar BPK mengisinya: tiap entri dicocokkan dengan peraturan Lexa menurut sitasi,
 * lalu bpk_id dan alamat rinciannya disimpan.
 *
 * Kehati-hatian: tautan yang keliru berarti PDF yang keliru, dan PDF yang keliru menimpa pasal yang benar. Karena itu
 * hanya slug dan teks tautan yang dipakai mengenali sitasi (teks kartu hanya untuk tahun Tap MPR), dua sumber yang
 * berbeda pendapat tidak dipilih secara diam-diam, dan jenis peraturan tak pernah ditukar (UU 7/1964 bukan Perppu 7/1964).
 */

import { dalamCakupan, type Cakupan } from "../../shared/cakupan";
import { frbrDari, sitasiDariTeks } from "./bpk";
import { batchBerkelompok, pilihBanyak } from "./d1";
import { hitungGiliran } from "./isi";
import { kunciSitasi, nomorKanonik, samaSitasi, uraiNomorTapMpr } from "./nomor";
import type { Sitasi } from "./sitasi";

/** Satu entri hasil penjelajahan daftar BPK, apa adanya dari skrip panen. */
export interface TautanMasuk {
  /** Alamat halaman rincian di BPK ("/Details/<id>/<slug>", boleh relatif atau mutlak). */
  url?: string | null;
  bpk_id?: string | number | null;
  slug?: string | null;
  /** Teks tautan judul entri, mis. "UU No. 15 Tahun 2006". */
  teks?: string | null;
  /** Teks kartu di sekitar entri. Hanya dipakai untuk mencari tahun Tap MPR yang nomornya tak memuat tahun. */
  konteks?: string | null;
  /** Bila daftar BPK menampilkan jenis, nomor, dan tahun sebagai kolom terpisah. */
  jenis?: string | null;
  nomor?: string | number | null;
  tahun?: string | number | null;
  /** Pemetaan manual ke peraturan Lexa (frbr_uri): melewati pengenalan sitasi. */
  uri?: string | null;
}

export interface Dikenali {
  bpk_id: string;
  slug: string | null;
  /** Sitasi yang mungkin dituju (satu, atau lebih bila slug dan teks berselisih). Kosong bila `uri` manual diberikan. */
  kandidat: Sitasi[];
  uri: string | null;
}

export type HasilKenali = { ok: true; dok: Dikenali } | { ok: false; alasan: string };

const POLA_RINCIAN = /\/(?:Home\/)?Details\/(\d{1,10})(?:\/([^/?#\s]+))?/i;
const POLA_SLUG_AMAN = /^[A-Za-z0-9._~%-]{1,200}$/;
const POLA_HOST_BPK = /^(?:www\.)?peraturan\.bpk\.go\.id$/i;

/** Id dan slug dari alamat rincian BPK. Alamat mutlak ke situs lain ditolak; yang relatif dianggap milik BPK. */
export function bacaAlamatBpk(url: string | null | undefined): { bpk_id: string; slug: string | null } | null {
  if (!url) return null;
  const mutlak = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url);
  if (mutlak && !POLA_HOST_BPK.test(mutlak[1])) return null;
  const m = POLA_RINCIAN.exec(url);
  return m ? { bpk_id: m[1], slug: m[2] ?? null } : null;
}

/** Alamat rincian yang disimpan: dibangun dari id dan slug yang sudah divalidasi, bukan disalin dari masukan. */
export function alamatRincian(base: string, bpkId: string, slug: string | null): string {
  return `${base.replace(/\/$/, "")}/Details/${bpkId}${slug ? `/${slug}` : ""}`;
}

const dekode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const tahunEksplisit = (t: string | null | undefined): number | null => {
  const m = t ? /\btahun\s+(\d{4})\b/i.exec(t) : null;
  return m ? Number(m[1]) : null;
};

const tahunWajar = (t: number | null): t is number => t !== null && t >= 1900 && t <= 2100;

/** Awal teks yang menandakan Tap MPR: "Ketetapan MPR ...", "TAP MPR ...", "tap-mpr-no-...". */
const POLA_AWAL_TAP_MPR =
  /^[\W_]*(?:tap[\s-]*mprs?|ketetapan[\s-]+(?:mprs?|majelis[\s-]+permusyawaratan[\s-]+rakyat(?:[\s-]+sementara)?))(?![a-z])/i;

/**
 * Tap MPR. BPK menomorinya tak seragam: "Ketetapan MPR Nomor XVI/MPR/1998" (slug "tap-mpr-no-xvimpr1998", tanpa garis
 * miring) atau "TAP MPR No. I" (slug "tap-mpr-no-i", tahunnya hanya ada di kolom Tahun). uraiSitasi tak mengenal jenis ini.
 */
function sitasiTapMpr(teks: string, tahunCadangan: number | null): Sitasi | null {
  const awal = POLA_AWAL_TAP_MPR.exec(teks);
  if (!awal) return null;
  // BPK menulis "Undang-undang (UU) No. 8 Tahun 1982"; Tap MPR bisa serupa: "Ketetapan MPR (TAP MPR) Nomor VI/MPR/2001".
  const sisa = teks.slice(awal[0].length).replace(/^\s*\([^)]{1,20}\)/, "");
  const m = /^[\s.,:;-]*(?:(?:nomor|no)\b\.?[\s.,:;-]*)?([A-Za-z0-9/.\- ]{1,40}?)(?=\s+(?:tahun|tentang|th|thn)\b|\s*[(,;]|\s*$)/i.exec(sisa);
  const tap = m ? uraiNomorTapMpr(m[1].trim()) : null;
  if (!tap) return null;
  const tahun = tap.tahun ?? tahunEksplisit(sisa) ?? tahunCadangan;
  if (!tahunWajar(tahun)) return null;
  return { jenis: "TAP_MPR", nomor: tap.badan ? `${tap.romawi}-${tap.badan}-${tahun}` : tap.romawi.toUpperCase(), tahun };
}

const POLA_AWAL_UUD = /^[\W_]*(?:uud(?![a-z])|undang[\s-]*undang[\s-]+dasar(?![a-z]))/i;
const URUTAN_PERUBAHAN: Record<string, number> = { pertama: 1, kedua: 2, ketiga: 3, keempat: 4 };

/**
 * UUD 1945. Lexa menyimpan naskah asli (nomor "1945") dan empat perubahan ("1945/P1" ... "1945/P4"). Dokumen BPK "UUD 1945
 * dan Amandemen" dipetakan ke naskah asli; perubahan hanya bila disebut tegas. UUD Sementara dan Konstitusi RIS bukan 1945.
 */
function sitasiUud(teks: string): Sitasi | null {
  if (!POLA_AWAL_UUD.test(teks) || /sementara|uuds|serikat|\bris\b|pengganti/i.test(teks)) return null;
  const p = /perubahan\s+(?:(pertama|kedua|ketiga|keempat)|ke-?\s?([1-4]))\b/i.exec(teks);
  const urutan = p ? (p[1] ? URUTAN_PERUBAHAN[p[1].toLowerCase()] : Number(p[2])) : 0;
  return { jenis: "UUD", nomor: urutan ? `1945/P${urutan}` : "1945", tahun: 1945 };
}

function sitasiDariKandidat(teks: string, tahunCadangan: number | null): Sitasi | null {
  const s = teks.replace(/\s+/g, " ").trim();
  if (!s) return null;
  const hasil = sitasiTapMpr(s, tahunCadangan) ?? sitasiUud(s) ?? sitasiDariTeks(s);
  return hasil && tahunWajar(hasil.tahun) ? { jenis: hasil.jenis, nomor: hasil.nomor, tahun: hasil.tahun } : null;
}

const kunciTeks = (s: Sitasi): string => {
  const k = kunciSitasi(s.jenis, s.nomor, s.tahun);
  return `${k.jenis}|${k.tahun}|${k.inti}|${k.badan ?? ""}`;
};

/**
 * Kenali satu entri. Sitasi dicari dari slug lalu teks tautan (dan kolom terpisah bila ada). Bila keduanya mengenali
 * peraturan yang berbeda, KEDUANYA dikembalikan sebagai kandidat dan pencocokan dengan data Lexa yang memutuskan: BPK
 * pernah menamai Perppu 7/1964 "uu-no-7-tahun-1964" sementara judulnya Perppu.
 */
export function kenaliTautan(mentah: TautanMasuk): HasilKenali {
  // Masukan berasal dari peramban: tipe dan panjangnya tak dipercaya.
  const aman = (v: unknown, maks: number): string => (typeof v === "string" || typeof v === "number" ? String(v).slice(0, maks).trim() : "");
  const masuk = {
    url: aman(mentah?.url, 500), bpk_id: aman(mentah?.bpk_id, 12), slug: aman(mentah?.slug, 200), teks: aman(mentah?.teks, 400),
    konteks: aman(mentah?.konteks, 800), jenis: aman(mentah?.jenis, 40), nomor: aman(mentah?.nomor, 40), tahun: aman(mentah?.tahun, 4),
    uri: aman(mentah?.uri, 300),
  };
  const alamat = bacaAlamatBpk(masuk.url);
  if (masuk.url && !alamat && !masuk.bpk_id) return { ok: false, alasan: "alamat bukan halaman rincian BPK" };
  const id = masuk.bpk_id || alamat?.bpk_id || "";
  if (!/^\d{1,10}$/.test(id)) return { ok: false, alasan: "id dokumen BPK tak ditemukan" };

  const slugMentah = masuk.slug || alamat?.slug || null;
  const slug = slugMentah && POLA_SLUG_AMAN.test(slugMentah) ? slugMentah : null;
  if (masuk.uri) return { ok: true, dok: { bpk_id: id, slug, kandidat: [], uri: masuk.uri } };

  const teks = masuk.teks.replace(/\s+/g, " ");
  const tahunCadangan = (Number(masuk.tahun) || null) ?? tahunEksplisit(teks) ?? tahunEksplisit(masuk.konteks);

  const sumber: string[] = [];
  if (masuk.jenis && masuk.nomor && masuk.tahun) sumber.push(`${masuk.jenis} Nomor ${masuk.nomor} Tahun ${masuk.tahun}`);
  if (slug) sumber.push(dekode(slug).replace(/[-_]+/g, " "));
  if (teks) sumber.push(teks);

  const kandidat = new Map<string, Sitasi>();
  for (const t of sumber) {
    const s = sitasiDariKandidat(t, tahunCadangan);
    if (s && !kandidat.has(kunciTeks(s))) kandidat.set(kunciTeks(s), s);
  }
  if (!kandidat.size) return { ok: false, alasan: "sitasi tak dikenali dari slug maupun teks tautan" };
  return { ok: true, dok: { bpk_id: id, slug, kandidat: [...kandidat.values()], uri: null } };
}

// ---------------------------------------------------------------------------
// Pencocokan dengan tabel laws
// ---------------------------------------------------------------------------

export interface BarisLaw {
  frbr_uri: string;
  jenis: string;
  nomor: string;
  tahun: number;
  judul: string;
  bpk_id: string | null;
  sumber_url: string | null;
  jumlah_pasal: number;
  r2_pdf_key: string | null;
}

const KOLOM_LAW = "frbr_uri, jenis, nomor, tahun, judul, bpk_id, sumber_url, jumlah_pasal, r2_pdf_key";
/** Sisakan ruang di bawah batas 100 parameter D1 untuk jenis dan tahun. */
const MAKS_NOMOR_PER_KUERI = 80;

/** Penulisan nomor yang mungkin tersimpan untuk sitasi ini: apa adanya, tanpa nol di depan, dengan satu nol, huruf besar/kecil. */
function ragamNomor(nomor: string): string[] {
  const apa = nomor.trim();
  const tanpaNol = apa.replace(/\s+/g, "").replace(/^0+(?=[0-9])/, "");
  return [...new Set([apa, tanpaNol, `0${tanpaNol}`, tanpaNol.toUpperCase(), tanpaNol.toLowerCase()])];
}

/**
 * Baris `laws` untuk tiap sitasi (sejajar dengan masukan; kosong bila tak ada). Lebih dari satu baris berarti duplikat
 * di data (mis. PP 1/2022 bernomor "01" dan "1"); semuanya peraturan yang sama.
 *
 * UU, Perppu, PP dan sejenisnya dicari lewat indeks laws(jenis, nomor, tahun) per jenis dan tahun. Tap MPR dan UUD
 * (puluhan baris, nomor tak seragam) dibaca seluruhnya dan dibandingkan di memori.
 */
export async function cariSitasi(db: D1Database, daftar: readonly Sitasi[]): Promise<BarisLaw[][]> {
  const kunci = daftar.map((s) => kunciSitasi(s.jenis, s.nomor, s.tahun));
  const hasil: BarisLaw[][] = daftar.map(() => []);
  if (!daftar.length) return hasil;

  const pernyataan: D1PreparedStatement[] = [];
  const memori: string[] = [...new Set(daftar.map((s) => s.jenis).filter((j) => j === "TAP_MPR" || j === "UUD"))];
  for (const jenis of memori) pernyataan.push(db.prepare(`SELECT ${KOLOM_LAW} FROM laws WHERE jenis = ?`).bind(jenis));

  const kelompok = new Map<string, { jenis: string; tahun: number; nomor: Set<string> }>();
  for (const s of daftar) {
    if (memori.includes(s.jenis)) continue;
    const k = `${s.jenis}|${s.tahun}`;
    const g = kelompok.get(k) ?? { jenis: s.jenis, tahun: s.tahun, nomor: new Set<string>() };
    for (const n of ragamNomor(s.nomor)) g.nomor.add(n);
    kelompok.set(k, g);
  }
  for (const g of kelompok.values()) {
    const nomor = [...g.nomor];
    for (let i = 0; i < nomor.length; i += MAKS_NOMOR_PER_KUERI) {
      const potong = nomor.slice(i, i + MAKS_NOMOR_PER_KUERI);
      pernyataan.push(
        db
          .prepare(`SELECT ${KOLOM_LAW} FROM laws WHERE jenis = ? AND tahun = ? AND nomor IN (${potong.map(() => "?").join(",")})`)
          .bind(g.jenis, g.tahun, ...potong),
      );
    }
  }

  const kolam = new Map<string, BarisLaw>();
  for (const baris of await pilihBanyak<BarisLaw>(db, pernyataan)) for (const b of baris) kolam.set(b.frbr_uri, b);
  const kunciKolam = [...kolam.values()].map((b) => ({ b, k: kunciSitasi(b.jenis, b.nomor, b.tahun) }));

  daftar.forEach((_, i) => {
    hasil[i] = kunciKolam.filter(({ k }) => samaSitasi(kunci[i], k)).map(({ b }) => b);
  });
  return hasil;
}

/** Baris yang paling berisi di antara duplikat: yang sudah berpasal, lalu yang sudah ber-PDF, lalu yang uninya sama. */
export function pilihUtama(baris: readonly BarisLaw[], uriDiinginkan?: string): BarisLaw | undefined {
  const skor = (b: BarisLaw) => (b.frbr_uri === uriDiinginkan ? 4 : 0) + (b.jumlah_pasal > 0 ? 2 : 0) + (b.r2_pdf_key ? 1 : 0);
  return [...baris].sort((a, b) => skor(b) - skor(a) || a.frbr_uri.localeCompare(b.frbr_uri))[0];
}

// ---------------------------------------------------------------------------
// Menautkan entri BPK ke peraturan Lexa
// ---------------------------------------------------------------------------

export type StatusTautan =
  | "ditautkan" // bpk_id baru disimpan
  | "sudah" // sudah tertaut ke dokumen yang sama
  | "dibuat" // belum ada di Lexa; baris baru dibuat (opsi `buat`)
  | "tidak_ada" // dikenali, tetapi Lexa tak punya peraturannya (dan `buat` tak diminta)
  | "luar_cakupan"
  | "tidak_dikenali"
  | "ambigu" // slug dan teks menunjuk dua peraturan Lexa yang berbeda
  | "bentrok" // peraturannya sudah tertaut ke dokumen BPK lain
  | "gagal";

export interface HasilTautan {
  bpk_id: string | null;
  status: StatusTautan;
  /** Peraturan Lexa yang dituju (yang paling berisi bila ada duplikat). */
  uri?: string;
  /** Semua baris yang tertaut (duplikat data ikut tertaut karena satu peraturan). */
  uris?: string[];
  sitasi?: string;
  alasan?: string;
}

export type RingkasTautan = Record<StatusTautan, number>;

export interface OpsiTautan {
  /** BPK_BASE, untuk membangun alamat rincian. */
  base: string;
  cakupan: Cakupan;
  /** Buat baris baru untuk peraturan dalam cakupan yang dikenali tetapi belum ada di Lexa. */
  buat: boolean;
}

const NAMA_PANJANG: Record<string, string> = {
  UU: "Undang-Undang",
  PP: "Peraturan Pemerintah",
  PERPPU: "Peraturan Pemerintah Pengganti Undang-Undang",
  TAP_MPR: "Ketetapan MPR",
  UUD: "Undang-Undang Dasar",
};

const labelUntuk = (s: Sitasi) => `${s.jenis} ${s.nomor}/${s.tahun}`;

/** Judul sementara untuk baris baru: teks tautan bila memuat nomor dan tahunnya, kalau tidak dirangkai dari sitasi. */
function judulSementara(s: Sitasi, teks: string | null | undefined): string {
  const t = (teks ?? "").replace(/\s+/g, " ").trim();
  if (t.length >= 10 && t.includes(String(s.tahun))) return t.slice(0, 300);
  return `${NAMA_PANJANG[s.jenis] ?? s.jenis} Nomor ${s.nomor} Tahun ${s.tahun}`;
}

const SQL_TAUTKAN =
  `UPDATE laws SET bpk_id = ?,
     sumber_url = CASE WHEN sumber_url IS NULL OR sumber_url = '' OR sumber_url NOT LIKE '%bpk.go.id%' THEN ? ELSE sumber_url END,
     updated_at = datetime('now')
   WHERE frbr_uri = ? AND (bpk_id IS NULL OR bpk_id = '' OR bpk_id = ?)`;

/**
 * Tautkan entri-entri daftar BPK ke peraturan Lexa: simpan bpk_id dan alamat rinciannya supaya panen PDF
 * (GET /api/impor/butuh-teks) tahu ke mana harus pergi. Tidak pernah mengubah metadata lain.
 */
export async function tautkanBpk(
  db: D1Database,
  daftar: readonly TautanMasuk[],
  opsi: OpsiTautan,
): Promise<{ ringkas: RingkasTautan; hasil: HasilTautan[] }> {
  // Entri berasal dari peramban: larik JSON bisa memuat null atau nilai bukan objek, dan itu tak boleh menjatuhkan seluruh permintaan.
  const kenal = daftar.map((m) => ({ masuk: (m && typeof m === "object" ? m : {}) as TautanMasuk, kenal: kenaliTautan(m) }));

  // Sitasi dalam cakupan yang perlu dicari, tanpa kembaran.
  const calon = new Map<string, Sitasi>();
  for (const { kenal: k } of kenal) {
    if (!k.ok) continue;
    for (const s of k.dok.kandidat) if (dalamCakupan(opsi.cakupan, s.jenis)) calon.set(kunciTeks(s), s);
  }
  const daftarCalon = [...calon.values()];
  const baris = await cariSitasi(db, daftarCalon);
  const barisPer = new Map(daftarCalon.map((s, i) => [kunciTeks(s), baris[i]]));

  // Pemetaan manual (uri) dicari langsung.
  const uriManual = [...new Set(kenal.flatMap(({ kenal: k }) => (k.ok && k.dok.uri ? [k.dok.uri] : [])))];
  const barisManual = new Map<string, BarisLaw>();
  if (uriManual.length) {
    const pernyataan: D1PreparedStatement[] = [];
    for (let i = 0; i < uriManual.length; i += MAKS_NOMOR_PER_KUERI) {
      const potong = uriManual.slice(i, i + MAKS_NOMOR_PER_KUERI);
      pernyataan.push(db.prepare(`SELECT ${KOLOM_LAW} FROM laws WHERE frbr_uri IN (${potong.map(() => "?").join(",")})`).bind(...potong));
    }
    for (const b of (await pilihBanyak<BarisLaw>(db, pernyataan)).flat()) barisManual.set(b.frbr_uri, b);
  }

  const hasil: HasilTautan[] = [];
  const kelompok: Array<{ id: string; pernyataan: D1PreparedStatement[] }> = [];
  /** Dokumen BPK yang sudah diklaim sebuah peraturan dalam permintaan ini, supaya dua entri tak saling menimpa. */
  const diklaim = new Map<string, string>();
  const dibuat = new Set<string>();

  for (const { masuk, kenal: k } of kenal) {
    const indeks = hasil.length;
    if (!k.ok) {
      // Id dokumen dilaporkan bila terbaca (dari kolom atau alamat), supaya pemanggil bisa mencatat entri mana yang bermasalah.
      const id = masuk.bpk_id != null ? String(masuk.bpk_id) : (bacaAlamatBpk(typeof masuk.url === "string" ? masuk.url : null)?.bpk_id ?? null);
      hasil.push({ bpk_id: id, status: "tidak_dikenali", alasan: k.alasan });
      continue;
    }
    const { dok } = k;
    const alamat = alamatRincian(opsi.base, dok.bpk_id, dok.slug);

    /** Tautkan ke baris-baris ini; mengembalikan hasil entrinya. */
    const tautkan = (rows: readonly BarisLaw[], sitasi?: string): HasilTautan => {
      const tertaut: string[] = [];
      let barisBaru = 0;
      let bentrok: string | null = null;
      for (const b of rows) {
        const pemegang = diklaim.get(b.frbr_uri) ?? (b.bpk_id || null);
        if (pemegang && pemegang !== dok.bpk_id) {
          bentrok ??= pemegang;
          continue;
        }
        if (!b.bpk_id && !diklaim.has(b.frbr_uri)) barisBaru++;
        diklaim.set(b.frbr_uri, dok.bpk_id);
        tertaut.push(b.frbr_uri);
        // Satu kelompok per baris: kegagalan satu baris tak membatalkan yang lain.
        kelompok.push({ id: `${indeks}:${b.frbr_uri}`, pernyataan: [db.prepare(SQL_TAUTKAN).bind(dok.bpk_id, alamat, b.frbr_uri, dok.bpk_id)] });
      }
      if (!tertaut.length) {
        return { bpk_id: dok.bpk_id, status: "bentrok", sitasi, uri: rows[0]?.frbr_uri, alasan: `peraturan ini sudah tertaut ke dokumen BPK ${bentrok}` };
      }
      const utama = pilihUtama(rows.filter((b) => tertaut.includes(b.frbr_uri)))?.frbr_uri ?? tertaut[0];
      return { bpk_id: dok.bpk_id, status: barisBaru ? "ditautkan" : "sudah", uri: utama, uris: tertaut, sitasi };
    };

    if (dok.uri) {
      const b = barisManual.get(dok.uri);
      if (!b) hasil.push({ bpk_id: dok.bpk_id, status: "tidak_ada", alasan: `${dok.uri} tidak ada di Lexa` });
      else if (!dalamCakupan(opsi.cakupan, b.jenis)) hasil.push({ bpk_id: dok.bpk_id, status: "luar_cakupan", uri: b.frbr_uri });
      else hasil.push(tautkan([b]));
      continue;
    }

    const dalam = dok.kandidat.filter((s) => dalamCakupan(opsi.cakupan, s.jenis));
    if (!dalam.length) {
      hasil.push({ bpk_id: dok.bpk_id, status: "luar_cakupan", sitasi: dok.kandidat.map(labelUntuk).join(" / ") });
      continue;
    }
    const cocok = dalam.map((s) => ({ s, rows: barisPer.get(kunciTeks(s)) ?? [] })).filter((x) => x.rows.length);
    // Dua kandidat yang menunjuk himpunan baris yang sama (mis. Tap MPR "I" dan "I/MPR/2003") adalah satu peraturan.
    const himpunan = (rows: readonly BarisLaw[]) => rows.map((r) => r.frbr_uri).sort().join("\n");
    if (cocok.length > 1 && cocok.some((x) => himpunan(x.rows) !== himpunan(cocok[0].rows))) {
      hasil.push({
        bpk_id: dok.bpk_id, status: "ambigu", sitasi: cocok.map((x) => labelUntuk(x.s)).join(" / "),
        alasan: "slug dan teks tautan menunjuk peraturan Lexa yang berbeda",
      });
      continue;
    }
    if (cocok.length === 1) {
      hasil.push(tautkan(cocok[0].rows, labelUntuk(cocok[0].s)));
      continue;
    }

    // Tidak ada di Lexa. Baris baru hanya dibuat bila sitasinya tak meragukan (satu kandidat).
    const s = dalam[0];
    if (!opsi.buat || dok.kandidat.length !== 1) {
      hasil.push({
        bpk_id: dok.bpk_id, status: "tidak_ada", sitasi: dalam.map(labelUntuk).join(" / "),
        ...(dok.kandidat.length > 1 ? { alasan: "sitasi meragukan; tidak dibuat" } : {}),
      });
      continue;
    }
    const nomor = nomorKanonik(s.jenis, s.nomor);
    const uri = frbrDari(s.jenis, nomor, s.tahun);
    if (dibuat.has(uri)) {
      hasil.push({ bpk_id: dok.bpk_id, status: "sudah", uri, uris: [uri], sitasi: labelUntuk(s) });
      continue;
    }
    dibuat.add(uri);
    kelompok.push({
      id: `${indeks}:${uri}`,
      pernyataan: [
        db
          .prepare(
            `INSERT INTO laws (frbr_uri, jenis, nomor, tahun, judul, status, bpk_id, sumber_url, jumlah_pasal, isi_status, isi_giliran, updated_at)
             VALUES (?,?,?,?,?,'berlaku',?,?,0,'menunggu',?, datetime('now'))`,
          )
          .bind(uri, s.jenis, nomor, s.tahun, judulSementara(s, masuk.teks), dok.bpk_id, alamat, hitungGiliran(s.jenis, s.tahun, null)),
      ],
    });
    hasil.push({ bpk_id: dok.bpk_id, status: "dibuat", uri, uris: [uri], sitasi: labelUntuk(s) });
  }

  // Tulis. Kelompok yang gagal mengubah status entrinya.
  const gagal = await batchBerkelompok(db, kelompok);
  for (const [id, alasan] of gagal) {
    const indeks = Number(id.slice(0, id.indexOf(":")));
    hasil[indeks] = { ...hasil[indeks], status: "gagal", alasan: `gagal disimpan: ${alasan}` };
  }

  const ringkas = Object.fromEntries(
    (["ditautkan", "sudah", "dibuat", "tidak_ada", "luar_cakupan", "tidak_dikenali", "ambigu", "bentrok", "gagal"] as const).map((s) => [s, 0]),
  ) as RingkasTautan;
  for (const h of hasil) ringkas[h.status]++;
  return { ringkas, hasil };
}

