import { describe, expect, it } from "vite-plus/test";
import {
  VISUALIZATION_CHANNEL,
  type VisualizationRenderRequest,
} from "@t3tools/client-runtime/visualizations/model";

import { createPreviewQueue } from "./previewQueue";

function request(requestId: string, source = requestId): VisualizationRenderRequest {
  return {
    channel: VISUALIZATION_CHANNEL,
    type: "render",
    requestId,
    format: "mermaid",
    source,
    theme: "light",
  };
}

describe("mobile diagram preview queue", () => {
  it.each([
    ["fontFamily", "Georgia, serif"],
    ["background", "#f1f3f5"],
    ["foreground", "#223344"],
    ["mutedForeground", "#667788"],
    ["surface", "#e1e3e5"],
    ["border", "#aabbcc"],
  ] as const)("refreshes cached previews when %s changes", async (field, value) => {
    const renders: Array<string | null> = [];
    const queue = createPreviewQueue((request) => renders.push(request?.requestId ?? null));
    const appearance = {
      fontFamily: "Arial, sans-serif",
      background: "#ffffff",
      foreground: "#111111",
      mutedForeground: "#555555",
      surface: "#eeeeee",
      border: "#cccccc",
    };
    const original = { ...request("original", "flowchart LR\nAlpha-->Beta"), appearance };
    const controller = new AbortController();
    try {
      const first = queue.request(original, controller.signal);
      queue.result("original", "<svg>Original appearance</svg>");
      expect(await first).toBe("<svg>Original appearance</svg>");
      expect(
        await queue.request(
          { ...original, requestId: "cached", appearance: { ...appearance } },
          controller.signal,
        ),
      ).toBe("<svg>Original appearance</svg>");
      expect(renders).toEqual(["original", null]);

      const changed = queue.request(
        { ...original, requestId: "changed", appearance: { ...appearance, [field]: value } },
        controller.signal,
      );
      expect(renders).toEqual(["original", null, "changed"]);
      queue.result("changed", "<svg>Changed appearance</svg>");
      expect(await changed).toBe("<svg>Changed appearance</svg>");
      expect(await queue.request({ ...original, requestId: "restored" }, controller.signal)).toBe(
        "<svg>Original appearance</svg>",
      );
      expect(renders).toEqual(["original", null, "changed", null]);
    } finally {
      queue.dispose();
    }
  });

  it("serializes previews, ignores a cancelled result, and reuses cached output", async () => {
    const renders: Array<string | null> = [];
    const queue = createPreviewQueue((request) => renders.push(request?.requestId ?? null));
    const first = new AbortController();
    const cancelled = queue
      .request(request("first"), first.signal)
      .catch((error: Error) => error.message);
    const second = queue.request(request("second"), new AbortController().signal);
    expect(renders).toEqual(["first"]);
    first.abort();
    expect(await cancelled).toBe("Cancelled");
    expect(renders).toEqual(["first", "second"]);
    queue.result("first", "stale SVG");
    expect(renders).toEqual(["first", "second"]);
    queue.result("second", "<svg/>");
    expect(await second).toBe("<svg/>");
    expect(renders).toEqual(["first", "second", null]);
    expect(await queue.request(request("cached", "second"), new AbortController().signal)).toBe(
      "<svg/>",
    );
    expect(renders).toEqual(["first", "second", null]);
    queue.dispose();
  });

  it("skips waiting cancellations, drains errors, and clears work on unmount", async () => {
    const renders: Array<string | null> = [];
    const queue = createPreviewQueue((request) => renders.push(request?.requestId ?? null));
    const first = queue
      .request(request("first"), new AbortController().signal)
      .catch((error: Error) => error.message);
    const cancelled = new AbortController();
    const waiting = queue
      .request(request("waiting"), cancelled.signal)
      .catch((error: Error) => error.message);
    const last = queue
      .request(request("last"), new AbortController().signal)
      .catch((error: Error) => error.message);
    cancelled.abort();
    queue.result("first", new Error("Invalid diagram"));
    expect(await first).toBe("Invalid diagram");
    expect(await waiting).toBe("Cancelled");
    expect(renders).toEqual(["first", "last"]);
    queue.dispose();
    expect(await last).toBe("Cancelled");
    queue.result("last", "late SVG");
    expect(renders).toEqual(["first", "last"]);
  });
});
