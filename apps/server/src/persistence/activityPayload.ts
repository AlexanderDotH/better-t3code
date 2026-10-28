import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

const CANONICAL_DATA_REFERENCE = "$t3CanonicalDataReference";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function compactActivityPayload(value: unknown): unknown {
  const payload = record(value);
  const canonical = record(payload?.canonicalPayload);
  if (
    !payload ||
    !canonical ||
    !Object.hasOwn(payload, "data") ||
    payload.data === undefined ||
    !Object.hasOwn(canonical, "data") ||
    payload.data !== canonical.data ||
    Object.hasOwn(payload, CANONICAL_DATA_REFERENCE)
  )
    return value;

  const canonicalMetadata = { ...canonical };
  delete canonicalMetadata.data;
  return {
    ...payload,
    [CANONICAL_DATA_REFERENCE]: 1,
    canonicalPayload: canonicalMetadata,
  };
}

export function expandActivityPayload(value: unknown): unknown {
  const payload = record(value);
  const canonical = record(payload?.canonicalPayload);
  if (
    !payload ||
    !canonical ||
    payload[CANONICAL_DATA_REFERENCE] !== 1 ||
    !Object.hasOwn(payload, "data") ||
    Object.hasOwn(canonical, "data")
  )
    return value;

  const expanded = { ...payload };
  delete expanded[CANONICAL_DATA_REFERENCE];
  return { ...expanded, canonicalPayload: { ...canonical, data: payload.data } };
}

function mapEventActivityPayload(value: unknown, map: (payload: unknown) => unknown) {
  const payload = record(value);
  const activity = record(payload?.activity);
  if (!payload || !activity || !Object.hasOwn(activity, "payload")) return value;
  const mapped = map(activity.payload);
  return mapped === activity.payload
    ? value
    : { ...payload, activity: { ...activity, payload: mapped } };
}

// The storage reference never crosses the repository boundary; old JSON rows decode unchanged.
export const ActivityPayloadFromJsonString = Schema.fromJsonString(Schema.Unknown).pipe(
  Schema.decodeTo(
    Schema.Unknown,
    SchemaTransformation.transform({
      decode: expandActivityPayload,
      encode: compactActivityPayload,
    }),
  ),
);

export const EventPayloadFromJsonString = Schema.fromJsonString(Schema.Unknown).pipe(
  Schema.decodeTo(
    Schema.Unknown,
    SchemaTransformation.transform({
      decode: (value) => mapEventActivityPayload(value, expandActivityPayload),
      encode: (value) => mapEventActivityPayload(value, compactActivityPayload),
    }),
  ),
);
