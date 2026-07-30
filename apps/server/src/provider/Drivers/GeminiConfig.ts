import {
  GEMINI_DRIVER_KIND,
  GeminiSettings as GeminiSettingsSchema,
  type GeminiSettings as GeminiSettingsShape,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export { GEMINI_DRIVER_KIND };
export const GeminiSettings = GeminiSettingsSchema;
export type GeminiSettings = GeminiSettingsShape;

export const decodeGeminiSettings = Schema.decodeSync(GeminiSettings);

export function resolveGeminiApiKey(
  settings: Pick<GeminiSettingsShape, "apiKey">,
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const candidates = [settings.apiKey, environment.GEMINI_API_KEY, environment.GOOGLE_API_KEY];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}
