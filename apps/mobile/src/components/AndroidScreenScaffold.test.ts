import { describe, expect, it } from "vite-plus/test";

import {
  resolveNavigationUpAction,
  resolveAndroidScreenHeaderVariant,
  resolveScreenContentBottomPadding,
} from "./AndroidScreenScaffold.logic";

describe("resolveAndroidScreenHeaderVariant", () => {
  it("uses the full safe-area header for an Android page", () => {
    expect(resolveAndroidScreenHeaderVariant("android", "page")).toBe("page");
  });

  it("uses the embedded header for an Android sheet", () => {
    expect(resolveAndroidScreenHeaderVariant("android", "sheet")).toBe("sheet");
  });

  it("leaves native iOS chrome in control", () => {
    expect(resolveAndroidScreenHeaderVariant("ios", "page")).toBeNull();
  });
});

describe("resolveNavigationUpAction", () => {
  it("returns to the previous route when the stack has history", () => {
    expect(resolveNavigationUpAction(true)).toBe("back");
  });

  it("returns a deep-linked root screen to Home", () => {
    expect(resolveNavigationUpAction(false)).toBe("home");
  });
});

describe("resolveScreenContentBottomPadding", () => {
  it("keeps 36 points of breathing room without a bottom safe-area inset", () => {
    expect(resolveScreenContentBottomPadding(0)).toBe(36);
  });

  it("adds content spacing after a 24-point bottom safe-area inset", () => {
    expect(resolveScreenContentBottomPadding(24)).toBe(42);
  });
});
