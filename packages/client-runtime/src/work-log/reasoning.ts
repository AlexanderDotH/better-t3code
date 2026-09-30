/** Compact title Markdown; callers retain the original text for reasoning details. */
export function reasoningTitleMarkdown(text: string, fallback: string): string {
  const title =
    text
      .trimStart()
      .split(/\r\n?|\n/, 1)[0]
      ?.trim() ?? "";
  return title === "" || /^(?:`{3,}|~{3,})/.test(title) ? fallback : title;
}
