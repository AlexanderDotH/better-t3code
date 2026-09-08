export const DESKTOP_SMOKE_READY_MARKERS = ["backend ready", "main window created"];

export const DESKTOP_SMOKE_FATAL_PATTERNS = [
  "Cannot find module",
  "MODULE_NOT_FOUND",
  "Refused to execute",
  "Uncaught Error",
  "Uncaught TypeError",
  "Uncaught ReferenceError",
];

export function desktopSmokeIsReady(output) {
  return DESKTOP_SMOKE_READY_MARKERS.every((marker) => output.includes(marker));
}

export function evaluateDesktopSmokeResult({
  output,
  timedOut,
  initiatedShutdown,
  exitCode,
  signal,
}) {
  const failures = [];

  if (timedOut) {
    failures.push("Timed out before desktop readiness");
  }
  for (const marker of DESKTOP_SMOKE_READY_MARKERS) {
    if (!output.includes(marker)) {
      failures.push(`Missing readiness marker: ${marker}`);
    }
  }
  for (const pattern of DESKTOP_SMOKE_FATAL_PATTERNS) {
    if (output.includes(pattern)) {
      failures.push(`Fatal output: ${pattern}`);
    }
  }
  if (!initiatedShutdown && exitCode !== 0) {
    failures.push(`Electron exited with code ${exitCode ?? "none"}${signal ? ` (${signal})` : ""}`);
  }

  return { ok: failures.length === 0, failures };
}
