/**
 * API pasal.id tiruan untuk tes pipeline: daftar `/laws` per jenis, detail `/laws/<uri>`, batas laju, dan galat.
 * Dipasang lewat `vi.stubGlobal("fetch", ...)`, jadi kode asli (PasalClient) yang berbicara dengannya.
 */
import { vi } from "vitest";

export interface OpsiPasal {
  /** Daftar item `/laws` per kode jenis (`type`). */
  daftar?: Record<string, unknown[]>;
  /** Respons detail per URI (tanpa awalan garis miring ganda). */
  detail?: Record<string, unknown>;
  /** Kembalikan true untuk menjawab 429 (Retry-After 120). */
  batasLaju?: (url: URL) => boolean;
  /** Kembalikan kode HTTP untuk menjawab galat (mis. 500, 403); undefined: layani biasa. */
  galat?: (url: URL) => number | undefined;
  /** Filter `type` yang tak dikenal diabaikan hulu dan menjawab SEMUA peraturan (perilaku nyata pasal.id). */
  abaikanFilter?: boolean;
}

export interface PasalPalsu {
  /** Semua permintaan yang masuk, berurutan. */
  panggilan: URL[];
  /** Ganti opsi di tengah tes (mis. batas laju dicabut). */
  atur(opsi: Partial<OpsiPasal>): void;
  /** Permintaan daftar (`/laws` tanpa uri) dan detail saja. */
  daftarDiminta(): Array<{ jenis: string | null; offset: string | null }>;
  detailDiminta(): string[];
}

/** Item daftar `/laws` pasal.id. */
export const itemDaftar = (jenis: string, tahun: number, nomor: number, judul: string, opsi: { status?: string; verifikasi?: boolean | null } = {}) => ({
  id: tahun * 1000 + nomor,
  frbr_uri: `/akn/id/act/${jenis.toLowerCase()}/${tahun}/${nomor}`,
  title: judul,
  type: jenis,
  number: String(nomor),
  year: tahun,
  status: opsi.status ?? "berlaku",
  ...(opsi.verifikasi === undefined ? {} : { content_verified: opsi.verifikasi }),
});

/** Respons detail dengan pohon pasal sederhana: satu bab, pasal tanpa ayat, dan pasal dengan dua ayat. */
export function detailPeraturan(jenis: string, tahun: number, nomor: number, judul: string, pasal = 3, ekstra: Record<string, unknown> = {}) {
  const uri = `/akn/id/act/${jenis.toLowerCase()}/${tahun}/${nomor}`;
  const simpul: Array<Record<string, unknown>> = [{ id: 1, type: "bab", number: "I", heading: "KETENTUAN UMUM", content: "", parent_id: null, sort_order: 1 }];
  let id = 2;
  for (let n = 1; n <= pasal; n++) {
    if (n % 2 === 0) {
      const induk = id++;
      simpul.push({ id: induk, type: "pasal", number: String(n), content: "", parent_id: 1, sort_order: n * 10 });
      simpul.push({ id: id++, type: "ayat", number: "1", content: `Isi ayat satu pasal ${n}.`, parent_id: induk, sort_order: n * 10 + 1 });
      simpul.push({ id: id++, type: "ayat", number: "2", content: `Isi ayat dua pasal ${n}.`, parent_id: induk, sort_order: n * 10 + 2 });
    } else {
      simpul.push({ id: id++, type: "pasal", number: String(n), content: `Isi pasal ${n}.`, parent_id: 1, sort_order: n * 10 });
    }
  }
  return {
    work: { id: tahun * 1000 + nomor, frbr_uri: uri, title: judul, type: jenis, number: String(nomor), year: tahun, status: "berlaku" },
    articles: simpul,
    relationships: [],
    detail_access: "full",
    ...ekstra,
  };
}

/** Catatan yang dibawa jawaban tanpa naskah (isi nyatanya 154 huruf; yang dipakai tes cukup mewakili). */
export const CATATAN_TERBATAS = "Teks lengkap hanya untuk pemakai yang masuk dengan token akun.";

/** Jawaban detail pasal.id yang membatasi akses (Oktober 2026): `work` tanpa `articles`, `content`, dan `content_note`. */
export function detailTerbatas(jenis: string, tahun: number, nomor: number, judul: string) {
  const uri = `/akn/id/act/${jenis.toLowerCase()}/${tahun}/${nomor}`;
  return {
    work: { id: tahun * 1000 + nomor, frbr_uri: uri, title: judul, type: jenis, number: String(nomor), year: tahun, status: "berlaku" },
    content: "not_available_via_api",
    content_note: CATATAN_TERBATAS,
  };
}

export function pasangPasalPalsu(awal: OpsiPasal = {}): PasalPalsu {
  let opsi = awal;
  const panggilan: URL[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    panggilan.push(url);
    if (opsi.batasLaju?.(url)) return new Response("lambat", { status: 429, headers: { "retry-after": "120" } });
    const kode = opsi.galat?.(url);
    if (kode !== undefined) return new Response("galat", { status: kode });
    if (url.pathname === "/api/laws" && !url.searchParams.has("uri")) {
      const jenis = url.searchParams.get("type") ?? "";
      const semua = !jenis || opsi.abaikanFilter ? Object.values(opsi.daftar ?? {}).flat() : (opsi.daftar?.[jenis] ?? []);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 50);
      return Response.json({ laws: semua.slice(offset, offset + limit), total: semua.length, limit, offset });
    }
    const uri = url.pathname.replace(/^\/api\/laws/, "") || url.searchParams.get("uri") || "";
    const d = opsi.detail?.[uri];
    return d ? Response.json(d) : new Response("tidak ada", { status: 404 });
  });
  return {
    panggilan,
    atur: (o) => void (opsi = { ...opsi, ...o }),
    daftarDiminta: () =>
      panggilan
        .filter((u) => u.pathname === "/api/laws" && !u.searchParams.has("uri"))
        .map((u) => ({ jenis: u.searchParams.get("type"), offset: u.searchParams.get("offset") })),
    detailDiminta: () => panggilan.filter((u) => u.pathname.startsWith("/api/laws/")).map((u) => u.pathname.replace(/^\/api\/laws/, "")),
  };
}
