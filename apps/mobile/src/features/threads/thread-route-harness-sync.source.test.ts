import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

const routeSource = NodeFS.readFileSync(
  new URL("./ThreadRouteScreen.tsx", import.meta.url),
  "utf8",
);

describe("mobile thread route harness sync state", () => {
  it("feeds live detail-link updates into the shell-shaped composer model", () => {
    expect(routeSource).toContain(
      "harnessSync: selectedThreadDetail?.harnessSync ?? selectedThread.harnessSync",
    );
  });
});
