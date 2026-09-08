import type { ProjectCheckpointSetting } from "./projectCheckpointSettings";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

export function ProjectCheckpointControls({
  setting,
  isSaving,
  onChange,
}: {
  readonly setting: ProjectCheckpointSetting;
  readonly isSaving: boolean;
  readonly onChange: (enabled: boolean) => void;
}) {
  const translate = useInterfaceTranslator().message;
  if (setting.state !== "mixed") {
    return (
      <Switch
        aria-label={translate("settings.projects.checkpoints.create")}
        checked={setting.effectiveEnabled}
        disabled={isSaving}
        onCheckedChange={onChange}
      />
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">
        {translate("settings.projects.checkpoints.mixed")}
      </span>
      <Button
        size="xs"
        variant="outline"
        type="button"
        disabled={isSaving}
        onClick={() => onChange(false)}
      >
        {translate("settings.projects.checkpoints.disableAll")}
      </Button>
      <Button
        size="xs"
        variant="outline"
        type="button"
        disabled={isSaving}
        onClick={() => onChange(true)}
      >
        {translate("settings.projects.checkpoints.enableAll")}
      </Button>
    </div>
  );
}
