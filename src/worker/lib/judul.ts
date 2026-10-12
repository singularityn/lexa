/**
 * Tingkat judul pada pencarian: peraturan yang NAMANYA memuat kata yang dicari tampil di atas hasil lainnya.
 *
 * Latar belakang (keluhan pengguna, Oktober 2026): mencari "kelautan" menampilkan pasal-pasal yang menyebut kata itu,
 * sedangkan UU 32/2014 tentang Kelautan tenggelam. Dua sebabnya.
 *  1. Fusi RRF (search.ts) menyejajarkan peraturan dan pasal sebagai kandidat. Sebuah pasal bisa menerima sumbangan
 *     dari FTS dan vektor sekaligus; sebuah peraturan hanya dari FTS. Peraturan pun kalah.
 *  2. BM25 pada indeks peraturan tidak membedakan "judulnya Kelautan" dari "judulnya panjang dan kebetulan menyebut
 *     Kelautan". Di produksi, dari delapan judul yang memuat kata itu, UU 32/2014 berada di urutan KEDELAPAN, di
 *     bawah tujuh PP tarif PNBP "... yang berlaku pada Departemen Kelautan dan Perikanan".
 *
 * Maka judul dinilai sendiri di sini, tidak lewat BM25: seberapa besar bagian judul yang dibicarakan kata itu.
 * Peraturan yang lolos (lihat `nilaiJudul`) dikelompokkan di atas hasil lain oleh `cari`.
 *
 * Yang dinilai adalah POKOK judul, bukan judul penuh. Judul resmi berbentuk "Undang-Undang Nomor 32 Tahun 2014
 * tentang Kelautan"; bagian depannya sama untuk ribuan peraturan dan tidak memberi tahu apa isinya.
 *
 * Modul ini murni (tanpa D1): kandidatnya datang dari `cariJudul` di search.ts, yang mengambil sampai seratus
 * judul teratas menurut BM25 sebagai bahan, lalu urutan akhirnya ditentukan di sini.
 */

import type { StatusPeraturan } from "../../shared/types";
import { STOPWORDS, type KataKueri } from "./query";

/** Pecah teks menjadi kata seperti tokenizer indeks: huruf dan angka, dengan tanda hubung di dalam kata. */
export function pecahKata(teks: string): string[] {
  return teks
    .toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .map((k) => k.replace(/^-+|-+$/g, ""))
    .filter(Boolean);
}

/** Bagian depan judul resmi yang berbentuk rujukan: dibuka nama jenis, lalu memuat nomor atau tahun. */
const POLA_RUJUKAN = /^(?:undang[\s-]*undang|peraturan|ketetapan|keputusan|tap|uu|pp|perppu|perpu)\b.*(?:\b(?:nomor|no\.?|tahun)\b|\d)/is;
/** Judul yang hanya rujukan ("Undang-Undang Nomor 7 Tahun 1981"): pokoknya tidak diketahui. */
const POLA_HANYA_RUJUKAN = /^[\p{L}\s.()-]*?\bnomor\b\s+[\p{L}\p{N}./-]+\s+tahun\s+\d{4}\s*$/iu;
const MAKS_PANJANG_RUJUKAN = 160;

/**
 * Pokok judul: bagian sesudah "tentang" pada judul resmi ("Undang-Undang Nomor 32 Tahun 2014 tentang Kelautan"
 * menjadi "Kelautan"). Judul tanpa pola itu ("Cipta Kerja", "Undang-Undang Dasar Negara Republik Indonesia Tahun
 * 1945") dipakai utuh.
 *
 * Hanya "tentang" PERTAMA yang memisahkan, dan hanya bila yang di depannya berbentuk rujukan (dibuka nama jenis,
 * memuat nomor atau tahun) dan tidak terlalu panjang: "Undang-Undang Nomor 6 Tahun 2023 tentang Penetapan Perppu
 * Nomor 2 Tahun 2022 tentang Cipta Kerja menjadi Undang-Undang" dipisah di "tentang" yang pertama. Judul yang tidak
 * dibuka nama jenis ("Perubahan atas Undang-Undang Nomor 1 Tahun 1974 tentang Perkawinan", bentuk ringkas tanpa
 * rujukan di depannya) dipakai utuh, sebab "Perubahan atas ..." justru bagian dari pokoknya: perubahan itu bukan
 * undang-undang tentang Perkawinan itu sendiri. Kata "tentang" di tengah kalimat biasa juga tidak memotong.
 *
 * Judul yang hanya rujukan ("Undang-Undang Nomor 7 Tahun 1981"; 73 dari 7.177 peraturan di produksi pada Oktober
 * 2026, sumber katalognya tak memberi pokok) tidak punya pokok sama sekali: hasilnya string kosong, bukan seluruh judul,
 * agar kata seperti "tahun" atau "nomor" tidak dianggap pokok bahasannya.
 */
