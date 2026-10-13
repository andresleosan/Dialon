import { describe, expect, it } from "vitest";
import {
  createLimits,
  DEFAULT_LIMITS,
  parseApiError,
  parseTurnMeta,
  parseTurnResult,
  validateAudio,
} from "./index";

const ID = "3f1c7b9e-2d4a-4c8b-9e6f-1a2b3c4d5e6f";

describe("createLimits: límites configurables", () => {
  it("sin cambios devuelve los valores por defecto", () => {
    expect(createLimits()).toEqual(DEFAULT_LIMITS);
  });

  it("aplica una configuración válida y conserva el resto", () => {
    const limits = createLimits({ maxAudioMs: 20_000, languages: ["es", "en", "fr"] });
    expect(limits.maxAudioMs).toBe(20_000);
    expect(limits.languages).toEqual(["es", "en", "fr"]);
    expect(limits.maxAudioBytes).toBe(DEFAULT_LIMITS.maxAudioBytes);
  });

  it.each([
    ["mínimo mayor o igual que el máximo", { minAudioMs: 30_000 }],
    ["tamaño negativo", { maxAudioBytes: -1 }],
    ["duración no entera", { maxAudioMs: 1.5 }],
    ["un solo idioma", { languages: ["es"] }],
    ["idiomas repetidos sin par posible", { languages: ["es", "es"] }],
    ["un idioma repetido entre otros", { languages: ["es", "en", "es"] }],
    ["código de idioma mal formado", { languages: ["es", "English"] }],
    ["tipo que no es audio", { audioTypes: ["video/mp4"] }],
    ["sin tipos de audio", { audioTypes: [] }],
  ])("rechaza una configuración incoherente: %s", (_, overrides) => {
    expect(() => createLimits(overrides)).toThrow(RangeError);
  });
});

describe("parseTurnMeta: metadatos del turno", () => {
  it("acepta un turno válido, normaliza el requestId y descarta campos ajenos como uid", () => {
    const result = parseTurnMeta({
      requestId: ID.toUpperCase(),
      source: "es",
      target: "en",
      uid: "otro-usuario",
    });
    expect(result).toEqual({ ok: true, value: { requestId: ID, source: "es", target: "en" } });
  });

  // Casos envueltos en tuplas: Vitest desempaqueta los arrays y `[]` llegaría como `undefined`.
  it.each([[null], ["texto"], [[]], [42]])("rechaza un cuerpo que no es objeto (%j)", (input) => {
    expect(parseTurnMeta(input)).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
  });

  it.each([undefined, "", "no-es-un-uuid", 123])("rechaza un requestId inválido (%j)", (requestId) => {
    expect(parseTurnMeta({ requestId, source: "es", target: "en" })).toMatchObject({
      ok: false,
      code: "INVALID_REQUEST",
    });
  });

  it.each([
    ["ES", "en"],
    ["es", 7],
  ])("rechaza códigos de idioma mal formados (%j → %j)", (source, target) => {
    expect(parseTurnMeta({ requestId: ID, source, target })).toMatchObject({
      ok: false,
      code: "INVALID_REQUEST",
    });
  });

  it("rechaza un idioma no ofrecido y lo acepta si la configuración lo añade", () => {
    const meta = { requestId: ID, source: "es", target: "fr" };
    expect(parseTurnMeta(meta)).toMatchObject({ ok: false, code: "UNSUPPORTED_LANGUAGE" });
    expect(parseTurnMeta(meta, createLimits({ languages: ["es", "en", "fr"] }))).toMatchObject({
      ok: true,
    });
  });

  it("rechaza el mismo idioma de origen y destino", () => {
    expect(parseTurnMeta({ requestId: ID, source: "es", target: "es" })).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_LANGUAGE",
    });
  });

  it("el detalle del error no repite el valor recibido", () => {
    const result = parseTurnMeta({ requestId: "<script>alert(1)</script>", source: "es", target: "en" });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("<script>");
  });
});

