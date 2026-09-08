const HOME_MINUTE_TICK_MS = 60_000;

function currentMinute(): string {
  return new Date().toISOString().slice(0, 16);
}

export function startHomeFocusMinuteClock(onMinute: (minute: string) => void): () => void {
  const refresh = () => onMinute(currentMinute());
  refresh();
  const interval = setInterval(refresh, HOME_MINUTE_TICK_MS);
  return () => clearInterval(interval);
}
