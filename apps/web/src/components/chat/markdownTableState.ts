import { LRUCache } from "../../lib/lruCache";

export const MARKDOWN_TABLE_STATE_STORAGE_KEY = "t3code:markdown-table-state:v1";
const MAX_REMEMBERED_MARKDOWN_TABLES = 1000;
const MARKDOWN_TABLE_STATE_STORAGE_BYTES = 1024 * 1024;

interface MarkdownTableState {
  readonly expanded: boolean;
  readonly width: number | null;
}

function isMarkdownTableState(value: unknown): value is MarkdownTableState {
  return (
    value !== null &&
    typeof value === "object" &&
    "expanded" in value &&
    typeof value.expanded === "boolean" &&
    "width" in value &&
    (value.width === null ||
      (typeof value.width === "number" && Number.isFinite(value.width) && value.width > 0))
  );
}

export function createMarkdownTableStateStore(
  resolveStorage: () => Pick<Storage, "getItem" | "setItem"> | undefined = () =>
    typeof window === "undefined" ? undefined : window.localStorage,
) {
  const cache = new LRUCache<MarkdownTableState>(
    MAX_REMEMBERED_MARKDOWN_TABLES,
    MARKDOWN_TABLE_STATE_STORAGE_BYTES - 4,
  );
  let loaded = false;

  const remember = (key: string, state: MarkdownTableState) => {
    // Include the tuple and comma in the UTF-16 budget; the outer brackets use four bytes.
    cache.set(key, state, (JSON.stringify([key, state]).length + 1) * 2);
  };

  const load = () => {
    if (loaded) return;
    loaded = true;
    try {
      const raw = resolveStorage()?.getItem(MARKDOWN_TABLE_STATE_STORAGE_KEY);
      if (!raw || raw.length * 2 > MARKDOWN_TABLE_STATE_STORAGE_BYTES) return;
      const entries: unknown = JSON.parse(raw);
      if (!Array.isArray(entries)) return;
      for (const entry of entries) {
        if (
          !Array.isArray(entry) ||
          entry.length !== 2 ||
          typeof entry[0] !== "string" ||
          entry[0].length === 0 ||
          !isMarkdownTableState(entry[1])
        ) {
          continue;
        }
        remember(entry[0], { expanded: entry[1].expanded, width: entry[1].width });
      }
    } catch {
      // Unavailable or corrupt browser storage must not prevent reading the chat.
    }
  };

  return {
    get(key: string) {
      load();
      return cache.get(key);
    },
    set(key: string, state: MarkdownTableState) {
      load();
      remember(key, state);
      try {
        resolveStorage()?.setItem(
          MARKDOWN_TABLE_STATE_STORAGE_KEY,
          JSON.stringify(cache.entries()),
        );
      } catch {
        // Keep the current session usable when browser storage is blocked or full.
      }
    },
  };
}

export const markdownTableStateStore = createMarkdownTableStateStore();