describe("validateAudio: audio grabado", () => {
  const audio = { mimeType: "audio/mp4", byteLength: 48_000, durationMs: 2_500 };
  // Frontera JS: la firma acepta `unknown`, así que estos casos no necesitan cast.
  it.each([[null], [undefined], [[]], ["audio/mp4"], [42]])(
    "rechaza datos de audio que no son un objeto (%j) sin lanzar",
    (input) => {
      expect(validateAudio(input)).toMatchObject({ ok: false, code: "INVALID_AUDIO" });
    },
  );

  it("rechaza un array aunque traiga campos de audio", () => {
    const disguised = Object.assign([], { mimeType: "audio/mp4", byteLength: 1_000 });
    expect(validateAudio(disguised)).toMatchObject({ ok: false, code: "INVALID_AUDIO" });
  });

  it("acepta audio válido y normaliza el tipo (sin parámetros, en minúsculas)", () => {
    expect(validateAudio({ ...audio, mimeType: "Audio/WebM; codecs=opus" })).toEqual({
      ok: true,
      value: { mimeType: "audio/webm", byteLength: 48_000, durationMs: 2_500 },
    });
  });

  it.each(["video/mp4", "audio/flac", "", 5, undefined])("rechaza un tipo no admitido (%j)", (mimeType) => {
    expect(validateAudio({ ...audio, mimeType })).toMatchObject({ ok: false, code: "INVALID_AUDIO" });
  });

  it.each([0, -1, 1.5, Number.NaN, "100"])("rechaza audio vacío o con tamaño inválido (%j)", (byteLength) => {
    expect(validateAudio({ ...audio, byteLength })).toMatchObject({ ok: false, code: "INVALID_AUDIO" });
  });

  it("acepta el tamaño máximo exacto y rechaza un byte más", () => {
    const max = DEFAULT_LIMITS.maxAudioBytes;
    expect(validateAudio({ ...audio, byteLength: max }).ok).toBe(true);
    expect(validateAudio({ ...audio, byteLength: max + 1 })).toMatchObject({
      ok: false,
      code: "AUDIO_TOO_LARGE",
    });
  });

  it("rechaza grabaciones demasiado cortas o demasiado largas", () => {
    expect(validateAudio({ ...audio, durationMs: 299 })).toMatchObject({ ok: false, code: "TOO_SHORT" });
    expect(validateAudio({ ...audio, durationMs: 30_001 })).toMatchObject({
      ok: false,
      code: "AUDIO_TOO_LONG",
    });
  });

  it.each([-5, Number.POSITIVE_INFINITY, "3s"])("rechaza una duración inválida (%j)", (durationMs) => {
    expect(validateAudio({ ...audio, durationMs })).toMatchObject({ ok: false, code: "INVALID_AUDIO" });
  });

  it("sin duración declarada (caso del servidor) solo comprueba tipo y tamaño", () => {
    expect(validateAudio({ mimeType: "audio/mp4", byteLength: 1_000 })).toEqual({
      ok: true,
      value: { mimeType: "audio/mp4", byteLength: 1_000 },
    });
  });

  it("respeta los límites configurados", () => {
    const limits = createLimits({ maxAudioBytes: 1_000, maxAudioMs: 10_000 });
    expect(validateAudio({ ...audio, byteLength: 1_001 }, limits)).toMatchObject({
      ok: false,
      code: "AUDIO_TOO_LARGE",
    });
    expect(validateAudio({ ...audio, byteLength: 500, durationMs: 10_001 }, limits)).toMatchObject({
      ok: false,
      code: "AUDIO_TOO_LONG",
    });
  });
});

describe("parseTurnResult: respuesta del servidor", () => {
  const valid = {
    requestId: ID,
    transcript: "Hola, ¿cómo estás?",
    translation: "Hello, how are you?",
    mode: "real",
    timingsMs: { asr: 820, translate: 1_400, desconocido: 5 },
  };

  it("acepta una respuesta válida y descarta campos y tiempos desconocidos", () => {
    expect(parseTurnResult({ ...valid, debug: "x" })).toEqual({
      ok: true,
      value: {
        requestId: ID,
        transcript: "Hola, ¿cómo estás?",
        translation: "Hello, how are you?",
        mode: "real",
        timingsMs: { asr: 820, translate: 1_400 },
      },
    });
  });

  it.each([
    ["un modo desconocido", { mode: "simulado" }],
    ["una transcripción vacía", { transcript: "   " }],
    ["una traducción que no es texto", { translation: 42 }],
    ["un texto por encima del límite", { translation: "a".repeat(2_001) }],
    ["un requestId inválido", { requestId: "abc" }],
    ["un tiempo negativo", { timingsMs: { asr: -1 } }],
    ["tiempos con forma inválida", { timingsMs: [1, 2] }],
  ])("rechaza %s", (_, patch) => {
    expect(parseTurnResult({ ...valid, ...patch })).toMatchObject({ ok: false, code: "INVALID_RESPONSE" });
  });

  it("rechaza algo que no es un objeto", () => {
    expect(parseTurnResult("hola")).toMatchObject({ ok: false, code: "INVALID_RESPONSE" });
  });
});

describe("parseApiError: errores del servidor", () => {
  it("acepta un código de servidor conocido", () => {
    expect(parseApiError({ error: { code: "BUSY", message: "ocupado" }, requestId: ID })).toEqual({
      ok: true,
      value: { code: "BUSY", message: "ocupado", requestId: ID },
    });
  });

  it("no acepta del servidor un código que solo genera el cliente", () => {
    expect(parseApiError({ error: { code: "MIC_PERMISSION_DENIED", message: "x" } })).toMatchObject({
      ok: false,
      code: "INVALID_RESPONSE",
    });
  });

  it.each([
    null,
    {},
    { error: "BUSY" },
    { error: { code: "NO_EXISTE", message: "x" } },
    { error: { code: "BUSY" } },
    { error: { code: "BUSY", message: "x" }, requestId: 5 },
  ])("rechaza una forma inesperada (%j)", (input) => {
    expect(parseApiError(input)).toMatchObject({ ok: false, code: "INVALID_RESPONSE" });
  });
});
