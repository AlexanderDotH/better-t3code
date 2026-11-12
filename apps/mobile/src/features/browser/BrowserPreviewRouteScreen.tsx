import { SheetHeader } from "../../components/ui/SheetHeader";
import { useAtomValue } from "@effect/atom-react";
import * as Dialog from "../../components/ui/Dialog";
import { useIsFocused, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ThreadId,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type PreviewSessionSnapshot,
  type PreviewPickElementResult,
} from "@t3tools/contracts";
import { previewPdfAssetUrl } from "@t3tools/shared/preview";
import * as Option from "effect/Option";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Platform, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ControlPill } from "../../components/ui/ControlPill";
import { useAppForeground } from "../../lib/appState";
import { AppBar } from "../../components/ui/AppBar";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";

import { previewEnvironment, useThreadServerBrowserTabs } from "../../state/preview";
import { useAtomCommand } from "../../state/use-atom-command";
import { usePreparedConnection } from "../../state/session";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { BrowserTabMenu } from "./BrowserTabMenu";
import { browserTabTitle, browserTabUrl, latestBrowserTab } from "./browserTabs";
import {
  PreviewStreamWebView,
  type PreviewPictureInPictureState,
  type PreviewStreamRef,
} from "./PreviewStreamWebView";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { useBrowserSearchSettings } from "./useBrowserSearchSettings";
import { BrowserStartPage } from "./BrowserStartPage";
import { browserAddress } from "./browserAddress";
import { useBrowserHistory } from "./browserHistory";
import { shareGeneratedAttachment } from "../../lib/attachmentDownload";
import { estimateBase64ByteSize } from "../../lib/base64";
import { uuidv4 } from "../../lib/uuid";
import {
  appendComposerDraftAttachments,
  appendComposerDraftText,
  insertComposerDraftContext,
} from "../../state/use-composer-drafts";
import { browserPickedElementContext } from "./browserPickedElementContext";
import type { PreviewStreamMessage } from "./preview-stream-document";

const BrowserPreviewStack = createNativeStackNavigator<{ BrowserPreview: undefined }>();

const NO_PICTURE_IN_PICTURE: PreviewPictureInPictureState = { supported: false, active: false };

function attachBrowserElementScreenshot(
  draftKey: string,
  picked: NonNullable<PreviewPickElementResult>,
  dataUrl: string,
): boolean {
  const base64 = dataUrl.match(/^data:image\/png;base64,(.+)$/)?.[1];
  if (!base64 || estimateBase64ByteSize(base64) > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) return false;
  const screenshot = {
    type: "image" as const,
    id: uuidv4(),
    name: "browser-element.png",
    mimeType: "image/png" as const,
    sizeBytes: estimateBase64ByteSize(base64),
    dataUrl,
    previewUri: dataUrl,
  };
  const content = browserPickedElementContext(picked, screenshot, uuidv4());
  return insertComposerDraftContext(draftKey, { ...content, attachments: [screenshot] });
}

type BrowserPreviewRouteScreenProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly threadId: string;
  readonly tabId?: string;
}>;

export function BrowserPreviewRouteScreen({ route }: BrowserPreviewRouteScreenProps) {
  const navigation = useNavigation();
  const onClose = () => navigation.goBack();
  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <BrowserPreviewStack.Navigator
        screenOptions={{
          headerShown: Platform.OS === "ios",
          headerBackVisible: false,
          headerShadowVisible: false,
          headerTransparent: false,
          headerTitleStyle: { fontSize: 17, fontWeight: "600" },
        }}
      >
        <BrowserPreviewStack.Screen name="BrowserPreview">
          {() => (
            <BrowserPreviewScreen
              environmentId={EnvironmentId.make(route.params.environmentId)}
              threadId={ThreadId.make(route.params.threadId)}
              initialTabId={route.params.tabId ?? null}
              onClose={onClose}
            />
          )}
        </BrowserPreviewStack.Screen>
      </BrowserPreviewStack.Navigator>
    </View>
  );
}

