const PROVIDER_CREDENTIAL_ENVIRONMENT_KEYS = [
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

export function nativeHarnessCommandEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const commandEnvironment = { ...environment };
  for (const key of PROVIDER_CREDENTIAL_ENVIRONMENT_KEYS) delete commandEnvironment[key];
  return commandEnvironment;
}
