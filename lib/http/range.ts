export type ParsedRange = { start: number; length: number };
export type RangeResult = ParsedRange | "unsatisfiable" | null;

/**
 * Parsed here rather than handed to R2, which clamps an out-of-range request
 * into a valid one instead of rejecting it. `null` means serve the whole object
 * as a 200; a 206 is only ever a legal answer to a request that asked for one.
 */
export function parseRangeHeader(header: string | null, size: number): RangeResult {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  // Anything else, including multi-range, is served whole.
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;
  if (size <= 0) return "unsatisfiable";

  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return "unsatisfiable";
    const length = Math.min(suffix, size);
    return { start: size - length, length };
  }

  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= size) return "unsatisfiable";

  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isFinite(end) || end < start) return "unsatisfiable";
  return { start, length: end - start + 1 };
}
