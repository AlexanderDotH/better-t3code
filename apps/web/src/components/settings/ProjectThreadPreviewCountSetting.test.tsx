import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../hooks/useInterfaceTranslator", async () => {
  const { createInterfaceTranslator } = await import("@t3tools/shared/interfaceLanguage");
  return {
    useInterfaceTranslator: () => createInterfaceTranslator({ language: "en", locale: "en-US" }),
  };
});

import { ProjectThreadPreviewCountSetting } from "./ProjectThreadPreviewCountSetting";

describe("ProjectThreadPreviewCountSetting", () => {
  it("renders a searchable Appearance row with sync status", () => {
    const markup = renderToStaticMarkup(
      <ProjectThreadPreviewCountSetting
        count={6}
        onChange={() => undefined}
        status="Update Old laptop to sync this setting."
      />,
    );

    expect(markup).toContain('id="chats-per-project"');
    expect(markup).toContain("Chats per project");
    expect(markup).toContain("Update Old laptop to sync this setting.");
    expect(markup).toContain('aria-label="Chats per project"');
    expect(markup).toContain('aria-label="Reset chats per project to default"');
  });

  it("uses the shared setter for both reset and custom changes", () => {
    const onChange = vi.fn();
    const row = ProjectThreadPreviewCountSetting({ count: 6, onChange, status: null });
    expect(isValidElement(row)).toBe(true);
    if (!isValidElement(row)) return;

    const rowProps = (
      row as ReactElement<{
        readonly control: ReactElement<{ readonly onChange: (count: 8) => void }>;
        readonly resetAction: ReactElement<{ readonly onClick: () => void }>;
        readonly status: ReactNode;
      }>
    ).props;
    rowProps.resetAction.props.onClick();
    rowProps.control.props.onChange(8);

    expect(onChange.mock.calls).toEqual([[3], [8]]);
  });
});
