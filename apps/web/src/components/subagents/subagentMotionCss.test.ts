import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

const indexCssPath = decodeURIComponent(new URL("../../index.css", import.meta.url).pathname);
const readIndexCss = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFileString(indexCssPath);
}).pipe(Effect.provide(NodeServices.layer));

describe("subagent stack motion CSS", () => {
  it.effect("flies pills from and to the viewport's left edge with the requested timing", () =>
    Effect.gen(function* () {
      const indexCss = yield* readIndexCss;
      expect(indexCss).toContain("translate3d(calc(-100dvw - 100%), 0, 0)");
      expect(indexCss).toContain("animation: subagent-pill-enter 420ms");
      expect(indexCss).toContain("animation: subagent-pill-exit 300ms");
      expect(indexCss).toContain("animation: subagent-slot-collapse 180ms");
    }),
  );

  it.effect("overshoots the top slot before settling and disables bounce for reduced motion", () =>
    Effect.gen(function* () {
      const indexCss = yield* readIndexCss;
      expect(indexCss).toMatch(
        /@keyframes subagent-slot-enter[\s\S]*?height:\s*2\.05rem[\s\S]*?height:\s*1\.75rem/,
      );
      expect(indexCss).toMatch(
        /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.subagent-stack-slot\[data-subagent-presence="entering"\][\s\S]*?animation:\s*none/,
      );
      expect(indexCss).toContain("animation: subagent-pill-fade-in 120ms");
      expect(indexCss).toContain("animation: subagent-pill-fade-out 120ms");
    }),
  );
});
