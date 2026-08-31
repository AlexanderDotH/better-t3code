import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerStashBadge } from "./ComposerStashBadge";

describe("ComposerStashBadge", () => {
  it("uses typed stash copy while preserving the numeric state", () => {
    const markup = renderToStaticMarkup(
      <ComposerStashBadge
        count={3}
        menuOpen={false}
        pulseKey={0}
        pulsing={false}
        onToggleMenu={() => {}}
      />,
    );

    expect(markup).toContain("Stash");
    expect(markup).toContain("Stashed prompts: 3. Open stash.");
    expect(markup).toContain(">3<");
  });
});
