import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { reactHookHarness as hooks } from "../test/reactHookHarness";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../test/reactHookHarness");
  return { ...actual, useMemo: reactHookHarness.useMemo };
});

vi.mock("../interfaceLanguageRuntime", () => ({
  useInterfaceLocaleRuntime: () => ({ language: "fr", locale: "fr-FR" }),
}));

import { useInterfaceTranslator } from "./useInterfaceTranslator";

describe("useInterfaceTranslator", () => {
  beforeEach(() => hooks.reset());

  it("creates a translator for the resolved interface locale", () => {
    hooks.beginRender();
    const translator = useInterfaceTranslator();

    expect(translator.message("chat.agent.heading")).toBe("Agents");
    expect(translator.number(12_345.5)).toBe(new Intl.NumberFormat("fr-FR").format(12_345.5));
  });
});
