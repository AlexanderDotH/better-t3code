import * as Haptics from "expo-haptics";
import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Pressable } from "react-native";
import { useMobileInterfaceTranslator } from "../localization/useMobileInterfaceTranslator";
import { AndroidAnchoredMenu } from "./AndroidAnchoredMenu";
import type { ControlPillMenuProps } from "./ControlPillMenu.types";

type AndroidLongPressMenuChildProps = {
  readonly accessibilityActions?: ComponentProps<typeof Pressable>["accessibilityActions"];
  readonly accessibilityHint?: string;
  readonly accessibilityState?: ComponentProps<typeof Pressable>["accessibilityState"];
  readonly onAccessibilityAction?: ComponentProps<typeof Pressable>["onAccessibilityAction"];
  readonly onLongPress?: () => void;
};

type MenuAnchorChildProps = {
  readonly accessibilityLabel?: string;
  readonly label?: string;
};

function getMenuAnchorAccessibilityLabel(
  children: ReactNode,
  menuTitle: string | undefined,
  fallback: string,
): string {
  if (!isValidElement(children)) {
    return menuTitle ?? fallback;
  }
  const child = children as ReactElement<MenuAnchorChildProps>;
  return child.props.accessibilityLabel ?? child.props.label ?? menuTitle ?? fallback;
}

/** Uses the same actions as iOS menus, with Android appearance and editor anchoring. */
export function ControlPillMenu(props: ControlPillMenuProps) {
  const translator = useMobileInterfaceTranslator();
  // Long-press menus keep their child interactive: the child element gets
  // an injected onLongPress (mirroring the iOS context-menu interaction)
  // so its own tap handling still works.
  if (props.shouldOpenOnLongPress && isValidElement(props.children)) {
    const child = props.children as ReactElement<AndroidLongPressMenuChildProps>;
    return (
      <AndroidAnchoredMenu
        actions={props.actions}
        className={props.className}
        title={props.title}
        style={props.style}
        onPressAction={props.onPressAction}
      >
        {(open, expanded) => {
          const existingActions = child.props.accessibilityActions ?? [];
          const accessibilityActions = existingActions.some((action) => action.name === "longpress")
            ? existingActions
            : [
                ...existingActions,
                {
                  name: "longpress",
                  label: translator.message("mobile.accessibility.openMenu"),
                },
              ];
          const openWithFeedback = () => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            open();
          };
          return cloneElement(child, {
            accessibilityActions,
            accessibilityHint:
              child.props.accessibilityHint ??
              translator.message("mobile.accessibility.longPressMenu"),
            accessibilityState: { ...child.props.accessibilityState, expanded },
            onAccessibilityAction: (event) => {
              child.props.onAccessibilityAction?.(event);
              if (event.nativeEvent.actionName === "longpress") {
                openWithFeedback();
              }
            },
            onLongPress: openWithFeedback,
          });
        }}
      </AndroidAnchoredMenu>
    );
  }
  return (
    <AndroidAnchoredMenu
      actions={props.actions}
      anchorAccessibilityLabel={getMenuAnchorAccessibilityLabel(
        props.children,
        props.title,
        translator.message("mobile.accessibility.openMenu"),
      )}
      className={props.className}
      title={props.title}
      style={props.style}
      onPressAction={props.onPressAction}
    >
      {props.children}
    </AndroidAnchoredMenu>
  );
}
