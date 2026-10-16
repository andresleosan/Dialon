import { describe, expect, it } from "vitest";
import { createLimits, DEFAULT_LIMITS } from "./limits";
import {
  DEFAULT_TEXT_TRANSLATION_LIMITS,
  parseTextTranslationRequest,
  parseTextTranslationResult,
} from "./translate";

const ID = "6F1C2B0A-1D2E-4F3A-8B4C-5D6E7F809A1B";
const VALID = { requestId: ID, source: "es", target: "pt", text: "Hola, ¿qué tal?" };

describe("catálogo de traducción de texto", () => {
  it("por defecto ofrece seis idiomas sin cambiar el es/en de DEFAULT_LIMITS", () => {
    expect(DEFAULT_TEXT_TRANSLATION_LIMITS.languages).toEqual(["es", "en", "pt", "fr", "de", "it"]);
    expect(DEFAULT_TEXT_TRANSLATION_LIMITS.maxTextChars).toBe(2000);
    expect(DEFAULT_LIMITS.languages).toEqual(["es", "en"]);
  });
});

describe("parseTextTranslationRequest", () => {
  it("acepta una petición válida del catálogo por defecto y normaliza el requestId", () => {
    expect(parseTextTranslationRequest(VALID)).toEqual({
      ok: true,
      value: { requestId: ID.toLowerCase(), source: "es", target: "pt", text: "Hola, ¿qué tal?" },
    });
  });

  it("con Limits inyectados admite otros códigos ISO; sin ellos los rechaza; el mismo idioma no vale", () => {
    const withJapanese = createLimits({ languages: ["es", "ja"] });
    expect(parseTextTranslationRequest({ ...VALID, target: "ja" }, withJapanese).ok).toBe(true);
    expect(parseTextTranslationRequest({ ...VALID, target: "ja" })).toMatchObject({ ok: false, code: "UNSUPPORTED_LANGUAGE" });
    expect(parseTextTranslationRequest({ ...VALID, target: "es" })).toMatchObject({ ok: false, code: "UNSUPPORTED_LANGUAGE" });
    expect(parseTextTranslationRequest({ ...VALID, target: "pt" }, DEFAULT_LIMITS)).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_LANGUAGE",
    });
  });

  it("es estricta: rechaza propiedades ajenas como uid, url, model o messages", () => {
    for (const extra of [{ uid: "otro" }, { url: "https://x" }, { model: "otro" }, { messages: [] }, { stream: true }]) {
      expect(parseTextTranslationRequest({ ...VALID, ...extra })).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    }
  });

  it("rechaza requestId inválido, entradas que no son objeto y texto ausente, vacío o con solo espacios", () => {
    const cases: unknown[] = [
      null,
      "texto",
      [],
      { ...VALID, requestId: "no-uuid" },
      { ...VALID, text: undefined },
      { ...VALID, text: 42 },
      { ...VALID, text: "" },
      { ...VALID, text: "   \n " },
    ];
    for (const input of cases) {
      expect(parseTextTranslationRequest(input)).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    }
  });

  it("2000 caracteres valen y 2001 no; el detalle nunca repite el texto", () => {
    expect(parseTextTranslationRequest({ ...VALID, text: "a".repeat(2000) }).ok).toBe(true);
    const long = parseTextTranslationRequest({ ...VALID, text: "secreto".repeat(300) });
    expect(long).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    expect(JSON.stringify(long)).not.toContain("secreto");
  });
});

describe("parseTextTranslationResult", () => {
  const RESULT = { requestId: ID, translation: "Olá, tudo bem?", mode: "real", timingsMs: { auth: 3, translate: 900, total: 910 } };

  it("acepta un resultado real y proyecta solo los campos conocidos", () => {
    expect(parseTextTranslationResult({ ...RESULT, extra: "x", timingsMs: { ...RESULT.timingsMs, asr: 5 } })).toEqual({
      ok: true,
      value: {
        requestId: ID.toLowerCase(),
        translation: "Olá, tudo bem?",
        mode: "real",
        timingsMs: { auth: 3, translate: 900, total: 910 },
      },
    });
    expect(parseTextTranslationResult({ requestId: ID, translation: "Hi", mode: "real" })).toEqual({
      ok: true,
      value: { requestId: ID.toLowerCase(), translation: "Hi", mode: "real" },
    });
  });

  it("rechaza mode distinto de real, traducción vacía o demasiado larga, requestId y tiempos inválidos", () => {
    const cases: unknown[] = [
      null,
      { ...RESULT, mode: "demo" },
      { ...RESULT, translation: "  " },
      { ...RESULT, translation: "a".repeat(2001) },
      { ...RESULT, requestId: "x" },
      { ...RESULT, timingsMs: { total: -1 } },
      { ...RESULT, timingsMs: { total: Number.NaN } },
      { ...RESULT, timingsMs: "rápido" },
    ];
    for (const input of cases) {
      expect(parseTextTranslationResult(input)).toMatchObject({ ok: false, code: "INVALID_RESPONSE" });
    }
  });
});
