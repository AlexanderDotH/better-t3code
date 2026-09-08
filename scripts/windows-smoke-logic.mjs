export const WINDOWS_PROVIDER_PROBE_NAMES = [
  "codex",
  "claude",
  "cursor-agent",
  "grok",
  "opencode",
  "gemini",
];

export const WINDOWS_ARGUMENT_PROBE_VALUES = [
  "plain",
  "space value",
  "Grüße 日本語",
  "100%",
  "ampersand & value",
  'quote "inside"',
];

const DESKTOP_READY_MARKERS = ["backend ready", "main window created"];
const DESKTOP_FATAL_PATTERNS = [
  "Cannot find module",
  "MODULE_NOT_FOUND",
  "Refused to execute",
  "Uncaught Error",
  "Uncaught TypeError",
  "Uncaught ReferenceError",
];

export function evaluateProviderProbeResults(results) {
  const failures = [];
  for (const provider of WINDOWS_PROVIDER_PROBE_NAMES) {
    const result = results.find((candidate) => candidate.provider === provider);
    if (!result) {
      failures.push(`Missing provider probe result: ${provider}`);
      continue;
    }
    for (const [index, expected] of WINDOWS_ARGUMENT_PROBE_VALUES.entries()) {
      if (result.args[index] !== expected) {
        failures.push(`${provider} argument round trip changed at index ${index}`);
      }
    }
    if (result.args.length !== WINDOWS_ARGUMENT_PROBE_VALUES.length) {
      failures.push(`${provider} argument count changed`);
    }
  }
  return failures;
}

export function deriveWindowsUpdateSmokeBaseVersion(targetVersion) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(targetVersion);
  if (!match) {
    throw new Error(`Invalid release version for Windows update smoke: ${targetVersion}`);
  }

  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);
  if (patch > 0) {
    patch -= 1;
  } else if (minor > 0) {
    minor -= 1;
    patch = 999;
  } else if (major > 0) {
    major -= 1;
    minor = 999;
    patch = 999;
  } else {
    throw new Error(`Cannot derive a lower base version from ${targetVersion}`);
  }

  const nightlySuffix = match[4]?.split(".").includes("nightly") ? "-nightly.19700101.0" : "";
  return `${major}.${minor}.${patch}${nightlySuffix}`;
}

export function evaluateAuthenticodeResult(result, expectedPublisher) {
  const failures = [];
  if (result.status !== "Valid") {
    failures.push(`Authenticode status is ${result.status}`);
  }
  if (
    !result.subject
      .toLocaleLowerCase("en-US")
      .includes(expectedPublisher.toLocaleLowerCase("en-US"))
  ) {
    failures.push(`Signer subject does not contain ${expectedPublisher}`);
  }
  return failures;
}

export function isWindowsPathWithinDirectory(directoryPath, candidatePath) {
  const normalize = (value) =>
    value.replaceAll("/", "\\").replace(/\\+$/u, "").toLocaleLowerCase("en-US");
  const directory = normalize(directoryPath);
  const candidate = normalize(candidatePath);
  return candidate === directory || candidate.startsWith(`${directory}\\`);
}

export function evaluateWindowsDesktopReadiness(output) {
  const failures = [];
  for (const marker of DESKTOP_READY_MARKERS) {
    if (!output.includes(marker)) {
      failures.push(`Missing readiness marker: ${marker}`);
    }
  }
  for (const pattern of DESKTOP_FATAL_PATTERNS) {
    if (output.includes(pattern)) {
      failures.push(`Fatal output: ${pattern}`);
    }
  }
  return failures;
}
