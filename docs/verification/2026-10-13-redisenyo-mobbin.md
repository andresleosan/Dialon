# Rediseño visual DEMO con referencias Mobbin — 2026-10-13

Esta evidencia corresponde al rediseño preparado para revisión, antes del commit y push posteriores.
Base local y origin/main comprobados: `8ac378860dc970a4ac65bf59d0f0a24898c2993d`.
Los dos documentos originales conservan sus hashes; dependencias, contratos y controlador no cambian.

## Producción y referencias

`https://dialon.pages.dev/` abrió en Chromium 153.0.8010.12 del VPS: HTTP 200, título Dialon,
dos mitades, cero errores o avisos de consola. Se capturó móvil 393×852 y escritorio 1440×900,
con letra normal, ×1,3 y ×2, antes de editar.

El servidor Mobbin estaba conectado en Claude, pero sus herramientas no estaban disponibles en esa
sesión restringida. Se obtuvieron las referencias con el conector Mobbin del chat, se inspeccionaron
sus imágenes y se descargaron en `.tools/referencias/mobbin-2026-10-13/`. Claude confirmó haber
revisado las tres imágenes. Se ejecutó Claude Opus 5.5 con esfuerzo máximo.

- [Singapore Airlines — Translation Assistant](https://mobbin.com/screens/9975067b-7c96-4cc3-af87-3ac651cd8c7f): dos paneles de lectura y frase destacada.
- [Meta AI — Live translation](https://mobbin.com/screens/55a61904-5362-4e9a-b67d-f64d5a976d96): idiomas subordinados y una acción principal clara.
- [CapCut — Video translator](https://mobbin.com/screens/81cf3e13-fc99-4b28-8bbe-4a11584205fc): superficies delimitadas y jerarquía en oscuro.

## Cambio y comprobación final

Claude modificó `DESIGN.md`, `apps/mobile/src/theme.ts` y
`apps/mobile/src/screens/FaceToFaceScreen.tsx`: tarjeta de lectura, nota DEMO subordinada,
selector segmentado con selección tonal y ✓, acciones jerarquizadas y columna centrada de 760 px.
Se conserva 50/50, giro completo de B, cuerpo desplazable propio y acciones fuera del scroll.
La comprobación del foco encontró 1,15:1 en oscuro; se ajustó su color al acento del tema.

- Pruebas: **124 aprobadas** (40 core, 66 contracts, 18 pantalla).
- Typecheck, lint y `pnpm build:web`: código **0**.
- Export real Expo/Metro: `apps/mobile/dist`, 192 módulos y bundle de 398 KB.
- Runtime: Node 24.16.0, pnpm 10.34.6; sin instalaciones adicionales.
- QA visual: **9 combinaciones, 90 estados, 0 fallos**. Viewports 360×640, 393×852 y 1440×900;
  letra normal, ×1,3 y ×2; estados en claro y oscuro.
- Flujos: A→B, B→A girada, cancelar/reiniciar, aviso Too short en B e intercambio de idiomas;
  también escucha, traducción y aviso en oscuro. UUID real de expo-crypto.
- Texto renderizado: mínimo **6,36:1**; cuerpo visible mínimo **95,5 px**; radios ≥48 px.
- Teclado: seis controles por tema, iniciar/cancelar con Enter, 0 fallos.
  Contraste mínimo del foco: **5,78:1 claro / 7,84:1 oscuro**.
- Consola: 0 errores/avisos. Peticiones externas: 0.
- Hashes del código comprobado verificados sin cambios al finalizar. Servidor temporal 5180 cerrado;
  navegadores y proceso de edición Claude cerrados.

Evidencias locales (fuera de Git): `.tools/qa/redesign/checks.json`, `test.txt`, `typecheck.txt`,
`lint.txt`, `build-web.txt`, `keyboard-before-report.json`, `keyboard-report.json`,
`after/qa-report.json` y capturas `before/` / `after/`. Los guiones están en `.tools/qa-redesign/`.
Las capturas finales de QA usan DPR 2; la comparación se refiere a viewports y tamaños CSS.

## Límites

El aumento de texto CSS es una aproximación, no la escala de Android. Android, TalkBack y APK siguen
pendientes. Micrófono, traducción y voz siguen simulados y marcados DEMO. No se tocaron Cloudflare,
Firebase, Google, servicios de producción ni credenciales. Los cuatro avisos de dependencias ya
registrados permanecen; no se modificó el lockfile. Luis autorizó posteriormente el commit y push del rediseño (2026-10-13, 05:03 UTC).
