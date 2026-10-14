/**
 * Pemecah PDF (lib/pdfBagi.ts) dengan PDF sungguhan buatan pdf-lib: tiap halaman diberi lebar berbeda supaya halaman yang tersalin
 * dapat dikenali tanpa membaca teksnya.
 */
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { bukaPdf } from "../src/worker/lib/pdfBagi";

/** PDF dengan `n` halaman; halaman ke-i (dari 1) berlebar 100 + i. */
async function buatPdf(n: number): Promise<Uint8Array> {
  const dok = await PDFDocument.create();
  for (let i = 1; i <= n; i++) {
    const h = dok.addPage([100 + i, 200]);
    h.drawText(`Halaman ${i}`, { x: 5, y: 100, size: 8 });
  }
  return dok.save();
}

const lebar = async (bytes: Uint8Array) => {
  const dok = await PDFDocument.load(bytes);
  return dok.getPages().map((h) => h.getWidth());
};

/** PDF minimal yang bertanda terenkripsi (kamus /Encrypt di trailer), dengan tabel xref yang sah. */
function pdfTerenkripsi(): Uint8Array {
  const objek = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>",
    "<< /Filter /Standard /V 1 /R 2 /O (aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) /U (bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb) /P -4 >>",
  ];
  let teks = "%PDF-1.4\n";
  const posisi: number[] = [];
  objek.forEach((o, i) => {
    posisi.push(teks.length);
    teks += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = teks.length;
  teks += `xref\n0 ${objek.length + 1}\n0000000000 65535 f \n`;
  for (const p of posisi) teks += `${String(p).padStart(10, "0")} 00000 n \n`;
  teks += `trailer\n<< /Size ${objek.length + 1} /Root 1 0 R /Encrypt 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(teks);
}

describe("bukaPdf", () => {
  it("menyebut jumlah halaman PDF sungguhan", async () => {
    expect((await bukaPdf(await buatPdf(1)))?.halaman).toBe(1);
    expect((await bukaPdf(await buatPdf(23)))?.halaman).toBe(23);
  });

  it("ambil(mulai, akhir): PDF baru berisi persis halaman itu, menurut urutan asli", async () => {
    const pemecah = (await bukaPdf(await buatPdf(12)))!;
    expect(await lebar(await pemecah.ambil(1, 5))).toEqual([101, 102, 103, 104, 105]);
    expect(await lebar(await pemecah.ambil(6, 10))).toEqual([106, 107, 108, 109, 110]);
    expect(await lebar(await pemecah.ambil(11, 12))).toEqual([111, 112]);
    expect(await lebar(await pemecah.ambil(7, 7))).toEqual([107]);
    expect(await lebar(await pemecah.ambil(1, 12))).toEqual(Array.from({ length: 12 }, (_, i) => 101 + i));
  });

  it("potongan dapat diambil berulang dan berurutan acak dari pemecah yang sama; PDF asli tak berubah", async () => {
    const asli = await buatPdf(6);
    const salinan = asli.slice();
    const pemecah = (await bukaPdf(asli))!;
    const a = await pemecah.ambil(4, 6);
    const b = await pemecah.ambil(1, 3);
    const c = await pemecah.ambil(4, 6);
    expect(await lebar(a)).toEqual([104, 105, 106]);
    expect(await lebar(b)).toEqual([101, 102, 103]);
    expect(await lebar(c)).toEqual([104, 105, 106]);
    expect(asli).toEqual(salinan);
  });

  it("potongan adalah PDF yang sah dan lebih kecil daripada aslinya bila hanya sebagian halaman", async () => {
    const asli = await buatPdf(30);
    const potongan = await (await bukaPdf(asli))!.ambil(1, 3);
    expect(new TextDecoder().decode(potongan.slice(0, 5))).toBe("%PDF-");
    expect(potongan.byteLength).toBeLessThan(asli.byteLength);
  });

  it("rentang di luar PDF, terbalik, atau bukan bilangan bulat: RangeError", async () => {
    const pemecah = (await bukaPdf(await buatPdf(5)))!;
    for (const [m, a] of [[0, 2], [3, 6], [4, 3], [1.5, 3], [1, 2.5], [-1, 2]] as const) {
      await expect(pemecah.ambil(m, a), `${m}-${a}`).rejects.toThrow(RangeError);
    }
  });

  it("bukan PDF, kosong, atau rusak: null (pemanggil jatuh ke pembacaan utuh)", async () => {
    expect(await bukaPdf(new TextEncoder().encode("bukan pdf sama sekali"))).toBeNull();
    expect(await bukaPdf(new Uint8Array(0))).toBeNull();
    expect(await bukaPdf(new TextEncoder().encode("%PDF-1.4\n<< /Type /Page >>\n%%EOF"))).toBeNull();
    const rusak = (await buatPdf(3)).slice(0, 200);
    expect(await bukaPdf(rusak)).toBeNull();
  });

  it("PDF terenkripsi tak dipecah: potongannya akan berisi aliran terenkripsi tanpa kamus enkripsinya", async () => {
    expect(await bukaPdf(pdfTerenkripsi())).toBeNull();
  });
});
