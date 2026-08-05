import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

interface GitWorkbenchConfirmationProps {
  readonly confirmLabel: string;
  readonly description: string;
  readonly disabled?: boolean;
  readonly onConfirm: () => void;
  readonly phrase?: string | undefined;
  readonly title: string;
  readonly triggerLabel: string;
  readonly variant?: "destructive" | "outline";
}

export function GitWorkbenchConfirmation({
  confirmLabel,
  description,
  disabled = false,
  onConfirm,
  phrase,
  title,
  triggerLabel,
  variant = "destructive",
}: GitWorkbenchConfirmationProps) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const confirmed = !phrase || confirmation === phrase;
  if (!open) {
    return (
      <Button
        disabled={disabled}
        onClick={() => setOpen(true)}
        size="xs"
        variant={variant === "destructive" ? "destructive-outline" : "outline"}
      >
        {triggerLabel}
      </Button>
    );
  }
  return (
    <div
      aria-describedby="git-workbench-confirmation-description"
      aria-labelledby="git-workbench-confirmation-title"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-black/48 p-4"
      role="alertdialog"
    >
      <div className="w-full max-w-md rounded-xl border bg-popover p-4 text-popover-foreground shadow-xl">
        <h2 className="font-semibold" id="git-workbench-confirmation-title">
          {title}
        </h2>
        <p
          className="mt-2 text-muted-foreground text-sm"
          id="git-workbench-confirmation-description"
        >
          {description}
        </p>
        {phrase ? (
          <label className="mt-3 block text-sm">
            Type <strong>{phrase}</strong> to confirm
            <Input
              autoFocus
              className="mt-1"
              onChange={(event) => setConfirmation(event.currentTarget.value)}
              value={confirmation}
            />
          </label>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setOpen(false)} size="sm" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={!confirmed}
            onClick={() => {
              onConfirm();
              setOpen(false);
              setConfirmation("");
            }}
            size="sm"
            variant={variant === "destructive" ? "destructive" : "default"}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
