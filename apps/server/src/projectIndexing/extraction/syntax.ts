// @effect-diagnostics nodeBuiltinImport:off - Tree-sitter's WASM loader resolves host filesystem assets.
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

import type {
  ProjectCallsiteV1,
  ProjectEntityV1,
  ProjectImportV1,
  ProjectSourceRangeV1,
  ProjectEntityVisibility,
} from "@t3tools/contracts";
import { Language, Parser, type Node as SyntaxNode } from "web-tree-sitter";
import {
  PROJECT_INDEX_SYNTAX_GRAMMARS,
  projectIndexSyntaxGrammar,
} from "@t3tools/shared/projectIndexLanguages";

import { coverageGap, sourceLanguage, supportsSyntax, type ExtractionGap } from "./inventory.ts";
import { rangeFromOffsets, sourceHash, stableId } from "./source.ts";
import { syntaxModuleSpecifiers } from "./syntaxModules.ts";

const require = NodeModule.createRequire(import.meta.url);
const projectIndexerAssets = {
  runtime: "web-tree-sitter/tree-sitter.wasm",
  grammars: PROJECT_INDEX_SYNTAX_GRAMMARS.map(
    (name) => `tree-sitter-wasms/out/tree-sitter-${name}.wasm`,
  ),
  runtimeVersion: "0.25.10",
  grammarVersion: "0.1.13",
} as const;

let parserReady: Promise<void> | undefined;
const grammarCache = new Map<string, Promise<Language>>();

async function loadGrammar(grammar: string) {
  parserReady ??= Parser.init({ locateFile: () => require.resolve(projectIndexerAssets.runtime) });
  await parserReady;
  let pending = grammarCache.get(grammar);
  if (!pending) {
    pending = Language.load(require.resolve(`tree-sitter-wasms/out/tree-sitter-${grammar}.wasm`));
    grammarCache.set(grammar, pending);
    void pending.catch(() => grammarCache.delete(grammar));
  }
  return pending;
}

export async function probeSyntaxGrammars() {
  const results: { grammar: string; version: number }[] = [];
  for (const grammar of PROJECT_INDEX_SYNTAX_GRAMMARS) {
    const language = await loadGrammar(grammar);
    results.push({ grammar, version: language.abiVersion });
  }
  return results;
}

function nodeRange(node: SyntaxNode): ProjectSourceRangeV1 {
  return {
    startLine: node.startPosition.row + 1,
    startColumn: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column + 1,
    startOffset: node.startIndex,
    endOffset: node.endIndex,
  };
}

const declarationKinds: Readonly<Record<string, ProjectEntityV1["kind"]>> = {
  class_definition: "class",
  class_specifier: "class",
  struct_specifier: "class",
  union_specifier: "class",
  struct_item: "class",
  impl_item: "class",
  contract_declaration: "class",
  class_interface: "interface",
  class_implementation: "class",
  protocol_declaration: "interface",
  trait_definition: "interface",
  trait_declaration: "interface",
  trait_item: "interface",
  object_definition: "class",
  enum_item: "enum",
  enum_specifier: "enum",
  namespace_definition: "namespace",
  mod_item: "module",
  function_definition: "function",
  function_definition_statement: "function",
  function_item: "function",
  method: "method",
  singleton_method: "method",
  init_declaration: "constructor",
  type_item: "type",
  type_definition: "type",
  typealias_declaration: "type",
  const_item: "variable",
  static_item: "variable",
  closure_expression: "lambda",
  lambda: "lambda",
  class_declaration: "class",
  class: "class",
  class_expression: "class",
  record_declaration: "class",
  struct_declaration: "class",
  interface_declaration: "interface",
  annotation_type_declaration: "interface",
  enum_declaration: "enum",
  namespace_declaration: "namespace",
  file_scoped_namespace_declaration: "namespace",
  internal_module: "namespace",
  module: "module",
  method_definition: "method",
  method_declaration: "method",
  method_signature: "method",
  abstract_method_signature: "method",
  constructor_declaration: "constructor",
  compact_constructor_declaration: "constructor",
  constructor_signature: "constructor",
  function_declaration: "function",
  generator_function_declaration: "function",
  function_signature: "function",
  local_function_statement: "function",
  function_expression: "function",
  generator_function: "function",
  arrow_function: "lambda",
  lambda_expression: "lambda",
  anonymous_method_expression: "lambda",
  property_declaration: "property",
  property_signature: "property",
  public_field_definition: "property",
  field_definition: "property",
  variable_declarator: "variable",
  type_alias_declaration: "type",
  delegate_declaration: "type",
  accessor_declaration: "method",
  indexer_declaration: "property",
  operator_declaration: "method",
  conversion_operator_declaration: "method",
  destructor_declaration: "method",
  static_initializer: "initializer",
  class_static_block: "initializer",
};
const callKinds = new Set([
  "call_expression",
  "new_expression",
  "invocation_expression",
  "object_creation_expression",
  "implicit_object_creation_expression",
  "method_invocation",
  "explicit_constructor_invocation",
  "constructor_initializer",
  "call",
  "function_call_expression",
  "member_call_expression",
  "scoped_call_expression",
  "application_expression",
]);
const callableKinds = new Set<ProjectEntityV1["kind"]>([
  "method",
  "constructor",
  "function",
  "lambda",
  "initializer",
  "property",
  "file",
]);

