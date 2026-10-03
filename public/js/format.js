// @ts-check
/**
 * Fungsi murni untuk antarmuka: pelabelan, URL, pengelompokan pasal, tata letak
 * graf, dan penguraian teks jawaban. Tidak menyentuh DOM sehingga bisa diuji
 * langsung di Node (lihat test/web.test.ts).
 */

/** @typedef {import("../../src/shared/types").Law} Law */
/** @typedef {import("../../src/shared/types").Article} Article */
/** @typedef {import("../../src/shared/types").StatusPeraturan} StatusPeraturan */
/** @typedef {import("../../src/shared/types").JenisRelasi} JenisRelasi */
/** @typedef {{ teks: string, tebal: boolean }} Sebaris */
/** @typedef {{ tipe: "p", isi: Sebaris[] } | { tipe: "ul" | "ol", butir: Sebaris[][] }} BlokTeks */

/** Nama lengkap jenis peraturan menurut kode internal. */
export const LABEL_JENIS = /** @type {Record<string, string>} */ ({
  UUD: "Undang-Undang Dasar",
  TAP_MPR: "Ketetapan MPR",
  UU: "Undang-Undang",
  PERPPU: "Perppu",
  PP: "Peraturan Pemerintah",
  PERPRES: "Peraturan Presiden",
  KEPPRES: "Keputusan Presiden",
  INPRES: "Instruksi Presiden",
  PERMEN: "Peraturan Menteri",
  KEPMEN: "Keputusan Menteri",
  POJK: "Peraturan OJK",
  PBI: "Peraturan Bank Indonesia",
  PERDA_PROV: "Perda Provinsi",
  PERDA_KAB: "Perda Kabupaten/Kota",
  PERGUB: "Peraturan Gubernur",
  PERBUP: "Peraturan Bupati",
  PERWALI: "Peraturan Wali Kota",
});

/** @param {string} kode */
export function labelJenis(kode) {
  return LABEL_JENIS[kode] ?? kode.replace(/_/g, " ");
}

/** Kode singkat untuk tampilan, mis. `PERDA_PROV` menjadi `PERDA`. @param {string} kode */
export function kodeJenis(kode) {
  return kode.replace(/_(PROV|KAB)$/, "").replace(/_/g, " ");
}

/**
 * "UU 13/2003"
 * @param {{ jenis: string, nomor: string, tahun: number }} l
 */
export function sitasi(l) {
  return `${kodeJenis(l.jenis)} ${nomorTahun(l.jenis, l.nomor, l.tahun)}`;
}

const POLA_SLUG_POJK = /^(\d+)-pojk-(\d{2})-(\d{4})$/i;

/**
 * "13/2003"; untuk POJK bernomor slug ("48-pojk-04-2016") penulisan resminya "48/POJK.04/2016".
 * Salinan dari src/shared/label.ts (dijaga sama oleh test/web.test.ts).
 * @param {string} jenis
 * @param {string} nomor
 * @param {number} tahun
 */
export function nomorTahun(jenis, nomor, tahun) {
  const m = jenis === "POJK" ? POLA_SLUG_POJK.exec(nomor) : null;
  return m ? `${m[1]}/POJK.${m[2]}/${m[3]}` : `${nomor}/${tahun}`;
}

/**
 * "UU 13/2003 Pasal 82 ayat (1)"
 * @param {{ jenis: string, nomor: string, tahun: number }} l
 * @param {string | null | undefined} pasal
 * @param {string | null | undefined} [ayat]
 */
export function sitasiPasal(l, pasal, ayat) {
  if (!pasal) return sitasi(l);
  return `${sitasi(l)} Pasal ${pasal}${ayat ? ` ayat (${ayat})` : ""}`;
}

