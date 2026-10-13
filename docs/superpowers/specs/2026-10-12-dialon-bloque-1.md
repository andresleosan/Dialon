# Dialon — Bloque 1: cimientos y reglas de turnos

Especificación breve del primer bloque, aprobado por Luis el 2026-10-12 a las 21:33 UTC. El plan general
del MVP sigue en revisión y no forma parte de este documento.

## Objetivo

Crear la base del monorepo, los contratos compartidos y la máquina de turnos half-duplex, con pruebas, más el
borrador de diseño (`DESIGN.md`). Todo funciona sin cuentas, red, Firebase, Cloudflare ni el Mac.

## Alcance

Incluido:
- Configuración raíz: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`,
  `.gitignore`.
- `packages/contracts`: tipos, códigos de error, límites configurables y validadores.
- `packages/core/src/conversation.ts`: reglas de turnos.
- Borrador de diseño en `DESIGN.md`.

Excluido: app móvil, extensión, API, gateway, autenticación real, Firebase, Google, Cloudflare, Mac, App
Check, web, commits y push.

## Decisiones técnicas

| Decisión | Motivo |
|---|---|
| pnpm 10.34.6 instalado en `.tools/pnpm`; store y caché en `.tools/.cache` | no estaba instalado; nada global |
| `minimumReleaseAge: 10080` (7 días) en `pnpm-workspace.yaml` | margen ante paquetes comprometidos recién publicados |
| TypeScript 6.0.3 estricto (`strict`, `noUncheckedIndexedAccess`), sin `lib` DOM ni `types` globales | typescript-eslint 8.71.1 admite TypeScript `<6.1`; la 7.x quedaría fuera |
| ESLint 9.39.5 + `typescript-eslint` `strictTypeChecked` | `/root/AGENTS.md` pide ESLint 9. **El registro marca 9.39.5 como no soportada** (ver "Riesgos") |
| Vitest 5.0.3 (+ Vite 8.3.2, que Vitest exige como dependencia par) | convención del workspace |
| Paquetes internos sin compilación: `exports` apunta a `src/*.ts` | Vitest, Metro y wrangler leen TypeScript directamente |

## Contratos (`@dialon/contracts`)

- Códigos de error en dos grupos:
  - `SERVER_ERROR_CODES`: lo que puede llegar por red;
  - `CLIENT_ERROR_CODES`: micrófono, red, respuesta inválida y voz del dispositivo. El servidor no puede
    enviarlos.
- `DEFAULT_LIMITS`: audio de 0,3 a 30 s, ≤2 MiB, tipos `audio/mp4`, `audio/aac`, `audio/webm` y
  `audio/wav`, idiomas es/en y textos ≤2000 caracteres.
- `createLimits(overrides)` lanza `RangeError` si la configuración es incoherente.
- Validadores sobre `unknown`. Devuelven `{ ok: true, value }` o `{ ok: false, code, detail }`:
  - `parseTurnMeta` descarta campos ajenos (un `uid` del cliente no pasa) y normaliza el `requestId`;
  - `validateAudio` normaliza el tipo MIME y revisa tamaño y duración;
  - `parseTurnResult` y `parseApiError` validan las respuestas del servidor.
- Ningún `detail` repite el valor recibido, porque puede acabar en registros.

## Máquina de turnos (`@dialon/core`)

Estados:
`IDLE{last?, error?}` → `PREPARING` → `RECORDING_A`/`RECORDING_B` → `PROCESSING{finalizing_audio | waiting_server}` → `SPEAKING{stopping}` → `IDLE`.

Reglas cubiertas por pruebas:
- Una sola captura:
  - en `PREPARING` y `PROCESSING` se ignora cualquier toque;
  - en `RECORDING_*`, el de la otra persona;
  - en `SPEAKING`, cualquier toque solo pide detener la voz.
- El segundo toque (o `TIME_LIMIT` del mismo turno) detiene la grabación una sola vez.
- Los idiomas son una instantánea tomada al tocar. Si origen y destino son iguales, no empieza el turno.
- `RESULT` solo avanza desde `PROCESSING/waiting_server` y con el mismo `requestId`. Un resultado prematuro,
  de otro turno o posterior a cancelar se ignora.
- `FAILED` lleva a `IDLE` con el aviso en la mitad de quien hablaba y permite otro turno.
- Durante la voz, tocar o cancelar solo la detiene. Se graba de nuevo tras `SPEECH_ENDED`, y los avisos de voz
  van a quien escucha.
- `last` se conserva mientras la otra persona responde. `RESET` (cerrar sesión o desmontar) lo limpia todo.

Lo que no cubre: los efectos (grabador, red, voz), que llegarán con el controlador y `usePushToTalk`.

## Comandos

Ejecutar en el VPS, desde `/root/Dialon`.

```bash
./.tools/pnpm/node_modules/.bin/pnpm install --registry=https://registry.npmjs.org/
./.tools/pnpm/node_modules/.bin/pnpm test
./.tools/pnpm/node_modules/.bin/pnpm typecheck
./.tools/pnpm/node_modules/.bin/pnpm lint
```

## Verificación del bloque

- [x] RED → GREEN en contratos: 55 de 58 fallaban sin reglas; después pasan 58 de 58.
- [x] RED → GREEN en turnos: 20 de 20 fallaban sin reglas; después pasan 20 de 20.
- [x] RED → GREEN en "resultado prematuro durante `finalizing_audio`": 1 fallo y después en verde.
- [x] `pnpm test` → 104 de 104, exit 0. `pnpm typecheck` → exit 0. `pnpm lint` → exit 0 (8 archivos, 0 errores).
- [x] `pnpm audit` contra `https://registry.npmjs.org/` → sin vulnerabilidades conocidas.
- [ ] Nada de esto valida móvil, Google, Firebase, Cloudflare, modelos ni audio real: no se implementan aquí.

## Riesgos y notas

- ESLint 9: el registro de npm muestra `deprecated: This version is no longer supported` para `eslint@9.39.5`.
  Se mantiene por `/root/AGENTS.md`; conviene decidir si este proyecto adopta ESLint 10.
- TypeScript 7 queda bloqueado hasta que typescript-eslint lo admita.
- La skill `/antislop` sí está instalada. El documento previo `2026-10-12-adaptar-prompt-dialon.md` decía lo
  contrario y se conserva sin cambios.

## Siguiente paso (no iniciado)

Bloque 2: "Continuar con Google" en Android. Queda pendiente del Firebase de Dialon, aplazado por cuota, y de
la autorización de sus pasos.
