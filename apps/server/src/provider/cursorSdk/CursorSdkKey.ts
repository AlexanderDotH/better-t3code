export function normalizeCursorSdkApiKey(raw: unknown): string {
  let value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return "";
  if (/^bearer\s+/i.test(value)) value = value.replace(/^bearer\s+/i, "").trim();
  if (value.startsWith("{")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        const token = record.access_token ?? record.accessToken ?? record.token;
        if (typeof token === "string" && token.trim()) return token.trim();
      }
    } catch {
      // Ignore malformed wrapper JSON.
    }
  }
  return value;
}

export function isPlausibleCursorSessionJwt(value: unknown): boolean {
  const token = normalizeCursorSdkApiKey(value);
  if (token.length < 80 || token.length > 16 * 1024) return false;
  if (!token.startsWith("eyJ")) return false;
  const parts = token.split(".");
  return parts.length === 3 && parts.every((part) => part.length > 0);
}
