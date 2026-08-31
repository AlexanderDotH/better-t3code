import { describe, expect, it, vi } from "vite-plus/test";

import { resolveThreadSwipeSecondaryAction } from "./thread-swipe-action-model";

describe("thread swipe secondary action", () => {
  it("uses the supplied localized delete labels and closes before deleting", () => {
    const events: string[] = [];
    const action = resolveThreadSwipeSecondaryAction({
      close: () => events.push("close"),
      deleteIcon: "trash",
      onDelete: () => events.push("delete"),
      secondaryAction: undefined,
      deleteLabel: "Löschen",
      deleteAccessibilityLabel: "Thread Alpha löschen",
    });

    expect(action).toMatchObject({
      accessibilityLabel: "Thread Alpha löschen",
      backgroundColor: "#ff2d55",
      icon: "trash",
      label: "Löschen",
    });
    action?.onPress();
    expect(events).toEqual(["close", "delete"]);
  });

  it("keeps an explicit one-action row free of a destructive fallback", () => {
    expect(
      resolveThreadSwipeSecondaryAction({
        close: vi.fn(),
        deleteIcon: "trash",
        onDelete: vi.fn(),
        secondaryAction: null,
        deleteLabel: "Delete",
        deleteAccessibilityLabel: "Delete Thread Alpha",
      }),
    ).toBeNull();
  });

  it("closes before invoking a custom action or one of its menu actions", () => {
    const events: string[] = [];
    const action = resolveThreadSwipeSecondaryAction({
      close: () => events.push("close"),
      deleteIcon: "trash",
      onDelete: vi.fn(),
      secondaryAction: {
        accessibilityLabel: "Snooze Thread Alpha",
        icon: "clock",
        label: "Snooze",
        menu: {
          actions: [{ id: "tomorrow", title: "Tomorrow" }],
          onPressAction: () => events.push("menu"),
        },
        onPress: () => events.push("action"),
      },
      deleteLabel: "Delete",
      deleteAccessibilityLabel: "Delete Thread Alpha",
    });

    action?.onPress();
    action?.menu?.onPressAction({ nativeEvent: { event: "tomorrow" } });

    expect(events).toEqual(["close", "action", "close", "menu"]);
  });
});
