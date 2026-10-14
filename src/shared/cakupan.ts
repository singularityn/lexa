/**
 * Cakupan peraturan Lexa.
 *
 * Untuk saat ini Lexa hanya memuat UUD (dan yang setara: Ketetapan MPR), undang-undang termasuk Perppu,
 * dan peraturan pemerintah. Peraturan di bawah PP (Perpres, peraturan menteri, POJK, Perda, dan seterusnya)
 * tidak disinkronkan, diimpor, dicari, maupun ditampilkan, supaya beban aplikasi tetap ringan: ukuran D1 dan
 * indeks FTS, jumlah vektor di Vectorize, dan pemanggilan Workers AI (konversi PDF, embedding, ringkasan).
 * Panen BPK pun hanya menjangkau jenis-jenis ini.
 *
 * Daftar jenisnya ada pada variabel `CAKUPAN_JENIS` di wrangler.jsonc (kode jenis seperti kolom `laws.jenis`,
 * dipisah koma). `CAKUPAN_BAWAAN` di bawah dipakai bila variabelnya tak ada atau tak sah, dan dijaga sama dengan
 * wrangler.jsonc oleh test/cakupan.test.ts. Melebarkan cakupan nanti cukup mengubah variabel itu dan menyebar
 * ulang; baris peraturan yang sudah tersimpan tetapi di luar cakupan hanya disembunyikan, tidak dihapus.
 */

/** Daftar kode jenis (seperti `laws.jenis`): huruf besar dan garis bawah. */
export type Cakupan = readonly string[];

export const CAKUPAN_BAWAAN: Cakupan = ["UUD", "TAP_MPR", "UU", "PERPPU", "PP"];

const POLA_KODE = /^[A-Z][A-Z_]*$/;

/**
 * Cakupan dari nilai variabel `CAKUPAN_JENIS` ("UU, pp ,PERPRES"). Bentuk apa pun yang meragukan (kosong,
 * ada butir yang bukan kode jenis) jatuh ke `CAKUPAN_BAWAAN`: cakupan yang salah ketik tidak boleh membuat
 * seluruh peraturan tersembunyi, apalagi menyelipkan sesuatu ke klausa SQL (lihat `klausaCakupan`).
 */
export function bacaCakupan(nilai: string | null | undefined): Cakupan {
  if (typeof nilai !== "string") return CAKUPAN_BAWAAN;
  const butir = nilai.split(",").map((b) => b.trim().toUpperCase().replace(/[\s-]+/g, "_")).filter(Boolean);
  if (!butir.length || !butir.every((b) => POLA_KODE.test(b))) return CAKUPAN_BAWAAN;
  return [...new Set(butir)];
}

/** Apakah kode jenis (nilai kolom `laws.jenis`) termasuk cakupan. */
export function dalamCakupan(cakupan: Cakupan, jenis: string | null | undefined): boolean {
  return typeof jenis === "string" && cakupan.includes(jenis);
}

/** Segmen jenis pada FRBR URI yang ejaannya berbeda dari kode jenisnya (lihat lib/uri.ts untuk PERPPU). */
const KODE_DARI_SEGMEN: Record<string, string> = { PERPU: "PERPPU" };

/**
 * Kode jenis yang segmen URI-nya sama dengan kodenya ("/akn/id/act/perpres/…" untuk PERPRES). Jenis lain tidak
 * punya segmen yang bisa dipetakan dengan pasti: di produksi POJK memakai "peraturan-ojk", dan 204 PERMEN tersebar
 * pada puluhan segmen ("permenkeu", "permenperin", "mk", "pkpu", ...).
 */
const JENIS_BERSEGMEN_BAKU: ReadonlySet<string> = new Set([
  "UUD", "TAP_MPR", "UU", "PERPPU", "PP", "PERPRES", "KEPPRES", "INPRES", "PERMEN", "KEPMEN", "POJK", "PBI",
  "PERDA_PROV", "PERDA_KAB", "PERGUB", "PERBUP", "PERWALI",
]);

const POLA_URI = /^\/akn\/id\/act\/([^/]+)\/\d{4}\/[^/#]+/i;

/**
 * Kode jenis dari FRBR URI: "/akn/id/act/uu/2003/13" menjadi "UU", ".../tap-mpr/1998/1" menjadi "TAP_MPR",
 * ".../perpu/2022/2" menjadi "PERPPU". Hanya segmennya yang dibaca, jadi untuk jenis yang segmennya tak baku
 * (POJK, PERMEN) hasilnya bukan kode jenis yang sebenarnya; pakai `uriJelasDiLuarCakupan` untuk keputusan.
 * Null bila bentuknya bukan FRBR URI peraturan.
 */
export function jenisDariUri(uri: string): string | null {
  const m = POLA_URI.exec(uri);
  if (!m) return null;
  const kode = m[1].toUpperCase().replace(/-/g, "_");
  return KODE_DARI_SEGMEN[kode] ?? kode;
}

/**
 * Apakah URI ini JELAS milik jenis yang di luar cakupan, tanpa membaca database. Hanya segmen baku yang dikenali
 * ("perpres", "keppres", ...); segmen yang tak dikenal (POJK "peraturan-ojk", PERMEN "permenkeu") dinilai
 * "belum jelas" sehingga lolos, dan baris `laws.jenis` yang menentukan bila barisnya ada. Dengan begitu penyaringan
 * lewat URI tidak pernah menyembunyikan sesuatu yang sebenarnya dalam cakupan, termasuk sesudah cakupan dilebarkan
 * ke jenis yang segmennya tak baku. Ia hanya jalan pintas: kandidat vektor dan pesan antrean lama yang jelas
 * di luar cakupan dibuang tanpa kueri.
 */
export function uriJelasDiLuarCakupan(cakupan: Cakupan, uri: string): boolean {
  const kode = jenisDariUri(uri);
  return kode !== null && JENIS_BERSEGMEN_BAKU.has(kode) && !cakupan.includes(kode);
}

/**
 * Klausa SQL "kolom IN ('UU','PP',...)" dengan kode jenis ditulis langsung, bukan parameter terikat: kueri
 * yang sudah memuat hingga 100 parameter (batas D1) tidak boleh bertambah, dan daftarnya bukan masukan
 * pengguna. Keamanannya dari `bacaCakupan` (hanya huruf besar dan garis bawah); pemeriksaan di sini menjaga
 * pemanggil yang memberi daftar sendiri. Daftar kosong menghasilkan klausa yang tak pernah benar.
 */
export function klausaCakupan(cakupan: Cakupan, kolom: string): string {
  if (!cakupan.every((j) => POLA_KODE.test(j))) throw new Error("Kode jenis di cakupan tidak sah");
  return cakupan.length ? `${kolom} IN (${cakupan.map((j) => `'${j}'`).join(",")})` : "0";
}
