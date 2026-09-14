import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

import { UsagePaceBar } from "./UsagePaceDetails";

const settings = vi.hoisted(() => ({ usagePacingEnabled: true, usagePacingWorkdayHours: 8 }));
vi.mock("../../hooks/useSettings", () => ({ useClientSettings: () => settings }));
vi.mock("../../hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () => createInterfaceTranslator({ language: "en", locale: "en-US" }),
}));

it("keeps today's allowance at the right edge of the weekly remainder while spending catch-up first", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const at = (day: number, hour: number) => new Date(2026, 8, day, hour).toISOString();
  const window: ServerProviderUsageWindow = {
    id: "weekly",
    kind: "weekly",
    label: "Weekly",
    usedPercent: 6,
    windowDurationMins: 10_080,
    resetsAt: at(20, 0),
    usageHistory: [
      { at: at(13, 8), usedPercent: 0 },
      { at: at(13, 9), usedPercent: 1 },
    ],
  };
  const now = Date.parse(at(13, 13));
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(() => {
      renderer = create(<UsagePaceBar window={window} now={now} />);
    });
    for (const [usedPercent, remaining, color] of [
      [6, 100 / 7 - 6, "bg-success"],
      [10, 100 / 7 - 10, "bg-warning"],
      [100 / 7 - 0.25, 0.25, "bg-warning"],
      [20, 100 / 7 - 20, "bg-destructive"],
      [100, 100 / 7 - 100, "bg-destructive"],
    ] as const) {
      await act(() =>
        renderer!.update(<UsagePaceBar window={{ ...window, usedPercent }} now={now} />),
      );
      const meter = renderer!.root.findByProps({ role: "meter" });
      expect(meter.props["aria-valuenow"]).toBeCloseTo(remaining);
      if (usedPercent === 20) {
        expect(meter.props["aria-valuetext"]).toContain("5.7% overdrawn today");
      }
      expect(Number.parseFloat(meter.props.style.width)).toBeCloseTo(Math.abs(remaining));
      expect(Number.parseFloat(meter.props.style.right)).toBeCloseTo(
        Math.round(usedPercent) + Math.min(0, remaining),
      );
      expect(
        meter.findAllByType("div").find((element) => element.props.style?.flex !== undefined)?.props
          .style.flex,
      ).toBe(100);
      expect(
        meter.findAllByType("div").some((element) => element.props.className.includes(color)),
      ).toBe(true);
    }

    const nextDay = {
      ...window,
      usageHistory: [
        ...window.usageHistory!,
        { at: at(13, 13), usedPercent: 6 },
        { at: at(14, 10), usedPercent: 7 },
      ],
    };
    for (const usedPercent of [12, 14, 15]) {
      await act(() =>
        renderer!.update(
          <UsagePaceBar window={{ ...nextDay, usedPercent }} now={Date.parse(at(14, 14))} />,
        ),
      );
      const meter = renderer!.root.findByProps({ role: "meter" });
      const remaining = 200 / 7 - usedPercent;
      expect(meter.props["aria-label"]).toContain("remaining, including catch-up");
      expect(meter.props["aria-valuenow"]).toBeCloseTo(remaining);
      expect(Number.parseFloat(meter.props.style.width)).toBeCloseTo(remaining);
      expect(Number.parseFloat(meter.props.style.right)).toBe(usedPercent);
      const segments = meter
        .findAllByType("div")
        .filter((element) => element.props.style?.flex !== undefined);
      expect(segments.reduce((total, segment) => total + segment.props.style.flex, 0)).toBeCloseTo(
        100,
      );
      if (usedPercent < 100 / 7) {
        expect(segments).toHaveLength(2);
        expect(segments[0]!.props.style.flex).toBeCloseTo((100 / 7 / remaining) * 100);
        expect(segments[1]!.props.style.flex).toBeCloseTo(
          ((100 / 7 - usedPercent) / remaining) * 100,
        );
        expect(segments[1]!.props.className).toContain("opacity-50");
      } else {
        expect(segments).toHaveLength(1);
      }
    }

    for (const usedPercent of [0, 100]) {
      await act(() =>
        renderer!.update(
          <UsagePaceBar
            window={{ ...window, usedPercent, usageHistory: [{ at: at(19, 0), usedPercent }] }}
            now={Date.parse(at(19, 13))}
          />,
        ),
      );
      const meter = renderer!.root.findByProps({ role: "meter" });
      expect(meter.props["aria-valuenow"]).toBe(100 - usedPercent);
      expect(Number.parseFloat(meter.props.style.width)).toBe(100 - usedPercent);
      expect(Number.parseFloat(meter.props.style.right)).toBe(usedPercent);
    }
    settings.usagePacingEnabled = false;
    await act(() => renderer!.update(<UsagePaceBar window={window} now={now} />));
    expect(renderer!.toJSON()).toBeNull();
    settings.usagePacingEnabled = true;
    await act(() =>
      renderer!.update(<UsagePaceBar window={{ ...window, usageHistory: undefined }} now={now} />),
    );
    expect(renderer!.toJSON()).toBeNull();
  } finally {
    settings.usagePacingEnabled = true;
    await act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  }
});
