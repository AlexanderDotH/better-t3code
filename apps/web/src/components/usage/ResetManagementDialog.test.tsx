// @vitest-environment jsdom
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type UsageLimitsReport,
} from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { usageLimitsBannerItem } from "../chat/ComposerUsageLimits";
import { ComposerBannerStack } from "../chat/ComposerBannerStack";

const consume = vi.hoisted(() => vi.fn());
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => new Map() }));
vi.mock("../../state/presentation", () => ({
  environmentPresentations: { presentationsAtom: "presentations" },
}));
vi.mock("../../state/server", () => ({ serverEnvironment: { consumeResetCredit: "consume" } }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => consume }));
vi.mock("../../hooks/useSettings", () => ({
  useClientSettings: (select?: (settings: object) => unknown) => {
    const settings = { usagePacingEnabled: false };
    return select ? select(settings) : settings;
  },
  usePrimarySettings: (select?: (settings: object) => unknown) => {
    const settings = { timestampFormat: "locale" };
    return select ? select(settings) : settings;
  },
}));

const environmentId = EnvironmentId.make("environment");
const instanceId = ProviderInstanceId.make("codex");
const now = "2026-10-13T10:00:00.000Z";
function report(): UsageLimitsReport {
  return {
    createdAt: now,
    notices: [],
    accounts: [
      {
        id: "codex",
        label: "Codex",
        driver: ProviderDriverKind.make("codex"),
        instanceId,
        limits: {
          checkedAt: now,
          accountCredits: { hasCredits: true, unlimited: false, balance: "42.50" },
          windows: [
            {
              id: "primary",
              kind: "session",
              label: "Session",
              usedPercent: 95,
              resetsAt: "2026-10-13T14:00:00.000Z",
            },
          ],
          resetCredits: {
            availableCount: 1,
            nextExpiresAt: "2026-11-01T10:00:00.000Z",
            credits: [
              {
                id: "available",
                status: "available",
                resetType: "codexRateLimits",
                title: "Available grant",
                grantedAt: now,
                expiresAt: "2026-11-01T10:00:00.000Z",
              },
              {
                id: "used",
                status: "redeemed",
                resetType: "codexRateLimits",
                title: "Previous reset",
                redeemedAt: "2026-10-12T10:00:00.000Z",
              },
            ],
          },
        },
      },
    ],
  };
}
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(now));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  consume.mockReset().mockResolvedValue({ _tag: "Success", value: { outcome: "reset" } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, "getAnimations");
});
const button = (text: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (element) => element.textContent?.trim() === text,
  )!;

async function openManager(data = report()) {
  await act(async () =>
    root.render(
      <ComposerBannerStack
        items={[usageLimitsBannerItem("usage-test", data, environmentId, () => {})]}
      />,
    ),
  );
  const trigger = document.querySelector<HTMLButtonElement>('[aria-label="Usage limit options"]')!;
  const dismiss = document.querySelector('[aria-label="Dismiss usage limits"]')!;
  expect(trigger.compareDocumentPosition(dismiss) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(button("Use reset")).toBeUndefined();
  await act(async () => trigger.click());
  const action = document.querySelector<HTMLElement>('[role="menuitem"]')!;
  expect(action.textContent).toContain("Manage resets");
  await act(async () => action.click());
}

describe("reset management", () => {
  it("opens from the overflow menu and shows credits between the gauge and reset list", async () => {
    await openManager();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Manage resets");
    expect(dialog.textContent).toContain("42.5");
    expect(dialog.querySelector('[role="meter"]')?.getAttribute("aria-valuenow")).toBe("90");
    const text = dialog.textContent!;
    expect(text.indexOf("Good time to reset")).toBeLessThan(text.indexOf("ChatGPT credits"));
    expect(text.indexOf("ChatGPT credits")).toBeLessThan(text.indexOf("Available resets"));
    expect(dialog.querySelector('[role="separator"],[data-slot="separator"]')).not.toBeNull();
    expect(text).toContain("Available grant");
    expect(text).toContain("Current usage limits");
    expect(text).toContain("95% used");
    expect(text).toContain("Reset usage history");
    expect(text).toContain("Previous reset");
    expect(consume).not.toHaveBeenCalled();
  });

  it("requires the existing confirmation before consuming a reset", async () => {
    await openManager();
    await act(async () => button("Use reset").click());
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
      "Use a reset credit?",
    );
    expect(consume).not.toHaveBeenCalled();
    await act(async () => button("Use credit").click());
    expect(consume).toHaveBeenCalledExactlyOnceWith({ environmentId, input: { instanceId } });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("keeps cancellation and failed redemption in the management dialog", async () => {
    await openManager();
    await act(async () => button("Use reset").click());
    await act(async () => button("Cancel").click());
    expect(consume).not.toHaveBeenCalled();
    consume.mockResolvedValueOnce({
      _tag: "Failure",
      cause: { error: new Error("Account disconnected") },
    });
    await act(async () => button("Use reset").click());
    await act(async () => button("Use credit").click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Account disconnected",
    );
    expect(button("Use reset").disabled).toBe(false);
  });

  it("shows missing balances and history honestly, and disables redemption with no resets", async () => {
    const data = report();
    const account = data.accounts[0]!;
    await openManager({
      ...data,
      accounts: [
        {
          ...account,
          limits: {
            ...account.limits,
            accountCredits: undefined,
            resetCredits: { availableCount: 0 },
          },
        },
      ],
    });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Not reported");
    expect(dialog.textContent).toContain("No past redemptions were included");
    expect(dialog.querySelector('[role="meter"]')?.hasAttribute("aria-valuenow")).toBe(false);
    expect(button("Use reset").disabled).toBe(true);
    expect(consume).not.toHaveBeenCalled();
  });
});
