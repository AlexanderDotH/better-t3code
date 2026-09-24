// @effect-diagnostics nodeBuiltinImport:off - Read package metadata without loading project-owned compiler code.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";

const decodeCompilerPackage = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.String }));

export async function preferredTypeScriptMode(root: string): Promise<"native" | "compatible"> {
  try {
    const metadata = decodeCompilerPackage(
      JSON.parse(
        await NodeFSP.readFile(NodePath.join(root, "node_modules/typescript/package.json"), "utf8"),
      ),
    );
    return Number(metadata.version.split(".")[0]) <= 6 ? "compatible" : "native";
  } catch {
    return "native";
  }
}
