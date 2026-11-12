export function mobileNotificationDelivery(input: {
  readonly foreground: boolean;
  readonly onScreen: boolean;
  readonly inAppEnabled: boolean;
  readonly cloudPush: boolean;
  readonly suppressed: boolean;
}) {
  if (input.suppressed || (input.foreground && input.onScreen))
    return { toast: false, local: false };
  return {
    toast: input.foreground && input.inAppEnabled,
    local: !input.foreground && !input.cloudPush,
  };
}

export function mobileNotificationBadgeCount(
  states: readonly {
    readonly key: string;
    readonly attention: boolean;
    readonly unread: boolean;
    readonly hidden: boolean;
  }[],
  onScreen: string | null,
) {
  return new Set(
    states
      .filter(
        (state) => !state.hidden && state.key !== onScreen && (state.attention || state.unread),
      )
      .map((state) => state.key),
  ).size;
}
