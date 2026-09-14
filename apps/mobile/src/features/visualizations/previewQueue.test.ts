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