function declarationKind(node: SyntaxNode, language: string): ProjectEntityV1["kind"] | undefined {
  if (language === "python" && node.type === "module") return undefined;
  if (language === "elixir" && node.type === "call") {
    const macro = node.childForFieldName("target")?.text;
    if (["defmodule", "defprotocol", "defimpl"].includes(macro ?? "")) return "module";
    if (["def", "defp", "defmacro", "defmacrop"].includes(macro ?? "")) return "function";
  }
  if (node.type === "let_binding" && ["ocaml", "rescript"].includes(language))
    return node.namedChildren.some(
      (child) => child?.type === "parameter" || child?.type === "function",
    )
      ? "function"
      : "variable";
  if (node.type === "type_spec")
    return node.childForFieldName("type")?.type === "struct_type" ? "class" : "type";
  if (language === "dart" && node.type === "method_signature") return undefined;
  if (node.type === "method_definition" && node.childForFieldName("name")?.text === "constructor")
    return "constructor";
  if (node.type === "block" && node.parent?.type === "class_body") return "initializer";
  if (node.type === "class_body" && node.parent?.type === "object_creation_expression")
    return "class";
  return declarationKinds[node.type];
}

function declarationNameNode(node: SyntaxNode): SyntaxNode | null | undefined {
  if (node.type === "call") {
    const first = node.namedChildren.find((child) => child?.type === "arguments")?.namedChildren[0];
    return first?.type === "call" ? first.childForFieldName("target") : first;
  }
  if (node.type === "let_binding") return node.childForFieldName("pattern");
  if (node.type === "impl_item") return node.childForFieldName("type");
  let declarator = node.childForFieldName("declarator");
  while (declarator?.childForFieldName("declarator"))
    declarator = declarator.childForFieldName("declarator");
  return (
    node.childForFieldName("name") ??
    declarator ??
    ([
      "class_declaration",
      "function_declaration",
      "class_interface",
      "class_implementation",
      "method_declaration",
      "method_definition",
    ].includes(node.type)
      ? node.namedChildren.find((child) =>
          ["identifier", "simple_identifier", "type_identifier"].includes(child?.type ?? ""),
        )
      : undefined) ??
    (node.type === "variable_declarator"
      ? node.namedChildren.find((child) => child?.type === "identifier")
      : undefined)
  );
}

function variableFieldDeclaration(node: SyntaxNode): SyntaxNode | undefined {
  if (node.type !== "variable_declarator") return undefined;
  const declaration =
    node.parent?.type === "variable_declaration" ? node.parent.parent : node.parent;
  if (declaration?.type !== "field_declaration" && declaration?.type !== "event_field_declaration")
    return undefined;
  return declaration;
}

