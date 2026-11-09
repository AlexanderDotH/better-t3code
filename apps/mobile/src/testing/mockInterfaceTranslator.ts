import { vi } from "vite-plus/test";

// The real hook pulls in the native appearance provider, which most logic tests never mount.
vi.mock("../localization/useMobileInterfaceTranslator", async () => {
  const { createInterfaceTranslator } = await import("@t3tools/shared/interfaceLanguage");
  const translator = createInterfaceTranslator({ language: "en", locale: "en-US" });
  return { useMobileInterfaceTranslator: () => translator };
});
