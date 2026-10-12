/**
 * Alamat pengalihan (redirect_uri) OAuth Google.
 *
 * Google hanya mengalihkan peramban ke alamat yang terdaftar PERSIS di Google Cloud Console (APIs & Services >
 * Credentials > klien OAuth > Authorized redirect URIs): skema, host, port, dan jalur harus sama huruf demi huruf, tanpa
 * garis miring penutup. Selisih sekecil apa pun dijawab "Error 400: redirect_uri_mismatch" oleh halaman Google
 * sendiri, dan peramban TIDAK dikembalikan ke Lexa, jadi Lexa tak punya kesempatan menjelaskan apa pun pada saat itu.
 *
 * Karena itu alamatnya dibentuk di satu tempat saja. Awal alur (/api/auth/google) dan pertukaran kode di callback harus
 * mengirim alamat yang sama, dan halaman Akun menampilkannya apa adanya (lewat /api/auth/status) supaya pengelola
 * tahu persis apa yang harus didaftarkan. Alamat ini mengikuti host yang dipakai pengunjung: situs yang dibuka lewat
 * lexa.<akun>.workers.dev dan lewat domain sendiri memerlukan dua entri terdaftar.
 */

/** Jalur callback; didaftarkan oleh route di routes/auth.ts dan harus muncul persis di Google Cloud Console. */
export const JALUR_CALLBACK = "/api/auth/google/callback";

/** redirect_uri untuk permintaan yang datang ke `urlPermintaan`: asal (skema, host, port) permintaan itu + `JALUR_CALLBACK`. */
export function uriCallback(urlPermintaan: string): string {
  return `${new URL(urlPermintaan).origin}${JALUR_CALLBACK}`;
}
