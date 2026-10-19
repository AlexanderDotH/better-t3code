// @vitest-environment jsdom
import { act, createElement, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("react-native", () => ({
  View: (props: {
    children?: ReactNode;
    style?: { display?: string };
    accessibilityElementsHidden?: boolean;
  }) =>
    createElement(
      "div",
      {
        hidden: props.style?.display === "none",
        "aria-hidden": props.accessibilityElementsHidden || undefined,
      },
      props.children,
    ),
  Pressable: (props: {
    children?: ReactNode;
    accessibilityLabel?: string;
    accessibilityState?: { expanded?: boolean };
    onPress?: () => void;
  }) =>
    createElement(
      "button",
      {
        type: "button",
        "aria-label": props.accessibilityLabel,
        "aria-expanded": props.accessibilityState?.expanded,
        onClick: props.onPress,
      },
      props.children,
    ),
}));

vi.mock("../../../components/AppText", () => ({
  AppText: (props: { children?: ReactNode }) => createElement("span", {}, props.children),
}));
vi.mock("../../../components/AppSymbol", () => ({
  SymbolView: () => null,
}));

import { BetterT3SettingsSubgroup } from "./BetterT3SettingsSubgroup";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function press(title: string) {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${title}"]`);
  expect(button).not.toBeNull();
  act(() => button!.click());
}

describe("native Better T3 subgroups", () => {
  it("mounts details only on first open and retains an edited draft after collapse", () => {
    const mounted = vi.fn();
    function Details() {
      useEffect(() => mounted(), []);
      return <input aria-label="Draft" defaultValue="Original" />;
    }
    function Settings() {
      const [expanded, setExpanded] = useState(false);
      return (
        <BetterT3SettingsSubgroup
          title="Fetch"
          summary="On · Automatic"
          collapsible
          expanded={expanded}
          onExpandedChange={setExpanded}
        >
          <Details />
        </BetterT3SettingsSubgroup>
      );
    }
    act(() => root.render(<Settings />));
    expect(host.querySelector("input")).toBeNull();
    expect(mounted).not.toHaveBeenCalled();
    expect(host.textContent).toContain("On · Automatic");

    press("Fetch");
    const input = host.querySelector<HTMLInputElement>("input")!;
    expect(mounted).toHaveBeenCalledTimes(1);
    input.value = "Unsaved draft";

    press("Fetch");
    expect(host.querySelector("input")).toBe(input);
    expect(input.closest("[hidden]")).not.toBeNull();
    expect(input.closest('[aria-hidden="true"]')).not.toBeNull();

    press("Fetch");
    expect(input.closest("[hidden]")).toBeNull();
    expect(input.value).toBe("Unsaved draft");
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it("keeps multiple groups open independently and reflects current summaries", () => {
    function Settings(props: { summary: string }) {
      const [fetchExpanded, setFetchExpanded] = useState(false);
      const [planningExpanded, setPlanningExpanded] = useState(false);
      return (
        <>
          <BetterT3SettingsSubgroup
            title="Fetch"
            summary={props.summary}
            collapsible
            expanded={fetchExpanded}
            onExpandedChange={setFetchExpanded}
          >
            <input aria-label="Fetch model" />
          </BetterT3SettingsSubgroup>
          <BetterT3SettingsSubgroup
            title="Planning"
            collapsible
            expanded={planningExpanded}
            onExpandedChange={setPlanningExpanded}
          >
            <input aria-label="Reviewer" />
          </BetterT3SettingsSubgroup>
        </>
      );
    }
    act(() => root.render(<Settings summary="On · Automatic" />));
    press("Fetch");
    press("Planning");
    expect(host.querySelectorAll('button[aria-expanded="true"]')).toHaveLength(2);
    act(() => root.render(<Settings summary="Off · Luna" />));
    expect(host.textContent).toContain("Off · Luna");
    expect(host.querySelectorAll('button[aria-expanded="true"]')).toHaveLength(2);
    press("Fetch");
    expect(
      host.querySelector('input[aria-label="Fetch model"]')?.closest("[hidden]"),
    ).not.toBeNull();
    expect(host.querySelector('input[aria-label="Reviewer"]')?.closest("[hidden]")).toBeNull();
  });

  it("renders a simple group directly without an extra disclosure control", () => {
    act(() =>
      root.render(
        <BetterT3SettingsSubgroup title="Language" showTitle={false}>
          <input aria-label="Language" />
        </BetterT3SettingsSubgroup>,
      ),
    );
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector('input[aria-label="Language"]')?.closest("[hidden]")).toBeNull();
  });
});
