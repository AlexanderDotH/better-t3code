import * as ByteSize from "effect/ByteSize";
import { SkillEngineError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpIncomingMessage } from "effect/unstable/http";

const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;
const decodeCatalogJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const isSkillEngineError = Schema.is(SkillEngineError);

export const catalogJson = Effect.fn("catalogJson")(
  function* (url: string) {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.get(url, { headers: { Accept: "application/json" } });
    if (response.status < 200 || response.status >= 300) {
      return yield* new SkillEngineError({
        message:
          response.status === 429
            ? "The registry is rate limited. Please try again later."
            : "The registry returned HTTP " +
              response.status +
              ". Please try again or open the source.",
      });
    }
    const text = yield* response.text;
    if (Buffer.byteLength(text) > MAX_DOWNLOAD_BYTES) {
      return yield* new SkillEngineError({ message: "The registry response is too large." });
    }
    return yield* decodeCatalogJson(text);
  },
  Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(MAX_DOWNLOAD_BYTES)),
  Effect.timeout("20 seconds"),
  Effect.mapError((cause) =>
    isSkillEngineError(cause)
      ? cause
      : new SkillEngineError({
          message:
            "Could not reach the public registry. Check the environment's connection and try again.",
          cause,
        }),
  ),
);
