/**
 * Pembersih artefak halaman PDF pada teks hasil konversi (Workers AI `toMarkdown`), dijalankan sebelum teks diurai
 * menjadi pasal (`uraikanPasal`) dan penjelasan (`uraikanPenjelasan`).
 *
 * Konversi menyisipkan penanda "### Page N" di tiap batas halaman dan membiarkan kepala serta kaki cetak ikut menjadi
 * teks. Di produksi (14 Okt 2026) 19.000 dari 90.317 baris pasal (1.666 peraturan) memuat penanda itu, dan 8.699 memuat
 * kepala "PRESIDEN REPUBLIK INDONESIA": artefak-artefak ini ikut masuk ke indeks pencarian, vektor, dan teks yang dibaca
 * pengguna. Bentuk yang ditemukan pada naskah nyata:
 *
 *   - penanda halaman:        "\n\n\n\n### Page 20\n"
 *   - kepala bernomor halaman: "PRESIDEN\nREPUBLIK INDONESIA- 20 -BAB V", "PRESIDENREPUBLIK INDONESIA-20-(3) Dalam",
 *                              "2021, No.15-79-wajib", dan salah baca OCR-nya ("PRES I DENREPUBLIK INDONESIA-9 -",
 *                              "PRESTOENR,EPUBLIK INDONESIA-3-")
 *   - kaki tetap:             "SK No 004269 A" (juga "SK No275468A", "SK No l893ll A"), "www.peraturan.go.id",
 *                              "www.djpp.depkumham.go.id"
 *   - catchword:              kata pertama halaman berikutnya di ujung halaman ini: "Pemantau . . .", "c. memiliki . . .",
 *                              "(3) Dalam...", dan yang titik-titiknya hilang dibaca OCR: "Huruf d", "II. PASAL"
 *   - kepala tanpa nomor:     halaman pertama Penjelasan tak bernomor, jadi kepalanya menempel pada judul:
 *                              "PRESIDEN\nREPUBLIK INDONESIAPENJELASAN" (701 peraturan di produksi menyimpan seluruh
 *                              Penjelasan di pasal terakhirnya karena judul ini tak dikenali)
 *   - sel tabel:              "| Pasal 1 |", "| Cukup jelas. |", "| - |": naskah sebagian dokumen berada di dalam tabel
 *   - baris berulang di tepi: "DISTRIBUSI II"
 *
 * Pembersih bekerja per halaman (pembatasnya penanda di atas) dan hanya menyentuh tepi halaman atau bentuk yang khas;
 * isi di tengah halaman tak pernah dihapus. Teks tanpa penanda hanya melewati penghapus kaki tetap. Idempoten:
 * membersihkan teks yang sudah bersih tidak mengubahnya.
 */

const RE_PENANDA = /^[ \t]*#{1,6}[ \t]*Page[ \t]+(\d+)[ \t]*$/gm;

/** Baris pemisah tabel markdown: "| - |", "|---|---|". */
const RE_PEMISAH_TABEL = /^[ \t]*\|[ \t|:-]*$/;

/**
 * Buang bingkai tabel markdown. Sel yang memuat naskah berbaris-baris ("| Huruf a Yang dimaksud ...⏎... |") membuat judul
 * dan butir tak terbaca sebagai awal baris, dan titik-titik catchword tak lagi di ujung baris. Pipa tepi dibuang dan baris
 * pemisah dihapus; pipa di dalam baris (tabel berkolom banyak) dibiarkan.
 */
function rapikanTabel(teks: string): string {
  if (!teks.includes("|")) return teks;
  return teks
    .split("\n")
    .map((baris) => (RE_PEMISAH_TABEL.test(baris) ? "" : baris.replace(/^[ \t]*\|[ \t]?/, "").replace(/[ \t]?\|[ \t]*$/, "")))
    .join("\n");
}

/**
 * Kepala "PRESIDEN REPUBLIK INDONESIA" di awal halaman yang menempel langsung pada huruf kapital sesudahnya, tanpa nomor
 * halaman ("... REPUBLIK INDONESIAPENJELASAN"). Tanpa spasi atau baris baru sesudahnya, ia pasti artefak.
 */
