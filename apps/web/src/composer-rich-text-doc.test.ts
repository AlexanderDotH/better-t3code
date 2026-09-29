import { getSchemaByResolvedExtensions, Node, resolveExtensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskList } from "@tiptap/extension-task-list";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import { describe, expect, it } from "vite-plus/test";

import {
  buildDocJson,
  collapsedToFlat,
  ComposerCodeExtension,
  ComposerTaskItemExtension,
  flatToCollapsed,
  flatToMarkdown,
  flatToPm,
  pmToFlat,
  serializeEditorDoc,
} from "./composer-rich-text-doc";

function stubAtom(name: string, attrs: Record<string, { default: unknown }>) {
  return Node.create({
    name,
    group: "inline",
    inline: true,
    atom: true,
    addAttributes: () => attrs,
  });
}

const schema = getSchemaByResolvedExtensions(
  resolveExtensions([
    StarterKit.configure({
      blockquote: false,
      bulletList: false,
      codeBlock: false,
      heading: false,
      horizontalRule: false,
      listItem: false,
      orderedList: false,
      dropcursor: false,
      gapcursor: false,
      trailingNode: false,
      code: false,
    }),
    ComposerCodeExtension,
    stubAtom("composer-mention", { path: { default: "" }, source: { default: "" } }),
    stubAtom("composer-skill", {
      skillName: { default: "" },
      skillLabel: { default: "" },
      skillDescription: { default: null },
    }),
    stubAtom("composer-citation", {
      citation: { default: null },
      source: { default: "" },
      citeKey: { default: "" },
    }),
    stubAtom("composer-context-reference", {
      kind: { default: "" },
      contextId: { default: "" },
      label: { default: "" },
      source: { default: "" },
    }),
    TaskList,
    ComposerTaskItemExtension,
  ]),
);

function roundTrip(value: string) {
  const json = buildDocJson(value, (name) => ({ label: name, description: null }));
  const doc = ProseMirrorNode.fromJSON(schema, json);
  // `insertContent` validates every node against the schema; `fromJSON` does not.
  doc.check();
  return serializeEditorDoc(doc);
}

// Plain mode: the same engine with the mark extensions off. Markers stay
// literal characters and task lines stay paragraphs.
const plainSchema = getSchemaByResolvedExtensions(
  resolveExtensions([
    StarterKit.configure({
      blockquote: false,
      bulletList: false,
      codeBlock: false,
      heading: false,
      horizontalRule: false,
      listItem: false,
      orderedList: false,
      dropcursor: false,
      gapcursor: false,
      trailingNode: false,
      bold: false,
      italic: false,
      strike: false,
      code: false,
    }),
    stubAtom("composer-mention", { path: { default: "" }, source: { default: "" } }),
    stubAtom("composer-skill", {
      skillName: { default: "" },
      skillLabel: { default: "" },
      skillDescription: { default: null },
    }),
    stubAtom("composer-citation", {
      citation: { default: null },
      source: { default: "" },
      citeKey: { default: "" },
    }),
    stubAtom("composer-context-reference", {
      kind: { default: "" },
      contextId: { default: "" },
      label: { default: "" },
      source: { default: "" },
    }),
    TaskList,
    ComposerTaskItemExtension,
  ]),
);

function roundTripPlain(value: string) {
  const json = buildDocJson(value, (name) => ({ label: name, description: null }), {
    styling: false,
  });
  const doc = ProseMirrorNode.fromJSON(plainSchema, json);
  return serializeEditorDoc(doc);
}

