import type { UsageCallKind, UsageContextDiagnostics } from "@t3tools/contracts";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";

export function mobileUsageCallMessageKey(kind: UsageCallKind): InterfaceMessageKey {
  return `mobile.usage.calls.${kind}`;
}

const CONTEXT_DIAGNOSTICS = [
  ["nativeForks", "mobile.usage.context.nativeForks", false, true],
  ["compactHandoffs", "mobile.usage.context.compactHandoffs", false, true],
  ["totalHandoffChars", "mobile.usage.context.handoffCharacters", false, true],
  ["compactionEvents", "mobile.usage.context.compactionEvents", false, true],
  ["maxContextTokens", "mobile.usage.context.maxContext", true, true],
  ["instructionChars", "mobile.usage.context.instructionCharacters", false, false],
  ["memoryInjectionChars", "mobile.usage.context.memoryInjectionCharacters", false, false],
  ["toolSchemaChars", "mobile.usage.context.toolSchemaCharacters", false, false],
  ["subagentResultChars", "mobile.usage.context.subagentResultCharacters", false, false],
  ["toolDigestChars", "mobile.usage.context.toolDigestCharacters", false, false],
  ["autoRoutingChars", "mobile.usage.context.autoRoutingCharacters", false, false],
] as const;

export function visibleMobileContextDiagnostics(diagnostics: UsageContextDiagnostics) {
  return CONTEXT_DIAGNOSTICS.flatMap(([key, messageKey, tokens, always]) => {
    const value = diagnostics[key] ?? 0;
    return always || value > 0 ? [{ key, messageKey, tokens, value }] : [];
  });
}
