// Start do FinMonitor (produção): build se necessário, depois `next start` em background.
// Uso: node scripts/start.mjs [--force-build] [--port 3000] [--host 0.0.0.0]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, openSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const pidFile = join(root, ".server.pid");
const logDir = join(root, "logs");
const logFile = join(logDir, "server.log");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};

const port = opt("port", process.env.PORT ?? "3000");
const host = opt("host", process.env.HOSTNAME ?? "0.0.0.0");
const forceBuild = flag("force-build");

if (existsSync(pidFile)) {
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  if (pid && alive(pid)) {
    console.log(`FinMonitor já em execução (PID ${pid}).`);
    process.exit(1);
  }
  rmSync(pidFile);
}

if (forceBuild || !existsSync(join(root, ".next", "BUILD_ID"))) {
  console.log("Build de produção não encontrado — executando `next build`…");
  const build = runSync(nextBin, ["build"]);
  if (build !== 0) {
    console.error("Build falhou — abortando start.");
    process.exit(build);
  }
}

await waitPortFree(port);

mkdirSync(logDir, { recursive: true });
const out = openSync(logFile, "a");
const child = spawn(process.execPath, [nextBin, "start", "-p", port, "-H", host], {
  cwd: root,
  detached: true,
  stdio: ["ignore", out, out],
  env: { ...process.env, PORT: port, HOSTNAME: host },
});
child.unref();

writeFileSync(pidFile, String(child.pid));
console.log(`FinMonitor iniciado: PID ${child.pid}, porta ${port} (log: logs/server.log).`);

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function runSync(cmd, argv) {
  const p = spawn(process.execPath, [cmd, ...argv], { cwd: root, stdio: "inherit" });
  return new Promise((res) => p.on("close", (code) => res(code ?? 1)));
}

function waitPortFree(port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    (function check() {
      const probe = createServer();
      probe.once("error", () => {
        probe.close();
        if (Date.now() > deadline) reject(new Error(`Porta ${port} ocupada.`));
        else setTimeout(check, 500);
      });
      probe.once("listening", () => probe.close(() => resolve()));
      probe.listen(Number(port), "0.0.0.0");
    })();
  });
}
