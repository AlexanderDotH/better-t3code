import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type {
  ProviderSettingsFormAnnotation,
  ProviderSettingsFormControl,
  ProviderSettingsFormSchemaAnnotation,
  ProviderSettingsFormSelectOption,
} from "@t3tools/contracts";

export type ProviderSettingsSchema = {
  readonly fields: Readonly<Record<string, Schema.Top>>;
} & Schema.Top;

export interface ProviderSettingsDefinition {
  readonly settingsSchema: ProviderSettingsSchema;
}

export interface ProviderSettingsModelOption {
  readonly slug: string;
  readonly name: string;
  readonly isSelectable?: boolean | undefined;
}

export interface ProviderSettingsFieldModel {
  readonly key: string;
  readonly control: ProviderSettingsFormControl;
  readonly label: string;
  readonly description?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly clearWhenEmpty: "omit" | "persist";
  readonly defaultBooleanValue?: boolean | undefined;
  readonly defaultStringValue?: string | undefined;
  readonly defaultNumberValue?: number | undefined;
  readonly defaultStringArrayValue?: ReadonlyArray<string> | undefined;
  readonly options?: ReadonlyArray<ProviderSettingsFormSelectOption> | undefined;
  readonly disabled?: boolean | undefined;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly step?: number | undefined;
}

export interface DeriveProviderSettingsFieldsOptions {
  readonly value?: unknown;
  /** `undefined` means the catalog is still unavailable or loading. */
  readonly models?: ReadonlyArray<ProviderSettingsModelOption> | undefined;
}

function titleizeFieldKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}

function readFieldAnnotations(fieldSchema: Schema.Top) {
  return Schema.resolveAnnotationsKey(fieldSchema) ?? Schema.resolveAnnotations(fieldSchema);
}

function readFieldAnnotationString(
  fieldSchema: Schema.Top,
  key: "title" | "description",
): string | undefined {
  const value = readFieldAnnotations(fieldSchema)?.[key];
  return typeof value === "string" ? value : undefined;
}

function readFormAnnotation(fieldSchema: Schema.Top): ProviderSettingsFormAnnotation {
  return readFieldAnnotations(fieldSchema)?.providerSettingsForm ?? {};
}

function readSchemaAnnotation(definition: ProviderSettingsDefinition) {
  return (Schema.resolveAnnotations(definition.settingsSchema)?.providerSettingsFormSchema ??
    {}) as ProviderSettingsFormSchemaAnnotation;
}

function decodeFieldDefault(fieldSchema: Schema.Top): unknown {
  const decoded = Schema.decodeUnknownOption(fieldSchema as Schema.Decoder<unknown>)(undefined);
  return Option.isSome(decoded) ? decoded.value : undefined;
}

function readConfigValue(config: unknown, key: string, fallback: unknown): unknown {
  if (config === null || typeof config !== "object") return fallback;
  if (!Object.hasOwn(config, key)) return fallback;
  return (config as Record<string, unknown>)[key];
}

function isVisible(
  definition: ProviderSettingsDefinition,
  config: unknown,
  annotation: ProviderSettingsFormAnnotation,
): boolean {
  const condition = annotation.visibleWhen;
  if (condition === undefined) return true;
  const dependencySchema = definition.settingsSchema.fields[condition.field];
  const fallback =
    dependencySchema === undefined ? undefined : decodeFieldDefault(dependencySchema);
  return readConfigValue(config, condition.field, fallback) === condition.equals;
}

