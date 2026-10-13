# Auditoría de dependencias y exposición efectiva (2026-10-13)

Revisión del Bloque 2: registro oficial npm por HTTPS, advisories oficiales y código instalado de los dependientes.
Auditoría inicial: salida 1; 840 dependencias; 2 avisos altos, 2 moderados, 0 críticos.
Informes locales: `.tools/qa/audit-report.json` y `.tools/qa/dependency-metadata-review.json`.

| Paquete instalado | Severidad | Ruta auditada | Corrección publicada y compatibilidad |
|---|---|---|---|
| `node-forge@1.4.0` | alta | `expo > @expo/cli > node-forge` | npm latest 1.4.0; sin parche publicado indicado |
| `braces@3.0.3` | alta | `@react-native/jest-preset > babel-jest > @jest/transform > micromatch > braces` | npm latest 3.0.3; sin parche publicado indicado |
| `uuid@7.0.3` | moderada | `expo > @expo/config-plugins > xcode > uuid` | parche mínimo 11.1.1; cambio mayor fuera de `xcode` `^7.0.3` |
| `sprintf-js@1.0.3` | moderada | `@react-native/jest-preset > babel-jest > babel-plugin-istanbul > @istanbuljs/load-nyc-config > js-yaml > argparse > sprintf-js` | npm latest 1.1.3 también afectado; sin parche indicado |

## Exposición comprobada

- **node-forge:** [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv),
  CVE-2026-85393: verificación de firmas RSA PKCS#1 v1.5 acepta elementos extra en DigestAlgorithm.
  El import encontrado en `@expo/cli/build/src/run/ios/codeSigning/Security.js` usa
  `pki.certificateFromPem()` y consulta CN/O/OU de certificados de firma iOS. No se encontró una llamada
  a la verificación RSA afectada en ese dependiente. Expo CLI, firma iOS y credenciales no se ejecutaron
  durante la DEMO. El aviso sigue instalado; esta revisión estática no certifica todas las rutas futuras.

- **braces:** [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
  CVE-2026-93687: patrones de llaves profundamente anidados pueden agotar la pila.
  `micromatch@4.0.8/index.js` invoca `braces(String(pattern), options)`. Es una ruta de herramientas
  de Jest para patrones/configuración del repositorio, no un campo expuesto al usuario de la DEMO.
  Configuración o patrones maliciosos seguirían siendo un riesgo para el proceso de pruebas.

- **uuid:** [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq),
  CVE-2026-41907: las APIs v3/v5/v6 con buffer/offset no validan correctamente los límites.
  `xcode@3.0.1/lib/pbxProject.js:89` llama solo `uuid.v4()` sin buffer. La app genera sus identificadores
  con `expo-crypto.randomUUID()`, y la vista QA con `crypto.randomUUID()` del navegador.
  No se encontró una llamada a v3/v5/v6 en el uso de xcode revisado.

- **sprintf-js:** [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c),
  CVE-2026-97058: una precisión excesiva en un formato puede causar un RangeError.
  `@istanbuljs/load-nyc-config@1.1.0` usa `js-yaml.load()` para configuración YAML; `argparse` aparece
  como import de `js-yaml/bin/js-yaml.js`, su CLI, no de la ruta de carga YAML revisada.
  Argparse usa sprintf en ayudas/usos y mensajes de argumentos. La DEMO no recibe formatos sprintf
  del usuario ni ejecuta esa CLI. Un uso futuro con formatos no confiables necesitaría revisión.

## Bloqueos exactos y recomendación

1. **node-forge, braces y sprintf-js:** los advisories no señalan un parche publicado y los latest oficiales
   siguen afectados. Actualizar a esos latest no elimina los avisos. Seguir sus correcciones upstream y
   actualizar cuando haya versiones compatibles; conservar las alertas mientras tanto.
2. **uuid:** 11.1.1 se publicó el 2026-04-29 y ofrece CommonJS para require, pero está fuera del rango
   `^7.0.3` declarado por xcode. Tanto xcode latest 3.0.1 como @expo/config-plugins latest 57.0.10
   mantienen ese rango. No hay una actualización que lo resuelva dentro de las restricciones declaradas.
   Requiere una actualización upstream de xcode/config-plugins o evaluar por separado una migración mayor.
   No se ha forzado un override ni se ha aplicado audit fix/force o un filtro para esconder el aviso.

Las pruebas y la QA visual verifican la interfaz DEMO; no sustituyen esta auditoría ni una validación de
build nativa. Estos cuatro avisos permanecen documentados antes de autenticación real o distribución.