const RE_KEPALA_MENEMPEL = /^\s*(?:[PF]RESIDEN[ \t]*\n?[ \t]*)?REPUBLIK[ \t]+INDONESIA(?=[A-Z])/;

/**
 * "SK No 004269 A": kaki Lembaran Negara. Nomornya 5-8 karakter angka (OCR menukar angka dengan huruf, mis. "l893ll"), lalu
 * huruf A. Tanpa batas kata di kiri maupun kanan: kaki ini menempel pada kata terakhir halaman ("... berbunyi sebagaiSK No
 * 050842 APasal 28") dan kadang disusul kelanjutan kalimat ("... atauSK No275472 Akabupaten/kota").
 */
const RE_SK = /SK[ \t]*No\.?[ \t]*[0-9OoIl]{5,8}[ \t]?A/g;
/** Situs di kaki naskah dari peraturan.go.id dan DJPP; menempel pada kata terakhir halaman, jadi tanpa batas kata di kiri. */
const RE_SITUS = /www\.(?:peraturan\.go\.id|djpp\.[a-z]+(?:\.[a-z]+)*)/gi;

/** Nomor halaman cetak di dalam tanda hubung: "- 20 -", "-20-" (OCR kadang menulis garis bawah: "_ 15_"). */
const RE_JANGKAR = /[-–—_][ \t]*(\d{1,4})[ \t]*[-–—_]/;
/** Sejauh mana dari awal halaman jangkar nomor halaman dicari, dan panjang paling banyak kepala di depannya. */
const JARAK_JANGKAR = 120;
const MAKS_KEPALA = 100;
/** Bagian huruf kecil paling banyak pada kepala cetak (kepala hampir seluruhnya huruf kapital; "No." ikut). */
const MAKS_HURUF_KECIL = 0.25;

interface Halaman {
  /** Nomor pada penanda "### Page N"; null untuk bagian sebelum penanda pertama. */
  nomor: number | null;
  teks: string;
}

function pisahHalaman(naskah: string): Halaman[] {
  const hasil: Halaman[] = [];
  let awal = 0;
  let nomor: number | null = null;
  for (const m of naskah.matchAll(RE_PENANDA)) {
    hasil.push({ nomor, teks: naskah.slice(awal, m.index) });
    nomor = Number(m[1]);
    awal = (m.index ?? 0) + m[0].length;
  }
  hasil.push({ nomor, teks: naskah.slice(awal) });
  return hasil;
}

/** Bagian huruf kecil dari semua huruf pada `teks`. */
function bagianKecil(teks: string): number {
  const huruf = teks.match(/\p{L}/gu) ?? [];
  if (!huruf.length) return 0;
  return huruf.filter((h) => h !== h.toUpperCase()).length / huruf.length;
}

/** Kepala Lembaran Negara: "2021, No.15" (tahun, nomor LN). */
const RE_KEPALA_LN = /^\d{4},[ \t]*No\.?[ \t]*\d+$/;

/** Kepala yang tampak seperti kepala cetak: tak berhuruf kecil sama sekali, atau "2021, No.15". Kepala kosong bukan bukti. */
function tampakKepala(kepala: string): boolean {
  const k = kepala.trim();
  return k !== "" && (RE_KEPALA_LN.test(k) || /^[^\p{Ll}]+$/u.test(k));
}

interface CalonKepala {
  /** Panjang kepala termasuk jangkarnya, dari awal teks yang sudah dipangkas di depan. */
  akhir: number;
  /** Nomor yang tercetak dikurangi nomor penanda: tetap selama penomoran cetak tak berganti. */
  selisih: number;
  tampak: boolean;
}

function calonKepala(h: Halaman): CalonKepala | null {
  if (h.nomor === null) return null;
  const teks = h.teks.trimStart();
  const m = RE_JANGKAR.exec(teks.slice(0, JARAK_JANGKAR));
  if (!m) return null;
  const kepala = teks.slice(0, m.index);
  if (kepala.length > MAKS_KEPALA || kepala.split("\n").length > 3) return null;
  if (!RE_KEPALA_LN.test(kepala.trim()) && bagianKecil(kepala) > MAKS_HURUF_KECIL) return null;
  return { akhir: m.index + m[0].length, selisih: Number(m[1]) - h.nomor, tampak: tampakKepala(kepala) };
}