function variableFieldInitializer(node: SyntaxNode): SyntaxNode | null | undefined {
  if (!variableFieldDeclaration(node)) return undefined;
  return (
    node.childForFieldName("value") ??
    node.namedChildren.find((child) => child?.type === "equals_value_clause")
  );
}

function declarationVisibility(
  node: SyntaxNode,
  kind: ProjectEntityV1["kind"],
): ProjectEntityVisibility {
  if (declarationNameNode(node)?.text.startsWith("#")) return "private";
  const owner = variableFieldDeclaration(node) ?? node;
  const modifiers = new Set<string>();
  for (const child of owner.namedChildren) {
    if (!child || !["modifier", "modifiers", "accessibility_modifier"].includes(child.type))
      continue;
    for (const token of [child, ...child.children])
      if (token && ["public", "protected", "internal", "private"].includes(token.text))
        modifiers.add(token.text);
  }
  if (modifiers.size === 2 && modifiers.has("protected") && modifiers.has("internal"))
    return "protected-internal";
  if (modifiers.size === 2 && modifiers.has("private") && modifiers.has("protected"))
    return "private-protected";
  if (modifiers.size === 1) {
    if (modifiers.has("public")) return "public";
    if (modifiers.has("protected")) return "protected";
    if (modifiers.has("internal")) return "internal";
    return "private";
  }
  if (
    node.parent?.type === "export_statement" ||
    (kind === "variable" && node.parent?.parent?.type === "export_statement")
  )
    return "public";
  if (
    kind === "lambda" ||
    (kind === "variable" && !variableFieldDeclaration(node)) ||
    ["function_expression", "local_function_statement"].includes(node.type)
  )
    return "local";
  return "unknown";
}

function declarationName(node: SyntaxNode, kind: ProjectEntityV1["kind"], ordinal: number): string {
  const name = declarationNameNode(node)?.text;
  if (name) return name;
  if (node.type === "accessor_declaration")
    return (
      node.children.find(
        (child) => child && ["get", "set", "init", "add", "remove"].includes(child.type),
      )?.text ?? "accessor"
    );
  if (kind === "lambda" || kind === "function") {
    const parent = node.parent;
    const bindingName = parent?.childForFieldName("name") ?? parent?.childForFieldName("key");
    if (bindingName) return `${bindingName.text}::<${kind}>`;
  }
  if (kind === "constructor") return "constructor";
  if (node.type === "operator_declaration" || node.type === "conversion_operator_declaration")
    return `operator ${node.childForFieldName("operator")?.text ?? node.childForFieldName("type")?.text ?? "conversion"}`;
  if (node.type === "indexer_declaration") return "this[]";
  return `<${kind}>#${ordinal}`;
}

function declarationSignature(node: SyntaxNode): string {
  const body =
    node.childForFieldName("body") ??
    node.childForFieldName("value") ??
    node.childForFieldName("accessors") ??
    node.namedChildren.find((child) => child?.type === "equals_value_clause");
  const end = body?.startIndex ?? node.endIndex;
  return node.text
    .slice(0, Math.max(0, end - node.startIndex))
    .replace(/\s+/g, " ")
    .trim();
}

function callExpression(node: SyntaxNode) {
  const callee =
    node.childForFieldName("function") ??
    node.childForFieldName("method") ??
    node.childForFieldName("target") ??
    node.childForFieldName("constructor") ??
    node.childForFieldName("name") ??
    node.childForFieldName("type") ??
    node.namedChildren.find((child) =>
      ["identifier", "simple_identifier"].includes(child?.type ?? ""),
    );
  const expression = callee?.text ?? node.text;
  const dynamic =
    callee?.type === "subscript_expression" || callee?.type === "element_access_expression";
  const imported = expression === "import" || expression === "require";
  return {
    expression,
    callee,
    dispatch: imported
      ? ("import" as const)
      : dynamic
        ? ("dynamic" as const)
        : ("unknown" as const),
  };
}

