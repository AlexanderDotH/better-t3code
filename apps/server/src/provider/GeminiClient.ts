import { GoogleGenAI } from "@google/genai";

export interface GeminiClient {
  readonly models: {
    readonly generateContent: GoogleGenAI["models"]["generateContent"];
    readonly generateContentStream: GoogleGenAI["models"]["generateContentStream"];
    readonly list: GoogleGenAI["models"]["list"];
  };
}

export type GeminiClientFactory = (apiKey: string) => GeminiClient;

export const makeGeminiClient: GeminiClientFactory = (apiKey) => new GoogleGenAI({ apiKey });

export interface ResolvedGeminiApiKey {
  readonly apiKey: string;
  readonly source: "GOOGLE_API_KEY" | "GEMINI_API_KEY";
}

function nonEmptyEnvironmentValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/** Mirrors the official SDK's documented API-key precedence. */
export function resolveGeminiApiKey(
  environment: NodeJS.ProcessEnv,
): ResolvedGeminiApiKey | undefined {
  const googleApiKey = nonEmptyEnvironmentValue(environment.GOOGLE_API_KEY);
  if (googleApiKey) {
    return { apiKey: googleApiKey, source: "GOOGLE_API_KEY" };
  }
  const geminiApiKey = nonEmptyEnvironmentValue(environment.GEMINI_API_KEY);
  return geminiApiKey ? { apiKey: geminiApiKey, source: "GEMINI_API_KEY" } : undefined;
}
