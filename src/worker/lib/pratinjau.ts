/**
 * Pratinjau tautan halaman peraturan (`/peraturan?uri=…`).
 *
 * Antarmuka dirender di klien, sedangkan WhatsApp, Telegram, dan mesin pencari membaca <head> tanpa
 * menjalankan JavaScript: tautan ke UU 13/2003 hanya akan tampil sebagai "Lexa". Karena itu Worker
 * menyajikan cangkang SPA yang sama (public/index.html) dengan judul, deskripsi, dan gambar yang
 * disuntikkan dari data peraturannya. Judul dan deskripsinya dibuat oleh fungsi yang sama dengan yang
 * dipakai antarmuka (`pratinjauPeraturan` di public/js/format.js), jadi keduanya selalu sama.
 *
 * Hanya perayap dan aplikasi pesan (lihat `perayapPratinjau`) yang mendapat versi ini. Pembaca biasa
 * langsung menerima cangkang dari aset tanpa menyentuh D1: pencarian peraturan ke D1 (di Amerika Timur)
 * menambah ratusan milidetik pada pembukaan halaman, padahal browser menyetel judul dan deskripsi yang
 * sama lewat JavaScript. Isinya setara, jadi ini bukan cloaking.
 *
 * Aturan keselamatan: halaman ini hanya hiasan di atas cangkang. Apa pun yang gagal (parameter tak
 * sah, peraturan tak ada, D1 galat, cangkang berubah bentuk) menghasilkan cangkang apa adanya, tidak
 * pernah galat: pengguna tetap bisa membuka aplikasi.
 */

import { pratinjauPeraturan } from "../../../public/js/format.js";
import { aliasUri } from "./uri";

/** Gambar pratinjau (dibuat scripts/buat-og.mjs): kartu merek 1200x630. */
export const GAMBAR_PRATINJAU = "/og/lexa.png";
const LEBAR_GAMBAR = 1200;
const TINGGI_GAMBAR = 630;
const ALT_GAMBAR = "Lexa: cari dan baca peraturan perundang-undangan Indonesia";
const NAMA_SITUS = "Lexa";
/** FRBR URI yang sah di sini selalu diawali ini dan tidak panjang; selainnya tidak perlu menyentuh D1. */
const AWAL_URI = "/akn/id/act/";
const MAKS_URI = 200;

export interface BarisPratinjau {
  frbr_uri: string;
  jenis: string;
  nomor: string;
  tahun: number;
  judul: string;
  status: string | null;
  ringkasan: string | null;
}

export interface IsiPratinjau {
  /** Judul halaman (dan og:title), mis. "UU 13/2003 Ketenagakerjaan". */
  judul: string;
  deskripsi: string;
  /** Alamat halaman yang kanonik (mutlak). */
  url: string;
  /** Alamat gambar pratinjau (mutlak). */
  gambar: string;
}

