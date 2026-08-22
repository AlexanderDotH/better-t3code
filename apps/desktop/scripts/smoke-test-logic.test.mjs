import { assert, describe, it } from "vite-plus/test";

import { evaluateDesktopSmokeResult } from "./smoke-test-logic.mjs";

const READY_OUTPUT = "[desktop] backend ready\n[desktop] main window created\n";

describe("desktop smoke result", () => {
  it("passes only after backend and main-window readiness", () => {
    assert.deepEqual(
      evaluateDesktopSmokeResult({
        output: READY_OUTPUT,
        timedOut: false,
        initiatedShutdown: true,
        exitCode: null,
        signal: "SIGTERM",
      }),
      { ok: true, failures: [] },
    );
  });

  it("fails a timeout instead of treating the forced exit as success", () => {
    const result = evaluateDesktopSmokeResult({
      output: "",
      timedOut: true,
      initiatedShutdown: false,
      exitCode: null,
      signal: "SIGTERM",
    });

    assert.equal(result.ok, false);
    assert.include(result.failures, "Timed out before desktop readiness");
  });

  it("fails an early clean exit that never became ready", () => {
    const result = evaluateDesktopSmokeResult({
      output: "[desktop] app ready\n",
      timedOut: false,
      initiatedShutdown: false,
      exitCode: 0,
      signal: null,
    });

    assert.equal(result.ok, false);
    assert.include(result.failures, "Missing readiness marker: backend ready");
    assert.include(result.failures, "Missing readiness marker: main window created");
  });

  it("fails fatal startup output even after readiness", () => {
    const result = evaluateDesktopSmokeResult({
      output: `${READY_OUTPUT}Uncaught TypeError: boom`,
      timedOut: false,
      initiatedShutdown: true,
      exitCode: null,
      signal: "SIGTERM",
    });

    assert.equal(result.ok, false);
    assert.include(result.failures, "Fatal output: Uncaught TypeError");
  });
});
