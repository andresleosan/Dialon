import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { AccessibilityInfo, Dimensions, TextInput, useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { FaceToFaceScreen } from "./FaceToFaceScreen";

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 24, left: 0, right: 0, bottom: 16 },
};

// Nombres accesibles: acción e idioma de cada mitad (A empieza en español y B en inglés).
const A = {
  selector: "Yo hablo: Español",
  start: "Toca para hablar, Español",
  finish: "Escucha simulada: toca para terminar, Español",
  translating: "Traduciendo…, Español",
  cancel: "Cancelar, Español",
};
const B = {
  selector: "I speak: English",
  start: "Tap to speak, English",
  finish: "Simulated listening: tap to finish, English",
  wait: "Wait: the other person is speaking, English",
  stopVoice: "Stop simulated voice, English",
};

// Estado vacío: título, guía del segundo toque y aclaración DEMO, en el idioma de cada mitad.
const EMPTY = { es: "Habla y lee\nla traducción.", en: "Speak and read\nthe translation." };
const GUIDE = { es: "Toca Hablar. Toca de nuevo para terminar.", en: "Tap Speak. Tap again to finish." };
const DEMO_NOTE = { es: "Demo: sin audio ni traducción real.", en: "Demo: no real audio or translation." };
const LOCKED = { es: "El idioma se cambia al terminar el turno.", en: "You can change the language after the turn." };
const SAME_PAIR = {
  es: "Hablar no está disponible: elige un idioma distinto para cada persona.",
  en: "Speak is unavailable: choose a different language for each person.",
};
const PENDING_PAIR = {
  es: "Hablar no está disponible: la demo solo tiene ejemplos en español e inglés; los demás idiomas están por validar.",
  en: "Speak is unavailable: the demo only has examples in Spanish and English; other languages are pending validation.",
};

type Half = ReturnType<typeof within>;

/** Ventana simulada: hasta 700 px es móvil (cara a cara); con más ancho, escritorio. */
function setViewport(width: number, height: number) {
  const window = { width, height, scale: 2, fontScale: 1 };
  Dimensions.set({ window, screen: window });
}

function uuidSequence() {
  let n = 0;
  return jest.fn(() => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  });
}

async function renderScreen(createRequestId: () => string = uuidSequence()) {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <FaceToFaceScreen createRequestId={createRequestId} />
    </SafeAreaProvider>,
  );
  return { halfA: within(screen.getByTestId("mitad-A")), halfB: within(screen.getByTestId("mitad-B")) };
}

/** Abre el selector de idioma de una persona tocando su botón «Yo hablo» / «I speak» en su mitad. */
async function openPicker(participant: "A" | "B", selector: string) {
  await fireEvent.press(within(screen.getByTestId(`mitad-${participant}`)).getByRole("button", { name: selector }));
  return within(screen.getByTestId(`selector-${participant}`));
}

async function choose(participant: "A" | "B", selector: string, option: string | RegExp) {
  const picker = await openPicker(participant, selector);
  await fireEvent.press(picker.getByRole("radio", { name: option }));
}

/** Avanza al siguiente paso simulado: micrófono listo, audio listo, resultado o fin de la voz. */
async function nextDemoStep() {
  await act(() => {
    jest.runOnlyPendingTimers();
  });
}

/** La persona habla durante `ms` antes de su segundo toque. */
async function speakFor(ms: number) {
  await act(() => {
    jest.advanceTimersByTime(ms);
  });
}

/** Turno completo de dos toques hasta que empieza la voz simulada. */
async function speakTurn(half: Half, names: { start: string; finish: string }) {
  await fireEvent.press(half.getByRole("button", { name: names.start }));
  await nextDemoStep();
  await speakFor(1500);
  await fireEvent.press(half.getByRole("button", { name: names.finish }));
  await nextDemoStep();
  await nextDemoStep();
}

beforeEach(() => {
  setViewport(393, 852);
});

afterEach(() => {
  jest.mocked(useColorScheme).mockReturnValue("light");
});

