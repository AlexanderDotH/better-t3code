import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

const feedSource = NodeFS.readFileSync(new URL("./ThreadFeed.tsx", import.meta.url), "utf8");
const detailSource = NodeFS.readFileSync(
  new URL("./ThreadDetailScreen.tsx", import.meta.url),
  "utf8",
);
const routeSource = NodeFS.readFileSync(
  new URL("./ThreadRouteScreen.tsx", import.meta.url),
  "utf8",
);
const actionSource = NodeFS.readFileSync(
  new URL("./use-thread-fork-action.ts", import.meta.url),
  "utf8",
);
const presentationSource = NodeFS.readFileSync(
  new URL("./thread-fork.ts", import.meta.url),
  "utf8",
);
const composerSource = NodeFS.readFileSync(
  new URL("./ThreadComposer.tsx", import.meta.url),
  "utf8",
);

describe("mobile thread fork wiring", () => {
  it("gates and dispatches an authoritative fork before navigating with composer focus", () => {
    expect(routeSource).toContain("capabilities.threadForking === true");
    expect(actionSource).toContain("threadEnvironment.fork");
    expect(actionSource).toContain("Could not fork chat");
    expect(routeSource).toContain('StackActions.replace("Thread"');
    expect(routeSource).toContain("focusComposer: true");
    expect(detailSource).toContain("focusComposerOnMount");
    expect(detailSource).toContain("composerEditorRef.current?.focus()");
  });

  it("renders accessible entry actions, provenance, and the frozen-history divider", () => {
    expect(feedSource).toContain('accessibilityLabel="Fork chat from here"');
    expect(feedSource).toContain("Forked from");
    expect(feedSource).toContain("Fork starts here");
    expect(presentationSource).toContain("historyOrigin");
  });

  it("enforces and presents the pending first-turn handoff budget", () => {
    expect(composerSource).toContain("forkComposerBudget");
    expect(composerSource).toContain("promptExceededBy");
    expect(composerSource).toContain("attachmentsExceededBy");
    expect(composerSource).toContain("Fork context leaves");
  });
});
