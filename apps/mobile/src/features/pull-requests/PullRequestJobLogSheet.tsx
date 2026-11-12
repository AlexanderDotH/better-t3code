import type { PullRequestCheck } from "@t3tools/contracts";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { AppState, Linking, Modal, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { composerPullRequests } from "../../state/pull-requests";
import { useEnvironmentQuery } from "../../state/query";
import { checkStatus } from "./pullRequestStatus";
import { pullRequestTarget, type PullRequestParams } from "./usePullRequestDiff";
import { usePullRequestConnected } from "./usePullRequestConnected";

const LOG_REFRESH_MS = 5_000;
const LOG_RETRY_MS = 15_000;

export function PullRequestJobLogSheet(props: {
  readonly params: PullRequestParams;
  readonly check: PullRequestCheck;
  readonly onClose: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const target = pullRequestTarget(props.params);
  const connected = usePullRequestConnected(target.environmentId);
  const query = useEnvironmentQuery(
    connected && props.check.logId !== undefined
      ? composerPullRequests.checkLog({
          ...target,
          input: { ...target.input, checkId: props.check.logId },
        })
      : null,
  );
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const [following, setFollowing] = useState(true);
  const check = query.data?.check ?? props.check;
  const providerUrl = check.url;
  const text = query.data?.text ?? "";
  const complete = query.data?.complete === true;
  const refresh = query.refresh;
  const interval = query.error === null ? LOG_REFRESH_MS : LOG_RETRY_MS;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refreshes a running job only while the app is active and disposes its timer and AppState subscription
  useEffect(() => {
    if (!connected || complete || query.isPending || props.check.logId === undefined) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const schedule = () => {
      clearInterval(timer);
      if (AppState.currentState === "active") timer = setInterval(refresh, interval);
    };
    schedule();
    const subscription = AppState.addEventListener("change", schedule);
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [complete, connected, interval, props.check.logId, query.isPending, refresh]);
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={props.onClose}
    >
      <View
        className="flex-1 bg-sheet-solid"
        style={{
          paddingTop: Platform.OS === "android" ? insets.top : 0,
          paddingBottom: insets.bottom,
        }}
      >
        <SheetHeader
          presentation="inline"
          title={check.name}
          subtitle={checkStatus(check).label}
          onClose={props.onClose}
        />
        {query.error ? (
          <Text accessibilityRole="alert" className="px-4 py-2 text-sm text-danger-foreground">
            {query.error}
          </Text>
        ) : null}
        {query.data?.truncated ? (
          <Text className="px-4 py-2 text-xs text-foreground-muted">
            {translator.message("mobile.pulls.logs.truncated")}
          </Text>
        ) : null}
        <ScrollView
          ref={scroll}
          className="flex-1"
          contentContainerStyle={{ padding: 16 }}
          onContentSizeChange={() => {
            if (following) scroll.current?.scrollToEnd({ animated: false });
          }}
          onScroll={({ nativeEvent }) =>
            setFollowing(
              nativeEvent.contentSize.height -
                nativeEvent.contentOffset.y -
                nativeEvent.layoutMeasurement.height <
                48,
            )
          }
          scrollEventThrottle={100}
        >
          <Text selectable className="font-mono text-xs leading-5">
            {text ||
              translator.message(
                query.isPending
                  ? "mobile.pulls.logs.loading"
                  : !connected
                    ? "mobile.ui.environmentOffline"
                    : complete
                      ? "mobile.pulls.logs.empty"
                      : "mobile.pulls.logs.waiting",
              )}
          </Text>
        </ScrollView>
        <View className="flex-row flex-wrap items-center gap-2 border-t border-border-subtle px-4 py-3">
          <Text className="text-xs text-foreground-muted">
            {translator.message(
              !connected
                ? "mobile.ui.environmentOffline"
                : query.error
                  ? "mobile.pulls.logs.retrying"
                  : complete
                    ? "mobile.pulls.logs.finished"
                    : "mobile.pulls.logs.live",
            )}
          </Text>
          <Button
            tone="text"
            label={translator.message(
              following ? "mobile.pulls.logs.pause" : "mobile.pulls.logs.follow",
            )}
            onPress={() => {
              setFollowing(!following);
              if (!following) scroll.current?.scrollToEnd({ animated: false });
            }}
          />
          <Button
            tone="text"
            label={translator.message("mobile.files.refreshAction")}
            disabled={query.isPending || !connected}
            onPress={refresh}
          />
          {providerUrl ? (
            <Button
              tone="text"
              label={translator.message("mobile.ui.openChecksOnProvider")}
              onPress={() => void Linking.openURL(providerUrl)}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
