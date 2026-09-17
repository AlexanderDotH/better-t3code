import { describe, expect, it, vi } from "vite-plus/test";

import {
  createMarkdownTableStateStore,
  MARKDOWN_TABLE_STATE_STORAGE_KEY,
} from "./markdownTableState";

function createStorage(initialValue?: string) {
  const values = new Map(initialValue ? [[MARKDOWN_TABLE_STATE_STORAGE_KEY, initialValue]] : []);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

describe("markdown table state persistence", () => {
  it("restores expansion and custom widths in a fresh store without saving defaults on read", () => {
    const storage = createStorage();
    const store = createMarkdownTableStateStore(() => storage);
    expect(store.get("new-table")).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();

    store.set("collapsed", { expanded: false, width: 1200 });
    store.set("expanded", { expanded: true, width: 1300 });
    store.set("default-width", { expanded: false, width: null });

    const restarted = createMarkdownTableStateStore(() => storage);
    expect(restarted.get("collapsed")).toEqual({ expanded: false, width: 1200 });
    expect(restarted.get("expanded")).toEqual({ expanded: true, width: 1300 });
    expect(restarted.get("default-width")).toEqual({ expanded: false, width: null });
    expect(restarted.get("another-table")).toBeNull();
  });

  it.each(["broken json", "null", "{}", "false"])(
    "recovers from invalid stored JSON: %s",
    (raw) => {
      const storage = createStorage(raw);
      const store = createMarkdownTableStateStore(() => storage);
      expect(store.get("table")).toBeNull();
      store.set("table", { expanded: false, width: null });
      expect(createMarkdownTableStateStore(() => storage).get("table")).toEqual({
        expanded: false,
        width: null,
      });
    },
  );

  it("ignores malformed entries without discarding valid tables", () => {
    const storage = createStorage(
      JSON.stringify([
        ["valid", { expanded: false, width: 1200 }],
        ["negative", { expanded: true, width: -1 }],
        ["zero", { expanded: true, width: 0 }],
        ["text-width", { expanded: true, width: "1200" }],
        ["text-expanded", { expanded: "false", width: 1200 }],
        ["missing-width", { expanded: true }],
        ["empty", null],
        [42, { expanded: false, width: null }],
        ["", { expanded: false, width: null }],
        null,
      ]),
    );
    const store = createMarkdownTableStateStore(() => storage);
    expect(store.get("valid")).toEqual({ expanded: false, width: 1200 });
    for (const key of [
      "negative",
      "zero",
      "text-width",
      "text-expanded",
      "missing-width",
      "empty",
    ]) {
      expect(store.get(key)).toBeNull();
    }
    const overflow = createStorage('[["table",{"expanded":true,"width":1e309}]]');
    expect(createMarkdownTableStateStore(() => overflow).get("table")).toBeNull();
  });

  it("keeps only the 1000 most recently used tables, including after a restart", () => {
    const state = { expanded: false, width: null };
    const storage = createStorage(
      JSON.stringify(Array.from({ length: 1000 }, (_, index) => [`table-${index}`, state])),
    );
    const store = createMarkdownTableStateStore(() => storage);
    expect(store.get("table-0")).toEqual(state);
    store.set("new-table", state);

    const restarted = createMarkdownTableStateStore(() => storage);
    expect(restarted.get("table-0")).toEqual(state);
    expect(restarted.get("table-1")).toBeNull();
    expect(restarted.get("new-table")).toEqual(state);
  });

  it("bounds serialized storage without discarding newer tables", () => {
    const storage = createStorage();
    const store = createMarkdownTableStateStore(() => storage);
    const keyPrefix = "x".repeat(40_000);
    const state = { expanded: false, width: null };
    for (let index = 0; index < 20; index += 1) {
      store.set(`${keyPrefix}-${index}`, state);
    }
    const raw = storage.getItem(MARKDOWN_TABLE_STATE_STORAGE_KEY)!;
    expect(raw.length * 2).toBeLessThanOrEqual(1024 * 1024);
    const restarted = createMarkdownTableStateStore(() => storage);
    expect(restarted.get(`${keyPrefix}-0`)).toBeNull();
    expect(restarted.get(`${keyPrefix}-19`)).toEqual(state);
  });

  it("retains session state when storage access or writes fail", () => {
    const unavailable = createMarkdownTableStateStore(() => {
      throw new Error("Storage is disabled");
    });
    unavailable.set("table", { expanded: false, width: 1200 });
    expect(unavailable.get("table")).toEqual({ expanded: false, width: 1200 });

    const storage = createStorage('[["table",{"expanded":true,"width":1200}]]');
    storage.setItem.mockImplementation(() => {
      throw new Error("Storage is full");
    });
    const store = createMarkdownTableStateStore(() => storage);
    expect(store.get("table")).toEqual({ expanded: true, width: 1200 });
    store.set("table", { expanded: false, width: 1300 });
    expect(store.get("table")).toEqual({ expanded: false, width: 1300 });
  });
});
