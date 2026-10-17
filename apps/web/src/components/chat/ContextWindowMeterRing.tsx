const RING_RADIUS = 8.5;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function contextWindowUsageColor(percentage: number): string {
  return percentage > 90
    ? "var(--color-error)"
    : "color-mix(in oklab, var(--color-muted-foreground) 72%, transparent)";
}

export function ContextWindowMeterRing({ percentage }: { readonly percentage: number | null }) {
  const normalizedPercentage = Math.max(0, Math.min(100, percentage ?? 0));
  const dashOffset = RING_CIRCUMFERENCE * (1 - normalizedPercentage / 100);

  return (
    <span aria-hidden="true" className="relative flex size-5 items-center justify-center">
      <svg viewBox="0 0 20 20" className="absolute inset-0 size-full -rotate-90">
        <circle
          cx="10"
          cy="10"
          r={RING_RADIUS}
          fill="none"
          className="stroke-muted-foreground/24"
          strokeWidth="3"
        />
        {normalizedPercentage > 0 ? (
          <circle
            cx="10"
            cy="10"
            r={RING_RADIUS}
            fill="none"
            stroke={contextWindowUsageColor(normalizedPercentage)}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
          />
        ) : null}
      </svg>
      {percentage === null ? <span className="text-3xs leading-none">–</span> : null}
    </span>
  );
}