/**
 * Buang kepala halaman yang berakhir pada nomor halaman cetak ("... REPUBLIK INDONESIA- 20 -"). Sebuah calon dipercaya bila
 * penomoran cetaknya konsisten (selisih terhadap nomor penanda yang sama muncul sekurangnya dua kali; Penjelasan bernomor
 * ulang sehingga selisihnya berganti di sana), atau bila kepalanya sendiri jelas kepala cetak.
 */
function buangKepala(halaman: Halaman[]): void {
  const calon = halaman.map(calonKepala);
  const hitung = new Map<number, number>();
  for (const c of calon) if (c) hitung.set(c.selisih, (hitung.get(c.selisih) ?? 0) + 1);
  halaman.forEach((h, i) => {
    const c = calon[i];
    if (!c || ((hitung.get(c.selisih) ?? 0) < 2 && !c.tampak)) return;
    h.teks = h.teks.trimStart().slice(c.akhir);
  });
}

const POLA_STRUKTUR = /^(?:bab|bagian|paragraf|pasal|buku|penjelasan|umum|ayat|huruf|angka|butir|cukup\s+jelas)\b/i;
const POLA_BUTIR = /^(?:\(?\d{1,3}\)|\(?[a-z]{1,2}\)|\d{1,3}\.|[a-z]\.)\s/i;

