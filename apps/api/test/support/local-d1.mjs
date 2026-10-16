// Utilidad SOLO de prueba: aplica las migraciones de `apps/api/migrations/*.sql` (orden alfabético) a la D1 local en
// memoria de una instancia de Miniflare. Si aún no hay migraciones, no hace nada y devuelve 0: las pruebas llegan a sus
// aserciones (p. ej. 404 en rutas inexistentes) en vez de fallar en la preparación. Nunca toca recursos remotos.
//
// Divide por `;` al final de línea: las migraciones no deben usar triggers ni bloques BEGIN…END.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export async function applyMigrations(mf, dir, binding = "DB") {
  if (!existsSync(dir)) return 0;
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (files.length === 0) return 0;
  const db = await mf.getD1Database(binding);
  for (const name of files) {
    const statements = readFileSync(join(dir, name), "utf8")
      .split(/;\s*(?:\r?\n|$)/)
      .map((statement) => statement.replace(/^\s*--.*$/gm, "").trim())
      .filter(Boolean);
    for (const statement of statements) await db.prepare(statement).run();
  }
  return files.length;
}
