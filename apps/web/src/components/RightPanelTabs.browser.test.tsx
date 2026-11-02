import { describe, expect, it } from "vite-plus/test";
import { surfaceShortcutHasBlockingLayer } from "./RightPanelTabs";

describe("surface shortcut overlays", () => {
  const popupSlots = [
    "dialog-popup",
    "alert-dialog-popup",
    "command-dialog-popup",
    "menu-popup",
    "select-popup",
    "popover-popup",
    "combobox-popup",
    "autocomplete-popup",
  ];

  it.each(popupSlots)(
    "ignores a mounted closed %s, but respects it while open or closing",
    (slot) => {
      const popup = document.createElement("div");
      using _popup = { [Symbol.dispose]: () => popup.remove() };
      {
        popup.setAttribute("data-slot", slot);
        document.body.append(popup);
        expect(surfaceShortcutHasBlockingLayer(document)).toBe(false);
        popup.setAttribute("data-open", "");
        expect(surfaceShortcutHasBlockingLayer(document)).toBe(true);
        popup.removeAttribute("data-open");
        popup.setAttribute("data-ending-style", "");
        expect(surfaceShortcutHasBlockingLayer(document)).toBe(true);
        popup.removeAttribute("data-ending-style");
        expect(surfaceShortcutHasBlockingLayer(document)).toBe(false);
      }
    },
  );
});
