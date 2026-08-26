"use client";

import { useMemo, useState, type ReactNode } from "react";
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
  readonly variant: "card" | "dialog";
  readonly onChange: (nextConfig: Record<string, unknown> | undefined) => void;
}

function FieldFrame(props: {
  readonly variant: ProviderSettingsFormProps["variant"];
  readonly children: ReactNode;
}) {
  if (props.variant === "card") {
    return <div>{props.children}</div>;
  }
  return <div className="grid gap-1.5">{props.children}</div>;
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

function ProviderSettingsFieldRow({
  field,
  value,
  idPrefix,
  variant,
  onChange,
}: ProviderSettingsFieldRowProps) {
  const inputId = `${idPrefix}-${field.key}`;
  const descriptionClassName =
    variant === "card"
      ? "mt-1 block text-xs text-muted-foreground"
      : "text-[11px] text-muted-foreground";
  const label = <span className="text-xs font-medium text-foreground">{field.label}</span>;
  const description = field.description ? (
    <span className={descriptionClassName}>{field.description}</span>
  ) : null;

  if (field.control === "switch") {
    return (
      <FieldFrame variant={variant}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            {label}
            {description}
          </div>
          <Switch
            checked={readProviderConfigBoolean(value, field.key, field.defaultBooleanValue)}
            onCheckedChange={(checked) =>
              onChange(nextProviderConfigWithFieldValue(value, field, Boolean(checked)))
            }
            aria-label={field.label}
          />
        </div>
      </FieldFrame>
    );
  }

  if (field.control === "select") {
    const selectedValue = readProviderConfigString(value, field.key, field.defaultStringValue);
    const selectedOption = field.options?.find((option) => option.value === selectedValue);
    const placeholder = field.disabled
      ? "Loading options…"
      : field.options?.length === 0
        ? "No options available"
        : (field.placeholder ?? "Select an option");
    return (
      <FieldFrame variant={variant}>
        <label htmlFor={inputId} className={cn(variant === "card" && "block")}>
          {label}
          <Select
            value={selectedValue || null}
            disabled={field.disabled || field.options?.length === 0}
            onValueChange={(next) =>
              onChange(nextProviderConfigWithFieldValue(value, field, next ?? ""))
            }
          >
            <SelectTrigger
              id={inputId}
              className={cn(variant === "card" && "mt-1.5")}
              aria-label={field.label}
            >
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
          {description}
        </label>
      </FieldFrame>
    );
  }

  if (field.control === "number") {
    return (
      <FieldFrame variant={variant}>
        <label htmlFor={inputId} className={cn(variant === "card" && "block")}>
          {label}
          <NumberField
            id={inputId}
            className={cn(variant === "card" && "mt-1.5")}
            value={readProviderConfigNumber(value, field.key, field.defaultNumberValue)}
            min={field.min}
            max={field.max}
            step={field.step}
            onValueChange={(next) =>
              onChange(
                nextProviderConfigWithFieldValue(
                  value,
                  field,
                  typeof next === "number" ? next : undefined,
                ),
              )
            }
          >
            <NumberFieldGroup>
              <NumberFieldDecrement aria-label={`Decrease ${field.label}`} />
              <NumberFieldInput aria-label={field.label} placeholder={field.placeholder} />
              <NumberFieldIncrement aria-label={`Increase ${field.label}`} />
            </NumberFieldGroup>
          </NumberField>
          {description}
        </label>
      </FieldFrame>
    );
  }

  if (field.control === "ordered-string-list") {
    const text = readProviderConfigStringArray(
      value,
      field.key,
      field.defaultStringArrayValue,
    ).join("\n");
    const commit = (next: string) =>
      onChange(nextProviderConfigWithFieldValue(value, field, next.split(/\r?\n/u)));
    return (
      <FieldFrame variant={variant}>
        <label htmlFor={inputId} className={cn(variant === "card" && "block")}>
          {label}
          <OrderedStringListInput
            id={inputId}
            className={cn(variant === "card" && "mt-1.5")}
            value={text}
            placeholder={field.placeholder}
            onCommit={commit}
          />
          {description}
        </label>
      </FieldFrame>
    );
  }

  if (field.control === "textarea") {
    return (
      <FieldFrame variant={variant}>
        <label htmlFor={inputId} className={cn(variant === "card" && "block")}>
          {label}
          <Textarea
            id={inputId}
            className={cn(variant === "card" && "mt-1.5")}
            value={readProviderConfigString(value, field.key, field.defaultStringValue)}
            onChange={(event) =>
              onChange(nextProviderConfigWithFieldValue(value, field, event.target.value))
            }
            placeholder={field.placeholder}
            spellCheck={false}
          />
          {description}
        </label>
      </FieldFrame>
    );
  }

  const type = field.control === "password" ? "password" : undefined;
  return (
    <FieldFrame variant={variant}>
      <label htmlFor={inputId} className={cn(variant === "card" && "block")}>
        {label}
        {variant === "card" ? (
          <DraftInput
            id={inputId}
            className="mt-1.5"
            type={type}
            autoComplete={field.control === "password" ? "off" : undefined}
            value={readProviderConfigString(value, field.key, field.defaultStringValue)}
            onCommit={(next) => onChange(nextProviderConfigWithFieldValue(value, field, next))}
            placeholder={field.placeholder}
            spellCheck={false}
          />
        ) : (
          <Input
            id={inputId}
            className="bg-background"
            type={type}
            autoComplete={field.control === "password" ? "off" : undefined}
            value={readProviderConfigString(value, field.key, field.defaultStringValue)}
            onChange={(event) =>
              onChange(nextProviderConfigWithFieldValue(value, field, event.target.value))
            }
            placeholder={field.placeholder}
            spellCheck={false}
          />
        )}
        {description}
      </label>
    </FieldFrame>
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
