import type { MenuAction } from "@react-native-menu/menu";

const MENU_WIDTH = 250;
const SCREEN_MARGIN = 12;
const ANCHOR_GAP = 6;
const MINIMUM_DOWNWARD_SPACE = 280;
const MAXIMUM_MENU_HEIGHT = 480;

type Frame = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type MenuPlacement = {
  readonly width: number;
  readonly left: number;
  readonly maxHeight: number;
  readonly vertical: { readonly top: number } | { readonly bottom: number };
};

type MenuTransition = {
  readonly path: readonly MenuAction[];
  readonly shouldClose: boolean;
  readonly selectedActionId: string | null;
};

export function calculateAndroidAnchoredMenuPlacement(props: {
  readonly anchor: Frame;
  readonly overlay: Frame;
  readonly keyboard: { readonly visible: boolean; readonly height: number };
}): MenuPlacement {
  const localAnchor = {
    x: props.anchor.x - props.overlay.x,
    y: props.anchor.y - props.overlay.y,
    width: props.anchor.width,
    height: props.anchor.height,
  };
  const sideMargin = Math.min(SCREEN_MARGIN, props.overlay.width / 2);
  const width = Math.max(0, Math.min(MENU_WIDTH, props.overlay.width - sideMargin * 2));
  const preferredLeft =
    localAnchor.x + localAnchor.width / 2 <= props.overlay.width / 2
      ? localAnchor.x
      : localAnchor.x + localAnchor.width - width;
  const maximumLeft = Math.max(sideMargin, props.overlay.width - width - sideMargin);
  const left = Math.min(Math.max(preferredLeft, sideMargin), maximumLeft);
  const keyboardHeight = props.keyboard.visible ? Math.max(props.keyboard.height, 0) : 0;
  const usableBottom = Math.max(props.overlay.height - keyboardHeight, 0);
  const spaceBelow = Math.max(
    usableBottom - (localAnchor.y + localAnchor.height) - ANCHOR_GAP - SCREEN_MARGIN,
    0,
  );
  const spaceAbove = Math.max(localAnchor.y - ANCHOR_GAP - SCREEN_MARGIN, 0);
  const opensDown = spaceBelow >= MINIMUM_DOWNWARD_SPACE || spaceBelow >= spaceAbove;
  const maxHeight = Math.min(opensDown ? spaceBelow : spaceAbove, MAXIMUM_MENU_HEIGHT);

  return {
    width,
    left,
    maxHeight,
    vertical: opensDown
      ? { top: localAnchor.y + localAnchor.height + ANCHOR_GAP }
      : { bottom: props.overlay.height - localAnchor.y + ANCHOR_GAP },
  };
}

export function visibleAndroidMenuActions(
  rootActions: readonly MenuAction[],
  path: readonly MenuAction[],
): readonly MenuAction[] {
  const parent = path.at(-1);
  return (parent?.subactions ?? rootActions).filter(
    (action) => !(action.attributes?.hidden ?? false),
  );
}

export function transitionAndroidMenu(
  path: readonly MenuAction[],
  event: { readonly type: "back" } | { readonly type: "activate"; readonly action: MenuAction },
): MenuTransition {
  if (event.type === "back") {
    if (path.length === 0) {
      return { path, shouldClose: true, selectedActionId: null };
    }
    return { path: path.slice(0, -1), shouldClose: false, selectedActionId: null };
  }

  if (event.action.attributes?.disabled ?? false) {
    return { path, shouldClose: false, selectedActionId: null };
  }
  if (visibleAndroidMenuActions(event.action.subactions ?? [], []).length > 0) {
    return { path: [...path, event.action], shouldClose: false, selectedActionId: null };
  }
  return {
    path,
    shouldClose: true,
    selectedActionId: event.action.id ?? null,
  };
}

export function getAndroidMenuActionAccessibility(
  action: MenuAction,
  openSubmenuHint = "Opens submenu",
): {
  readonly label: string;
  readonly hint: string | undefined;
  readonly state: {
    readonly checked: boolean | "mixed" | undefined;
    readonly disabled: boolean;
    readonly expanded: boolean | undefined;
  };
} {
  const hasSubmenu = visibleAndroidMenuActions(action.subactions ?? [], []).length > 0;
  const checked =
    action.state === "on"
      ? true
      : action.state === "off"
        ? false
        : action.state === "mixed"
          ? "mixed"
          : undefined;
  return {
    label: action.subtitle ? `${action.title}, ${action.subtitle}` : action.title,
    hint: hasSubmenu ? openSubmenuHint : undefined,
    state: {
      checked,
      disabled: action.attributes?.disabled ?? false,
      expanded: hasSubmenu ? false : undefined,
    },
  };
}

export function getAndroidMenuBackLabel(
  path: readonly MenuAction[],
  rootTitle?: string,
  format: (destination: string) => string = (destination) => `Back to ${destination}`,
): string {
  const destination = path.length > 1 ? path[path.length - 2]?.title : rootTitle;
  return format(destination ?? "menu");
}
