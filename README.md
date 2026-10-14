# Dialon

Traductor cara a cara por turnos: dos personas comparten un teléfono y cada una usa su mitad de la pantalla.

Estado actual: **interfaz DEMO** en `apps/mobile` (Expo SDK 57). En web, «Hablar» graba audio local real del
micrófono (getUserMedia + MediaRecorder) y se puede volver a escuchar; el audio no sale del dispositivo y no se
traduce. En nativo la escucha, la traducción y la voz siguen simuladas. No usa red, cuentas ni servicios. La extensión
de Chrome, el servidor y la inferencia real llegan en bloques posteriores.

## Estructura

| Ruta | Contenido |
|---|---|
| `packages/contracts` | Tipos, códigos de error, límites y validadores compartidos |
| `packages/core` | Máquina de turnos (reductor puro) |
| `apps/mobile` | App Expo: pantalla (`src/screens/FaceToFaceScreen.tsx`), selector de idioma (`LanguagePicker.tsx`), controlador DEMO, textos es/en, iconos y tema fijo |

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

La exportación web real se compila con Expo/Metro e incluye el favicon (`apps/mobile/assets/favicon.png` → `favicon.ico`). No hay build de Android.

## Exportación web para probar en línea

Desde la raíz: `pnpm build:web` (en el VPS: `./.tools/pnpm/node_modules/.bin/pnpm build:web`).
Salida: `apps/mobile/dist`. Usa la app real y mantiene los avisos DEMO; no requiere credenciales.
Runtime: Node 24.16.0 y pnpm 10.34.6. Parámetros de Pages: [guía de despliegue](docs/deploy/cloudflare-pages.md).

## Modo DEMO

- Marca DEMO visible (cabecera en el teléfono, pie en escritorio) y, en cada panel vacío, «Demo: sin audio ni
  traducción real.» (en web: «Graba audio en este dispositivo; la traducción aún no está disponible.»). Diseño en
  [DESIGN.md](DESIGN.md): la disposición es automática, teléfono 50/50 con B girada (también en horizontal) y
  escritorio con paneles derechos lado a lado; paleta marino/blanco fija aunque el sistema use tema oscuro.
- Dos toques: el primero inicia una escucha simulada y el segundo la termina. Después, quien habló ve su frase y la
  otra mitad la traducción de ejemplo, ambas marcadas `[DEMO]`, con el estado «voz simulada» (sin audio), que se puede
  detener.
- Cada turno usa un UUID nuevo; metadatos, duración y resultado pasan por los validadores de `@dialon/contracts`.
- Cada persona elige su idioma en su propio selector (sin intercambio). Español e inglés tienen ejemplos DEMO;
  portugués, francés, alemán e italiano están «por validar»: se pueden elegir, pero bloquean «Hablar» en las dos
  mitades con una explicación, igual que un par con el mismo idioma. Los idiomas solo cambian en reposo; un cambio
  real borra el resultado anterior.

## Verificación

- Pruebas automáticas: comandos de arriba.
- QA actual de interfaz, selector y favicon: [`docs/verification/2026-10-14-ui-selector-favicon.md`](docs/verification/2026-10-14-ui-selector-favicon.md).
- Auditoría de dependencias: [`docs/verification/2026-10-13-auditoria-dependencias.md`](docs/verification/2026-10-13-auditoria-dependencias.md).
- Pendiente: Android real, TalkBack, APK, audio y traducción reales; comprobar en Android la letra grande, el teclado
  nativo con el selector abierto (sobre todo el de B, girado) y que el foco vuelva al selector al cerrarlo.
