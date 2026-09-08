import { describe, expect, it } from "vite-plus/test";

import {
  connectionNoticeDetail,
  connectionNoticeSupportsRetryNow,
} from "./environmentRecoveryPresentation";

const NOW = 1_787_169_600_000;

describe("connectionNoticeDetail", () => {
  it("describes scheduled and active automatic retries truthfully", () => {
    expect(
      connectionNoticeDetail(
        {
          phase: "reconnecting",
          error: "The host did not respond.",
          retry: { mode: "automatic", at: NOW + 4_000 },
          failure: {
            kind: "transient",
            reason: "timeout",
            detail: "The host did not respond.",
            traceId: null,
          },
        },
        "terminal",
        NOW,
      ),
    ).toBe("The app will retry automatically in 4s. The host did not respond.");

    expect(
      connectionNoticeDetail(
        {
          phase: "reconnecting",
          error: "The socket closed.",
          retry: { mode: "automatic", at: null },
          failure: {
            kind: "transient",
            reason: "transport",
            detail: "The socket closed.",
            traceId: null,
          },
        },
        "review",
        NOW,
      ),
    ).toBe("The app is retrying automatically. The socket closed.");
  });

  it("never promises automatic retries for blocked authentication", () => {
    expect(
      connectionNoticeDetail(
        {
          phase: "error",
          error: "The pairing credential expired.",
          retry: { mode: "manual", at: null },
          failure: {
            kind: "blocked",
            reason: "authentication",
            detail: "The pairing credential expired.",
            traceId: null,
          },
        },
        "terminal",
        NOW,
      ),
    ).toBe(
      "Open Environments to sign in or pair again before loading the terminal. The pairing credential expired.",
    );
  });

  it("keeps offline task submissions queued while describing cached data", () => {
    expect(
      connectionNoticeDetail(
        { phase: "offline", error: null, retry: { mode: "none", at: null }, failure: null },
        "review",
        NOW,
      ),
    ).toBe(
      "Cached data remains available, and offline task submissions stay queued. The review will load when your connection returns.",
    );
  });
});

describe("connectionNoticeSupportsRetryNow", () => {
  it("shows retry only when it can initiate or accelerate useful work", () => {
    expect(
      connectionNoticeSupportsRetryNow({
        phase: "reconnecting",
        retry: { mode: "automatic", at: NOW + 4_000 },
      }),
    ).toBe(true);
    expect(
      connectionNoticeSupportsRetryNow({
        phase: "reconnecting",
        retry: { mode: "automatic", at: null },
      }),
    ).toBe(false);
    expect(
      connectionNoticeSupportsRetryNow({
        phase: "error",
        retry: { mode: "manual", at: null },
      }),
    ).toBe(false);
    expect(
      connectionNoticeSupportsRetryNow({
        phase: "available",
        retry: { mode: "none", at: null },
      }),
    ).toBe(true);
  });
});
