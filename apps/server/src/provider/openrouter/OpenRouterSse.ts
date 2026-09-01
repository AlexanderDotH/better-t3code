import * as Schema from "effect/Schema";
import * as Predicate from "effect/Predicate";
import * as Stream from "effect/Stream";
import * as Sse from "effect/unstable/encoding/Sse";

export class OpenRouterProtocolError extends Schema.TaggedErrorClass<OpenRouterProtocolError>()(
  "OpenRouterProtocolError",
  {
    protocol: Schema.Literals(["chat-completions", "responses"]),
    message: Schema.String,
  },
) {}

export const decodeOpenRouterSseData = <E, R>(
  protocol: OpenRouterProtocolError["protocol"],
  bytes: Stream.Stream<Uint8Array, E, R>,
): Stream.Stream<string, E | OpenRouterProtocolError, R> =>
  bytes.pipe(
    Stream.decodeText(),
    Stream.pipeThroughChannel(Sse.decode()),
    Stream.map((event) => event.data),
    Stream.mapError((error) =>
      Predicate.isObject(error) && (error._tag === "Retry" || error._tag === "SseError")
        ? new OpenRouterProtocolError({
            protocol,
            message: "OpenRouter SSE stream framing is invalid",
          })
        : (error as E),
    ),
  );
