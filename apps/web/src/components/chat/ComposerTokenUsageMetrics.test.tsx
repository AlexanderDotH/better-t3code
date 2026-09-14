import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { act, type ComponentProps, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

import { summarizeThreadTokenUsage } from "../../lib/threadTokenUsage";
import { ComposerTokenUsageMetrics } from "./ComposerTokenUsageMetrics";

vi.mock("../../hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () => createInterfaceTranslator({ language: "en", locale: "en-US" }),
}));
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children, "aria-label": label }: ComponentProps<"span">) => (
    <span aria-label={label}>{children}</span>
  ),
  TooltipPopup: () => null,
}));

it("updates the badge outlines with each direction's source shares and keeps empty usage finite", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const emptyUsage = summarizeThreadTokenUsage(null, []);
  const usage = {
    ...emptyUsage,
    agentCount: 1,
    inputTokens: 100,
    outputTokens: 200,
    inputIsPartial: false,
    outputIsPartial: false,
    mainAgent: { ...emptyUsage.mainAgent, inputTokens: 75, outputTokens: 50 },
    subagents: { ...emptyUsage.subagents, inputTokens: 25, outputTokens: 150 },
  };
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(() => {
      renderer = create(<ComposerTokenUsageMetrics usage={usage} />);
    });
    const outlines = () =>
      renderer!.root.findAllByType("rect").filter((rect) => rect.props.pathLength === 100);
    const visibleLabels = () =>
      renderer!.root
        .findAllByType("span")
        .flatMap((span) => span.children.filter((child) => typeof child === "string"));

    expect(visibleLabels()).toEqual(["100", "200"]);
    expect(renderer!.root.findByProps({ "aria-label": "Input: 100" })).toBeDefined();
    expect(renderer!.root.findByProps({ "aria-label": "Output: 200" })).toBeDefined();
    expect(outlines().map((rect) => rect.props.strokeDasharray)).toEqual([
      undefined,
      "25 100",
      undefined,
      "75 100",
    ]);
    expect(outlines().map((rect) => rect.props.strokeDashoffset)).toEqual([-0, -75, -0, -25]);

    await act(() =>
      renderer!.update(
        <ComposerTokenUsageMetrics
          usage={{
            ...usage,
            agentCount: 0,
            inputTokens: 75,
            outputTokens: 50,
            subagents: emptyUsage.subagents,
          }}
        />,
      ),
    );
    expect(outlines()).toHaveLength(0);

    await act(() => renderer!.update(<ComposerTokenUsageMetrics usage={emptyUsage} />));
    expect(visibleLabels()).toEqual(["0", "0"]);
    expect(outlines()).toHaveLength(0);
  } finally {
    await act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  }
});