export function pokokJudul(judul: string): string {
  if (POLA_HANYA_RUJUKAN.test(judul)) return "";
  const m = /\s+tentang\s+/i.exec(judul);
  if (!m) return judul;
  const depan = judul.slice(0, m.index);
  if (depan.length > MAKS_PANJANG_RUJUKAN || !POLA_RUJUKAN.test(depan)) return judul;
  return judul.slice(m.index + m[0].length).trim() || judul;
}

interface Bentuk {
  kata: string[];
  /** Kata tunggal yang diketik boleh berupa awalan kata judul ("kerja" -> "kerjasama"), seperti `"kerja"*` di FTS. */
  awalan: boolean;
}

interface Padanan {
  /** 2 = kata persis, 1 = hanya awalan. */
  mutu: 1 | 2;
  mulai: number;
  /** Kata judul yang tercakup, tanpa kata henti. */
  tercakup: number;
}

/** Bentuk yang dianggap sama dengan satu kata kueri: kata itu sendiri, lalu ejaan atau singkatan lainnya. */
function bentukDari(kata: KataKueri, boleAwalan: boolean): Bentuk[] {
  return [
    { kata: pecahKata(kata.token), awalan: boleAwalan && kata.token.length >= 4 },
    ...kata.sama.map((s) => ({ kata: pecahKata(s), awalan: false })),
  ].filter((b) => b.kata.length > 0);
}

/** Padanan terbaik (mutu tertinggi, lalu terdepan) dari salah satu bentuk di dalam daftar kata judul. */
function cariPadanan(judul: readonly string[], bentuk: readonly Bentuk[]): Padanan | null {
  let terbaik: Padanan | null = null;
  for (const b of bentuk) {
    for (let i = 0; i + b.kata.length <= judul.length; i++) {
      let mutu: 1 | 2 = 2;
      let cocok = true;
      for (let j = 0; j < b.kata.length && cocok; j++) {
        const w = judul[i + j];
        const t = b.kata[j];
        if (w === t) continue;
        if (b.awalan && w.startsWith(t)) mutu = 1;
        else cocok = false;
      }
      if (!cocok) continue;
      const tercakup = judul.slice(i, i + b.kata.length).filter((w) => !STOPWORDS.has(w)).length;
      if (!terbaik || mutu > terbaik.mutu || (mutu === terbaik.mutu && i < terbaik.mulai)) terbaik = { mutu, mulai: i, tercakup };
    }
  }
  return terbaik;
}

export interface NilaiJudul {
  /** Makin besar makin cocok; hanya bermakna dibandingkan dengan nilai peraturan lain untuk kueri yang sama. */
  skor: number;
  /** Seluruh pokok judul adalah kata yang dicari ("Kelautan" untuk kueri "kelautan"). */
  persis: boolean;
}

/** Tambahan nilai, dari yang paling berat. Lihat `nilaiJudul`. */
const NILAI_PERSIS = 2;
const NILAI_DI_AWAL = 0.25;
const NILAI_BERLAKU = 0.1;
const POTONGAN_HANYA_AWALAN = 0.3;

/**
 * Nilai satu judul terhadap kata kueri, atau null bila judul itu bukan hasil tingkat judul.
 *
 * Lolos bila SEMUA kata yang diketik ada di judul (persis, atau sebagai awalan kata judul, atau sebagai ejaan lain
 * dari kata yang sama) dan setidaknya satu di antaranya ada di POKOK judul. Syarat kedua mencegah "peraturan
 * pemerintah" meloloskan ribuan PP hanya karena kata itu ada di bagian depan setiap judul PP.
 *
 * Nilainya, dari yang paling berat:
 *  - kepadatan (0..1): bagian pokok judul yang dibicarakan kata itu. "Kelautan" 1/1; "Penyelenggaraan Bidang Kelautan
 *    dan Perikanan" 1/4; PP tarif PNBP "... Departemen Kelautan dan Perikanan" 1/10. Inilah yang menaikkan peraturan
 *    yang memang tentang kata itu di atas yang sekadar menyebutnya;
 *  - persis (+2): seluruh pokok judul adalah kata yang dicari;
 *  - kata terdepan (+0,25): pokok judul dibuka oleh kata itu;
 *  - hanya awalan (-0,3): yang cocok awalan kata judul saja, bukan katanya;
 *  - belum dicabut (+0,1): pada kepadatan yang nyaris sama, yang masih berlaku didahulukan.
 */
