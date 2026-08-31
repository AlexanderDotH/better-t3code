import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("~/hooks/useInterfaceTranslator", async () => {
  const { createInterfaceTranslator } = await import("@t3tools/shared/interfaceLanguage");
  const translator = createInterfaceTranslator({ language: "en", locale: "en-US" });
  return { useInterfaceTranslator: () => translator };
});

import { PreviewUnreachable } from "./PreviewUnreachable";

describe("PreviewUnreachable", () => {
  it("localizes known browser failures while preserving the requested host", () => {
    const html = renderToStaticMarkup(
      <PreviewUnreachable
        url="https://preview.example.test/path"
        code={-102}
        description="ERR_CONNECTION_REFUSED"
        onReload={() => undefined}
      />,
    );

    expect(html).toContain("preview.example.test");
    expect(html).toContain("Connection refused");
  });

  it("preserves an unknown Chromium error description verbatim", () => {
    const html = renderToStaticMarkup(
      <PreviewUnreachable
        url="https://preview.example.test"
        code={-999}
        description="ERR_CUSTOM_RUNTIME_DETAIL"
        onReload={() => undefined}
      />,
    );

    expect(html).toContain("ERR_CUSTOM_RUNTIME_DETAIL");
  });
});
