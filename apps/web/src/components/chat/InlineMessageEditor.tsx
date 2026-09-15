import { useId, useState, type RefObject } from "react";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

export function InlineMessageEditor({
  draftRef,
  available,
  onSave,
  onClose,
}: {
  draftRef: RefObject<string>;
  available: boolean;
  onSave: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const { message: translate } = useInterfaceTranslator();
  const labelId = useId();
  // oxlint-disable-next-line react/refs -- Restore unsaved text when the virtualized row remounts.
  const [draft, setDraft] = useState(() => draftRef.current);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = pending || !available || draft.trim().length === 0;
  async function save() {
    if (disabled) return;
    setPending(true);
    setError(null);
    try {
      await onSave(draft.trim());
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : translate("chat.edit.failed"));
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      aria-labelledby={labelId}
      aria-busy={pending}
      className="w-full min-w-0 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape" && !pending) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          event.stopPropagation();
          void save();
        }
      }}
    >
      <p id={labelId} className="text-xs font-medium text-muted-foreground">
        {translate("chat.edit.title")}
      </p>
      <Textarea
        autoFocus
        aria-label={translate("chat.edit.title")}
        value={draft}
        onChange={(event) => {
          draftRef.current = event.target.value;
          setDraft(event.target.value);
        }}
        disabled={pending}
        className="text-sm [&_textarea]:min-h-28 [&_textarea]:max-h-[50vh] [&_textarea]:resize-y"
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
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
          {translate("chat.edit.cancel")}
        </Button>
        <Button type="submit" disabled={disabled}>
          {translate("chat.edit.continue")}
        </Button>
      </div>
    </form>
  );
}
