import { describe, expect, it } from "vite-plus/test";
import { canRestoreForwardNavigation } from "./forwardNavigation";

describe("forward navigation", () => {
  it("restores only from the stack left by Back and discards a divergent navigation", () => {
    const destination = {
      index: 2,
      routes: [{ key: "home" }, { key: "thread" }, { key: "files" }],
    };
    expect(
      canRestoreForwardNavigation(
        { index: 1, routes: destination.routes.slice(0, 2) },
        destination,
      ),
    ).toBe(true);
    expect(
      canRestoreForwardNavigation(
        { index: 1, routes: [{ key: "home" }, { key: "another-thread" }] },
        destination,
      ),
    ).toBe(false);
    expect(canRestoreForwardNavigation(destination, destination)).toBe(false);
  });
});
