import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { AsyncResult } from "effect/unstable/reactivity";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Linking, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { ErrorBanner } from "../../components/ErrorBanner";
import { pairingOnboardingProgressAtom } from "../../connection/onboarding";
import { useThemeColor } from "../../lib/useThemeColor";
import { NativeHeaderToolbar, NativeStackScreenOptions } from "../../native/StackHeader";
import { useRemoteConnections } from "../../state/use-remote-environment-registry";
import { ConnectionSheetButton } from "./ConnectionSheetButton";
import {
  buildPairingUrl,
  describePairingDestination,
  extractPairingUrlFromQrPayload,
  pairingFailureMessage,
  pairingStageLabel,
  parsePairingUrl,
  resolvePairingRouteIntent,
  type PairingDestinationReview,
} from "./pairing";

type ConnectionsNewRouteParams = {
  readonly mode?: string;
  readonly pairingUrl?: string;
  readonly autoConnect?: string;
};

type PairingFlowStep = "choose" | "manual" | "review";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function ConnectionsNewRouteScreen({
  route,
}: StaticScreenProps<ConnectionsNewRouteParams | undefined>) {
  const {
    connectionPairingUrl,
    onChangeConnectionPairingUrl,
    onConnectPress,
    pairingConnectionError,
  } = useRemoteConnections();
  const pairingProgress = useAtomValue(pairingOnboardingProgressAtom);
  const navigation = useNavigation();
  const params = route.params ?? {};
  const { pairingUrl: routePairingUrl, shouldAutoConnect } = resolvePairingRouteIntent(
    params,
    __DEV__,
  );
  const insets = useSafeAreaInsets();
  const [flowStep, setFlowStep] = useState<PairingFlowStep>("choose");
  const [hostInput, setHostInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [reviewPairingUrl, setReviewPairingUrl] = useState("");
  const [destinationReview, setDestinationReview] = useState<PairingDestinationReview | null>(null);
  const [submittedPairingUrl, setSubmittedPairingUrl] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showScanner, setShowScanner] = useState(params.mode === "scan_qr");
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [scannerLocked, setScannerLocked] = useState(false);
  const attemptedAutoConnectRef = useRef<string | null>(null);

  const headerIconColor = useThemeColor("--color-icon");
  const activePairingStage = pairingProgress?.stage ?? "validating";
  const connectDisabled =
    isSubmitting || reviewPairingUrl.length === 0 || destinationReview === null;

  const preparePairingRequestForReview = useCallback(
    (pairingUrl: string) => {
      const { host, code } = parsePairingUrl(pairingUrl);
      const normalizedPairingUrl = buildPairingUrl(host, code);
      const review = describePairingDestination(normalizedPairingUrl);
      setHostInput(host);
      setCodeInput(code);
      setReviewPairingUrl(normalizedPairingUrl);
      setDestinationReview(review);
      setSubmittedPairingUrl("");
      setInputError(null);
      setFlowStep("review");
      onChangeConnectionPairingUrl(normalizedPairingUrl);
    },
    [onChangeConnectionPairingUrl],
  );

  useEffect(() => {
    if (routePairingUrl.length > 0 || connectionPairingUrl.length === 0) {
      return;
    }

    try {
      preparePairingRequestForReview(connectionPairingUrl);
    } catch (error) {
      const { host, code } = parsePairingUrl(connectionPairingUrl);
      setHostInput(host);
      setCodeInput(code);
      setInputError(errorMessage(error, "The saved pairing details are invalid."));
      setFlowStep("manual");
    }
  }, [connectionPairingUrl, preparePairingRequestForReview, routePairingUrl]);

  useEffect(() => {
    if (routePairingUrl.length === 0) {
      return;
    }

    try {
      preparePairingRequestForReview(routePairingUrl);
    } catch (error) {
      const { host, code } = parsePairingUrl(routePairingUrl);
      setHostInput(host);
      setCodeInput(code);
      setInputError(errorMessage(error, "The pairing link is invalid."));
      setFlowStep("manual");
    }
  }, [preparePairingRequestForReview, routePairingUrl]);

  useEffect(() => {
    if (pairingConnectionError) {
      setIsSubmitting(false);
    }
  }, [pairingConnectionError]);

  const handleHostChange = useCallback((value: string) => {
    setHostInput(value);
    setInputError(null);
  }, []);

  const handleCodeChange = useCallback((value: string) => {
    setCodeInput(value);
    setInputError(null);
  }, []);

  const openScanner = useCallback(async () => {
    if (cameraPermission?.granted) {
      setScannerLocked(false);
      setShowScanner(true);
      return;
    }

    const permission = await requestCameraPermission();
    if (permission.granted) {
      setScannerLocked(false);
      setShowScanner(true);
      return;
    }

    if (permission.canAskAgain) {
      Alert.alert(
        "Camera access needed",
        "Allow camera access to scan an environment pairing QR code.",
      );
      return;
    }

    Alert.alert(
      "Camera access needed",
      "Camera access was denied for this app. Open Settings to enable it.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Open Settings", onPress: () => void Linking.openSettings() },
      ],
    );
  }, [cameraPermission?.granted, requestCameraPermission]);

  const closeScanner = useCallback(() => {
    setShowScanner(false);
    setScannerLocked(false);
  }, []);

  const handleQrScan = useCallback(
    ({ data }: { readonly data: string }) => {
      if (scannerLocked) {
        return;
      }

      setScannerLocked(true);
      try {
        preparePairingRequestForReview(extractPairingUrlFromQrPayload(data));
        setShowScanner(false);
      } catch (error) {
        Alert.alert(
          "Invalid QR code",
          errorMessage(error, "Scanned QR code was not recognized."),
          [{ text: "Try again", onPress: () => setScannerLocked(false) }],
          { cancelable: false },
        );
      }
    },
    [preparePairingRequestForReview, scannerLocked],
  );

  const handlePastePairingLink = useCallback(async () => {
    try {
      const pairingUrl = await Clipboard.getStringAsync();
      preparePairingRequestForReview(pairingUrl);
    } catch (error) {
      Alert.alert(
        "Pairing link not recognized",
        errorMessage(error, "Copy a complete pairing link and try again."),
      );
    }
  }, [preparePairingRequestForReview]);

  const connectAndClose = useCallback(
    async (pairingUrl: string, replaceWithHome: boolean) => {
      setSubmittedPairingUrl(pairingUrl);
      setIsSubmitting(true);
      onChangeConnectionPairingUrl(pairingUrl);
      try {
        const result = await onConnectPress(pairingUrl);
        if (AsyncResult.isSuccess(result)) {
          if (replaceWithHome || !navigation.canGoBack()) {
            navigation.dispatch(StackActions.replace("Home"));
          } else {
            navigation.goBack();
          }
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [navigation, onChangeConnectionPairingUrl, onConnectPress],
  );

  const handleManualReview = useCallback(() => {
    try {
      preparePairingRequestForReview(buildPairingUrl(hostInput, codeInput));
    } catch (error) {
      setInputError(errorMessage(error, "Check the host and pairing code."));
    }
  }, [codeInput, hostInput, preparePairingRequestForReview]);

  const handleSubmit = useCallback(async () => {
    if (reviewPairingUrl.length === 0) {
      return;
    }
    await connectAndClose(reviewPairingUrl, false);
  }, [connectAndClose, reviewPairingUrl]);

  useEffect(() => {
    if (!shouldAutoConnect || attemptedAutoConnectRef.current === routePairingUrl) {
      return;
    }

    attemptedAutoConnectRef.current = routePairingUrl;
    void connectAndClose(routePairingUrl, true);
  }, [connectAndClose, routePairingUrl, shouldAutoConnect]);

  const pairingErrorMessage =
    pairingConnectionError && submittedPairingUrl === reviewPairingUrl
      ? pairingFailureMessage(activePairingStage, pairingConnectionError)
      : null;

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <NativeStackScreenOptions
        options={{
          ...(Platform.OS === "android" ? { headerShown: false } : null),
          title: showScanner ? "Scan QR Code" : "Add Environment",
        }}
      />
      {Platform.OS === "android" ? (
        <AndroidScreenHeader
          title={showScanner ? "Scan QR Code" : "Add Environment"}
          onBack={() => navigation.goBack()}
          actions={[
            {
              accessibilityLabel: showScanner ? "Close scanner" : "Scan QR code",
              icon: showScanner ? "xmark" : "camera",
              onPress: () => {
                if (showScanner) {
                  closeScanner();
                } else {
                  void openScanner();
                }
              },
            },
          ]}
        />
      ) : (
        <NativeHeaderToolbar placement="right">
          <NativeHeaderToolbar.Button
            icon={showScanner ? "xmark" : "qrcode.viewfinder"}
            onPress={() => {
              if (showScanner) {
                closeScanner();
              } else {
                void openScanner();
              }
            }}
            separateBackground
            tintColor={headerIconColor}
          />
        </NativeHeaderToolbar>
      )}

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentInset={{ bottom: Math.max(insets.bottom, 18) + 18 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16 }}
      >
        <View collapsable={false} className="gap-5">
          {showScanner ? (
            cameraPermission?.granted ? (
              <View className="overflow-hidden rounded-[24px] border-continuous">
                <CameraView
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                  onBarcodeScanned={handleQrScan}
                  style={{ aspectRatio: 1, width: "100%" }}
                />
              </View>
            ) : (
              <View className="items-center gap-3 rounded-[24px] border-continuous bg-card px-5 py-8">
                <Text className="text-center text-sm leading-normal text-foreground-muted">
                  Camera permission is required to scan a QR code.
                </Text>
                <ConnectionSheetButton
                  compact
                  icon="camera"
                  label="Allow camera"
                  tone="secondary"
                  onPress={() => {
                    void openScanner();
                  }}
                />
              </View>
            )
          ) : flowStep === "choose" ? (
            <View collapsable={false} className="gap-4">
              <View className="gap-1 px-1">
                <Text className="font-t3-semibold text-lg text-foreground">
                  Connect to your T3 Code host
                </Text>
                <Text className="text-sm leading-normal text-foreground-muted">
                  Scan the pairing QR code from your host, paste its pairing link, or enter the
                  details manually.
                </Text>
              </View>
              <View className="gap-3 rounded-[24px] bg-card p-4">
                <ConnectionSheetButton
                  icon="camera"
                  label="Scan QR code"
                  tone="primary"
                  onPress={() => {
                    void openScanner();
                  }}
                />
                <ConnectionSheetButton
                  icon="link"
                  label="Paste pairing link"
                  onPress={() => {
                    void handlePastePairingLink();
                  }}
                />
                <ConnectionSheetButton
                  icon="keyboard"
                  label="Enter manually"
                  onPress={() => setFlowStep("manual")}
                />
              </View>
            </View>
          ) : flowStep === "manual" ? (
            <View collapsable={false} className="gap-4 rounded-[24px] bg-card p-4">
              <View collapsable={false} className="gap-1.5">
                <Text className="text-2xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
                  Host
                </Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  placeholder="192.168.1.100:8080"
                  value={hostInput}
                  onChangeText={handleHostChange}
                  className="rounded-[14px] border border-input-border bg-input px-4 py-3.5 text-base text-foreground"
                />
              </View>

              <View collapsable={false} className="gap-1.5">
                <Text className="text-2xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
                  Pairing code
                </Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="abc-123-xyz"
                  secureTextEntry
                  value={codeInput}
                  onChangeText={handleCodeChange}
                  className="rounded-[14px] border border-input-border bg-input px-4 py-3.5 text-base text-foreground"
                />
              </View>

              {inputError ? <ErrorBanner message={inputError} /> : null}

              <ConnectionSheetButton
                icon="arrow.right"
                label="Review environment"
                disabled={hostInput.trim().length === 0 || codeInput.trim().length === 0}
                tone="primary"
                onPress={handleManualReview}
              />
              <ConnectionSheetButton
                compact
                icon="chevron.left"
                label="Back to options"
                onPress={() => setFlowStep("choose")}
              />
            </View>
          ) : destinationReview ? (
            <View collapsable={false} className="gap-4 rounded-[24px] bg-card p-4">
              <View className="gap-1.5">
                <Text className="text-2xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
                  Destination
                </Text>
                <Text selectable className="font-t3-medium text-base text-foreground">
                  {destinationReview.destination}
                </Text>
              </View>

              <View className="gap-1.5 rounded-2xl bg-secondary px-3.5 py-3">
                <Text className="text-2xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
                  Transport
                </Text>
                <Text className="font-t3-semibold text-sm text-foreground">
                  {destinationReview.transport} · {destinationReview.transportDetail}
                </Text>
                {!destinationReview.encrypted ? (
                  <Text className="text-xs leading-normal text-foreground-muted">
                    Only continue on a network you trust. The connection is not encrypted.
                  </Text>
                ) : null}
              </View>

              <Text className="text-xs leading-normal text-foreground-muted">
                Your pairing code is hidden and will only be sent after you confirm.
              </Text>

              {pairingErrorMessage ? <ErrorBanner message={pairingErrorMessage} /> : null}

              <ConnectionSheetButton
                icon="plus"
                label={isSubmitting ? pairingStageLabel(activePairingStage) : "Pair environment"}
                disabled={connectDisabled}
                tone="primary"
                onPress={() => {
                  void handleSubmit();
                }}
              />
              <ConnectionSheetButton
                compact
                icon="pencil"
                label="Edit details"
                disabled={isSubmitting}
                onPress={() => setFlowStep("manual")}
              />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
