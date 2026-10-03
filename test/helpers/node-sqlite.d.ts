// Deklarasi minimal untuk modul bawaan Node yang dipakai berkas tes, agar bisa
// di-typecheck tanpa menarik @types/node (yang akan bentrok dengan tipe global
// @cloudflare/workers-types).
declare module "node:sqlite" {
  export interface StatementSync {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
declare module "node:module" {
  export function createRequire(url: string): (id: string) => unknown;
}
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readdirSync(path: string): string[];
}
