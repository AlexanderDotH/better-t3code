import type { MenuAction } from "@react-native-menu/menu";
import { describe, expect, it } from "vite-plus/test";

import {
  calculateAndroidAnchoredMenuPlacement,
  getAndroidMenuActionAccessibility,
  getAndroidMenuBackLabel,
  transitionAndroidMenu,
  visibleAndroidMenuActions,
} from "./androidAnchoredMenuModel";

const rootActions: readonly MenuAction[] = [
  {
    title: "Sort",
    subactions: [
      { id: "newest", title: "Newest", state: "on" },
      { id: "oldest", title: "Oldest", state: "off" },
      { id: "hidden", title: "Hidden option", attributes: { hidden: true } },
    ],
  },
  { id: "delete", title: "Delete", attributes: { destructive: true } },
];

describe("calculateAndroidAnchoredMenuPlacement", () => {
  it("keeps a right-side anchor menu inside the overlay margins", () => {
    const placement = calculateAndroidAnchoredMenuPlacement({
      anchor: { x: 300, y: 100, width: 40, height: 40 },
      overlay: { x: 10, y: 20, width: 360, height: 700 },
      keyboard: { visible: false, height: 0 },
    });

    expect(placement).toEqual({
      width: 250,
      left: 80,
      maxHeight: 480,
      vertical: { top: 126 },
    });
  });

  it("opens above the anchor when the keyboard covers the space below it", () => {
    const placement = calculateAndroidAnchoredMenuPlacement({
      anchor: { x: 260, y: 464, width: 80, height: 40 },
      overlay: { x: 0, y: 24, width: 400, height: 800 },
      keyboard: { visible: true, height: 300 },
    });

    expect(placement).toMatchObject({
      width: 250,
      maxHeight: 422,
      vertical: { bottom: 366 },
    });
  });

  it("shrinks the menu rather than overflowing a narrow split-screen window", () => {
    const placement = calculateAndroidAnchoredMenuPlacement({
      anchor: { x: 170, y: 80, width: 32, height: 32 },
      overlay: { x: 0, y: 0, width: 220, height: 500 },
      keyboard: { visible: false, height: 0 },
    });

    expect(placement.width).toBe(196);
    expect(placement.left).toBe(12);
  });
});

describe("Android anchored menu navigation", () => {
  it("drills into a submenu and excludes its hidden actions", () => {
    const transition = transitionAndroidMenu([], {
      type: "activate",
      action: rootActions[0]!,
    });

    expect(transition).toEqual({
      path: [rootActions[0]],
      shouldClose: false,
      selectedActionId: null,
    });
    expect(
      visibleAndroidMenuActions(rootActions, transition.path).map((action) => action.id),
    ).toEqual(["newest", "oldest"]);
  });

  it("steps back one submenu level before closing the root menu", () => {
    const parent = rootActions[0]!;
    const nested = { title: "Status", subactions: [{ id: "open", title: "Open" }] };
    const nestedPath = [parent, nested] satisfies readonly MenuAction[];

    expect(transitionAndroidMenu(nestedPath, { type: "back" })).toEqual({
      path: [parent],
      shouldClose: false,
      selectedActionId: null,
    });
    expect(transitionAndroidMenu([], { type: "back" })).toEqual({
      path: [],
      shouldClose: true,
      selectedActionId: null,
    });
  });

  it("closes with a leaf selection and ignores disabled actions", () => {
    expect(
      transitionAndroidMenu([rootActions[0]!], {
        type: "activate",
        action: rootActions[0]!.subactions![0]!,
      }),
    ).toEqual({
      path: [rootActions[0]],
      shouldClose: true,
      selectedActionId: "newest",
    });

    const disabled = { id: "disabled", title: "Disabled", attributes: { disabled: true } };
    expect(transitionAndroidMenu([], { type: "activate", action: disabled })).toEqual({
      path: [],
      shouldClose: false,
      selectedActionId: null,
    });
  });
});

describe("Android anchored menu accessibility", () => {
  it("exposes checked, disabled, and submenu state", () => {
    expect(getAndroidMenuActionAccessibility(rootActions[0]!.subactions![0]!)).toEqual({
      label: "Newest",
      hint: undefined,
      state: { checked: true, disabled: false, expanded: undefined },
    });
    expect(
      getAndroidMenuActionAccessibility({
        title: "Choose status",
        subtitle: "Filters the thread list",
        attributes: { disabled: true },
        subactions: [{ id: "open", title: "Open" }],
      }),
    ).toEqual({
      label: "Choose status, Filters the thread list",
      hint: "Opens submenu",
      state: { checked: undefined, disabled: true, expanded: false },
    });
  });

  it("labels submenu back actions with their actual destination", () => {
    const parent = rootActions[0]!;
    const nested = { title: "Status", subactions: [{ id: "open", title: "Open" }] };

    expect(getAndroidMenuBackLabel([parent], "Filters")).toBe("Back to Filters");
    expect(getAndroidMenuBackLabel([parent, nested], "Filters")).toBe("Back to Sort");
    expect(getAndroidMenuBackLabel([parent])).toBe("Back to menu");
  });
});