export interface SyntaxExtraction {
  entities: ProjectEntityV1[];
  callsites: ProjectCallsiteV1[];
  imports: ProjectImportV1[];
  gaps: ExtractionGap[];
}

function moduleSpecifier(node: SyntaxNode, language: string): string | undefined {
  if (language === "typescript" || language === "javascript") {
    const literal =
      node.childForFieldName("source") ??
      (node.type === "import_statement"
        ? node.namedChildren
            .find((child) => child?.type === "import_require_clause")
            ?.namedChildren.find((child) => child?.type === "string")
        : node.type === "call_expression"
          ? node.childForFieldName("arguments")?.namedChildren[0]
          : undefined);
    return literal?.type === "string" ? literal.text.slice(1, -1) : undefined;
  }
  if (language === "csharp")
    return node.namedChildren.find((child) =>
      ["qualified_name", "identifier", "alias_qualified_name"].includes(child?.type ?? ""),
    )?.text;
  if (language === "java") {
    const name = node.namedChildren.find((child) =>
      ["scoped_identifier", "identifier"].includes(child?.type ?? ""),
    )?.text;
    return name
      ? `${name}${node.namedChildren.some((child) => child?.type === "asterisk") ? ".*" : ""}`
      : undefined;
  }
  return undefined;
}

function isModuleReference(node: SyntaxNode, language: string): boolean {
  if (language === "csharp") return node.type === "using_directive";
  if (language === "java") return node.type === "import_declaration";
  if (language !== "typescript" && language !== "javascript") return false;
  if (node.type === "import_statement") return true;
  if (node.type === "export_statement") return node.childForFieldName("source") !== null;
  return (
    node.type === "call_expression" &&
    ["import", "require"].includes(node.childForFieldName("function")?.text ?? "") &&
    node.parent?.type !== "import_require_clause"
  );
}

