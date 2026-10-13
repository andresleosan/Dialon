# Dialon

Traductor cara a cara por turnos: dos personas comparten un teléfono y cada una usa su mitad de la pantalla.

Estado actual: **interfaz DEMO** en `apps/mobile` (Expo SDK 57). La escucha, la traducción y la voz son simuladas:
no usa micrófono ni audio, red, cuentas ni servicios. La extensión de Chrome, el servidor y la inferencia real
llegan en bloques posteriores.

## Estructura

| Ruta | Contenido |
|---|---|
| `packages/contracts` | Tipos, códigos de error, límites y validadores compartidos |
| `packages/core` | Máquina de turnos (reductor puro) |
| `apps/mobile` | App Expo: `src/screens/FaceToFaceScreen.tsx`, controlador DEMO, textos es/en y tema |

## Ejecutar las comprobaciones

Requisito: Node 24. pnpm vive dentro del proyecto, en `.tools/` (fuera de Git), igual que su store y las cachés.
Desde `/root/Dialon`:

```bash
# Solo la primera vez: pnpm local del proyecto
npm install pnpm@10.34.6 --prefix .tools/pnpm --cache .tools/.cache/npm --ignore-scripts --registry=https://registry.npmjs.org/
./.tools/pnpm/node_modules/.bin/pnpm install --registry=https://registry.npmjs.org/
./.tools/pnpm/node_modules/.bin/pnpm test       # Vitest (contracts, core) + Jest (pantalla)
./.tools/pnpm/node_modules/.bin/pnpm typecheck  # TypeScript estricto en los tres paquetes
./.tools/pnpm/node_modules/.bin/pnpm lint       # ESLint 10 + reglas de React Hooks
```

La exportación web real se compila con Expo/Metro. No hay build de Android.

## Exportación web para probar en línea

Desde la raíz: `pnpm build:web` (en el VPS: `./.tools/pnpm/node_modules/.bin/pnpm build:web`).
Salida: `apps/mobile/dist`. Usa la app real y mantiene los avisos DEMO; no requiere credenciales.
Runtime: Node 24.16.0 y pnpm 10.34.6. Parámetros de Pages: [guía de despliegue](docs/deploy/cloudflare-pages.md).

## Modo DEMO

- Las dos mitades muestran siempre «DEMO: traducción simulada, no real» y que no usa micrófono ni reproduce audio.
- Dos toques: el primero inicia una escucha simulada y el segundo la termina. Después aparece en la otra mitad una
  frase de ejemplo marcada `[DEMO]` y se muestra el estado «voz simulada» (sin audio), que se puede detener.
- Cada turno usa un UUID nuevo; metadatos, duración y resultado pasan por los validadores de `@dialon/contracts`.
- Cambiar el idioma en reposo intercambia los idiomas de las dos mitades y borra el resultado anterior.

## Verificación

- Pruebas automáticas: comandos de arriba.
- QA visual en navegador: [`docs/verification/2026-10-13-qa-visual-demo.md`](docs/verification/2026-10-13-qa-visual-demo.md).
- Auditoría de dependencias: [`docs/verification/2026-10-13-auditoria-dependencias.md`](docs/verification/2026-10-13-auditoria-dependencias.md).
- Pendiente: Android real, TalkBack, APK, audio y traducción reales; comprobar en Android la letra grande
  (en la vista web, con zoom de texto ×1,3 y ×2, cada mitad desplaza su cuerpo y mantiene las acciones ancladas).
