# Unidades menores de moneda

Las pruebas RED y Chromium detectaron que Node24/ICU78.3 y Chromium 153 devuelven por defecto cero decimales para COP. Usar ese valor para convertir entre unidad mayor y menor cambiaba el importe por un factor de cien. Los importes de almacenamiento usan ISO 4217, de forma igual en navegador y servidor; Intl solo formatea con ambos límites de decimales explícitos.

Fuente primaria: [SIX ISO 4217 List One](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml), publicado 2026-09-17, consultado2026-10-16. SHA256 del XML: 33139b438657d1cee116ba737807ea71d19d6de4b90f799a09c56f0cc6a1b0ff. Se fijan únicamente códigos con unidad menor numérica, y se exige soporte del motor. Moneda desconocida: rechazo sin valor 2 por defecto. COP/GBP: 2, JPY: 0, KWD: 3. No hay conversión FX ni descargas en producción.
