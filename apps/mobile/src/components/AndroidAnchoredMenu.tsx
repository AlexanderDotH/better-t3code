import type { MenuAction, MenuComponentProps } from "@react-native-menu/menu";
import { BlurView } from "expo-blur";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import {
  AccessibilityInfo,
  BackHandler,
  findNodeHandle,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import Animated, { FadeIn } from "react-native-reanimated";

import { appBlurTargetRef } from "../lib/appBlurTarget";
import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";
import { cn } from "../lib/cn";
import { type AppSymbolName, SymbolView } from "./AppSymbol";
import { AppText as Text } from "./AppText";
import {
  calculateAndroidAnchoredMenuPlacement,
  getAndroidMenuActionAccessibility,
  getAndroidMenuBackLabel,
  transitionAndroidMenu,
  visibleAndroidMenuActions,
} from "./androidAnchoredMenuModel";
import { OverlayPortal } from "./OverlayPortal";
import { useMobileInterfaceTranslator } from "../localization/useMobileInterfaceTranslator";

// Anchor position is snapshotted in window coordinates when the menu opens;
// the overlay root measures itself the same way, and the menu is placed from
// the delta. Both snapshots are taken at open time so later reflows (keyboard
// show/hide, screen transitions) can't flip an opens-up menu to opens-down
// mid-presentation.
type AnchorSnapshot = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type OverlayFrame = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type AndroidAnchoredMenuProps = {
  readonly actions: readonly MenuAction[];
  readonly title?: string;
  readonly onPressAction?: MenuComponentProps["onPressAction"];
  readonly anchorAccessibilityLabel?: string;
  /** Applied to the anchor wrapper — call sites flex these to fill toolbars. */
  readonly className?: string;
  readonly style?: StyleProp<ViewStyle>;
  /**
   * Plain children open the menu on tap (the wrapper owns the press). A
   * render function keeps the children interactive and hands them `open` to
   * call from their own gesture — e.g. a row that selects on tap and opens
   * this menu on long-press.
   */
  readonly children: ReactNode | ((open: () => void, expanded: boolean) => ReactNode);
};

/**
 * Token-styled anchored dropdown for Android, drop-in for the subset of the
 * MenuView contract the app uses (actions with state/subtitle/image/
 * attributes, one level of subactions). The native AppCompat PopupMenu caps
 * out on theming — stock animation, item metrics, and submenu chrome — so
 * ControlPillMenu renders this instead on Android while iOS keeps the native
 * UIMenu. Styling follows the themed native popup (12dp radius, plain rows,
 * trailing check glyph); submenus drill in under a muted parent-title header.
 */
export function AndroidAnchoredMenu(props: AndroidAnchoredMenuProps) {
  const translator = useMobileInterfaceTranslator();
  const [anchor, setAnchor] = useState<AnchorSnapshot | null>(null);
  const [path, setPath] = useState<readonly MenuAction[]>([]);
  // Window frame of the overlay root, measured on layout. Anchor coordinates
  // are converted into this frame, so the menu lands correctly no matter
  // where the portal host sits (status bar, keyboard resize, etc.).
  const [overlay, setOverlay] = useState<OverlayFrame | null>(null);
  const anchorRef = useRef<View>(null);
  const overlayRef = useRef<View>(null);
  const firstActionRef = useRef<View>(null);
  const submenuBackRef = useRef<View>(null);

  const { themeAppearance } = useAppearancePreferences();
  const isDarkMode = themeAppearance === "dark";
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const keyboardHeight = useKeyboardState((state) => state.height);
  const close = useCallback(() => {
    setAnchor(null);
    setPath([]);
    setOverlay(null);
  }, []);

  const open = useCallback(() => {
    anchorRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
    });
  }, []);

  const measureOverlay = useCallback(() => {
    overlayRef.current?.measureInWindow((x, y, width, height) => {
      setOverlay({ x, y, width, height });
    });
  }, []);

  // The dropdown renders in-window (no Modal takes focus), so the hardware
  // back gesture needs explicit handling while it is open. Back steps out of
  // a drilled-in submenu one level at a time (mirroring the tappable parent
  // header) before closing the menu. Under predictive back
  // (enableOnBackInvokedCallback) this stays correct: back reaches JS
  // through always-registered OnBackPressedDispatcher callbacks (react-native
  // core on Android 16+, withAndroidPredictiveBackCompat on 13-15), which
  // also keeps the system from playing a "leave app" preview while the menu
  // merely closes.
  const goBack = useCallback(() => {
    const transition = transitionAndroidMenu(path, { type: "back" });
    if (transition.shouldClose) {
      close();
      return;
    }
    setPath(transition.path);
  }, [close, path]);

  useEffect(() => {
    if (anchor === null) {
      return;
    }
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      goBack();
      return true;
    });
    return () => subscription.remove();
  }, [anchor, goBack]);

  const parent = path.at(-1) ?? null;
  const levelActions = visibleAndroidMenuActions(props.actions, path);
  const placement =
    anchor === null || overlay === null
      ? null
      : calculateAndroidAnchoredMenuPlacement({
          anchor,
          overlay,
          keyboard: { visible: keyboardVisible, height: keyboardHeight },
        });
  const menuIsPlaced = placement !== null;
  const submenuDepth = path.length;

  useEffect(() => {
    if (!menuIsPlaced) {
      return;
    }
    let active = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((screenReaderEnabled) => {
      if (!active || !screenReaderEnabled) {
        return;
      }
      const focusTarget = submenuDepth > 0 ? submenuBackRef.current : firstActionRef.current;
      const reactTag = findNodeHandle(focusTarget);
      if (reactTag !== null) {
        AccessibilityInfo.setAccessibilityFocus(reactTag);
      }
    });
    return () => {
      active = false;
    };
  }, [menuIsPlaced, submenuDepth]);

  const onPressItem = useCallback(
    (action: MenuAction) => {
      const transition = transitionAndroidMenu(path, { type: "activate", action });
      if (!transition.shouldClose) {
        setPath(transition.path);
        return;
      }
      close();
      if (transition.selectedActionId !== null) {
        props.onPressAction?.({
          nativeEvent: { event: transition.selectedActionId },
        } as Parameters<NonNullable<MenuComponentProps["onPressAction"]>>[0]);
      }
    },
    [close, path, props.onPressAction],
  );

  return (
    <>
      {typeof props.children === "function" ? (
        <View ref={anchorRef} collapsable={false} className={props.className} style={props.style}>
          {props.children(open, anchor !== null)}
        </View>
      ) : (
        <Pressable
          ref={anchorRef}
          accessibilityHint={translator.message("mobile.accessibility.showActions")}
          accessibilityLabel={
            props.anchorAccessibilityLabel ??
            props.title ??
            translator.message("mobile.accessibility.openMenu")
          }
          accessibilityRole="button"
          accessibilityState={{ expanded: anchor !== null }}
          className={props.className}
          collapsable={false}
          style={props.style}
          onPress={open}
        >
          <View pointerEvents="none" importantForAccessibility="no-hide-descendants">
            {props.children}
          </View>
        </Pressable>
      )}
      {anchor === null ? null : (
        <OverlayPortal>
          <View
            ref={overlayRef}
            collapsable={false}
            className="absolute inset-0"
            onLayout={measureOverlay}
          >
            <Pressable accessible={false} className="absolute inset-0" onPress={close} />
            {placement === null ? null : (
              <Animated.View
                entering={FadeIn.duration(120)}
                accessibilityViewIsModal
                importantForAccessibility="yes"
                onAccessibilityEscape={goBack}
                className="absolute overflow-hidden rounded-[12px] border border-border shadow-2xl"
                style={{
                  left: placement.left,
                  width: placement.width,
                  maxHeight: placement.maxHeight,
                  ...placement.vertical,
                }}
              >
                {/* Frosted backdrop: blur of the app content behind the menu,
                  washed with the translucent card tone so rows keep contrast. */}
                <BlurView
                  blurMethod="dimezisBlurView"
                  blurTarget={appBlurTargetRef}
                  intensity={40}
                  tint={isDarkMode ? "dark" : "light"}
                  className="absolute inset-0"
                />
                <View className="absolute inset-0 bg-card-translucent" />
                {/* keyboardShouldPersistTaps: the menu often opens over an
                  active editor; the first item tap must act, not just
                  dismiss the keyboard. */}
                <ScrollView
                  bounces={false}
                  keyboardShouldPersistTaps="always"
                  showsVerticalScrollIndicator={false}
                >
                  {parent !== null ? (
                    <Pressable
                      ref={submenuBackRef}
                      accessibilityHint={translator.message("mobile.accessibility.closeSubmenu", {
                        title: parent.title,
                      })}
                      accessibilityLabel={getAndroidMenuBackLabel(
                        path,
                        props.title,
                        (destination) =>
                          translator.message("mobile.accessibility.backTo", { destination }),
                      )}
                      accessibilityRole="button"
                      className="flex-row items-center gap-1 px-3.5 pb-1 pt-2.5"
                      onPress={goBack}
                    >
                      <SymbolView
                        name="chevron.left"
                        size={11}
                        tintColorClassName={"accent-icon-subtle"}
                        type="monochrome"
                      />
                      <Text className="text-xs font-t3-bold text-foreground-muted">
                        {parent.title}
                      </Text>
                    </Pressable>
                  ) : props.title ? (
                    <>
                      <View className="px-3.5 py-2">
                        <Text
                          accessibilityRole="header"
                          className="text-center text-xs text-foreground-muted"
                        >
                          {props.title}
                        </Text>
                      </View>
                      <View className="h-px bg-border" />
                    </>
                  ) : null}
                  {levelActions.map((action, index) => {
                    const destructive = action.attributes?.destructive ?? false;
                    const disabled = action.attributes?.disabled ?? false;
                    const accessibility = getAndroidMenuActionAccessibility(
                      action,
                      translator.message("mobile.accessibility.openSubmenu"),
                    );
                    const hasSubmenu = accessibility.state.expanded !== undefined;
                    return (
                      <Pressable
                        ref={index === 0 ? firstActionRef : undefined}
                        key={action.id ?? `${index}-${action.title}`}
                        accessibilityHint={accessibility.hint}
                        accessibilityLabel={accessibility.label}
                        accessibilityRole="menuitem"
                        accessibilityState={accessibility.state}
                        disabled={disabled}
                        className={cn(
                          "min-h-11 flex-row items-center gap-2.5 px-3.5 py-2.5 active:bg-subtle",
                          disabled && "opacity-45",
                        )}
                        onPress={() => onPressItem(action)}
                      >
                        <View className="flex-1 gap-0.5">
                          <Text
                            className={cn(
                              // Same face as the pill labels that open these menus.
                              "text-sm font-t3-bold",
                              destructive && "text-danger-foreground",
                            )}
                          >
                            {action.title}
                          </Text>
                          {action.subtitle ? (
                            <Text className="text-xs leading-snug text-foreground-muted">
                              {action.subtitle}
                            </Text>
                          ) : null}
                        </View>
                        {hasSubmenu ? (
                          <SymbolView
                            name="chevron.right"
                            size={13}
                            tintColorClassName={"accent-icon-subtle"}
                            type="monochrome"
                          />
                        ) : action.state === "on" ? (
                          <SymbolView
                            name="checkmark"
                            size={15}
                            tintColorClassName={"accent-icon"}
                            type="monochrome"
                          />
                        ) : action.image ? (
                          <SymbolView
                            name={action.image as AppSymbolName}
                            size={15}
                            tintColorClassName={
                              destructive ? "accent-danger-foreground" : "accent-icon"
                            }
                            type="monochrome"
                          />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </Animated.View>
            )}
          </View>
        </OverlayPortal>
      )}
    </>
  );
}
