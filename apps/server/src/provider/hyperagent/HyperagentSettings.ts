import {
  HyperagentSettings as HyperagentSettingsSchema,
  type HyperagentSettings as HyperagentSettingsType,
} from "@t3tools/contracts";

import { normalizeHyperagentBaseUrl } from "./HyperagentUtils.ts";

export const HyperagentSettings = HyperagentSettingsSchema;
export type HyperagentSettings = HyperagentSettingsType;

export function resolveHyperagentDefaultModel(settings: HyperagentSettings): string {
  return settings.model.trim() || "sonnet-latest";
}

export function resolveHyperagentBaseUrl(settings: Pick<HyperagentSettings, "baseUrl">): string {
  return normalizeHyperagentBaseUrl(settings.baseUrl);
}

export function resolveHyperagentSessionCookie(
  settings: Pick<HyperagentSettings, "sessionCookie">,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return settings.sessionCookie.trim() || environment.HYPERAGENT_SESSION_COOKIE?.trim() || "";
}

export function resolveHyperagentFastMode(settings: HyperagentSettings): boolean {
  return settings.fastMode;
}
