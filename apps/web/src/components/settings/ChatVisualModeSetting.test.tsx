import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../hooks/useInterfaceTranslator", async () => {
  const { createInterfaceTranslator } = await import("@t3tools/shared/interfaceLanguage");
  return {
    useInterfaceTranslator: () => createInterfaceTranslator({ language: "en", locale: "en-US" }),
  };
});

import { ChatVisualModeSelector, ChatVisualModeSetting } from "./ChatVisualModeSetting";

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

describe("ChatVisualModeSelector", () => {
  it("exposes Current and Classic as an accessible radio group", () => {
    const markup = renderToStaticMarkup(
      <ChatVisualModeSelector mode="current" onChange={() => undefined} />,
    );

    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('aria-label="Chat visuals"');
    expect(markup).toContain('aria-label="Current chat visuals"');
    expect(markup).toContain('aria-label="Classic chat visuals"');
    expect(markup).toMatch(
      /aria-label="Current chat visuals"[^>]+aria-checked="true"[^>]+role="radio"/,
    );
    expect(markup).toMatch(
      /aria-label="Classic chat visuals"[^>]+aria-checked="false"[^>]+role="radio"/,
    );
  });

  it("maps both visible choices to their shared modes", () => {
    const onChange = vi.fn();
    const selector = ChatVisualModeSelector({ mode: "current", onChange });

    findChoice(selector, "Classic chat visuals")?.props.onClick();
    findChoice(selector, "Current chat visuals")?.props.onClick();

    expect(onChange.mock.calls).toEqual([["classic"], ["current"]]);
  });
});

describe("ChatVisualModeSetting", () => {
  it("renders the searchable row, mode explanation, and sync feedback", () => {
    const markup = renderToStaticMarkup(
      <ChatVisualModeSetting
        mode="classic"
        onChange={() => undefined}
        status="Waiting for Home server to reconnect."
      />,
    );

    expect(markup).toContain('id="chat-visuals"');
    expect(markup).toContain("Chat visuals");
    expect(markup).toContain(
      "Current is the default. Classic restores the compact pre-merge transcript visuals.",
    );
    expect(markup).toContain("Waiting for Home server to reconnect.");
    expect(markup).toContain('aria-label="Reset chat visuals to default"');
  });

  it("resets Classic by explicitly writing Current", () => {
    const onChange = vi.fn();
    const row = ChatVisualModeSetting({ mode: "classic", onChange, status: null });
    expect(isValidElement(row)).toBe(true);
    if (!isValidElement(row)) return;

    const resetAction = (
      row as ReactElement<{
        readonly resetAction: ReactElement<{ readonly onClick: () => void }>;
      }>
    ).props.resetAction;
    resetAction.props.onClick();

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("current");
  });

  it("does not offer a reset when Current is already selected", () => {
    const markup = renderToStaticMarkup(
      <ChatVisualModeSetting mode="current" onChange={() => undefined} status={null} />,
    );

    expect(markup).not.toContain("Reset chat visuals to default");
  });
});
