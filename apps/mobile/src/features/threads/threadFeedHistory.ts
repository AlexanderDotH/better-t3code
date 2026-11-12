export interface ThreadFeedHistoryControls {
  readonly hasMoreHistory: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onLoadEarlier: () => void;
  /** Loads earlier history down to the entry, in one request. */
  readonly onLoadThrough: (entryId: string) => void;
}
