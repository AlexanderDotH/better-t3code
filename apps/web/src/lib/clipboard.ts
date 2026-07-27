export async function writeClipboardText(value: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    throw new Error("Clipboard API unavailable.");
  }

  await navigator.clipboard.writeText(value);
}