/** "Undang-Undang Nomor 13 Tahun 2003" @param {{ jenis: string, nomor: string, tahun: number }} l */
export function namaLengkap(l) {
  const resmi = l.jenis === "POJK" && POLA_SLUG_POJK.test(l.nomor);
  return `${labelJenis(l.jenis)} Nomor ${resmi ? nomorTahun(l.jenis, l.nomor, l.tahun) : `${l.nomor} Tahun ${l.tahun}`}`;
}

export const LABEL_STATUS = /** @type {Record<string, string>} */ ({
  berlaku: "Berlaku",
  dicabut: "Dicabut",
  diubah: "Diubah",
});

/** @param {string | null | undefined} status */
export function labelStatus(status) {
  return status ? (LABEL_STATUS[status] ?? status) : "Status tidak diketahui";
}

export const LABEL_RELASI = /** @type {Record<string, string>} */ ({
  mengubah: "Mengubah",
  diubah_oleh: "Diubah oleh",
  mencabut: "Mencabut",
  dicabut_oleh: "Dicabut oleh",
  dasar_hukum: "Dasar hukum",
  menjadi_dasar_hukum: "Menjadi dasar hukum bagi",
  melaksanakan: "Melaksanakan",
  dilaksanakan_oleh: "Dilaksanakan oleh",
  terkait: "Terkait",
});

/** Urutan tampil kelompok relasi: yang paling memengaruhi keberlakuan lebih dulu. */
export const URUTAN_RELASI = [
  "dicabut_oleh", "diubah_oleh", "mencabut", "mengubah", "dasar_hukum",
  "melaksanakan", "dilaksanakan_oleh", "menjadi_dasar_hukum", "terkait",
];

/** @param {string} jenis */
export function labelRelasi(jenis) {
  return LABEL_RELASI[jenis] ?? jenis.replace(/_/g, " ");
}

const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/**
 * "2003-03-25" menjadi "25 Maret 2003"; nilai yang tidak dikenali dikembalikan apa adanya.
 * @param {string | null | undefined} iso
 */
export function tanggalIndonesia(iso) {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const bulan = BULAN[Number(m[2]) - 1];
  return bulan ? `${Number(m[3])} ${bulan} ${m[1]}` : iso;
}

/** @param {number | null | undefined} n */
export function angka(n) {
  return new Intl.NumberFormat("id-ID").format(n ?? 0);
}

// --- Judul dan nama bidang -----------------------------------------------------

/** Kata sambung yang ditulis huruf kecil di tengah judul. */
const KATA_KECIL = new Set([
  "dan", "atau", "di", "ke", "dari", "untuk", "yang", "serta", "bagi", "pada", "dengan", "dalam", "oleh",
  "atas", "terhadap", "sebagai", "tentang", "antara", "kepada", "sampai", "hingga", "menjadi", "adalah", "itu", "ini",
]);

/**
 * Singkatan yang memuat huruf hidup (yang tanpa huruf hidup, mis. BPK, DPR, KPK, PT, dikenali otomatis).
 * Hanya dipakai saat teks sumber seluruhnya huruf besar, karena BPK menulis banyak judul dan nama bidang begitu.
 */
const SINGKATAN = new Set([
  "APBN", "APBD", "BUMN", "BUMD", "BLU", "BPJS", "OJK", "TNI", "POLRI", "RI", "NKRI", "HAM", "ITE", "UMKM", "PNS", "ASN",
  "KUHP", "KUHAP", "NPWP", "PPN", "PPH", "PBB", "BPHTB", "IPTEK", "ASEAN", "UU", "PP", "POJK", "PERPPU", "PERPRES", "PERMEN",
  "KPU", "BAWASLU", "BNPB", "BNN", "BPOM", "BRIN", "IUP", "ZEE", "UNESCO", "ILO", "WHO", "COVID", "AI",
]);

const ANGKA_ROMAWI = /^(?=[IVXLCDM])M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/;

