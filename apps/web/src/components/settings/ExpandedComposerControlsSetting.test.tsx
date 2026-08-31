import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts";
import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../hooks/useInterfaceTranslator", async () => {
  const { createInterfaceTranslator } = await import("@t3tools/shared/interfaceLanguage");
  return {
    useInterfaceTranslator: () => createInterfaceTranslator({ language: "en", locale: "en-US" }),
  };
});

import { ExpandedComposerControlsSetting } from "./ExpandedComposerControlsSetting";

describe("ExpandedComposerControlsSetting", () => {
  it("renders the searchable localized switch with its current value", () => {
    const markup = renderToStaticMarkup(
      <ExpandedComposerControlsSetting enabled onChange={() => undefined} />,
    );

    expect(markup).toContain('id="expanded-chat-controls"');
    expect(markup).toContain(
      "Show separate provider, context, mode, and access controls in the chat composer when space permits.",
    );
    expect(markup).toContain('aria-label="Show expanded chat controls"');
    expect(markup).toContain('aria-checked="true"');
  });

  it("writes both the selected and reset values", () => {
    const onChange = vi.fn();
    const row = ExpandedComposerControlsSetting({
      enabled: !DEFAULT_UNIFIED_SETTINGS.showExpandedComposerControls,
      onChange,
    });
    expect(isValidElement(row)).toBe(true);
    if (!isValidElement(row)) return;

    const props = (
      row as ReactElement<{
        readonly control: ReactElement<{ readonly onCheckedChange: (value: boolean) => void }>;
        readonly resetAction: ReactElement<{ readonly onClick: () => void }>;
      }>
    ).props;
    props.control.props.onCheckedChange(DEFAULT_UNIFIED_SETTINGS.showExpandedComposerControls);
    props.resetAction.props.onClick();

    expect(onChange.mock.calls).toEqual([
      [DEFAULT_UNIFIED_SETTINGS.showExpandedComposerControls],
      [DEFAULT_UNIFIED_SETTINGS.showExpandedComposerControls],
    ]);
  });
});
