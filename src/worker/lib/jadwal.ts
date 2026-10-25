/**
 * Pemicu Cron di wrangler.jsonc (`triggers.crons`), dijaga sama oleh test/cakupan.test.ts. Nilainya dibandingkan
 * persis dengan `event.cron`, jadi ejaannya harus sama karakter demi karakter.
 */

/** 02:00 WIB: pemeliharaan harian (lib/pemeliharaan.ts). */
export const CRON_HARIAN = "0 19 * * *";

/**
 * Tiap 15 menit: Gemini otomatis (lib/geminiOtomatis.ts; tak mengerjakan apa pun, dan tak menyentuh D1, kecuali variabel
 * GEMINI_OTOMATIS dipasang di dashboard) dan uraian ulang otomatis (lib/uraianUlang.ts; satu kueri murah bila tak ada yang usang).
 */
export const CRON_GEMINI = "*/15 * * * *";
