import { ProjectSourceRangeV1 } from "@t3tools/contracts";

import {
  estimateProjectIndexTokens,
  ProjectIndexContextBudgetError,
} from "./ProjectIndexContextBudget.ts";

function sourceOffsets(source: string, range: ProjectSourceRangeV1): readonly [number, number] {
  if (
    range.startOffset === undefined ||
    range.endOffset === undefined ||
    range.startOffset < 0 ||
    range.endOffset > source.length ||
    range.endOffset <= range.startOffset
  ) {
    throw new ProjectIndexContextBudgetError({
      detail: "A source unit requires a nonempty, exact UTF-16 range.",
    });
  }
  return [range.startOffset, range.endOffset];
}

function maximumFittingEnd(
  source: string,
  start: number,
  end: number,
  maximumTokens: number,
): number {
  let low = start;
  let high = Math.min(end, start + Math.max(0, maximumTokens - 2));
  while (low < high) {
    const candidate = Math.ceil((low + high) / 2);
    if (estimateProjectIndexTokens(JSON.stringify(source.slice(start, candidate))) <= maximumTokens)
      low = candidate;
    else high = candidate - 1;
  }
  if (low > start && low < source.length && /[\uDC00-\uDFFF]/.test(source[low]!)) low--;
  return low;
}

interface SourceSplitInput {
  readonly source: string;
  readonly range: ProjectSourceRangeV1;
  readonly maximumSourceTokens: number;
  readonly preferredBoundaries?: ReadonlyArray<number>;
}

function sourceRangeLocator(source: string) {
  const starts = [0];
  for (let index = 0; index < source.length; index++)
    if (source[index] === "\n") starts.push(index + 1);
  const position = (offset: number) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (starts[middle]! <= offset) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: offset - starts[low]! + 1 };
  };
  return (startOffset: number, endOffset: number): ProjectSourceRangeV1 => {
    const start = position(startOffset);
    const end = position(endOffset);
    return {
      startLine: start.line,
      startColumn: start.column,
      endLine: end.line,
      endColumn: end.column,
      startOffset,
      endOffset,
    };
  };
}

function splitSourceRange(
  input: SourceSplitInput,
  locate: ReturnType<typeof sourceRangeLocator>,
): ReadonlyArray<ProjectSourceRangeV1> {
  const [startOffset, endOffset] = sourceOffsets(input.source, input.range);
  const ranges: Array<ProjectSourceRangeV1> = [];
  let start = startOffset;
  while (start < endOffset) {
    const fittingEnd = maximumFittingEnd(input.source, start, endOffset, input.maximumSourceTokens);
    if (fittingEnd <= start) {
      throw new ProjectIndexContextBudgetError({
        detail: "The selected model has no capacity left for source after the request metadata.",
      });
    }
    let end = fittingEnd;
    if (end < endOffset) {
      const boundary = input.preferredBoundaries?.findLast(
        (offset) => offset > start && offset <= end,
      );
      const lineEnd = input.source.lastIndexOf("\n", end - 1) + 1;
      end = boundary ?? (lineEnd > start ? lineEnd : end);
    }
    ranges.push(locate(start, end));
    start = end;
  }
  return ranges;
}

export function splitProjectIndexSourceRange(
  input: SourceSplitInput,
): ReadonlyArray<ProjectSourceRangeV1> {
  return splitSourceRange(input, sourceRangeLocator(input.source));
}
