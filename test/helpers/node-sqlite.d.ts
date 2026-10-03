// Deklarasi minimal untuk `node:sqlite` (bawaan Node >= 22.5) agar berkas tes
// dapat di-typecheck tanpa menarik @types/node, yang akan bentrok dengan tipe
// global @cloudflare/workers-types.
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): { all(...params: unknown[]): Record<string, unknown>[] };
    close(): void;
  }
}
declare module "node:module" {
  export function createRequire(url: string): (id: string) => unknown;
}
