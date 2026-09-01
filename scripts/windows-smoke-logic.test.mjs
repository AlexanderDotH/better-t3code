import { assert, describe, it } from "vite-plus/test";

import {
  WINDOWS_ARGUMENT_PROBE_VALUES,
  WINDOWS_PROVIDER_PROBE_NAMES,
  deriveWindowsUpdateSmokeBaseVersion,
  evaluateAuthenticodeResult,
  evaluateProviderProbeResults,
  evaluateWindowsDesktopReadiness,
  isWindowsPathWithinDirectory,
} from "./windows-smoke-logic.mjs";

describe("Windows native runtime smoke contract", () => {
  it("covers every provider command with shell-sensitive arguments", () => {
    assert.deepEqual(WINDOWS_PROVIDER_PROBE_NAMES, [
      "codex",
      "claude",
      "cursor-agent",
      "grok",
      "opencode",
      "gemini",
    ]);
    assert.deepEqual(WINDOWS_ARGUMENT_PROBE_VALUES, [
      "plain",
      "space value",
      "Grüße 日本語",
      "100%",
      "ampersand & value",
      'quote "inside"',
    ]);
  });

  it("accepts only exact provider and argument round trips", () => {
    const results = WINDOWS_PROVIDER_PROBE_NAMES.map((provider) => ({
      provider,
      args: [...WINDOWS_ARGUMENT_PROBE_VALUES],
    }));

    assert.deepEqual(evaluateProviderProbeResults(results), []);

    const changed = structuredClone(results);
    changed[2].args[4] = "ampersand  value";
    assert.deepEqual(evaluateProviderProbeResults(changed), [
      "cursor-agent argument round trip changed at index 4",
    ]);
  });
});

describe("Windows update smoke versions", () => {
  it("derives a lower stable version with a different numeric file version", () => {
    assert.equal(deriveWindowsUpdateSmokeBaseVersion("2.4.3"), "2.4.2");
    assert.equal(deriveWindowsUpdateSmokeBaseVersion("2.4.0-beta.2"), "2.3.999");
    assert.equal(deriveWindowsUpdateSmokeBaseVersion("2.0.0"), "1.999.999");
    assert.equal(deriveWindowsUpdateSmokeBaseVersion("0.1.0"), "0.0.999");
    assert.equal(deriveWindowsUpdateSmokeBaseVersion("0.0.1"), "0.0.0");
  });

  it("keeps nightly smoke builds on the nightly channel", () => {
    assert.equal(
      deriveWindowsUpdateSmokeBaseVersion("2.4.3-nightly.20260823.42.abc123"),
      "2.4.2-nightly.19700101.0",
    );
  });

  it("rejects versions without a lower numeric predecessor", () => {
    assert.throws(() => deriveWindowsUpdateSmokeBaseVersion("0.0.0"), /lower base version/i);
    assert.throws(() => deriveWindowsUpdateSmokeBaseVersion("not-semver"), /release version/i);
  });
});

describe("Windows release evidence", () => {
  it("detects every executable below the installed app directory", () => {
    const installDirectory = "C:\\Users\\runner\\AppData\\Local\\Programs\\T3 Code (Alpha)";
    assert.equal(
      isWindowsPathWithinDirectory(
        installDirectory,
        "c:\\users\\runner\\appdata\\local\\programs\\T3 Code (Alpha)\\resources\\t3-resource-monitor.exe",
      ),
      true,
    );
    assert.equal(
      isWindowsPathWithinDirectory(
        installDirectory,
        "C:\\Users\\runner\\AppData\\Local\\Programs\\T3 Code Other\\helper.exe",
      ),
      false,
    );
  });

  it("requires a valid Authenticode signature from the expected publisher", () => {
    assert.deepEqual(
      evaluateAuthenticodeResult(
        {
          status: "Valid",
          subject: "CN=T3 Tools, LLC, O=T3 Tools, LLC, C=US",
        },
        "T3 Tools, LLC",
      ),
      [],
    );
    assert.deepEqual(
      evaluateAuthenticodeResult(
        {
          status: "NotSigned",
          subject: "",
        },
        "T3 Tools, LLC",
      ),
      ["Authenticode status is NotSigned", "Signer subject does not contain T3 Tools, LLC"],
    );
  });

  it("requires both desktop readiness markers and rejects fatal startup output", () => {
    assert.deepEqual(
      evaluateWindowsDesktopReadiness("[desktop] backend ready\n[desktop] main window created\n"),
      [],
    );
    assert.deepEqual(evaluateWindowsDesktopReadiness("Uncaught TypeError: boom"), [
      "Missing readiness marker: backend ready",
      "Missing readiness marker: main window created",
      "Fatal output: Uncaught TypeError",
    ]);
  });
});
