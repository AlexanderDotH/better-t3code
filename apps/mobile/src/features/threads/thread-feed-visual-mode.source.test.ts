import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

const threadFeedSource = NodeFS.readFileSync(new URL("./ThreadFeed.tsx", import.meta.url), "utf8");
const workLogSource = NodeFS.readFileSync(
  new URL("./thread-work-log.tsx", import.meta.url),
  "utf8",
);

describe("mobile thread feed visual modes", () => {
  it("reads the synchronized mode and selects mode-aware presentation and timestamps", () => {
    expect(threadFeedSource).toContain(
      "const { appearance, chatVisualMode } = useAppearancePreferences();",
    );
    expect(threadFeedSource).toContain(
      "expandedTurnIds,\n        chatVisualMode,\n        expandedWorkGroupIds,",
    );
    expect(threadFeedSource).toContain("formatThreadFeedTimestamp(");
    expect(threadFeedSource).toContain("chatVisualMode={props.chatVisualMode}");
  });

  it("clears incompatible work disclosures without resetting turn folds or feed anchoring", () => {
    expect(threadFeedSource).toContain("previousChatVisualModeRef");
    expect(threadFeedSource).toContain("expandedWorkGroups: {},");
    expect(threadFeedSource).toContain("expandedWorkRows: {},");
    expect(threadFeedSource).toContain("expandedTurnIds: current.expandedTurnIds,");
    expect(threadFeedSource).not.toContain("setEndFollowEnabled(chatVisualMode");
  });

  it("renders Current tool summaries with finite disclosure and explicit failure state", () => {
    expect(threadFeedSource).toContain('entry.type === "work-summary"');
    expect(threadFeedSource).toContain("<ThreadWorkSummary");
    expect(workLogSource).toContain("export function ThreadWorkSummary");
    expect(workLogSource).toContain("accessibilityState={{ expanded: props.expanded }}");
    expect(workLogSource).toContain("props.hasFailure");
    expect(workLogSource).toContain("props.live");
    expect(workLogSource).toContain("<ThreadWorkLog");
    expect(workLogSource).not.toContain("ActivityIndicator");
  });
});
