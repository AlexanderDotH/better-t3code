import { describe, expect, it } from "vite-plus/test";

import legacySidebarSource from "./LegacySidebar.tsx?raw";

describe("LegacySidebar settled-thread settings", () => {
  it("honors the user's settle-on-merge preference in grouped project chats", () => {
    expect(legacySidebarSource).toContain("useClientSettings((s) => s.sidebarAutoSettleOnMerge)");
    expect(legacySidebarSource).toContain("autoSettleOnMerge: sidebarAutoSettleOnMerge");
    expect(legacySidebarSource).toContain("updatedAt: prUpdatedAt");
    expect(legacySidebarSource).toContain("changeRequest,");
    expect(legacySidebarSource).not.toContain(
      "changeRequestState: changeRequestStateByKey.get(threadKey)",
    );
  });
});
