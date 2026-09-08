import type { SidebarPosition } from "@t3tools/contracts/settings";

export interface AppSidebarPlacement {
  readonly borderClassName: "border-l" | "border-r";
  readonly controlClassName:
    | "left-[var(--workspace-controls-left)] ml-px"
    | "right-[var(--workspace-controls-right)] mr-px";
  readonly providerDirectionClassName: "flex-row" | "flex-row-reverse";
}

export function resolveAppSidebarPlacement(sidebarPosition: SidebarPosition): AppSidebarPlacement {
  if (sidebarPosition === "right") {
    return {
      borderClassName: "border-l",
      controlClassName: "right-[var(--workspace-controls-right)] mr-px",
      providerDirectionClassName: "flex-row-reverse",
    };
  }

  return {
    borderClassName: "border-r",
    controlClassName: "left-[var(--workspace-controls-left)] ml-px",
    providerDirectionClassName: "flex-row",
  };
}
