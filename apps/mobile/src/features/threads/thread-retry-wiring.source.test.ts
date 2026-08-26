import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

const feedSource = NodeFS.readFileSync(new URL("./ThreadFeed.tsx", import.meta.url), "utf8");
const detailSource = NodeFS.readFileSync(
  new URL("./ThreadDetailScreen.tsx", import.meta.url),
  "utf8",
);
const routeSource = NodeFS.readFileSync(
  new URL("./ThreadRouteScreen.tsx", import.meta.url),
  "utf8",
);
const actionSource = NodeFS.readFileSync(
  new URL("./use-thread-retry-action.ts", import.meta.url),
  "utf8",
);

describe("mobile interrupted turn retry wiring", () => {
  it("gates and dispatches the exact existing user message as a result-only retry", () => {
    expect(routeSource).toContain("capabilities.interruptedTurnRetry === true");
    expect(routeSource).toContain("busy: composer.activeThreadBusy");
    expect(actionSource).toContain("resolveInterruptedTurnRetryTarget");
    expect(actionSource).toContain("session: input.thread.session");
    expect(actionSource).toContain("threadEnvironment.retryTurn");
    expect(actionSource).toContain("const visible = input.supported && target !== null");
    expect(actionSource).toContain("messageId: target.messageId");
    expect(actionSource).toContain("turnId: target.turnId");
  });

  it("renders one accessible refresh action on the retryable user row", () => {
    expect(feedSource).toContain(
      'accessibilityLabel={props.busy ? "Retrying response" : "Retry response"}',
    );
    expect(feedSource).toContain('name="arrow.clockwise"');
    expect(detailSource).toContain("retryAction={props.retryAction}");
  });
});
