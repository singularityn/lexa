/**
 * CORS untuk permintaan yang datang dari sesi peramban di situs BPK.
 *
 * Hanya origin BPK yang diizinkan. Origin lain tetap dilayani, tetapi tanpa
 * header CORS — sehingga peramban yang memanggilnya akan memblokir sendiri
 * pembacaan responsnya.
 */

const ORIGIN_DIIZINKAN = new Set([
  "https://peraturan.bpk.go.id",
  "https://www.peraturan.bpk.go.id",
]);

export function headerCors(origin: string | undefined): Record<string, string> {
  if (!origin || !ORIGIN_DIIZINKAN.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-admin-token",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
