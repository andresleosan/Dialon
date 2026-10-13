# Dialon — diseño Android (BORRADOR)

> **Diseño DEMO autorizado por Luis para publicación (2026-10-13); no constituye una marca final.** Los colores son provisionales
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

Dirección elegida:
- Cada mitad es un panel de lectura. Según su lector, arriba va la tarjeta de lectura con la traducción en grande
  y abajo, junto al botón, el idioma y el estado. Las dos tarjetas quedan enfrentadas en el centro de la pantalla.
- Un solo control azul por mitad: el botón principal. El idioma elegido lleva relleno tonal claro, ✓ y negrita,
  nunca el azul del botón. «Cancelar» es un botón de contorno.
- El aviso DEMO pasa a ser una nota subordinada (14/20, barra lateral de aviso) con sus dos líneas enteras.
- En escritorio, el contenido de cada mitad mide como máximo 760 px y va centrado. Las mitades siguen ocupando
  el 50 % del alto y B sigue girada 180°.

## Principios

1. Sobrio y legible a un metro: dos personas leen el mismo teléfono desde lados opuestos de una mesa.
2. Cada persona entiende en su idioma qué hace su botón y dónde leer la traducción.
3. Nada decorativo: cada elemento visible tiene una acción o informa del estado.
4. El color nunca es la única señal: cada estado lleva icono y texto.

## Tema y color

El tema claro u oscuro sigue la configuración del sistema. Contrastes calculados con la fórmula WCAG.

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `fondo` | `#FFFFFF` | `#121417` | fondo de pantalla, tarjeta de lectura, selector de idioma y «Cancelar» |
| `superficie` | `#F3F4F6` | `#1C1F24` | fondo de cada mitad |
| `texto` | `#1B1D20` | `#E8EAED` | traducción, idiomas y «Cancelar» |
| `texto2` | `#4B5059` | `#B4B9C2` | "Dijiste: …", guía, estado y 2.ª línea DEMO |
| `acento` / `sobreAcento` | `#1D5BBF` / `#FFFFFF` | `#8AB4F8` / `#0A1B33` | botón principal, único control azul (provisional) |
| `grabando` / `sobreGrabando` | `#B42318` / `#FFFFFF` | `#F2B8B5` / `#410E0B` | botón durante la escucha y ● del estado |
| `contorno` | `#6B7079` | `#8C929C` | bordes del selector, «Cancelar» y botón deshabilitado |
| `separador` | `#D5D9DF` | `#2E333A` | borde decorativo de la tarjeta de lectura |
| `seleccion` / `sobreSeleccion` | `#D8E4FA` / `#0F3A80` | `#23395D` / `#D6E3FF` | idioma elegido (relleno tonal, ✓ y negrita) |
| `avisoFondo` / `avisoTexto` | `#FFF4D6` / `#5C4400` | `#3A2E00` / `#FFE08A` | avisos; `avisoTexto` también en la 1.ª línea DEMO |
| `avisoBorde` | `#A67A00` | `#E0B341` | barra lateral de la nota DEMO |

Mínimos medidos (fórmula WCAG):
- Texto: 6.36:1 en claro y 8.18:1 en oscuro (`sobreAcento` sobre `acento`); idioma elegido 8.46:1 y 8.98:1.
- Controles frente a la mitad (`contorno` sobre `superficie`): 4.52:1 en claro y 5.28:1 en oscuro. Botón principal
  frente a la mitad: 5.78:1 y 7.84:1. Barra DEMO: 3.53:1 y 8.41:1.
- Objetivo: ≥4.5:1 en texto y ≥3:1 en controles.

## Tipografía y espaciado

- Fuente del sistema (Roboto en Android). Sin fuentes descargadas.
- Los tamaños escalan con el ajuste de letra de Android y no se limita esa escala: si el contenido no cabe, el
  cuerpo de cada mitad se desplaza y las acciones quedan ancladas.
- Escala (tamaño/interlineado): traducción recibida 28/36; botones 18/24 seminegrita (principal y «Cancelar»);
  idioma y estado 16/24 medio; "Dijiste:", guía y avisos 16/24; nota DEMO 14/20.
