# Adaptación del prompt Dialon: plan de trabajo

> Para agentes: aplicar `superpowers:executing-plans` o `superpowers:subagent-driven-development` cuando se ejecute un plan de producto. Este plan documenta la preparación del prompt, no autoriza comenzar la aplicación ni realizar un despliegue.

**Goal:** entregar un prompt exportable para GPT-6.1 Sol Ultra que preserve el flujo de Dialon, use Firebase Authentication y Cloudflare, y defina una implementación y verificación realizables.

**Architecture:** un documento principal autocontenido separa instrucciones ejecutables de notas de uso y fuentes. El futuro producto compartirá contratos y lógica portable, manteniendo adaptadores móviles, MV3 y Worker separados.

**Tech Stack:** Markdown para esta entrega; React Native/Expo, React/Vite/MV3, TypeScript, Firebase Auth, Cloudflare Workers/Tunnel/VPC y modelos locales Qwen3-ASR/Ollama para la futura implementación.

**Spec:** requisitos del usuario reflejados en `PROMPT_DIALON_GPT_6_1_SOL_ULTRA.md`. El diseño visual queda pendiente porque `DESIGN.md` no existía en la carpeta local al inspeccionarla.

## Global Constraints

- La entrega actual es el prompt mejorado y la configuración local de Git. El usuario aprobó la configuración de inferencia local; no se instala ni despliega producto en esta entrega.
- Firebase se limita a Authentication; la infraestructura restante será de Cloudflare.
- Inferencia local aprobada: Qwen3-ASR-1.7B-8bit/MLX Audio y Qwen3.8-27B Q4_K_M/Ollama, comparando TranslateGemma-12B. Usar los tamaños aprobados como punto de partida y ajustar tras medir en el Mac.
- Cloudflare conecta con el equipo de inferencia mediante túnel privado; no exponer Ollama a Internet.
- Preservar split 50/50, rotación superior de 180°, dos toques y ambos sentidos de traducción.
- Diferenciar MVP por turnos de traducción continua, sin eliminar el objetivo posterior.
- No atribuir reglas a `DESIGN.md` ni afirmar pruebas de una app que aún no existe.
- No usar configuración global de Git, pedir tokens por chat, commitear o hacer push en esta entrega.

## Hardware confirmado

MacBook Pro, Apple M5 Max, 48 GB de memoria unificada. Evaluar Qwen3-ASR-1.7B-8bit/MLX Audio y Qwen3.8-27B Q4_K_M/Ollama; comparar TranslateGemma 12B. Mantener resultados de memoria y latencia pendientes de medición en el dispositivo real.

## Review Focus

1. Confundir el perfil Ultra del entorno con parámetros válidos de una API.
2. Omitir la validación de tokens Firebase en el backend Cloudflare y puente local.
3. Compartir APIs de DOM/Expo dentro de contratos portables.
4. Prometer audio nativo o MV3 real a partir de pruebas con mocks/preview.
5. Reemplazar el diseño ausente con una identidad inventada o con patrones de marketing.

## Tarea 1: establecer contexto y decisiones

**Archivos consultados:** `/root/AGENTS.md`, catálogo de skills y documentación oficial pertinente.

**Entradas:** prompt original y elección posterior de Firebase/Cloudflare.

**Resultado:** alcance explícito, supuestos y pendientes documentados.

- [x] Comprobar el estado local y la ausencia de código, Git inicial y `DESIGN.md`.
- [x] Revisar las skills solicitadas y sus aliases; buscar `/antislop` e identificar su ausencia.
- [x] Contrastar audio Expo, MV3, modelo GPT, Firebase Auth y productos Cloudflare con documentación oficial.
- [x] Solicitar la preferencia de inferencia e incorporar la elección posterior de IA local conectada mediante Cloudflare.
- [x] Contrastar Qwen3.8, Qwen3-ASR, Whisper, TranslateGemma y la conectividad privada de Workers.
- [x] Incorporar hardware confirmado: MacBook Pro M5 Max, 48 GB, y ajustar ASR al runtime MLX.
- [x] Revisar de forma independiente los requisitos técnicos del prompt.

## Tarea 2: redactar el prompt exportable

**Crear:** `PROMPT_DIALON_GPT_6_1_SOL_ULTRA.md`.

**Entradas:** decisiones de la tarea 1.

**Resultado:** prompt completo delimitado por «Inicio del prompt» y «Fin del prompt».

- [x] Reorganizar objetivo, inspección, skills, stack, autenticación, interfaz, audio, pipeline y privacidad.
- [x] Añadir contratos y límites de runtime, cancelación, errores y medición de latencia.
- [x] Incluir orden de construcción y requisitos de una planificación concreta con `/writing-plans`.
- [x] Definir batería final MCP Playwright y validación nativa por separado.
- [x] Incorporar las reglas locales de Git y referencias oficiales.
- [x] Verificar formato, cobertura de requisitos y coherencia con una lectura final y una revisión independiente; corregir las dos ambigüedades menores detectadas.

## Tarea 3: dejar Git preparado

**Modificar:** configuración exclusivamente local en `.git/config`, después de inicializar el directorio vacío.

**Resultado:** identidad, origen y helper de caché comprobados; cero commits y cero pushes.

- [x] Inicializar rama `main` y configurar `andresleosan` / `andres.san1404@gmail.com`.
- [x] Neutralizar la cadena heredada de helpers localmente y configurar `cache --timeout=28800`.
- [x] Añadir `origin` con `https://github.com/andresleosan/Dialon.git`.
- [x] Verificar los campos locales específicos y la rama sin imprimir secretos.

## Tarea 4: entregar

**Resultado:** enlace al `.md`, confirmación precisa de Git y estado del requisito de diseño.

- [x] Comprobar que los documentos existen, que las cercas Markdown están equilibradas y que no contienen patrones de credenciales privadas.
- [x] Preparar los enlaces de entrega y aclarar que `DESIGN.md` sigue pendiente.

## Pendientes para la implementación futura

- Crear o recibir `DESIGN.md` y revisar sus reglas antes de implementar la interfaz.
- Validar los modelos aprobados, la compatibilidad de MLX Audio y la latencia/memoria en el Mac real.
- Implementar la aplicación, extensión y backend; configurar cuentas y puente privado con la autorización correspondiente.
- Ejecutar las pruebas finales MCP Playwright y las comprobaciones nativas cuando exista el producto.

## Validación proporcionada al cambio

Para esta entrega documental: lectura final, comprobación de estructura y revisión independiente. No corresponde ejecutar pruebas de audio o abrir una app en Playwright porque la app todavía no se ha construido. El prompt exige esas verificaciones al ejecutar la implementación futura.

Comandos locales de comprobación: `git -C /root/Dialon status --short`, consultas concretas de `git config --local`, `git -C /root/Dialon diff --check` y lectura de los Markdown creados.
