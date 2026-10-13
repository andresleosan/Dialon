import { randomUUID } from "expo-crypto";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { FaceToFaceScreen } from "./src/screens/FaceToFaceScreen";

export default function App() {
  return (
    <SafeAreaProvider>
      <FaceToFaceScreen createRequestId={randomUUID} />
    </SafeAreaProvider>
  );
}
