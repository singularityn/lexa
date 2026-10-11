/**
 * Pemicu Cron di wrangler.jsonc (`triggers.crons`), dijaga sama oleh test/cakupan.test.ts. Nilainya dibandingkan
 * persis dengan `event.cron`, jadi ejaannya harus sama karakter demi karakter.
 */

/** 02:00 WIB: pemeliharaan harian (lib/pemeliharaan.ts). */
export const CRON_HARIAN = "0 19 * * *";

/** Tik per menit (lib/tik.ts). */
export const CRON_MENIT = "* * * * *";