describe("FaceToFaceScreen DEMO en el móvil: cara a cara 50/50", () => {
  it("muestra el encabezado DEMO y, en cada mitad y su idioma, el título vacío, la guía del segundo toque y que no hay audio ni traducción real", async () => {
    const { halfA, halfB } = await renderScreen();
    expect(screen.getByText("Cara a cara · 50/50")).toBeOnTheScreen();
    expect(screen.getByText("DEMO")).toBeOnTheScreen();
    expect(halfA.getByText(EMPTY.es)).toBeOnTheScreen();
    expect(halfB.getByText(EMPTY.en)).toBeOnTheScreen();
    expect(halfA.getByText(GUIDE.es)).toBeOnTheScreen();
    expect(halfB.getByText(GUIDE.en)).toBeOnTheScreen();
    expect(halfA.getByText(DEMO_NOTE.es)).toBeOnTheScreen();
    expect(halfB.getByText(DEMO_NOTE.en)).toBeOnTheScreen();
  });

  it("divide el área en dos mitades iguales: B arriba con todo su panel girado 180° y A abajo derecha", async () => {
    await renderScreen();
    expect(screen.getByTestId("conversacion")).toHaveStyle({ flexDirection: "column-reverse" });
    expect(screen.getByTestId("mitad-A")).toHaveStyle({ flex: 1 });
    expect(screen.getByTestId("mitad-A")).not.toHaveStyle({ transform: [{ rotate: "180deg" }] });
    expect(screen.getByTestId("mitad-B")).toHaveStyle({ flex: 1, transform: [{ rotate: "180deg" }] });
  });

  it("el lector recorre primero los controles de A y después los de B", async () => {
    await renderScreen();
    const [first, second, third, fourth] = screen.getAllByRole("button");
    expect(first).toHaveAccessibleName(A.selector);
    expect(second).toHaveAccessibleName(A.start);
    expect(third).toHaveAccessibleName(B.selector);
    expect(fourth).toHaveAccessibleName(B.start);
  });

  it("mantiene la paleta fija marino/blanco aunque el sistema prefiera el tema oscuro", async () => {
    jest.mocked(useColorScheme).mockReturnValue("dark");
    await renderScreen();
    expect(screen.getByTestId("pantalla")).toHaveStyle({ backgroundColor: "#EEF1F6" });
    expect(screen.getByTestId("mitad-B")).toHaveStyle({ backgroundColor: "#12295C" });
    expect(screen.getByTestId("mitad-A")).toHaveStyle({ backgroundColor: "#FFFFFF" });
  });
});

describe("FaceToFaceScreen DEMO en escritorio", () => {
  beforeEach(() => {
    setViewport(1440, 900);
  });

  it("muestra por defecto dos paneles derechos lado a lado: B marino a la izquierda y A blanco a la derecha", async () => {
    await renderScreen();
    expect(screen.getByRole("radio", { name: "Escritorio" })).toBeChecked();
    expect(screen.getByTestId("conversacion")).toHaveStyle({ flexDirection: "row-reverse" });
    expect(screen.getByTestId("mitad-A")).not.toHaveStyle({ transform: [{ rotate: "180deg" }] });
    expect(screen.getByTestId("mitad-B")).not.toHaveStyle({ transform: [{ rotate: "180deg" }] });
    expect(screen.getByTestId("mitad-B")).toHaveStyle({ backgroundColor: "#12295C" });
    expect(screen.getByTestId("mitad-A")).toHaveStyle({ backgroundColor: "#FFFFFF" });
    expect(screen.getByText("Frases de ejemplo. Sin micrófono, audio ni traducción real.")).toBeOnTheScreen();
  });

  it("«Cara a cara» muestra la vista móvil 50/50 con B girada y «Escritorio» la devuelve", async () => {
    await renderScreen();
    await fireEvent.press(screen.getByRole("radio", { name: "Cara a cara" }));
    expect(screen.getByRole("radio", { name: "Cara a cara" })).toBeChecked();
    expect(screen.getByTestId("conversacion")).toHaveStyle({ flexDirection: "column-reverse" });
    expect(screen.getByTestId("mitad-B")).toHaveStyle({ flex: 1, transform: [{ rotate: "180deg" }] });
    expect(screen.getByTestId("mitad-A")).not.toHaveStyle({ transform: [{ rotate: "180deg" }] });

    await fireEvent.press(screen.getByRole("radio", { name: "Escritorio" }));
    expect(screen.getByTestId("conversacion")).toHaveStyle({ flexDirection: "row-reverse" });
    expect(screen.getByTestId("mitad-B")).not.toHaveStyle({ transform: [{ rotate: "180deg" }] });
  });

  it("al pasar a ancho de móvil se cierra el selector abierto y no reaparece al volver a escritorio", async () => {
    await renderScreen();
    await openPicker("A", A.selector);
    await act(() => {
      setViewport(393, 852);
    });
    expect(screen.queryByTestId("selector-A")).toBeNull();
    expect(screen.getByTestId("mitad-B")).toHaveStyle({ transform: [{ rotate: "180deg" }] });

    await act(() => {
      setViewport(1440, 900);
    });
    expect(screen.queryByTestId("selector-A")).toBeNull();
    expect(screen.getByRole("button", { name: A.selector })).toBeEnabled();
  });
});

