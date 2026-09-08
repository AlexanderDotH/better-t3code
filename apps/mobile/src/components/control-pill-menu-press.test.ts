import { describe, expect, it, vi } from "vite-plus/test";

import { createControlPillMenuPressController } from "./control-pill-menu-press";

describe("ControlPill native menu press controller", () => {
  it("invokes an ordinary touch exactly once", () => {
    const controller = createControlPillMenuPressController();
    const invoke = vi.fn();

    controller.onTouchStart();
    expect(controller.onPress({ isTouch: true, invoke, persist: vi.fn() })).toBe("invoked");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("suppresses a pending touch when the native menu actually opens", () => {
    const controller = createControlPillMenuPressController();
    const invoke = vi.fn();
    const persist = vi.fn();

    controller.onTouchStart();
    controller.onMenuInteractionStart();
    expect(controller.onPress({ isTouch: true, invoke, persist })).toBe("deferred");
    controller.onMenuOpen();
    controller.onMenuClose()?.();

    expect(persist).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("replays a deferred touch exactly once when menu preparation is cancelled", () => {
    const controller = createControlPillMenuPressController();
    const invoke = vi.fn();

    controller.onTouchStart();
    controller.onMenuInteractionStart();
    expect(controller.onPress({ isTouch: true, invoke, persist: vi.fn() })).toBe("deferred");
    controller.onMenuClose()?.();
    controller.onMenuClose()?.();

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("does not let physical suppression leak into a later accessibility click", () => {
    const controller = createControlPillMenuPressController();
    const physicalPress = vi.fn();
    const accessibilityPress = vi.fn();

    controller.onTouchStart();
    controller.onMenuInteractionStart();
    controller.onPress({ isTouch: true, invoke: physicalPress, persist: vi.fn() });
    controller.onMenuOpen();
    controller.onMenuClose()?.();

    expect(
      controller.onPress({ isTouch: false, invoke: accessibilityPress, persist: vi.fn() }),
    ).toBe("invoked");
    expect(physicalPress).not.toHaveBeenCalled();
    expect(accessibilityPress).toHaveBeenCalledTimes(1);
  });

  it("suppresses accessibility activation while the menu is open", () => {
    const controller = createControlPillMenuPressController();
    const invoke = vi.fn();

    controller.onTouchStart();
    controller.onMenuInteractionStart();
    controller.onMenuOpen();

    expect(controller.onPress({ isTouch: false, invoke, persist: vi.fn() })).toBe("suppressed");
    expect(invoke).not.toHaveBeenCalled();
  });
});
