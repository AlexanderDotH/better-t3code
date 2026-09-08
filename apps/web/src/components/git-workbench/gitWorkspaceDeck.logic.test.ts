import { describe, expect, it } from "vite-plus/test";

import {
  bufferedRevisionDisposition,
  resolveActionRequiredDeckState,
  resolveDeckCardRequest,
  resolveDeckShuffleDirection,
  shouldExpandGitCompactPull,
  selectBufferedPathsForScope,
} from "./gitWorkspaceDeck.logic";

describe("workspace deck card selection", () => {
  it("keeps Chat in front when recording blocks a Git selection", () => {
    expect(
      resolveDeckCardRequest({
        activeCard: "chat",
        requestedCard: "git",
        isRecording: true,
      }),
    ).toEqual({
      activeCard: "chat",
      blockedReason: "recording",
      shouldCollapseDrawer: false,
    });
  });

  it("moves Git to the front when recording is idle", () => {
    expect(
      resolveDeckCardRequest({
        activeCard: "chat",
        requestedCard: "git",
        isRecording: false,
      }),
    ).toEqual({
      activeCard: "git",
      blockedReason: null,
      shouldCollapseDrawer: false,
    });
  });

  it("collapses an expanded Git drawer when Chat is selected", () => {
    expect(
      resolveDeckCardRequest({
        activeCard: "git",
        requestedCard: "chat",
        isRecording: false,
      }),
    ).toEqual({
      activeCard: "chat",
      blockedReason: null,
      shouldCollapseDrawer: true,
    });
  });

  it("returns to Chat and collapses the drawer when an action needs attention", () => {
    expect(
      resolveActionRequiredDeckState({
        activeCard: "git",
        drawerExpanded: true,
        actionRequired: true,
      }),
    ).toEqual({
      activeCard: "chat",
      drawerExpanded: false,
      didPromoteChat: true,
    });
  });

  it("leaves the selected card unchanged when no action needs attention", () => {
    expect(
      resolveActionRequiredDeckState({
        activeCard: "git",
        drawerExpanded: true,
        actionRequired: false,
      }),
    ).toEqual({
      activeCard: "git",
      drawerExpanded: true,
      didPromoteChat: false,
    });
  });

  it("mirrors the shuffle direction when cards trade places", () => {
    expect(resolveDeckShuffleDirection("chat", "git")).toBe("to-git");
    expect(resolveDeckShuffleDirection("git", "chat")).toBe("to-chat");
    expect(resolveDeckShuffleDirection("chat", "chat")).toBeNull();
  });
});

describe("compact Git pull gesture", () => {
  const gesture = {
    button: 0,
    cancelled: false,
    endX: 100,
    endY: 64,
    isPrimary: true,
    startX: 100,
    startY: 100,
  } as const;

  it("expands after a primary pointer pulls upward by 36 pixels", () => {
    expect(shouldExpandGitCompactPull(gesture)).toBe(true);
  });

  it("ignores short, downward, and predominantly horizontal movement", () => {
    expect(shouldExpandGitCompactPull({ ...gesture, endY: 65 })).toBe(false);
    expect(shouldExpandGitCompactPull({ ...gesture, endY: 120 })).toBe(false);
    expect(shouldExpandGitCompactPull({ ...gesture, endX: 130 })).toBe(false);
  });

  it("ignores cancelled and non-primary pointer interactions", () => {
    expect(shouldExpandGitCompactPull({ ...gesture, cancelled: true })).toBe(false);
    expect(shouldExpandGitCompactPull({ ...gesture, isPrimary: false })).toBe(false);
    expect(shouldExpandGitCompactPull({ ...gesture, button: 1 })).toBe(false);
  });
});

describe("buffered worktree edits", () => {
  it("queues every buffered path in the active environment and worktree", () => {
    expect(
      selectBufferedPathsForScope(
        [
          { cwd: "/repo", environmentId: "local", path: "one.ts" },
          { cwd: "/repo", environmentId: "local", path: "two.ts" },
          { cwd: "/other", environmentId: "local", path: "other.ts" },
          { cwd: "/repo", environmentId: "remote", path: "remote.ts" },
        ],
        "local",
        "/repo",
      ),
    ).toEqual(["one.ts", "two.ts"]);
  });

  it("saves only when the authoritative revision still matches the edit base", () => {
    expect(bufferedRevisionDisposition("revision-1", "revision-1")).toBe("save");
    expect(bufferedRevisionDisposition("revision-1", "revision-2")).toBe("conflict");
    expect(bufferedRevisionDisposition("revision-1", undefined)).toBe("conflict");
  });
});
