import type { ChatVisualMode } from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const CHAT_VISUAL_MODES: ReadonlyArray<{
  readonly label: string;
  readonly mode: ChatVisualMode;
}> = [
  { mode: "current", label: "Current" },
  { mode: "classic", label: "Classic" },
];

export function ChatVisualModeSelector({
  mode,
  onChange,
}: {
  readonly mode: ChatVisualMode;
  readonly onChange: (mode: ChatVisualMode) => void;
}) {
  return (
    <div
      aria-label="Chat visuals"
      className="grid w-full grid-cols-2 gap-2 sm:w-64"
      role="radiogroup"
    >
      {CHAT_VISUAL_MODES.map((option) => {
        const isSelected = mode === option.mode;
        return (
          <button
            aria-label={`${option.label} chat visuals`}
            aria-checked={isSelected}
            className={cn(
              "cursor-pointer rounded-lg border px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              isSelected
                ? "border-transparent bg-accent/30 text-foreground"
                : "border-border/70 bg-card/60 text-muted-foreground hover:bg-accent/10 hover:text-foreground",
            )}
            key={option.mode}
            onClick={() => onChange(option.mode)}
            role="radio"
            style={isSelected ? { boxShadow: "inset 0 0 0 1px var(--ring)" } : undefined}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function ChatVisualModeSetting({
  mode,
  onChange,
  status,
}: {
  readonly mode: ChatVisualMode;
  readonly onChange: (mode: ChatVisualMode) => void;
  readonly status: string | null;
}) {
  return (
    <SettingsRow
      {...searchableSetting("chat-visuals")}
      description="Current is the default. Classic restores the compact pre-merge transcript visuals."
      status={status}
      resetAction={
        mode === "classic" ? (
          <SettingResetButton label="chat visuals" onClick={() => onChange("current")} />
        ) : null
      }
      control={<ChatVisualModeSelector mode={mode} onChange={onChange} />}
    />
  );
}
