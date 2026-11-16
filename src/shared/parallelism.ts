const GIB = 1024 ** 3;

/** Leave capacity for playback and budget roughly 1 GiB of RAM per analysis worker. */
export function automaticWorkerLimit(cores: number, memoryBytes: number): number {
  const cpuLimit = Math.ceil(cores * 2 / 3);
  const reservedMemory = Math.max(2 * GIB, memoryBytes / 4);
  const memoryLimit = Math.max(1, Math.floor((memoryBytes - reservedMemory) / GIB));
  return Math.min(cpuLimit, memoryLimit, 12);
}

/** Older versions saved the computed default as a number, even without a manual change. */
export function restoreWorkerLimit(value: unknown, cores: number, legacyDefault?: number): number | null {
  return value === legacyDefault ? null : normalizeWorkerLimit(value, cores);
}

/** Null keeps the limit automatic. Existing numeric settings are manual limits. */
export function normalizeWorkerLimit(value: unknown, cores: number): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(cores, Math.round(value)))
    : null;
}
