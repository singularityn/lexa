// Deklarasi minimal untuk modul bawaan Node yang dipakai berkas tes dan skrip,
// agar bisa di-typecheck tanpa menarik @types/node (yang akan bentrok dengan tipe
// global @cloudflare/workers-types).
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
declare module "node:fs/promises" {
  export function readFile(path: string): Promise<Uint8Array>;
  export function stat(path: string): Promise<{ isFile(): boolean }>;
}
declare module "node:path" {
  export function join(...bagian: string[]): string;
  export function resolve(...bagian: string[]): string;
  export function normalize(path: string): string;
  export function extname(path: string): string;
}
declare module "node:http" {
  export interface IncomingMessage {
    url?: string;
    method?: string;
    headers: Record<string, string | string[] | undefined>;
    socket: { remoteAddress?: string };
    on(peristiwa: "data", cb: (potongan: Uint8Array) => void): IncomingMessage;
    on(peristiwa: "end", cb: () => void): IncomingMessage;
    on(peristiwa: "error", cb: (e: Error) => void): IncomingMessage;
  }
  export interface ServerResponse {
    writeHead(status: number, header?: Record<string, string | string[]>): ServerResponse;
    end(data?: Uint8Array | string): void;
  }
  export function createServer(penangan: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): {
    listen(port: number, saatSiap?: () => void): void;
    close(): void;
  };
}
declare const process: {
  env: Record<string, string | undefined>;
  stdout: { write(teks: string): void };
  on(peristiwa: string, cb: () => void): void;
  exit(kode?: number): never;
};
