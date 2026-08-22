import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { describe } from "vite-plus/test";

import {
  assetResponseHeaders,
  handleBrowserOtlpTracePayload,
  isLoopbackHostname,
  resolveDevRedirectUrl,
} from "./http.ts";

describe("http dev routing", () => {
  it("treats localhost and loopback addresses as local", () => {
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
  });

  it("does not treat LAN addresses as local", () => {
    expect(isLoopbackHostname("192.168.86.35")).toBe(false);
    expect(isLoopbackHostname("10.0.0.24")).toBe(false);
    expect(isLoopbackHostname("example.local")).toBe(false);
  });

  it("preserves path and query when redirecting to the dev server", () => {
    const devUrl = new URL("http://127.0.0.1:5173/");
    const requestUrl = new URL("http://127.0.0.1:3774/pair?token=test-token");

    expect(resolveDevRedirectUrl(devUrl, requestUrl)).toBe(
      "http://127.0.0.1:5173/pair?token=test-token",
    );
  });
});

describe("assetResponseHeaders", () => {
  it("sandboxes SVG assets", () => {
    expect(assetResponseHeaders("/attachments/user-image.svg")).toMatchObject({
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    });
    expect(assetResponseHeaders("/attachments/user-image.SVG")).toHaveProperty(
      "Content-Security-Policy",
    );
  });

  it("does not apply document policy to raster images", () => {
    expect(assetResponseHeaders("/attachments/user-image.png")).toEqual({
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
  });

  it("declares utf-8 for HTML assets so non-ASCII content renders correctly", () => {
    expect(assetResponseHeaders("/workspace/page.html")).toHaveProperty(
      "Content-Type",
      "text/html; charset=utf-8",
    );
    expect(assetResponseHeaders("/workspace/PAGE.HTM")).toHaveProperty(
      "Content-Type",
      "text/html; charset=utf-8",
    );
  });
});

describe("browser OTLP trace ingestion", () => {
  it.effect("rejects malformed payloads before recording or forwarding them", () =>
    Effect.gen(function* () {
      let recordCalls = 0;
      let exportCalls = 0;

      const response = yield* handleBrowserOtlpTracePayload(
        { resourceSpans: [{}] },
        {
          record: () =>
            Effect.sync(() => {
              recordCalls += 1;
            }),
          export: () =>
            Effect.sync(() => {
              exportCalls += 1;
              return true;
            }),
        },
      );

      expect(response.status).toBe(400);
      expect(recordCalls).toBe(0);
      expect(exportCalls).toBe(0);
    }),
  );

  it.effect("records and forwards a valid empty OTLP envelope", () =>
    Effect.gen(function* () {
      const body = { resourceSpans: [] };
      const recorded: Array<number> = [];
      const forwarded: Array<unknown> = [];

      const response = yield* handleBrowserOtlpTracePayload(body, {
        record: (records) =>
          Effect.sync(() => {
            recorded.push(records.length);
          }),
        export: (payload) =>
          Effect.sync(() => {
            forwarded.push(payload);
            return true;
          }),
      });

      expect(response.status).toBe(204);
      expect(recorded).toEqual([0]);
      expect(forwarded).toEqual([body]);
    }),
  );
});
