import { ProjectIconOverride, ProjectScript, type ProjectIconColor } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { countGlyphs } from "../../lib/projectIcon";

const isProjectIcon = Schema.is(ProjectIconOverride);
const isProjectScript = Schema.is(ProjectScript);
const PROJECT_EMOJI =
  /^(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}[\uFE0E\uFE0F]?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}[\uFE0E\uFE0F]?\p{Emoji_Modifier}?)*)(?:[\u{E0020}-\u{E007E}]+\u{E007F})?$/u;

export function parseProjectIcon(
  kind: ProjectIconOverride["kind"],
  value: string,
  color: ProjectIconColor,
): ProjectIconOverride | null {
  const text = value.normalize("NFKC").trim();
  const icon =
    kind === "lucide"
      ? { kind, name: text, color }
      : kind === "emoji"
        ? { kind, emoji: text }
        : { kind, text: text.toUpperCase(), color };
  if (kind === "monogram" && countGlyphs(text.toUpperCase()) > 2) return null;
  if (kind === "emoji" && !PROJECT_EMOJI.test(text)) return null;
  return isProjectIcon(icon) ? icon : null;
}

export function parseProjectScript(script: ProjectScript): ProjectScript | null {
  const { previewUrl, autoOpenPreview, ...rest } = script;
  const url = previewUrl?.trim();
  const next = {
    ...rest,
    name: script.name.trim(),
    command: script.command.trim(),
    ...(url ? { previewUrl: url, autoOpenPreview: autoOpenPreview === true } : {}),
  };
  return isProjectScript(next) ? next : null;
}

export function upsertProjectScript(
  scripts: readonly ProjectScript[],
  next: ProjectScript,
): readonly ProjectScript[] {
  const updated = scripts.map((script) =>
    script.id === next.id
      ? next
      : {
          ...script,
          ...(next.runOnWorktreeCreate ? { runOnWorktreeCreate: false } : {}),
          ...(next.runOnSettle ? { runOnSettle: false } : {}),
        },
  );
  return scripts.some((script) => script.id === next.id) ? updated : [...updated, next];
}
