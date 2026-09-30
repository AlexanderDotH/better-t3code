import {
  MAX_PROJECT_THREAD_PREVIEW_COUNT,
  MIN_PROJECT_THREAD_PREVIEW_COUNT,
  type ProjectThreadPreviewCount,
} from "@t3tools/contracts";

import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "./ui/number-field";

function clampProjectThreadPreviewCount(value: number): ProjectThreadPreviewCount {
  return Math.min(
    MAX_PROJECT_THREAD_PREVIEW_COUNT,
    Math.max(MIN_PROJECT_THREAD_PREVIEW_COUNT, value),
  ) as ProjectThreadPreviewCount;
}

export function ProjectThreadPreviewCountControl({
  ariaLabel,
  count,
  onChange,
}: {
  readonly ariaLabel: string;
  readonly count: ProjectThreadPreviewCount;
  readonly onChange: (count: ProjectThreadPreviewCount) => void;
}) {
  return (
    <div className="w-28">
      <NumberField
        aria-label={ariaLabel}
        max={MAX_PROJECT_THREAD_PREVIEW_COUNT}
        min={MIN_PROJECT_THREAD_PREVIEW_COUNT}
        onValueChange={(nextValue) => {
          if (nextValue === null) return;
          const nextCount = clampProjectThreadPreviewCount(nextValue);
          if (nextCount !== count) onChange(nextCount);
        }}
        size="xs"
        step={1}
        value={count}
      >
        <NumberFieldGroup>
          <NumberFieldDecrement aria-label={`Decrease ${ariaLabel.toLocaleLowerCase()}`} />
          <NumberFieldInput
            aria-label={ariaLabel}
            className="w-9 grow-0"
            inputMode="numeric"
            onKeyDownCapture={(event) => event.stopPropagation()}
          />
          <NumberFieldIncrement aria-label={`Increase ${ariaLabel.toLocaleLowerCase()}`} />
        </NumberFieldGroup>
      </NumberField>
    </div>
  );
}
