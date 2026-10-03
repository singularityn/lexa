/**
 * Perbandingan token admin dengan waktu konstan.
 *
 * Perbandingan `===` biasa berhenti pada karakter pertama yang berbeda,
 * sehingga lama eksekusinya membocorkan seberapa jauh tebakan penyerang benar.
 * Untuk endpoint yang bisa menulis ke basis data, itu tidak layak dibiarkan.
 */
export function tokenSah(diberikan: string | undefined, benar: string | undefined): boolean {
  // Spasi dan newline di ujung dibuang lebih dulu. `wrangler secret put` yang
  // diberi masukan lewat pipa (`echo "xxx" | wrangler secret put`) menyimpan
  // newline ikut serta, dan menyalin token dari terminal mudah membawa spasi.
  // Tanpa pemangkasan, selisih satu karakter tak kasatmata itu membuat setiap
  // permintaan dijawab 401 tanpa petunjuk apa pun.
  const a = diberikan?.trim();
  const b = benar?.trim();
  if (!a || !b || a.length !== b.length) return false;

  let beda = 0;
  for (let i = 0; i < b.length; i++) {
    beda |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return beda === 0;
}

/**
 * Diagnosis kegagalan autentikasi tanpa membocorkan tokennya.
 *
 * Hanya mengembalikan boolean — bukan nilai maupun panjang token — sehingga
 * aman dipanggil tanpa autentikasi, sementara tetap cukup untuk membedakan
 * "header tidak terkirim", "secret belum dipasang", dan "isinya memang beda".
 */
export function diagnosaToken(
  diberikan: string | undefined,
  benar: string | undefined,
): {
  header_diterima: boolean;
  secret_terpasang: boolean;
  ada_spasi_berlebih: boolean;
  panjang_cocok: boolean;
  cocok: boolean;
} {
  const adaSpasi =
    (diberikan !== undefined && diberikan !== diberikan.trim()) ||
    (benar !== undefined && benar !== benar.trim());

  return {
    header_diterima: Boolean(diberikan),
    secret_terpasang: Boolean(benar),
    ada_spasi_berlebih: adaSpasi,
    panjang_cocok: Boolean(diberikan && benar && diberikan.trim().length === benar.trim().length),
    cocok: tokenSah(diberikan, benar),
  };
}