/**
 * Rapikan huruf besar/kecil sebuah judul atau topik.
 *
 * - Seluruhnya huruf besar (BPK menulis sekitar seperempat judul dan hampir semua nama bidang begitu):
 *   menjadi huruf judul ("Tata Cara Hubungan Antar Lembaga"), dengan singkatan dan angka Romawi dipertahankan.
 * - Campuran: hanya kata sambung berkapital di tengah ("Bagi", "Dan", "Atas") yang diturunkan, supaya
 *   "Pemberian Uang Kompensasi/penghargaan Bagi Ketua dan Anggota" tidak terbaca setengah-setengah.
 *
 * Tidak mengubah isi data; hanya tampilan.
 * @param {string | null | undefined} teks
 */
export function rapikanHuruf(teks) {
  if (!teks) return "";
  const t = teks.trim().replace(/\s+/g, " ");
  const semuaBesar = !/\p{Ll}/u.test(t) && /\p{Lu}/u.test(t);
  let pertama = true;
  return t.replace(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu, (kata) => {
    const awal = pertama;
    pertama = false;
    const kecil = kata.toLowerCase();
    if (KATA_KECIL.has(kecil)) return awal ? kecil[0].toUpperCase() + kecil.slice(1) : kecil;
    if (!semuaBesar) return kata;
    const besar = kata.toUpperCase();
    if (SINGKATAN.has(besar) || ANGKA_ROMAWI.test(besar) || /\d/.test(kata)) return besar;
    // Singkatan tanpa huruf hidup: BPK, DPR, MPR, KPK, PT, MK.
    if (kata.length <= 5 && !/[AIUEO]/.test(besar)) return besar;
    return kata[0].toUpperCase() + kata.slice(1).toLowerCase();
  });
}

/**
 * Pisahkan judul resmi ("Peraturan Pemerintah Nomor 85 Tahun 2013 tentang Tata Cara …") menjadi
 * kepala dan topik. Sitasi ("PP 85/2013") sudah mengenali peraturannya, jadi daftar cukup menampilkan topik.
 * Judul yang tidak berbentuk begitu (mis. "Penetapan Peraturan Pemerintah Pengganti …") dibiarkan utuh.
 * @param {string | null | undefined} judul
 * @returns {{ kepala: string | null, topik: string }}
 */
export function pisahJudul(judul) {
  const t = (judul ?? "").trim();
  const m = /^((?:Undang-?\s?undang|Peraturan|Keputusan|Instruksi|Ketetapan|Perpu|Perppu)\b.*?\b(?:nomor|no\.?)\s+\S+(?:\s+tahun\s+\d{4})?)\s+tentang\s+(.+)$/is.exec(t);
  return m ? { kepala: m[1].trim(), topik: m[2].trim() } : { kepala: null, topik: t };
}

/**
 * Judul untuk kartu dan daftar: topiknya saja, dengan huruf yang dirapikan.
 * @param {string | null | undefined} judul
 */
export function judulRingkas(judul) {
  return rapikanHuruf(pisahJudul(judul).topik);
}

/** Daftar bidang dari nilai kolom `bidang` ("APBN - BUMN"), dirapikan hurufnya. @param {string | null | undefined} bidang */
export function daftarBidang(bidang) {
  if (!bidang) return [];
  return [...new Set(bidang.split(/\s+-\s+/).map((b) => rapikanHuruf(b)).filter(Boolean))];
}

/**
 * Bagian setelah `#` pada id pasal. Akhiran `~n` TIDAK dibuang: id kembar hasil
 * penyaringan ingest (`...-ayat-2~2`) adalah id pasal yang sah.
 * @param {string | null | undefined} idPasal
 */
export function jangkarDariId(idPasal) {
  if (!idPasal) return "";
  const i = idPasal.indexOf("#");
  return i >= 0 ? idPasal.slice(i + 1) : idPasal;
}

/**
 * Susun query string dari objek; nilai kosong dibuang, larik digabung dengan koma.
 * @param {Record<string, string | number | boolean | Array<string | number> | null | undefined>} params
 */
