import { defineConfig } from "vitest/config";

// Pruebas unitarias en Node: paquetes compartidos y el Worker. Las de apps/mobile son de Jest y no entran aquí; la
// integración del Worker en workerd va aparte (`pnpm test:api:integration`).
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/api/src/**/*.test.ts"],
  },
});
