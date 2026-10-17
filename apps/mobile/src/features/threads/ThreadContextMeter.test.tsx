import { deriveLatestContextWindowSnapshot } from "@t3tools/client-runtime/context-window";
import { EventId } from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({
  states: [] as unknown[],
  cursor: 0,
  platform: "ios",
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  memo: (component: unknown) => component,
  useState: (initial: unknown) => {
    const index = fixture.cursor++;
    if (!(index in fixture.states)) {
      fixture.states[index] = typeof initial === "function" ? initial() : initial;
    }
    return [
      fixture.states[index],
      (next: unknown) => {
        fixture.states[index] = typeof next === "function" ? next(fixture.states[index]) : next;
      },
    ];
  },
}));
vi.mock("react-native", () => ({
  Modal: "modal",
  Platform: {
    get OS() {
      return fixture.platform;
    },
  },
  Pressable: "pressable",
  ScrollView: "scroll-view",
  View: "view",
  useWindowDimensions: () => ({ height: 800, width: 390 }),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));
vi.mock("react-native-svg", () => ({ default: "svg", Circle: "circle", Text: "svg-text" }));
vi.mock("uniwind", () => ({ withUniwind: (component: unknown) => component }));
vi.mock("../../components/AppText", () => ({ AppText: "text" }));
vi.mock("../../components/ContextSheetSize", () => ({ ContextSheetSize: () => null }));
vi.mock("../../localization/useMobileInterfaceTranslator", () => ({
  useMobileInterfaceTranslator: () =>
    createInterfaceTranslator({ language: "en", locale: "en-US" }),
}));

import { ThreadContextMeter } from "./ThreadContextMeter";

type NativeProps = {
  children?: ReactNode;
  accessibilityLabel?: string;
  onPress?: () => void;
  onRequestClose?: () => void;
  onDismiss?: () => void;
};

function expand(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(expand);
  if (!isValidElement<NativeProps>(node)) return node;
  if (typeof node.type === "function") {
    const Component = node.type as (props: NativeProps) => ReactNode;
    return expand(Component(node.props));
  }
  return cloneElement(node, {}, expand(node.props.children));
}

function hosts(node: ReactNode, type: string): ReactElement<NativeProps>[] {
  if (Array.isArray(node)) return node.flatMap((child) => hosts(child, type));
  if (!isValidElement<NativeProps>(node)) return [];
  return [...(node.type === type ? [node] : []), ...hosts(node.props.children, type)];
}

function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  return isValidElement<NativeProps>(node) ? text(node.props.children) : "";
}

function usage(usedTokens: number) {
  const snapshot = deriveLatestContextWindowSnapshot([
    {
      id: EventId.make("context-usage"),
      kind: "context-window.updated",
      tone: "info",
      summary: "Context usage",
      payload: { usedTokens, maxTokens: 100_000 },
      turnId: null,
      createdAt: "2026-10-15T12:00:00.000Z",
    },
  ]);
  if (snapshot === null) throw new Error("Expected context usage");
  return snapshot;
}

function render(usedTokens = 25_000) {
  fixture.cursor = 0;
  return expand(ThreadContextMeter({ snapshot: usage(usedTokens) }));
}

function openDetails(usedTokens = 25_000) {
  const meter = hosts(render(usedTokens), "pressable")[0];
  if (!meter?.props.onPress) throw new Error("Expected the context meter");
  meter.props.onPress();
  return render(usedTokens);
}

beforeEach(() => {
  fixture.states = [];
  fixture.cursor = 0;
  fixture.platform = "ios";
});

describe("mobile context meter interaction", () => {
  it("opens token details on tap and dismisses them with Done", () => {
    expect(hosts(render(), "modal")).toHaveLength(0);
    const details = openDetails();
    expect(hosts(details, "modal")).toHaveLength(1);
    expect(text(details)).toContain("Used tokens 25,000");
    expect(text(details)).toContain("Limit 100,000");
    expect(text(details)).toContain("Percentage used 25%");
    const done = hosts(details, "pressable").find((button) => text(button) === "Done");
    if (!done?.props.onPress) throw new Error("Expected Done");
    done.props.onPress();
    expect(hosts(render(), "modal")).toHaveLength(0);
  });

  it.each(["onRequestClose", "onDismiss"] as const)(
    "clears detail state after the native %s event",
    (event) => {
      const modal = hosts(openDetails(), "modal")[0];
      if (!modal?.props[event]) throw new Error("Expected native dismissal");
      modal.props[event]();
      expect(hosts(render(), "modal")).toHaveLength(0);
      expect(hosts(openDetails(), "modal")).toHaveLength(1);
    },
  );

  it("dismisses the Android sheet through its backdrop", () => {
    fixture.platform = "android";
    const details = openDetails();
    const backdrop = hosts(details, "pressable").find(
      (button) => button.props.accessibilityLabel === "Close",
    );
    if (!backdrop?.props.onPress) throw new Error("Expected the Android backdrop");
    backdrop.props.onPress();
    expect(hosts(render(), "modal")).toHaveLength(0);
  });

  it("updates open details when the selected thread receives a newer sample", () => {
    openDetails();
    const details = render(75_000);
    expect(hosts(details, "modal")).toHaveLength(1);
    expect(text(details)).toContain("Used tokens 75,000");
    expect(text(details)).toContain("Percentage used 75%");
    expect(text(details)).not.toContain("25,000");
  });
});