/** Bentuk baku sebuah baris untuk membandingkan baris yang sama antarhalaman: angka disamarkan, selain huruf dibuang. */
function bentukBaku(baris: string): string {
  return baris.toLowerCase().replace(/\d+/gu, "#").replace(/[^\p{L}#\s]/gu, "").replace(/\s+/g, " ").trim();
}

/** Baris yang boleh dianggap kepala/kaki berulang: pendek, tanpa tanda penutup kalimat, bukan struktur naskah. */
function layakBerulang(baris: string): boolean {
  const b = baris.trim();
  if (b.length < 6 || b.length > 80) return false;
  if (/[.;:,]$/.test(b)) return false;
  if (POLA_STRUKTUR.test(b) || POLA_BUTIR.test(b)) return false;
  return (b.match(/\p{L}/gu) ?? []).length >= 5;
}

/** Jumlah baris tak kosong di tiap tepi halaman yang diperiksa. */
const TEPI = 3;

/**
 * Buang baris yang sama persis (angka disamarkan) di tepi sedikitnya 30% halaman (dan sedikitnya tiga): kepala dan kaki cetak
 * yang tak berbentuk jangkar nomor, mis. "DISTRIBUSI II". Hanya baris yang layak (lihat `layakBerulang`) dan hanya di tepi.
 */
function buangBarisBerulang(halaman: Halaman[]): void {
  const badan = halaman.filter((h) => h.nomor !== null).length;
  if (badan < 4) return;
  const tepi = halaman.map((h) => {
    const baris = h.teks.split("\n");
    const terisi = baris.map((teks, i) => ({ teks, i })).filter((x) => x.teks.trim());
    const indeks = new Set([...terisi.slice(0, TEPI), ...terisi.slice(-TEPI)].map((x) => x.i));
    return { baris, layak: [...indeks].filter((i) => layakBerulang(baris[i])) };
  });
  const hitung = new Map<string, number>();
  tepi.forEach((t, p) => {
    if (halaman[p].nomor === null) return;
    for (const k of new Set(t.layak.map((i) => bentukBaku(t.baris[i])))) hitung.set(k, (hitung.get(k) ?? 0) + 1);
  });
  const ambang = Math.max(3, Math.ceil(badan * 0.3));
  tepi.forEach((t, p) => {
    if (halaman[p].nomor === null) return;
    const buang = new Set(t.layak.filter((i) => (hitung.get(bentukBaku(t.baris[i])) ?? 0) >= ambang));
    if (buang.size) halaman[p].teks = t.baris.filter((_, i) => !buang.has(i)).join("\n");
  });
}

/** Titik-titik penutup catchword: ". . .", "...", "…". */
const RE_ELIPSIS = /[ \t]*(?:(?:\.[ \t]?){3,}|…)[ \t]*$/;
/** Penanda butir di awal baris: "(2)", "a.", "3.", "(b)". */
const RE_PENANDA_BUTIR = /^(?:\(\d{1,3}[a-z]?\)|\d{1,3}\.|[a-z]\.|\([a-z]{1,2}\))[ \t]*/i;
const MAKS_KATA_CATCHWORD = 6;
/** Seberapa jauh dari ujung baris terakhir halaman titik-titik catchword dicari (catchword paling banyak 80 karakter). */
const JANGKAU_UJUNG = 200;
/** Catchword yang lebih pendek dari ini tak dipercaya: terlalu mudah kebetulan. Penanda butir dihitung terpisah dari isinya. */
const MIN_HURUF_CATCHWORD = 3;

const rapat = (teks: string) => teks.toLowerCase().replace(/\s+/g, " ").trim();
const tanpaButir = (teks: string) => teks.replace(RE_PENANDA_BUTIR, "");
/** Tanpa spasi sama sekali: OCR menulis "Ayat(2)" di ujung halaman dan "Ayat (2)" di awal halaman berikutnya. */
const padat = (teks: string) => teks.toLowerCase().replace(/\s+/g, "");
/** `calon` adalah awal `awal` (keduanya sudah dirapatkan), tak peduli spasi, dan cukup panjang untuk bukan kebetulan. */
const awalDari = (calon: string, awal: string) => {
  const c = padat(calon);
  return c.length >= MIN_HURUF_CATCHWORD && padat(awal).startsWith(c);
};

/**
 * Catchword yang titik-titiknya hilang: baris terakhir halaman yang pendek dan berawal penanda struktur ("Huruf d", "Ayat (2)",
 * "II. PASAL", "Pasal 12", "b. Apabila"). Hanya bila halaman berikutnya diawali kata-kata yang sama persis, sehingga
 * judul yang kebetulan berada di dasar halaman tak tersentuh.
 */
const RE_CATCHWORD_STRUKTUR = /^(?:(?:Pasal|Ayat|Huruf|Angka|Butir|BAB|Bagian|Paragraf)\b|II?\.|[a-z]\.|\(\d{1,3}\)|\d{1,3}\.)/;
const MAKS_KATA_TANPA_TITIK = 4;

/**
 * Awal calon catchword di dalam `isi` (teks di depan titik-titik): awal tiap kata, dan posisi tepat sesudah tanda penutup
 * yang disusul huruf, angka, atau "(" ("... Presiden.(5) Tarif", "kota.Pasal22", "(6)a. memenuhi"), karena catchword menempel
 * pada kata terakhir halaman tanpa spasi. Dari yang paling panjang (paling kiri), paling banyak enam kata atau 80 karakter.
 */
function awalCalonCatchword(isi: string): number[] {
  const kata = [...isi.matchAll(/\S+/g)];
  const batas = Math.max(isi.length - 80, kata.length > MAKS_KATA_CATCHWORD ? (kata[kata.length - MAKS_KATA_CATCHWORD].index ?? 0) : 0);
  const awal = new Set<number>();
  for (const m of kata) if ((m.index ?? 0) >= batas) awal.add(m.index ?? 0);
  for (let i = Math.max(batas, 1); i < isi.length; i++) {
    if (/[.;:)]/.test(isi[i - 1]) && /[A-Za-z0-9(]/.test(isi[i])) awal.add(i);
  }
  return [...awal].sort((a, b) => a - b);
}

/**
 * Catchword: ujung halaman memuat kata-kata pertama halaman berikutnya diikuti titik-titik. Dibuang hanya bila halaman
 * berikutnya memang diawali kata-kata itu (penanda butir "(2)", "a." boleh berbeda), jadi kalimat yang kebetulan berakhir
 * titik-titik tak tersentuh. Yang dibuang adalah ujung terpanjang yang cocok.
 */
function buangCatchword(halaman: Halaman[]): void {
  for (let i = 0; i < halaman.length - 1; i++) {
    const awalBerikut = rapat(halaman[i + 1].teks.trimStart().slice(0, 200));
    if (!awalBerikut) continue;
    const baris = halaman[i].teks.trimEnd().split("\n");
    const terakhir = baris[baris.length - 1];
    // Hanya ujung baris yang diperiksa: ekspresi reguler tanpa jangkar di depan itu kuadrat pada deretan spasi yang panjang.
    const potong = Math.max(0, terakhir.length - JANGKAU_UJUNG);
    const elipsis = RE_ELIPSIS.exec(terakhir.slice(potong));
    if (!elipsis) {
      // Titik-titik hilang: seluruh baris terakhir adalah catchword bila ia pendek, berawal struktur, dan diulang apa adanya.
      const calon = terakhir.trim();
      if (
        calon.split(/\s+/).length <= MAKS_KATA_TANPA_TITIK && RE_CATCHWORD_STRUKTUR.test(calon) && !/[.;:,]$/.test(calon) &&
        awalDari(calon, awalBerikut)
      ) {
        baris.pop();
        halaman[i].teks = baris.join("\n");
      }
      continue;
    }
    const isi = terakhir.slice(0, potong + elipsis.index);
    for (const awal of awalCalonCatchword(isi)) {
      const calon = rapat(isi.slice(awal));
      if (!awalDari(calon, awalBerikut) && !awalDari(tanpaButir(calon), tanpaButir(awalBerikut))) continue;
      const sisa = isi.slice(0, awal).trimEnd();
      if (sisa) baris[baris.length - 1] = sisa;
      else baris.pop();
      halaman[i].teks = baris.join("\n");
      break;
    }
  }
}

/** Titik-titik di mana pun dalam teks (bukan hanya di ujung baris): ". . .", "...", "…". */
const RE_ELIPSIS_TENGAH = /(?:\.[ \t]?){3,}|…/g;
/** Pemeriksaan murah: teks tanpa titik-titik tidak diproses sama sekali. */
const ADA_ELIPSIS = /…|\.[ \t]?\.[ \t]?\./;
/** Seberapa jauh ke kiri catchword dicari (`awalCalonCatchword` hanya memakai 80 karakter terakhir) dan ke kanan pengulangannya. */
const JANGKAU_KIRI = 100;
const JANGKAU_KANAN = 300;
const RE_HURUF_ANGKA = /[\p{L}\p{N}]/u;

/**
 * Bila `teks` diawali `calon` (spasi dan baris baru tak diperhatikan, huruf besar-kecil disamakan), kembalikan indeks tepat
 * sesudah pengulangan itu di `teks`, selain itu -1. Calon yang berakhir huruf atau angka harus berhenti di sana ("Pasal 1"
 * bukan awal "Pasal 12", "Ketentuan" bukan awal "Ketentuanlain"); calon yang berakhir tanda baca ("Pejabat-", "Ayat (2)")
 * boleh disusul apa saja, termasuk teks yang menempel ("Ayat (2)Cukup jelas").
 */
function akhirPengulangan(calon: string, teks: string): number {
  const c = padat(calon);
  if (c.length < MIN_HURUF_CATCHWORD) return -1;
  let j = 0;
  for (let k = 0; k < c.length; k++) {
    while (j < teks.length && /\s/.test(teks[j])) j++;
    if (j >= teks.length || teks[j].toLowerCase() !== c[k]) return -1;
    j++;
  }
  return RE_HURUF_ANGKA.test(c[c.length - 1]) && RE_HURUF_ANGKA.test(teks.charAt(j)) ? -1 : j;
}

/**
 * Awal catchword di dalam `isi` (teks di depan titik-titik) yang diulang tepat di awal `sesudah`, atau -1. Yang terpanjang
 * didahulukan, dan kecocokan apa adanya didahulukan atas kecocokan tanpa penanda butir ("Jangka …⏎(2) Jangka waktu").
 */
function awalCatchwordDiulang(isi: string, sesudah: string): number {
  const calon = awalCalonCatchword(isi);
  for (const awal of calon) if (akhirPengulangan(isi.slice(awal), sesudah) >= 0) return awal;
  const tanpa = tanpaButir(sesudah);
  for (const awal of calon) if (akhirPengulangan(tanpaButir(isi.slice(awal)), tanpa) >= 0) return awal;
  return -1;
}

/**
 * Catchword yang tak terpisah penanda halaman: titik-titik yang langsung disusul (hanya spasi atau baris baru di antaranya)
 * kata-kata yang baru saja mendahuluinya, mis. "... 1 Januari 1996.Agar…Agar setiap orang mengetahuinya" atau
 * "Ayat (4)…⏎Ayat (4)⏎Cukup jelas". Konversi tidak selalu menaruh penanda halaman di batas yang benar (di produksi, 827 baris
 * pasal pada 184 peraturan), jadi pencocokan per halaman di atas tak menjangkaunya. Catchword dibuang bersama titik-titiknya
 * dan pengulangannya tinggal. Pembandingnya sama dengan `buangCatchword`, dengan tambahan batas kata. "dan seterusnya…" yang
 * disusul kata lain, "Rp . . . juta", dan "Pasal 1…⏎Pasal 12" tak tersentuh.
 */
function buangCatchwordLangsung(teks: string): string {
  if (!ADA_ELIPSIS.test(teks)) return teks;
  let hasil = "";
  let salin = 0; // awal bagian `teks` yang belum disalin ke `hasil`
  for (const m of teks.matchAll(RE_ELIPSIS_TENGAH)) {
    const mulai = m.index ?? 0;
    const akhir = mulai + m[0].length;
    // Hanya JANGKAU_KIRI karakter di kiri titik-titik yang diperiksa: satu baris hasil konversi bisa sepanjang jutaan karakter.
    const batas = Math.max(salin, mulai - JANGKAU_KIRI);
    const barisBaru = teks.slice(batas, mulai).lastIndexOf("\n");
    const awalBaris = batas + barisBaru + 1;
    const isi = teks.slice(awalBaris, mulai).trimEnd();
    const berikut = teks.slice(akhir, akhir + JANGKAU_KANAN);
    const sesudah = berikut.trimStart();
    const awal = awalCatchwordDiulang(isi, sesudah);
    if (awal < 0) continue;
    const awalMutlak = awalBaris + awal;
    // Catchword yang memenuhi seluruh baris dibuang bersama barisnya; yang di tengah baris hanya dirinya sendiri. Awal baris
    // yang sebenarnya hanya diketahui bila ada baris baru dalam jangkauan atau jangkauan sudah mencapai bagian yang belum disalin.
    const awalBarisPasti = barisBaru >= 0 || batas === salin;
    const seluruhBaris = awalBarisPasti && teks.slice(awalBaris, awalMutlak).trim() === "";
    const akhirHapus = akhir + (seluruhBaris ? berikut.length - sesudah.length : /^[ \t]*/.exec(berikut)![0].length);
    let kiri = teks.slice(salin, seluruhBaris ? awalBaris : awalMutlak);
    if (!seluruhBaris && (teks[akhirHapus] === "\n" || teks[akhirHapus] === "\r")) kiri = kiri.trimEnd();
    hasil += kiri;
    salin = akhirHapus;
  }
  return hasil + teks.slice(salin);
}

/** Kaki tetap yang khas, di mana pun ia ada. "SK No ..." menandai batas halaman, jadi diganti baris baru; situs menempel pada kata terakhir. */
function bersihkanKaki(teks: string): string {
  return teks.replace(RE_SK, "\n").replace(RE_SITUS, "");
}

/** Bersihkan artefak halaman dari naskah hasil konversi. */
export function bersihkanHalaman(naskah: string): string {
  const halaman = pisahHalaman(rapikanTabel(naskah));
  for (const h of halaman) h.teks = bersihkanKaki(h.teks).replace(RE_KEPALA_MENEMPEL, "");
  if (halaman.length > 1) {
    buangKepala(halaman);
    buangBarisBerulang(halaman);
    buangCatchword(halaman);
  }
  return buangCatchwordLangsung(
    halaman
      .map((h) => h.teks.replace(/^\s*\n/, "").trimEnd())
      .filter((teks) => teks.trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n"),
  );
}
