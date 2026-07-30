export interface CursorSdkModelSelection {
  readonly id: string;
  readonly params?: ReadonlyArray<{ readonly id: string; readonly value: string }> | undefined;
}

export interface CursorSdkPickerRow {
  readonly id: string;
  readonly displayName: string;
  readonly description?: string | undefined;
  readonly kind?: "base" | "alias" | "variant" | undefined;
  readonly baseModelId?: string | undefined;
  readonly paramSummary?: string | undefined;
  readonly showDefaultWire?: boolean | undefined;
}

export function wireIdFingerprint(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/\./g, "-")
    .replace(/_+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeParams(
  raw: unknown,
): ReadonlyArray<{ readonly id: string; readonly value: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const record = getRecord(entry);
    return typeof record.id === "string" && typeof record.value === "string"
      ? [{ id: record.id, value: record.value }]
      : [];
  });
}

export function formatCursorModelParamSummary(
  params: ReadonlyArray<{ readonly id: string; readonly value: string }> | undefined,
): string | undefined {
  if (!params || params.length === 0) return undefined;
  return params.map((param) => `${param.id}: ${param.value}`).join(", ");
}

export function variantWireId(baseId: string, variant: unknown): string {
  const record = getRecord(variant);
  const name = typeof record.displayName === "string" ? record.displayName.trim() : "";
  if (name) {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (slug && wireIdFingerprint(slug) !== wireIdFingerprint(baseId)) return slug;
  }
  const paramKey = normalizeParams(record.params)
    .map((param) => `${param.id}=${param.value}`)
    .join(",");
  if (!paramKey) return baseId;
  const derived = `${baseId}--${paramKey.replace(/[^a-z0-9]+/gi, "-")}`;
  return wireIdFingerprint(derived) === wireIdFingerprint(baseId) ? baseId : derived;
}

export function normalizeCursorSdkCatalog(models: unknown): {
  readonly pickerRows: ReadonlyArray<CursorSdkPickerRow>;
  readonly selectionByWireId: Map<string, CursorSdkModelSelection>;
} {
  const pickerRows: CursorSdkPickerRow[] = [];
  const selectionByWireId = new Map<string, CursorSdkModelSelection>();

  const rememberSelection = (wireId: string, model: CursorSdkModelSelection) => {
    const id = wireId.trim();
    if (!id || !model.id) return;
    selectionByWireId.set(id, model);
  };

  const addPickerRow = (row: CursorSdkPickerRow) => {
    const id = row.id.trim();
    if (!id) return;
    const fingerprint = wireIdFingerprint(id);
    const existingIndex = pickerRows.findIndex(
      (existing) => wireIdFingerprint(existing.id) === fingerprint,
    );
    if (existingIndex >= 0) {
      const existing = pickerRows[existingIndex];
      if (row.kind === "variant" && (row.paramSummary || row.kind !== existing?.kind)) {
        pickerRows[existingIndex] = { ...row, id, displayName: row.displayName.trim() || id };
      }
      return;
    }
    pickerRows.push({ ...row, id, displayName: row.displayName.trim() || id });
  };

  if (!Array.isArray(models)) return { pickerRows, selectionByWireId };

  for (const raw of models) {
    const record = getRecord(raw);
    const baseId = typeof record.id === "string" ? record.id.trim() : "";
    if (!baseId) continue;
    const baseName =
      typeof record.displayName === "string" && record.displayName.trim()
        ? record.displayName.trim()
        : baseId;
    const baseDescription = typeof record.description === "string" ? record.description : undefined;
    const aliasList = Array.isArray(record.aliases)
      ? record.aliases
          .map((alias) => (typeof alias === "string" ? alias.trim() : ""))
          .filter(Boolean)
      : [];
    const variantList = Array.isArray(record.variants) ? record.variants : [];
    const hasSiblings =
      aliasList.some((alias) => wireIdFingerprint(alias) !== wireIdFingerprint(baseId)) ||
      variantList.some((variant) => {
        const wireId = variantWireId(baseId, variant);
        const variantRecord = getRecord(variant);
        const variantName =
          typeof variantRecord.displayName === "string" && variantRecord.displayName.trim()
            ? variantRecord.displayName.trim()
            : wireId;
        return (
          wireIdFingerprint(wireId) !== wireIdFingerprint(baseId) &&
          variantName.toLowerCase() !== baseName.toLowerCase()
        );
      });

    rememberSelection(baseId, { id: baseId });
    addPickerRow({
      id: baseId,
      displayName: baseName,
      description: baseDescription,
      kind: "base",
      baseModelId: baseId,
      showDefaultWire: hasSiblings,
    });

    for (const aliasId of aliasList) {
      rememberSelection(aliasId, { id: baseId });
      if (wireIdFingerprint(aliasId) === wireIdFingerprint(baseId)) continue;
      addPickerRow({
        id: aliasId,
        displayName: baseName,
        description: baseDescription,
        kind: "alias",
        baseModelId: baseId,
      });
    }

    for (const variant of variantList) {
      const variantRecord = getRecord(variant);
      const params = normalizeParams(variantRecord.params);
      const wireId = variantWireId(baseId, variant);
      const variantName =
        typeof variantRecord.displayName === "string" && variantRecord.displayName.trim()
          ? variantRecord.displayName.trim()
          : wireId;
      rememberSelection(wireId, {
        id: baseId,
        ...(params.length > 0 ? { params } : {}),
      });
      if (wireIdFingerprint(wireId) === wireIdFingerprint(baseId)) continue;
      addPickerRow({
        id: wireId,
        displayName: variantName.toLowerCase() === baseName.toLowerCase() ? baseName : variantName,
        description:
          typeof variantRecord.description === "string"
            ? variantRecord.description
            : baseDescription,
        kind: "variant",
        baseModelId: baseId,
        paramSummary: formatCursorModelParamSummary(params),
      });
    }
  }

  return { pickerRows, selectionByWireId };
}

