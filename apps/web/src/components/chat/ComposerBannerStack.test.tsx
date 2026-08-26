import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerBannerStack, type ComposerBannerStackItem } from "./ComposerBannerStack";

const banner = (
  id: string,
  variant: ComposerBannerStackItem["variant"] = "warning",
): ComposerBannerStackItem => ({
  id,
  variant,
  icon: <span aria-hidden="true">!</span>,
  title: `${id} warning`,
});

describe("ComposerBannerStack", () => {
  it("always shows every banner as a separate variant-colored pill", () => {
    const markup = renderToStaticMarkup(
      <ComposerBannerStack items={[banner("front", "default"), banner("stacked", "warning")]} />,
    );

    expect(markup.match(/data-composer-banner-pill="true"/g)).toHaveLength(2);
    expect(markup.match(/rounded-full/g)).toHaveLength(2);
    expect(markup).toContain('data-composer-banner-list="true"');
    expect(markup).toContain('data-variant="default"');
    expect(markup).toContain('data-variant="warning"');
    expect(markup.indexOf("front warning")).toBeLessThan(markup.indexOf("stacked warning"));
    expect(markup).not.toContain("invisible");
    expect(markup).not.toContain("grid-rows-[0fr]");
    expect(markup).not.toContain("group-hover/banner-stack");
    expect(markup).not.toContain("group-focus-within/banner-stack");
    expect(markup).not.toContain("chat-composer-banner-stack-cap");
  });

  it("renders a single banner with the same permanent pill surface", () => {
    const markup = renderToStaticMarkup(<ComposerBannerStack items={[banner("front")]} />);

    expect(markup).toContain(
      "chat-composer-banner-list chat-composer-drawer-slot chat-composer-drawer-floating",
    );
    expect(markup).toContain('data-composer-banner-pill="true"');
    expect(markup).toContain("alert-glass");
    expect(markup).toContain("rounded-full");
    expect(markup).not.toContain("chat-composer-drawer-attached");
    expect(markup).not.toContain("chat-composer-drawer-surface");
    expect(markup).toContain("text-xs");
    expect(markup).toContain('data-composer-banner-drawer="true"');
    expect(markup).toContain('data-variant="warning"');
    expect(markup).toContain("transform:none");
    expect(markup).not.toContain("will-change:transform");
  });
  it("applies item-specific surface and action layout classes", () => {
    const markup = renderToStaticMarkup(
      <ComposerBannerStack
        items={[
          {
            ...banner("branch"),
            className: "branch-surface",
            actionClassName: "branch-actions",
            actions: <button type="button">Repair</button>,
          },
        ]}
      />,
    );

    expect(markup).toContain("branch-surface");
    expect(markup).toContain("branch-actions");
  });
});
