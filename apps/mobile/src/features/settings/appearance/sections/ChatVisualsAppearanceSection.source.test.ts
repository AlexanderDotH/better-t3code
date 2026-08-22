import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

const sectionSource = NodeFS.readFileSync(
  new URL("./ChatVisualsAppearanceSection.tsx", import.meta.url),
  "utf8",
);
const routeSource = NodeFS.readFileSync(
  new URL("../../SettingsAppearanceRouteScreen.tsx", import.meta.url),
  "utf8",
);

describe("ChatVisualsAppearanceSection source", () => {
  it("renders accessible selected and disabled radio state", () => {
    expect(sectionSource).toContain('accessibilityRole="radio"');
    expect(sectionSource).toContain("checked: chatVisualMode === option.mode");
    expect(sectionSource).toContain("disabled: !isReady");
  });

  it("is included in the cross-platform Appearance route", () => {
    expect(routeSource).toContain("<ChatVisualsAppearanceSection />");
  });
});
