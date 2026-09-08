import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";

import { evaluateAuthenticodeResult } from "./windows-smoke-logic.mjs";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

function parseArgs(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid Authenticode argument at index ${index}`);
    }
    result.set(name.slice(2), value);
  }
  return result;
}

function requiredArg(args, name) {
  const value = args.get(name)?.trim();
  if (!value) throw new Error(`Missing required --${name}`);
  return value;
}

async function main() {
  // oxlint-disable-next-line t3code/no-global-process-runtime -- standalone Windows release probe has no Effect runtime.
  const runtimePlatform = process.platform;
  if (runtimePlatform !== "win32") {
    throw new Error(`Authenticode verification requires Windows, received ${runtimePlatform}`);
  }

  const args = parseArgs(process.argv.slice(2));
  const path = requiredArg(args, "path");
  const expectedPublisher = requiredArg(args, "publisher");
  const command = [
    "$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)",
    "$signature = Get-AuthenticodeSignature -LiteralPath $env:T3CODE_SMOKE_SIGNATURE_PATH",
    "$subject = if ($null -eq $signature.SignerCertificate) { '' } else { $signature.SignerCertificate.Subject }",
    "@{ status = $signature.Status.ToString(); subject = $subject } | ConvertTo-Json -Compress",
  ].join("; ");
  const { stdout } = await execFile(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    {
      env: { ...process.env, T3CODE_SMOKE_SIGNATURE_PATH: path },
      windowsHide: true,
    },
  );
  const result = JSON.parse(stdout.trim());
  const failures = evaluateAuthenticodeResult(result, expectedPublisher);
  if (failures.length > 0) {
    throw new Error(`Authenticode verification failed for '${path}':\n- ${failures.join("\n- ")}`);
  }
  console.log(`Authenticode signature is valid for '${path}'.`);
}

await main();
