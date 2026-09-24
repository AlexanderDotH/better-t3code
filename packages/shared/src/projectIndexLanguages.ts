export const PROJECT_INDEX_SYNTAX_LANGUAGES = [
  { language: "javascript", grammar: "javascript", extensions: [".js", ".jsx", ".mjs", ".cjs"] },
  { language: "typescript", grammar: "typescript", extensions: [".ts", ".mts", ".cts"] },
  { language: "typescript", grammar: "tsx", extensions: [".tsx"] },
  { language: "csharp", grammar: "c_sharp", extensions: [".cs"] },
  { language: "java", grammar: "java", extensions: [".java"] },
  { language: "python", grammar: "python", extensions: [".py", ".pyi", ".pyw"] },
  { language: "go", grammar: "go", extensions: [".go"] },
  { language: "rust", grammar: "rust", extensions: [".rs"] },
  { language: "kotlin", grammar: "kotlin", extensions: [".kt", ".kts"] },
  { language: "c", grammar: "c", extensions: [".c", ".h"] },
  {
    language: "cpp",
    grammar: "cpp",
    extensions: [".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hh", ".hxx"],
  },
  { language: "ruby", grammar: "ruby", extensions: [".rb", ".rake", ".gemspec"] },
  { language: "php", grammar: "php", extensions: [".php", ".phtml"] },
  { language: "scala", grammar: "scala", extensions: [".scala", ".sc"] },
  { language: "shell", grammar: "bash", extensions: [".sh", ".bash"] },
  { language: "dart", grammar: "dart", extensions: [".dart"] },
  { language: "elixir", grammar: "elixir", extensions: [".ex", ".exs"] },
  { language: "ocaml", grammar: "ocaml", extensions: [".ml", ".mli"] },
  { language: "rescript", grammar: "rescript", extensions: [".res", ".resi"] },
  { language: "solidity", grammar: "solidity", extensions: [".sol"] },
  { language: "zig", grammar: "zig", extensions: [".zig"] },
  { language: "objective-c", grammar: "objc", extensions: [".m", ".mm"] },
  { language: "elisp", grammar: "elisp", extensions: [".el"] },
] as const;

export const PROJECT_INDEX_SYNTAX_GRAMMARS = PROJECT_INDEX_SYNTAX_LANGUAGES.map(
  ({ grammar }) => grammar,
);

export function projectIndexSyntaxGrammar(language: string, extension: string) {
  return PROJECT_INDEX_SYNTAX_LANGUAGES.find(
    (entry) =>
      entry.language === language &&
      (entry.language !== "typescript" || (entry.grammar === "tsx") === (extension === ".tsx")),
  )?.grammar;
}