/** Grammar trees provide complete syntax inventory. Name resemblance never becomes an exact call edge. */
export async function extractSyntax(input: {
  filePath: string;
  source: string;
  language?: string;
  sourceHash?: string;
  signal?: AbortSignal;
}): Promise<SyntaxExtraction> {
  input.signal?.throwIfAborted();
  const language = input.language ?? sourceLanguage(input.filePath);
  const hash = input.sourceHash ?? sourceHash(input.source);
  const gaps: ExtractionGap[] = [];
  const fileEntity: ProjectEntityV1 = {
    id: stableId("entity", language, input.filePath, "file"),
    filePath: input.filePath,
    kind: "file",
    name: NodePath.posix.basename(input.filePath),
    qualifiedName: input.filePath,
    language,
    range: rangeFromOffsets(input.source, 0, input.source.length),
    sourceHash: hash,
    provenance: "parser",
    freshness: "current",
    evidenceIds: [],
  };
  const entities = [fileEntity];
  const callsites: ProjectCallsiteV1[] = [];
  const imports: ProjectImportV1[] = [];
  if (!supportsSyntax(language)) {
    if (
      ![
        "md",
        "mdx",
        "txt",
        "json",
        "jsonc",
        "yaml",
        "yml",
        "xml",
        "toml",
        "ini",
        "text",
        "props",
        "targets",
        "config",
      ].includes(language)
    ) {
      gaps.push(
        coverageGap(
          "unsupported-language",
          `No syntax adapter for ${language}; the complete file remains inventoried.`,
          input.filePath,
        ),
      );
    }
    return { entities, callsites, imports, gaps };
  }
  const grammar = projectIndexSyntaxGrammar(
    language,
    NodePath.extname(input.filePath).toLowerCase(),
  )!;
  let parser: Parser | undefined;
  let tree;
  try {
    const loadedGrammar = await loadGrammar(grammar);
    parser = new Parser();
    parser.setLanguage(loadedGrammar);
    tree = parser.parse(input.source, undefined, {
      progressCallback: () => input.signal?.aborted ?? false,
    });
    input.signal?.throwIfAborted();
    if (!tree) throw new Error("Parser did not produce a syntax tree.");
    if (tree.rootNode.hasError)
      gaps.push(
        coverageGap(
          "parse-error",
          "The grammar recovered from malformed or unsupported syntax; recovered entities remain available.",
          input.filePath,
        ),
      );
    const entityOccurrences = new Map<string, number>();
    const callOccurrences = new Map<string, number>();
    const importOccurrences = new Map<string, number>();
    const anonymousCounts = new Map<string, number>();
    const implicitDispatchGaps = new Set<string>();
    const packageNode =
      language === "java"
        ? tree.rootNode.namedChildren.find((node) => node?.type === "package_declaration")
        : undefined;
    const packageName = packageNode?.namedChildren.find(
      (node) => node && ["identifier", "scoped_identifier"].includes(node.type),
    )?.text;
    const packageEntity: ProjectEntityV1 | undefined =
      packageNode && packageName
        ? {
            ...fileEntity,
            id: stableId("entity", language, input.filePath, "namespace", packageName),
            kind: "namespace",
            name: packageName,
            qualifiedName: `${input.filePath}::${packageName}`,
            containerId: fileEntity.id,
            range: nodeRange(packageNode),
          }
        : undefined;
    if (packageEntity) entities.push(packageEntity);
    const stack: { node: SyntaxNode; container: ProjectEntityV1; caller: ProjectEntityV1 }[] = [
      { node: tree.rootNode, container: packageEntity ?? fileEntity, caller: fileEntity },
    ];
    const boundedText = (value: string, limit: number, description: string) => {
      if (value.length <= limit) return value;
      gaps.push(
        coverageGap(
          "limit",
          `${description} exceeds metadata capacity; the exact full source remains accessible through its source range.`,
          input.filePath,
        ),
      );
      return value.slice(0, limit);
    };
    while (stack.length > 0) {
      input.signal?.throwIfAborted();
      const current = stack.pop()!;
      const { node } = current;
      let { container, caller } = current;
      const declaredKind = declarationKind(node, language);
      const kind =
        declaredKind === "function" && container.kind === "class" ? "method" : declaredKind;
      const implicitDispatch = ["operator_declaration", "conversion_operator_declaration"].includes(
        node.type,
      )
        ? "operator"
        : node.type === "accessor_declaration" &&
            node.namedChildren.some(
              (child) => child && ["block", "arrow_expression_clause"].includes(child.type),
            )
          ? "accessor"
          : undefined;
      if (implicitDispatch && !implicitDispatchGaps.has(implicitDispatch)) {
        implicitDispatchGaps.add(implicitDispatch);
        gaps.push(
          coverageGap(
            "incomplete-analysis",
            `Implicit ${implicitDispatch} dispatch is not exhaustively represented by the explicit-invocation call graph; its executable declarations remain indexed.`,
            input.filePath,
          ),
        );
      }
      if (kind) {
        const countKey = `${container.id}:${kind}`;
        const ordinal = (anonymousCounts.get(countKey) ?? 0) + 1;
        anonymousCounts.set(countKey, ordinal);
        const name = declarationName(node, kind, ordinal);
        const nameNode = declarationNameNode(node);
        const qualifiedName = `${container.qualifiedName}::${name}`;
        const signature = declarationSignature(node);
        const identity = stableId(
          "entity",
          language,
          input.filePath,
          container.id,
          kind,
          name,
          signature,
        );
        const occurrence = entityOccurrences.get(identity) ?? 0;
        entityOccurrences.set(identity, occurrence + 1);
        const entity: ProjectEntityV1 = {
          id: occurrence === 0 ? identity : stableId("entity", identity, String(occurrence)),
          filePath: input.filePath,
          kind,
          name: boundedText(name, 1024, "Symbol name"),
          qualifiedName: boundedText(qualifiedName, 1024, "Qualified symbol name"),
          signature: boundedText(signature, 16_000, "Symbol signature"),
          containerId: container.id,
          language,
          visibility: declarationVisibility(node, kind),
          range: nodeRange(node),
          ...(nameNode ? { nameRange: nodeRange(nameNode) } : {}),
          sourceHash: hash,
          provenance: "parser",
          freshness: "current",
          evidenceIds: [],
        };
        entities.push(entity);
        container = entity;
        if (callableKinds.has(kind)) caller = entity;
        const fieldInitializer = variableFieldInitializer(node);
        if (fieldInitializer) {
          const initializer: ProjectEntityV1 = {
            id: stableId("entity", entity.id, "initializer"),
            filePath: input.filePath,
            kind: "initializer",
            name: "<initializer>",
            qualifiedName: boundedText(
              `${entity.qualifiedName}::<initializer>`,
              1024,
              "Initializer name",
            ),
            signature: "<field initializer>",
            containerId: entity.id,
            language,
            range: nodeRange(fieldInitializer),
            sourceHash: hash,
            provenance: "parser",
            freshness: "current",
            evidenceIds: [],
          };
          entities.push(initializer);
          // The declaration still contains its lambda/function so compiler target binding remains stable.
          caller = initializer;
        }
      }
      const declarationCall =
        language === "elixir" &&
        (kind !== undefined ||
          (node.parent?.type === "arguments" &&
            node.parent.parent &&
            declarationKind(node.parent.parent, language) !== undefined));
      if (callKinds.has(node.type) && !declarationCall) {
        const { expression, dispatch } = callExpression(node);
        const key = stableId("callsite", input.filePath, caller.id, expression);
        const ordinal = callOccurrences.get(key) ?? 0;
        callOccurrences.set(key, ordinal + 1);
        callsites.push({
          id: stableId("callsite", key, String(ordinal)),
          callerEntityId: caller.id,
          filePath: input.filePath,
          range: nodeRange(node),
          expression: boundedText(expression, 16_000, "Call expression"),
          dispatch,
          resolution: "unresolved",
          targetEntityIds: [],
          reason: ["javascript", "typescript", "csharp", "java"].includes(language)
            ? "Awaiting compiler resolution."
            : "Syntax reference; this language has no compiler call-resolution adapter.",
          sourceHash: hash,
          provenance: "parser",
          freshness: "current",
          evidenceIds: [],
        });
      }
      const specifiers =
        syntaxModuleSpecifiers(node, language) ??
        (isModuleReference(node, language)
          ? [moduleSpecifier(node, language)].filter(
              (value): value is string => value !== undefined,
            )
          : undefined);
      if (specifiers !== undefined) {
        if (specifiers.length === 0) {
          gaps.push(
            coverageGap(
              "incomplete-analysis",
              "A dynamic or malformed module reference has no statically known target.",
              input.filePath,
            ),
          );
        }
        for (const specifier of specifiers) {
          const importText = boundedText(node.text, 16_000, "Import text");
          const boundedSpecifier = boundedText(specifier, 1_024, "Import specifier");
          const identity = stableId("import", input.filePath, importText);
          const occurrence = importOccurrences.get(identity) ?? 0;
          importOccurrences.set(identity, occurrence + 1);
          imports.push({
            id: stableId("import", identity, String(occurrence)),
            filePath: input.filePath,
            sourceHash: hash,
            range: nodeRange(node),
            importText,
            specifier: boundedSpecifier,
            resolution: "unresolved",
            provenance: "parser",
            freshness: "current",
            evidenceIds: [],
          });
        }
      }
      for (const child of node.namedChildren.toReversed())
        if (child) stack.push({ node: child, container, caller });
    }
  } catch (error) {
    input.signal?.throwIfAborted();
    gaps.push(
      coverageGap(
        "parse-error",
        `Syntax extraction failed: ${String(error)}`,
        input.filePath,
        true,
      ),
    );
  } finally {
    tree?.delete();
    parser?.delete();
  }
  return { entities, callsites, imports, gaps };
}
