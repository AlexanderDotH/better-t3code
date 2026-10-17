import { useMemo, useState } from "react";
import { deepPlanSourceRefKey } from "@t3tools/client-runtime/deep-planning";
import type { DeepPlanSourceRef, EnvironmentId, ProjectId } from "@t3tools/contracts";
import { MessageSquareIcon, PlusIcon, XIcon } from "lucide-react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { Button } from "../ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import { ComposerBanner } from "./ComposerBanner";

export interface DeepPlanSourceOption {
  readonly ref: DeepPlanSourceRef;
  readonly environmentLabel: string;
  readonly projectTitle: string;
  readonly title: string;
  readonly archived: boolean;
  readonly available: boolean;
}

export function DeepPlanSourcePicker({
  currentProject,
  projectSourceCount,
  options,
  selected,
  loading,
  error,
  disabled = false,
  frozen = false,
  onOpen,
  onChange,
}: {
  currentProject: { environmentId: EnvironmentId; projectId: ProjectId } | null;
  projectSourceCount: number | null;
  options: readonly DeepPlanSourceOption[];
  selected: readonly DeepPlanSourceRef[];
  loading: boolean;
  error: string | null;
  disabled?: boolean;
  frozen?: boolean;
  onOpen: () => void;
  onChange: (sources: readonly DeepPlanSourceRef[]) => void;
}) {
  const translate = useInterfaceTranslator().message;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedKeys = useMemo(() => new Set(selected.map(deepPlanSourceRefKey)), [selected]);
  const optionByKey = useMemo(
    () => new Map(options.map((option) => [deepPlanSourceRefKey(option.ref), option])),
    [options],
  );
  const groups = useMemo(() => {
    const result = new Map<string, { label: string; options: DeepPlanSourceOption[] }>();
    const needle = query.trim().toLocaleLowerCase();
    for (const option of options) {
      if (
        needle &&
        !`${option.title} ${option.projectTitle} ${option.environmentLabel}`
          .toLocaleLowerCase()
          .includes(needle)
      )
        continue;
      const key = JSON.stringify([option.ref.environmentId, option.ref.projectId]);
      const group = result.get(key) ?? {
        label: `${option.environmentLabel} / ${option.projectTitle}`,
        options: [],
      };
      group.options.push(option);
      result.set(key, group);
    }
    return [...result.entries()];
  }, [options, query]);
  const belongsToCurrentProject = (ref: DeepPlanSourceRef) =>
    currentProject !== null &&
    ref.environmentId === currentProject.environmentId &&
    ref.projectId === currentProject.projectId;
  const extras = selected.filter((ref) => !belongsToCurrentProject(ref));
  const toggleSource = (ref: DeepPlanSourceRef) => {
    const key = deepPlanSourceRefKey(ref);
    onChange(
      selectedKeys.has(key)
        ? selected.filter((source) => deepPlanSourceRefKey(source) !== key)
        : [...selected, ref],
    );
  };

  return (
    <ComposerBanner.Attachment>
      <ComposerBanner.Root variant={error ? "warning" : "default"}>
        <ComposerBanner.Row>
          <ComposerBanner.Icon>
            <MessageSquareIcon />
          </ComposerBanner.Icon>
          <ComposerBanner.Content className="flex-wrap gap-x-2">
            <span className="font-medium">{translate("chat.deepPlan.sources")}</span>
            <span
              className="min-w-0 text-muted-foreground"
              aria-label={translate("chat.deepPlan.allProjectChats")}
            >
              {projectSourceCount === null
                ? translate("chat.deepPlan.preparing")
                : translate("chat.deepPlan.projectSources", { count: projectSourceCount })}
            </span>
          </ComposerBanner.Content>
          <ComposerBanner.Actions>
            <Button
              variant="ghost-muted"
              size="xs"
              disabled={disabled || currentProject === null}
              onClick={() => {
                onOpen();
                setOpen(true);
              }}
            >
              <PlusIcon aria-hidden="true" />
              {translate("chat.deepPlan.chooseSources")}
            </Button>
          </ComposerBanner.Actions>
        </ComposerBanner.Row>
        {extras.length > 0 ? (
          <ComposerBanner.Body className="flex flex-wrap gap-1 py-1">
            {extras.map((ref) => {
              const key = deepPlanSourceRefKey(ref);
              const option = optionByKey.get(key);
              const title = option?.title ?? String(ref.threadId);
              return (
                <span
                  key={key}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border border-border ps-2"
                >
                  <span className="max-w-40 break-words">{title}</span>
                  {option?.available === false || (!loading && !option) ? (
                    <span className="text-warning-foreground">
                      {translate("chat.deepPlan.sourceUnavailable")}
                    </span>
                  ) : null}
                  <Button
                    variant="ghost-muted"
                    size="icon-micro"
                    disabled={disabled}
                    aria-label={translate("chat.deepPlan.removeSource", { title })}
                    onClick={() => toggleSource(ref)}
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                </span>
              );
            })}
          </ComposerBanner.Body>
        ) : null}
        {error || frozen ? (
          <ComposerBanner.Body className="space-y-1 py-1">
            {error ? (
              <p role="status" className="break-words text-warning-foreground">
                {error}
              </p>
            ) : null}
            {frozen ? (
              <p className="text-muted-foreground">{translate("chat.deepPlan.frozenSources")}</p>
            ) : null}
          </ComposerBanner.Body>
        ) : null}
      </ComposerBanner.Root>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle size="sm">{translate("chat.deepPlan.chooseSources")}</DialogTitle>
            <p className="text-xs/4 text-muted-foreground">
              {translate("chat.deepPlan.selectionHint")}
            </p>
          </DialogHeader>
          <div className="px-5 pb-2">
            <Input
              size="compact"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={translate("chat.deepPlan.searchSources")}
              placeholder={translate("chat.deepPlan.searchSources")}
            />
          </div>
          <div
            className="max-h-[min(44dvh,20rem)] overflow-y-auto overscroll-contain px-5"
            aria-busy={loading}
          >
            {loading ? (
              <p role="status" className="py-2 text-xs text-muted-foreground">
                {translate("chat.deepPlan.preparing")}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="py-2 text-xs text-warning-foreground">
                {error}
              </p>
            ) : null}
            {!loading && groups.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">
                {translate("chat.deepPlan.noSources")}
              </p>
            ) : null}
            {groups.map(([key, group]) => (
              <fieldset key={key} className="mb-3 min-w-0">
                <legend className="mb-1 px-2 text-2xs/4 font-medium text-muted-foreground">
                  {group.label}
                </legend>
                {group.options.map((option) => {
                  const included = belongsToCurrentProject(option.ref);
                  return (
                    <label
                      key={deepPlanSourceRefKey(option.ref)}
                      className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs/4 hover:bg-accent focus-within:ring-2 focus-within:ring-ring pointer-coarse:min-h-11"
                    >
                      <Checkbox
                        aria-label={option.title}
                        checked={included || selectedKeys.has(deepPlanSourceRefKey(option.ref))}
                        disabled={disabled || included || !option.available}
                        onCheckedChange={() => toggleSource(option.ref)}
                      />
                      <span className="min-w-0 flex-1 break-words">{option.title}</span>
                      {included ? (
                        <span className="text-xs text-muted-foreground">
                          {translate("chat.deepPlan.included")}
                        </span>
                      ) : null}
                      {option.archived ? (
                        <span className="text-xs text-muted-foreground">
                          {translate("chat.deepPlan.archived")}
                        </span>
                      ) : null}
                      {!option.available ? (
                        <span className="text-xs text-warning-foreground">
                          {translate("chat.deepPlan.sourceUnavailable")}
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </fieldset>
            ))}
          </div>
          <DialogFooter>
            <Button size="sm" onClick={() => setOpen(false)}>
              {translate("chat.deepPlan.done")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </ComposerBanner.Attachment>
  );
}
