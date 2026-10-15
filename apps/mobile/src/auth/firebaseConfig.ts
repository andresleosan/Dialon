// Configuración PÚBLICA de cliente de Firebase Authentication (proyecto `dialonapp`, app web DialonApp). No son
// secretos: identifican el proyecto ante Firebase y viajan en el bundle web. Solo los campos que usa Authentication:
// sin `measurementId` (Analytics), `storageBucket` ni `messagingSenderId`.
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDFpePUacOadh9VGeE4QSRwaq8e_CsXLg8",
  authDomain: "dialonapp.firebaseapp.com",
  projectId: "dialonapp",
  appId: "1:342335620102:web:6d1be56483ef986454af87",
} as const;