function BrowserPreviewScreen({
  environmentId,
  threadId,
  initialTabId,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly initialTabId: string | null;
  readonly onClose: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const { themeVariables } = useAppearancePreferences();
  const prepared = usePreparedConnection(environmentId);
  const httpBaseUrl = Option.isSome(prepared) ? prepared.value.httpBaseUrl : null;
  const focused = useIsFocused();
  const foreground = useAppForeground();
  const [selectedTabId, setSelectedTabId] = useState(initialTabId);
  const [pictureInPicture, setPictureInPicture] = useState(NO_PICTURE_IN_PICTURE);
  const [streaming, setStreaming] = useState(false);
  const [canControl, setCanControl] = useState(false);
  const [newTab, setNewTab] = useState(false);
  const [recording, setRecording] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [elementPicking, setElementPicking] = useState(false);
  const [pickPending, setPickPending] = useState(false);
  const [picked, setPicked] = useState<{ id: number; result: PreviewPickElementResult } | null>(
    null,
  );
  const pickRequest = useRef(0);
  const canPick = useAtomValue(previewEnvironment.pickElementAt.permissionAtom(environmentId));
  const pickElementAt = useAtomCommand(previewEnvironment.pickElementAt, {
    reportFailure: false,
    reportDefect: false,
  });
  const streamRef = useRef<PreviewStreamRef>(null);
  const { tabs } = useThreadServerBrowserTabs({ environmentId, threadId, enabled: true });
  const tab = tabs.find((entry) => entry.tabId === selectedTabId) ?? latestBrowserTab(tabs);
  const pdfUri =
    tab?.navStatus._tag === "Success" ? previewPdfAssetUrl(tab.navStatus.url, httpBaseUrl) : null;
  const tabId = tab?.tabId ?? null;
  const [previousTabId, setPreviousTabId] = useState(tabId);
  if (tabId !== previousTabId) {
    setPreviousTabId(tabId);
    setPictureInPicture(NO_PICTURE_IN_PICTURE);
    setRecording(false);
    setAnnotating(false);
    setElementPicking(false);
    setPicked(null);
    setPickPending(false);
  }
  const history = useBrowserHistory(environmentId);
  const visitedUrl = tab?.navStatus._tag === "Success" ? tab.navStatus.url : null;
  const rememberVisit = useEffectEvent(history.remember);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- persists completed browser navigations so links and redirects also appear in recent URLs
  useEffect(() => {
    if (visitedUrl !== null) rememberVisit(visitedUrl);
  }, [visitedUrl]);
  const elementPickingChanged = (active: boolean) => {
    pickRequest.current++;
    setElementPicking(active);
    setPicked(null);
    setPickPending(false);
  };
  const pickElement = async (pick: Extract<PreviewStreamMessage, { type: "elementPick" }>) => {
    if (!tabId || !canPick) return;
    const request = ++pickRequest.current;
    setPickPending(true);
    setPicked(null);
    const result = await pickElementAt({
      environmentId,
      input: { threadId, tabId, ...pick.point },
    });
    if (request !== pickRequest.current) return;
    const selection = result._tag === "Success" ? result.value : null;
    setPickPending(false);
    setPicked({ id: pick.id, result: selection });
    streamRef.current?.resolveElementPick(pick.id, selection?.rect ?? null);
  };
  const attachPickedElement = (
    capture: Extract<PreviewStreamMessage, { type: "elementCapture" }>,
  ) => {
    if (!picked || capture.id !== picked.id) return;
    if (!picked.result) {
      const stream = streamRef.current;
      void captureScreenshot(capture.dataUrl, true).finally(() =>
        stream?.resolveElementPick(capture.id, null),
      );
      return;
    }
    const failed = (detail?: string) => {
      streamRef.current?.resolveElementPick(capture.id, picked.result?.rect ?? null);
      Dialog.alert(translator.message("mobile.panels.failed"), detail);
    };
    try {
      if (
        !attachBrowserElementScreenshot(
          scopedThreadKey({ environmentId, threadId }),
          picked.result,
          capture.dataUrl,
        )
      )
        return failed();
      onClose();
    } catch (error) {
      failed(error instanceof Error ? error.message : undefined);
    }
  };
  const captureScreenshot = async (dataUrl: string, annotation: boolean) => {
    await (async () => {
      const match = /^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/.exec(dataUrl);
      if (!match) throw new Error(translator.message("mobile.panels.failed"));
      const mimeType = match[1]!;
      const base64 = match[2]!;
      if (annotation) {
        if (estimateBase64ByteSize(base64) > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)
          throw new Error(translator.message("mobile.panels.failed"));
        const draftKey = scopedThreadKey({ environmentId, threadId });
        const rejected = appendComposerDraftAttachments(draftKey, [
          {
            type: "image",
            id: uuidv4(),
            name: "browser-annotation.png",
            mimeType: "image/png",
            sizeBytes: estimateBase64ByteSize(base64),
            dataUrl,
            previewUri: dataUrl,
          },
        ]);
        if (rejected) throw new Error(translator.message("mobile.panels.failed"));
        appendComposerDraftText(
          draftKey,
          `\n${translator.message("mobile.panels.annotationPrompt")}\n${tab ? browserTabUrl(tab) : ""}\n`,
        );
        onClose();
      } else {
        const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
        const shared = await shareGeneratedAttachment({
          bytes,
          attachment: {
            name: mimeType.startsWith("video/")
              ? `browser-recording.${mimeType.includes("mp4") ? "mp4" : "webm"}`
              : "browser-screenshot.png",
            mimeType,
          },
          signal: new AbortController().signal,
        });
        if (!shared) Dialog.alert(translator.message("mobile.panels.failed"));
      }
    })().catch((error) => {
      Dialog.alert(
        translator.message("mobile.panels.failed"),
        error instanceof Error ? error.message : undefined,
      );
    });
  };
  const onPictureInPicture = (state: PreviewPictureInPictureState, detail?: string) => {
    setPictureInPicture({ supported: state.supported, active: state.active });
    if (detail) Dialog.alert(translator.message("mobile.ui.pictureInPictureIsUnavailable"), detail);
  };
  const selectTab = (next: string) => {
    if (next === tabId && !newTab) return;
    setNewTab(false);
    setRecording(false);
    setStreaming(false);
    setCanControl(false);
    setPictureInPicture(NO_PICTURE_IN_PICTURE);
    setSelectedTabId(next);
  };
  const live = (focused && foreground) || pictureInPicture.active;
  const title = newTab || !tab ? translator.message("mobile.panels.newTab") : browserTabTitle(tab);

  return (
    <View className="flex-1 bg-sheet" style={{ paddingBottom: insets.bottom }}>
      <AppBar
        title={title}
        sidebar={false}
        onBack={onClose}
        options={{ headerBackVisible: false }}
        actions={[
          {
            accessibilityLabel: translator.message("mobile.panels.newTab"),
            icon: "plus",
            selected: newTab,
            disabled: recording,
            onPress: () => setNewTab(true),
          },
          // Android WebView cannot play video in picture in picture.
          ...(Platform.OS === "ios" &&
          pictureInPicture.supported &&
          (pictureInPicture.active || pdfUri === null)
            ? [
                {
                  accessibilityLabel: pictureInPicture.active
                    ? translator.message("mobile.ui.exitPictureInPicture")
                    : translator.message("mobile.ui.pictureInPicture"),
                  icon: {
                    ios: pictureInPicture.active ? ("pip.exit" as const) : ("pip.enter" as const),
                    android: "visibility" as const,
                  },
                  selected: pictureInPicture.active,
                  onPress: () => streamRef.current?.togglePictureInPicture(),
                },
              ]
            : []),
        ]}
        menus={
          tabs.length > 0
            ? [
                {
                  title: translator.message("mobile.ui.tabs"),
                  icon: "square.on.square",
                  items: tabs.map((entry) => ({
                    id: entry.tabId,
                    title: browserTabTitle(entry),
                    subtitle: browserTabUrl(entry),
                    selected: !newTab && entry.tabId === tabId,
                    disabled: recording,
                    onPress: () => selectTab(entry.tabId),
                  })),
                },
              ]
            : []
        }
      />
      {Platform.OS === "ios" ? (
        <SheetHeader
          title={title}
          onClose={onClose}
          accessibilityLabel={translator.message("mobile.ui.closeBrowser")}
        />
      ) : null}
      {tab && !newTab ? (
        <>
          <BrowserAddressBar
            key={`address:${tab.tabId}`}
            environmentId={environmentId}
            tab={tab}
            streaming={streaming}
            ready={streaming && canControl && !elementPicking}
            onCommand={(input) => streamRef.current?.command(input)}
            onPaste={() => streamRef.current?.paste()}
            recording={recording}
            onCapture={() => streamRef.current?.capture()}
            onAnnotate={() => streamRef.current?.annotate()}
            onPickElement={
              canPick && !recording && pdfUri === null
                ? () => streamRef.current?.pickElement()
                : undefined
            }
            onRecording={() => streamRef.current?.toggleRecording()}
            onNavigate={history.remember}
          />
          {annotating ? (
            <View className="flex-row items-center gap-2 px-4 py-2">
              <AppText className="flex-1 text-xs text-foreground-muted">
                {translator.message("mobile.panels.pickHint")}
              </AppText>
              <Button
                label={translator.message("settings.common.cancel")}
                tone="text"
                onPress={() => streamRef.current?.annotate()}
              />
            </View>
          ) : null}
          {elementPicking ? (
            <View
              className="absolute inset-x-3 z-10 flex-row items-center gap-2 rounded-xl border border-secondary-border bg-secondary p-3"
              style={{ bottom: insets.bottom + 12 }}
            >
              <AppText className="min-w-0 flex-1 text-xs text-foreground-muted" numberOfLines={2}>
                {pickPending
                  ? translator.message("mobile.panels.pickingElement")
                  : picked
                    ? picked.result?.element.componentName ||
                      picked.result?.element.selector ||
                      translator.message("mobile.panels.pickElementFallback")
                    : translator.message("mobile.panels.pickElementHint")}
              </AppText>
              <Button
                label={translator.message("settings.common.cancel")}
                tone="text"
                onPress={() => {
                  elementPickingChanged(false);
                  streamRef.current?.pickElement();
                }}
              />
              <Button
                label={translator.message("mobile.panels.attachElement")}
                disabled={!picked || pickPending}
                onPress={() => streamRef.current?.confirmElementPick()}
              />
            </View>
          ) : null}
          {live ? (
            <PreviewStreamWebView
              key={`stream:${tab.tabId}`}
              environmentId={environmentId}
              threadId={threadId}
              tabId={tab.tabId}
              pdfUri={pdfUri}
              ref={streamRef}
              interactive
              background={themeVariables["--color-sheet-solid"]}
              onPictureInPicture={onPictureInPicture}
              onStreamingChange={(active) => {
                setStreaming(active);
                if (!active) {
                  setRecording(false);
                  setCanControl(false);
                }
              }}
              onControl={(control) => setCanControl(control?.controller === "you")}
              onCapture={(dataUrl, annotation) => void captureScreenshot(dataUrl, annotation)}
              onRecordingChange={setRecording}
              onAnnotationChange={setAnnotating}
              onElementPickingChange={elementPickingChanged}
              onElementPick={(pick) => void pickElement(pick)}
              onElementCapture={attachPickedElement}
            />
          ) : (
            <View className="flex-1" />
          )}
        </>
      ) : (
        <BrowserStartPage environmentId={environmentId} threadId={threadId} onOpen={selectTab} />
      )}
    </View>
  );
}

function BrowserAddressBar({
  environmentId,
  tab,
  ready,
  streaming,
  onCommand,
  onPaste,
  recording,
  onCapture,
  onAnnotate,
  onPickElement,
  onRecording,
  onNavigate,
}: {
  readonly environmentId: EnvironmentId;
  readonly tab: PreviewSessionSnapshot;
  readonly ready: boolean;
  readonly streaming: boolean;
  readonly onCommand: PreviewStreamRef["command"];
  readonly onPaste: () => void;
  readonly recording: boolean;
  readonly onCapture: () => void;
  readonly onAnnotate: () => void;
  readonly onPickElement?: (() => void) | undefined;
  readonly onRecording: () => void;
  readonly onNavigate: (url: string) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const url = browserTabUrl(tab);
  const [draft, setDraft] = useState<string | null>(null);
  const settings = useBrowserSearchSettings();
  const submit = () => {
    const value = draft ?? url;
    setDraft(null);
    try {
      const nextUrl = browserAddress(value, settings);
      onCommand({ type: "navigate", url: nextUrl });
      onNavigate(nextUrl);
    } catch {
      Dialog.alert(
        translator.message("mobile.ui.couldNotOpenThisAddress"),
        translator.message("mobile.ui.enterAnHttpOrHttpsUrl"),
      );
    }
  };
  return (
    <View className="flex-row items-center gap-1 px-2 pb-2">
      <ControlPill
        icon="chevron.left"
        accessibilityLabel={translator.message("browser.files.back")}
        disabled={!ready || !tab.canGoBack}
        onPress={() => onCommand({ type: "history", delta: -1 })}
      />
      <ControlPill
        icon="chevron.right"
        accessibilityLabel={translator.message("browser.chrome.forward")}
        disabled={!ready || !tab.canGoForward}
        onPress={() => onCommand({ type: "history", delta: 1 })}
      />
      <TextInput
        accessibilityLabel={translator.message("mobile.ui.address")}
        editable={ready}
        value={draft ?? url}
        onChangeText={setDraft}
        onBlur={() => setDraft(null)}
        onSubmitEditing={submit}
        placeholder={translator.message("mobile.ui.enterAUrl")}
        placeholderTextColorClassName="accent-placeholder"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="go"
        selectTextOnFocus
        lineBreakModeIOS="tail"
        className="h-10 min-w-0 flex-1 rounded-full border border-input-border bg-input px-4 font-sans text-sm text-foreground"
      />
      <ControlPill
        icon="arrow.clockwise"
        accessibilityLabel={translator.message("mobile.ui.reloadPage")}
        disabled={!ready}
        onPress={() => onCommand({ type: "reload" })}
      />
      <BrowserTabMenu
        environmentId={environmentId}
        tab={tab}
        streaming={streaming}
        onPaste={ready ? onPaste : undefined}
        recording={recording}
        onCapture={onCapture}
        onAnnotate={ready ? onAnnotate : undefined}
        onPickElement={onPickElement}
        onRecording={onRecording}
      />
    </View>
  );
}
