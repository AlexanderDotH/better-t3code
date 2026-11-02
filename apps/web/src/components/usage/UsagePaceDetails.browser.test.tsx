import { act, render as renderTest, type Screen } from "../../../test/render";
import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { expect, it, vi } from "vite-plus/test";
import { TooltipProvider } from "../ui/tooltip";
import { UsagePaceBar, UsagePaceDetails, UsagePaceHeaderLabel } from "./UsagePaceDetails";
const settings = vi.hoisted(() => ({
  usagePacingEnabled: true,
  usagePacingWorkdayHours: 8,
}));
vi.mock("../../hooks/useSettings", () => ({
  useClientSettings: () => settings,
}));
vi.mock("../../hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () =>
    createInterfaceTranslator({
      language: "en",
      locale: "en-US",
    }),
}));
it("shows unavailable pace without daily figures and restores them when complete history arrives", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const at = (day: number, hour: number) => new Date(2026, 8, day, hour).toISOString();
  const window: ServerProviderUsageWindow = {
    id: "weekly",
    kind: "weekly",
    label: "Weekly",
    usedPercent: 6,
    windowDurationMins: 10_080,
    resetsAt: at(20, 0),
    usageHistorySource: "codex",
  };
  const now = Date.parse(at(19, 14));
  const partialHistory = [
    {
      at: at(19, 12),
      usedPercent: 5,
      hasUsage: true,
    },
    {
      at: at(19, 13),
      usedPercent: 6,
      hasUsage: true,
    },
  ];
  const container = document.createElement("div");
  document.body.append(container);
  await using screen: Screen = await renderTest(null, {
    container: container,
    /* The fixture exercises local state without router navigation.*/ router: false,
  });
  const render = async (usageHistory: ServerProviderUsageWindow["usageHistory"]) =>
    await act(async () => {
      const current = {
        ...window,
        usageHistory,
      };
      await screen.rerender(
        <TooltipProvider>
          <UsagePaceHeaderLabel window={current} now={now} />
          <UsagePaceBar window={current} now={now} />
          <UsagePaceDetails window={current} now={now} statusInHeader />
        </TooltipProvider>,
      );
    });
  try {
    for (const usageHistory of [undefined, [], partialHistory]) {
      await render(usageHistory);
      expect(container.textContent).toContain("Pace unavailable");
      expect(container.textContent).not.toContain("%");
      expect(container.querySelector('[role="meter"]')).toBeNull();
    }
    await render([
      {
        at: at(18, 22),
        usedPercent: 5,
      },
      ...partialHistory,
    ]);
    expect(container.textContent).not.toContain("Pace unavailable");
    expect(container.textContent).toContain("left today");
    expect(container.textContent).toContain("budget today");
    expect(container.textContent).toContain("catch-up left");
    expect(container.querySelector('[role="meter"]')).not.toBeNull();
    await render(partialHistory);
    expect(container.textContent).toContain("Pace unavailable");
    expect(container.textContent).not.toContain("%");
    expect(container.querySelector('[role="meter"]')).toBeNull();
    settings.usagePacingEnabled = false;
    await render(partialHistory);
    expect(container.textContent).toBe("");
  } finally {
    settings.usagePacingEnabled = true;
    await act(async () => {
      await screen.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  }
});
