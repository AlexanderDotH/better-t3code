import { cn } from "../../lib/utils";

const SIDEBAR_LAYOUTS = [
  { value: "current", label: "Current", legacySidebarEnabled: false },
  { value: "classic", label: "Classic", legacySidebarEnabled: true },
] as const;

export function SidebarLayoutSelector({
  legacySidebarEnabled,
  onChange,
}: {
  readonly legacySidebarEnabled: boolean;
  readonly onChange: (legacySidebarEnabled: boolean) => void;
}) {
  return (
    <div aria-label="Sidebar layout" className="grid w-full grid-cols-2 gap-2 sm:w-64" role="group">
      {SIDEBAR_LAYOUTS.map((layout) => {
        const isSelected = legacySidebarEnabled === layout.legacySidebarEnabled;
        return (
          <button
            aria-label={`${layout.label} sidebar`}
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
            {layout.label}
          </button>
        );
      })}
    </div>
  );
}
