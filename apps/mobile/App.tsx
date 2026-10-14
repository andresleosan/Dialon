import { randomUUID } from "expo-crypto";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { LocalAudio } from "./src/audio/capture";
import { webAudioCapture } from "./src/audio/webCapture";
import { webAudioPlayer } from "./src/audio/webPlayer";
import { FaceToFaceScreen } from "./src/screens/FaceToFaceScreen";

// Solo el navegador graba y reproduce audio local; en nativo sigue la DEMO simulada hasta tener su adaptador.
const audio: LocalAudio | undefined =
  Platform.OS === "web" ? { capture: webAudioCapture, player: webAudioPlayer } : undefined;

export default function App() {
  return (
    <SafeAreaProvider>
      <FaceToFaceScreen createRequestId={randomUUID} audio={audio} />
    </SafeAreaProvider>
  );
}
