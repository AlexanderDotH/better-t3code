import { MenuView } from "@react-native-menu/menu";
import {
  cloneElement,
  isValidElement,
  useMemo,
  useRef,
  type ComponentProps,
  type ReactElement,
} from "react";
import type { ColorValue, PressableProps } from "react-native";
import { withUniwind } from "uniwind";
import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";
import { withMenuActionIconColors } from "../lib/menu-action-colors";
import { createControlPillMenuPressController } from "./control-pill-menu-press";
import type { ControlPillMenuProps } from "./ControlPillMenu.types";

const ThemedMenuView = withUniwind(
  function NativeMenuView({
    iconColor,
    destructiveIconColor,
    ...props
  }: ComponentProps<typeof MenuView> & {
    readonly iconColor?: ColorValue;
    readonly destructiveIconColor?: ColorValue;
  }) {
    const actions = useMemo(
      () =>
        withMenuActionIconColors(props.actions, {
          icon: iconColor,
          destructiveIcon: destructiveIconColor,
        }),
      [props.actions, iconColor, destructiveIconColor],
    );
    return <MenuView {...props} actions={actions} />;
  },
  {
    iconColor: { fromClassName: "iconColorClassName", styleProperty: "accentColor" },
    destructiveIconColor: {
      fromClassName: "destructiveIconColorClassName",
      styleProperty: "accentColor",
    },
  },
);

export function ControlPillMenu(props: ControlPillMenuProps) {
  const { themeAppearance } = useAppearancePreferences();
  const isDarkMode = themeAppearance === "dark";
  const menuPress = useRef(createControlPillMenuPressController());

  const { className: _className, ...menuProps } = props;
  let children = menuProps.children;
  if (props.shouldOpenOnLongPress && isValidElement(children)) {
    const child = children as ReactElement<Pick<PressableProps, "onTouchStart" | "onPress">>;
    children = cloneElement(child, {
      onTouchStart: (event) => {
        // Reset for a new touch, not onPressIn, which also fires when a
        // finger moves out of the row and back during the same gesture.
        menuPress.current.onTouchStart();
        child.props.onTouchStart?.(event);
      },
      onPress: (event) => {
        // Accessibility clicks have no touch identifier and must not inherit
        // cancellation from a previous physical gesture.
        const isTouch = typeof event.nativeEvent.identifier === "number";
        menuPress.current.onPress({
          isTouch,
          invoke: () => child.props.onPress?.(event),
          persist: () => event.persist(),
        });
      },
    });
    menuProps.onMenuInteractionStart = () => {
      menuPress.current.onMenuInteractionStart();
      props.onMenuInteractionStart?.();
    };
    menuProps.onOpenMenu = () => {
      menuPress.current.onMenuOpen();
      props.onOpenMenu?.();
    };
    menuProps.onCloseMenu = () => {
      // Keep this gesture cancelled even if dismissal precedes finger-up.
      // A separate JS long-press timer would also swallow holds that never
      // open the native menu.
      const pendingPress = menuPress.current.onMenuClose();
      props.onCloseMenu?.();
      pendingPress?.();
    };
  }
  return (
    <ThemedMenuView
      {...menuProps}
      iconColorClassName="accent-icon"
      destructiveIconColorClassName="accent-danger-foreground"
      themeVariant={isDarkMode ? "dark" : "light"}
    >
      {children}
    </ThemedMenuView>
  );
}
