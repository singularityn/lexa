/**
 * Pemicu Cron di wrangler.jsonc (`triggers.crons`), dijaga sama oleh test/cakupan.test.ts. Nilainya dibandingkan
 * persis dengan `event.cron`, jadi ejaannya harus sama karakter demi karakter.
 */

/** 02:00 WIB: pemeliharaan harian (lib/pemeliharaan.ts). */
export const CRON_HARIAN = "0 19 * * *";

/**
 * Tiap 15 menit: Gemini otomatis (lib/geminiOtomatis.ts). Tak mengerjakan apa pun, dan tak menyentuh D1, kecuali variabel
 * GEMINI_OTOMATIS dipasang di dashboard.
 */
export const CRON_GEMINI = "*/15 * * * *";
