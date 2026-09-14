import { useState } from "react";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Textarea } from "../ui/textarea";

export function EditMessageDialog({
  text,
  available,
  canRestart,
  onSave,
  onClose,
}: {
  text: string;
  available: boolean;
  canRestart: boolean;
  onSave: (text: string, mode: "continue" | "restart") => Promise<void>;
  onClose: () => void;
}) {
  const { message: translate } = useInterfaceTranslator();
  const [draft, setDraft] = useState(text);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = pending || !available || draft.trim().length === 0;
  async function save(mode: "continue" | "restart") {
    if (disabled) return;
    setPending(true);
    setError(null);
    try {
      await onSave(draft.trim(), mode);
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : translate("chat.edit.failed"));
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{translate("chat.edit.title")}</DialogTitle>
          <DialogDescription>{translate("chat.edit.description")}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <Textarea
            autoFocus
            aria-label={translate("chat.edit.title")}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={pending}
            className="min-h-64 max-h-[55vh] resize-y font-mono text-sm"
          />
          {!available && (
            <p role="status" className="text-sm text-muted-foreground">
              {translate("chat.edit.unavailable")}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </DialogPanel>
        <DialogFooter className="flex-wrap">
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            {translate("chat.edit.cancel")}
          </Button>
          <Button
            variant="outline"
            disabled={disabled || !canRestart}
            onClick={() => void save("restart")}
          >
            {translate("chat.edit.restart")}
          </Button>
          <Button disabled={disabled} onClick={() => void save("continue")}>
            {translate("chat.edit.continue")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
