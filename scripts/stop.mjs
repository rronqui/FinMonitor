// Stop do FinMonitor: encerra o processo registrado em .server.pid.
// Uso: node scripts/stop.mjs
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pidFile = join(root, ".server.pid");

if (!existsSync(pidFile)) {
  console.log("Nenhum servidor registrado (.server.pid ausente) — nada a parar.");
  process.exit(0);
}

const pid = Number(readFileSync(pidFile, "utf8").trim());
if (!pid || !alive(pid)) {
  console.log(pid ? `PID ${pid} já não está em execução.` : "PID inválido no arquivo .server.pid.");
  rmSync(pidFile);
  process.exit(0);
}

process.kill(pid, "SIGTERM");
console.log(`SIGTERM enviado ao PID ${pid}…`);

const deadline = Date.now() + 10_000;
while (alive(pid)) {
  if (Date.now() > deadline) {
    console.warn(`PID ${pid} não encerrou em 10s — forçando (SIGKILL).`);
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
    break;
  }
  await new Promise((r) => setTimeout(r, 250));
}

if (!alive(pid)) {
  rmSync(pidFile);
  console.log("FinMonitor parado.");
} else {
  console.error("Não foi possível encerrar o processo.");
  process.exit(1);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
