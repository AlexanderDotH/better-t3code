import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { CHATGPT_USAGE_URL } from "@t3tools/shared/usageLimits";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { UsageLimitsPooled } from "./UsageLimitsPooled";
import { TooltipProvider } from "../ui/tooltip";
import { usageLimitsBannerItem } from "../chat/ComposerUsageLimits";
import { ThreadDetailsUsage } from "../chat/ThreadDetailsUsage";

vi.mock("../../hooks/useNowMinute", () => ({
  useNowMinute: () => "2026-11-13T07:41",
}));

const checkedAt = "2026-10-25T16:00:00.000Z";

function managedChatGpt(instanceId: string, displayName: string): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make("codex"),
    displayName,
    enabled: true,
    installed: true,
    version: "0.164.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits: {
      checkedAt,
      windows: [],
      unavailable: { reason: "unsupported", message: "Track usage in ChatGPT." },
      externalUsage: { label: "ChatGPT usage", url: CHATGPT_USAGE_URL },
    },
  };
}

function weeklyQuota() {
  const window: ServerProviderUsageWindow = {
    id: "seven_day",
    kind: "weekly",
    label: "Weekly",
    usedPercent: 40,
    windowDurationMins: 10_080,
    resetsAt: new Date(2026, 10, 16, 19, 41).toISOString(),
  };
  return { window, now: Date.parse(window.resetsAt!) - 3.5 * 24 * 60 * 60_000 };
}

it("shows weekly pace in the composer row without a separate header or daily pace line", async () => {
  const { window, now } = weeklyQuota();
  const banner = usageLimitsBannerItem(
    "limits",
    {
      createdAt: new Date(now).toISOString(),
      accounts: [
        {
          id: "claude",
          driver: ProviderDriverKind.make("claudeAgent"),
          label: "Claude",
          plan: "Claude Max Subscription",
          limits: { checkedAt, windows: [window] },
        },
      ],
      notices: [],
    },
    EnvironmentId.make("desk"),
    () => {},
  );
  await using screen = await render(
    <TooltipProvider delay={0}>
      {banner.description}
      {banner.children}
    </TooltipProvider>,
  );
  await expect.element(screen.getByText("Claude · Claude Max Subscription")).toBeVisible();
  await expect.element(screen.getByText("Under pace")).toBeVisible();
  await expect.element(screen.getByText("Pace unavailable")).not.toBeInTheDocument();
  await screen.getByText("3d 12h").hover();
  await expect.element(page.getByRole("tooltip")).toHaveTextContent("Monday, November 16, 7:41 PM");
});

it("uses the same weekly pace in pooled account rows and their popovers", async () => {
  const { window, now } = weeklyQuota();
  const provider: ServerProvider = {
    ...managedChatGpt("claude", "Claude quota"),
    driver: ProviderDriverKind.make("claudeAgent"),
    usageLimits: { checkedAt, windows: [window] },
  };
  const presentations = new Map([
    [
      EnvironmentId.make("desk"),
      { entry: { target: { label: "Desk" } }, serverConfig: { providers: [provider] } },
    ],
  ]);
  await using screen = await render(
    <TooltipProvider delay={0}>
      <UsageLimitsPooled presentations={presentations} now={now} />
    </TooltipProvider>,
  );
  const row = screen.getByRole("button", { name: /Segment 1/ });
  await expect.element(row.getByText("Under pace")).toBeVisible();
  await row.click();
  await expect.element(page.getByText("Left", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Pace unavailable")).not.toBeInTheDocument();
});

it.each(["weekly", "monthly"] as const)(
  "keeps each account's %s catch-up in its own bar and popover",
  async (kind) => {
    const at = (day: number, hour: number) => new Date(2026, 10, day, hour).toISOString();
    const now = Date.parse(at(16, 14));
    const windows = (usedPercent: number, baseline: number): ServerProviderUsageWindow[] => [
      {
        ...weeklyQuota().window,
        kind,
        windowDurationMins: kind === "monthly" ? 30 * 24 * 60 : 10_080,
        resetsAt: at(20, 0),
        usageHistorySource: "observed",
        usedPercent,
        usageHistory: [
          { at: at(15, 22), usedPercent: baseline },
          { at: at(16, 9), usedPercent },
        ],
      },
    ];
    const providers: ServerProvider[] = [
      {
        ...managedChatGpt("first", "First"),
        driver: ProviderDriverKind.make("cursor"),
        usageLimits: { checkedAt: at(16, 9), windows: windows(6, 5) },
      },
      {
        ...managedChatGpt("second", "Second"),
        driver: ProviderDriverKind.make("cursor"),
        usageLimits: { checkedAt: at(16, 9), windows: windows(70, 69) },
      },
    ];
    const presentations = new Map([
      [
        EnvironmentId.make("desk"),
        { entry: { target: { label: "Desk" } }, serverConfig: { providers } },
      ],
    ]);
    await using screen = await render(
      <TooltipProvider delay={0}>
        <UsageLimitsPooled presentations={presentations} now={now} />
      </TooltipProvider>,
    );
    expect(screen.getByRole("meter").elements()).toHaveLength(2);
    const first = screen
      .getByRole("meter", { name: "Today's allowance remaining, including catch-up" })
      .first();
    await expect.element(first).toBeInTheDocument();
    await screen.getByRole("button", { name: /^First:/ }).click();
    await expect.element(page.getByText(/catch-up left/)).toBeVisible();
    await expect.element(page.getByText(/budget today/)).toBeVisible();
    await expect
      .element(page.getByText("The filled bar shows the quota left.", { exact: false }))
      .toBeVisible();
  },
);

it("uses the shared weekly pace and reset display in the thread details sidebar", async () => {
  const { window } = weeklyQuota();
  const provider: ServerProvider = {
    ...managedChatGpt("claude", "Claude quota"),
    driver: ProviderDriverKind.make("claudeAgent"),
    usageLimits: {
      checkedAt,
      windows: [{ ...window, resetsAt: "2026-11-16T19:41:00.000Z" }],
    },
  };
  await using screen = await render(
    <ThreadDetailsUsage
      providerInstanceId={provider.instanceId}
      providers={[provider]}
      sources={[]}
    />,
  );
  await expect.element(screen.getByText("Under pace")).toBeVisible();
  await expect.element(screen.getByText("3d 12h")).toBeVisible();
});

describe("UsageLimitsPooled ChatGPT usage card", () => {
  it("names the managed connections it covers", async () => {
    const presentations = new Map([
      [
        EnvironmentId.make("desk"),
        {
          entry: { target: { label: "Desk" } },
          serverConfig: {
            providers: [
              managedChatGpt("chatgpt_work", "ChatGPT Work"),
              managedChatGpt("chatgpt_personal", "ChatGPT Personal"),
            ],
          },
        },
      ],
    ]);
    await using screen = await render(
      <UsageLimitsPooled presentations={presentations} now={Date.parse(checkedAt)} />,
    );

    await expect
      .element(screen.getByText("ChatGPT Work on Desk, ChatGPT Personal on Desk"))
      .toBeVisible();
    await expect
      .element(screen.getByText("View usage in ChatGPT with your connected account."))
      .toBeVisible();
  });
});
