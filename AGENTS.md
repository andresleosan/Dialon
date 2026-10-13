# Dialon — instrucciones locales

Complementan `/root/AGENTS.md` y solo prevalecen en lo que se indica aquí.

## Excepción: ESLint 10 en lugar de ESLint 9

- Este proyecto usa `eslint` 10.12.0 y `@eslint/js` 10.0.1.
- Motivo: el registro de npm marca la última versión 9.x (`eslint@9.39.5`) como sin soporte.
- Compatibilidad comprobada el 2026-10-13 en `https://registry.npmjs.org/`:
  - `eslint@10.12.0` y `@eslint/js@10.0.1` piden Node `^20.19.0 || ^22.13.0 || >=24`; el VPS usa Node 24.16.0.
  - `typescript-eslint@8.71.1` admite `eslint` `^10.0.0` y TypeScript `<6.1.0`; el proyecto usa 6.0.3.
- Aplica solo a `/root/Dialon`.
- Un cambio de versión mayor de ESLint o de typescript-eslint debe actualizar esta nota.
