import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { chatMarkdownClipboardPayload } from "./markdown-clipboard";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const DOCUMENT_FRAGMENT_NODE = 11;

abstract class FakeNode {
  static readonly ELEMENT_NODE = ELEMENT_NODE;
  static readonly TEXT_NODE = TEXT_NODE;

  parentNode: FakeElement | FakeDocumentFragment | null = null;
  childNodes: FakeNode[] = [];

  abstract readonly nodeType: number;

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }

  appendChild(child: FakeNode): FakeNode {
    if (child.nodeType === DOCUMENT_FRAGMENT_NODE) {
      while (child.childNodes.length > 0) {
        const descendant = child.childNodes[0];
        if (!descendant) break;
        this.appendChild(descendant);
      }
      return child;
    }

    child.removeFromParent();
    child.parentNode = this as FakeElement | FakeDocumentFragment;
    this.childNodes.push(child);
    return child;
  }

  replaceWith(...replacements: FakeNode[]): void {
    const parent = this.parentNode;
    if (!parent) return;
    const index = parent.childNodes.indexOf(this);
    if (index < 0) return;

    for (const replacement of replacements) {
      replacement.removeFromParent();
      replacement.parentNode = parent;
    }
    parent.childNodes.splice(index, 1, ...replacements);
    this.parentNode = null;
  }

  remove(): void {
    this.removeFromParent();
  }

  protected removeFromParent(): void {
    if (!this.parentNode) return;
    const index = this.parentNode.childNodes.indexOf(this);
    if (index >= 0) this.parentNode.childNodes.splice(index, 1);
    this.parentNode = null;
  }

  abstract cloneNode(deep?: boolean): FakeNode;
}

class FakeText extends FakeNode {
  readonly nodeType = TEXT_NODE;

  constructor(private readonly value: string) {
    super();
  }

  override get textContent(): string {
    return this.value;
  }

  cloneNode(): FakeText {
    return new FakeText(this.value);
  }
}

class FakeDocumentFragment extends FakeNode {
  readonly nodeType = DOCUMENT_FRAGMENT_NODE;

  cloneNode(deep = false): FakeDocumentFragment {
    const clone = new FakeDocumentFragment();
    if (deep) {
      for (const child of this.childNodes) clone.appendChild(child.cloneNode(true));
    }
    return clone;
  }
}

class FakeElement extends FakeNode {
  readonly nodeType = ELEMENT_NODE;
  readonly tagName: string;
  readonly localName: string;
  readonly style: { textAlign?: string };
  private readonly attributes = new Map<string, string>();

  constructor(tagName: string, attributes: Record<string, string> = {}) {
    super();
    this.tagName = tagName.toUpperCase();
    this.localName = tagName.toLowerCase();
    for (const [name, value] of Object.entries(attributes)) this.attributes.set(name, value);
    const textAlign = styleDeclarationValue(attributes.style, "text-align");
    this.style = textAlign ? { textAlign } : {};
  }

  get children(): FakeElement[] {
    return this.childNodes.filter((child): child is FakeElement => child.nodeType === ELEMENT_NODE);
  }

  get className(): string {
    return this.getAttribute("class") ?? "";
  }

  get classList(): { contains: (className: string) => boolean } {
    const classes = new Set(this.className.split(/\s+/).filter(Boolean));
    return { contains: (className) => classes.has(className) };
  }

