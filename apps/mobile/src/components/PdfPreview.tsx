import { useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";

import { FilePreviewLoading, FilePreviewNotice } from "../features/files/FilePreviewFeedback";
import { useMobileInterfaceTranslator } from "../localization/useMobileInterfaceTranslator";

export function PdfPreview(props: { readonly uri: string }) {
  const translator = useMobileInterfaceTranslator();
  const [error, setError] = useState<string | null>(null);
  return (
    <View className="flex-1 bg-card">
      {error ? (
        <FilePreviewNotice title={translator.message("mobile.ui.couldNotLoadPdf")}>
          {error}
        </FilePreviewNotice>
      ) : null}
      <WebView
        source={{ uri: props.uri }}
        originWhitelist={["*"]}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        startInLoadingState
        onError={(event) =>
          setError(
            event.nativeEvent.description || translator.message("mobile.ui.thePdfCouldNotBeLoaded"),
          )
        }
        onHttpError={(event) =>
          setError(`The server returned HTTP ${event.nativeEvent.statusCode}.`)
        }
        renderLoading={() => (
          <FilePreviewLoading
            message={translator.message("mobile.ui.loadingPdf")}
            background="card"
          />
        )}
        style={{ flex: 1, backgroundColor: "transparent" }}
      />
    </View>
  );
}
