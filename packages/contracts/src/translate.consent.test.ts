import { describe, expect, it } from "vitest";
import { SERVER_ERROR_CODES } from "./errors";
import { parseApiError } from "./parse";
import { parseTextTranslationRequest } from "./translate";

// Consentimiento de procesamiento externo por petición: solo un booleano. No elige proveedor ni modelo.

const ID = "6f1c2b0a-1d2e-4f3a-8b4c-5d6e7f809a1b";
const BASE = { requestId: ID, source: "es", target: "en", text: "Hola" };

describe("externalProcessingConsent", () => {
  it("acepta true o false y lo conserva en la petición validada", () => {
    expect(parseTextTranslationRequest({ ...BASE, externalProcessingConsent: true })).toEqual({
      ok: true,
      value: { ...BASE, externalProcessingConsent: true },
    });
    expect(parseTextTranslationRequest({ ...BASE, externalProcessingConsent: false })).toMatchObject({
      ok: true,
      value: { externalProcessingConsent: false },
    });
  });

  it("sin el campo la petición sigue siendo válida y no lleva consentimiento", () => {
    const parsed = parseTextTranslationRequest(BASE);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).not.toHaveProperty("externalProcessingConsent");
  });

  it("un consentimiento no booleano, o pedir proveedor, modelo, URL o rol, sigue siendo INVALID_REQUEST", () => {
    for (const extra of [
      { externalProcessingConsent: "true" },
      { externalProcessingConsent: 1 },
      { externalProcessingConsent: null },
      { externalProcessingConsent: true, provider: "deepseek" },
      { externalProcessingConsent: true, model: "deepseek-v4-pro" },
      { url: "https://api.deepseek.com/chat/completions" },
      { role: "owner" },
    ]) {
      expect(parseTextTranslationRequest({ ...BASE, ...extra })).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    }
  });
});

describe("códigos de error de la administración manual", () => {
  it("SUBSCRIPTION_REQUIRED, QUOTA_EXCEEDED y CONSENT_REQUIRED son códigos de servidor que el cliente acepta", () => {
    for (const code of ["SUBSCRIPTION_REQUIRED", "QUOTA_EXCEEDED", "CONSENT_REQUIRED"]) {
      expect(SERVER_ERROR_CODES).toContain(code);
      expect(parseApiError({ error: { code, message: "x" }, requestId: ID })).toMatchObject({ ok: true, value: { code } });
    }
  });
});
