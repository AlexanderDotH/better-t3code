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
  it.effect("flies pills to and from the viewport left edge with bounded one-shot motion", () =>
    Effect.gen(function* () {
      const indexCss = yield* readIndexCss;
      expect(indexCss).toContain("translate3d(calc(-100dvw - 100%), 0, 0)");
      expect(indexCss).toContain("animation: subagent-pill-enter 420ms");
      expect(indexCss).toContain("animation: subagent-pill-exit 300ms");
      expect(indexCss).toContain("animation: subagent-slot-collapse 180ms");
    }),
  );

  it.effect("keeps a compact launcher reachable until the message gutter has room", () =>
    Effect.gen(function* () {
      const indexCss = yield* readIndexCss;
      expect(indexCss).toMatch(
        /\.chat-agent-floating-layer\s*\{[^}]*left:\s*0\.75rem;[^}]*display:\s*block;/,
      );
      expect(indexCss).toMatch(
        /\.subagent-stack-compact-trigger[\s\S]*?display:\s*flex[\s\S]*?\.subagent-stack-content[\s\S]*?display:\s*none/,
      );
      expect(indexCss).toMatch(
        /\[data-chat-agent-stack\]\[data-compact-open="true"\][\s\S]*?\.subagent-stack-content[\s\S]*?display:\s*block/,
      );
      expect(indexCss).toMatch(
        /@container chat-column \(min-width: 77rem\)[\s\S]*?\.subagent-stack-compact-trigger[\s\S]*?display:\s*none[\s\S]*?\.subagent-stack-content[\s\S]*?display:\s*block/,
      );
      expect(indexCss).toContain("left: calc(50% - 24rem - 13rem - 0.75rem)");
    }),
  );

  it.effect("disables bounce and uses opacity-only movement for reduced motion", () =>
    Effect.gen(function* () {
      const indexCss = yield* readIndexCss;
      expect(indexCss).toMatch(
        /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.subagent-stack-slot\[data-subagent-presence="entering"\][\s\S]*?animation:\s*none/,
      );
      expect(indexCss).toContain("animation: subagent-pill-fade-in 120ms");
      expect(indexCss).toContain("animation: subagent-pill-fade-out 120ms");
    }),
  );
});
