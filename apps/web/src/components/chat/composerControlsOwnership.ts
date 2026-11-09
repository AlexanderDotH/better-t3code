/** Each shortcut belongs to one visible control, including when blocks move into overflow. */
export function resolveComposerControlsOwnership(input: {
  readonly layout?: "current" | "classic";
  /** Permissions hide while the mode is the default, or while the new-thread strip names it. */
  readonly matchesDefault: boolean;
  readonly collapsed: boolean;
  readonly compact?: boolean;
  readonly hasContextWindowControl?: boolean;
  readonly hasTraitsControl?: boolean;
  /** How many trailing blocks the width measurement moved into the overflow menu. */
  readonly measuredHiddenBlockCount: number;
}) {
  const classic = input.layout === "classic";
  const accessDisplay = classic
    ? ("label" as const)
    : input.matchesDefault
      ? ("hidden" as const)
      : input.collapsed
        ? ("icon" as const)
        : ("label" as const);
  const blockIds = [
    ...(classic
      ? input.hasTraitsControl || input.hasContextWindowControl
        ? ["traits" as const]
        : []
      : input.hasContextWindowControl
        ? ["context" as const]
        : []),
    "mode" as const,
  ];
  const hiddenBlockCount = input.compact
    ? blockIds.length
    : Math.min(blockIds.length, Math.max(0, input.measuredHiddenBlockCount));
  const hiddenBlockIds = blockIds.slice(blockIds.length - hiddenBlockCount);
  return {
    accessDisplay,
    hiddenBlockCount,
    hiddenBlockIds,
    /** Without a visible chip, the model picker answers composer.mode. */
    pickerOwnsModeShortcut:
      !classic && (accessDisplay === "hidden" || hiddenBlockIds.includes("mode")),
  };
}
