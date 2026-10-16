import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integración del Worker en workerd real (Miniflare). Se lanza con `node scripts/api-tool.mjs integration`, que antes
// genera el bundle con --dry-run y bloquea la red salvo loopback.
export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  test: {
    include: ["test/**/*.integration.test.mjs"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