export function nilaiJudul(
  judul: string,
  kueri: { kata: readonly KataKueri[]; frasa: readonly string[] },
  status: StatusPeraturan,
): NilaiJudul | null {
  const penuh = pecahKata(judul);
  const pokok = pecahKata(pokokJudul(judul));
  const grup: Bentuk[][] = [
    ...kueri.frasa.map((f) => bentukDari({ token: f, sama: [] }, false)),
    ...kueri.kata.map((k) => bentukDari(k, true)),
  ];
  if (!grup.length) return null;

  let tercakup = 0;
  let awal = Infinity;
  let semuaPersis = true;
  let adaDiPokok = false;
  for (const bentuk of grup) {
    const diPokok = cariPadanan(pokok, bentuk);
    if (diPokok) {
      adaDiPokok = true;
      tercakup += diPokok.tercakup;
      awal = Math.min(awal, diPokok.mulai);
      if (diPokok.mutu < 2) semuaPersis = false;
      continue;
    }
    // Kata yang hanya ada di bagian depan ("peraturan", "pemerintah", "2003") tidak menambah nilai, tetapi juga
    // tidak menggugurkan; yang tidak ada di judul sama sekali menggugurkan.
    if (!cariPadanan(penuh, bentuk)) return null;
  }
  if (!adaDiPokok) return null;

  const bermakna = pokok.filter((w) => !STOPWORDS.has(w)).length;
  const kepadatan = bermakna ? Math.min(1, tercakup / bermakna) : 0;
  const persis = semuaPersis && bermakna > 0 && tercakup >= bermakna;
  const skor =
    kepadatan +
    (persis ? NILAI_PERSIS : 0) +
    (awal === 0 ? NILAI_DI_AWAL : 0) -
    (semuaPersis ? 0 : POTONGAN_HANYA_AWALAN) +
    (status === "dicabut" ? 0 : NILAI_BERLAKU);
  return { skor, persis };
}

/** Urutan hierarki peraturan; yang lebih tinggi didahulukan pada nilai yang sama. */
const URUTAN_JENIS = ["UUD", "TAP_MPR", "UU", "PERPPU", "PP"];

export interface BarisJudul {
  frbr_uri: string;
  jenis: string;
  tahun: number;
  nilai: NilaiJudul;
}

/**
 * Urutan dua peraturan yang sama-sama lolos: nilai judul, lalu hierarki jenis (UUD, Tap MPR, UU, Perppu, PP), lalu
 * yang lebih baru, lalu URI agar urutannya selalu sama untuk masukan yang sama.
 */
export function bandingkanJudul(a: BarisJudul, b: BarisJudul): number {
  const selisih = b.nilai.skor - a.nilai.skor;
  if (Math.abs(selisih) > 1e-9) return selisih;
  const rank = (jenis: string) => {
    const i = URUTAN_JENIS.indexOf(jenis);
    return i === -1 ? URUTAN_JENIS.length : i;
  };
  return rank(a.jenis) - rank(b.jenis) || b.tahun - a.tahun || a.frbr_uri.localeCompare(b.frbr_uri);
}

export interface BarisBerjudul {
  frbr_uri: string;
  jenis: string;
  tahun: number;
  judul: string;
  status: StatusPeraturan;
}

/**
 * Pisahkan baris peraturan menjadi yang judulnya cocok dengan kueri (terurut: paling dibicarakan kata itu lebih dulu)
 * dan sisanya (urutan masuk dipertahankan). Dipakai pencarian (tingkat judul) dan saran ketik, supaya keduanya
 * sepakat tentang peraturan mana yang "berjudul" kata yang diketik.
 */
export function pilahBerjudul<T extends BarisBerjudul>(
  baris: readonly T[],
  kueri: { kata: readonly KataKueri[]; frasa: readonly string[] },
): { cocok: Array<T & { nilai: NilaiJudul }>; lain: T[] } {
  const cocok: Array<T & { nilai: NilaiJudul }> = [];
  const lain: T[] = [];
  for (const b of baris) {
    const nilai = nilaiJudul(b.judul, kueri, b.status);
    if (nilai) cocok.push({ ...b, nilai });
    else lain.push(b);
  }
  cocok.sort(bandingkanJudul);
  return { cocok, lain };
}
