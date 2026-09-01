import { describe, expect, it } from "vite-plus/test";

import messagesTimelineSource from "./MessagesTimeline.tsx?raw";

describe("MessagesTimeline horizontal layout", () => {
  it("keeps responsive gutters on timeline content instead of the virtualized viewport", () => {
    const legendListStart = messagesTimelineSource.indexOf("<LegendList<MessagesTimelineRow>");
    const legendListHeader = messagesTimelineSource.indexOf(
      "ListHeaderComponent=",
      legendListStart,
    );
    const legendListViewportProps = messagesTimelineSource.slice(legendListStart, legendListHeader);

    expect(legendListStart).toBeGreaterThanOrEqual(0);
    expect(legendListHeader).toBeGreaterThan(legendListStart);
    expect(messagesTimelineSource).toContain(
      '"mx-auto w-full min-w-0 max-w-[calc(48rem+1.5rem)] px-3 sm:max-w-[calc(48rem+2.5rem)] sm:px-5"',
    );
    expect(messagesTimelineSource).toContain(
      'cn(TIMELINE_CONTENT_GUTTER_CLASS_NAME, "overflow-x-clip")',
    );
    expect(legendListViewportProps).not.toMatch(/\b(?:px-3|sm:px-5)\b/);
  });
});
