export type MobileThreadListLayout = "current" | "classic";

export const THREAD_LIST_LAYOUT_OPTIONS: ReadonlyArray<{
  readonly layout: MobileThreadListLayout;
  readonly label: string;
  readonly description: string;
}> = [
  {
    layout: "current",
    label: "Current",
    description: "Active work appears as cards while settled threads stay compact.",
  },
  {
    layout: "classic",
    label: "Classic",
    description: "Use the original thread list grouped by project.",
  },
];

export function resolveMobileThreadListLayout(
  legacyThreadListEnabled: boolean | undefined,
): MobileThreadListLayout {
  return legacyThreadListEnabled === true ? "classic" : "current";
}

export function mobileThreadListLayoutPatch(layout: MobileThreadListLayout): {
  readonly legacyThreadListEnabled: boolean;
} {
  return { legacyThreadListEnabled: layout === "classic" };
}
