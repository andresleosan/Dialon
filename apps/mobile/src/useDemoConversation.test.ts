import { act, renderHook } from "@testing-library/react-native";
import { useDemoConversation } from "./useDemoConversation";

function uuidSequence() {
  let n = 0;
  return jest.fn(() => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  });
}

async function nextDemoStep() {
  await act(() => {
    jest.runOnlyPendingTimers();
  });
}

describe("useDemoConversation: idioma de cada persona", () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setImmediate", "clearImmediate"] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("cambiar el idioma de una persona no toca el de la otra; un par igual o por validar se marca y uno válido lo limpia", async () => {
    const { result } = await renderHook(() => useDemoConversation(uuidSequence()));
    expect(result.current.pairIssue).toBeUndefined();

    await act(() => {
      result.current.selectLanguage("A", "en");
    });
    expect(result.current.languages).toEqual({ A: "en", B: "en" });
    expect(result.current.pairIssue).toBe("same");

    await act(() => {
      result.current.selectLanguage("B", "pt");
    });
    expect(result.current.languages).toEqual({ A: "en", B: "pt" });
    expect(result.current.pairIssue).toBe("pending");

    await act(() => {
      result.current.selectLanguage("B", "es");
    });
    expect(result.current.languages).toEqual({ A: "en", B: "es" });
    expect(result.current.pairIssue).toBeUndefined();
  });

  it("con un par bloqueado, tocar Hablar no inicia turno ni pide UUID", async () => {
    const createRequestId = uuidSequence();
    const { result } = await renderHook(() => useDemoConversation(createRequestId));
    await act(() => {
      result.current.selectLanguage("A", "fr");
    });
    await act(() => {
      result.current.press("A");
    });
    expect(result.current.state).toEqual({ status: "IDLE" });
    expect(createRequestId).not.toHaveBeenCalled();
  });

  it("durante PREPARING, RECORDING, PROCESSING y SPEAKING ignora cambios de idioma sin tocar idiomas ni estado", async () => {
    const { result } = await renderHook(() => useDemoConversation(uuidSequence()));
    const tryToChange = async () => {
      const before = result.current.state;
      await act(() => {
        result.current.selectLanguage("A", "pt");
        result.current.selectLanguage("B", "es");
      });
      expect(result.current.languages).toEqual({ A: "es", B: "en" });
      expect(result.current.state).toBe(before);
    };

    await act(() => {
      result.current.press("A");
    });
    expect(result.current.state.status).toBe("PREPARING");
    await tryToChange();
    await nextDemoStep();
    expect(result.current.state.status).toBe("RECORDING_A");
    await tryToChange();
    await act(() => {
      jest.advanceTimersByTime(1500);
    });
    await act(() => {
      result.current.press("A");
    });
    expect(result.current.state.status).toBe("PROCESSING");
    await tryToChange();
    await nextDemoStep();
    await nextDemoStep();
    expect(result.current.state.status).toBe("SPEAKING");
    await tryToChange();

    await nextDemoStep();
    expect(result.current.state).toMatchObject({ status: "IDLE", last: { participant: "A" } });
  });

  it("repetir el idioma actual conserva el último resultado y solo un cambio real lo borra", async () => {
    const { result } = await renderHook(() => useDemoConversation(uuidSequence()));
    await act(() => {
      result.current.press("B");
    });
    await nextDemoStep();
    await act(() => {
      jest.advanceTimersByTime(1500);
    });
    await act(() => {
      result.current.press("B");
    });
    await nextDemoStep();
    await nextDemoStep();
    await nextDemoStep();
    expect(result.current.state).toMatchObject({ status: "IDLE", last: { participant: "B" } });

    await act(() => {
      result.current.selectLanguage("B", "en");
    });
    expect(result.current.state).toMatchObject({ status: "IDLE", last: { participant: "B" } });

    await act(() => {
      result.current.selectLanguage("B", "it");
    });
    expect(result.current.languages).toEqual({ A: "es", B: "it" });
    expect(result.current.state).toEqual({ status: "IDLE" });
  });
});
