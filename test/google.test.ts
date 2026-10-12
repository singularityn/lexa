import { describe, expect, it } from "vitest";
import { JALUR_CALLBACK, uriCallback } from "../src/worker/lib/google";

describe("uriCallback (redirect_uri OAuth Google)", () => {
  it("asal permintaan + jalur callback, tanpa garis miring penutup", () => {
    expect(uriCallback("https://lexa.fariqhfebrian18.workers.dev/api/auth/google")).toBe(
      "https://lexa.fariqhfebrian18.workers.dev/api/auth/google/callback",
    );
    expect(JALUR_CALLBACK).toBe("/api/auth/google/callback");
  });

  it("jalur, kueri, dan fragmen permintaan tak ikut; skema dan port ikut", () => {
    expect(uriCallback("https://lexa.example/api/auth/status?x=1#y")).toBe("https://lexa.example/api/auth/google/callback");
    expect(uriCallback("http://localhost:8787/")).toBe("http://localhost:8787/api/auth/google/callback");
    expect(uriCallback("https://lexa.example:8443/a/b")).toBe("https://lexa.example:8443/api/auth/google/callback");
  });

  it("host dibakukan huruf kecil seperti yang dikirim peramban", () => {
    expect(uriCallback("https://LEXA.Example/api/auth/google")).toBe("https://lexa.example/api/auth/google/callback");
  });
});
