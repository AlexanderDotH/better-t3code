import { createElement, useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";

vi.mock("../interfaceLanguageRuntime", () => ({
  useInterfaceLocaleRuntime: () => ({ language: "fr", locale: "fr-FR" }),
}));
import { useInterfaceTranslator } from "./useInterfaceTranslator";

describe("useInterfaceTranslator", () => {
  it("creates a translator for the resolved interface locale", async () => {
    let translator: InterfaceTranslator | undefined;
    function Probe() {
      const current = useInterfaceTranslator();
      useLayoutEffect(() => {
        translator = current;
      }, [current]);
      return null;
    }
    let root: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        root = create(createElement(Probe));
      });
      expect(translator?.message("chat.agent.heading")).toBe("Agents");
      expect(translator?.number(12_345.5)).toBe(new Intl.NumberFormat("fr-FR").format(12_345.5));
    } finally {
      await act(async () => root?.unmount());
    }
  });
});
