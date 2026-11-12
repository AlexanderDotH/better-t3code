import type { TimestampFormat } from "@t3tools/contracts";

const formatters = new Map<string, Intl.DateTimeFormat>();

export function formatTimelineTimestamp(
  input: string,
  format: TimestampFormat,
  includeDate = false,
) {
  const timestamp = Date.parse(input);
  if (!Number.isFinite(timestamp)) return "";
  const key = `${format}:${includeDate}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      ...(format === "locale" ? {} : { hour12: format === "12-hour" }),
      ...(includeDate ? ({ month: "short", day: "numeric" } as const) : {}),
    });
    formatters.set(key, formatter);
  }
  return formatter.format(timestamp);
}
