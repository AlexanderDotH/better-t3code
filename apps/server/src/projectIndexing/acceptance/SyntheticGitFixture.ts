// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

const execute = NodeUtil.promisify(NodeChildProcess.execFile);
export const syntheticGit = (cwd: string, args: ReadonlyArray<string>) =>
  execute("git", ["-C", cwd, ...args], { maxBuffer: 16 * 1024 * 1024 });

export async function createSyntheticGitRepository() {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-index-git-fixture-"));
  await syntheticGit(root, ["init", "--quiet"]);
  await syntheticGit(root, ["config", "user.name", "Synthetic Fixture"]);
  await syntheticGit(root, ["config", "user.email", "fixture@example.invalid"]);
  await syntheticGit(root, ["config", "commit.gpgSign", "false"]);
  await NodeFSP.mkdir(NodePath.join(root, "empty-hooks"));
  await syntheticGit(root, ["config", "core.hooksPath", NodePath.join(root, "empty-hooks")]);
  return root;
}
