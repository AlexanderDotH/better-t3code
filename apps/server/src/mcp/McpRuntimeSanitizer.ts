const MAX_RUNTIME_MESSAGE_LENGTH = 1_024;

const SECRET_KEY_PATTERN =
  /\b(authorization|proxy-authorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password|secret|token)\b(\s*[:=]\s*)(["']?)[^\s,"'};]+\3/gi;
const ENV_SECRET_PATTERN =
  /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY)[A-Z0-9_]*)\s*=\s*[^\s,;]+/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const PRIVATE_KEY_PATTERN =
  /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g;

function stripUnsafeControlCharacters(value: string): string {
  let result = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    const isAllowedWhitespace = code === 9 || code === 10 || code === 13;
    if ((code < 32 && !isAllowedWhitespace) || code === 127) continue;
    result += character;
  }
  return result;
}

/**
 * Keep provider diagnostics useful without exposing configuration secrets.
 * Unknown defects deliberately collapse to a generic message instead of being
 * stringified, because arbitrary objects frequently contain complete headers.
 */
export function sanitizeMcpRuntimeText(value: unknown): string {
  if (typeof value !== "string") {
    return "Provider runtime request failed.";
  }

  const sanitized = stripUnsafeControlCharacters(
    value
      .replace(PRIVATE_KEY_PATTERN, "[REDACTED PRIVATE KEY]")
      .replace(BEARER_PATTERN, "Bearer [REDACTED]")
      .replace(ENV_SECRET_PATTERN, "$1=[REDACTED]")
      .replace(SECRET_KEY_PATTERN, "$1$2[REDACTED]"),
  ).trim();

  if (sanitized.length === 0) {
    return "Provider runtime request failed.";
  }
  return sanitized.slice(0, MAX_RUNTIME_MESSAGE_LENGTH);
}
