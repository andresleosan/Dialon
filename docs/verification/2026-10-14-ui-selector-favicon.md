# Dialon — UI aprobada, selector y favicon (2026-10-14)

Implementación en el VPS con Claude Opus 5.5, esfuerzo máximo, a partir de la maqueta aprobada por Luis a las 01:06 UTC. Resultado real revisado y commit/push autorizados por Luis el 2026-10-14 a las 02:41 UTC. La publicación requiere confirmar el SHA remoto y la página pública.

## Resultado

Panel B marino #12295C y A blanco #FFFFFF incluso con preferencia oscura; escritorio por defecto lado a lado, ambas mitades derechas, y opción explícita Cara a cara. En teléfono, área útil 50/50 con B girada 180°. Selector independiente y buscable para cada persona; es/en con ejemplos DEMO y pt/fr/de/it Por validar. Pares iguales o pendientes bloquean ambos Hablar; solo un cambio real en reposo borra el resultado previo. Durante un turno, idiomas y vista permanecen bloqueados con explicación. Ningún idioma tiene audio, modelos o traducción real conectados.

## Corrección de letra grande

La regresión web detectó selector comprimido a 33–66 px, altura de 464 px y lectura de 0 px durante grabación a texto CSS ×2. Cancelar pasa a su propia fila; estado y aviso de bloqueo pasan al cuerpo desplazable del teléfono; los controles conservan espacio y el interlineado de A/B corresponde a su fuente. No se limitaron ni redujeron las fuentes. En reposo normal las posiciones se conservan; la comparación de píxeles observó 0,13% de diferencia en móvil y 0,006% en escritorio, concentrada en suavizado de texto de insignias/fila superior.

## Verificación del export real

- Unitarias/integración: Vitest 106/106 y Jest 38/38 (144 total). Tipos, lint y export: exit 0.
- Chromium 153.0.8010.12 / Playwright 1.63.0, únicamente 127.0.0.1:5180 sobre apps/mobile/dist; sin arnés de UI.
- Revisión general: 18 combinaciones (360×640, 393×852, 1440×900; claro/oscuro; letra normal/×1,3/×2), 96 estados y 18 selectores: 0 fallos, 0 errores/avisos de consola y 0 peticiones externas.
- Regresión focal de grabación/procesamiento/voz simulada/fin/cancelación a ×2: 30 estados, 0 fallos.
- B preparándose y hablando a ×2 en teléfono y Cara a cara de escritorio: 8 estados, 0 fallos. B→A, pares iguales, selección independiente, restauración de par válido y cierres por botón/fondo comprobados.
- Selectores: búsqueda por nombre/autónimo sin tildes/mayúsculas, sin resultados, elección mediante Enter, Tab/Mayús+Tab contenidos en modal, foco inicial buscador, Escape y retorno al selector. B está girado completo en su lado.
- Controles ≥48 px; cuerpos desplazables con texto alcanzable, sin solapes ni scroll horizontal. Los controles deshabilitados no se exigen recibir hit-testing.
- Favicon original: fuente apps/mobile/assets/favicon.svg y PNG 48; Expo exporta favicon.ico válido de 16/32/48 con link HTML. Vista ampliada y tamaños reales capturados desde el ICO exportado. [Documentación Expo](https://docs.expo.dev/guides/progressive-web-apps/#favicons).

Evidencia completa en .tools/qa/proposal-real-20261014/: red.txt, green.txt, fix-*.txt, primary-qa.json, recording-regression-red.json, recording-regression.json, supplemental-flows.json, final-*.png y verified-final-source-hashes.json. Capturas comparadas con las aprobadas, sin nueva búsqueda Mobbin.

## Límites

El aumento de letra es CSS en web, no escala nativa Android. Android, TalkBack, teclado nativo con selector B girado, safe areas reales y APK no están validados sin dispositivo. No se presenta este resultado como prueba de audio/inferencia real ni como branding nativo/splash. Las dependencias y contratos permanecen sin cambios.

## Publicación y rollback

Release: interfaz responsive marino/blanco, selector independiente y buscable, control de pares iguales/pendientes y favicon web; corrección de grabación con texto ampliado. No incluye migraciones, modelos ni infraestructura.

Base publicada anterior: `78189eb1a42060a3a1c2014f28edb72fcd7d23fd`. Si se aprueba revertir esta entrega, usar `git revert` sobre el commit «Add responsive conversation UI, language picker and favicon» y un push normal a main; no reset ni force-push. Confirmar después el SHA remoto y el resultado en Pages.
