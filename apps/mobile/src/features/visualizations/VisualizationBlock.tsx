import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  buildVisualizationActionPrompt,
  isExperimentalVisualization,
  normalizeVisualizationFormat,
  parseVisualization,
  visualizationDataToCsv,
  VISUALIZATION_CHANNEL,
  type VisualizationDataset,
  type VisualizationRenderRequest,
} from "@t3tools/client-runtime/visualizations/model";
import { visualizationLabels } from "@t3tools/client-runtime/visualizations/labels";
import { normalizeVisualizationAppearance } from "@t3tools/client-runtime/visualizations/appearance";

import { AppText as Text } from "../../components/AppText";
import { MaterialIconButton } from "../../components/MaterialIconButton";
import { SymbolView } from "../../components/AppSymbol";
import { shareLocalAttachment } from "../../lib/attachmentDownload";
import { tryCopyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { uuidv4 } from "../../lib/uuid";
import { useFontFamily } from "../../lib/useFontFamily";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import {
  VisualizationRuntime,
  useVisualizationPreview,
  type VisualizationRuntimeHandle,
} from "./VisualizationRuntime";
import { VisualizationActionsMenu } from "./VisualizationActionsMenu";
import { VisualizationPreview } from "./VisualizationPreview";
import { VisualizationPngExport } from "./VisualizationPngExport";

export { VisualizationProvider } from "./VisualizationRuntime";

type Labels = ReturnType<typeof visualizationLabels>;
const TABLE_PAGE_SIZE = 50;
const COPY_FEEDBACK_DURATION_MS = 1200;

function ActionButton({
  label,
  onPress,
  disabled = false,
  selected,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, ...(selected !== undefined ? { selected } : {}) }}
      disabled={disabled}
      onPress={onPress}
      className="min-h-11 justify-center rounded-lg bg-subtle px-3 py-2"
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <Text
        className={selected ? "text-xs font-t3-bold text-foreground" : "text-xs text-foreground"}
      >
        {label}
      </Text>
    </Pressable>
  );
}

async function shareVisualization(content: string, extension: "svg" | "png" | "csv") {
  const { File, Paths } = await import("expo-file-system");
  const file = new File(Paths.cache, `diagram-${uuidv4()}.${extension}`);
  const mimeType = { svg: "image/svg+xml", png: "image/png", csv: "text/csv" }[extension];
  try {
    file.write(extension === "png" ? content.replace(/^data:image\/png;base64,/, "") : content, {
      encoding: extension === "png" ? "base64" : "utf8",
    });
    await shareLocalAttachment({
      uri: file.uri,
      attachment: { name: `diagram.${extension}`, mimeType },
      signal: new AbortController().signal,
    });
  } finally {
    if (file.exists) file.delete();
  }
}

function SourceTable({
  dataset,
  labels,
  onExport,
  exportDisabled,
}: {
  dataset: VisualizationDataset;
  labels: Labels;
  onExport: () => void;
  exportDisabled: boolean;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(dataset.rows.length / TABLE_PAGE_SIZE));
  return (
    <View className="gap-2">
      <Text accessibilityRole="header" className="text-sm font-t3-bold text-foreground">
        {labels.sourceData}: {dataset.name}
      </Text>
      <ScrollView horizontal>
        <View>
          <View className="flex-row border-b border-border">
            {dataset.columns.map((column) => (
              <Text key={column} className="w-36 p-2 text-xs font-t3-bold text-foreground">
                {column}
              </Text>
            ))}
          </View>
          {dataset.rows
            .slice(page * TABLE_PAGE_SIZE, (page + 1) * TABLE_PAGE_SIZE)
            .map((row, index) => (
              <View
                key={page * TABLE_PAGE_SIZE + index}
                className="flex-row border-b border-border"
              >
                {dataset.columns.map((column) => (
                  <Text key={column} selectable className="w-36 p-2 text-xs text-foreground">
                    {row[column] == null
                      ? "—"
                      : typeof row[column] === "object"
                        ? JSON.stringify(row[column])
                        : String(row[column])}
                  </Text>
                ))}
              </View>
            ))}
        </View>
      </ScrollView>
      <View className="flex-row flex-wrap items-center gap-2">
        <ActionButton
          label={labels.previous}
          disabled={page === 0}
          onPress={() => setPage(page - 1)}
        />
        <Text className="text-xs text-foreground">
          {page + 1} / {pageCount}
        </Text>
        <ActionButton
          label={labels.next}
          disabled={page + 1 >= pageCount}
          onPress={() => setPage(page + 1)}
        />
        <ActionButton label={labels.exportCsv} disabled={exportDisabled} onPress={onExport} />
      </View>
    </View>
  );
}