- Espaciado en pasos de 4, 8, 12 y 16: márgenes laterales de 16, 12 sobre el cuerpo, 8 entre bloques y relleno de
  12/16 en la tarjeta de lectura. Esquinas de 12 en controles y avisos, y de 16 en el botón principal y la tarjeta.
- Contenido de cada mitad (cuerpo y acciones): ancho máximo de 760 px, centrado; en el teléfono ocupa todo el ancho.
- Botón principal a todo el ancho y de ≥64 dp de alto. «Cancelar» comparte fila mientras el principal tenga al
  menos 200 dp; si no, baja a otra fila a todo el ancho. Ningún control mide menos de 48 dp.

## Pantalla cara a cara

```
┌─────────────────────────────────┐
│ [       Tap to speak        ]   │  ← mitad de B (todo girado 180°;
│ (✓ English | Español)  ✓ Ready  │    aquí se dibuja sin girar)
│ ▌DEMO: simulated translation…   │
│ ┌─────────────────────────────┐ │
│ │ Hello, how are you?         │ │
│ └─────────────────────────────┘ │
├─────────────────────────────────┤
│ ┌─────────────────────────────┐ │
│ │ Dijiste: Hola, ¿cómo estás? │ │  ← mitad de A
│ └─────────────────────────────┘ │
│ ▌DEMO: traducción simulada, …   │
│ (✓ Español | English)  ✓ Listo  │
│ [     Toca para hablar      ]   │
└─────────────────────────────────┘
```

- Área útil dividida en dos mitades exactamente iguales. B arriba, con su bloque completo girado 180°
  (textos y controles); A abajo.
- Cada mitad, de arriba abajo según su lector:
  1. un cuerpo desplazable propio con, en este orden:
     - la tarjeta de lectura (traducción recibida 28/36, "Dijiste: …" o la guía de ejemplo);
     - los avisos de esa mitad;
     - la nota DEMO;
     - la fila de idioma (selector segmentado) y estado (icono y texto);
  2. las acciones, ancladas fuera del cuerpo: botón principal y, cuando aplica, "Cancelar" como acción secundaria.
- Con letra normal la tarjeta crece hasta llenar el hueco libre. Con letra grande el cuerpo se desplaza y la
  tarjeta queda la primera.
- Los textos de cada mitad van en el idioma de esa persona (es/en al inicio).
- El selector solo ofrece idiomas admitidos por el servidor y con voz disponible. Cambiarlo no altera un turno
  en curso.

### Botón principal por estado

| Estado de la conversación | Mitad que habla | Otra mitad |
|---|---|---|
| Listo | "Toca para hablar" · micrófono · `acento` | igual (las dos pueden empezar) |
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

- En modo DEMO, las dos mitades muestran siempre, en su idioma, "DEMO: traducción simulada, no real" (en
  `avisoTexto` y seminegrita) y "No usa el micrófono ni reproduce audio." (en `texto2`). Las dos líneas van enteras,
  con una barra lateral `avisoBorde`, justo encima de la fila de idioma.
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
    relleno tonal, no solo por el color.
- **Estados sin depender del color:**
  - el botón deshabilitado es de contorno, sin relleno;
  - en la escucha, el botón cambia de texto y de color y aparece «Cancelar»;
  - el estado lleva icono (✓ … ● ▶ ■) y texto; el ● de la escucha propia va en `grabando`.
- **Foco de teclado (web):** se mantiene el anillo del navegador, coloreado con `acento` para distinguirlo en ambos temas. Ningún estilo lo oculta ni lo recorta. El anillo negro predeterminado medía solo 1.15:1 sobre la superficie oscura en la comprobación inicial; se exige ≥3:1 en la validación final.
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
| Un solo control azul por mitad; idioma elegido tonal con ✓ | selector y botones | revisión visual en la QA web |
| Ancho máximo de 760 px centrado, sin cambiar el 50/50 ni el giro de B | cuerpo y acciones | QA web a 1440×900 |
| Sin animación con "Quitar animaciones" | indicador de grabación | ajuste del sistema en dispositivo |
