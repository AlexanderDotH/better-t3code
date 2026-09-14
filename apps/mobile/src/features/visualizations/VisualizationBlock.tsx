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
import { SvgXml } from "react-native-svg";
import {
  buildVisualizationActionPrompt,
  isExperimentalVisualization,
  normalizeVisualizationFormat,
  parseVisualization,
  visualizationDataToCsv,
  VISUALIZATION_CHANNEL,
  type VisualizationAction,
  type VisualizationDataset,
  type VisualizationRenderRequest,
} from "@t3tools/client-runtime/visualizations/model";
import { visualizationLabels } from "@t3tools/client-runtime/visualizations/labels";

import { AppText as Text } from "../../components/AppText";
import { shareLocalAttachment } from "../../lib/attachmentDownload";
import { tryCopyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { uuidv4 } from "../../lib/uuid";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import {
  VisualizationRuntime,
  useVisualizationPreview,
  type VisualizationRuntimeHandle,
} from "./VisualizationRuntime";

export { VisualizationProvider } from "./VisualizationRuntime";

type Labels = ReturnType<typeof visualizationLabels>;
const TABLE_PAGE_SIZE = 50;

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
      className="min-h-11 justify-center rounded-lg border border-border px-3 py-2"
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <Text className="text-xs text-foreground">{label}</Text>
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
}: {
  dataset: VisualizationDataset;
  labels: Labels;
  onExport: () => void;
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
        <ActionButton label={labels.exportCsv} onPress={onExport} />
      </View>
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
  const { themeAppearance, interfaceLanguage } = useAppearancePreferences();
  const locale = interfaceLanguage.language === "de" ? "de" : "en";
  const labels = visualizationLabels(locale);
  const requestPreview = useVisualizationPreview();
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
            interactive: false,
          }
        : null,
    [parsed.document, code, themeAppearance],
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
  const runtime = useRef<VisualizationRuntimeHandle>(null);
  const { height } = useWindowDimensions();
  const interactiveRequest = useMemo(
    () =>
      request
        ? { ...request, requestId: `${request.requestId}-interactive`, interactive: true }
        : null,
    [request],
  );
  const interactiveReady = readyRequestId === interactiveRequest?.requestId;
  const current = preview?.requestId === request?.requestId ? preview : null;
  const svg = current?.svg;
  const error = parsed.error ?? current?.error;
  const document = parsed.document;

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
    void shareVisualization(content, extension).catch(() => Alert.alert(labels.exportFailed));
  };
  const action = (action: VisualizationAction) => {
    if (!onAction || !document) return;
    onAction(
      buildVisualizationActionPrompt({
        action,
        format: document.format,
        source: code,
        ...(error ? { error } : {}),
        locale,
      }),
    );
    setFullscreen(false);
  };
  const copySource = () => {
    void tryCopyTextWithHaptic(code).then((copied) => {
      if (!copied) Alert.alert(labels.copyFailed);
    });
  };
  const source = (
    <ScrollView horizontal className="max-h-72 rounded-lg bg-background p-3">
      <ScrollView nestedScrollEnabled>
        <Text selectable className="font-mono text-xs text-foreground">
          {code}
        </Text>
      </ScrollView>
    </ScrollView>
  );
  const actions = onAction ? (
    <View className="gap-3">
      <Text accessibilityRole="header" className="text-xs font-t3-bold text-foreground">
        {labels.learning}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <ActionButton label={labels.simpler} onPress={() => action("simpler")} />
        <ActionButton label={labels.stepByStep} onPress={() => action("step-by-step")} />
        <ActionButton
          label={labels.checkUnderstanding}
          onPress={() => action("check-understanding")}
        />
      </View>
      <Text accessibilityRole="header" className="text-xs font-t3-bold text-foreground">
        {labels.analysis}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <ActionButton label={labels.breakDown} onPress={() => action("break-down")} />
        <ActionButton label={labels.comparePeriods} onPress={() => action("compare-periods")} />
        <ActionButton
          label={labels.explainAssumptions}
          onPress={() => action("explain-assumptions")}
        />
      </View>
    </View>
  ) : null;
  const metadata = document ? (
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
      {document.format === "vega" || document.format === "vega-lite" ? (
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
    </View>
  ) : null;
  const toolbar = (
    <View className="flex-row flex-wrap gap-2">
      <ActionButton
        label={showSource ? labels.preview : labels.source}
        onPress={() => setShowSource(!showSource)}
      />
      <ActionButton label={labels.copySource} onPress={copySource} />
      {svg ? (
        <ActionButton
          label={labels.exportSvg}
          disabled={fullscreen && !interactiveReady}
          onPress={() => (fullscreen ? runtime.current?.exportSvg() : exportFile(svg, "svg"))}
        />
      ) : null}
      {document?.datasets.length ? (
        <ActionButton
          label={labels.sourceData}
          selected={showData}
          onPress={() => setShowData(!showData)}
        />
      ) : null}
    </View>
  );
  const tables = showData
    ? document?.datasets.map((dataset, index) => (
        <SourceTable
          key={`${request?.requestId}-${index}`}
          dataset={dataset}
          labels={labels}
          onExport={() => exportFile(visualizationDataToCsv(dataset), "csv")}
        />
      ))
    : null;

  return (
    <View className="my-2 gap-3 rounded-xl border border-border bg-card p-3">
      <Text accessibilityRole="header" className="text-sm font-t3-bold text-foreground">
        {labels.title} · {language}
      </Text>
      {document && isExperimentalVisualization(document.format, code) ? (
        <Text className="text-xs text-foreground-muted">{labels.experimental}</Text>
      ) : null}
      {metadata}
      {error ? (
        <View accessibilityRole="alert" className="gap-2">
          <Text className="text-sm text-foreground">{labels.renderFailed}</Text>
          <Text selectable className="text-xs text-foreground-muted">
            {error}
          </Text>
          {onAction ? (
            <ActionButton
              label={labels.fix}
              onPress={() => {
                const format = normalizeVisualizationFormat(language);
                if (format)
                  onAction(
                    buildVisualizationActionPrompt({
                      action: "fix",
                      format,
                      source: code,
                      error,
                      locale,
                    }),
                  );
              }}
            />
          ) : null}
        </View>
      ) : null}
      {showSource || error || isStreaming ? (
        source
      ) : svg ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${labels.fullscreen}: ${document?.metadata.summary ?? labels.title}`}
          onPress={() => {
            setReadyRequestId(null);
            setPan(false);
            setFullscreen(true);
          }}
        >
          <SvgXml
            xml={svg}
            width="100%"
            height={220}
            accessibilityLabel={document?.metadata.summary ?? labels.title}
            onError={(error) => {
              if (request) setPreview({ requestId: request.requestId, error: error.message });
            }}
          />
        </Pressable>
      ) : (
        <View
          accessibilityLabel={labels.loading}
          className="h-40 items-center justify-center gap-2"
        >
          <ActivityIndicator />
          <Text className="text-xs text-foreground-muted">{labels.loading}</Text>
        </View>
      )}
      {svg ? (
        <ActionButton
          label={labels.fullscreen}
          onPress={() => {
            setReadyRequestId(null);
            setPan(false);
            setFullscreen(true);
          }}
        />
      ) : null}
      {toolbar}
      {tables}
      {document ? actions : null}
      <Modal
        visible={fullscreen && interactiveRequest !== null}
        animationType="none"
        presentationStyle="fullScreen"
        onRequestClose={() => setFullscreen(false)}
      >
        <SafeAreaView className="flex-1 bg-background">
          <View className="flex-row items-center justify-between border-b border-border px-4 py-2">
            <Text accessibilityRole="header" className="text-base font-t3-bold text-foreground">
              {labels.title}
            </Text>
            <ActionButton label={labels.close} onPress={() => setFullscreen(false)} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            {metadata}
            <View className="flex-row flex-wrap gap-2">
              <ActionButton
                label={labels.zoomIn}
                disabled={!interactiveReady}
                onPress={() => runtime.current?.view("zoom-in")}
              />
              <ActionButton
                label={labels.zoomOut}
                disabled={!interactiveReady}
                onPress={() => runtime.current?.view("zoom-out")}
              />
              <ActionButton
                label={labels.fit}
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
              <ActionButton
                label={labels.exportPng}
                disabled={!interactiveReady}
                onPress={() => runtime.current?.exportPng()}
              />
            </View>
            <View
              accessibilityLabel={document?.metadata.summary ?? labels.interactive}
              style={{ height: Math.max(260, height * 0.55) }}
            >
              {fullscreen && interactiveRequest ? (
                <VisualizationRuntime
                  ref={runtime}
                  request={interactiveRequest}
                  onResult={() => setReadyRequestId(interactiveRequest.requestId)}
                  onError={(error) => Alert.alert(labels.renderError, error)}
                  onPng={(dataUrl) => exportFile(dataUrl, "png")}
                  onSvg={(svg) => exportFile(svg, "svg")}
                />
              ) : null}
            </View>
            {toolbar}
            {showSource ? source : null}
            {tables}
            {actions}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
