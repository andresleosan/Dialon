# Dialon — diseño Android (BORRADOR)

> **Adaptación marino/blanco autorizada por Luis para publicación el 2026-10-14 a las 00:11 UTC; no constituye una marca final.** Los colores son provisionales
> y se pueden cambiar sin tocar la lógica. Se aplica en modo DEMO en `apps/mobile/src/theme.ts` y
> `apps/mobile/src/screens/FaceToFaceScreen.tsx` (QA web anterior: `docs/verification/2026-10-13-qa-visual-demo.md`).

## Referencias y dirección visual (propuesta, 2026-10-13)

Tres pantallas reales de Mobbin, obtenidas con el conector Mobbin del chat. Se toman patrones de jerarquía y
estructura; no se copian recursos, colores de marca ni textos. Capturas locales en
`.tools/referencias/mobbin-2026-10-13/` (fuera de Git).

| App | Pantalla | Patrón que se adopta |
|---|---|---|
| Singapore Airlines | [Translation Assistant](https://mobbin.com/screens/9975067b-7c96-4cc3-af87-3ac651cd8c7f) | dos paneles de lectura; la frase es el elemento grande; idioma y acción juntos al pie del panel |
| Meta AI | [Live translation](https://mobbin.com/screens/55a61904-5362-4e9a-b67d-f64d5a976d96) | lectura tranquila; idiomas subordinados; un único control azul claramente principal |
| CapCut | [Video translator](https://mobbin.com/screens/81cf3e13-fc99-4b28-8bbe-4a11584205fc) | oscuro con superficies delimitadas; etiqueta secundaria frente a valor principal; botón principal de alto contraste |

Dirección elegida (2026-10-13, pedida por Luis; sustituye a la de tarjetas y botones anchos): adaptación de
Singapore Airlines Translation Assistant, sin su marca ni su navegación.
- B, arriba, es un panel azul marino pleno con texto blanco. A, abajo, es un panel blanco con texto marino. En
  oscuro, B sigue marino y A pasa a `#121417` con texto azul claro.
- Sin tarjetas: la traducción, o el título del estado vacío, es el texto grande protagonista (32/40) arriba del
  panel según su lector.
- Al pie de cada panel van el idioma y el micrófono juntos:
  - selector discreto de texto (✓ y negrita en el elegido);
  - control principal circular de 64 dp con un icono geométrico hecho con vistas (micrófono, cuadrado de parar o
    puntos de espera);
  - etiqueta corta visible al lado; el nombre accesible completo no cambia.
- La nota DEMO y la de audio siguen enteras en el cuerpo, en 14/20, sin dominar. «Cancelar» es un botón de contorno
  discreto.
- En escritorio el contenido mide como máximo 760 px y va centrado. 50/50, B girada 180° y A primero en el árbol.

## Principios

1. Sobrio y legible a un metro: dos personas leen el mismo teléfono desde lados opuestos de una mesa.
2. Cada persona entiende en su idioma qué hace su botón y dónde leer la traducción.
3. Nada decorativo: cada elemento visible tiene una acción o informa del estado.
4. El color nunca es la única señal: cada estado lleva icono y texto.

## Tema y color

El tema claro u oscuro sigue la configuración del sistema. Contrastes calculados con la fórmula WCAG.

Fondo de pantalla (`pantalla`): `#FFFFFF` en claro y `#121417` en oscuro. Cada mitad tiene su propio panel:

| Token del panel | B claro | A claro | B oscuro | A oscuro | Uso |
|---|---|---|---|---|---|
| `fondo` | `#12295C` | `#FFFFFF` | `#0E2149` | `#121417` | fondo de la mitad |
| `texto` | `#FFFFFF` | `#12295C` | `#FFFFFF` | `#D6E3FF` | traducción, título vacío e idioma elegido |
| `texto2` | `#C9D4EA` | `#4B5568` | `#C2CDE6` | `#B4B9C2` | guía, "Dijiste", estado, nota de audio, etiqueta |
| `borde` | `#AFC0E0` | `#6B7089` | `#A3B4D8` | `#8C929C` | contorno de «Cancelar» y del círculo deshabilitado |
| `circulo` / `sobreCirculo` | `#FFFFFF` / `#12295C` | `#12295C` / `#FFFFFF` | `#E8EEFB` / `#0E2149` | `#8AB4F8` / `#0A1B33` | micrófono y su icono |
| `grabando` / `sobreGrabando` | `#FFB4AB` / `#5F1411` | `#B42318` / `#FFFFFF` | `#FFB4AB` / `#5F1411` | `#F2B8B5` / `#410E0B` | círculo durante la escucha |
| `demo` | `#FFD98A` | `#6B4E00` | `#FFD98A` | `#FFE08A` | línea "DEMO: …" |
| `avisoFondo` / `avisoTexto` | `#FFE8A3` / `#3D2E00` | `#FFF4D6` / `#5C4400` | `#3A2E00` / `#FFE08A` | `#3A2E00` / `#FFE08A` | avisos |

Mínimos medidos (fórmula WCAG):
- Texto: 7.50:1 en claro y 9.37:1 en oscuro.
- Controles e iconos frente a su fondo: 4.88:1 en claro y 5.89:1 en oscuro.
- Objetivo: ≥4.5:1 en texto y ≥3:1 en controles.

## Tipografía y espaciado

- Fuente del sistema (Roboto en Android). Sin fuentes descargadas.
- Los tamaños escalan con el ajuste de letra de Android y no se limita esa escala: si el contenido no cabe, el
  cuerpo de cada mitad se desplaza y las acciones quedan ancladas.
- Escala (tamaño/interlineado): traducción recibida y título vacío 32/40; etiqueta del micrófono y «Cancelar» 18/24
  seminegrita; idioma y estado 16/24; "Dijiste:", guía y avisos 16/24; nota DEMO 14/20.
- Espaciado en pasos de 4, 8, 12 y 16: márgenes laterales de 24 en el cuerpo y 16 en las acciones, 12 entre bloques.
- Contenido de cada mitad (cuerpo y acciones): ancho máximo de 760 px, centrado; en el teléfono ocupa todo el ancho.
- Micrófono: círculo de 64 dp y botón (círculo + etiqueta) de ≥64 dp de alto, alineado al final de la fila.
  «Cancelar» (≥48 dp) va al principio de la fila y, si no cabe, baja a otra. Ningún control mide menos de 48 dp.

## Pantalla cara a cara

```
┌─────────────────────────────────┐  ← mitad de B: marino, texto blanco
│ Hello, how are you?             │    (todo girado 180°; aquí sin girar)
│ DEMO: simulated translation, …  │
│ ✓ English   Español    ✓ Ready  │
│             Tap to speak  (🎙)  │
├─────────────────────────────────┤  ← mitad de A: blanca, texto marino
│ Conversación de ejemplo         │
│ Toca el botón y verás …         │
│ DEMO: traducción simulada, …    │
│ ✓ Español   English    ✓ Listo  │
│         Toca para hablar  (🎙)  │
└─────────────────────────────────┘
```

- Área útil dividida en dos mitades exactamente iguales. B arriba, con su bloque completo girado 180°
  (textos y controles); A abajo.
- Cada mitad, de arriba abajo según su lector:
  1. un cuerpo desplazable propio con, en este orden:
     - la lectura: traducción recibida 32/40, "Dijiste: …" o el estado vacío (título 32/40 y guía);
     - los avisos de esa mitad;
     - la nota DEMO;
     - la fila de idioma (selector de texto) y estado (icono y texto), al pie del cuerpo;
  2. las acciones, ancladas fuera del cuerpo: "Cancelar" cuando aplica y el micrófono circular con su etiqueta.
- Con letra normal la lectura ocupa el hueco libre y deja idioma y micrófono juntos al pie. Con letra grande el
  cuerpo se desplaza y la lectura queda la primera.
- Los textos de cada mitad van en el idioma de esa persona (es/en al inicio).
- El selector solo ofrece idiomas admitidos por el servidor y con voz disponible. Cambiarlo no altera un turno
  en curso.

### Botón principal por estado

| Estado de la conversación | Mitad que habla | Otra mitad |
|---|---|---|
| Listo | "Toca para hablar" · círculo `circulo` con micrófono | igual (las dos pueden empezar) |
| Preparando el micrófono | "Preparando…" · deshabilitado | "Espera: habla la otra persona" · deshabilitado |
| Grabando | "Grabando… toca para terminar" · `grabando` + "Cancelar" | "Espera: habla la otra persona" · deshabilitado |
| Traduciendo | "Traduciendo…" · deshabilitado + "Cancelar" | "Espera: habla la otra persona" · deshabilitado |
| Hablando (voz) | "Detener voz" | "Detener voz" |
| Deteniendo la voz | "Deteniendo…" · deshabilitado | "Deteniendo…" · deshabilitado |

### Avisos

- Cada aviso aparece en la mitad que indica la máquina de estados: el error de grabación o de servidor, en
  quien habla; "sin voz", en quien escucha.
- Lleva icono, texto breve y, si existe, la acción que lo resuelve. Desaparece al empezar el siguiente turno.

| Código | Español | English |
|---|---|---|
| `MIC_PERMISSION_DENIED` | Dialon necesita el micrófono. Actívalo en Ajustes. | Dialon needs the microphone. Turn it on in Settings. |
| `TOO_SHORT` | Muy corto. Toca, habla y vuelve a tocar. | Too short. Tap, speak, then tap again. |
| `NO_SPEECH` | No se oyó nada. Inténtalo de nuevo. | Nothing was heard. Try again. |
| `SERVICE_UNAVAILABLE` | El traductor no está disponible ahora. | The translator isn't available right now. |
| `NETWORK` | Sin conexión. Revisa tu red. | No connection. Check your network. |
| `VOICE_UNAVAILABLE` | No hay voz para este idioma: lee la traducción. | No voice for this language: read the translation. |

### Nota DEMO

- En modo DEMO, las dos mitades muestran siempre, en su idioma, "DEMO: traducción simulada, no real" (en `demo` y
  seminegrita) y "No usa el micrófono ni reproduce audio." (en `texto2`). Las dos líneas van enteras, en 14/20,
  justo encima de la fila de idioma.
- Nunca se ocultan: están en el cuerpo de cada mitad, visibles o alcanzables desplazándolo. Cada traducción
  simulada lleva además el prefijo [DEMO].

## Pantalla de entrada (bloque posterior)

- "Dialon" en texto, sin logo.
- Botón "Continuar con Google" según las pautas oficiales de Google, que se verificarán al implementarlo.
- "Usar correo" cuando exista. Errores en lenguaje llano.
- Firebase de Dialon está aplazado: mientras tanto cualquier acceso de prueba se marca DEMO.

## Accesibilidad y movimiento

- **TalkBack:**
  - Orden A (abajo) → B (arriba): el árbol de vistas es `[A, B]` y se dibuja con `column-reverse`.
  - Cada botón tiene un nombre con acción e idioma ("Hablar en español").
  - Un botón deshabilitado explica por qué ("Espera: habla la otra persona").
  - La traducción nueva se anuncia en una región viva educada (`polite`).
  - Cada opción del selector de idioma se nombra solo con el idioma. La elegida se distingue por ✓, negrita y
    subrayado, no solo por el color.
  - El micrófono conserva el nombre completo ("Toca para hablar, Español"); su etiqueta visible corta está
    contenida en ese nombre.
- **Estados sin depender del color:**
  - el círculo deshabilitado es de contorno, sin relleno, con tres puntos;
  - en la escucha, el icono pasa de micrófono a cuadrado de parar, cambian etiqueta y color y aparece «Cancelar»;
  - el estado lleva icono (✓ … ● ▶ ■) y texto.
- **Foco de teclado (web):** se mantiene el anillo del navegador, coloreado con el `texto` de cada panel para
  distinguirlo en ambos temas. Ningún estilo lo oculta ni lo recorta; se exige ≥3:1 en la validación final.
- **Movimiento:** esta DEMO no añade animaciones. Los cambios de estado son inmediatos.
- **Orientación:** vertical. Hay que comprobar en el dispositivo que los toques en la mitad girada caen en su
  control.

## Matriz regla → componente → verificación

| Regla | Componente | Verificación prevista |
|---|---|---|
| Mitades iguales; B girada 180° completa | `FaceToFaceScreen` | prueba de componente (alturas iguales) + revisión en Android |
| Estado con icono y texto, no solo color | botón principal | prueba de componente por estado |
| Botón ajeno deshabilitado con explicación | botón principal | prueba de estado accesible + TalkBack |
| Textos de cada mitad en su idioma | `FaceToFaceScreen` | prueba por idioma |
| Contraste ≥4.5:1 / ≥3:1 | tokens | recálculo al cambiar cualquier color |
| Escala de letra del sistema sin recortes | cuerpo desplazable y acciones ancladas | regresión web ×1,3/×2 + Android con letra máxima |
| Orden A → B en el lector | pantalla | TalkBack en dispositivo |
| Nota DEMO entera en las dos mitades, visible o alcanzable | cuerpo desplazable | prueba de componente + QA web |
| B marino y A blanca; micrófono circular con etiqueta corta y nombre completo | paneles y acciones | prueba de componente + QA web |
| Ancho máximo de 760 px centrado, sin cambiar el 50/50 ni el giro de B | cuerpo y acciones | QA web a 1440×900 |
| Sin animación con "Quitar animaciones" | indicador de grabación | ajuste del sistema en dispositivo |

El estado vacío usa «Tu traducción» / «Your translation» como título, con la guía completa en 14/20. Las etiquetas principales visibles se acortan a «Hablar», «Terminar», «Detener» / «Speak», «Finish», «Stop»; sus nombres accesibles completos permanecen. Esto mantiene el estado inicial compacto a 360×640 sin reducir el texto protagonista ni limitar la escala de fuente.
