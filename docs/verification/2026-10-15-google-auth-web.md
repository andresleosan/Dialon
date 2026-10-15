# Verificación de Google Auth web — 2026-10-15

Implementación sin publicar sobre HEAD `84b7a9ee5aaf3e4200ca5f9c1c6e37d09caa17b9`.
La web ofrece Google mediante Firebase Authentication y conserva la demo local sin cuenta.
No se ha hecho commit, push ni despliegue.

## Comportamiento revisado

- Adaptador Firebase exclusivo de web, inicialización diferida y persistencia gestionada por el SDK.
  El código de producto solo usa los cuatro campos públicos necesarios para Auth.
- Apertura de Google desde la pulsación del usuario, cancelación silenciosa y errores seguros.
- La sesión solo expone UID y nombre. No almacena tokens manualmente ni muestra el correo,
  credenciales o mensajes internos del proveedor.
- Las operaciones pendientes impiden pulsaciones duplicadas. Los identificadores de operación
  descartan resultados antiguos tras desmontar, cambiar de cuenta o reintentar.
- Entrar o salir desmonta la conversación y libera grabación, micrófono, reproducción y URL de audio.
  Cambiar de UID empieza una conversación nueva; renovar el mismo usuario conserva la actual.
- La demo nativa sigue funcionando sin cargar Firebase Auth. No se añadieron endpoints de backend.

La revisión independiente no encontró defectos críticos ni importantes. Su única observación menor
era que la especificación decía «Salir» en teléfono: se corrigió para reflejar «Cerrar sesión»,
comprobado en la captura móvil.

## Pruebas y compilación

Todas las comprobaciones finales terminaron con código 0:

| Comprobación | Resultado |
| --- | --- |
| Pruebas Vitest de packages | 106 pasan |
| Pruebas Jest de apps/mobile | 138 pasan |
| Total | 244 pasan |
| TypeScript | Pasa |
| ESLint | Pasa, sin avisos |
| Exportación web Expo | Pasa |
| git diff --check | Pasa |

Las pruebas del adaptador usan un SDK simulado; no autentican cuentas.
Se añadió una regresión que primero falló al reintentar después de un error de suscripción
con una ventana de Google pendiente. El reintento ahora invalida la operación anterior y restablece
el estado ocupado antes de volver a suscribirse. La regresión y la suite final pasan.

El JavaScript principal exportado mide aproximadamente 744 KB frente a 446 KB anteriores.
Los archivos de captura, reproducción, medidor, onda y estado de conversación, además de
`packages/core/src/conversation.ts` y los contratos compartidos, permanecen sin cambios.

## Navegador en el VPS

Chromium 153 de Playwright ya instalado, sin usar la interfaz local del ordenador.
Las solicitudes externas se bloquearon durante estas comprobaciones.

**19 casos pasan** con el componente real AuthGate, identidad de prueba y los adaptadores reales
de audio web; el micrófono usa una señal de prueba del navegador. Cubren:

- Pantalla inicial en escritorio y teléfono de 360 × 640 con texto al 200 %, sin desbordamiento.
- Recuperación desde el estado de comprobación y desde errores de suscripción.
- Igualdad exacta de geometría, colores y giro de las dos mitades respecto de la referencia anterior,
  tanto en demo como con identidad de prueba: 1440 × 900, 393 × 852 y 852 × 393.
- Cancelación, ventana bloqueada y error de red emulados por el proveedor de prueba.
- Reintento con una operación de Google antigua todavía pendiente.
- Entrada desde la demo mientras se graba, salida mientras se graba o reproduce, revocación de URL,
  cierre externo de sesión y recuperación después de un fallo al salir.
- Renovación del mismo usuario, cambio de cuenta y rechazo de errores antiguos.
- Proveedor nativo ausente: la demo permanece disponible.

No se observaron errores de ejecución en los 19 casos.

Además, la **exportación de producción con el SDK Firebase real** pasa dos comprobaciones:
1. Inicializa Auth, habilita Google y permite entrar en la demo, sin peticiones externas al cargar.
2. Al pulsar Google con la descarga de `apis.google.com/js/api.js` bloqueada deliberadamente,
   muestra un error seguro y recuperable. El único error de consola es el bloqueo esperado.

La segunda comprobación valida el fallo de carga del SDK de Google; no valida una ventana
real bloqueada ni un inicio de sesión real.

## Dependencias

Firebase 13.0.0 queda fijado solo en apps/mobile y se instaló sin ejecutar scripts.
Se conserva `minimumReleaseAge: 10080`.

La auditoría inicial detectó dos avisos nuevos de gRPC, instalado transitivamente por Firestore
aunque la aplicación solo usa Auth. Un override limitado a
`@firebase/firestore>@grpc/grpc-js: 1.13.6` los elimina.

La auditoría final conserva los **cuatro avisos preexistentes** de la referencia:
dos altos y dos moderados, en cadenas de Expo/React Native (node-forge, braces, uuid y sprintf-js).
Su código de salida es 1: no es una auditoría limpia y no introduce avisos nuevos.

## Evidencias y límites

Las salidas, regresión RED/GREEN, JSON del navegador y capturas originales están en
`.tools/qa/firebase-20261015/` del VPS. Ese directorio es evidencia local ignorada por Git.

Capturas: pantalla inicial del export real, fallo controlado del SDK real, demo en escritorio,
cuenta de prueba en móvil, salida, ventana bloqueada emulada y texto grande.
Las capturas con cuenta usan una identidad sintética y no acreditan autenticación con Google.

En Firebase se comprobó Google habilitado y el conjunto de dominios autorizados:
localhost, dialonapp.firebaseapp.com, dialonapp.web.app y dialon.pages.dev.
La app web existente se llama DialonApp y no está enlazada a Hosting.

Quedan pendientes:
- Que una persona complete el inicio real de Google desde un origen autorizado.
- Google en Android y pruebas en dispositivo.
- Verificación de tokens en un backend protegido cuando se implemente.
  No se ha añadido un endpoint que confíe en la identidad del cliente.
- Publicación y comprobación en dialon.pages.dev, que requieren un despliegue posterior.
