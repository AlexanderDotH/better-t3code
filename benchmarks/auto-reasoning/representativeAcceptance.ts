/**
 * Deterministic representative acceptance inputs.
 *
 * These are product targets, not measurements from a production runtime and
 * never invoke a provider or paid model.
 */
export const REPRESENTATIVE_AUTO_REASONING_ACCEPTANCE = {
  manualReasoning: { before: "high", after: "high" },
  autoUi: { web: "Auto · High", mobile: "Auto · High" },
  usageAttribution: {
    marker: "<t3code_auto_reasoning_call>",
    callKind: "auto-reasoning",
  },
  staticPrompt: { baselineChars: 16_285, optimizedChars: 8_935, minimumReduction: 0.4 },
  optionalToolSchemas: { baselineChars: 59_143, optimizedChars: 6_451, minimumReduction: 0.5 },
  largeToolDigest: {
    baselineChars: 1_048_576,
    optimizedChars: 250,
    minimumReduction: 0.9,
  },
  eightAgentHandoff: {
    baselineChars: 27_368,
    optimizedChars: 5_032,
    minimumReduction: 0.5,
  },
  mixedRouting: {
    fixedMaxTokens: 200_000,
    routedWorkTokens: 156_000,
    routerOverheadTokens: 4_000,
    minimumReduction: 0.2,
  },
} as const;

export function reduction(baseline: number, optimized: number): number {
  return baseline === 0 ? 0 : (baseline - optimized) / baseline;
}
