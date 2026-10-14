/**
 * Pengurai bagian Penjelasan: "Penjelasan Umum" dan penjelasan tiap pasal ("Pasal demi pasal").
 *
 * Naskah peraturan Indonesia menutup batang tubuhnya dengan penjelasan:
 *
 *     PENJELASAN / ATAS / UNDANG-UNDANG REPUBLIK INDONESIA / NOMOR 13 TAHUN 2003 / TENTANG / KETENAGAKERJAAN
 *     I. UMUM            uraian umum
 *     II. PASAL DEMI PASAL
 *     Pasal 1            Cukup jelas.
 *     Pasal 3            Ayat (1) Cukup jelas.   Ayat (2) Yang dimaksud dengan ...
 *     Pasal 4 sampai dengan Pasal 6   Cukup jelas.
 *
 * `uraikanPasal` berhenti di judul PENJELASAN (penomoran pasal diulang di sana), sehingga penjelasan tadinya terbuang.
 * Modul ini mengurainya dengan batas yang sama persis, supaya penjelasan bisa disimpan sendiri (tabel `penjelasan`) dan
 * ditampilkan tepat di bawah pasal yang dijelaskannya. Penjelasan tidak masuk indeks pencarian maupun hitungan pasal.
 *
 * Konversi PDF sering menyambung bagian-bagian ini tanpa pemisah ("Pasal 3Cukup jelasPasal 4Ayat (1)Pada masa ...",
 * "Interes.II. PASAL DEMI PASALPasal 1Cukup jelas.", "KEPABEANANUMUM"), terutama pada pindaian. Bentuk-bentuk itu dipisah
 * lebih dulu (`pisahMenempel`); keputusan apakah sebuah baris "Pasal N" judul atau rujukan silang yang terpotong diambil dari
 * urutan nomornya (`judulSah`), karena salah mengira rujukan sebagai judul memindahkan teks ke pasal yang keliru.
 */

import { rapikanNomorPasal } from "../../shared/label";
import { bersihkanBaris, nilaiNomorPasal, pisahkanJudulMenempel, RE_BAB, RE_PASAL_DEMI_PASAL, RE_PENJELASAN } from "./bpk";
import { bersihkanHalaman } from "./halaman";

export interface PenjelasanPasal {
  /** Nomor pasal yang dijelaskan, ditulis seperti `articles.nomor_pasal` ("5", "12A", "II"). */
  nomor_pasal: string;
  isi: string;
  /** Urutan kemunculan di antara penjelasan pasal (mulai 0); rentang "Pasal 4 sampai dengan Pasal 6" menjadi tiga entri. */
  urutan: number;
}

export interface PenjelasanTerurai {
  /** Penjelasan Umum ("I. UMUM"), atau null bila naskah tak memuatnya. */
  umum: string | null;
  pasal: PenjelasanPasal[];
}

/** Baris tabel `penjelasan` (sesudah diratakan): Penjelasan Umum memakai nomor ini dan urutan 0. */
export const NOMOR_UMUM = "Umum";

/** Batas keamanan: satu butir penjelasan tak masuk akal bila lebih panjang dari ini (artefak konversi, bukan naskah). */
const MAKS_KARAKTER = 200_000;
/** Rentang "Pasal 1 sampai dengan Pasal N" yang lebih lebar dari ini dianggap salah baca dan tidak diperluas. */
const MAKS_RENTANG = 400;
/** Judul "I. UMUM" yang menempel pada judul peraturan dicari hanya di awal Penjelasan. */
const JARAK_JUDUL_UMUM = 1500;

const NOMOR = String.raw`(\d+(?:[A-Z](?![a-z]))?|[IVXLC]+(?![a-z]))`;
/** Awal judul penjelasan pasal: "Pasal 5", "PASAL 5". Sisanya (penghubung, nomor lanjutan, isi) dibaca `bacaJudul`. */
const RE_JUDUL_AWAL = new RegExp(String.raw`^#{0,6}\s*\**\s*(?:Pasal|PASAL)\s+${NOMOR}`);
/** Nomor lanjutan pada judul: "sampai dengan Pasal 6", "dan Pasal 6", ", 7", "s.d. Pasal 9", "- 8". */
const RE_NOMOR_LANJUT = new RegExp(String.raw`^(sampai\s+dengan|s\.?\s?d\.?|hingga|[-–—]|,\s*dan|dan|,)\s*(?:Pasal\s+|PASAL\s+)?${NOMOR}`);
const RE_PENGHUBUNG_RENTANG = /^(?:sampai|s\.?\s?d|hingga|[-–—])/i;

