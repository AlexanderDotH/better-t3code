import type { Node as SyntaxNode } from "web-tree-sitter";

function literal(node: SyntaxNode | null | undefined): string | undefined {
  if (
    !node ||
    node.namedChildren.some((child) => child && /interpolation|substitution/u.test(child.type))
  )
    return undefined;
  const text = node.text;
  const quote = text[0];
  if (![34, 39, 96].includes(text.charCodeAt(0)) || text.at(-1) !== quote || text.includes("\\"))
    return undefined;
  return text.slice(1, -1);
}

/** Syntax references require a language-specific resolver before they can become file edges. */
export function syntaxModuleSpecifiers(
  node: SyntaxNode,
  language: string,
): readonly string[] | undefined {
  let specifier: string | undefined;
  switch (language) {
    case "python":
      if (node.type === "import_from_statement")
        specifier = node.childForFieldName("module_name")?.text;
      else if (node.type === "import_statement")
        return node.namedChildren.flatMap((child) => {
          const name = child?.type === "aliased_import" ? child.childForFieldName("name") : child;
          return name?.type === "dotted_name" ? [name.text] : [];
        });
      else return undefined;
      break;
    case "go":
      if (node.type !== "import_spec") return undefined;
      specifier = literal(node.childForFieldName("path"));
      break;
    case "rust":
      if (node.type === "use_declaration") specifier = node.childForFieldName("argument")?.text;
      else if (node.type === "mod_item" && !node.childForFieldName("body"))
        specifier = node.childForFieldName("name")?.text;
      else return undefined;
      break;
    case "c":
    case "cpp":
    case "objective-c": {
      if (node.type !== "preproc_include") return undefined;
      const path = node.childForFieldName("path");
      specifier = path?.type === "system_lib_string" ? path.text.slice(1, -1) : literal(path);
      break;
    }
    case "kotlin":
      if (node.type !== "import_header") return undefined;
      specifier = node.namedChildren.find((child) => child?.type === "identifier")?.text;
      break;
    case "scala":
      if (node.type !== "import_declaration") return undefined;
      specifier = node.childForFieldName("path")?.text;
      break;
    case "dart":
      if (node.type !== "uri") return undefined;
      specifier = literal(node.namedChildren[0]);
      break;
    case "solidity":
      if (node.type !== "import_directive") return undefined;
      specifier = literal(
        node.childForFieldName("source") ??
          node.namedChildren.find((child) => child?.type === "string"),
      );
      break;
    case "zig":
      if (node.type !== "builtin_function" || node.namedChildren[0]?.text !== "@import")
        return undefined;
      specifier = literal(
        node.namedChildren.find((child) => child?.type === "arguments")?.namedChildren[0],
      );
      break;
    case "ruby":
      if (
        node.type !== "call" ||
        !["require", "require_relative", "load"].includes(
          node.childForFieldName("method")?.text ?? "",
        )
      )
        return undefined;
      specifier = literal(node.childForFieldName("arguments")?.namedChildren[0]);
      break;
    case "php":
      if (
        ![
          "include_expression",
          "include_once_expression",
          "require_expression",
          "require_once_expression",
        ].includes(node.type)
      )
        return undefined;
      specifier = literal(node.namedChildren[0]);
      break;
    case "elixir":
      if (
        node.type !== "call" ||
        !["alias", "import", "require", "use"].includes(
          node.childForFieldName("target")?.text ?? "",
        )
      )
        return undefined;
      specifier = node.namedChildren.find((child) => child?.type === "arguments")?.namedChildren[0]
        ?.text;
      break;
    case "ocaml":
      if (node.type !== "open_module") return undefined;
      specifier = node.namedChildren.find((child) => child?.type === "module_path")?.text;
      break;
    default:
      return undefined;
  }
  return specifier ? [specifier] : [];
}
