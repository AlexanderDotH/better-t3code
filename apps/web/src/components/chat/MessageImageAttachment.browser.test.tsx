import { act, render as renderScreen } from "../../../test/render";
import type { SnapShotSource } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { MessageImageAttachment } from "./MessageImageAttachment";

const capture: SnapShotSource = {
  kind: "snap-shot",
  capturedAt: "2026-10-28T08:00:00.000Z",
  appName: "Project search",
  windowTitle: "Search",
  accessibility: {
    format: "flat-text",
    text: "No projects found. Reset filter.",
    truncated: false,
  },
};

let container: HTMLElement;

function fixture(source: SnapShotSource) {
  return (
    <MessageImageAttachment
      image={{
        type: "image",
        id: "capture",
        name: "Search.png",
        mimeType: "image/png",
        sizeBytes: 100,
        previewUrl: "https://environment.test/assets/capture",
        source,
      }}
      onOpen={() => {}}
    />
  );
}

async function setDetailsOpen(open: boolean) {
  const details = container.querySelector("details")!;
  await act(() => {
    details.open = open;
    details.dispatchEvent(new Event("toggle"));
  });
}

describe("message capture previews", () => {
  it("reveals capture context on demand and removes it when collapsed", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    await act(() => screen.rerender(fixture(capture)));
    expect(container.textContent).toContain("Project search");
    expect(container.textContent).not.toContain("Reset filter.");
    expect(container.querySelector("img")?.src).toBe("https://environment.test/assets/capture");

    await setDetailsOpen(true);
    expect(container.querySelector("pre")?.textContent).toBe("No projects found. Reset filter.");

    await setDetailsOpen(false);
    expect(container.querySelector("pre")).toBeNull();
    expect(container.textContent).not.toContain("Reset filter.");
  });

  it("keeps a screenshot usable when its app did not provide accessibility data", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    const { accessibility: _accessibility, ...screenshotOnly } = capture;
    await act(() => screen.rerender(fixture(screenshotOnly)));
    await setDetailsOpen(true);
    expect(container.textContent).toContain("No accessibility data was provided for this capture.");
    expect(container.querySelector("pre")).toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="Preview Search.png"]')?.disabled,
    ).toBe(false);
  });
});

function setup() {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));

  return {
    [Symbol.dispose]() {
      vi.unstubAllGlobals();
    },
  };
}
