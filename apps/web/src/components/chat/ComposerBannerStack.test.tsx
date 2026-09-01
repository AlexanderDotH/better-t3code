import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerBanner } from "./ComposerBanner";
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
  it("keeps activity attached and exposes urgent notices through the localized peek", () => {
    const markup = renderToStaticMarkup(
      <ComposerBannerStack
        items={[
          { ...banner("notice", "default"), priority: "notice" },
          { ...banner("legacy-urgent", "default"), urgent: true },
          { ...banner("activity", "default"), priority: "activity" },
        ]}
      />,
    );

    expect(markup.indexOf("activity warning")).toBeLessThan(
      markup.indexOf("legacy-urgent warning"),
    );
    expect(markup.indexOf("legacy-urgent warning")).toBeLessThan(markup.indexOf("notice warning"));
    expect(markup).toContain('data-composer-banner-surface="attached"');
    expect(markup.match(/data-composer-banner-surface="floating"/g)).toHaveLength(2);
    expect(markup).toContain('data-slot="composer-banner-peek"');
    expect(markup).toContain('aria-label="Show other notices"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('data-composer-banner-stack-expanded-items="true"');
    expect(markup).toContain("grid-rows-[0fr]");
    expect(markup).toContain("pointer-events-none invisible");
  });

  it("renders one notice as an attached surface without disclosure chrome", () => {
    const markup = renderToStaticMarkup(<ComposerBannerStack items={[banner("front")]} />);

    expect(markup).toContain('data-slot="composer-banner-attachment"');
    expect(markup).toContain('data-composer-banner-surface="attached"');
    expect(markup).toContain('data-composer-banner-drawer="true"');
    expect(markup).toContain('data-variant="warning"');
    expect(markup).not.toContain('data-slot="composer-banner-peek"');
    expect(markup).not.toContain('data-composer-banner-stack-expanded-items="true"');
  });

  it("combines consecutive floating notices into one visible rounded body", () => {
    const markup = renderToStaticMarkup(
      <ComposerBanner.FloatingGroup>
        <ComposerBannerStack
          placement="floating"
          items={[
            { ...banner("plan", "info"), priority: "notice" },
            { ...banner("working", "activity"), priority: "activity" },
          ]}
        />
      </ComposerBanner.FloatingGroup>,
    );

    expect(markup).toContain("working warning");
    expect(markup).toContain("plan warning");
    expect(markup).toContain('data-composer-banner-stack-grouped="true"');
    expect(markup.match(/data-composer-banner-segment="true"/g)).toHaveLength(2);
    expect(markup).toContain('data-variant="activity"');
    expect(markup).toContain('data-variant="info"');
    expect(markup).not.toContain('data-slot="composer-banner-peek"');
    expect(markup).not.toContain('aria-label="Show other notices"');
  });

  it("applies an item-specific surface class without a second action layout API", () => {
    const markup = renderToStaticMarkup(
      <ComposerBannerStack
        items={[
          {
            ...banner("branch"),
            className: "branch-surface",
            actions: <button type="button">Repair</button>,
          },
        ]}
      />,
    );

    expect(markup).toContain("branch-surface");
    expect(markup).toContain('data-slot="composer-banner-actions"');
  });

  it("renders actions and a custom dismiss label on the shared accessible surface", () => {
    const markup = renderToStaticMarkup(
      <ComposerBannerStack
        items={[
          {
            id: "resume-compaction",
            variant: "info",
            icon: <span aria-hidden="true">!</span>,
            title: "Resume with less context",
            description: "250k tokens from an older session",
            actions: (
              <button type="button" disabled>
                Compact
              </button>
            ),
            dismissLabel: "Keep full history",
            onDismiss: () => {},
          },
        ]}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('data-composer-banner-surface="attached"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('aria-label="Keep full history"');
  });

  it("localizes the fallback dismiss label", () => {
    const markup = renderToStaticMarkup(
      <ComposerBannerStack items={[{ ...banner("dismissible"), onDismiss: () => {} }]} />,
    );

    expect(markup).toContain('aria-label="Dismiss notification"');
    expect(markup).not.toContain('aria-label="Dismiss warning"');
  });
});