const KARAKTER: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Aman untuk isi elemen maupun nilai atribut yang diapit tanda kutip. */
export function lolosHtml(teks: string): string {
  return teks.replace(/[&<>"']/g, (c) => KARAKTER[c]);
}

const POLA_JUDUL = /<title>[\s\S]*?<\/title>/;

function polaMeta(atribut: "name" | "property", nilai: string): RegExp {
  return new RegExp(`<meta ${atribut}="${nilai}" content="[^"]*">`);
}

/**
 * Sisipkan pratinjau ke cangkang. Mengembalikan null bila cangkang tidak berbentuk yang diharapkan
 * (salah satu tag yang harus diganti tidak ada), supaya pemanggil memakai cangkang apa adanya
 * daripada menyajikan halaman yang separuh benar.
 *
 * Penggantian memakai fungsi, bukan string pengganti: judul peraturan boleh memuat "$&" dan sejenisnya.
 */
export function suntikPratinjau(html: string, p: IsiPratinjau): string | null {
  const ganti: Array<[RegExp, string]> = [
    [POLA_JUDUL, `<title>${lolosHtml(`${p.judul} · ${NAMA_SITUS}`)}</title>`],
    [polaMeta("name", "description"), `<meta name="description" content="${lolosHtml(p.deskripsi)}">`],
    [polaMeta("property", "og:title"), `<meta property="og:title" content="${lolosHtml(p.judul)}">`],
    [polaMeta("property", "og:description"), `<meta property="og:description" content="${lolosHtml(p.deskripsi)}">`],
  ];
  let hasil = html;
  for (const [pola, baru] of ganti) {
    if (!pola.test(hasil)) return null;
    hasil = hasil.replace(pola, () => baru);
  }
  if (!hasil.includes("</head>")) return null;

  const tambahan = [
    `<link rel="canonical" href="${lolosHtml(p.url)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:locale" content="id_ID">`,
    `<meta property="og:url" content="${lolosHtml(p.url)}">`,
    `<meta property="og:image" content="${lolosHtml(p.gambar)}">`,
    `<meta property="og:image:type" content="image/png">`,
    `<meta property="og:image:width" content="${LEBAR_GAMBAR}">`,
    `<meta property="og:image:height" content="${TINGGI_GAMBAR}">`,
    `<meta property="og:image:alt" content="${lolosHtml(ALT_GAMBAR)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ]
    .map((t) => `  ${t}\n`)
    .join("");
  return hasil.replace("</head>", () => `${tambahan}</head>`);
}

/** Susun isi pratinjau dari baris peraturan. @param asal mis. "https://lexa.example" (tanpa garis miring akhir) */
export function susunPratinjau(baris: BarisPratinjau, asal: string): IsiPratinjau {
  const { judul, deskripsi } = pratinjauPeraturan(baris);
  return {
    judul,
    deskripsi,
    // Bentuk yang sama dengan sitemap.xml dan tautan di antarmuka.
    url: `${asal}/peraturan?uri=${encodeURIComponent(baris.frbr_uri)}`,
    gambar: `${asal}${GAMBAR_PRATINJAU}`,
  };
}

/** Baris peraturan untuk URI ini (atau ejaan lainnya, lihat lib/uri.ts), atau null bila tidak ada. */
export async function cariPeraturan(db: D1Database, uri: string): Promise<BarisPratinjau | null> {
  const ambil = (u: string) =>
    db
      .prepare(`SELECT frbr_uri, jenis, nomor, tahun, judul, status, ringkasan FROM laws WHERE frbr_uri = ?`)
      .bind(u)
      .first<BarisPratinjau>();
  const alias = aliasUri(uri);
  return (await ambil(uri)) ?? (alias ? await ambil(alias) : null);
}

/**
 * User-Agent pembaca tautan yang tidak menjalankan JavaScript: perayap mesin pencari, dan aplikasi pesan atau
 * media sosial yang membuat kartu pratinjau (WhatsApp, Telegram, iMessage dan Messenger memakai
 * "facebookexternalhit", Slack, Discord, LinkedIn, X, ...). Sengaja longgar: salah mengenali satu perayap
 * hanya berarti satu pencarian D1 tambahan, sedangkan melewatkannya berarti pratinjau umum.
 */
const POLA_PERAYAP = /bot|crawl|spider|slurp|facebookexternalhit|facebot|whatsapp|telegram|slack|discord|linkedin|twitter|skype|viber|signal|snapchat|pinterest|mastodon|embedly|iframely|unfurl|preview/i;

export function perayapPratinjau(userAgent: string | null): boolean {
  return userAgent !== null && POLA_PERAYAP.test(userAgent);
}

/**
 * Cangkang tanpa perubahan, dengan header yang bisa diubah (respons aset tidak bisa). Isi halaman ini bergantung
 * pada User-Agent, sehingga setiap jawaban memberi tahu perantara apa pun lewat `Vary`.
 */
function apaAdanya(cangkang: Response): Response {
  const salinan = new Response(cangkang.body, cangkang);
  salinan.headers.append("vary", "User-Agent");
  return salinan;
}

/**
 * Layani `GET /peraturan`: cangkang SPA, dengan pratinjau bila pembacanya perayap/aplikasi pesan dan `uri`
 * menunjuk peraturan yang ada. Tidak pernah melempar galat karena data atau D1; hanya bila cangkangnya sendiri
 * tak bisa diambil.
 */
export async function layaniPeraturan(req: Request, env: Env): Promise<Response> {
  const alamat = new URL(req.url);
  if (!perayapPratinjau(req.headers.get("user-agent"))) {
    // Pembaca biasa: cangkang apa adanya, lengkap dengan ETag dan jawaban 304 dari aset, tanpa menyentuh D1.
    return apaAdanya(await env.ASSETS.fetch(new Request(new URL("/", alamat).toString(), { method: req.method, headers: req.headers })));
  }
  const uri = alamat.searchParams.get("uri");
  const sah = uri !== null && uri.startsWith(AWAL_URI) && uri.length <= MAKS_URI;

  const ambilCangkang = () => env.ASSETS.fetch(new Request(new URL("/", alamat).toString()));
  // Cangkang diambil tanpa header bersyarat milik peramban (If-None-Match): isi yang kita kirim bukan
  // salinan aset aslinya. Pencarian peraturan tidak pernah menolak: galat D1 berarti "tanpa pratinjau".
  const [cangkang, baris] = await Promise.all([
    ambilCangkang(),
    sah
      ? cariPeraturan(env.DB, uri).catch((galat) => {
          console.error("pratinjau: gagal membaca peraturan", galat);
          return null;
        })
      : Promise.resolve(null),
  ]);

  const jenis = cangkang.headers.get("content-type") ?? "";
  if (!baris || !cangkang.ok || !jenis.includes("text/html")) return apaAdanya(cangkang);

  const html = suntikPratinjau(await cangkang.text(), susunPratinjau(baris, alamat.origin));
  if (html === null) {
    console.error("pratinjau: cangkang tidak berbentuk yang diharapkan; disajikan apa adanya");
    return apaAdanya(await ambilCangkang()); // badan yang tadi sudah terbaca
  }

  const header = new Headers(cangkang.headers);
  for (const nama of ["content-length", "content-encoding", "etag", "last-modified", "cf-cache-status"]) header.delete(nama);
  header.set("cache-control", "no-cache");
  header.append("vary", "User-Agent");
  return new Response(html, { status: cangkang.status, headers: header }); // HEAD: Hono membuang badannya
}
