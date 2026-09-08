import { describe, expect, it, vi } from "vite-plus/test";

import {
  readInterfaceLocaleRuntime,
  setInterfaceLocaleRuntime,
  subscribeInterfaceLocaleRuntime,
} from "./interfaceLanguageRuntime";

describe("interface language runtime", () => {
  it("publishes one lightweight locale snapshot for low-level UI primitives", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeInterfaceLocaleRuntime(listener);

    setInterfaceLocaleRuntime({ language: "fr", locale: "fr-FR" });
    expect(readInterfaceLocaleRuntime()).toEqual({ language: "fr", locale: "fr-FR" });
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    setInterfaceLocaleRuntime({ language: "en", locale: "en-US" });
  });
});
