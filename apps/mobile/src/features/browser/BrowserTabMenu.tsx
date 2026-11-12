import * as Dialog from "../../components/ui/Dialog";
import { useAtomValue } from "@effect/atom-react";
import type { MenuAction } from "@react-native-menu/menu";
import {
  DEFAULT_PREVIEW_ZOOM_FACTOR,
  type EnvironmentId,
  FILL_PREVIEW_VIEWPORT,
  PREVIEW_ZOOM_LEVELS,
  type PreviewAdjustInput,
  type PreviewSessionSnapshot,
  PreviewViewportSetting,
} from "@t3tools/contracts";
import { PREVIEW_VIEWPORT_PRESETS } from "@t3tools/shared/previewViewport";

import { ControlPill } from "../../components/ui/ControlPill";
import { Menu } from "../../components/ui/Menu";
import { previewEnvironment } from "../../state/preview";
import { useAtomCommand } from "../../state/use-atom-command";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { currentInterfaceTranslator } from "../../localization/currentInterfaceTranslator";
import { useState } from "react";
import { Schema } from "effect";
import { View } from "react-native";
import { AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ThreadPanelSheet } from "../threads/ThreadPanelSheet";

const APPEARANCES = [
  {
    id: "system",
    get title() {
      return currentInterfaceTranslator().message("mobile.appearance.system");
    },
  },
  {
    id: "light",
    get title() {
      return currentInterfaceTranslator().message("mobile.appearance.light");
    },
  },
  {
    id: "dark",
    get title() {
      return currentInterfaceTranslator().message("mobile.appearance.dark");
    },
  },
] as const;

const VIEWPORTS = [
  {
    id: "fill",
    get title() {
      return currentInterfaceTranslator().message("mobile.ui.fitToScreen");
    },
    setting: FILL_PREVIEW_VIEWPORT,
  },
  ...PREVIEW_VIEWPORT_PRESETS.map((preset) => {
    const setting: PreviewViewportSetting = {
      _tag: "preset",
      presetId: preset.id,
      width: preset.width,
      height: preset.height,
    };
    return { id: `preset:${preset.id}`, title: `${preset.label} (${preset.detail})`, setting };
  }),
  ...(
    [
      ["1920 × 1080", 1920, 1080],
      ["1440 × 900", 1440, 900],
      ["1280 × 800", 1280, 800],
    ] as const
  ).map(([title, width, height]) => ({
    id: `desktop:${width}`,
    title,
    setting: { _tag: "freeform", width, height } as const,
  })),
];

const isViewportSetting = Schema.is(PreviewViewportSetting);

