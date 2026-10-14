/**
 * Pemicu Cron di wrangler.jsonc (`triggers.crons`), dijaga sama oleh test/cakupan.test.ts. Nilainya dibandingkan
 * persis dengan `event.cron`, jadi ejaannya harus sama karakter demi karakter.
 */

/** 02:00 WIB: pemeliharaan harian (lib/pemeliharaan.ts). Satu-satunya pemicu terjadwal. */
export const CRON_HARIAN = "0 19 * * *";
