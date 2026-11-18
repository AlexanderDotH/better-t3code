import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import {
  createInterfaceTranslator,
  type ResolvedInterfaceLocale,
} from "@t3tools/shared/interfaceLanguage";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { TooltipProvider } from "../ui/tooltip";
import { UsagePaceBar, UsageWindowDetails } from "./UsagePaceDetails";

const state = vi.hoisted(() => ({
  settings: { usagePacingEnabled: true, usagePacingWorkdayHours: 8 },
  locale: { language: "en", locale: "en-US" } as ResolvedInterfaceLocale,
}));
vi.mock("../../hooks/useSettings", () => ({
  useClientSettings: <T,>(selector?: (settings: typeof state.settings) => T) =>
    selector ? selector(state.settings) : state.settings,
}));
vi.mock("../../hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () => createInterfaceTranslator(state.locale),
}));
vi.mock("../../interfaceLanguageRuntime", () => ({
  useInterfaceLocaleRuntime: () => state.locale,
}));

function setup() {
  state.settings.usagePacingEnabled = true;
  state.settings.usagePacingWorkdayHours = 8;
  state.locale = { language: "en", locale: "en-US" };
  const window: ServerProviderUsageWindow = {
    id: "weekly",
    kind: "weekly",
    label: "Weekly",
    usedPercent: 40,
    windowDurationMins: 10_080,
    resetsAt: new Date(2026, 10, 16, 19, 41).toISOString(),
  };
  return { window, now: Date.parse(window.resetsAt!) - 3.5 * 24 * 60 * 60_000 };
}

it("shows weekly pace without history and omits it when unavailable or disabled", async () => {
  const { window, now } = setup();
  await using screen = await render(<UsageWindowDetails window={window} now={now} />);
  await expect.element(screen.getByText("Under pace")).toBeVisible();
  await expect.element(screen.getByText("Under pace")).toHaveClass("text-success-foreground");
  await expect.element(screen.locator).toHaveTextContent("Under pace · 3d 12h");
  await expect.element(screen.getByText("Pace unavailable")).not.toBeInTheDocument();
  await expect.element(screen.getByRole("meter")).not.toBeInTheDocument();

  await screen.rerender(<UsageWindowDetails window={{ ...window, usedPercent: 50 }} now={now} />);
  await expect.element(screen.getByText("On pace")).toHaveClass("text-muted-foreground");
  await screen.rerender(<UsageWindowDetails window={{ ...window, usedPercent: 80 }} now={now} />);
  await expect.element(screen.getByText("Ahead of pace")).toHaveClass("text-warning-foreground");

  await screen.rerender(
    <UsageWindowDetails window={{ ...window, windowDurationMins: undefined }} now={now} />,
  );
  await expect.element(screen.locator).toHaveTextContent("3d 12h");
  await expect.element(screen.getByText("·", { exact: true })).not.toBeInTheDocument();
  state.settings.usagePacingEnabled = false;
  await screen.rerender(<UsageWindowDetails window={window} now={now} />);
  await expect.element(screen.getByText("Under pace")).not.toBeInTheDocument();
  await expect.element(screen.getByText("3d 12h")).toBeVisible();
});

it.each([
  ["en", "en-US", "Monday, November 16, 7:41 PM"],
  ["de", "de-DE", "Montag, 16. November, 19:41"],
  ["fr", "fr-FR", "lundi 16 novembre, 19:41"],
] as const)("reveals the exact reset moment in %s on hover", async (language, locale, expected) => {
  const { window, now } = setup();
  state.locale = { language, locale };
  await using screen = await render(
    <TooltipProvider delay={0}>
      <UsageWindowDetails window={window} now={now} />
    </TooltipProvider>,
  );
  const time = screen.getByText("3d 12h");
  await expect.element(time).toHaveAttribute("datetime", window.resetsAt);
  expect(time.element().lastElementChild?.tagName).toBe("svg");
  await time.hover();
  await expect.element(page.getByRole("tooltip")).toHaveTextContent(expected);
  await userEvent.keyboard("{Tab}");
  expect(document.activeElement).toBe(time.element());
  await expect.element(page.getByRole("tooltip")).toHaveTextContent(expected);
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("tooltip")).not.toBeInTheDocument();
});

it.each(["weekly", "monthly", "other"] as const)(
  "keeps the %s daily bar absent until complete usage history arrives",
  async (kind) => {
    const { window } = setup();
    const at = (day: number, hour: number) => new Date(2026, 10, day, hour).toISOString();
    const now = Date.parse(at(16, 14));
    const partialHistory = [
      { at: at(16, 12), usedPercent: 5 },
      { at: at(16, 13), usedPercent: 6 },
    ];
    const current = { ...window, kind, usedPercent: 6, usageHistorySource: "observed" as const };
    await using screen = await render(<UsagePaceBar window={current} now={now} />);
    await expect.element(screen.getByRole("meter")).not.toBeInTheDocument();
    await screen.rerender(
      <UsagePaceBar window={{ ...current, usageHistory: partialHistory }} now={now} />,
    );
    await expect.element(screen.getByRole("meter")).not.toBeInTheDocument();
    await screen.rerender(
      <UsagePaceBar
        window={{
          ...current,
          usageHistory: [{ at: at(15, 22), usedPercent: 5 }, ...partialHistory],
        }}
        now={now}
      />,
    );
    await expect.element(screen.getByRole("meter")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("meter"))
      .toHaveAccessibleName("Today's allowance remaining, including catch-up");
    await expect
      .element(screen.getByRole("meter"))
      .toHaveAttribute("aria-valuetext", expect.stringContaining("catch-up left"));
  },
);
