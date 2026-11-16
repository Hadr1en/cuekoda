/** Leave CPU capacity for playback and the UI while processing a batch. */
export function automaticWorkerLimit(cores: number): number {
  const baseline = Math.min(4, cores - 1);
  return Math.min(cores, 8, Math.max(2, baseline, Math.floor(cores / 2)));
}

/** Null keeps the limit automatic. Existing numeric settings are manual limits. */
export function normalizeWorkerLimit(value: unknown, cores: number): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(cores, Math.round(value)))
    : null;
}