/** Judul "II. PASAL DEMI PASAL" (boleh tanpa "II." dan boleh disusul isi pada baris yang sama). */
const RE_PASAL_DEMI_PASAL_BERNOMOR = /^[ \t#*\-–]*(?:II\.|2\.)[ \t]*PASAL[ \t]+DEMI[ \t]+PASAL\b[ \t.:*]*/i;
const RE_PASAL_DEMI_PASAL_POLOS = /^[ \t#*]*PASAL[ \t]+DEMI[ \t]+PASAL[ \t.:*]*$/i;
/** Judul "I. UMUM" atau "UMUM". */
const RE_UMUM = /^[ \t#*\-–]*(?:I\.[ \t]*)?UMUM[ \t.:*]*$/i;
/** "Bagian Kesatu", "Bagian Kedua", "Bagian I": judul bagian. "Bagian ini mengatur ..." di dalam uraian bukan judul. */
const RE_BAGIAN_URUT = /^#{0,6}\s*\**\s*Bagian\s+(?:Ke[a-z]+|Pertama|[IVXLC]+|\d+)\b/i;
/** Kaki "TAMBAHAN LEMBARAN NEGARA REPUBLIK INDONESIA NOMOR 3789" (huruf kapital semua; sebutan dalam kalimat memakai huruf biasa). */
const RE_TAMBAHAN_LN = /[ \t]*TAMBAHAN[ \t]+LEMBARAN[ \t]+NEGARA(?:[ \t]+REPUBLIK[ \t]+INDONESIA)?(?:[ \t]+(?:TAHUN|NOMOR)[ \t]+\d+)*/g;
/** Awal uraian pasal yang lazim; dasar untuk menerima judul yang nomornya melompat. */
const RE_PEMBUKA = /^(?:cukup\s+jelas|ayat\b|huruf\b|angka\b|butir\b|yang\s+dimaksud\b|ketentuan\b)/i;

interface Urut {
  nilai: number;
  akhiran: string;
}

function urut(nomor: string): Urut | null {
  const nilai = nilaiNomorPasal(nomor);
  if (nilai === null) return null;
  return { nilai, akhiran: /^\d+([A-Z])$/.exec(nomor)?.[1] ?? "" };
}

const lebihBesar = (a: Urut, b: Urut | null) => b === null || a.nilai > b.nilai || (a.nilai === b.nilai && a.akhiran > b.akhiran);
const berurutan = (a: Urut, b: Urut | null) => b === null || (a.nilai === b.nilai + 1 && a.akhiran === "") || (a.nilai === b.nilai && a.akhiran > b.akhiran);

/** Nomor pasal sebagai kunci seragam dengan `articles.nomor_pasal`. */
const kunciNomor = (mentah: string) => rapikanNomorPasal(mentah.toUpperCase());

interface Judul {
  /** Nomor yang dicakup judul ini; rentang numerik sudah diperluas. */
  nomor: string[];
  /** Sisa baris sesudah judul: awal uraian, atau kosong. */
  sisa: string;
}

/** Perluas "4" .. "6" menjadi ["4", "5", "6"] bila keduanya angka polos dan rentangnya wajar; selain itu hanya `akhir`. */
function perluas(awal: string, akhir: string, rentang: boolean): string[] {
  const a = /^\d+$/.test(awal) ? Number(awal) : null;
  const b = /^\d+$/.test(akhir) ? Number(akhir) : null;
  if (rentang && a !== null && b !== null && b > a && b - a <= MAKS_RENTANG) {
    return Array.from({ length: b - a }, (_, i) => String(a + i + 1));
  }
  return [akhir];
}

/** Baca "Pasal 5", "Pasal 5Cukup jelas.", "Pasal 4 sampai dengan Pasal 6 ...", "Pasal 4, Pasal 5, dan Pasal 6 ...". */
function bacaJudul(baris: string): Judul | null {
  const awal = RE_JUDUL_AWAL.exec(baris);
  if (!awal) return null;
  const nomor = [kunciNomor(awal[1])];
  let sisa = baris.slice(awal[0].length);
  for (;;) {
    const lanjut = RE_NOMOR_LANJUT.exec(sisa.replace(/^\s+/, ""));
    if (!lanjut) break;
    sisa = sisa.replace(/^\s+/, "").slice(lanjut[0].length);
    nomor.push(...perluas(nomor[nomor.length - 1], kunciNomor(lanjut[2]), RE_PENGHUBUNG_RENTANG.test(lanjut[1])));
  }
  return { nomor, sisa: sisa.replace(/^\s*\**\s*:?\s*/, "").trim() };
}

/**
 * Apakah baris ini judul penjelasan pasal, bukan rujukan silang yang terpotong di awal baris ("... sebagaimana dimaksud
 * dalam / Pasal 14 ayat (1) huruf a" atau kalimat uraian yang dibuka "Pasal 28 Undang-Undang Dasar ...")? Nomornya harus naik
 * dari judul sebelumnya, dan:
 *  - nomor yang tepat berurutan dipercaya, kecuali sisa barisnya prosa huruf kecil (butuh kalimat sebelumnya yang sudah selesai);
 *  - nomor yang melompat (penjelasan tak memuat semua pasal) dipercaya hanya bila baris itu berdiri sendiri atau dibuka
 *    awal uraian yang lazim ("Cukup jelas", "Ayat (1)", "Huruf a", "Yang dimaksud ..."), dan kalimat sebelumnya sudah selesai.
 */
function judulSah(sisa: string, nomor: Urut, terakhir: Urut | null, barisSebelumnya: string): boolean {
  if (!lebihBesar(nomor, terakhir)) return false;
  const kalimatSelesai = barisSebelumnya === "" || /[.;:!?)”"]\s*$/.test(barisSebelumnya);
  const urutan = berurutan(nomor, terakhir);
  if (sisa === "") return urutan || kalimatSelesai;
  if (/^\p{Ll}/u.test(sisa)) return urutan && kalimatSelesai;
  return urutan || (kalimatSelesai && RE_PEMBUKA.test(sisa));
}

/**
 * Pisahkan bagian yang menempel akibat konversi: judul "II. PASAL DEMI PASAL" pada kalimat sebelumnya dan pada judul pasal
 * pertama, judul "Pasal N" pada ujung kata sebelumnya ("jelasPasal 4"), dan "I. UMUM" pada judul peraturan ("PASAR MODALUMUM").
 * Hanya bentuk yang tanpa spasi sama sekali yang disentuh, karena prosa selalu memakai spasi di tempat itu.
 */
function pisahMenempel(teks: string): string {
  const kepala = teks.slice(0, JARAK_JUDUL_UMUM).replace(/([A-Z)])(?:[ \t]*I\.[ \t]*)?UMUM(?=[A-Z][a-z]|[ \t]*(?:\r?\n|$))/, "$1\nUMUM\n");
  return (kepala + teks.slice(JARAK_JUDUL_UMUM))
    .replace(/(?<=\S)((?:II\.[ \t]*)?PASAL[ \t]+DEMI[ \t]+PASAL)/g, "\n$1")
    .replace(/(PASAL[ \t]+DEMI[ \t]+PASAL)(?=[A-Za-z])/g, "$1\n")
    .replace(/(?<=[a-z0-9.;:)”"])(?=Pasal[ \t]+(?:\d|[IVXLC]+(?![a-z])))/g, "\n");
}

const LABEL = String.raw`(?:Ayat\s*\(\d{1,3}[a-z]?\)|Huruf\s+[a-z]{1,2}|Angka\s+\d{1,3}|Butir\s+\d{1,3})`;
/** Label di awal baris yang disusul uraian pada baris yang sama: dipisah agar label berdiri sendiri seperti pada naskah bersih. */
const RE_LABEL_DISUSUL = new RegExp(String.raw`^(${LABEL})[ \t]*(?=[A-Z0-9“"(])`, "gm");
/** Label yang menempel pada ujung kata atau kalimat sebelumnya ("... jelasAyat (3)Cukup jelas"). */
const RE_LABEL_MENEMPEL = new RegExp(String.raw`(?<=[a-z0-9.;:)”"])(?=${LABEL}(?:[A-Z0-9“"(]|[ \t]*(?:\r?\n|$)))`, "g");
/** Label yang sudah berdiri sendiri pada barisnya, hanya ejaannya yang dibakukan ("Ayat(2)" menjadi "Ayat (2)"). */
const RE_LABEL_SENDIRI = new RegExp(String.raw`^(${LABEL})[ \t]*$`, "gm");
const kanonik = (label: string) => label.replace(/^Ayat\s*/, "Ayat ").replace(/^(Huruf|Angka|Butir)\s+/, "$1 ");

/**
 * Penunjuk bagian ("Ayat (2)", "Huruf b", "Angka 3") menjadi baris sendiri: "Ayat (1)Huruf aYang dimaksud" menjadi
 * "Ayat (1)⏎Huruf a⏎Yang dimaksud". Antarmuka menampilkannya sebagai label, uraiannya di bawahnya.
 */
function rapikanLabel(isi: string): string {
  let hasil = isi.replace(RE_LABEL_MENEMPEL, "\n").replace(RE_LABEL_SENDIRI, (_, label: string) => kanonik(label));
  for (let i = 0; i < 4; i++) {
    const berikut = hasil.replace(RE_LABEL_DISUSUL, (_, label: string) => `${kanonik(label)}\n`);
    if (berikut === hasil) break;
    hasil = berikut;
  }
  return hasil;
}

function rapikanIsi(baris: string[]): string {
  return baris.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAKS_KARAKTER);
}

/** Urai bagian Penjelasan dari naskah hasil konversi (markdown atau teks polos). Kosong bila naskah tak memuatnya. */
export function uraikanPenjelasan(naskah: string): PenjelasanTerurai {
  const semua = pisahkanJudulMenempel(bersihkanHalaman(naskah)).split("\n").map(bersihkanBaris);
  // Batas yang sama dengan uraikanPasal: baris pertama yang menjadi judul PENJELASAN atau PASAL DEMI PASAL.
  const mulai = semua.findIndex((b) => RE_PENJELASAN.test(b) || RE_PASAL_DEMI_PASAL.test(b));
  if (mulai < 0) return { umum: null, pasal: [] };
  const blok = pisahMenempel(semua.slice(mulai).join("\n").replace(RE_TAMBAHAN_LN, ""))
    .split("\n")
    .map(bersihkanBaris);

  // "II. PASAL DEMI PASAL": pemisah Umum dan penjelasan pasal. Sisa baris sesudah judulnya menjadi baris pertama bagian pasal.
  let batas = -1;
  let sisaJudul = "";
  for (let i = 0; i < blok.length; i++) {
    const m = RE_PASAL_DEMI_PASAL_BERNOMOR.exec(blok[i]) ?? (RE_PASAL_DEMI_PASAL_POLOS.test(blok[i]) ? [blok[i]] : null);
    if (m) {
      batas = i;
      sisaJudul = blok[i].slice(m[0].length).trim();
      break;
    }
  }

  // Penjelasan Umum: dari sesudah judul "I. UMUM" sampai pemisah. Tanpa pemisah, sampai penjelasan "Pasal 1" (atau "Pasal I"):
  // nomor lain tak dipercaya di sini karena uraian umum sering memulai kalimat dengan "Pasal 33 Undang-Undang Dasar ...".
  const iUmum = blok.findIndex((b) => RE_UMUM.test(b.trim()));
  let akhirUmum = batas >= 0 ? batas : blok.length;
  if (batas < 0) {
    const pertama = blok.findIndex((b, i) => {
      if (i <= Math.max(iUmum, 0)) return false;
      const j = bacaJudul(b);
      return j !== null && (j.nomor[0] === "1" || j.nomor[0] === "I");
    });
    if (pertama >= 0) akhirUmum = pertama;
  }
  const umum = iUmum >= 0 && iUmum < akhirUmum ? rapikanIsi(blok.slice(iUmum + 1, akhirUmum)) : "";

  const bagianPasal = batas >= 0 ? [sisaJudul, ...blok.slice(batas + 1)] : blok.slice(Math.max(akhirUmum, 0));
  const pasal: PenjelasanPasal[] = [];
  const indeks = new Map<string, number>();

  let nomorSaatIni: string[] = [];
  let isiSaatIni: string[] = [];
  let terakhir: Urut | null = null;
  let barisSebelumnya = "";

  const tutup = () => {
    const isi = rapikanLabel(rapikanIsi(isiSaatIni));
    if (isi) {
      for (const nomor of nomorSaatIni) {
        const ada = indeks.get(nomor);
        if (ada !== undefined) pasal[ada].isi = rapikanIsi([pasal[ada].isi, isi]);
        else {
          indeks.set(nomor, pasal.length);
          pasal.push({ nomor_pasal: nomor, isi, urutan: pasal.length });
        }
      }
    }
    nomorSaatIni = [];
    isiSaatIni = [];
  };

  for (const baris of bagianPasal) {
    const b = baris.trim();
    if (RE_BAB.test(b) || RE_BAGIAN_URUT.test(b)) {
      tutup();
      continue;
    }
    const judul = bacaJudul(b);
    const nilai = judul ? urut(judul.nomor[0]) : null;
    if (judul && nilai && judulSah(judul.sisa, nilai, terakhir, barisSebelumnya)) {
      tutup();
      nomorSaatIni = judul.nomor;
      terakhir = urut(judul.nomor[judul.nomor.length - 1]) ?? nilai;
      if (judul.sisa) isiSaatIni.push(judul.sisa);
      barisSebelumnya = judul.sisa || b;
      continue;
    }
    if (nomorSaatIni.length) isiSaatIni.push(baris);
    if (b) barisSebelumnya = b;
  }
  tutup();

  // "II. PASAL DEMI PASAL" yang hanya berbunyi "Cukup jelas." untuk seluruh peraturan (UU 9/1998): tak ada judul pasal yang
  // bisa dipasangkan, jadi kalimat itu dilekatkan pada Penjelasan Umum supaya tidak hilang.
  let teksUmum = umum;
  if (!pasal.length && batas >= 0 && hanyaCukupJelas(rapikanIsi(bagianPasal))) {
    teksUmum = rapikanIsi([umum, "", "Penjelasan pasal demi pasal: Cukup jelas."]);
  }

  return { umum: teksUmum || null, pasal };
}

/** Penjelasan sebagai baris tabel `penjelasan`: Penjelasan Umum urutan 0, lalu penjelasan pasal menurut kemunculannya. */
export function barisPenjelasan(p: PenjelasanTerurai): Array<{ nomor_pasal: string; isi: string; urutan: number }> {
  return [
    ...(p.umum ? [{ nomor_pasal: NOMOR_UMUM, isi: p.umum, urutan: 0 }] : []),
    ...p.pasal.map((x) => ({ nomor_pasal: x.nomor_pasal, isi: x.isi, urutan: x.urutan + 1 })),
  ];
}

/** "Cukup jelas" saja (boleh per ayat/huruf): tak ada yang perlu dibaca selain itu. Dipakai tes dan sebagai rujukan antarmuka. */
export function hanyaCukupJelas(isi: string): boolean {
  const sisa = isi
    .replace(/\bAyat\s*\(\d+[a-z]?\)|\b(?:Huruf\s+[a-z]{1,2}|Angka\s+\d+|Butir\s+\d+)\b/gi, " ")
    .replace(/cukup\s+jelas/gi, " ")
    .replace(/[\s.,;:]+/g, "");
  return sisa === "" && /cukup\s+jelas/i.test(isi);
}
