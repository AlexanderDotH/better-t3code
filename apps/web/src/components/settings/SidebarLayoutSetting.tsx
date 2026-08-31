import { cn } from "../../lib/utils";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

const SIDEBAR_LAYOUTS = [
  { value: "current", legacySidebarEnabled: false },
  { value: "classic", legacySidebarEnabled: true },
] as const;

export function SidebarLayoutSelector({
  legacySidebarEnabled,
  onChange,
}: {
  readonly legacySidebarEnabled: boolean;
  readonly onChange: (legacySidebarEnabled: boolean) => void;
}) {
  const translate = useInterfaceTranslator().message;
  return (
    <div
      aria-label={translate("settings.sidebar.layout")}
      className="grid w-full grid-cols-2 gap-2 sm:w-64"
      role="group"
    >
      {SIDEBAR_LAYOUTS.map((layout) => {
        const isSelected = legacySidebarEnabled === layout.legacySidebarEnabled;
        const label = translate(
          layout.value === "current"
            ? "settings.chatVisuals.current"
            : "settings.chatVisuals.classic",
        );
        return (
          <button
            aria-label={translate("settings.projects.appearance.sidebarOptionAria", {
              mode: label,
            })}
            aria-pressed={isSelected}
            className={cn(
              "cursor-pointer rounded-lg border px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              isSelected
                ? "border-transparent bg-accent/30 text-foreground"
                : "border-border/70 bg-card/60 text-muted-foreground hover:bg-accent/10 hover:text-foreground",
            )}
            key={layout.value}
            onClick={() => onChange(layout.legacySidebarEnabled)}
            style={isSelected ? { boxShadow: "inset 0 0 0 1px var(--ring)" } : undefined}
            type="button"
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
