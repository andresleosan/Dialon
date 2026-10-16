import { describe, expect, it } from "vitest";
import * as contracts from "./index";

// Helpers puros de moneda y país. Se buscan por nombre en el módulo: si aún no existen, falla la aserción de
// existencia, no la importación. El exponente sale de Intl (ISO 4217), nunca de «dividir por 100».

type Fn = (...args: never[]) => unknown;
function helper(name: string): Fn | undefined {
  const candidate = (contracts as unknown as Record<string, unknown>)[name];
  return typeof candidate === "function" ? (candidate as Fn) : undefined;
}

const minorDigits = (currency: string) => (helper("currencyMinorDigits") as ((currency: string) => number | undefined) | undefined)?.(currency);
const toMinor = (text: string, currency: string) =>
  (helper("parseMajorToMinor") as ((text: string, currency: string) => number | undefined) | undefined)?.(text, currency);
const fromLocales = (locales: readonly string[]) =>
  (helper("countryFromLocales") as ((locales: readonly string[]) => string | undefined) | undefined)?.(locales);

describe("currencyMinorDigits", () => {
  it("existe", () => {
    expect(typeof helper("currencyMinorDigits")).toBe("function");
  });

  it("toma el exponente de Intl: COP y GBP 2, JPY 0, KWD 3", () => {
    expect(minorDigits("COP")).toBe(2);
    expect(minorDigits("GBP")).toBe(2);
    expect(minorDigits("EUR")).toBe(2);
    expect(minorDigits("JPY")).toBe(0);
    expect(minorDigits("KWD")).toBe(3);
  });

  it("moneda no admitida o mal escrita: undefined (nunca supone 2)", () => {
    for (const currency of ["XYZ", "cop", "EURO", "", "GB", "12A"]) {
      expect(typeof helper("currencyMinorDigits")).toBe("function");
      expect(minorDigits(currency)).toBeUndefined();
    }
  });
});

describe("parseMajorToMinor", () => {
  it("existe", () => {
    expect(typeof helper("parseMajorToMinor")).toBe("function");
  });

  it("decimal exacto en unidad mayor → entero en unidad menor según la moneda, sin parseFloat", () => {
    expect(toMinor("50000", "COP")).toBe(5_000_000);
    expect(toMinor("50000.5", "COP")).toBe(5_000_050);
    expect(toMinor("12.50", "GBP")).toBe(1250);
    expect(toMinor("12.5", "GBP")).toBe(1250);
    expect(toMinor("12", "GBP")).toBe(1200);
    expect(toMinor("0.29", "GBP")).toBe(29);
    expect(toMinor("1500", "JPY")).toBe(1500);
    expect(toMinor("1.250", "KWD")).toBe(1250);
    expect(toMinor("0.001", "KWD")).toBe(1);
    // Tope de importe (100 000 000 en unidad menor), incluido.
    expect(toMinor("1000000", "GBP")).toBe(100_000_000);
  });

  it("rechaza separadores de miles, comas, decimales de más, signos, exponentes, cero y valores fuera de tope", () => {
    expect(typeof helper("parseMajorToMinor")).toBe("function");
    const invalid: [string, string][] = [
      ["12.505", "GBP"],
      ["1500.5", "JPY"],
      ["1.2505", "KWD"],
      ["1,000", "GBP"],
      ["12,50", "GBP"],
      ["1.000,00", "COP"],
      ["1 000", "COP"],
      ["-1", "GBP"],
      ["+1", "GBP"],
      ["0", "GBP"],
      ["0.00", "GBP"],
      ["1e3", "GBP"],
      ["", "GBP"],
      [".5", "GBP"],
      ["5.", "GBP"],
      ["Infinity", "GBP"],
      ["NaN", "GBP"],
      ["12", "XYZ"],
      ["1000000.01", "GBP"],
      ["99999999999999999999", "JPY"],
    ];
    for (const [text, currency] of invalid) expect({ text, currency, value: toMinor(text, currency) }).toEqual({ text, currency, value: undefined });
  });
});

describe("countryFromLocales", () => {
  it("existe", () => {
    expect(typeof helper("countryFromLocales")).toBe("function");
  });

  it("solo una región explícita de dos letras: es-CO → CO, en-GB → GB (no Jersey), zh-Hant-TW → TW", () => {
    expect(fromLocales(["es-CO"])).toBe("CO");
    expect(fromLocales(["en-GB"])).toBe("GB");
    expect(fromLocales(["zh-Hant-TW"])).toBe("TW");
    expect(fromLocales(["es", "es-419", "en-JE"])).toBe("JE");
  });

  it("idioma sin región, región numérica o etiquetas inválidas no dan país (nunca maximize)", () => {
    expect(typeof helper("countryFromLocales")).toBe("function");
    for (const locales of [[], ["es"], ["en"], ["es-419"], ["ja"], ["es", "es-419", "en"], ["no válido"]]) {
      expect(fromLocales(locales)).toBeUndefined();
    }
    expect(fromLocales(["no válido", "fr-FR"])).toBe("FR");
  });
});
