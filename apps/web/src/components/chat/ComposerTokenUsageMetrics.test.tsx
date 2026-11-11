import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { type ComponentProps, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

import { summarizeThreadTokenUsage } from "@t3tools/client-runtime/thread-token-usage";
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

function visibleText(renderer: ReactTestRenderer) {
  return renderer.root
    .findAllByType("span")
    .flatMap((span) => span.children.filter((child) => typeof child === "string"));
}

it("shows total input and output including subagents, marks partial totals, and keeps empty usage finite", async () => {
  const emptyUsage = summarizeThreadTokenUsage(null, []);
  const usage = {
    ...emptyUsage,
    agentCount: 1,
    inputTokens: 271_000,
    outputTokens: 200,
    inputIsPartial: true,
    outputIsPartial: false,
    mainAgent: { ...emptyUsage.mainAgent, inputTokens: 200_000, outputTokens: 50 },
    subagents: { ...emptyUsage.subagents, inputTokens: 71_000, outputTokens: 150 },
  };
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(() => {
      renderer = create(<ComposerTokenUsageMetrics usage={usage} />);
    });
    expect(visibleText(renderer!)).toEqual(["271k+", "in", "·", "200", "out"]);
    expect(
      renderer!.root.findByProps({ "aria-label": "Input: 271,000+, Output: 200" }),
    ).toBeDefined();

    await act(() => renderer!.update(<ComposerTokenUsageMetrics usage={emptyUsage} />));
    expect(visibleText(renderer!)).toEqual(["0", "in", "·", "0", "out"]);
  } finally {
    await act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  }
});
