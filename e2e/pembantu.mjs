/**
 * Pembantu bersama tes e2e: menjalankan pratinjau lokal (scripts/dev-node.ts) dan Chromium,
 * serta mengumpulkan galat konsol/jaringan yang harus selalu kosong di akhir setiap tes.
 */
import { execFileSync, spawn } from "node:child_process";
import { createServer, request } from "node:http";
import { chromium } from "playwright-core";

export const UU13 = "/akn/id/act/uu/2003/13";
export const urlUU = (uri, ekstra = "") => `/peraturan?uri=${encodeURIComponent(uri)}${ekstra}`;

/**
 * Bangun dan jalankan server pratinjau di `port`, lalu luncurkan Chromium.
 * @param {number} port
 * @param {Record<string, string>} [env] variabel lingkungan tambahan untuk server pratinjau
 * @returns {Promise<{ server: import("node:child_process").ChildProcess, browser: import("playwright-core").Browser }>}
 */
export async function mulaiPratinjau(port, env = {}) {
  execFileSync("npm", ["run", "build:dev", "--silent"], { stdio: "inherit" });
  const server = spawn(process.execPath, [".dev/dev-node.mjs"], {
    env: { ...process.env, ...env, PORT: String(port) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((selesai, gagal) => {
    const batas = setTimeout(() => gagal(new Error("server pratinjau tidak siap dalam 60 detik")), 60_000);
    server.stdout.on("data", (d) => {
      if (String(d).includes("berjalan di")) {
        clearTimeout(batas);
        selesai(undefined);
      }
    });
    server.on("exit", (kode) => gagal(new Error(`server pratinjau berhenti (kode ${kode})`)));
  });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  return { server, browser };
}

/**
 * Kumpulkan semua yang menandakan ada yang rusak: galat/peringatan konsol (termasuk pelanggaran CSP),
 * pageerror, permintaan gagal, dan respons 4xx/5xx yang tidak disengaja.
 * @param {import("playwright-core").Page} page
 * @param {string[]} masalah
 * @param {{ izinkanStatus?: string[] }} [opsi] potongan URL yang boleh menjawab 4xx/5xx
 */
export function pasangPengumpul(page, masalah, opsi = {}) {
  const izin = ["/api/laws/detail", "/api/tanya", ...(opsi.izinkanStatus ?? [])];
  page.on("console", (m) => {
    // Peramban mencatat setiap respons 4xx/5xx sebagai galat konsol; statusnya diperiksa di penangan "response".
    // Playwright sendiri memperingatkan bila pendaftaran service worker sengaja diblokir (serviceWorkers: "block").
    const teks = m.text();
    if (["error", "warning"].includes(m.type()) && !teks.startsWith("Failed to load resource") && teks !== "Service Worker registration blocked by Playwright") {
      masalah.push(`[${m.type()}] ${teks}`);
    }
  });
  page.on("pageerror", (e) => masalah.push(`[pageerror] ${e.message}`));
  page.on("requestfailed", (r) => {
    // Permintaan basi yang sengaja dibatalkan aplikasi (AbortController) bukan kegagalan.
    if (r.failure()?.errorText !== "net::ERR_ABORTED") masalah.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on("response", (r) => {
    // 404 pada detail dan 429/503 pada tanya sengaja terjadi di beberapa skenario; yang lain berarti ada yang rusak.
    if (r.status() >= 400 && !izin.some((p) => r.url().includes(p))) masalah.push(`[http ${r.status()}] ${r.url()}`);
  });
}

/**
 * Perantara HTTP di depan server pratinjau yang bisa "memutus jaringan" sesuai perintah.
 *
 * `context.setOffline(true)` milik Playwright tidak berlaku bagi permintaan yang dibuat service
 * worker, sehingga tidak cukup untuk menguji strategi luring. Perantara ini memutus sambungan
 * untuk semua pihak (halaman dan service worker), seperti jaringan yang benar-benar hilang.
 * Pasangkan dengan `context.setOffline(true)` bila peristiwa `offline` peramban ikut diperlukan.
 *
 * @param {number} portAsal port server pratinjau
 * @param {number} portPerantara port yang dipakai peramban
 * @returns {Promise<{ putus(nilai: boolean): void, tutup(): void }>}
 */
export function buatPerantara(portAsal, portPerantara) {
  let putus = false;
  const server = createServer((req, res) => {
    if (putus) {
      req.socket.destroy();
      return;
    }
    const hulu = request({ host: "127.0.0.1", port: portAsal, path: req.url, method: req.method, headers: req.headers }, (balasan) => {
      res.writeHead(balasan.statusCode ?? 502, balasan.headers);
      balasan.pipe(res);
    });
    hulu.on("error", () => res.destroy());
    req.pipe(hulu);
  });
  return new Promise((selesai) =>
    server.listen(portPerantara, () =>
      selesai({
        putus: (nilai) => void (putus = nilai),
        tutup: () => server.close(),
      }),
    ),
  );
}
