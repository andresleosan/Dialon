# QA visual de la pantalla DEMO (2026-10-13)

## Qué se probó y cómo

- **Componente:** el mismo `FaceToFaceScreen` de `apps/mobile`, montado con react-native-web 0.21.3 y React DOM
  19.2.3 (versiones de SDK 57) en una vista temporal de Vite 8.3.2, con `SafeAreaProvider` y `crypto.randomUUID()`
  del navegador. Es solo una vista de QA, no un producto web.
- **Navegador:** Chromium 153.0.8010.12 ya instalado, controlado con playwright-core 1.63.0, que es la versión de
  su revisión 1243. Va sin sandbox porque se ejecuta como root.
- **Servidor:** solo en `127.0.0.1:5179`; ya está detenido.
- **Aislamiento:** sin Expo CLI ni credenciales. Peticiones a fuera de `127.0.0.1`: 0. Errores y avisos de
  consola: 0.
- **Archivos:** la vista, el medidor común (`lib.mjs`), la regresión de letra ampliada y la QA completa están en
  `.tools/qa-web/`; capturas, salidas y `qa-report.json`, en `.tools/qa/` (todo fuera de Git).
- **Letra ampliada:** zoom CSS solo sobre los textos (×1,3 y ×2). Es una aproximación: no equivale a la escala de
  fuente de Android.

## Qué exige el medidor en cada estado

- Mitades fijas: B.top = 0, A.bottom = alto y cada mitad mide alto/2 (±1 px); B girada 180° completa.
- Acciones fuera de la zona desplazable, dentro de su mitad, tocables en su centro, botón ≥ 64 px y «Cancelar»
  ≥ 48 px.
- Sin solapes y sin scroll horizontal, ni de página ni dentro de la mitad.
- Cada texto, aviso y opción de idioma legible entero: se desplaza su cuerpo hasta ver el primer y el último
  carácter, también en la mitad girada de B.
- Cuerpo desplazable usable: al menos 48 px visibles.

## Resultados (0 fallos en 42 estados)

Estados medidos en cada combinación: reposo, A escuchando, turno A→B, turno B→A, aviso en B, idiomas
intercambiados y tema oscuro.

| Medida y letra | Mitades A / B | Cuerpo visible (mínimo medido) | Acciones (máximo) |
|---|---|---|---|
| 393×852, normal | 426,5 / 425,5 px | 341,5 px | 64 px |
| 393×852, ×1,3 | 426,5 / 425,5 px | 309,9 px (A escuchando) | 95,6 px |
| 393×852, ×2 | 426,5 / 425,5 px | 249,5 px (A escuchando) | 156 px |
| 360×640, normal | 320,5 / 319,5 px | 235,5 px | 64 px |
| 360×640, ×1,3 | 320,5 / 319,5 px | 203,9 px (A escuchando) | 95,6 px |
| 360×640, ×2 | 320,5 / 319,5 px | 95,5 px (A escuchando) | 204 px («Cancelar» en otra fila) |

Flujos completados en las seis combinaciones:
- turnos A→B y B→A con dos toques, también en la mitad girada;
- cancelar durante la escucha, sin traducción tardía, y reiniciar con un turno completo;
- «Too short» alcanzable con scroll en la mitad girada de B;
- cambio de idioma desde B, que reinicia sin resultados ni avisos anteriores;
- fondo oscuro `#121417`.

Con letra normal, la traducción cabe sin scroll: 1 línea a 393×852 y 2 líneas a 360×640. A ×2 en 360×640 mide 3
líneas (216 px), más que el cuerpo (201,5 px): se lee entera desplazando.

## Regresión de letra ampliada (360×640, ×1,3 y ×2)

`node .tools/qa-web/regresion-letra-grande.mjs` comprueba lo anterior en reposo, con A escuchando y cancelando, en
un turno B→A completo, con el aviso de B y al cambiar de idioma desde B.

- **Rojo, con el layout anterior:** 76 fallos. Había textos y avisos fuera de su mitad sin scroll, zona de lectura
  de 0 px, botones fuera de su mitad o que no recibían el toque, flujos sin completar a ×2 y A desplazada. Salida en
  `.tools/qa/regresion-rojo.txt`.
- **Verde:** 0 fallos. Salida en `.tools/qa/regresion-verde.txt`.

En Jest, una prueba fija el contrato: cada mitad tiene un cuerpo desplazable con aviso DEMO, idiomas, estado,
lectura y avisos, y deja las acciones fuera de él.

## Correcciones que salieron de la QA

