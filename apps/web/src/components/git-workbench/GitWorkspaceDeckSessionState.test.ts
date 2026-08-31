import { beforeEach, describe, expect, it } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";

import {
  deckSelectionByThread,
  rememberDeckSelection,
  workspaceFileBufferKey,
} from "./GitWorkspaceDeckSessionState";

beforeEach(() => {
  deckSelectionByThread.clear();
});

describe("Git workspace deck session state", () => {
  it("retains only the 200 most recently selected thread cards", () => {
    for (let index = 0; index < 201; index += 1) {
      rememberDeckSelection(`scope-${index}`, index % 2 === 0 ? "git" : "mcp");
    }

    expect(deckSelectionByThread).toHaveLength(200);
    expect(deckSelectionByThread.has("scope-0")).toBe(false);
    expect(deckSelectionByThread.get("scope-200")).toBe("git");
  });

  it("refreshes an existing selection before evicting the oldest scope", () => {
    for (let index = 0; index < 200; index += 1) {
      rememberDeckSelection(`scope-${index}`, "chat");
    }
    rememberDeckSelection("scope-0", "mcp");
    rememberDeckSelection("scope-200", "git");

    expect(deckSelectionByThread.get("scope-0")).toBe("mcp");
    expect(deckSelectionByThread.has("scope-1")).toBe(false);
  });

  it("uses an unambiguous scoped key for buffered paths", () => {
    const environmentId = EnvironmentId.make("environment-1");

    expect(workspaceFileBufferKey(environmentId, "/repo:a", "b.ts")).not.toBe(
      workspaceFileBufferKey(environmentId, "/repo", "a:b.ts"),
    );
  });
});
