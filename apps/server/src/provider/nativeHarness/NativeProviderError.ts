import * as Predicate from "effect/Predicate";

export function nativeProviderErrorDetail(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim();
  if (Predicate.isObject(cause) && Predicate.isString(cause.message) && cause.message.trim()) {
    return cause.message.trim();
  }
  return String(cause).trim() || "Unknown native provider failure.";
}
