import type { AuthSessionProvider } from "./session";

// Nativo: sin inicio de sesión todavía. Google en Android necesita su propio adaptador (paquete nativo, app Android
// registrada y huellas SHA); hasta entonces la app nativa es la DEMO y Firebase no entra en su bundle. En web, Metro
// usa `firebaseAuth.web.ts`.
export const firebaseAuth: AuthSessionProvider | undefined = undefined;
