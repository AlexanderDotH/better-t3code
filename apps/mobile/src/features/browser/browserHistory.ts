import { useEffect, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Schema } from "effect";
import { SerializedAsyncQueue } from "../../lib/serialized-async-queue";
import { writeFileAtomically } from "../../lib/atomic-file";

const historySchema = Schema.Array(Schema.String);
const decodeHistory = Schema.decodeUnknownSync(historySchema);
const queue = new SerializedAsyncQueue();
const MAX_RECENT_URLS = 8;
async function historyFile(environmentId: EnvironmentId) {
  const { File, Paths } = await import("expo-file-system");
  return new File(Paths.document, `browser-history-${encodeURIComponent(environmentId)}.json`);
}

export function useBrowserHistory(environmentId: EnvironmentId) {
  const [urls, setUrls] = useState<ReadonlyArray<string>>([]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads persisted browser history from native storage for this environment
  useEffect(() => {
    let active = true;
    void queue
      .run(async () => {
        const file = await historyFile(environmentId);
        const saved = file.exists ? decodeHistory(JSON.parse(await file.text())) : [];
        if (active) setUrls(saved.filter((url) => URL.canParse(url)).slice(0, MAX_RECENT_URLS));
      })
      .catch((error: unknown) => console.warn("Could not load browser history", error));
    return () => {
      active = false;
    };
  }, [environmentId]);
  const remember = (url: string) => {
    setUrls((current) =>
      [url, ...current.filter((entry) => entry !== url)].slice(0, MAX_RECENT_URLS),
    );
    void queue
      .run(async () => {
        const file = await historyFile(environmentId);
        const current = file.exists ? decodeHistory(JSON.parse(await file.text())) : [];
        await writeFileAtomically(
          file,
          JSON.stringify(
            [url, ...current.filter((entry) => entry !== url)].slice(0, MAX_RECENT_URLS),
          ),
        );
      })
      .catch((error: unknown) => console.warn("Could not save browser history", error));
  };
  return { urls, remember };
}
