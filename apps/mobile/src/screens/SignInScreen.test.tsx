import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { Dimensions } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AUTH } from "../copy";
import { SignInScreen, type SignInScreenProps } from "./SignInScreen";

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };

function setViewport(width: number, height: number) {
  const window = { width, height, scale: 2, fontScale: 1 };
  Dimensions.set({ window, screen: window });
}

async function show(props: Partial<SignInScreenProps> = {}) {
  const handlers = { onGoogle: jest.fn(), onDemo: jest.fn(), onRetry: jest.fn() };
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SignInScreen googleDisabled={false} demoDisabled={false} {...handlers} onRetry={undefined} {...props} />
    </SafeAreaProvider>,
  );
  return handlers;
}

describe.each([
  ["teléfono", 393, 852],
  ["escritorio", 1720, 1023],
])("SignInScreen en %s", (_name, width, height) => {
  beforeEach(() => {
    setViewport(width, height);
  });

  it("el ejemplo es una ilustración estática etiquetada «Ejemplo», con la frase y su traducción, sin controles ni micrófono", async () => {
    await show();
    // Grupo con nombre (en web, <div role="group" aria-label>), sin `accessible`: el lector sigue leyendo cada frase.
    const example = screen.getByLabelText("Ejemplo de conversación");
    expect(example).toHaveProp("role", "group");
    const preview = within(example);
    expect(preview.getByText("Ejemplo")).toBeOnTheScreen();
    expect(preview.getByText("Hola, ¿cómo estás?")).toBeOnTheScreen();
    expect(preview.getByText("Hello, how are you?")).toBeOnTheScreen();
    expect(preview.queryAllByRole("button")).toHaveLength(0);
    expect(preview.queryByText(/micr[oó]fono|grabando|traduciendo/i)).toBeNull();
  });

  it("la nota de honestidad aparece una sola vez y fuera del ejemplo", async () => {
    await show();
    expect(screen.getAllByText(AUTH.note)).toHaveLength(1);
    const example = within(screen.getByLabelText("Ejemplo de conversación"));
    expect(example.queryByText(AUTH.note)).toBeNull();
  });

  it("los botones conservan sus nombres y llaman a su acción; Reintentar solo aparece si hay que reintentar", async () => {
    const handlers = await show();
    await fireEvent.press(screen.getByRole("button", { name: "Continuar con Google" }));
    await fireEvent.press(screen.getByRole("button", { name: "Probar demo local" }));
    expect(handlers.onGoogle).toHaveBeenCalledTimes(1);
    expect(handlers.onDemo).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();

    const onRetry = jest.fn();
    await show({ onRetry });
    await fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("con las acciones deshabilitadas no llama a nada; el estado se anuncia con educación y el aviso como alerta", async () => {
    const handlers = await show({
      googleDisabled: true,
      demoDisabled: true,
      status: "Abriendo Google…",
      alert: "Sin conexión con Google. Revisa tu red y vuelve a intentarlo.",
    });
    const google = screen.getByRole("button", { name: "Continuar con Google" });
    const demo = screen.getByRole("button", { name: "Probar demo local" });
    expect(google).toBeDisabled();
    expect(demo).toBeDisabled();
    await fireEvent.press(google);
    await fireEvent.press(demo);
    expect(handlers.onGoogle).not.toHaveBeenCalled();
    expect(handlers.onDemo).not.toHaveBeenCalled();
    expect(screen.getByText("Abriendo Google…")).toHaveProp("aria-live", "polite");
    expect(screen.getByRole("alert")).toHaveTextContent("Sin conexión con Google. Revisa tu red y vuelve a intentarlo.");
  });
});
