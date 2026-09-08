export type ControlPillMenuPressOutcome = "deferred" | "invoked" | "suppressed";

export interface ControlPillMenuPressInput {
  readonly isTouch: boolean;
  readonly invoke: () => void;
  readonly persist: () => void;
}

export function createControlPillMenuPressController() {
  let isPreparing = false;
  let isOpen = false;
  let suppressTouch = false;
  let pendingTouch: (() => void) | null = null;

  return {
    onTouchStart(): void {
      isPreparing = false;
      suppressTouch = isOpen;
      pendingTouch = null;
    },
    onPress(input: ControlPillMenuPressInput): ControlPillMenuPressOutcome {
      if (input.isTouch ? suppressTouch : isOpen) {
        return "suppressed";
      }
      if (input.isTouch && isPreparing) {
        input.persist();
        pendingTouch = input.invoke;
        return "deferred";
      }
      input.invoke();
      return "invoked";
    },
    onMenuInteractionStart(): void {
      isPreparing = true;
    },
    onMenuOpen(): void {
      isPreparing = false;
      isOpen = true;
      suppressTouch = true;
      pendingTouch = null;
    },
    onMenuClose(): (() => void) | null {
      isPreparing = false;
      isOpen = false;
      const invoke = pendingTouch;
      pendingTouch = null;
      return suppressTouch ? null : invoke;
    },
  };
}
