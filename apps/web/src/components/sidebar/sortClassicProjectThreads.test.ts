import { describe, expect, it } from "vite-plus/test";

import { sortClassicProjectThreads } from "./sortClassicProjectThreads";

const thread = (id: string, createdAt: string, pinnedAt: string | null = null) => ({
  id,
  createdAt,
  updatedAt: createdAt,
  pinnedAt,
  pinOrderKey: null,
});

describe("sortClassicProjectThreads", () => {
  it("keeps favorites at the top of each project's list", () => {
    const threads = [
      thread("new", "2026-03-09T12:00:00.000Z"),
      thread("favorite", "2026-03-09T08:00:00.000Z", "2026-03-09T13:00:00.000Z"),
      thread("middle", "2026-03-09T10:00:00.000Z"),
    ];

    expect(sortClassicProjectThreads(threads, "created_at").map(({ id }) => id)).toEqual([
      "favorite",
      "new",
      "middle",
    ]);
    expect(threads.map(({ id }) => id)).toEqual(["new", "favorite", "middle"]);
  });

  it("returns an unfavorited chat to the ordinary order", () => {
    const favorite = thread("old", "2026-03-09T08:00:00.000Z", "2026-03-09T13:00:00.000Z");
    const newest = thread("new", "2026-03-09T12:00:00.000Z");

    expect(sortClassicProjectThreads([favorite, newest], "created_at")[0]?.id).toBe("old");
    expect(
      sortClassicProjectThreads([{ ...favorite, pinnedAt: null }, newest], "created_at")[0]?.id,
    ).toBe("new");
  });

  it("restores saved pin order alongside favorites from older servers", () => {
    const threads = [
      thread("ordinary", "2026-03-09T14:00:00.000Z"),
      thread("keyless", "2026-03-09T12:00:00.000Z", "2026-03-09T13:00:00.000Z"),
      {
        ...thread("second", "2026-03-09T10:00:00.000Z", "2026-03-09T13:00:00.000Z"),
        pinOrderKey: "n",
      },
      {
        ...thread("first", "2026-03-09T08:00:00.000Z", "2026-03-09T13:00:00.000Z"),
        pinOrderKey: "g",
      },
    ];

    expect(sortClassicProjectThreads(threads, "created_at").map(({ id }) => id)).toEqual([
      "first",
      "second",
      "keyless",
      "ordinary",
    ]);
  });

  it("keeps the selected activity order below favorites when pin fields are absent", () => {
    const threads = [
      {
        id: "recently-created",
        createdAt: "2026-03-09T12:00:00.000Z",
        updatedAt: "2026-03-09T12:00:00.000Z",
      },
      {
        id: "recently-active",
        createdAt: "2026-03-09T08:00:00.000Z",
        updatedAt: "2026-03-09T13:00:00.000Z",
      },
      thread("favorite", "2026-03-09T06:00:00.000Z", "2026-03-09T13:00:00.000Z"),
    ];

    expect(sortClassicProjectThreads(threads, "updated_at").map(({ id }) => id)).toEqual([
      "favorite",
      "recently-active",
      "recently-created",
    ]);
  });

  it("orders matching thread IDs deterministically across environments", () => {
    const favorite = thread("same-id", "2026-03-09T08:00:00.000Z", "2026-03-09T13:00:00.000Z");
    const threads = [
      { ...favorite, environmentId: "remote" },
      { ...favorite, environmentId: "local" },
    ];

    const order = (items: typeof threads) =>
      sortClassicProjectThreads(items, "created_at").map(({ environmentId }) => environmentId);

    expect(order(threads)).toEqual(["local", "remote"]);
    expect(order(threads.toReversed())).toEqual(["local", "remote"]);
  });
});
