"use client";

import { useMemo, useState } from "react";
import {
  deriveProviderSettingsFields,
  nextProviderConfigWithFieldValue,
  readProviderConfigBoolean,
  readProviderConfigNumber,
  readProviderConfigString,
  readProviderConfigStringArray,
  type ProviderSettingsFieldModel,
  type ProviderSettingsModelOption,
} from "@t3tools/client-runtime/providerSettingsForm";

import { cn } from "../../lib/utils";
import { DraftInput } from "../ui/draft-input";
import { Input } from "../ui/input";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import type { ProviderClientDefinition } from "./providerDriverMeta";
import { SettingsRow } from "./settingsLayout";

export {
  deriveProviderSettingsFields,
  nextProviderConfigWithFieldValue,
  readProviderConfigBoolean,
  readProviderConfigNumber,
  readProviderConfigString,
  readProviderConfigStringArray,
} from "@t3tools/client-runtime/providerSettingsForm";
export type { ProviderSettingsFieldModel } from "@t3tools/client-runtime/providerSettingsForm";

interface ProviderSettingsFormProps {
  readonly definition: ProviderClientDefinition;
  readonly value: unknown;
  readonly models?: ReadonlyArray<ProviderSettingsModelOption> | undefined;
  readonly idPrefix: string;
  readonly variant: "card" | "dialog" | "settings";
  readonly onChange: (nextConfig: Record<string, unknown> | undefined) => void;
}

interface ProviderSettingsFieldRowProps {
  readonly field: ProviderSettingsFieldModel;
  readonly value: unknown;
  readonly idPrefix: string;
  readonly variant: ProviderSettingsFormProps["variant"];
  readonly onChange: ProviderSettingsFormProps["onChange"];
}

function OrderedStringListInput(props: {
  readonly id: string;
  readonly className?: string | undefined;
  readonly value: string;
  readonly placeholder?: string | undefined;
  readonly onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const displayedValue = draft ?? props.value;

  return (
    <Textarea
      id={props.id}
      className={props.className}
      value={displayedValue}
      placeholder={props.placeholder}
      spellCheck={false}
      onFocus={() => setDraft(props.value)}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => {
        const next = draft ?? props.value;
        setDraft(null);
        if (next !== props.value) props.onCommit(next);
      }}
    />
  );
}

function ProviderSettingsFieldControl({
  field,
  value,
  idPrefix,
  variant,
  onChange,
}: ProviderSettingsFieldRowProps) {
  const id = `${idPrefix}-${field.key}`;
  const commit = (next: string | boolean | number | ReadonlyArray<string> | undefined) =>
    onChange(nextProviderConfigWithFieldValue(value, field, next));
  if (field.control === "switch")
    return (
      <Switch
        id={id}
        aria-label={field.label}
        checked={readProviderConfigBoolean(value, field.key, field.defaultBooleanValue)}
        onCheckedChange={(checked) => commit(Boolean(checked))}
      />
    );
  if (field.control === "select") {
    const selected = readProviderConfigString(value, field.key, field.defaultStringValue);
    const selectedOption = field.options?.find((option) => option.value === selected);
    const placeholder = field.disabled
      ? "Loading options…"
      : field.options?.length === 0
        ? "No options available"
        : (field.placeholder ?? "Select an option");
    return (
      <Select
        value={selected || null}
        disabled={field.disabled || field.options?.length === 0}
        onValueChange={(next) => commit(next ?? "")}
      >
        <SelectTrigger id={id} aria-label={field.label}>
          <SelectValue>{selectedOption?.label ?? placeholder}</SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {field.options?.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="grid min-w-0 gap-0.5">
                <span className="truncate">{option.label}</span>
                {option.description ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    );
  }
  if (field.control === "number")
    return (
      <NumberField
        id={id}
        value={readProviderConfigNumber(value, field.key, field.defaultNumberValue)}
        min={field.min}
        max={field.max}
        step={field.step}
        onValueChange={(next) => commit(typeof next === "number" ? next : undefined)}
      >
        <NumberFieldGroup>
          <NumberFieldDecrement aria-label={`Decrease ${field.label}`} />
          <NumberFieldInput aria-label={field.label} placeholder={field.placeholder} />
          <NumberFieldIncrement aria-label={`Increase ${field.label}`} />
        </NumberFieldGroup>
      </NumberField>
    );
  if (field.control === "ordered-string-list")
    return (
      <OrderedStringListInput
        id={id}
        value={readProviderConfigStringArray(value, field.key, field.defaultStringArrayValue).join(
          "\n",
        )}
        placeholder={field.placeholder}
        onCommit={(next) => commit(next.split(/\r?\n/u))}
      />
    );
  const text = readProviderConfigString(value, field.key, field.defaultStringValue);
  if (field.control === "textarea")
    return (
      <Textarea
        id={id}
        value={text}
        onChange={(event) => commit(event.currentTarget.value)}
        placeholder={field.placeholder}
        spellCheck={false}
      />
    );
  const type = field.control === "password" ? "password" : undefined;
  const autoComplete = type === "password" ? "off" : undefined;
  return variant === "dialog" ? (
    <Input
      id={id}
      className="bg-background"
      type={type}
      autoComplete={autoComplete}
      value={text}
      onChange={(event) => commit(event.currentTarget.value)}
      placeholder={field.placeholder}
      spellCheck={false}
    />
  ) : (
    <DraftInput
      id={id}
      type={type}
      autoComplete={autoComplete}
      value={text}
      onCommit={commit}
      placeholder={field.placeholder}
      spellCheck={false}
    />
  );
}

function ProviderSettingsFieldRow(props: ProviderSettingsFieldRowProps) {
  const { field, variant, idPrefix } = props;
  const control = <ProviderSettingsFieldControl {...props} />;
  if (variant === "settings")
    return <SettingsRow title={field.label} description={field.description} control={control} />;
  const label = (
    <div className="min-w-0">
      <label htmlFor={`${idPrefix}-${field.key}`} className="text-xs font-medium text-foreground">
        {field.label}
      </label>
      {field.description ? (
        <span className="mt-1 block text-xs text-muted-foreground">{field.description}</span>
      ) : null}
    </div>
  );
  return (
    <div
      className={cn(
        field.control === "switch" ? "flex items-center justify-between gap-3" : "grid gap-1.5",
      )}
    >
      {label}
      {control}
    </div>
  );
}

export function ProviderSettingsForm({
  definition,
  value,
  models,
  idPrefix,
  variant,
  onChange,
}: ProviderSettingsFormProps) {
  const fields = useMemo(
    () => deriveProviderSettingsFields(definition, { value, models }),
    [definition, models, value],
  );

  if (fields.length === 0) {
    return null;
  }

  return (
    <>
      {fields.map((field) => (
        <ProviderSettingsFieldRow
          key={field.key}
          field={field}
          value={value}
          idPrefix={idPrefix}
          variant={variant}
          onChange={onChange}
        />
      ))}
    </>
  );
}
