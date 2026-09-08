import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { startHomeFocusMinuteClock } from "./home-focus-clock";

describe("Home focus minute clock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes immediately, advances once per minute, and stops after focus cleanup", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T12:34:45.000Z"));
    const minutes: string[] = [];

    const cleanup = startHomeFocusMinuteClock((minute) => minutes.push(minute));

    expect(minutes).toEqual(["2026-08-30T12:34"]);

    vi.advanceTimersByTime(60_000);
    expect(minutes).toEqual(["2026-08-30T12:34", "2026-08-30T12:35"]);

    cleanup();
    vi.advanceTimersByTime(120_000);
    expect(minutes).toEqual(["2026-08-30T12:34", "2026-08-30T12:35"]);
  });
});
