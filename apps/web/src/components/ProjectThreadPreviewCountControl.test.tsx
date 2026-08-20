import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ProjectThreadPreviewCountControl } from "./ProjectThreadPreviewCountControl";

describe("ProjectThreadPreviewCountControl", () => {
  it("renders the synchronized value with the requested accessible label", () => {
    const markup = renderToStaticMarkup(
      <ProjectThreadPreviewCountControl
        ariaLabel="Chats per project"
        count={3}
        onChange={() => undefined}
      />,
    );

    expect(markup).toContain('aria-label="Chats per project"');
    expect(markup).toContain('value="3"');
  });

  it("accepts an explicit six and clamps values to 1..15", () => {
    const onChange = vi.fn();
    const control = ProjectThreadPreviewCountControl({
      ariaLabel: "Chats per project",
      count: 3,
      onChange,
    });

    expect(isValidElement(control)).toBe(true);
    if (!isValidElement(control)) return;
    const onValueChange = (
      control as ReactElement<{ readonly onValueChange: (value: number | null) => void }>
    ).props.onValueChange;

    onValueChange(6);
    onValueChange(99);
    onValueChange(0);
    onValueChange(null);

    expect(onChange.mock.calls).toEqual([[6], [15], [1]]);
  });
});
