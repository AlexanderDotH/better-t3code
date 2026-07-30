import {
  CursorSdkSettings as CursorSdkSettingsSchema,
  type CursorSdkSettings as CursorSdkSettingsType,
} from "@t3tools/contracts";

export const CursorSdkSettings = CursorSdkSettingsSchema;
export type CursorSdkSettings = CursorSdkSettingsType;

export function resolveCursorSdkDefaultModel(settings: CursorSdkSettings): string {
  return (
    settings.manualModelIds.find((model) => model.trim())?.trim() ??
    settings.customModels.find((model) => model.trim())?.trim() ??
    "composer-2"
  );
}
