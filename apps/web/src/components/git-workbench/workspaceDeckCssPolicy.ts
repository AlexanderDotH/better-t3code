export function workspaceDeckCssPolicySource(css: string): string {
  return css.replace(/^@utility ([\w-]+)(?=\s*\{)/gm, ".$1");
}
