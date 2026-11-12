import { describe, expect, it } from "vite-plus/test";
import {
  EMPTY_GUIDE_PROGRESS,
  guideProgressVersion,
  moveGuideProgress,
  setGuideStopRead,
} from "./guideProgress";

describe("review guide progress", () => {
  it("tracks completed stops, resumes position, and can mark a stop unread", () => {
    const opened = moveGuideProgress(EMPTY_GUIDE_PROGRESS, 1, 3);
    expect(opened.readStops.size).toBe(0);
    const next = moveGuideProgress(opened, 2, 3, true);
    expect([...next.readStops]).toEqual([1]);
    expect(next.position).toBe(2);
    const finished = setGuideStopRead(next, 2, true, 3);
    expect([...finished.readStops]).toEqual([1, 2]);
    expect(setGuideStopRead(finished, 2, true, 3)).toBe(finished);
    expect([...setGuideStopRead(finished, 1, false, 3).readStops]).toEqual([2]);
    expect(EMPTY_GUIDE_PROGRESS.readStops.size).toBe(0);
  });
  it("bounds navigation and isolates rewrites and new heads", () => {
    expect(moveGuideProgress(EMPTY_GUIDE_PROGRESS, 20, 2).position).toBe(1);
    expect(moveGuideProgress(EMPTY_GUIDE_PROGRESS, -1, 2).position).toBe(0);
    expect(moveGuideProgress(EMPTY_GUIDE_PROGRESS, 4, 0, true)).toBe(EMPTY_GUIDE_PROGRESS);
    expect(setGuideStopRead(EMPTY_GUIDE_PROGRESS, 2, true, 2)).toBe(EMPTY_GUIDE_PROGRESS);
    const guide = { headSha: "head", generatedAt: "2026-10-01" };
    expect(guideProgressVersion(guide)).not.toBe(
      guideProgressVersion({ ...guide, generatedAt: "2026-10-02" }),
    );
    expect(guideProgressVersion(guide)).not.toBe(
      guideProgressVersion({ ...guide, headSha: "new" }),
    );
  });
});
