// Wrangler SOLO en local para @dialon/api: `types` (Env y runtime), `build` (bundle con --dry-run) e `integration`
// (build + Vitest con workerd real vía Miniflare, tráfico saliente interceptado). Nunca autentica,
// despliega ni consulta la cuenta: el subproceso va sin credenciales de Cloudflare, con su configuración y caché en
// .tools/, sin métricas, sin dotenv y con la red bloqueada salvo loopback (scripts/no-network.mjs).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const api = join(root, "apps", "api");
const tools = join(root, ".tools", "api");
const wrangler = join(api, "node_modules", "wrangler", "bin", "wrangler.js");

const vitest = join(root, "node_modules", "vitest", "vitest.mjs");
const integrationConfig = join(api, "vitest.integration.config.mjs");
const WRANGLER = {
  types: ["types", join(tools, "worker-configuration.d.ts")],
  build: ["deploy", "--dry-run", "--outdir", join(tools, "bundle")],
};

const task = process.argv[2];
if (task !== "types" && task !== "build" && task !== "integration") {
  process.stderr.write("Uso: node scripts/api-tool.mjs <types|build|integration>\n");
  process.exit(2);
}

for (const dir of ["xdg-config", "xdg-cache", "logs", "tmp"]) mkdirSync(join(tools, dir), { recursive: true });

// Se quitan (sin leerlas ni mostrarlas) todas las variables de credenciales o cuenta de Cloudflare.
const env = {};
for (const [key, value] of Object.entries(process.env)) {
  if (/^(CLOUDFLARE_|CF_)/.test(key) || /^WRANGLER_.*(TOKEN|AUTH)/.test(key)) continue;
  env[key] = value;
}
Object.assign(env, {
  XDG_CONFIG_HOME: join(tools, "xdg-config"),
  XDG_CACHE_HOME: join(tools, "xdg-cache"),
  WRANGLER_LOG_PATH: join(tools, "logs"),
  TMPDIR: join(tools, "tmp"),
  WRANGLER_SEND_METRICS: "false",
  WRANGLER_SEND_ERROR_REPORTS: "false",
  WRANGLER_HIDE_BANNER: "true",
  WRANGLER_NO_SKILLS_UPDATE_PROMPTS: "true",
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
  CLOUDFLARE_INCLUDE_PROCESS_ENV: "false",
  CI: "1",
  NODE_OPTIONS: [env.NODE_OPTIONS, `--import=${pathToFileURL(join(root, "scripts", "no-network.mjs")).href}`]
    .filter(Boolean)
    .join(" "),
});

function run(args, cwd) {
  const result = spawnSync(process.execPath, args, { cwd, env, stdio: "inherit" });
  if (result.error) process.stderr.write(`${result.error.message}\n`);
  return result.status ?? 1;
}

// Wrangler crea `.wrangler/tmp` junto a su configuración: si no existía, se borra al terminar (todo queda en .tools/).
function wranglerRun(args) {
  const dotWrangler = join(api, ".wrangler");
  const hadDotWrangler = existsSync(dotWrangler);
  const status = run([wrangler, ...args], api);
  if (!hadDotWrangler) rmSync(dotWrangler, { recursive: true, force: true });
  return status;
}

if (task === "integration") {
  const built = wranglerRun(WRANGLER.build);
  process.exitCode = built !== 0 ? built : run([vitest, "run", "--config", integrationConfig], root);
} else {
  process.exitCode = wranglerRun(WRANGLER[task]);
}
