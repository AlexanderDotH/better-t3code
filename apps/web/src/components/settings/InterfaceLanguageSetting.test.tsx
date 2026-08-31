import type { InterfaceLocalePreferenceV1 } from "@t3tools/contracts";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { InterfaceLanguageSettingView } from "./InterfaceLanguageSetting";

describe("InterfaceLanguageSettingView", () => {
  it("selects a supported locale through the shared synchronization control", () => {
    const onPreferenceChange = vi.fn<(preference: InterfaceLocalePreferenceV1) => void>();
    const row = InterfaceLanguageSettingView({
      language: "de",
      preference: "de",
      status: null,
      searchTargetId: "better-t3-interface-language",
      onPreferenceChange,
    });
    const select = row.props.control as ReactElement<{
      value: InterfaceLocalePreferenceV1;
      onValueChange: (value: unknown) => void;
    }>;

    expect(select.props.value).toBe("de");
    select.props.onValueChange("fr");
    select.props.onValueChange("unsupported");
    expect(onPreferenceChange).toHaveBeenCalledOnce();
    expect(onPreferenceChange).toHaveBeenCalledWith("fr");
  });

  it("offers System as the reversible reset for an explicit language", () => {
    const onPreferenceChange = vi.fn<(preference: InterfaceLocalePreferenceV1) => void>();
    const row = InterfaceLanguageSettingView({
      language: "en",
      preference: "fr",
      status: "Synchronizing",
      searchTargetId: "interface-language",
      onPreferenceChange,
    });
    const reset = row.props.resetAction as ReactElement<{ onClick: () => void }>;

    expect(row.props.status).toBe("Synchronizing");
    reset.props.onClick();
    expect(onPreferenceChange).toHaveBeenCalledWith("system");
  });
});
