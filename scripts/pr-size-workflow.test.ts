// @effect-diagnostics nodeBuiltinImport:off - Runs the workflow's synchronous Node subprocess boundary with real oversized output.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeProcess from "node:process";
import * as NodeVM from "node:vm";
import { expect, it, vi } from "vite-plus/test";
import { parse } from "yaml";

it("sizes large imports when both numstat outputs exceed Node's default buffer", async () => {
  const workflow = parse(
    NodeFS.readFileSync(new URL("../.github/workflows/pr-size.yml", import.meta.url), "utf8"),
  );
  const script = workflow.jobs.label.steps.find(
    (step: { name: string }) => step.name === "Sync PR size label",
  ).with.script;
  const addLabels = vi.fn();
  const info = vi.fn();
  let diffCalls = 0;

  await NodeVM.runInNewContext(`(async () => { ${script} })()`, {
    require: (module: string) => {
      expect(module).toBe("node:child_process");
      return {
        execFileSync: (
          command: string,
          args: string[],
          options: NodeChildProcess.ExecFileSyncOptions,
        ) => {
          expect(command).toBe("git");
          if (args[0] === "fetch" || args[0] === "cat-file") return "";
          if (args[0] === "rev-parse") return "head";
          expect(args[0]).toBe("diff");
          diffCalls += 1;
          const fileCount = args.includes("--") ? 110_000 : 120_000;
          return NodeChildProcess.execFileSync(
            NodeProcess.execPath,
            ["-e", `process.stdout.write("1\\t0\\tfile.ts\\n".repeat(${fileCount}))`],
            options,
          );
        },
      };
    },
    context: {
      payload: { pull_request: { number: 28, base: { sha: "base" }, head: { sha: "head" } } },
      repo: { owner: "example", repo: "app" },
    },
    process: { env: {} },
    github: { rest: { issues: { listLabelsOnIssue: async () => ({ data: [] }), addLabels } } },
    core: { info, warning: vi.fn() },
  });

  expect(diffCalls).toBe(2);
  expect(addLabels).toHaveBeenCalledWith({
    owner: "example",
    repo: "app",
    issue_number: 28,
    labels: ["size:XXL"],
  });
  expect(info).toHaveBeenCalledWith(
    "PR #28: 110000 non-test lines, 10000 test lines, 110000 effective lines -> size:XXL (test lines excluded)",
  );
});
