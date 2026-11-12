import { describe, expect, it } from "vite-plus/test";
import { browserAddress } from "./browserAddress";

describe("mobile browser address", () => {
  it.each([
    ["localhost:5173", "http://localhost:5173/"],
    ["example.com/docs", "https://example.com/docs"],
    ["two words", "https://www.google.com/search?q=two%20words"],
  ])("normalizes %s using the configured search engine", (input, expected) => {
    expect(
      browserAddress(input, { browserSearchEngine: "google", browserCustomSearchUrl: "" }),
    ).toBe(expected);
  });

  it("uses custom templates and falls back for invalid ones", () => {
    expect(
      browserAddress("a & b", {
        browserSearchEngine: "custom",
        browserCustomSearchUrl: "https://search.example/?q=%s",
      }),
    ).toBe("https://search.example/?q=a%20%26%20b");
    expect(
      browserAddress("hello", {
        browserSearchEngine: "custom",
        browserCustomSearchUrl: "https://%s.example/",
      }),
    ).toBe("https://duckduckgo.com/?q=hello");
    expect(() => browserAddress("javascript:alert(1)", null)).toThrow();
    expect(() => browserAddress("   ", null)).toThrow();
  });
});