export const LEGACY_WIRE_MODEL_SELECTION: Readonly<Record<string, CursorSdkModelSelection>> = {
  "composer-2-fast": { id: "composer-2" },
  "composer-2.5-fast": { id: "composer-2.5", params: [{ id: "speed", value: "fast" }] },
  "composer-2.5--fast-true": { id: "composer-2.5", params: [{ id: "speed", value: "fast" }] },
  "composer-2.5--speed-fast": { id: "composer-2.5", params: [{ id: "speed", value: "fast" }] },
};

export function recoverSyntheticVariantWireSelection(
  wireModelId: string,
): CursorSdkModelSelection | null {
  const wire = wireModelId.trim();
  if (!wire) return null;
  const legacy = LEGACY_WIRE_MODEL_SELECTION[wire];
  if (legacy) return { ...legacy };
  const separatorIndex = wire.indexOf("--");
  if (separatorIndex <= 0) return null;
  const baseId = wire.slice(0, separatorIndex).trim();
  const suffix = wire
    .slice(separatorIndex + 2)
    .trim()
    .toLowerCase();
  if (!baseId) return null;
  if (!suffix) return { id: baseId };
  if (suffix === "speed-fast" || suffix === "fast-true") {
    return { id: baseId, params: [{ id: "speed", value: "fast" }] };
  }
  for (const paramId of ["speed", "thinking", "reasoning"]) {
    const prefix = `${paramId}-`;
    if (suffix.startsWith(prefix)) {
      const value = suffix.slice(prefix.length);
      if (value) return { id: baseId, params: [{ id: paramId, value }] };
    }
  }
  return { id: baseId };
}

export function resolveCursorModelSelection(
  wireModelId: string,
  catalogByWireId: ReadonlyMap<string, CursorSdkModelSelection> | undefined,
): CursorSdkModelSelection {
  const wire = wireModelId.trim();
  if (!wire) return { id: "composer-2" };
  const fromCatalog = catalogByWireId?.get(wire);
  if (fromCatalog?.id) return fromCatalog;
  const recovered = recoverSyntheticVariantWireSelection(wire);
  if (recovered?.id) return recovered;
  return { id: wire };
}