describe("FaceToFaceScreen DEMO: selector de idioma de cada persona", () => {
  it("cada persona abre su propio selector, en su idioma, con seis idiomas y el actual marcado", async () => {
    await renderScreen();
    const pickerA = await openPicker("A", A.selector);
    expect(pickerA.getByText("Elige tu idioma")).toBeOnTheScreen();
    expect(pickerA.getByText("Persona A")).toBeOnTheScreen();
    expect(pickerA.getAllByRole("radio")).toHaveLength(6);
    expect(pickerA.getByRole("radio", { name: "Español, Demo" })).toBeChecked();
    expect(pickerA.getByRole("radio", { name: "Inglés (English), Demo" })).not.toBeChecked();
    expect(pickerA.getByRole("radio", { name: "Italiano, Por validar" })).not.toBeChecked();
    await fireEvent.press(pickerA.getByRole("button", { name: "Cerrar selector de idioma" }));

    const pickerB = await openPicker("B", B.selector);
    expect(pickerB.getByText("Choose your language")).toBeOnTheScreen();
    expect(pickerB.getByText("Person B")).toBeOnTheScreen();
    expect(pickerB.getByRole("radio", { name: "English, Demo" })).toBeChecked();
    expect(pickerB.getByRole("radio", { name: "German (Deutsch), Pending" })).not.toBeChecked();
  });

  it("busca por nombre o autónimo sin distinguir mayúsculas ni acentos y avisa si no hay resultados", async () => {
    await renderScreen();
    const picker = await openPicker("A", A.selector);
    const search = picker.getByLabelText("Buscar idioma");

    await fireEvent.changeText(search, "PORTUGUES");
    expect(picker.getAllByRole("radio")).toHaveLength(1);
    expect(picker.getByRole("radio", { name: "Portugués (Português), Por validar" })).toBeOnTheScreen();

    await fireEvent.changeText(search, "deutsch");
    expect(picker.getAllByRole("radio")).toHaveLength(1);
    expect(picker.getByRole("radio", { name: "Alemán (Deutsch), Por validar" })).toBeOnTheScreen();

    await fireEvent.changeText(search, "xyz");
    expect(picker.queryAllByRole("radio")).toHaveLength(0);
    expect(picker.getByText("No se encontraron idiomas.")).toBeOnTheScreen();

    await fireEvent.changeText(search, "");
    expect(picker.getAllByRole("radio")).toHaveLength(6);
    expect(picker.queryByText("No se encontraron idiomas.")).toBeNull();
  });

  it("el selector de B busca en inglés y también por autónimo", async () => {
    await renderScreen();
    const picker = await openPicker("B", B.selector);
    await fireEvent.changeText(picker.getByLabelText("Search language"), "espanol");
    expect(picker.getAllByRole("radio")).toHaveLength(1);
    expect(picker.getByRole("radio", { name: "Spanish (Español), Demo" })).toBeOnTheScreen();

    await fireEvent.changeText(picker.getByLabelText("Search language"), "FRENCH");
    expect(picker.getByRole("radio", { name: "French (Français), Pending" })).toBeOnTheScreen();
  });

  it("se cierra con su botón, tocando fuera o con «atrás»/Escape sin cambiar el idioma", async () => {
    const { halfA } = await renderScreen();
    const closers = [
      (picker: Half) => fireEvent.press(picker.getByRole("button", { name: "Cerrar selector de idioma" })),
      () => fireEvent(screen.getByTestId("fondo-selector"), "responderRelease"),
      () => fireEvent(screen.getByTestId("selector-A"), "requestClose"),
    ];
    for (const close of closers) {
      const picker = await openPicker("A", A.selector);
      await close(picker);
      expect(screen.queryByTestId("selector-A")).toBeNull();
      expect(halfA.getByRole("button", { name: A.selector })).toBeEnabled();
      expect(halfA.getByRole("button", { name: A.start })).toBeEnabled();
    }
  });

  it("al abrirse enfoca el buscador y al cerrarse devuelve el foco al selector que lo abrió", async () => {
    const focus = jest.spyOn(TextInput.prototype, "focus");
    const announce = jest.mocked(AccessibilityInfo.sendAccessibilityEvent);
    announce.mockClear();
    await renderScreen();
    await openPicker("A", A.selector);
    await fireEvent(screen.getByTestId("selector-A"), "show");
    expect(focus).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByRole("button", { name: "Cerrar selector de idioma" }));
    expect(announce).toHaveBeenCalledWith(expect.anything(), "focus");
    focus.mockRestore();
  });

  it("mientras está abierto, el resto de la pantalla sale del árbol accesible", async () => {
    const { halfB } = await renderScreen();
    await openPicker("A", A.selector);
    expect(screen.queryByRole("button", { name: A.start })).toBeNull();
    expect(screen.queryByRole("button", { name: B.start })).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Cerrar selector de idioma" }));
    expect(halfB.getByRole("button", { name: B.start })).toBeEnabled();
  });

  it("en el móvil el selector de B se abre girado 180° en su lado y el de A derecho", async () => {
    await renderScreen();
    await openPicker("B", B.selector);
    expect(screen.getByTestId("capa-selector")).toHaveStyle({ transform: [{ rotate: "180deg" }] });
    await fireEvent.press(screen.getByRole("button", { name: "Close language picker" }));

    await openPicker("A", A.selector);
    expect(screen.getByTestId("capa-selector")).not.toHaveStyle({ transform: [{ rotate: "180deg" }] });
  });

  it("un idioma por validar cambia solo a esa persona, bloquea los dos «Hablar» con explicación y un par válido los restaura", async () => {
    const { halfA, halfB } = await renderScreen();
    await choose("A", A.selector, /^Portugués/);
    expect(screen.queryByTestId("selector-A")).toBeNull();
    expect(halfA.getByRole("button", { name: "Yo hablo: Portugués" })).toBeEnabled();
    expect(halfB.getByRole("button", { name: B.selector })).toBeEnabled();
    expect(halfA.getByRole("button", { name: "Hablar no disponible, Portugués" })).toBeDisabled();
    expect(halfB.getByRole("button", { name: "Speak unavailable, English" })).toBeDisabled();
    expect(halfA.getByText(PENDING_PAIR.es)).toBeOnTheScreen();
    expect(halfB.getByText(PENDING_PAIR.en)).toBeOnTheScreen();

    await choose("A", "Yo hablo: Portugués", "Español, Demo");
    expect(halfA.getByRole("button", { name: A.start })).toBeEnabled();
    expect(halfB.getByRole("button", { name: B.start })).toBeEnabled();
    expect(screen.queryByText(PENDING_PAIR.es)).toBeNull();
    expect(screen.queryByText(PENDING_PAIR.en)).toBeNull();
  });
});

