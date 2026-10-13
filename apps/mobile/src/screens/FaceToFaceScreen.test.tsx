import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { FaceToFaceScreen } from "./FaceToFaceScreen";

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 24, left: 0, right: 0, bottom: 16 },
};

// Nombres accesibles: acción e idioma de cada mitad (A empieza en español y B en inglés).
const A = {
  start: "Toca para hablar, Español",
  finish: "Escucha simulada: toca para terminar, Español",
  translating: "Traduciendo…, Español",
  cancel: "Cancelar, Español",
};
const B = {
  start: "Tap to speak, English",
  finish: "Simulated listening: tap to finish, English",
  wait: "Wait: the other person is speaking, English",
  stopVoice: "Stop simulated voice, English",
};

// Guía inicial y aclaración fija: el DEMO no usa micrófono ni reproduce audio.
const GUIDE = {
  es: "Conversación de ejemplo: toca el botón y verás una frase traducida en la otra mitad.",
  en: "Example conversation: tap the button to see a translated phrase on the other half.",
};
const NO_AUDIO = {
  es: "No usa el micrófono ni reproduce audio.",
  en: "It doesn't use the microphone or play audio.",
};

type Half = ReturnType<typeof within>;

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

describe("FaceToFaceScreen DEMO: disposición, idiomas y tema", () => {
  afterEach(() => {
    jest.mocked(useColorScheme).mockReturnValue("light");
  });

  it("muestra desde el inicio en las dos mitades el aviso DEMO, que no hay audio y la guía de ejemplo, cada una en su idioma", async () => {
    const { halfA, halfB } = await renderScreen();
    expect(halfA.getByText("DEMO: traducción simulada, no real")).toBeOnTheScreen();
    expect(halfB.getByText("DEMO: simulated translation, not real")).toBeOnTheScreen();
    expect(halfA.getByText(NO_AUDIO.es)).toBeOnTheScreen();
    expect(halfB.getByText(NO_AUDIO.en)).toBeOnTheScreen();
    expect(halfA.getByText(GUIDE.es)).toBeOnTheScreen();
    expect(halfB.getByText(GUIDE.en)).toBeOnTheScreen();
  });

  it("divide el área en dos mitades iguales: B arriba con todo su bloque girado 180° y A abajo", async () => {
    await renderScreen();
    expect(screen.getByTestId("cara-a-cara")).toHaveStyle({ flexDirection: "column-reverse", backgroundColor: "#FFFFFF" });
    expect(screen.getByTestId("mitad-A")).toHaveStyle({ flex: 1 });
    expect(screen.getByTestId("mitad-A")).not.toHaveStyle({ transform: [{ rotate: "180deg" }] });
    expect(screen.getByTestId("mitad-B")).toHaveStyle({ flex: 1, transform: [{ rotate: "180deg" }] });
  });

  it("el lector recorre primero la mitad de A y después la de B", async () => {
    await renderScreen();
    const [first, second] = screen.getAllByRole("button");
    expect(first).toHaveAccessibleName(A.start);
    expect(second).toHaveAccessibleName(B.start);
  });

  it("elegir English en la mitad de A intercambia los idiomas de las dos mitades", async () => {
    const { halfA, halfB } = await renderScreen();
    await fireEvent.press(halfA.getByRole("radio", { name: "English" }));
    expect(halfA.getByRole("radio", { name: "English" })).toBeChecked();
    expect(halfB.getByRole("radio", { name: "Español" })).toBeChecked();
    expect(halfA.getByRole("button", { name: B.start })).toBeEnabled();
    expect(halfB.getByRole("button", { name: A.start })).toBeEnabled();
    expect(halfA.getByText("DEMO: simulated translation, not real")).toBeOnTheScreen();
    expect(halfB.getByText("DEMO: traducción simulada, no real")).toBeOnTheScreen();
    expect(halfA.getByText(NO_AUDIO.en)).toBeOnTheScreen();
    expect(halfB.getByText(NO_AUDIO.es)).toBeOnTheScreen();
  });

  it("sigue el tema oscuro del sistema con los tokens de DESIGN.md", async () => {
    jest.mocked(useColorScheme).mockReturnValue("dark");
    const { halfA } = await renderScreen();
    expect(screen.getByTestId("cara-a-cara")).toHaveStyle({ backgroundColor: "#121417" });
    expect(screen.getByTestId("mitad-A")).toHaveStyle({ backgroundColor: "#1C1F24" });
    expect(halfA.getByRole("button", { name: A.start })).toHaveStyle({ backgroundColor: "#8AB4F8" });
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
    expect(halfB.getByText("[DEMO] Hello, how are you?")).toBeOnTheScreen();
    expect(halfA.getByText("Dijiste: [DEMO] Hola, ¿cómo estás?")).toBeOnTheScreen();
    expect(halfB.getByText("Simulated voice")).toBeOnTheScreen();

    await nextDemoStep();
    expect(halfA.getByRole("button", { name: A.start })).toBeEnabled();
    expect(halfB.getByText("[DEMO] Hello, how are you?")).toBeOnTheScreen();
  });

  it("B habla en inglés y A recibe la traducción simulada en español", async () => {
    const { halfA, halfB } = await renderScreen();
    await speakTurn(halfB, B);
    expect(halfA.getByText("[DEMO] Encantado de conocerte.")).toBeOnTheScreen();
    expect(halfB.getByText("You said: [DEMO] Nice to meet you.")).toBeOnTheScreen();
  });

  it("mientras A habla, el botón de B queda deshabilitado, explica por qué y no inicia nada", async () => {
    const { halfA, halfB } = await renderScreen();
    await fireEvent.press(halfA.getByRole("button", { name: A.start }));
    expect(halfB.getByRole("button", { name: B.wait })).toBeDisabled();

    await nextDemoStep();
    await fireEvent.press(halfB.getByRole("button", { name: B.wait }));
    expect(halfB.getByRole("button", { name: B.wait })).toBeDisabled();
    expect(halfA.getByRole("button", { name: A.finish })).toBeEnabled();
    expect(halfA.getByRole("radio", { name: "English" })).toBeDisabled();
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

  it("cambiar de idioma en reposo borra el resultado y el aviso anteriores en vez de reetiquetarlos", async () => {
    const { halfA, halfB } = await renderScreen();
    await speakTurn(halfA, A);
    await nextDemoStep();
    await fireEvent.press(halfA.getByRole("button", { name: A.start }));
    await nextDemoStep();
    await fireEvent.press(halfA.getByRole("button", { name: A.finish }));
    await nextDemoStep();
    expect(halfB.getByText("[DEMO] Hello, how are you?")).toBeOnTheScreen();
    expect(halfA.getByText("Muy corto. Toca, habla y vuelve a tocar.")).toBeOnTheScreen();

    await fireEvent.press(halfA.getByRole("radio", { name: "English" }));
    expect(screen.queryByText("[DEMO] Hello, how are you?")).toBeNull();
    expect(screen.queryByText(/Hola, ¿cómo estás\?/)).toBeNull();
    expect(screen.queryByText("Too short. Tap, speak, then tap again.")).toBeNull();
    expect(halfA.getByText(GUIDE.en)).toBeOnTheScreen();
    expect(halfB.getByText(GUIDE.es)).toBeOnTheScreen();
  });

  it("cada mitad desplaza un cuerpo con aviso, idiomas, estado, lectura y avisos, y deja las acciones fuera de él", async () => {
    const { halfA } = await renderScreen();
    await fireEvent.press(halfA.getByRole("button", { name: A.start }));
    await nextDemoStep();
    await fireEvent.press(halfA.getByRole("button", { name: A.finish }));
    await nextDemoStep();

    const bodyA = within(screen.getByTestId("cuerpo-A"));
    expect(bodyA.getByText("DEMO: traducción simulada, no real")).toBeOnTheScreen();
    expect(bodyA.getByText(NO_AUDIO.es)).toBeOnTheScreen();
    expect(bodyA.getByRole("radio", { name: "English" })).toBeEnabled();
    expect(bodyA.getByText("Listo")).toBeOnTheScreen();
    expect(bodyA.getByText(GUIDE.es)).toBeOnTheScreen();
    expect(bodyA.getByText("Muy corto. Toca, habla y vuelve a tocar.")).toBeOnTheScreen();
    expect(bodyA.queryAllByRole("button")).toHaveLength(0);
    expect(halfA.getByRole("button", { name: A.start })).toBeEnabled();

    const bodyB = within(screen.getByTestId("cuerpo-B"));
    expect(bodyB.getByText("DEMO: simulated translation, not real")).toBeOnTheScreen();
    expect(bodyB.getByRole("radio", { name: "Español" })).toBeEnabled();
    expect(bodyB.queryAllByRole("button")).toHaveLength(0);
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
