import { expect, it } from "vite-plus/test";
import { modelFacingNativeProviderToolResult } from "./NativeProviderToolResult.ts";

it("keeps bounded output and preserves failure details in an oversized output digest", () => {
  const small = {
    ok: true,
    itemType: "command_execution" as const,
    title: "command",
    detail: "done",
    output: { stdout: "small" },
  };
  expect(modelFacingNativeProviderToolResult(small, { itemId: "small", status: "completed" })).toBe(
    small,
  );
  const large = {
    ...small,
    ok: false,
    detail: "command failed",
    output: { stdout: "x".repeat(1024 * 1024), stderr: "fatal: access denied", exitCode: 1 },
  };
  const result = modelFacingNativeProviderToolResult(large, { itemId: "large", status: "failed" });
  expect(result.output).toMatchObject({
    status: "failed",
    exitCode: 1,
    detailRef: "tool-result:large",
    errorLines: ["command failed", "fatal: access denied"],
  });
  expect(JSON.stringify(result.output).length).toBeLessThan(16 * 1024);
});