describe("composer rich text document model", () => {
  it.each([
    "[index.ts](apps/web/index.ts), keep the public API unchanged.",
    '[My "File".md](docs/My%20%22File%22.md) please',
    '@"docs/雪 👋.md" please',
    "[config#draft?.json](config%23draft%3f.json) control",
    "Plain text\n  Keep indentation 👋",
  ])("preserves file reference source through rich and plain reloads: %s", (value) => {
    for (const styling of [true, false]) {
      const documentSchema = styling ? schema : plainSchema;
      const doc = ProseMirrorNode.fromJSON(
        documentSchema,
        buildDocJson(value, (name) => ({ label: name, description: null }), { styling }),
      );
      const restored = ProseMirrorNode.fromJSON(documentSchema, doc.toJSON());
      expect(serializeEditorDoc(restored).value).toBe(value);
    }
  });

  it.each([true, false])(
    "keeps repeated quotes and comments independent through edits, styling=%s",
    (styling) => {
      const citation = {
        version: 1 as const,
        environmentId: EnvironmentId.make("environment/remote"),
        threadId: ThreadId.make("thread:one"),
        messageId: MessageId.make("assistant?one"),
        text: "Keep the quote.\n  café 👋",
        start: 0,
        end: 26,
        prefix: "",
        suffix: "",
      };
      const source = serializeAssistantCitation(citation);
      const value = `前(${source}),(${source})後`;
      const documentSchema = styling ? schema : plainSchema;
      const doc = ProseMirrorNode.fromJSON(
        documentSchema,
        buildDocJson(value, (name) => ({ label: name, description: null }), { styling }),
      );
      const citations = serializeEditorDoc(doc).runs.filter(
        (run) => run.kind === "token" && run.nodeName === "composer-citation",
      );
      expect(citations).toHaveLength(2);
      const target = citations[1]!;
      const originalNode = doc.nodeAt(target.pmPos)!;
      const commented = { ...citation, comment: "Use this occurrence.\n  日本語 🚀" };
      const updatedSource = serializeAssistantCitation(commented);
      const originalState = EditorState.create({
        doc,
        selection: TextSelection.create(doc, target.pmPos + originalNode.nodeSize),
      });
      const editedState = originalState.apply(
        originalState.tr.setNodeMarkup(target.pmPos, undefined, {
          ...originalNode.attrs,
          citation: commented,
          source: updatedSource,
        }),
      );
      const expected = `前(${source}),(${updatedSource})後`;
      expect(serializeEditorDoc(editedState.doc).value).toBe(expected);
      expect(editedState.selection.eq(originalState.selection)).toBe(true);
      expect(serializeEditorDoc(originalState.doc).value).toBe(value);
      const restored = ProseMirrorNode.fromJSON(documentSchema, editedState.doc.toJSON());
      expect(serializeEditorDoc(restored).value).toBe(expected);
      const deletedState = editedState.apply(
        editedState.tr.delete(target.pmPos, target.pmPos + originalNode.nodeSize),
      );
      expect(serializeEditorDoc(deletedState.doc).value).toBe(`前(${source}),()後`);
    },
  );

  it.each(["€", "£", "¥", "₹", "₩", "₿", "𑿝"])(
    "canonicalizes %s skill aliases while preserving amounts",
    (prefix) => {
      const value = `Use ${prefix}my-skill for ${prefix}20 please`;
      const expected = `Use $my-skill for ${prefix}20 please`;
      expect(roundTrip(value).value).toBe(expected);
      expect(roundTripPlain(value).value).toBe(expected);
    },
  );

  it.each([
    "",
    "\n\n",
    "plain text",
    "hello **bold** world",
    "a *italic* word and `code` here",
    "struck ~~out~~ now",
    "**`x`**",
    "*`x`*",
    "~~`x`~~",
    "**a `code` c**",
    "***bold italic*** keeps nesting",
    "line one\nline two",
    "trailing newline\n",
    "1. foo\n2. asdf\n",
    "- [ ] buy milk",
    "-   [ ]  buy milk",
    "\t-\t[x]\t\titem",
    "- [ ]  ",
    "- [ ]\n  - [ ] child",
    "  - [ ] first\n - [ ] second\n  - [ ] child",
    "**before @README.md after**",
    "*a **b** c*",
    "*a**b***",
    "**a*b***",
    "**a *b* c**",
    "literal \uFFFC **before @README.md after**",
    "- [x] done\n- [ ] next",
    "- [ ] parent\n  - [ ] child\n  - [ ] sibling\n- [ ] uncle",
    "- [ ] empty task follows\n- [ ]",
    "- [ ] **bold** task with @README.md",
    "para\n- [ ] task\npara",
    "- [ ]No space stays literal",
    "-[ ] also literal",
    "@README.md explain this",
    '@"docs/My File.md" and $my-skill please',
    "snake_case stays literal",
    "unmatched ** stays literal",
    "**bold** then @README.md then *italic*",
  ])("round-trips %s through a real ProseMirror document", (value) => {
    expect(roundTrip(value).value).toBe(value);
  });

  it.each([
    "",
    "\n",
    "text\n\n",
    "- [ ]\n- [ ] next\n",
    "- [ ] parent\n  - [ ] child\n- [ ]",
    "para\n- [ ] task\npara",
    "**before @README.md after**",
  ])("maps editable positions in %s", (value) => {
    const doc = ProseMirrorNode.fromJSON(
      schema,
      buildDocJson(value, (name) => ({ label: name, description: null })),
    );
    const map = serializeEditorDoc(doc);
    for (let flat = 0; flat <= map.docLength; flat += 1) {
      const position = flatToPm(map, flat);
      expect(doc.resolve(position).parent.isTextblock).toBe(true);
      expect(pmToFlat(map, position)).toBe(flat);
      expect(collapsedToFlat(map, flatToCollapsed(map, flat))).toBe(flat);
    }
  });

  it("keeps the caret after a trailing hard break inside the same paragraph", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("a"), schema.node("hardBreak")]),
    ]);
    const map = serializeEditorDoc(doc);
    expect(flatToPm(map, map.docLength)).toBe(3);
    expect(doc.resolve(flatToPm(map, map.docLength)).parent.isTextblock).toBe(true);
  });

  it("renders a leading task dedent as siblings and nests under the new indent", () => {
    const doc = ProseMirrorNode.fromJSON(
      schema,
      buildDocJson("  - [ ] first\n - [ ] second\n  - [ ] child", (name) => ({
        label: name,
        description: null,
      })),
    );
    const list = doc.firstChild!;
    expect(list.childCount).toBe(2);
    expect(list.child(0).childCount).toBe(1);
    expect(list.child(1).child(1).firstChild!.textContent).toBe("child");
  });

  it("applies a shared mark to text on both sides of a chip", () => {
    const doc = ProseMirrorNode.fromJSON(
      schema,
      buildDocJson("**before @README.md after**", (name) => ({ label: name, description: null })),
    );
    expect(doc.firstChild!.childCount).toBe(3);
    doc.firstChild!.forEach((child) =>
      expect(child.marks.map((mark) => mark.type.name)).toContain("bold"),
    );
    expect(serializeEditorDoc(doc).value).toBe("**before @README.md after**");
  });

  it.each([
    [["bold"], ["bold", "italic"], ["italic"]],
    [["italic"], ["bold", "italic"], ["bold"]],
    [["bold"], ["bold", "strike"], ["strike"]],
    [["strike"], ["bold", "strike"], ["bold"]],
  ])("preserves crossing mark ranges %j through controlled rebuilds", (...marks) => {
    const doc = schema.node("doc", null, [
      schema.node(
        "paragraph",
        null,
        marks.map((names, index) =>
          schema.text(
            String.fromCharCode(97 + index),
            names.map((name) => schema.mark(name)),
          ),
        ),
      ),
    ]);
    const serialized = serializeEditorDoc(doc).value;
    const rebuilt = ProseMirrorNode.fromJSON(
      schema,
      buildDocJson(serialized, (name) => ({ label: name, description: null })),
    );
    expect(rebuilt.eq(doc)).toBe(true);
    expect(serializeEditorDoc(rebuilt).value).toBe(serialized);
  });

  it.each([
    { parts: [{ text: "hello ", marks: ["bold"] }], expected: "**hello** " },
    { parts: [{ text: "  ", marks: ["bold"] }], expected: "  " },
    { parts: [{ text: " left ", marks: ["bold", "italic"] }], expected: " ***left*** " },
    {
      parts: [
        { text: "one ", marks: ["bold"] },
        { text: " two ", marks: ["bold", "italic"] },
        { text: " three", marks: ["bold"] },
      ],
      expected: "**one  *two*  three**",
    },
    {
      parts: [
        { text: "hello ", marks: ["bold"] },
        { text: "world ", marks: ["bold", "italic"] },
      ],
      expected: "**hello *world*** ",
    },
    { parts: [{ text: " hello ", marks: ["code"] }], expected: "` hello `" },
    { parts: [{ text: " hello ", marks: ["bold", "code"] }], expected: "**` hello `**" },
    { parts: [{ text: " ", marks: ["bold", "code"] }], expected: "**` `**" },
  ])("keeps boundary whitespace outside emphasis in $expected", ({ parts, expected }) => {
    const doc = schema.node("doc", null, [
      schema.node(
        "paragraph",
        null,
        parts.map(({ text, marks }) =>
          schema.text(
            text,
            marks.map((name) => schema.mark(name)),
          ),
        ),
      ),
    ]);
    const map = serializeEditorDoc(doc);
    expect(map.value).toBe(expected);
    const rebuilt = ProseMirrorNode.fromJSON(
      schema,
      buildDocJson(map.value, (name) => ({ label: name, description: null })),
    );
    expect(rebuilt.textContent).toBe(doc.textContent);
    expect(serializeEditorDoc(rebuilt).value).toBe(map.value);
    for (let flat = 0; flat <= map.docLength; flat += 1) {
      expect(pmToFlat(map, flatToPm(map, flat))).toBe(flat);
      expect(collapsedToFlat(map, flatToCollapsed(map, flat))).toBe(flat);
      if (flat < map.docLength && !/\s/.test(doc.textContent[flat]!)) {
        expect(rebuilt.resolve(flat + 1).nodeAfter!.marks.map((mark) => mark.type.name)).toEqual(
          doc.resolve(flat + 1).nodeAfter!.marks.map((mark) => mark.type.name),
        );
      }
    }
  });

  it("keeps chip sources canonical through the document", () => {
    const map = roundTrip("explain @README.md with **care**\nsecond line *here*");
    expect(map.value).toBe("explain @README.md with **care**\nsecond line *here*");
    expect(
      map.runs.some((run) => run.kind === "token" && run.nodeName === "composer-mention"),
    ).toBe(true);
  });

  it("normalizes uppercase checkboxes to lowercase", () => {
    expect(roundTrip("- [X] done").value).toBe("- [x] done");
  });

  it.each([
    "plain text",
    "hello **bold** stays literal",
    "a *italic* stays literal",
    "some `code` stays literal",
    "struck ~~out~~ stays literal",
    "- [ ] stays a paragraph",
    "- [x] stays a paragraph",
    "line one\nline two",
    "@README.md explain this",
    "**bold** then @README.md then *italic*",
  ])("round-trips %s byte-identically in plain mode", (value) => {
    expect(roundTripPlain(value).value).toBe(value);
  });

  it("maps every document offset through collapsed coordinates and back", () => {
    const value = "hi **bold** @README.md bye";
    const map = roundTrip(value);
    expect(map.value).toBe(value);
    for (let flat = 0; flat <= map.docLength; flat += 1) {
      expect(collapsedToFlat(map, flatToCollapsed(map, flat))).toBe(flat);
    }
  });

  it("maps markdown offsets at styled edges onto document text", () => {
    const value = "a **bold** c";
    const map = roundTrip(value);
    expect(map.value).toBe(value);
    // document text is "a bold c" (flat), markdown has the markers.
    expect(flatToMarkdown(map, 2)).toBe(4);
    expect(flatToMarkdown(map, 6)).toBe(10);
    expect(collapsedToFlat(map, 3)).toBe(2);
    expect(collapsedToFlat(map, 9)).toBe(6);
  });
});