function VisualizationSource({ code }: { code: string }) {
  return (
    <ScrollView nestedScrollEnabled className="max-h-72 rounded-lg bg-screen p-3">
      <ScrollView horizontal nestedScrollEnabled>
        <Text selectable className="font-mono text-xs text-foreground">
          {code}
        </Text>
      </ScrollView>
    </ScrollView>
  );
}

function VisualizationRenderError({
  error,
  labels,
  onFix,
}: {
  error: string;
  labels: Labels;
  onFix?: () => void;
}) {
  return (
    <View accessibilityRole="alert" className="gap-2">
      <Text className="text-sm text-foreground">{labels.renderFailed}</Text>
      <Text selectable className="text-xs text-foreground-muted">
        {error}
      </Text>
      {onFix ? <ActionButton label={labels.fix} onPress={onFix} /> : null}
    </View>
  );
}

export function VisualizationBlock({
  language,
  code,
  isStreaming = false,
  onAction,
}: {
  language: string;
  code: string;
  isStreaming?: boolean;
  onAction?: (prompt: string) => void;
}) {
  const { themeAppearance, themeVariables, interfaceLanguage } = useAppearancePreferences();
  const fontFamily = useFontFamily("regular");
  const locale = interfaceLanguage.language === "de" ? "de" : "en";
  const labels = visualizationLabels(locale);
  const requestPreview = useVisualizationPreview();
  const appearance = useMemo(
    () =>
      normalizeVisualizationAppearance(
        {
          fontFamily: `${fontFamily}, sans-serif`,
          background: themeVariables["--color-card"],
          foreground: themeVariables["--color-foreground"],
          mutedForeground: themeVariables["--color-foreground-muted"],
          surface: themeVariables["--color-card-alt"],
          border: themeVariables["--color-border"],
        },
        themeAppearance,
      ),
    [fontFamily, themeVariables, themeAppearance],
  );
  const parsed = useMemo(() => {
    try {
      return { document: parseVisualization(language, code), error: null };
    } catch (error) {
      return { document: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [language, code]);
  const request = useMemo<VisualizationRenderRequest | null>(
    () =>
      parsed.document
        ? {
            channel: VISUALIZATION_CHANNEL,
            type: "render",
            requestId: uuidv4(),
            format: parsed.document.format,
            source: code,
            theme: themeAppearance,
            appearance,
            interactive: false,
          }
        : null,
    [parsed.document, code, themeAppearance, appearance],
  );
  const [preview, setPreview] = useState<{
    requestId: string;
    svg?: string;
    error?: string;
  } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [showData, setShowData] = useState(false);
  const [pan, setPan] = useState(false);
  const [readyRequestId, setReadyRequestId] = useState<string | null>(null);
  const [interactiveFailure, setInteractiveFailure] = useState<{
    requestId: string;
    error: string;
  } | null>(null);
  const [activeExport, setActiveExport] = useState<{
    id: string;
    requestId: string;
    fullscreen?: boolean;
    pngRequest?: VisualizationRenderRequest;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runtime = useRef<VisualizationRuntimeHandle>(null);
  const { height } = useWindowDimensions();
  const interactiveRequest = useMemo(
    () =>
      request
        ? { ...request, requestId: `${request.requestId}-interactive`, interactive: true }
        : null,
    [request],
  );
  const interactiveError =
    interactiveFailure?.requestId === interactiveRequest?.requestId
      ? interactiveFailure?.error
      : null;
  const interactiveReady = readyRequestId === interactiveRequest?.requestId && !interactiveError;
  const current = preview?.requestId === request?.requestId ? preview : null;
  const svg = current?.svg;
  const error = parsed.error ?? current?.error;
  const document = parsed.document;
  const previewReady = Boolean(svg) && !error && !isStreaming;
  const sourceRequired = Boolean(error) || isStreaming;
  const exporting = activeExport !== null && activeExport.requestId === request?.requestId;
  const pngExportRequest = exporting ? activeExport.pngRequest : null;

  useEffect(
    () => () => {
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
    },
    [],
  );

  useEffect(() => {
    if (!request || isStreaming) return;
    const controller = new AbortController();
    void requestPreview(request, controller.signal)
      .then((svg) => {
        if (!controller.signal.aborted) setPreview({ requestId: request.requestId, svg });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setPreview({
            requestId: request.requestId,
            error: error instanceof Error ? error.message : String(error),
          });
      });
    return () => controller.abort();
  }, [request, requestPreview, isStreaming]);

  const exportFile = (content: string, extension: "svg" | "png" | "csv") => {
    if (!request) return;
    const exportId = uuidv4();
    setActiveExport({ id: exportId, requestId: request.requestId });
    void shareVisualization(content, extension)
      .catch(() => Alert.alert(labels.exportFailed))
      .finally(() => setActiveExport((current) => (current?.id === exportId ? null : current)));
  };
  const exportFailed = (error: string) => {
    setActiveExport(null);
    Alert.alert(labels.exportFailed, error);
  };
  const exportImage = (format: "svg" | "png", inFullscreen: boolean) => {
    if (exporting || !request) return;
    if (inFullscreen) {
      if (!interactiveReady || !runtime.current) return;
      setActiveExport({ id: uuidv4(), requestId: request.requestId, fullscreen: true });
      if (format === "svg") runtime.current.exportSvg();
      else runtime.current.exportPng();
    } else if (previewReady && format === "svg" && svg) {
      exportFile(svg, "svg");
    } else if (previewReady && format === "png") {
      setActiveExport({
        id: uuidv4(),
        requestId: request.requestId,
        pngRequest: { ...request, requestId: uuidv4() },
      });
    }
  };
  const closeFullscreen = () => {
    setFullscreen(false);
    setActiveExport((current) => (current?.fullscreen ? null : current));
  };
  const fixDiagram = (error: string) => {
    const format = normalizeVisualizationFormat(language);
    if (!onAction || !format) return;
    onAction(
      buildVisualizationActionPrompt({
        action: "fix",
        format,
        source: code,
        error,
        locale,
      }),
    );
    closeFullscreen();
  };
  const copySource = () => {
    void tryCopyTextWithHaptic(code).then((copied) => {
      if (!copied) {
        Alert.alert(labels.copyFailed);
        return;
      }
      setCopied(true);
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
      copyTimeout.current = setTimeout(() => {
        setCopied(false);
        copyTimeout.current = null;
      }, COPY_FEEDBACK_DURATION_MS);
    });
  };
  const openFullscreen = () => {
    if (!previewReady) return;
    setReadyRequestId(null);
    setInteractiveFailure(null);
    setPan(false);
    setFullscreen(true);
  };
  const isChart = document?.format === "vega" || document?.format === "vega-lite";
  const experimental = document && isExperimentalVisualization(document.format, code);
  const hasMetadata =
    document &&
    (document.metadata.summary ||
      document.metadata.kind ||
      document.metadata.asOf ||
      document.metadata.sources.length ||
      document.metadata.limitations.length ||
      isChart ||
      experimental);
  const metadata = hasMetadata ? (
    <View className="gap-1">
      {document.metadata.summary ? (
        <Text className="text-sm text-foreground">{document.metadata.summary}</Text>
      ) : null}
      {document.metadata.kind ? (
        <Text className="text-xs font-t3-bold text-foreground">
          {labels[document.metadata.kind]}
        </Text>
      ) : null}
      {document.metadata.asOf ? (
        <Text className="text-xs text-foreground-muted">
          {labels.asOf}: {document.metadata.asOf}
        </Text>
      ) : null}
      {isChart || document.metadata.sources.length ? (
        <Text selectable className="text-xs text-foreground-muted">
          {document.metadata.sources.length
            ? `${labels.sources}: ${document.metadata.sources.join(" · ")}`
            : labels.missingSources}
        </Text>
      ) : null}
      {document.metadata.limitations.length ? (
        <Text className="text-xs text-foreground-muted">
          {labels.limitations}: {document.metadata.limitations.join(" · ")}
        </Text>
      ) : null}
      {experimental ? (
        <Text className="text-xs text-foreground-muted">{labels.experimental}</Text>
      ) : null}
    </View>
  ) : null;
  const sourceData = document?.datasets.length ? (
    <View className="gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={labels.sourceData}
        accessibilityState={{ expanded: showData }}
        onPress={() => setShowData(!showData)}
        className="min-h-11 flex-row items-center gap-2"
      >
        <SymbolView
          name={showData ? "chevron.up" : "chevron.down"}
          size={14}
          tintColorClassName="accent-icon-muted"
        />
        <Text className="text-xs text-foreground-muted">{labels.sourceData}</Text>
      </Pressable>
      {showData
        ? document.datasets.map((dataset, index) => (
            <SourceTable
              key={`${request?.requestId}-${index}`}
              dataset={dataset}
              labels={labels}
              exportDisabled={exporting}
              onExport={() => exportFile(visualizationDataToCsv(dataset), "csv")}
            />
          ))
        : null}
    </View>
  ) : null;

  return (
    <View className="my-2 gap-2 rounded-xl border border-border bg-card p-3">
      <View className="flex-row items-center">
        <Text
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          numberOfLines={1}
          className="flex-1 text-xs font-t3-medium text-foreground-muted"
        >
          {labels.title} · {copied ? labels.copied : language}
        </Text>
        <MaterialIconButton
          accessibilityLabel={labels.fullscreen}
          icon="arrow.up.left.and.arrow.down.right"
          disabled={!previewReady}
          onPress={openFullscreen}
        />
        <VisualizationActionsMenu
          labels={labels}
          sourceVisible={showSource || sourceRequired}
          sourceRequired={sourceRequired}
          copied={copied}
          exportReady={previewReady && !exporting}
          onToggleSource={() => setShowSource(!showSource)}
          onCopySource={copySource}
          onExportSvg={() => exportImage("svg", false)}
          onExportPng={() => exportImage("png", false)}
        />
      </View>
      {error ? (
        <VisualizationRenderError
          error={error}
          labels={labels}
          onFix={onAction ? () => fixDiagram(error) : undefined}
        />
      ) : null}
      {previewReady && svg ? (
        <VisualizationPreview
          svg={svg}
          label={document?.metadata.summary ?? labels.title}
          fullscreenLabel={labels.fullscreen}
          onFullscreen={openFullscreen}
          onError={(error) => {
            if (request) setPreview({ requestId: request.requestId, error: error.message });
          }}
        />
      ) : !sourceRequired ? (
        <View
          accessibilityLabel={labels.loading}
          className="h-40 items-center justify-center gap-2"
        >
          <ActivityIndicator />
          <Text className="text-xs text-foreground-muted">{labels.loading}</Text>
        </View>
      ) : null}
      {metadata}
      {showSource || sourceRequired ? <VisualizationSource code={code} /> : null}
      {sourceData}
      {pngExportRequest ? (
        <VisualizationPngExport
          request={pngExportRequest}
          onPng={(dataUrl) => exportFile(dataUrl, "png")}
          onError={exportFailed}
        />
      ) : null}
      <Modal
        visible={fullscreen && interactiveRequest !== null}
        animationType="none"
        presentationStyle="fullScreen"
        onRequestClose={closeFullscreen}
      >
        <SafeAreaView className="flex-1 bg-screen">
          <View className="flex-row items-center border-b border-border px-4 py-2">
            <Text
              accessibilityRole="header"
              accessibilityLiveRegion="polite"
              numberOfLines={1}
              className="flex-1 text-xs font-t3-medium text-foreground-muted"
            >
              {labels.title} · {copied ? labels.copied : language}
            </Text>
            <VisualizationActionsMenu
              labels={labels}
              inModal
              copied={copied}
              sourceVisible={showSource || sourceRequired || Boolean(interactiveError)}
              sourceRequired={sourceRequired || Boolean(interactiveError)}
              exportReady={interactiveReady && !exporting}
              onToggleSource={() => setShowSource(!showSource)}
              onCopySource={copySource}
              onExportSvg={() => exportImage("svg", true)}
              onExportPng={() => exportImage("png", true)}
            />
            <MaterialIconButton
              accessibilityLabel={labels.close}
              icon="xmark"
              onPress={closeFullscreen}
            />
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            <View className="flex-row items-center gap-1">
              <MaterialIconButton
                accessibilityLabel={labels.zoomIn}
                icon="plus"
                disabled={!interactiveReady}
                onPress={() => runtime.current?.view("zoom-in")}
              />
              <MaterialIconButton
                accessibilityLabel={labels.zoomOut}
                icon="minus"
                disabled={!interactiveReady}
                onPress={() => runtime.current?.view("zoom-out")}
              />
              <MaterialIconButton
                accessibilityLabel={labels.fit}
                icon="arrow.down.right.and.arrow.up.left"
                disabled={!interactiveReady}
                onPress={() => runtime.current?.view("fit")}
              />
              <ActionButton
                label={labels.pan}
                disabled={!interactiveReady}
                selected={pan}
                onPress={() => {
                  runtime.current?.view(pan ? "select" : "pan");
                  setPan(!pan);
                }}
              />
            </View>
            {interactiveError ? (
              <VisualizationRenderError
                error={interactiveError}
                labels={labels}
                onFix={onAction ? () => fixDiagram(interactiveError) : undefined}
              />
            ) : (
              <View
                accessibilityLabel={document?.metadata.summary ?? labels.interactive}
                className="overflow-hidden rounded-lg bg-card"
                style={{ height: Math.max(260, height * 0.55) }}
              >
                {fullscreen && interactiveRequest ? (
                  <VisualizationRuntime
                    ref={runtime}
                    request={interactiveRequest}
                    onResult={() => {
                      setReadyRequestId(interactiveRequest.requestId);
                      setPan(false);
                    }}
                    onError={(error) => {
                      setReadyRequestId(null);
                      setActiveExport(null);
                      setInteractiveFailure({ requestId: interactiveRequest.requestId, error });
                    }}
                    onExportError={exportFailed}
                    onPng={(dataUrl) => exportFile(dataUrl, "png")}
                    onSvg={(svg) => exportFile(svg, "svg")}
                  />
                ) : null}
              </View>
            )}
            {metadata}
            {showSource || sourceRequired || interactiveError ? (
              <VisualizationSource code={code} />
            ) : null}
            {sourceData}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
