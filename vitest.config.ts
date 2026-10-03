import { configDefaults, defineConfig } from "vitest/config";

// Tes e2e (peramban sungguhan) dijalankan terpisah lewat `npm run e2e`;
// `npm test` dan `npm run check` tetap cepat dan tidak membutuhkan peramban.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, "e2e/**"] },
});