export function queryString(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "" || v === false) continue;
    if (Array.isArray(v)) {
      if (v.length) q.set(k, v.join(","));
    } else {
      q.set(k, String(v));
    }
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * Tautan ke halaman peraturan (sama dengan URL pada sitemap).
 * @param {string} uri
 * @param {{ q?: string | null, jangkar?: string | null }} [opsi]
 */
export function urlPeraturan(uri, opsi = {}) {
  const jangkar = opsi.jangkar ? `#${opsi.jangkar}` : "";
  return `/peraturan${queryString({ uri, q: opsi.q })}${jangkar}`;
}

/**
 * Baca filter pencarian dari query string.
 * @param {URLSearchParams} p
 */
export function bacaFilter(p) {
  /** @param {string} nama */
  const daftar = (nama) =>
    p.getAll(nama).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
  /** @param {string} nama */
  const bilangan = (nama) => {
    const n = Number(p.get(nama));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const mode = p.get("mode");
  return {
    q: (p.get("q") ?? "").trim(),
    mode: mode === "keyword" || mode === "semantic" ? mode : "hybrid",
    jenis: daftar("jenis"),
    status: daftar("status"),
    tahun_min: bilangan("tahun_min"),
    tahun_max: bilangan("tahun_max"),
    bidang: p.get("bidang") || undefined,
  };
}

/**
 * Penanda halaman hasil konversi PDF yang terselip di tengah teks pasal, mis.
 * "Cukup jelas    ### Page 97 PRESIDEN REPUBLIK INDONESIA- 18 -" atau
 * "### Page 98 PRESIDEN REPUBLIK INDONESIA- 19 -Ayat (1) Cukup jelas". Itu kepala halaman, bukan
 * bunyi peraturan. Hanya tampilan yang dirapikan; data di database tidak diubah.
 */
const RE_PENANDA_HALAMAN = /\s*#{1,6}\s*Page\s+\d+(?:\s+[A-Z][A-Z .,/&()-]*?\s*-\s*\d+\s*-)?\s*/g;

/** @param {string | null | undefined} teks */
export function bersihkanArtefak(teks) {
  if (!teks) return "";
  return teks.replace(RE_PENANDA_HALAMAN, " ").replace(/[ \t]+\n/g, "\n").trim();
}

const KATA_HENTI = new Set([
  "yang", "dan", "atau", "di", "ke", "dari", "untuk", "pada", "dengan", "dalam", "adalah", "ini", "itu",
  "oleh", "tentang", "akan", "telah", "dapat", "tidak", "juga", "serta", "bagi", "atas", "para", "agar",
]);

/**
 * Istilah dari kueri yang layak ditandai di teks peraturan.
 * @param {string | null | undefined} q
 */
export function istilahDariKueri(q) {
  if (!q) return [];
  const unik = new Set(
    q.toLowerCase().split(/[^\p{L}\p{N}-]+/u).map((t) => t.replace(/^-+|-+$/g, "")).filter((t) => t.length >= 3 && !KATA_HENTI.has(t)),
  );
  return [...unik].slice(0, 8);
}

/**
 * Kelompok pasal untuk ditampilkan: baris berurutan dengan nomor pasal sama
 * (satu per ayat) digabung, dan bab/bagian dibawa agar judulnya bisa dimunculkan.
 * @param {Article[]} artikel
 * @returns {Array<{ jangkar: string, nomor: string, judul: string | null, bab: string | null, bagian: string | null, babBaru: boolean, bagianBaru: boolean, butir: Article[] }>}
 */
export function kelompokkanPasal(artikel) {
  /** @type {ReturnType<typeof kelompokkanPasal>} */
  const hasil = [];
  let babSebelumnya = /** @type {string | null} */ (null);
  let bagianSebelumnya = /** @type {string | null} */ (null);
  for (const a of artikel) {
    const terakhir = hasil.at(-1);
    if (terakhir && terakhir.nomor === a.nomor_pasal) {
      terakhir.butir.push(a);
      continue;
    }
    const babBaru = a.bab !== babSebelumnya && a.bab !== null;
    const bagianBaru = a.bagian !== bagianSebelumnya && a.bagian !== null;
    babSebelumnya = a.bab ?? babSebelumnya;
    bagianSebelumnya = a.bagian ?? bagianSebelumnya;
    hasil.push({
      jangkar: jangkarDariId(a.id).replace(/-ayat-.*$/, "") || `pasal-${a.nomor_pasal}`,
      nomor: a.nomor_pasal,
      judul: a.judul,
      bab: a.bab,
      bagian: a.bagian,
      babBaru,
      bagianBaru,
      butir: [a],
    });
  }
  return hasil;
}

// --- Graf relasi --------------------------------------------------------------

/** Prioritas jenis relasi saat dua peraturan punya lebih dari satu sisi (mis. pasangan invers). */
const PRIORITAS_SISI = ["mencabut", "dicabut_oleh", "mengubah", "diubah_oleh", "melaksanakan", "dilaksanakan_oleh", "dasar_hukum", "menjadi_dasar_hukum", "terkait"];

/**
 * Satu sisi per pasangan peraturan: relasi invers (A mencabut B, B dicabut oleh A)
 * digambar sebagai satu garis.
 * @param {Array<{ dari: string, ke: string, jenis: string }>} sisi
 */
export function sisiUnik(sisi) {
  /** @type {Map<string, { dari: string, ke: string, jenis: string }>} */
  const peta = new Map();
  for (const s of sisi) {
    const kunci = [s.dari, s.ke].sort().join("\u0000");
    const ada = peta.get(kunci);
    if (!ada || PRIORITAS_SISI.indexOf(s.jenis) < PRIORITAS_SISI.indexOf(ada.jenis)) peta.set(kunci, s);
  }
  return [...peta.values()];
}

/**
 * Tata letak melingkar: pusat di tengah, tetangga langsung pada cincin pertama,
 * tetangga dari tetangga pada cincin kedua (searah induknya).
 * @param {Array<{ uri: string, jarak: number }>} simpul
 * @param {Array<{ dari: string, ke: string }>} sisi
 * @param {string} pusat
 * @param {{ lebarSimpul?: number, tinggiSimpul?: number }} [opsi]
 */
export function tataLetakGraf(simpul, sisi, pusat, opsi = {}) {
  const lebarSimpul = opsi.lebarSimpul ?? 116;
  const tinggiSimpul = opsi.tinggiSimpul ?? 36;
  const cincin1 = simpul.filter((n) => n.jarak === 1);
  const cincin2 = simpul.filter((n) => n.jarak >= 2);

  /** @param {number} n @param {number} dasar */
  const radius = (n, dasar) => Math.max(dasar, (n * (lebarSimpul + 18)) / (2 * Math.PI));
  const r1 = cincin1.length ? radius(cincin1.length, 150) : 0;
  const r2 = cincin2.length ? Math.max(r1 + 120, radius(cincin2.length, r1 + 120)) : 0;
  const rMaks = r2 || r1;
  const lebar = Math.max(560, 2 * (rMaks + lebarSimpul / 2 + 24));
  const tinggi = Math.max(320, 2 * (rMaks + tinggiSimpul / 2 + 24));
  const cx = lebar / 2;
  const cy = tinggi / 2;

  /** @type {Map<string, { x: number, y: number, sudut: number }>} */
  const posisi = new Map([[pusat, { x: cx, y: cy, sudut: 0 }]]);

  cincin1.forEach((n, i) => {
    const sudut = -Math.PI / 2 + (2 * Math.PI * i) / cincin1.length;
    posisi.set(n.uri, { x: cx + r1 * Math.cos(sudut), y: cy + r1 * Math.sin(sudut), sudut });
  });

  // Cincin kedua mengikuti sudut induknya agar garis tidak saling silang berlebihan.
  /** @param {string} uri */
  const sudutInduk = (uri) => {
    const sudut = sisi
      .flatMap((s) => (s.dari === uri ? [s.ke] : s.ke === uri ? [s.dari] : []))
      .map((u) => posisi.get(u))
      .filter((p) => p !== undefined && p.sudut !== undefined && cincin1.some((c) => posisi.get(c.uri) === p))
      .map((p) => /** @type {{ sudut: number }} */ (p).sudut);
    return sudut.length ? sudut.reduce((a, b) => a + b, 0) / sudut.length : 0;
  };
  const urut2 = [...cincin2].sort((a, b) => sudutInduk(a.uri) - sudutInduk(b.uri));
  urut2.forEach((n, i) => {
    const sudut = -Math.PI / 2 + (2 * Math.PI * (i + 0.5)) / urut2.length;
    posisi.set(n.uri, { x: cx + r2 * Math.cos(sudut), y: cy + r2 * Math.sin(sudut), sudut });
  });

  return { lebar, tinggi, posisi, lebarSimpul, tinggiSimpul };
}

// --- Teks jawaban model -------------------------------------------------------

/** @param {string} baris @returns {Sebaris[]} */
function sebaris(baris) {
  /** @type {Sebaris[]} */
  const hasil = [];
  let tebal = false;
  for (const bagian of baris.split(/(\*\*|__)/)) {
    if (bagian === "**" || bagian === "__") tebal = !tebal;
    else if (bagian) hasil.push({ teks: bagian, tebal });
  }
  return hasil;
}

/**
 * Uraikan jawaban model (Markdown ringan) menjadi blok yang aman dirender:
 * paragraf, daftar bernomor/bebas, dan teks **tebal**. Selebihnya dianggap teks biasa.
 * @param {string} teks
 * @returns {BlokTeks[]}
 */
export function bacaTeksModel(teks) {
  /** @type {BlokTeks[]} */
  const blok = [];
  /** @type {string[]} */
  let paragraf = [];
  /** @type {{ tipe: "ul" | "ol", butir: Sebaris[][] } | null} */
  let daftar = null;

  const tutupParagraf = () => {
    if (paragraf.length) blok.push({ tipe: "p", isi: sebaris(paragraf.join(" ")) });
    paragraf = [];
  };
  const tutupDaftar = () => {
    if (daftar) blok.push(daftar);
    daftar = null;
  };

  for (const mentah of teks.replace(/\r\n?/g, "\n").split("\n")) {
    const baris = mentah.trim();
    if (!baris) {
      tutupParagraf();
      tutupDaftar();
      continue;
    }
    const judul = /^#{1,6}\s+(.*)$/.exec(baris);
    const bebas = /^[-*•]\s+(.*)$/.exec(baris);
    const bernomor = /^\d+[.)]\s+(.*)$/.exec(baris);
    if (judul) {
      tutupParagraf();
      tutupDaftar();
      blok.push({ tipe: "p", isi: [{ teks: judul[1].replace(/\*\*|__/g, ""), tebal: true }] });
    } else if (bebas || bernomor) {
      tutupParagraf();
      const tipe = bebas ? "ul" : "ol";
      if (daftar && daftar.tipe !== tipe) tutupDaftar();
      daftar ??= { tipe, butir: [] };
      daftar.butir.push(sebaris((bebas ?? bernomor)?.[1] ?? ""));
    } else {
      tutupDaftar();
      paragraf.push(baris);
    }
  }
  tutupParagraf();
  tutupDaftar();
  return blok;
}

/** Teks polos dari blok, untuk disalin. @param {BlokTeks[]} blok */
export function blokKeTeks(blok) {
  return blok
    .map((b) =>
      b.tipe === "p"
        ? b.isi.map((x) => x.teks).join("")
        : b.butir.map((it, i) => `${b.tipe === "ol" ? `${i + 1}.` : "-"} ${it.map((x) => x.teks).join("")}`).join("\n"),
    )
    .join("\n\n");
}
