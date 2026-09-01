import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../hooks/useInterfaceTranslator", async () => {
  const { createInterfaceTranslator } = await import("@t3tools/shared/interfaceLanguage");
  return {
    useInterfaceTranslator: () => createInterfaceTranslator({ language: "en", locale: "en-US" }),
  };
});

import { SidebarLayoutSelector } from "./SidebarLayoutSetting";

function findChoice(
  node: ReactNode,
  label: string,
): ReactElement<{ readonly onClick: () => void }> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement(child)) continue;
    const props = child.props as {
      readonly "aria-label"?: string;
      readonly children?: ReactNode;
      readonly onClick?: () => void;
    };
    if (props["aria-label"] === label && props.onClick) {
      return child as ReactElement<{ readonly onClick: () => void }>;
    }
    const nested = findChoice(props.children, label);
    if (nested) return nested;
  }
  return undefined;
}

describe("SidebarLayoutSelector", () => {
  it("shows Current and Classic together with Current selected for the default boolean", () => {
    const markup = renderToStaticMarkup(
      <SidebarLayoutSelector legacySidebarEnabled={false} onChange={() => {}} />,
    );

    expect(markup).toContain('aria-label="Sidebar layout"');
    expect(markup).toContain('aria-label="Current sidebar" aria-pressed="true"');
    expect(markup).toContain('aria-label="Classic sidebar" aria-pressed="false"');
    expect(markup).toContain(">Current<");
    expect(markup).toContain(">Classic<");
  });

  it("selects Classic when the persisted boolean is enabled", () => {
    const markup = renderToStaticMarkup(
      <SidebarLayoutSelector legacySidebarEnabled onChange={() => {}} />,
    );

    expect(markup).toContain('aria-label="Current sidebar" aria-pressed="false"');
    expect(markup).toContain('aria-label="Classic sidebar" aria-pressed="true"');
  });

  it("maps both visible choices back to legacySidebarEnabled", () => {
    const onChange = vi.fn();
    const selector = SidebarLayoutSelector({ legacySidebarEnabled: false, onChange });

    findChoice(selector, "Classic sidebar")?.props.onClick();
    findChoice(selector, "Current sidebar")?.props.onClick();

    expect(onChange).toHaveBeenNthCalledWith(1, true);
    expect(onChange).toHaveBeenNthCalledWith(2, false);
  });
});
