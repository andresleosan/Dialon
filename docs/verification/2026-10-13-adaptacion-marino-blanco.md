# Adaptación marino/blanco para revisión — 2026-10-13

Base local y origin/main comprobados: `68bfb5c9a7a7a1a5b7b7c3f945dc71d17ae8b4cf`.
Esta evidencia corresponde a la versión preparada para revisión. Luis aprobó su commit y publicación el 2026-10-14 a las 00:11 UTC. No se modificó la configuración de Cloudflare ni infraestructura.

Se inspeccionó la imagen real de [Singapore Airlines Translation Assistant](https://mobbin.com/screens/9975067b-7c96-4cc3-af87-3ac651cd8c7f), ya disponible en `.tools/referencias/mobbin-2026-10-13/`.
La captura indicada por Luis está en Library: `libfile_58198da1c8a881918e710327093563c2`.
Claude Opus 5.5, esfuerzo max, revisó la imagen e implementó pantalla, paneles, textos y dos pruebas nuevas.
No hubo búsquedas, instalaciones ni credenciales MCP nuevas. La sesión de edición quedó cerrada.

## Resultado

B es marino `#12295C` con texto blanco; A es blanca con texto marino. En oscuro B pasa a `#0E2149`
y A a `#121417`. Sin tarjetas de lectura ni botones anchos: texto principal 32/40, selector de texto
discreto y círculo de micrófono/parada de 64 px, con etiqueta visible corta y nombre accesible completo.
El estado vacío se compactó a «Tu traducción» / «Your translation» con la guía completa en 14/20.
Se mantienen 50/50, giro de B 180°, A primero en el árbol, cuerpos desplazables y acciones fuera.
DEMO y ausencia de audio siguen explícitos. Reducer, controlador, contratos, dependencias y documentos
originales conservados.

## Evidencia final

- Pruebas: **126 aprobadas** (40 core, 66 contracts, 20 pantalla).
- Typecheck, lint y export Expo: **código 0**; Node 24.16.0, pnpm 10.34.6.
- Build: `pnpm build:web`, salida `apps/mobile/dist`, 214 módulos, bundle 399 KB.
- QA: **9 combinaciones / 90 estados / 0 fallos**: 360×640, 393×852, 1440×900;
  letra normal, ×1,3 y ×2; turnos, cancelación, aviso, idiomas y estados en claro/oscuro.
- Texto renderizado: mínimo **7,50:1**. Cuerpo visible: mínimo **178 px**.
- Control circular de 64 px comprobado visible y tocable; radios/Cancelar ≥48 px.
- Teclado: seis controles por tema, iniciar/cancelar con Enter, **0 fallos**;
  contraste mínimo del foco **14,02:1 claro / 14,31:1 oscuro**.
- Consola y peticiones externas: **0**. Código validado comprobado por hashes sin cambios al finalizar.
- Servidor temporal 5180 y navegadores cerrados.

Registros y capturas: `.tools/qa/singapore/`; guiones: `.tools/qa-singapore/`, fuera de Git.
Antes: capturas de la versión publicada, HTTP 200 y sin consola, más las capturas Library del commit base.
Después: capturas del export verificado a DPR 2. Los aumentos de texto son CSS, no escala nativa Android.
Android, TalkBack y APK siguen pendientes. Micrófono, traducción y voz siguen simulados; no hay Google,
audio real ni modelos nuevos. Los cuatro avisos de dependencias anteriores permanecen sin cambios.

## Publicación y rollback

El release adopta paneles marino/blanco y controles circulares, conservando la DEMO. No incluye migraciones
ni cambios de datos. La base anterior validada es `68bfb5c9a7a7a1a5b7b7c3f945dc71d17ae8b4cf`.
Si la publicación presentara un fallo, el rollback propuesto es revertir únicamente el commit titulado
«Adopt navy and white conversation panels» con `git revert` y hacer un push normal a main, previa autorización
del operador. No usar reset ni force-push. El push y su despliegue solo se darán por confirmados al verificar
el SHA remoto, la nueva apariencia en Pages y un turno DEMO en navegador.
