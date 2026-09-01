import { renderToStaticMarkup } from "react-dom/server";
import { pseudoLocalizeInterfaceMessage } from "@t3tools/shared/interfaceLanguage";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  scrollToSettingsTarget,
  SettingsRow,
  SettingsSearchTargetProvider,
} from "./settingsLayout";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("settings search targets", () => {
  it("keeps long pseudo-localized labels on the shrinkable side of the responsive grid", () => {
    const pseudoLabel = Array.from({ length: 3 }, () =>
      pseudoLocalizeInterfaceMessage("settings.panels.background.profile.batterySaverDescription"),
    ).join(" ");
    const markup = renderToStaticMarkup(
      <SettingsRow
        title={pseudoLabel}
        description={pseudoLabel}
        control={<button>Control</button>}
      />,
    );

    expect(pseudoLabel).toMatch(/^⟦.+⟧$/);
    expect(pseudoLabel.length).toBeGreaterThan(80);
    expect(markup).toContain("sm:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)]");
    expect(markup).toContain("min-w-0 flex-1 space-y-1");
    expect(markup).toContain(pseudoLabel);
  });

  it("does not persist destination styling in the rendered row", () => {
    const markup = renderToStaticMarkup(
      <SettingsSearchTargetProvider targetId="word-wrap">
        <SettingsRow id="word-wrap" title="Word wrap" description="Wrap long lines." />
        <SettingsRow id="time-format" title="Time format" description="Choose a clock." />
      </SettingsSearchTargetProvider>,
    );

    expect(markup).toContain('id="word-wrap" tabindex="-1"');
    expect(markup).not.toContain("data-settings-search-target");
    expect(markup).not.toContain("settings-search-target-pulse");
  });

  it("keeps an explanatory visual inside the same row as its label and control", () => {
    const markup = renderToStaticMarkup(
      <SettingsRow
        title="Plan mode"
        description="Plan before changing files."
        control={<button type="button">Enable</button>}
        visual={<div data-example-setting-visual>Plan preview</div>}
      />,
    );

    const titleIndex = markup.indexOf("Plan mode");
    const controlIndex = markup.indexOf("Enable");
    const visualIndex = markup.indexOf("data-example-setting-visual");

    expect(markup).toContain("data-settings-row-visual");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("md:grid-cols-[minmax(12rem,1fr)_minmax(15rem,20rem)_auto]");
    expect(markup).toContain("border-border/60 bg-card/35");
    expect(titleIndex).toBeGreaterThan(-1);
    expect(controlIndex).toBeGreaterThan(titleIndex);
    expect(visualIndex).toBeGreaterThan(controlIndex);
  });

  it("scrolls directly to a section header and restarts the destination pulse", () => {
    const sectionScrollIntoView = vi.fn();
    const headerScrollIntoView = vi.fn();
    const focus = vi.fn();
    const remove = vi.fn();
    const add = vi.fn();
    const addEventListener = vi.fn();
    const target = {
      tagName: "SECTION",
      firstElementChild: { scrollIntoView: headerScrollIntoView },
      scrollIntoView: sectionScrollIntoView,
      focus,
      classList: { remove, add },
      addEventListener,
      offsetWidth: 100,
    } as unknown as HTMLElement;
    vi.stubGlobal("document", {
      getElementById: vi.fn(() => target),
    });
    vi.stubGlobal("window", {
      matchMedia: vi.fn(() => ({ matches: false })),
    });

    expect(scrollToSettingsTarget("providers")).toBe(true);
    expect(headerScrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    expect(sectionScrollIntoView).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(remove).toHaveBeenCalledWith("settings-search-target-pulse");
    expect(add).toHaveBeenCalledWith("settings-search-target-pulse");
    expect(addEventListener).toHaveBeenCalledWith("blur", expect.any(Function), { once: true });
  });

  it("does not animate the destination when reduced motion is requested", () => {
    const scrollIntoView = vi.fn();
    const focus = vi.fn();
    const remove = vi.fn();
    const add = vi.fn();
    const target = {
      tagName: "DIV",
      firstElementChild: null,
      scrollIntoView,
      focus,
      classList: { remove, add },
      offsetWidth: 100,
    } as unknown as HTMLElement;
    vi.stubGlobal("document", {
      getElementById: vi.fn(() => target),
    });
    vi.stubGlobal("window", {
      matchMedia: vi.fn(() => ({ matches: true })),
    });

    expect(scrollToSettingsTarget("word-wrap")).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "center",
    });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(remove).toHaveBeenCalledWith("settings-search-target-pulse");
    expect(add).not.toHaveBeenCalled();
  });

  it("leaves not-yet-mounted destinations to their mount lifecycle", () => {
    vi.stubGlobal("document", {
      getElementById: vi.fn(() => null),
    });

    expect(scrollToSettingsTarget("archive")).toBe(false);
  });
});
