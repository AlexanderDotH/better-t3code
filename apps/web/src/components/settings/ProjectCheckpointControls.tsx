import type { ProjectCheckpointSetting } from "./projectCheckpointSettings";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";

export function ProjectCheckpointControls({
  setting,
  isSaving,
  onChange,
}: {
  readonly setting: ProjectCheckpointSetting;
  readonly isSaving: boolean;
  readonly onChange: (enabled: boolean) => void;
}) {
  if (setting.state !== "mixed") {
    return (
      <Switch
        aria-label="Create checkpoints after turns"
        checked={setting.effectiveEnabled}
        disabled={isSaving}
        onCheckedChange={onChange}
      />
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Mixed</span>
      <Button
        size="xs"
        variant="outline"
        type="button"
        disabled={isSaving}
        onClick={() => onChange(false)}
      >
        Disable all
      </Button>
      <Button
        size="xs"
        variant="outline"
        type="button"
        disabled={isSaving}
        onClick={() => onChange(true)}
      >
        Enable all
      </Button>
    </div>
  );
}