1. **Altura de la vista web:** `#root` no era flex y la pantalla ocupaba unos 557 de 852 px. Se corrigió solo en
   la vista web (`#root { display: flex }`); no afectaba al layout nativo.
2. **360×640, A escuchando:** la zona de lectura medía 0 px. «Cancelar» pasa a la misma fila que el botón
   principal, y el estado comparte fila con el selector de idioma (baja de línea si quedan menos de 120 px).
3. **360×640, traducción de 2 líneas:** quedaba cortada en reposo. El relleno vertical de cada mitad pasa de 16 a
   12 px y el del aviso DEMO, de 8 a 4 px.
4. **Accesibilidad:** las props `accessibility*` pasan a `role`/`aria-*`. TypeScript, RNTL y la vista web
   pasan las comprobaciones; la respuesta de TalkBack en Android queda pendiente.
5. **Guion de QA:** el segundo toque del doble toque ahora se hace sobre la posición actual del botón, porque el
   botón se mueve al aparecer «Cancelar».
6. **Letra ampliada:**
   - cada mitad tiene un cuerpo desplazable propio (aviso DEMO, idiomas, estado, lectura y avisos);
   - las acciones quedan ancladas fuera del cuerpo;
   - «Cancelar» baja a otra fila cuando el botón principal tendría menos de 200 px;
   - las opciones de idioma pueden partirse en dos filas.

   No se reduce ni se oculta ningún texto y no se limita la escala de letra.

## Capturas en `.tools/qa/`

- `{393x852,360x640}-x{1,1.3,2}-{claro,oscuro,turno}.png`: reposo en claro, reposo en oscuro y turno A→B traducido.
- `{393x852,360x640}-x{1.3,2}-turno-desplazado.png`: cuerpos al final, con la traducción y «Dijiste» completos.
- `{393x852,360x640}-x{1.3,2}-aviso-B-desplazado.png`: aviso completo en la mitad girada de B.

## No verificado

Android, TalkBack, APK, toques y gesto de scroll en un dispositivo real (también en la mitad
girada), escala de fuente nativa, audio y traducción reales.

## Cómo repetirla

Desde `/root/Dialon` (la vista y los guiones son locales, en `.tools/`):

```bash
node_modules/.bin/vite --config .tools/qa-web/vite.config.mjs    # en otra terminal; escucha en 127.0.0.1:5179
export TMPDIR=$PWD/.tools/tmp XDG_CACHE_HOME=$PWD/.tools/.cache/xdg-cache XDG_CONFIG_HOME=$PWD/.tools/.cache/xdg-config
node .tools/qa-web/regresion-letra-grande.mjs   # regresión focalizada; código 1 si falla
node .tools/qa-web/qa.mjs                       # QA completa con capturas
```

Claves de la configuración:
- alias `react-native` → `react-native-web`;
- `react`, `react-native-web` y `react-native-safe-area-context` se resuelven desde `apps/mobile`;
- extensiones `.web.*` también en `optimizeDeps.rolldownOptions.resolve`.

## Exportación web real de Expo/Metro

Después de la QA anterior se añadió `pnpm build:web`: exporta `apps/mobile/App.tsx` mediante Expo 57.0.26 a
`apps/mobile/dist`, sin la vista temporal de Vite. Node 24.16.0 y pnpm 10.34.6.

- Instalación con lockfile congelado: código 0.
- Pruebas: 124 aprobadas (40 core, 66 contracts, 18 pantalla). Typecheck, lint y export: código 0.
- Bundle: 216 módulos, JavaScript de 397 KB, `index.html` y `metadata.json`.
- Comprobación del export en el mismo Chromium: 360×640 y 393×852, texto normal en claro y ×2 en oscuro.
- Cinco estados por combinación: reposo, A escuchando, A traducido con el UUID real de `expo-crypto`,
  cancelación/reinicio y traducción de B, e idiomas intercambiados. Total: 20 estados, 0 fallos.
- Las mitades, scroll, rotación de B y acciones pasan el mismo medidor. Peticiones externas y problemas de
  consola: 0.
- Servidor temporal en `127.0.0.1:5180`, detenido al terminar. Navegador cerrado.
- Evidencias locales: `.tools/qa/final-web-*.txt`, `.tools/qa/final-web-checks.json` y
  `.tools/qa/production/report.json`; guion en `.tools/qa-production/smoke.mjs`. Todo queda fuera de Git.

La auditoría tras añadir el runtime web conserva los mismos cuatro avisos documentados (2 altos y 2 moderados,
0 críticos; 841 dependencias). No se hizo despliegue en Cloudflare. Audio y traducción continúan simulados.
