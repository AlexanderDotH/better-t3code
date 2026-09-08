import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { resolveElectronLaunchCommand } from "./electron-launcher.mjs";
import { desktopSmokeIsReady, evaluateDesktopSmokeResult } from "./smoke-test-logic.mjs";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const desktopDir = NodePath.resolve(__dirname, "..");
const mainJs = NodePath.resolve(desktopDir, "dist-electron/main.cjs");

console.log("\nLaunching Electron smoke test...");

const electronCommand = resolveElectronLaunchCommand([mainJs]);
const child = NodeChildProcess.spawn(electronCommand.electronPath, electronCommand.args, {
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: "",
    ELECTRON_ENABLE_LOGGING: "1",
  },
});

let output = "";
let timedOut = false;
let initiatedShutdown = false;

const appendOutput = (chunk) => {
  output += chunk.toString();
  if (!initiatedShutdown && desktopSmokeIsReady(output)) {
    initiatedShutdown = true;
    child.kill();
  }
};

child.stdout.on("data", appendOutput);
child.stderr.on("data", appendOutput);
child.on("error", (error) => {
  output += `\nElectron spawn error: ${error.stack ?? error.message}\n`;
});

const timeout = setTimeout(() => {
  timedOut = true;
  child.kill();
}, 8_000);

child.on("close", (exitCode, signal) => {
  clearTimeout(timeout);
  const result = evaluateDesktopSmokeResult({
    output,
    timedOut,
    initiatedShutdown,
    exitCode,
    signal,
  });

  if (!result.ok) {
    console.error("\nDesktop smoke test failed:");
    for (const failure of result.failures) {
      console.error(` - ${failure}`);
    }
    console.error("\nFull output:\n" + output);
    process.exit(1);
  }

  console.log("Desktop smoke test passed.");
  process.exit(0);
});
