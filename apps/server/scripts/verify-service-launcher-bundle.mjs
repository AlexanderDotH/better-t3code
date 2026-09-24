import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-launcher-bundle-"));
try {
  const launcher = NodePath.join(directory, "service-launcher.mjs");
  await NodeFSP.copyFile(new URL("../dist/service-launcher.mjs", import.meta.url), launcher);
  // Importing checks the relocated bundle without invoking its CLI entrypoint.
  await import(NodeURL.pathToFileURL(launcher).href);
} finally {
  await NodeFSP.rm(directory, { recursive: true, force: true });
}