export function BrowserTabMenu({
  environmentId,
  tab,
  streaming,
  onPaste,
  recording = false,
  onCapture,
  onAnnotate,
  onPickElement,
  onRecording,
}: {
  readonly environmentId: EnvironmentId;
  readonly tab: PreviewSessionSnapshot;
  readonly streaming: boolean;
  readonly onPaste?: () => void;
  readonly recording?: boolean;
  readonly onCapture?: () => void;
  readonly onAnnotate?: () => void;
  readonly onPickElement?: (() => void) | undefined;
  readonly onRecording?: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const [customOpen, setCustomOpen] = useState(false);
  const [width, setWidth] = useState("1280");
  const [height, setHeight] = useState("800");
  const customViewport = {
    _tag: "freeform",
    width: Number(width),
    height: Number(height),
  } as const;
  const customValid = isViewportSetting(customViewport);
  const adjust = useAtomCommand(previewEnvironment.adjust, "browser tab change");
  const resize = useAtomCommand(previewEnvironment.resize, "browser viewport change");
  const close = useAtomCommand(previewEnvironment.close, "browser tab close");
  const canClose = useAtomValue(previewEnvironment.close.permissionAtom(environmentId));
  const canResize = useAtomValue(previewEnvironment.resize.permissionAtom(environmentId));
  const canAdjust = useAtomValue(previewEnvironment.adjust.permissionAtom(environmentId));
  const target = { threadId: tab.threadId as PreviewAdjustInput["threadId"], tabId: tab.tabId };
  const colorScheme = tab.colorScheme ?? "system";
  const zoomFactor = tab.zoomFactor ?? DEFAULT_PREVIEW_ZOOM_FACTOR;
  const zoomIndex = PREVIEW_ZOOM_LEVELS.indexOf(zoomFactor);
  const zoomTo = (step: -1 | 1) =>
    PREVIEW_ZOOM_LEVELS[
      Math.min(Math.max((zoomIndex < 0 ? 7 : zoomIndex) + step, 0), PREVIEW_ZOOM_LEVELS.length - 1)
    ]!;
  const viewportId =
    tab.viewport === undefined || tab.viewport._tag === "fill"
      ? "fill"
      : tab.viewport._tag === "preset"
        ? `preset:${tab.viewport.presetId}`
        : "custom";

  const closeAction: MenuAction = {
    id: "close",
    title: translator.message("mobile.ui.closeTab"),
    image: "xmark",
    attributes: { destructive: true, disabled: !canClose || recording },
  };
  const actions: MenuAction[] = [
    ...(onPickElement
      ? [
          {
            id: "pick-element",
            title: translator.message("mobile.panels.pickElement"),
            image: "cursorarrow.rays",
          },
        ]
      : []),
    ...(onCapture
      ? [{ id: "capture", title: translator.message("mobile.panels.capture"), image: "camera" }]
      : []),
    ...(onAnnotate
      ? [{ id: "annotate", title: translator.message("mobile.panels.annotate"), image: "pencil" }]
      : []),
    ...(onRecording
      ? [
          {
            id: "record",
            title: translator.message(
              recording ? "mobile.panels.stopRecording" : "mobile.panels.record",
            ),
            image: recording ? "stop.circle" : "record.circle",
          },
        ]
      : []),
    ...(onPaste
      ? [
          {
            id: "paste",
            title: translator.message("chat.terminal.paste"),
            image: "doc.on.clipboard",
          },
        ]
      : []),
    {
      id: "hard-reload",
      title: translator.message("browser.menu.hardReload"),
      image: "arrow.clockwise.circle",
      attributes: { disabled: !canAdjust },
    },
    {
      id: "appearance",
      title: translator.message("mobile.settings.section.appearance"),
      image: "circle.lefthalf.filled",
      attributes: { disabled: !canAdjust },
      subactions: APPEARANCES.map((option) => ({
        id: `appearance:${option.id}`,
        title: option.title,
        state: option.id === colorScheme ? "on" : "off",
      })),
    },
    {
      id: "zoom",
      title: `Zoom (${Math.round(zoomFactor * 100)}%)`,
      image: "plus.magnifyingglass",
      attributes: { disabled: !canAdjust },
      subactions: [
        {
          id: "zoom:in",
          title: translator.message("browser.menu.zoomIn"),
          image: "plus.magnifyingglass",
        },
        {
          id: "zoom:out",
          title: translator.message("browser.menu.zoomOut"),
          image: "minus.magnifyingglass",
        },
        {
          id: "zoom:reset",
          title: translator.message("mobile.ui.actualSize"),
          image: "1.magnifyingglass",
        },
      ],
    },
    {
      id: "viewport",
      title: translator.message("mobile.ui.viewport"),
      image: "rectangle.and.arrow.up.right.and.arrow.down.left",
      attributes: { disabled: !canResize },
      subactions: [
        ...VIEWPORTS.map<MenuAction>((option) => ({
          id: `viewport:${option.id}`,
          title: option.title,
          state: option.id === viewportId ? "on" : "off",
        })),
        {
          id: "viewport:custom",
          title: translator.message("mobile.panels.customSize"),
          state: viewportId === "custom" ? "on" : "off",
        },
      ],
    },
    {
      id: "site-data",
      title: translator.message("mobile.ui.siteData"),
      image: "trash",
      attributes: { disabled: !canAdjust },
      subactions: [
        {
          id: "clear:cookies",
          title: translator.message("browser.menu.clearCookies"),
          attributes: { destructive: true },
        },
        {
          id: "clear:cache",
          title: translator.message("browser.menu.clearCache"),
          attributes: { destructive: true },
        },
      ],
    },
    closeAction,
  ];

  const run = async (change: Omit<PreviewAdjustInput, "threadId" | "tabId">) => {
    if (!canAdjust) return;
    const result = await adjust({ environmentId, input: { ...target, ...change } });
    if (result._tag === "Failure")
      Dialog.alert(translator.message("mobile.ui.couldNotChangeThisBrowserTab"));
  };

  const onAction = (id: string) => {
    if (id === "pick-element") return onPickElement?.();
    if (id === "capture") return onCapture?.();
    if (id === "annotate") return onAnnotate?.();
    if (id === "record") return onRecording?.();
    if (id === "viewport:custom" && canResize) return setCustomOpen(true);
    if (id === "close") {
      void close({ environmentId, input: target }).then((result) => {
        if (result._tag === "Failure")
          Dialog.alert(translator.message("mobile.ui.couldNotCloseThisBrowserTab"));
      });
      return;
    }
    if (id === "paste") return onPaste?.();
    if (id === "hard-reload") return void run({ hardReload: true });
    if (id === "zoom:in") return void run({ zoomFactor: zoomTo(1) });
    if (id === "zoom:out") return void run({ zoomFactor: zoomTo(-1) });
    if (id === "zoom:reset") return void run({ zoomFactor: DEFAULT_PREVIEW_ZOOM_FACTOR });
    if (id === "clear:cookies") return void run({ clear: "cookies" });
    if (id === "clear:cache") return void run({ clear: "cache" });
    if (id.startsWith("appearance:")) {
      const option = APPEARANCES.find((candidate) => `appearance:${candidate.id}` === id);
      if (option) void run({ colorScheme: option.id });
      return;
    }
    if (id.startsWith("viewport:")) {
      if (!canResize) return;
      const option = VIEWPORTS.find((candidate) => `viewport:${candidate.id}` === id);
      if (!option) return;
      void resize({ environmentId, input: { ...target, viewport: option.setting } }).then(
        (result) => {
          if (result._tag === "Failure")
            Dialog.alert(translator.message("mobile.ui.couldNotChangeTheViewport"));
        },
      );
    }
  };

  return (
    <>
      <Menu
        // Remount when streaming changes, so an open menu never keeps offering
        // the other state's actions.
        key={streaming ? "streaming" : "idle"}
        accessible
        accessibilityLabel={translator.message("mobile.ui.browserTabOptions")}
        accessibilityRole="button"
        actions={streaming ? actions : [closeAction]}
        onPressAction={({ nativeEvent }) => onAction(nativeEvent.event)}
      >
        <ControlPill
          icon="ellipsis"
          accessibilityLabel={translator.message("mobile.ui.browserTabOptions")}
        />
      </Menu>
      {customOpen ? (
        <ThreadPanelSheet
          title={translator.message("mobile.panels.customSize")}
          onClose={() => setCustomOpen(false)}
        >
          <View className="flex-row gap-2">
            <AppTextInput
              accessibilityLabel={translator.message("mobile.panels.width")}
              value={width}
              onChangeText={setWidth}
              keyboardType="number-pad"
              className="flex-1 rounded-xl bg-input px-3 py-3 text-foreground"
            />
            <AppTextInput
              accessibilityLabel={translator.message("mobile.panels.height")}
              value={height}
              onChangeText={setHeight}
              keyboardType="number-pad"
              className="flex-1 rounded-xl bg-input px-3 py-3 text-foreground"
            />
          </View>
          <Button
            label={translator.message("mobile.panels.apply")}
            disabled={!customValid || !canResize}
            onPress={() => {
              void resize({ environmentId, input: { ...target, viewport: customViewport } }).then(
                (result) => {
                  if (result._tag === "Success") setCustomOpen(false);
                  else Dialog.alert(translator.message("mobile.ui.couldNotChangeTheViewport"));
                },
              );
            }}
          />
        </ThreadPanelSheet>
      ) : null}
    </>
  );
}
