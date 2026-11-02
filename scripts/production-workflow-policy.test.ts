// @effect-diagnostics nodeBuiltinImport:off - Reads the real workflow files to verify deployment safeguards.
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { parse } from "yaml";

const readWorkflow = (name: string) =>
  parse(NodeFS.readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8"));

describe("fork automation policy", () => {
  it("requires upstream or explicit opt-in for release, deployment, and mobile build jobs", () => {
    for (const name of [
      "release.yml",
      "release-desktop.yml",
      "desktop-macos-preview-publish.yml",
      "deploy-relay.yml",
      "mobile-eas-production.yml",
      "publish-aur.yml",
      "desktop-macos-preview.yml",
      "mobile-android-apk.yml",
      "mobile-eas-preview.yml",
      "mobile-eas-preview-fork.yml",
      "mobile-showcase-screenshots.yml",
      "relay-preview.yml",
      "relay-preview-cleanup.yml",
      "web-preview.yml",
    ]) {
      const workflow = readWorkflow(name);
      for (const job of Object.values(workflow.jobs) as Array<{
        if?: string;
        "runs-on"?: unknown;
        uses?: string;
      }>) {
        expect(job["runs-on"] ?? job.uses, name).toBeDefined();
        expect(job.if, name).toContain("github.repository == 'pingdotgg/t3code'");
        expect(job.if, name).toContain("vars.T3_ENABLE_PRODUCTION_AUTOMATION == 'true'");
        const condition = job.if
          ?.replace(/^\$\{\{\s*|\s*\}\}$/g, "")
          .replace(/\s+/g, " ")
          .trim();
        expect(condition, name).toMatch(
          /^\(github\.repository == 'pingdotgg\/t3code' \|\| vars\.T3_ENABLE_PRODUCTION_AUTOMATION == 'true'\)(?:$| && \()/,
        );
        expect(condition, name).not.toMatch(/(?:^|\s|\()(?:>[-+]?|\|)(?=\s|$)/);
        expect(condition, name).not.toMatch(/(?:^|[^A-Za-z_])\(\s*\)/);
      }
    }
  });
  it("verifies Windows artifacts on native runners before release publication", () => {
    const jobs = readWorkflow("release.yml").jobs;
    expect(jobs.release.needs).toContain("desktop_win_x64");
    expect(jobs.release.needs).toContain("desktop_win_arm64");
    expect(jobs.release.if).toContain("needs.desktop_win_x64.result == 'success'");
    expect(jobs.release.if).toContain("needs.desktop_win_arm64.result == 'success'");
    expect(jobs.desktop_win_x64.with.verify_runner).toBe("windows-2025");
    expect(jobs.desktop_win_arm64.with.verify_runner).toBe("windows-11-arm");
    const commands = (job: { steps: Array<{ run?: string }> }) =>
      job.steps.flatMap((step) => step.run ?? []).join("\n");
    const desktop = readWorkflow("release-desktop.yml").jobs;
    expect(commands(desktop.build)).toContain("--wsl-runtime");
    expect(commands(desktop.build)).toContain("--resource-monitor-dir");
    expect(commands(desktop.verify)).toContain("smoke-cli-archive.mjs");
    expect(commands(desktop.verify)).toContain("sampleNow");
  });
  it("keeps required CI check names on available hosted runners", () => {
    const jobs = Object.values(readWorkflow("ci.yml").jobs) as Array<{
      name?: string;
      "runs-on"?: string;
    }>;
    for (const name of ["Test", "Check", "Mobile Native Static Analysis", "Release Smoke"]) {
      expect(jobs.some((job) => job.name === name)).toBe(true);
    }
    for (const job of jobs) expect(job["runs-on"]).not.toContain("blacksmith");
  });
  it("uses hosted runners for fork previews", () => {
    for (const name of [
      "mobile-eas-preview.yml",
      "mobile-fingerprint-check.yml",
      "web-preview.yml",
    ]) {
      for (const job of Object.values(readWorkflow(name).jobs) as Array<{ "runs-on": string }>) {
        expect(job["runs-on"]).toBe("ubuntu-24.04");
      }
    }
  });
  it("limits mobile automation to imported build scripts", () => {
    const paths = readWorkflow("mobile-eas-production.yml").on.push.paths;
    expect(paths).not.toContain("scripts/**");
    expect(paths).toContain("scripts/lib/brand-assets.ts");
    expect(paths).toContain("scripts/lib/public-config.ts");
    const fingerprint = readWorkflow("mobile-fingerprint-check.yml");
    expect(fingerprint.on.pull_request.paths).toBeUndefined();
  });
});