describe("FaceToFaceScreen DEMO: turnos simulados", () => {
  beforeEach(() => {
    // Solo se simula el tiempo; las microtareas con las que React planifica su trabajo siguen siendo reales.
    jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setImmediate", "clearImmediate"] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("A habla en español con dos toques y B recibe la traducción simulada en inglés", async () => {
    const { halfA, halfB } = await renderScreen();
    await fireEvent.press(halfA.getByRole("button", { name: A.start }));
    expect(halfA.getByRole("button", { name: "Preparando…, Español" })).toBeDisabled();

    await nextDemoStep();
    expect(halfA.getByText("Escucha simulada")).toBeOnTheScreen();
    await speakFor(1500);
    await fireEvent.press(halfA.getByRole("button", { name: A.finish }));
    expect(halfA.getByRole("button", { name: A.translating })).toBeDisabled();

    await nextDemoStep();
    await nextDemoStep();
    expect(halfB.getByText("Translation for you")).toBeOnTheScreen();
    expect(halfB.getByText("[DEMO] Hello, how are you?")).toBeOnTheScreen();
    expect(halfA.getByText("Lo que dijiste")).toBeOnTheScreen();
    expect(halfA.getByText("[DEMO] Hola, ¿cómo estás?")).toBeOnTheScreen();
    expect(halfB.getByText("Simulated voice")).toBeOnTheScreen();

    await nextDemoStep();
    expect(halfA.getByRole("button", { name: A.start })).toBeEnabled();
    expect(halfB.getByText("[DEMO] Hello, how are you?")).toBeOnTheScreen();
  });

  it("el estado vacío desaparece al llegar el turno y cada mitad marca su lectura como ejemplo simulado", async () => {
    const { halfA, halfB } = await renderScreen();
    await speakTurn(halfA, A);
    expect(halfB.getByText("[DEMO] Hello, how are you?")).toBeOnTheScreen();
    expect(screen.queryByText(EMPTY.en)).toBeNull();
    expect(screen.queryByText(EMPTY.es)).toBeNull();
    expect(halfA.getByText("Frase de ejemplo · traducción simulada")).toBeOnTheScreen();
    expect(halfB.getByText("Example phrase · simulated translation")).toBeOnTheScreen();
  });

  it("el micrófono conserva su nombre completo y muestra una etiqueta corta contenida en él según el estado", async () => {
    const { halfA, halfB } = await renderScreen();
    expect(within(halfA.getByRole("button", { name: A.start })).getByText("Hablar")).toBeOnTheScreen();
    expect(within(halfB.getByRole("button", { name: B.start })).getByText("Speak")).toBeOnTheScreen();

    await fireEvent.press(halfA.getByRole("button", { name: A.start }));
    await nextDemoStep();
    const finish = halfA.getByRole("button", { name: A.finish });
    expect(within(finish).getByText("Terminar")).toBeOnTheScreen();
    const wait = halfB.getByRole("button", { name: B.wait });
    expect(wait).toBeDisabled();
    expect(within(wait).getByText("Wait")).toBeOnTheScreen();
  });

  it("B habla en inglés y A recibe la traducción simulada en español", async () => {
    const { halfA, halfB } = await renderScreen();
    await speakTurn(halfB, B);
    expect(halfA.getByText("Traducción para ti")).toBeOnTheScreen();
    expect(halfA.getByText("[DEMO] Encantado de conocerte.")).toBeOnTheScreen();
    expect(halfB.getByText("What you said")).toBeOnTheScreen();
    expect(halfB.getByText("[DEMO] Nice to meet you.")).toBeOnTheScreen();
  });

  it("mientras A habla, el botón de B queda deshabilitado, explica por qué y no inicia nada", async () => {
    const { halfA, halfB } = await renderScreen();
    await fireEvent.press(halfA.getByRole("button", { name: A.start }));
    expect(halfB.getByRole("button", { name: B.wait })).toBeDisabled();

    await nextDemoStep();
    await fireEvent.press(halfB.getByRole("button", { name: B.wait }));
    expect(halfB.getByRole("button", { name: B.wait })).toBeDisabled();
    expect(halfA.getByRole("button", { name: A.finish })).toBeEnabled();
    expect(halfA.getByRole("button", { name: A.selector })).toBeDisabled();
  });

  it("durante PREPARING, RECORDING, PROCESSING y SPEAKING los dos selectores se bloquean con su motivo y no se abren", async () => {
    const { halfA, halfB } = await renderScreen();
    const expectLocked = async () => {
      for (const [half, name, reason] of [
        [halfA, A.selector, LOCKED.es],
        [halfB, B.selector, LOCKED.en],
      ] as const) {
        expect(half.getByRole("button", { name })).toBeDisabled();
        expect(half.getByText(reason)).toBeOnTheScreen();
        await fireEvent.press(half.getByRole("button", { name }));
      }
      expect(screen.queryByTestId("selector-A")).toBeNull();
      expect(screen.queryByTestId("selector-B")).toBeNull();
    };

    await fireEvent.press(halfA.getByRole("button", { name: A.start }));
    expect(halfA.getByText("Preparando")).toBeOnTheScreen();
    await expectLocked();
    await nextDemoStep();
    expect(halfA.getByText("Escucha simulada")).toBeOnTheScreen();
    await expectLocked();
    await speakFor(1500);
    await fireEvent.press(halfA.getByRole("button", { name: A.finish }));
    expect(halfA.getByText("Traducción simulada")).toBeOnTheScreen();
    await expectLocked();
    await nextDemoStep();
    await nextDemoStep();
    expect(halfB.getByText("Simulated voice")).toBeOnTheScreen();
    await expectLocked();

    await nextDemoStep();
    expect(halfA.getByRole("button", { name: A.selector })).toBeEnabled();
    expect(halfB.getByRole("button", { name: B.selector })).toBeEnabled();
    expect(screen.queryByText(LOCKED.es)).toBeNull();
    expect(screen.queryByText(LOCKED.en)).toBeNull();
    expect(halfB.getByText("[DEMO] Hello, how are you?")).toBeOnTheScreen();
  });

  it("el mismo idioma en las dos personas no se intercambia: bloquea «Hablar» y otro idioma lo restaura con el par nuevo", async () => {
    const { halfA, halfB } = await renderScreen();
    await choose("A", A.selector, "Inglés (English), Demo");
    expect(halfA.getByRole("button", { name: "I speak: English" })).toBeEnabled();
    expect(halfB.getByRole("button", { name: B.selector })).toBeEnabled();
    expect(halfA.getByRole("button", { name: "Speak unavailable, English" })).toBeDisabled();
    expect(halfB.getByRole("button", { name: "Speak unavailable, English" })).toBeDisabled();
    expect(halfA.getByText(SAME_PAIR.en)).toBeOnTheScreen();
    expect(halfB.getByText(SAME_PAIR.en)).toBeOnTheScreen();

    await choose("B", B.selector, "Spanish (Español), Demo");
    expect(halfB.getByRole("button", { name: "Yo hablo: Español" })).toBeEnabled();
    expect(screen.queryByText(SAME_PAIR.en)).toBeNull();
    await speakTurn(halfA, { start: B.start, finish: B.finish });
    expect(halfB.getByText("[DEMO] Encantado de conocerte.")).toBeOnTheScreen();
  });

  it("el segundo toque detiene la escucha una sola vez y no pide otro turno", async () => {
    const createRequestId = uuidSequence();
    const { halfA } = await renderScreen(createRequestId);
    await fireEvent.press(halfA.getByRole("button", { name: A.start }));
    await nextDemoStep();
    await speakFor(1500);
    await fireEvent.press(halfA.getByRole("button", { name: A.finish }));
    const translating = halfA.getByRole("button", { name: A.translating });
    await fireEvent.press(translating);
    await fireEvent.press(translating);
    expect(translating).toBeDisabled();
    expect(createRequestId).toHaveBeenCalledTimes(1);
  });

  it("cancelar durante la escucha vuelve a «listo», no deja temporizadores y permite empezar otra vez", async () => {
    const { halfA, halfB } = await renderScreen();
    await fireEvent.press(halfA.getByRole("button", { name: A.start }));
    await nextDemoStep();
    await fireEvent.press(halfA.getByRole("button", { name: A.cancel }));
    expect(halfA.getByRole("button", { name: A.start })).toBeEnabled();
    expect(jest.getTimerCount()).toBe(0);

    await fireEvent.press(halfB.getByRole("button", { name: B.start }));
    expect(halfB.getByRole("button", { name: "Getting ready…, English" })).toBeDisabled();
  });

  it("el resultado pendiente de un turno cancelado no llega al turno nuevo", async () => {
    const { halfA, halfB } = await renderScreen();
    await fireEvent.press(halfA.getByRole("button", { name: A.start }));
    await nextDemoStep();
    await speakFor(1500);
    await fireEvent.press(halfA.getByRole("button", { name: A.finish }));
    await nextDemoStep();
    await fireEvent.press(halfA.getByRole("button", { name: A.cancel }));
    expect(jest.getTimerCount()).toBe(0);

    await speakTurn(halfB, B);
    expect(halfA.getByText("[DEMO] Encantado de conocerte.")).toBeOnTheScreen();
    expect(screen.queryByText("[DEMO] Hello, how are you?")).toBeNull();
  });

  it("un doble toque rápido avisa «Muy corto» en la mitad de A y el aviso se va al empezar otro turno", async () => {
    const { halfA } = await renderScreen();
    await fireEvent.press(halfA.getByRole("button", { name: A.start }));
    await nextDemoStep();
    await fireEvent.press(halfA.getByRole("button", { name: A.finish }));
    await nextDemoStep();
    expect(halfA.getByText("Muy corto. Toca, habla y vuelve a tocar.")).toBeOnTheScreen();

    await fireEvent.press(halfA.getByRole("button", { name: A.start }));
    expect(halfA.queryByText("Muy corto. Toca, habla y vuelve a tocar.")).toBeNull();
  });

  it("la escucha simulada sigue hasta los 29,5 s y al llegar a ese límite pasa sola a traducir", async () => {
    const { halfA, halfB } = await renderScreen();
    await fireEvent.press(halfA.getByRole("button", { name: A.start }));
    await nextDemoStep();
    await speakFor(29_499);
    expect(halfA.getByRole("button", { name: A.finish })).toBeEnabled();

    await speakFor(1);
    expect(halfA.getByRole("button", { name: A.translating })).toBeDisabled();

    await nextDemoStep();
    await nextDemoStep();
    expect(halfB.getByText("[DEMO] Hello, how are you?")).toBeOnTheScreen();
  });

  it("detener la voz simulada desde la otra mitad conserva la traducción y vuelve a «listo»", async () => {
    const { halfA, halfB } = await renderScreen();
    await speakTurn(halfA, A);
    await fireEvent.press(halfB.getByRole("button", { name: B.stopVoice }));
    expect(halfA.getByRole("button", { name: "Deteniendo…, Español" })).toBeDisabled();
    expect(halfB.getByRole("button", { name: "Stopping…, English" })).toBeDisabled();

    await nextDemoStep();
    expect(halfB.getByRole("button", { name: B.start })).toBeEnabled();
    expect(halfB.getByText("[DEMO] Hello, how are you?")).toBeOnTheScreen();
  });

  it("repetir el idioma actual conserva el resultado y un cambio real borra resultado y aviso en vez de reetiquetarlos", async () => {
    const { halfA, halfB } = await renderScreen();
    await speakTurn(halfA, A);
    await nextDemoStep();
    await fireEvent.press(halfA.getByRole("button", { name: A.start }));
    await nextDemoStep();
    await fireEvent.press(halfA.getByRole("button", { name: A.finish }));
    await nextDemoStep();
    expect(halfB.getByText("[DEMO] Hello, how are you?")).toBeOnTheScreen();
    expect(halfA.getByText("Muy corto. Toca, habla y vuelve a tocar.")).toBeOnTheScreen();

    await choose("A", A.selector, "Español, Demo");
    expect(halfB.getByText("[DEMO] Hello, how are you?")).toBeOnTheScreen();

    await choose("A", A.selector, /^Portugués/);
    expect(screen.queryByText("[DEMO] Hello, how are you?")).toBeNull();
    expect(screen.queryByText(/Hola, ¿cómo estás\?/)).toBeNull();
    expect(screen.queryByText("Muy corto. Toca, habla y vuelve a tocar.")).toBeNull();
    expect(halfA.getByText(EMPTY.es)).toBeOnTheScreen();
    expect(halfB.getByText(EMPTY.en)).toBeOnTheScreen();
  });

  it("cada mitad desplaza su cuerpo de lectura con guía, aviso DEMO y avisos, y deja selector y micrófono fuera de él", async () => {
    const { halfA } = await renderScreen();
    await fireEvent.press(halfA.getByRole("button", { name: A.start }));
    await nextDemoStep();
    await fireEvent.press(halfA.getByRole("button", { name: A.finish }));
    await nextDemoStep();

    const bodyA = within(screen.getByTestId("cuerpo-A"));
    expect(bodyA.getByText(EMPTY.es)).toBeOnTheScreen();
    expect(bodyA.getByText(GUIDE.es)).toBeOnTheScreen();
    expect(bodyA.getByText(DEMO_NOTE.es)).toBeOnTheScreen();
    expect(bodyA.getByText("Muy corto. Toca, habla y vuelve a tocar.")).toBeOnTheScreen();
    expect(bodyA.queryAllByRole("button")).toHaveLength(0);
    expect(halfA.getByRole("button", { name: A.selector })).toBeEnabled();
    expect(halfA.getByRole("button", { name: A.start })).toBeEnabled();

    const bodyB = within(screen.getByTestId("cuerpo-B"));
    expect(bodyB.getByText(DEMO_NOTE.en)).toBeOnTheScreen();
    expect(bodyB.queryAllByRole("button")).toHaveLength(0);
  });

  it("en el teléfono, el estado y el motivo del bloqueo se desplazan con la lectura y «Cancelar» queda fuera del cuerpo", async () => {
    const { halfA } = await renderScreen();
    await fireEvent.press(halfA.getByRole("button", { name: A.start }));
    await nextDemoStep();

    const bodyA = within(screen.getByTestId("cuerpo-A"));
    expect(bodyA.getByText("Persona A")).toBeOnTheScreen();
    expect(bodyA.getByText("Escucha simulada")).toBeOnTheScreen();
    expect(bodyA.getByText(LOCKED.es)).toBeOnTheScreen();
    expect(bodyA.queryAllByRole("button")).toHaveLength(0);
    expect(halfA.getByRole("button", { name: A.cancel })).toBeEnabled();
    expect(halfA.getByRole("button", { name: A.finish })).toBeEnabled();
  });

  it("en escritorio no se cambia de vista durante un turno y vuelve a poder cambiarse al terminar", async () => {
    setViewport(1440, 900);
    const { halfA } = await renderScreen();
    await fireEvent.press(halfA.getByRole("button", { name: A.start }));
    expect(screen.getByRole("radio", { name: "Cara a cara" })).toBeDisabled();
    await fireEvent.press(screen.getByRole("radio", { name: "Cara a cara" }));
    expect(screen.getByTestId("conversacion")).toHaveStyle({ flexDirection: "row-reverse" });

    await nextDemoStep();
    await fireEvent.press(halfA.getByRole("button", { name: A.cancel }));
    expect(screen.getByRole("radio", { name: "Cara a cara" })).toBeEnabled();
  });

  it("al desmontar en mitad de un turno no queda ningún temporizador pendiente", async () => {
    const { halfA } = await renderScreen();
    await fireEvent.press(halfA.getByRole("button", { name: A.start }));
    await nextDemoStep();
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    await screen.unmount();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("cada turno pide un UUID nuevo y uno inválido no inicia turno y avisa en esa mitad", async () => {
    const createRequestId = jest
      .fn<string, []>()
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("no-es-un-uuid");
    const { halfA, halfB } = await renderScreen(createRequestId);
    await speakTurn(halfA, A);
    await nextDemoStep();

    await fireEvent.press(halfB.getByRole("button", { name: B.start }));
    expect(createRequestId).toHaveBeenCalledTimes(2);
    expect(halfB.getByText("Something went wrong. Try again.")).toBeOnTheScreen();
    expect(halfB.getByRole("button", { name: B.start })).toBeEnabled();
  });
});
