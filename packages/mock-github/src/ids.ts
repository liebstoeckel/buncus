// Opaque, GitHub-ish global node IDs. Real GitHub IDs are base64 blobs like
// "D_kwDOABCD"; buncus treats them as opaque strings, so deterministic
// prefixed counters are faithful enough and make tests readable.

let counters: Record<string, number> = {};

export function nextId(prefix: string): string {
  counters[prefix] = (counters[prefix] ?? 0) + 1;
  return `${prefix}_mock${counters[prefix]}`;
}

/** Reset all counters — used between tests for determinism. */
export function resetIds(): void {
  counters = {};
}
