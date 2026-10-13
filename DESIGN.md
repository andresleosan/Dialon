# Dialon — diseño Android (BORRADOR)

> **Pendiente de aprobación de Luis.** No es una marca aprobada ni se basa en referencias externas. Los colores
> son provisionales y se pueden cambiar sin tocar la lógica. Se aplica en modo DEMO en
> `apps/mobile/src/screens/FaceToFaceScreen.tsx` (QA web: `docs/verification/2026-10-13-qa-visual-demo.md`).

## Principios

1. Sobrio y legible a un metro: dos personas leen el mismo teléfono desde lados opuestos de una mesa.
2. Cada persona entiende en su idioma qué hace su botón y dónde leer la traducción.
3. Nada decorativo: cada elemento visible tiene una acción o informa del estado.
4. El color nunca es la única señal: cada estado lleva icono y texto.

## Tema y color

El tema claro u oscuro sigue la configuración del sistema. Contrastes calculados con la fórmula WCAG.

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `fondo` | `#FFFFFF` | `#121417` | fondo de pantalla |
| `superficie` | `#F3F4F6` | `#1C1F24` | fondo de cada mitad |
| `texto` | `#1B1D20` | `#E8EAED` | traducción y textos principales |
| `texto2` | `#4B5059` | `#B4B9C2` | "Dijiste: …" y estado |
| `acento` / `sobreAcento` | `#1D5BBF` / `#FFFFFF` | `#8AB4F8` / `#0A1B33` | botón "Toca para hablar" (provisional) |
| `grabando` / `sobreGrabando` | `#B42318` / `#FFFFFF` | `#F2B8B5` / `#410E0B` | botón durante la grabación |
| `contorno` | `#6B7079` | `#8C929C` | bordes de controles y foco |
| `avisoFondo` / `avisoTexto` | `#FFF4D6` / `#5C4400` | `#3A2E00` / `#FFE08A` | avisos y banner DEMO |

Mínimos medidos:
- Texto: 6.36:1 en claro y 8.18:1 en oscuro (en ambos, `sobreAcento` sobre `acento`).
- Controles frente a la superficie: 4.52:1 en claro (`contorno`) y 5.28:1 en oscuro (`contorno`).
- Objetivo: ≥4.5:1 en texto y ≥3:1 en controles.

## Tipografía y espaciado

- Fuente del sistema (Roboto en Android). Sin fuentes descargadas.
- Los tamaños escalan con el ajuste de letra de Android y no se limita esa escala: si el contenido no cabe, el
  cuerpo de cada mitad se desplaza y las acciones quedan ancladas.
- Escala (tamaño/interlineado): traducción recibida 28/36; botón 18/24 medio; idioma y estado 16/24 medio;
  "Dijiste:" y avisos 16/24.
- Rejilla de 8 dp; márgenes laterales de 16 dp y verticales de 12 dp en cada mitad (medido a 360×640); esquinas
  de 12 dp.
- Botón principal a todo el ancho y de ≥64 dp de alto. «Cancelar» comparte fila mientras el principal tenga al
  menos 200 dp; si no, baja a otra fila a todo el ancho. Ningún control mide menos de 48 dp.

## Pantalla cara a cara

```
┌────────────────────────────┐
│ (mitad de B, girada 180°)  │
│ English ▾        ✓ Ready   │
│ "Hello, how are you?"      │
│ [      Tap to speak     ]  │
├────────────────────────────┤
│ Español ▾        ✓ Listo   │
│ Dijiste: «Hola, ¿cómo      │
│ estás?»                    │
│ [   Toca para hablar    ]  │
└────────────────────────────┘
```

- Área útil dividida en dos mitades exactamente iguales. B arriba, con su bloque completo girado 180°
  (textos y controles); A abajo.
- Cada mitad, de arriba abajo según su lector:
  1. un cuerpo desplazable propio con el aviso DEMO, el idioma (selector) y el estado con icono y texto, la
     lectura (la traducción recibida en grande y "Dijiste: …" en pequeño) y los avisos de esa mitad;
  2. las acciones, ancladas fuera del cuerpo: botón principal y, cuando aplica, "Cancelar" como acción secundaria.
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

### Banner DEMO

- En modo DEMO, las dos mitades muestran siempre, en su idioma y con los colores de aviso, "DEMO: traducción
  simulada, no real" y "No usa el micrófono ni reproduce audio.". Nunca se ocultan.

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
- **Movimiento:** solo un pulso suave del indicador de grabación, que se desactiva con "Quitar animaciones".
  Los cambios de estado son inmediatos.
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
| Banner DEMO siempre visible en modo demo | pantalla | prueba de componente + revisión |
| Sin animación con "Quitar animaciones" | indicador de grabación | ajuste del sistema en dispositivo |
