// Precarga para herramientas locales (Wrangler): bloquea toda conexión que no sea loopback. Así `types` y
// `deploy --dry-run` no pueden consultar la cuenta, autenticar ni buscar actualizaciones aunque lo intenten.
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import tls from "node:tls";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function hostOf(args) {
  const [first, second] = args;
  if (typeof first === "object" && first !== null) return first.host ?? first.hostname ?? "localhost";
  if (typeof first === "number") return typeof second === "string" ? second : "localhost";
  return undefined; // socket de dominio Unix (ruta): local
}

function guard(module, name) {
  const original = module[name];
  module[name] = function guarded(...args) {
    const host = hostOf(args);
    if (host !== undefined && !LOOPBACK.has(String(host))) {
      throw new Error(`Red bloqueada por scripts/no-network.mjs (${name} a host no local)`);
    }
    return Reflect.apply(original, this, args);
  };
}

guard(net, "connect");
guard(net, "createConnection");
guard(tls, "connect");
syncBuiltinESMExports();

const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new globalThis.URL(input instanceof globalThis.Request ? input.url : String(input));
  if (!LOOPBACK.has(url.hostname)) {
    return Promise.reject(new Error("Red bloqueada por scripts/no-network.mjs (fetch a host no local)"));
  }
  return originalFetch(input, init);
};
