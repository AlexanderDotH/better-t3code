// @effect-diagnostics nodeBuiltinImport:off - Reads the real workflow files to verify deployment safeguards.
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { parse } from "yaml";

const readWorkflow = (name: string) =>
  parse(NodeFS.readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8"));

describe("fork automation policy", () => {
  it("requires upstream or explicit opt-in for every production job", () => {
    for (const name of [
      "release.yml",
      "deploy-relay.yml",
      "mobile-eas-production.yml",
      "publish-aur.yml",
    ]) {
      const workflow = readWorkflow(name);
      for (const job of Object.values(workflow.jobs) as Array<{ if?: string }>) {
        expect(job.if, name).toContain("github.repository == 'pingdotgg/t3code'");
        expect(job.if, name).toContain("vars.T3_ENABLE_PRODUCTION_AUTOMATION == 'true'");
      }
    }
  });
  it("blocks release publication on Windows startup and update verification", () => {
    const jobs = readWorkflow("release.yml").jobs;
    expect(jobs.publish_cli.needs).toContain("windows_update_smoke");
    expect(jobs.publish_cli.if).toContain("needs.windows_update_smoke.result == 'success'");
    const commands = (job: { steps: Array<{ run?: string }> }) =>
      job.steps.flatMap((step) => step.run ?? []).join("\n");
    expect(commands(jobs.build)).toContain("windows-desktop-release-smoke.ps1");
    expect(commands(jobs.build)).toContain("--wsl-resource-monitor-prebuild");
    expect(commands(jobs.windows_update_smoke)).toContain("-Mode update");
    expect(commands(jobs.windows_update_smoke)).toContain(
      "windows-task-scheduler-service-smoke.ps1",
    );
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
    for (const [name, event] of [
      ["mobile-eas-production.yml", "push"],
      ["mobile-fingerprint-check.yml", "pull_request"],
    ]) {
      const paths = readWorkflow(name!).on[event!].paths;
      expect(paths).not.toContain("scripts/**");
      expect(paths).toContain("scripts/lib/brand-assets.ts");
      expect(paths).toContain("scripts/lib/public-config.ts");
    }
  });
});
