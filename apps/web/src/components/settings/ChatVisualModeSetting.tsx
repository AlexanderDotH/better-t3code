import type { ChatVisualMode } from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const CHAT_VISUAL_MODES: ReadonlyArray<ChatVisualMode> = ["current", "classic"];

export function ChatVisualModeSelector({
  mode,
  onChange,
}: {
  readonly mode: ChatVisualMode;
  readonly onChange: (mode: ChatVisualMode) => void;
}) {
  const translate = useInterfaceTranslator().message;
  return (
    <div
      aria-label={translate("settings.chatVisuals.group")}
      className="grid w-full grid-cols-2 gap-2 sm:w-64"
      role="radiogroup"
    >
      {CHAT_VISUAL_MODES.map((option) => {
        const isSelected = mode === option;
        const label = translate(
          option === "current" ? "settings.chatVisuals.current" : "settings.chatVisuals.classic",
        );
        return (
          <button
            aria-label={translate("settings.chatVisuals.optionAria", { mode: label })}
            aria-checked={isSelected}
            className={cn(
              "cursor-pointer rounded-lg border px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              isSelected
                ? "border-transparent bg-accent/30 text-foreground"
                : "border-border/70 bg-card/60 text-muted-foreground hover:bg-accent/10 hover:text-foreground",
            )}
            key={option}
            onClick={() => onChange(option)}
            role="radio"
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

export function ChatVisualModeSetting({
  mode,
  onChange,
  status,
}: {
  readonly mode: ChatVisualMode;
  readonly onChange: (mode: ChatVisualMode) => void;
  readonly status: string | null;
}) {
  const translate = useInterfaceTranslator().message;
  return (
    <SettingsRow
      {...searchableSetting("chat-visuals")}
      description={translate("settings.chatVisuals.description")}
      status={status}
      resetAction={
        mode === "classic" ? (
          <SettingResetButton
            label={translate("settings.projects.appearance.chatVisualReset")}
            onClick={() => onChange("current")}
          />
        ) : null
      }
      control={<ChatVisualModeSelector mode={mode} onChange={onChange} />}
    />
  );
}