function dedupeModelOptions(
  models: ReadonlyArray<ProviderSettingsModelOption>,
  selectedValue: string,
): ReadonlyArray<ProviderSettingsFormSelectOption> {
  const seen = new Set<string>();
  const options: ProviderSettingsFormSelectOption[] = [];
  for (const model of models) {
    if (model.isSelectable === false) continue;
    const value = model.slug.trim();
    if (value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    options.push({ value, label: model.name.trim() || value });
  }
  if (selectedValue.length > 0 && !seen.has(selectedValue)) {
    options.unshift({ value: selectedValue, label: selectedValue });
  }
  return options;
}

function isModelOptionsSource(
  options: ProviderSettingsFormAnnotation["options"],
): options is { readonly source: "models" } {
  if (options === undefined || Array.isArray(options) || typeof options !== "object") return false;
  return (options as { readonly source?: unknown }).source === "models";
}

function selectPresentation(
  annotation: ProviderSettingsFormAnnotation,
  config: unknown,
  key: string,
  models: ReadonlyArray<ProviderSettingsModelOption> | undefined,
): Pick<ProviderSettingsFieldModel, "options" | "disabled"> {
  if (Array.isArray(annotation.options)) {
    return { options: annotation.options, disabled: false };
  }
  if (!isModelOptionsSource(annotation.options)) {
    return { options: [], disabled: false };
  }
  if (models === undefined) {
    return { options: [], disabled: true };
  }
  return {
    options: dedupeModelOptions(models, readProviderConfigString(config, key)),
    disabled: false,
  };
}

function defaultPresentation(
  control: ProviderSettingsFormControl,
  fieldSchema: Schema.Top,
): Partial<ProviderSettingsFieldModel> {
  const value = decodeFieldDefault(fieldSchema);
  if (control === "switch" && typeof value === "boolean") {
    return { defaultBooleanValue: value };
  }
  if (
    (control === "text" ||
      control === "password" ||
      control === "textarea" ||
      control === "select") &&
    typeof value === "string"
  ) {
    return { defaultStringValue: value };
  }
  if (control === "number" && typeof value === "number" && Number.isFinite(value)) {
    return { defaultNumberValue: value };
  }
  if (control === "ordered-string-list" && Array.isArray(value)) {
    const strings = value.filter((item): item is string => typeof item === "string");
    return { defaultStringArrayValue: strings };
  }
  return {};
}

export function deriveProviderSettingsFields(
  definition: ProviderSettingsDefinition,
  options: DeriveProviderSettingsFieldsOptions = {},
): ReadonlyArray<ProviderSettingsFieldModel> {
  const schemaAnnotation = readSchemaAnnotation(definition);
  const orderedKeys = new Map(
    (schemaAnnotation.order ?? []).map((key, index) => [key, index] as const),
  );
  const orderFallbackOffset = orderedKeys.size;

  return Object.keys(definition.settingsSchema.fields)
    .map((key, index) => ({ key, index }))
    .toSorted(
      (left, right) =>
        (orderedKeys.get(left.key) ?? orderFallbackOffset + left.index) -
        (orderedKeys.get(right.key) ?? orderFallbackOffset + right.index),
    )
    .flatMap(({ key }) => {
      const fieldSchema = definition.settingsSchema.fields[key]!;
      const annotation = readFormAnnotation(fieldSchema);
      if (annotation.hidden || !isVisible(definition, options.value, annotation)) return [];

      const control = annotation.control ?? "text";
      const title = readFieldAnnotationString(fieldSchema, "title");
      const description = readFieldAnnotationString(fieldSchema, "description");
      const field = {
        key,
        control,
        label: title ?? titleizeFieldKey(key),
        ...(description === undefined ? {} : { description }),
        ...(annotation.placeholder === undefined ? {} : { placeholder: annotation.placeholder }),
        clearWhenEmpty: annotation.clearWhenEmpty ?? "omit",
        ...defaultPresentation(control, fieldSchema),
        ...(control === "select"
          ? selectPresentation(annotation, options.value, key, options.models)
          : {}),
        ...(control === "number" && annotation.min !== undefined ? { min: annotation.min } : {}),
        ...(control === "number" && annotation.max !== undefined ? { max: annotation.max } : {}),
        ...(control === "number" && annotation.step !== undefined ? { step: annotation.step } : {}),
      } satisfies ProviderSettingsFieldModel;
      return [field];
    });
}

export function readProviderConfigString(config: unknown, key: string, defaultValue = ""): string {
  const value = readConfigValue(config, key, defaultValue);
  return typeof value === "string" ? value : defaultValue;
}

export function readProviderConfigBoolean(
  config: unknown,
  key: string,
  defaultValue = false,
): boolean {
  const value = readConfigValue(config, key, defaultValue);
  return typeof value === "boolean" ? value : defaultValue;
}

export function readProviderConfigNumber(
  config: unknown,
  key: string,
  defaultValue?: number,
): number | undefined {
  const value = readConfigValue(config, key, defaultValue);
  return typeof value === "number" && Number.isFinite(value) ? value : defaultValue;
}

export function readProviderConfigStringArray(
  config: unknown,
  key: string,
  defaultValue: ReadonlyArray<string> = [],
): ReadonlyArray<string> {
  const value = readConfigValue(config, key, defaultValue);
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return defaultValue;
  return value;
}

function normalizeStringList(value: ReadonlyArray<string>): ReadonlyArray<string> {
  const seen = new Set<string>();
  return value.flatMap((item) => {
    const normalized = item.trim();
    if (normalized.length === 0 || seen.has(normalized)) return [];
    seen.add(normalized);
    return [normalized];
  });
}

function isStringList(value: ProviderSettingsFieldValue): value is ReadonlyArray<string> {
  return Array.isArray(value);
}

export type ProviderSettingsFieldValue =
  | string
  | boolean
  | number
  | ReadonlyArray<string>
  | undefined;

export function nextProviderConfigWithFieldValue(
  config: unknown,
  field: ProviderSettingsFieldModel,
  value: ProviderSettingsFieldValue,
): Record<string, unknown> | undefined {
  const base: Record<string, unknown> =
    config !== null && typeof config === "object" ? { ...(config as Record<string, unknown>) } : {};

  if (value === undefined || (typeof value === "number" && !Number.isFinite(value))) {
    delete base[field.key];
  } else if (typeof value === "boolean") {
    const emptyValue = field.defaultBooleanValue ?? false;
    if (field.clearWhenEmpty === "omit" && value === emptyValue) delete base[field.key];
    else base[field.key] = value;
  } else if (typeof value === "number") {
    base[field.key] = value;
  } else if (isStringList(value)) {
    const normalized = normalizeStringList(value);
    if (field.clearWhenEmpty === "omit" && normalized.length === 0) delete base[field.key];
    else base[field.key] = normalized;
  } else if (field.clearWhenEmpty === "omit" && value.trim().length === 0) {
    delete base[field.key];
  } else {
    base[field.key] = value;
  }

  return Object.keys(base).length > 0 ? base : undefined;
}
