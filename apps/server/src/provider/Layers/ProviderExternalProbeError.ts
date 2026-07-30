import * as Schema from "effect/Schema";

export class ProviderExternalProbeError extends Schema.TaggedErrorClass<ProviderExternalProbeError>()(
  "ProviderExternalProbeError",
  {
    provider: Schema.String,
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Provider external probe failed (${this.provider}) during ${this.operation}.`;
  }
}

export function providerExternalProbeError(input: {
  readonly provider: string;
  readonly operation: string;
}) {
  return (cause: unknown) =>
    new ProviderExternalProbeError({
      provider: input.provider,
      operation: input.operation,
      cause,
    });
}
