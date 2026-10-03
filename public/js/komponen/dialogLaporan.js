// @ts-check
import { h } from "../dom.js";
import { api, GalatApi } from "../api.js";
import { toast } from "./toast.js";

const JENIS = [
  ["teks_salah", "Teks pasal salah atau janggal"],
  ["pasal_hilang", "Ada pasal yang hilang"],
  ["metadata_salah", "Judul, nomor, tahun, atau instansi salah"],
  ["status_salah", "Status berlaku/dicabut salah"],
  ["pdf_rusak", "Berkas PDF rusak atau tidak sesuai"],
  ["lainnya", "Lainnya"],
];

/**
 * Dialog lapor kesalahan data. Memakai elemen <dialog> bawaan (jebakan fokus,
 * Escape, dan latar belakang ditangani peramban).
 *
 * @param {{ uri: string, sitasi: string, konteks?: string }} opsi
 */
export function bukaDialogLaporan({ uri, sitasi, konteks }) {
  const jenis = /** @type {HTMLSelectElement} */ (
    h("select", { class: "input", id: "lapor-jenis", name: "jenis" }, JENIS.map(([nilai, label]) => h("option", { value: nilai }, label)))
  );
  const keterangan = /** @type {HTMLTextAreaElement} */ (
    h("textarea", { class: "input", id: "lapor-ket", name: "keterangan", required: true, maxlength: "2000", rows: "5", placeholder: "Jelaskan apa yang keliru dan, bila bisa, seperti apa yang benar." })
  );
  const kirim = /** @type {HTMLButtonElement} */ (h("button", { type: "submit", class: "tombol tombol-utama" }, "Kirim laporan"));

  const dialog = /** @type {HTMLDialogElement} */ (
    h(
      "dialog",
      { "aria-labelledby": "lapor-judul" },
      h(
        "form",
        {
          method: "dialog",
          onsubmit: async (/** @type {SubmitEvent} */ e) => {
            e.preventDefault();
            kirim.disabled = true;
            try {
              await api.lapor({ uri, jenis: jenis.value, keterangan: keterangan.value.trim(), konteks });
              toast("Terima kasih, laporan Anda tercatat.");
              dialog.close();
            } catch (err) {
              toast(err instanceof GalatApi ? err.message : "Laporan gagal dikirim.", { galat: true });
              kirim.disabled = false;
            }
          },
        },
        h("h2", { id: "lapor-judul" }, "Laporkan kesalahan data"),
        h("p", { class: "redup" }, `${sitasi}${konteks ? ` · ${konteks}` : ""}`),
        h("div", null, h("label", { class: "bidang", for: "lapor-jenis" }, "Jenis kesalahan"), jenis),
        h("div", null, h("label", { class: "bidang", for: "lapor-ket" }, "Keterangan"), keterangan),
        h("p", { class: "bantu" }, "Laporan tidak memuat identitas Anda. Naskah resmi tetap menjadi rujukan utama."),
        h("div", { class: "dialog-aksi" }, h("button", { type: "button", class: "tombol", onclick: () => dialog.close() }, "Batal"), kirim),
      ),
    )
  );
  dialog.addEventListener("close", () => dialog.remove());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close(); // klik pada latar belakang
  });
  document.body.appendChild(dialog);
  dialog.showModal();
  keterangan.focus();
}
