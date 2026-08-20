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
    <NumberField
      aria-label={ariaLabel}
      className="w-28 gap-0"
      max={MAX_PROJECT_THREAD_PREVIEW_COUNT}
      min={MIN_PROJECT_THREAD_PREVIEW_COUNT}
      onValueChange={(nextValue) => {
        if (nextValue === null) return;
        const nextCount = clampProjectThreadPreviewCount(nextValue);
        if (nextCount !== count) onChange(nextCount);
      }}
      size="sm"
      step={1}
      value={count}
    >
      <NumberFieldGroup className="h-7 rounded-md sm:h-6.5">
        <NumberFieldDecrement
          aria-label={`Decrease ${ariaLabel.toLocaleLowerCase()}`}
          className="px-2 sm:px-2 [&_svg]:size-3.5"
        />
        <NumberFieldInput
          aria-label={ariaLabel}
          className="h-7 w-9 grow-0 px-0 text-xs leading-7 sm:h-6.5 sm:leading-6.5"
          inputMode="numeric"
          onKeyDownCapture={(event) => event.stopPropagation()}
        />
        <NumberFieldIncrement
          aria-label={`Increase ${ariaLabel.toLocaleLowerCase()}`}
          className="px-2 sm:px-2 [&_svg]:size-3.5"
        />
      </NumberFieldGroup>
    </NumberField>
  );
}
