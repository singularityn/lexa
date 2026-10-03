/**
 * Ejaan alternatif FRBR URI untuk peraturan yang sama.
 *
 * pasal.id menulis PERPPU dengan dua ejaan segmen, "perpu" dan "perppu", dan kadang berbeda
 * antara peraturan itu sendiri (`/akn/id/act/perpu/2022/2`) dan relasi yang menunjuk
 * kepadanya (`/akn/id/act/perppu/2022/2`). Di produksi 117 dari 124 relasi ke PERPPU menunjuk
 * ke ejaan yang tidak ada di tabel `laws`, sehingga tautannya mati dan relasi masuk di halaman
 * PERPPU itu tidak ditemukan. Data tidak diubah; URI diselesaikan saat dibaca.
 */

import { pilihDalam } from "./d1";

const PASANGAN_ALIAS: ReadonlyArray<readonly [string, string]> = [
  ["/act/perppu/", "/act/perpu/"],
  ["/act/perpu/", "/act/perppu/"],
];

/** Ejaan lain untuk peraturan yang sama, atau null bila URI ini tidak punya. */
export function aliasUri(uri: string): string | null {
  for (const [dari, ke] of PASANGAN_ALIAS) {
    if (uri.includes(dari)) return uri.replace(dari, ke);
  }
  return null;
}

/** `[uri]`, atau `[uri, alias]` bila punya ejaan lain. */
export function varianUri(uri: string): string[] {
  const alias = aliasUri(uri);
  return alias ? [uri, alias] : [uri];
}

/**
 * Untuk tiap URI, URI yang benar-benar ada di `laws`: dirinya bila ada; bila tidak ada tetapi
 * aliasnya ada, alias itu; selain itu dirinya sendiri (peraturan belum ter-ingest). Tidak
 * menyentuh database bila tak satu pun URI punya alias.
 */
export async function selesaikanUri(db: D1Database, uris: Iterable<string>): Promise<Map<string, string>> {
  const unik = [...new Set(uris)];
  const peta = new Map<string, string>(unik.map((u) => [u, u]));
  const beralias = unik.filter((u) => aliasUri(u) !== null);
  if (!beralias.length) return peta;

  const kandidat = [...new Set(beralias.flatMap(varianUri))];
  const baris = await pilihDalam<{ frbr_uri: string }>(
    db,
    kandidat,
    (t) => `SELECT frbr_uri FROM laws WHERE frbr_uri IN (${t})`,
  );
  const ada = new Set(baris.map((r) => r.frbr_uri));

  for (const u of beralias) {
    const alias = aliasUri(u) as string;
    if (!ada.has(u) && ada.has(alias)) peta.set(u, alias);
  }
  return peta;
}
