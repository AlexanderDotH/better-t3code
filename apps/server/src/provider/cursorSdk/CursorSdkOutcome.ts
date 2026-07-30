function stringifyForDiagnostic(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncateOneLine(value: unknown, max = 600): string {
  const clean = stringifyForDiagnostic(value).replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function diagnosticFromCursorStreamMessage(message: unknown): string {
  const record = getRecord(message);
  if (record.type === "status") {
    const status = typeof record.status === "string" ? record.status.toUpperCase() : "";
    const text = truncateOneLine(record.message);
    if (status === "ERROR")
      return text ? `Cursor run error: ${text}` : "Cursor run reported an error status";
    return "";
  }
  if (record.type === "tool_call" && record.status === "error") {
    const name =
      typeof record.name === "string" && record.name.trim() ? record.name.trim() : "unknown tool";
    const result = truncateOneLine(record.result);
    return result ? `Cursor tool ${name} failed: ${result}` : `Cursor tool ${name} failed`;
  }
  if (record.type === "task") {
    const status = typeof record.status === "string" ? record.status : "";
    if (!/error|fail/i.test(status)) return "";
    const text = truncateOneLine(record.text);
    return text ? `Cursor task ${status}: ${text}` : `Cursor task ended with ${status}`;
  }
  return "";
}

export function addDiagnostic(diagnostics: Array<string>, message: unknown): void {
  const diagnostic = diagnosticFromCursorStreamMessage(message);
  if (diagnostic && !diagnostics.includes(diagnostic)) diagnostics.push(diagnostic);
}

export function buildCursorTurnOutcome(
  result: unknown,
  streamedAccumulator: string,
  diagnostics: ReadonlyArray<string> = [],
): {
  readonly ok: boolean;
  readonly text: string;
  readonly status?: string | undefined;
  readonly error?: string | undefined;
  readonly warning?: string | undefined;
} {
  const record = getRecord(result);
  const fromResult = typeof record.result === "string" ? record.result.trim() : "";
  const fromStream = streamedAccumulator.trim();
  const text = fromResult || fromStream;
  const status = typeof record.status === "string" ? record.status : "";
  const finished = status === "finished";
  if (finished && text.length > 0) return { ok: true, text, status };

  const diagnostic = diagnostics
    .map((entry) => truncateOneLine(entry))
    .filter(Boolean)
    .join("\n");
  if (status === "error" && text.length > 0) {
    const warning =
      diagnostic ||
      "Cursor run reported an error after streaming the reply, but the SDK did not include details.";
    return {
      ok: true,
      text: `${text}\n\n*Cursor reported an error after streaming the reply: ${warning}*`,
      status,
      warning,
    };
  }

  if (status === "error") {
    return {
      ok: false,
      text,
      status,
      error: diagnostic || "Cursor run reported an error, but the SDK did not include details.",
    };
  }
  if (!finished && status) {
    return {
      ok: false,
      text,
      status,
      error: diagnostic
        ? `Run ended with status: ${status}\n${diagnostic}`
        : `Run ended with status: ${status}`,
    };
  }
  if (!text.length) {
    return {
      ok: false,
      text,
      error:
        diagnostic ||
        "Cursor agent returned no assistant text. Verify the Cursor SDK API key, model, and MCP server.",
    };
  }
  return { ok: false, text, error: diagnostic || "Run did not finish successfully" };
}
