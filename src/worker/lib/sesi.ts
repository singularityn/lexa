/**
 * Sesi pengguna.
 *
 * Sesi disimpan di KV, bukan sebagai JWT bertanda tangan. Alasannya sederhana:
 * sesi di KV bisa dicabut seketika saat pengguna keluar, sedangkan JWT tetap
 * sah sampai kedaluwarsa. Untuk aplikasi yang menyimpan koleksi dan catatan
 * pribadi seseorang, kemampuan mencabut lebih berharga daripada penghematan
 * satu pembacaan KV.
 */

export interface Sesi {
  pengguna_id: string;
  email: string;
  nama: string | null;
  foto_url: string | null;
  dibuat: number;
}

const NAMA_COOKIE = "lexa_sesi";
const UMUR_DETIK = 60 * 60 * 24 * 30; // 30 hari

/** Id sesi acak 256-bit — tidak dapat ditebak. */
export function idSesiBaru(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function kunciSesi(id: string): string {
  return `sesi:${id}`;
}

export async function simpanSesi(kv: KVNamespace, id: string, sesi: Sesi): Promise<void> {
  await kv.put(kunciSesi(id), JSON.stringify(sesi), { expirationTtl: UMUR_DETIK });
}

export async function hapusSesi(kv: KVNamespace, id: string): Promise<void> {
  await kv.delete(kunciSesi(id));
}

/** Baca id sesi dari header Cookie. */
export function idSesiDariCookie(header: string | undefined): string | null {
  if (!header) return null;
  for (const bagian of header.split(";")) {
    const [k, ...v] = bagian.trim().split("=");
    if (k === NAMA_COOKIE) return v.join("=") || null;
  }
  return null;
}

export async function bacaSesi(kv: KVNamespace, header: string | undefined): Promise<Sesi | null> {
  const id = idSesiDariCookie(header);
  if (!id) return null;
  return kv.get<Sesi>(kunciSesi(id), "json").catch(() => null);
}

/**
 * Cookie sesi.
 *
 * `HttpOnly` menutup akses dari JavaScript, sehingga XSS tidak bisa mencuri
 * sesi. `SameSite=Lax` mengizinkan cookie ikut pada navigasi dari Google saat
 * kembali dari OAuth, tetapi menahannya pada permintaan lintas situs biasa —
 * itulah pertahanan CSRF-nya.
 */
export function cookieSesi(id: string, aman: boolean): string {
  return [
    `${NAMA_COOKIE}=${id}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    aman ? "Secure" : "",
    `Max-Age=${UMUR_DETIK}`,
  ].filter(Boolean).join("; ");
}

export function cookieHapus(aman: boolean): string {
  return [
    `${NAMA_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    aman ? "Secure" : "",
    "Max-Age=0",
  ].filter(Boolean).join("; ");
}
