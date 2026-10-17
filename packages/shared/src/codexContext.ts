export function isCodexCompactionConflictMessage(message: string) {
  return /ActiveTurnNotSteerable\s*\{\s*turn_kind:\s*Compact\s*\}/i.test(message);
}
