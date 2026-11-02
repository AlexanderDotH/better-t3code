import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const UsageFrame = Schema.Struct({
  usage: Schema.Struct({
    total_tokens: Schema.Number,
    tool_uses: Schema.Number,
    duration_ms: Schema.Number,
  }),
});
const decodeUsage = Schema.decodeUnknownOption(UsageFrame);
const count = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);

export function readClaudeSubagentUsage(frame: unknown) {
  const decoded = Option.getOrUndefined(decodeUsage(frame));
  if (!decoded) return undefined;
  return {
    totalTokens: count(decoded.usage.total_tokens),
    toolUses: count(decoded.usage.tool_uses),
    durationMs: count(decoded.usage.duration_ms),
  };
}