  get innerHTML(): string {
    return this.childNodes.map(serializeFakeNode).join("");
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  getAttributeNames(): string[] {
    return [...this.attributes.keys()];
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    if (selector.includes(":scope > thead > tr")) return tableRows(this);
    if (selector === ":scope > p") return this.children.filter((child) => child.tagName === "P");

    const selectors = selector.split(",").map((entry) => entry.trim());
    return descendantsOf(this).filter((element) =>
      selectors.some((entry) => matchesSimpleSelector(element, entry)),
    );
  }

  closest(selector: string): FakeElement | null {
    if (matchesSimpleSelector(this, selector)) return this;
    const parent = this.parentNode instanceof FakeElement ? this.parentNode : null;
    return parent?.closest(selector) ?? null;
  }

  cloneNode(deep = false): FakeElement {
    const clone = new FakeElement(this.localName, Object.fromEntries(this.attributes));
    if (deep) {
      for (const child of this.childNodes) clone.appendChild(child.cloneNode(true));
    }
    return clone;
  }
}

function styleDeclarationValue(style: string | undefined, property: string): string | undefined {
  const declaration = style
    ?.split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${property}:`));
  return declaration?.slice(property.length + 1).trim();
}

function descendantsOf(root: FakeElement): FakeElement[] {
  const descendants: FakeElement[] = [];
  for (const child of root.children) {
    descendants.push(child, ...descendantsOf(child));
  }
  return descendants;
}

function tableRows(table: FakeElement): FakeElement[] {
  const directRows = table.children.filter((child) => child.tagName === "TR");
  const sectionRows = table.children
    .filter((child) => child.tagName === "THEAD" || child.tagName === "TBODY")
    .flatMap((section) => section.children.filter((child) => child.tagName === "TR"));
  return [...sectionRows, ...directRows];
}

function matchesSimpleSelector(element: FakeElement, selector: string): boolean {
  if (selector === "*") return true;
  if (selector.startsWith(".")) return element.classList.contains(selector.slice(1));
  const attributeMatch = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
  if (attributeMatch) {
    const [, name = "", value] = attributeMatch;
    if (value === undefined) return element.hasAttribute(name);
    return element.getAttribute(name) === value;
  }
  const tagAttributeMatch = /^([a-z]+)\[([^=]+)="([^"]*)"\]$/i.exec(selector);
  if (tagAttributeMatch) {
    const [, tag = "", name = "", value = ""] = tagAttributeMatch;
    return element.tagName === tag.toUpperCase() && element.getAttribute(name) === value;
  }
  return element.tagName === selector.toUpperCase();
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function serializeFakeNode(node: FakeNode): string {
  if (node instanceof FakeText) return escapeHtml(node.textContent);
  if (!(node instanceof FakeElement)) return node.childNodes.map(serializeFakeNode).join("");
  const attributes = node
    .getAttributeNames()
    .map((name) => ` ${name}="${node.getAttribute(name) ?? ""}"`)
    .join("");
  return `<${node.localName}${attributes}>${node.childNodes.map(serializeFakeNode).join("")}</${node.localName}>`;
}

function text(value: string): FakeText {
  return new FakeText(value);
}

function element(
  tagName: string,
  attributes: Record<string, string>,
  ...children: FakeNode[]
): FakeElement {
  const node = new FakeElement(tagName, attributes);
  for (const child of children) node.appendChild(child);
  return node;
}

function selectionFrom(...children: FakeNode[]): Selection {
  const source = new FakeDocumentFragment();
  for (const child of children) source.appendChild(child);
  return {
    rangeCount: 1,
    getRangeAt: () => ({
      collapsed: false,
      cloneContents: () => source.cloneNode(true),
    }),
  } as unknown as Selection;
}

beforeEach(() => {
  vi.stubGlobal("Node", FakeNode);
  vi.stubGlobal("document", {
    createElement: (tagName: string) => new FakeElement(tagName),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streaming markdown clipboard", () => {
  it("unwraps transient motion while preserving exact Markdown and semantic rich HTML", () => {
    const selection = selectionFrom(
      element(
        "p",
        {},
        text("Hello "),
        element(
          "span",
          {
            class: "stream-text-word",
            "data-stream-word": "5",
            style: "--stream-duration: 125ms; --stream-delay: 10ms",
          },
          element(
            "span",
            {
              class: "stream-text-character",
              "data-stream-character": "5",
              style: "animation-delay: var(--stream-delay)",
            },
            text("w"),
          ),
          element(
            "span",
            {
              class: "stream-text-character",
              "data-stream-character": "6",
              style: "animation-delay: 4ms",
            },
            text("o"),
          ),
          text("rld"),
        ),
      ),
      element(
        "pre",
        { "data-language": "ts" },
        element(
          "code",
          { class: "language-ts" },
          element(
            "span",
            { class: "line", style: "color: #c678dd" },
            element(
              "span",
              {
                class: "stream-text-run",
                "data-stream-run": "code-1",
                "data-stream-generation": "3",
                style: "--stream-duration: 65ms",
              },
              text("const"),
            ),
            text(" x = 1;"),
          ),
        ),
      ),
      element(
        "table",
        {},
        element(
          "thead",
          {},
          element("tr", {}, element("th", {}, text("Item")), element("th", {}, text("Value"))),
        ),
        element(
          "tbody",
          {},
          element(
            "tr",
            {},
            element("td", {}, text("speed")),
            element(
              "td",
              {},
              element(
                "span",
                {
                  class: "stream-text-character",
                  "data-stream-character": "table-1",
                  style: "opacity: 0.08; transform: translate3d(0, 0.22em, 0)",
                },
                text("fast"),
              ),
            ),
          ),
        ),
      ),
    );

    const payload = chatMarkdownClipboardPayload(selection);

    expect(payload).toEqual({
      text: [
        "Hello world",
        "```ts\nconst x = 1;\n```",
        "| Item | Value |\n| --- | --- |\n| speed | fast |",
      ].join("\n\n"),
      html: [
        '<meta charset="utf-8"><p>Hello world</p>',
        '<pre data-language="ts"><code class="language-ts"><span class="line" style="color: #c678dd">const x = 1;</span></code></pre>',
        "<table><thead><tr><th>Item</th><th>Value</th></tr></thead><tbody><tr><td>speed</td><td>fast</td></tr></tbody></table>",
      ].join(""),
    });
    expect(payload?.html).not.toContain("data-stream-");
    expect(payload?.html).not.toContain("stream-text-");
    expect(payload?.html).not.toContain("--stream-");
    expect(payload?.html).not.toContain("animation-delay");
  });
});
