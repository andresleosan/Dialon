# Dialon — diseño (BORRADOR)

> **Maqueta marino/blanco aprobada por Luis el 2026-10-14 a las 01:06 UTC** («ahora sí me gusta»); no constituye una
> marca final. Implementada en modo DEMO en `apps/mobile/src/` (`theme.ts`, `copy.ts`, `icons.tsx`,
> `screens/FaceToFaceScreen.tsx`, `screens/LanguagePicker.tsx`). Sustituye a las reglas anteriores de este documento
> (tema oscuro del sistema, radios es/en, intercambio automático de idiomas y escritorio con B girada).

## Referencias

Patrones de jerarquía tomados de pantallas de Mobbin verificadas el 2026-10-13 (sin copiar recursos, colores de marca
ni textos; capturas locales en `.tools/referencias/mobbin-2026-10-13/`, fuera de Git):
[Singapore Airlines Translation Assistant](https://mobbin.com/screens/9975067b-7c96-4cc3-af87-3ac651cd8c7f),
[Meta AI Live translation](https://mobbin.com/screens/55a61904-5362-4e9a-b67d-f64d5a976d96) y
[CapCut Video translator](https://mobbin.com/screens/81cf3e13-fc99-4b28-8bbe-4a11584205fc). La marca «Dialon» y su
icono de barras son propios de la maqueta.

## Principios

1. Sobrio y legible a un metro: dos personas leen el mismo teléfono desde lados opuestos de una mesa.
2. Cada persona entiende en su idioma qué hace su botón y dónde leer la traducción.
3. Nada decorativo: cada elemento visible tiene una acción o informa del estado.
4. El color nunca es la única señal: cada estado lleva icono, forma o texto.
5. Honestidad DEMO: «DEMO» visible, resultados con prefijo `[DEMO]` y ningún idioma finge traducción real.

## Color

Paleta fija: **no sigue el tema oscuro del sistema ni del navegador** (la app no lee `useColorScheme`). Fondo
`#EEF1F6`; panel marino `#12295C` con texto blanco y panel blanco `#FFFFFF` con borde `#DCE2EB` y texto marino. En el
teléfono B es marino y A blanca; en escritorio, al revés: A marino a la izquierda y B blanca a la derecha.

| Token del panel | Marino | Blanco | Uso |
|---|---|---|---|
| `fondo` / `texto` | `#12295C` / `#FFFFFF` | `#FFFFFF` / `#12295C` | panel, frase, persona, estado |
| `ceja` | `#BFCDE7` | `#657594` | «Tu traducción», «Lo que dijiste»… |
| `nota` | `#C2CEE4` | `#62718C` | guía, nota de ejemplo, motivo de bloqueo |
| `selectorFondo` / `selectorBorde` | blanco 7 % / blanco 19 % | `#F1F4F9` / `#DCE3EF` | botón «Yo hablo» |
| `circulo` / `sobreCirculo` | `#FFFFFF` / `#12295C` | `#12295C` / `#FFFFFF` | micrófono |
| `apagado` | `#AFC0E0` | `#6B7089` | círculo de contorno deshabilitado, «Cancelar» |
| `grabando` / `sobreGrabando` | `#FFB4AB` / `#5F1411` | `#B42318` / `#FFFFFF` | escucha simulada |
| `avisoFondo` / `avisoTexto` | `#FFE8A3` / `#3D2E00` | `#FFF4D6` / `#5C4400` | avisos de error |

Cinco grises pequeños de la maqueta se oscurecieron lo mínimo para llegar a 4,5:1 (p. ej. `#637086` → `#606D82`,
autónimos `#73809A` → `#626D83`). Mínimos medidos con la fórmula WCAG: **texto 4,61:1, iconos 4,61:1, foco 12,39:1**
(detalle en `.tools/qa/proposal-real-20261014/contrast.txt`). Cambiar un color exige recalcularlo.

## Tipografía y espaciado

- Fuente del sistema, sin fuentes descargadas. No se limita el escalado de letra: si el contenido no cabe, el cuerpo
  de lectura de cada panel se desplaza y los controles quedan anclados.
- Teléfono: cabecera de 52; paneles con márgenes de 8, radio 17 y relleno 22/20/18; título vacío 29/35,
  frase recibida 30/35, cejas 9 y guía 12/18; selector de 216×58 y micrófono de 60.
- Teléfono en horizontal: mismas mitades 50/50 con medidas compactas (relleno 10/20/8, título vacío 20/25, selector
  de alto 48 y micrófono de 48), «Cancelar» junto al micrófono y los controles dentro del cuerpo desplazable.
- Escritorio: lienzo de 1320 como máximo con márgenes de 32, cabecera de 88; paneles iguales de 620×552 a
  1440×900, separación 16, radio 22 y relleno 32; frase 42/50, título vacío 34/41, cejas 11; selector de 170×60 y
  micrófono de 64.
- Ningún control mide menos de 48 dp: el cierre del selector dibuja un círculo de 32 dentro de una zona de 48.

## Disposiciones

```
Teléfono (cara a cara 50/50)            Escritorio
┌───────────────────────────────────┐   ┌────────────────────────────────────────────┐
│ Dialon  Cara a cara · 50/50  DEMO │   │ Dialon                             DEMO    │
├───────────────────────────────────┤   │ Conversación                               │
│ B marino, girada 180°             │   │ [ A marino, derecha ] [ B blanca, derecha ]│
├───────────────────────────────────┤   │ DEMO  Audio local en este navegador…       │
│ A blanca, derecha                 │   └────────────────────────────────────────────┘
└───────────────────────────────────┘
```

- **Teléfono:** área útil en dos mitades exactamente iguales; B arriba con todo su panel girado 180° y A abajo.
- **Escritorio:** dos paneles iguales lado a lado, ambos derechos: A marino a la izquierda y B blanca a la derecha.
  Solo cambia el aspecto: cada persona conserva su idioma, sus textos y sus controles. Pie discreto:
  «DEMO · Audio local en este navegador. Sin traducción real todavía.».
- **Sin selector manual:** la disposición se elige sola y nunca solo por el ancho. Nativo: teléfono. Web: teléfono si
  el navegador se declara móvil o, sin pista, si es táctil (`pointer: coarse`) con el lado corto ≤700; si no,
  escritorio, aunque se estreche la ventana. Un teléfono en horizontal sigue siendo cara a cara.
- A va primero en el árbol accesible en todas las disposiciones.
- Al girar o redimensionar, el turno sigue intacto (el estado vive por encima de la disposición) y un selector
  abierto se cierra en vez de quedar donde ya no está su botón.

## Panel de cada persona

1. Arriba: insignia con la letra, «PERSONA A» / «PERSON B» y el estado con icono (✓ Listo, ● Escucha simulada…). En
   el teléfono esta fila es el inicio del cuerpo desplazable (misma posición a escala 1);
   así, con letra grande, no le quita alto a la lectura.
2. Cuerpo de lectura desplazable:
   - vacío: ceja «Tu traducción», título «Habla y lee / la traducción.», guía «Toca Hablar. Toca de nuevo para
     terminar.» y «Demo: sin audio ni traducción real.»;
   - tras un turno: quien habló ve «Lo que dijiste» + su transcripción; quien recibe ve «Traducción para ti» + la
     traducción (región viva educada); ambas con prefijo `[DEMO]` y la nota «Frase de ejemplo · traducción simulada»;
   - debajo, si aplica, la explicación del par bloqueado y los avisos.
3. Controles anclados fuera del cuerpo, tras una línea: selector «Yo hablo / Español ⌄» y el micrófono circular con
   su etiqueta corta debajo. Durante el turno propio aparece «Cancelar»: en escritorio entre selector y micrófono; en
   el teléfono, en su propia fila encima, para que el micrófono no se mueva entre los dos toques ni comprima el
   selector. El selector bloqueado pierde la flecha (no se puede abrir). En escritorio, a la izquierda, «Una
   conversación, un turno a la vez.»; durante un turno ese hueco dice «El idioma se cambia al terminar el turno.»; en
   el teléfono ese motivo va al pie del cuerpo desplazable.

Los textos de cada panel van en el idioma de su persona (es/en). Un idioma por validar no tiene textos propios: su
panel sigue en el idioma de interfaz inicial de esa persona (A español, B inglés), igual que en la maqueta.

### Botón principal por estado

| Estado | Mitad que habla | Otra mitad |
|---|---|---|
| Listo | «Hablar» · círculo relleno con micrófono | igual |
| Par bloqueado | «Hablar» · contorno con micrófono, deshabilitado («Hablar no disponible») | igual |
| Preparando | «Preparando…» · contorno con tres puntos | «Espera» · contorno, deshabilitado |
| Escucha simulada | «Terminar» · `grabando` con cuadrado + «Cancelar» | «Espera» · deshabilitado |
| Traduciendo | «Traduciendo…» · deshabilitado + «Cancelar» | «Espera» · deshabilitado |
| Voz simulada | «Detener» · cuadrado | «Detener» |
| Deteniendo | «Deteniendo…» · deshabilitado | igual |

El nombre accesible completo incluye acción e idioma («Toca para hablar, Español») y contiene la etiqueta visible.

### Avisos

Aparecen en la mitad que indica la máquina de estados, con «!» y texto, y desaparecen al empezar otro turno.

| Código | Español | English |
|---|---|---|
| `MIC_PERMISSION_DENIED` | Web: Permite el micrófono en el navegador para grabar. | Web: Allow the microphone in your browser to record. |
| `TOO_SHORT` | Muy corto. Toca, habla y vuelve a tocar. | Too short. Tap, speak, then tap again. |
| `NO_SPEECH` | No se oyó nada. Inténtalo de nuevo. | Nothing was heard. Try again. |
| `SERVICE_UNAVAILABLE` | El traductor no está disponible ahora. | The translator isn't available right now. |
| `NETWORK` | Sin conexión. Revisa tu red. | No connection. Check your network. |
| `VOICE_UNAVAILABLE` | No hay voz para este idioma: lee la traducción. | No voice for this language: read the translation. |

## Idiomas y selector

- Catálogo: es Español, en Inglés/English (etiqueta «Demo»); pt Portugués/Português, fr Francés/Français,
  de Alemán/Deutsch, it Italiano (etiqueta «Por validar»). No hay traducción real ni servicios conectados;
  `DEFAULT_LIMITS` y los validadores de `@dialon/contracts` siguen admitiendo solo es/en.
- Cada persona tiene su propio selector y elegir no cambia el idioma de la otra (sin intercambio automático).
- Par igual o con un idioma por validar: los dos «Hablar» se bloquean y cada panel lo explica en su idioma
  («Hablar no está disponible: elige un idioma distinto para cada persona.» / «…la demo solo tiene ejemplos en
  español e inglés; los demás idiomas están por validar.»). Elegir un par válido los restaura.
- Solo se cambia en reposo: durante preparar, escuchar, traducir o la voz, los selectores están deshabilitados con su
  motivo visible y no tocan idiomas ni estado. Repetir el idioma actual conserva el último resultado; un cambio real lo
  borra para no mostrarlo bajo otro par.
- Selector: hoja inferior en el teléfono y ventana flotante de 382 encima de su botón en escritorio. Cabecera
  «PERSONA A» + «Elige tu idioma» + cerrar; buscador que ignora mayúsculas y tildes y busca por nombre y autónimo
  («No se encontraron idiomas.» si no hay resultados); opciones de ≥48 con ✓ y fondo en la actual; nota final sobre
  la demo.
- **B en cara a cara:** el selector entero (fondo, búsqueda, opciones y cierre) gira 180° y aparece en su lado; los
  toques caen en el control girado. El de A va derecho.
- Modal real: foco inicial en el buscador; en web, Tab/Mayús+Tab quedan atrapados y Escape cierra (react-native-web),
  y al cerrar el foco vuelve al selector; en Android cierra «atrás». También cierran el botón y tocar fuera. Mientras
  está abierto, el resto de la pantalla sale del árbol accesible. Se cierra solo si cambia la disposición o empieza
  un turno.

## Accesibilidad y movimiento

- Foco de teclado visible: anillo del navegador coloreado con el texto de cada superficie (blanco sobre el panel
  marino; marino sobre el panel blanco, el fondo y el selector); el buscador marca el foco con un borde marino de 2 px.
- Botones deshabilitados con explicación: «Espera: habla la otra persona», «Hablar no disponible» + texto del motivo.
- Sin animaciones. Orientación vertical en el teléfono.
- Pendiente con dispositivo: TalkBack (orden, foco al cerrar el selector), teclado nativo con el selector abierto
  (sobre todo el de B, girado) y toques en la mitad girada en Android.

## Matriz regla → componente → verificación

| Regla | Componente | Verificación |
|---|---|---|
| Paleta fija marino/blanco aunque el sistema pida oscuro | `theme.ts` | prueba de componente + QA web en tema oscuro |
| Teléfono: mitades iguales, B girada 180°, A primero | `FaceToFaceScreen` | prueba de componente + QA web 360×640 y 393×852 |
| Disposición automática sin selector: escritorio derecho (A marino izquierda, B blanca derecha); teléfono 50/50 con B girada también en horizontal | `FaceToFaceScreen` | pruebas de componente (escritorio, redimensionar, vertical/horizontal, pistas web) + QA web 1440×900 |
| Selector por persona, buscable, cierre por botón/fondo/atrás/Escape | `LanguagePicker` | pruebas de componente + QA de foco web |
| Sin intercambio; par igual o por validar bloquea los dos «Hablar» | `useDemoConversation` | pruebas del controlador y de pantalla |
| Idiomas congelados durante el turno | `useDemoConversation` + selectores | pruebas por fase (preparar, escuchar, traducir, voz) |
| Selector de B girado en su lado | `LanguagePicker` | prueba de componente + QA web + Android pendiente |
| Contraste ≥4,5:1 texto y ≥3:1 iconos/foco | tokens | `contrast-final.mjs` al cambiar un color |
| Letra ampliada sin recortes | cuerpo desplazable y controles anclados | QA web ×1,3/×2 + Android pendiente |
