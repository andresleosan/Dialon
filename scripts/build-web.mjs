import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(root, "apps", "mobile");
const temp = join(root, ".tools", "tmp");
const expoHome = join(root, ".tools", "expo-home");
mkdirSync(temp, { recursive: true });
mkdirSync(expoHome, { recursive: true });

// Esta DEMO no necesita variables de cuenta ni archivos .env para compilar.
const env = {
  CI: "1",
  EXPO_NO_TELEMETRY: "1",
  EXPO_NO_CACHE: "1",
  EXPO_NO_DOTENV: "1",
  EXPO_OFFLINE: "1",
  TMPDIR: temp,
  TMP: temp,
  TEMP: temp,
  // Opción comprobada en la CLI fijada: su estado local permanece dentro del proyecto.
  __UNSAFE_EXPO_HOME_DIRECTORY: expoHome,
};
for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "ComSpec", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "TZ"]) {
  if (process.env[key] !== undefined) env[key] = process.env[key];
}


// Única variable pública admitida: enlaza la web con el Worker sin heredar secretos del entorno.
const publicApiUrl = process.env.EXPO_PUBLIC_DIALON_API_URL?.trim() ?? "https://dialon-api.andres-san1404.workers.dev";
if (publicApiUrl !== undefined && publicApiUrl !== "") {
  const url = new URL(publicApiUrl);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" || url.pathname !== "/") {
    throw new Error("EXPO_PUBLIC_DIALON_API_URL debe ser un origen HTTPS público sin credenciales, ruta, parámetros ni fragmento.");
  }
  env.EXPO_PUBLIC_DIALON_API_URL = url.origin;
}

const result = spawnSync(
  process.execPath,
  [join(app, "node_modules", "expo", "bin", "cli"), "export", "--clear", "--platform", "web", "--output-dir", "dist"],
  { cwd: app, env, stdio: "inherit" },
);
if (result.error) process.stderr.write(`${result.error.message}\n`);
process.exitCode = result.status ?? 1;
