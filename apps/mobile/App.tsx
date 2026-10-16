import { randomUUID } from "expo-crypto";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { createAccountApi } from "./src/account/api";
import type { LocalAudio } from "./src/audio/capture";
import { webAudioCapture } from "./src/audio/webCapture";
import { webAudioPlayer } from "./src/audio/webPlayer";
import { firebaseAuth } from "./src/auth/firebaseAuth";
import { AuthGate } from "./src/screens/AuthGate";

// Expo sustituye `process.env.EXPO_PUBLIC_*` al compilar; aquí solo se declara su forma.
declare const process: { readonly env: { readonly EXPO_PUBLIC_DIALON_API_URL?: string } };

// Solo el navegador graba y reproduce audio local; en nativo sigue la DEMO simulada hasta tener su adaptador.
const audio: LocalAudio | undefined =
  Platform.OS === "web" ? { capture: webAudioCapture, player: webAudioPlayer } : undefined;

// Sin `EXPO_PUBLIC_DIALON_API_URL` (vacía por defecto) no hay cliente: ningún panel de cuenta ni petición al API.
const api = createAccountApi(firebaseAuth, process.env.EXPO_PUBLIC_DIALON_API_URL);

export default function App() {
  return (
    <SafeAreaProvider>
      {/* Web: sesión con Google o demo local sin cuenta. Nativo (sin proveedor): la DEMO tal cual. */}
      <AuthGate provider={firebaseAuth} createRequestId={randomUUID} audio={audio} api={api} />
    </SafeAreaProvider>
  );
}
