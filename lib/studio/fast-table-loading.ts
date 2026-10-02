export const DEFAULT_FAST_TABLE_LOADING = true;
export const FAST_TABLE_LOADING_DEFAULT_MIGRATION_KEY = "fastTableLoadingDefaultMigrated";

export function resolveFastTableLoading(settings: Record<string, unknown>): boolean {
  // Pre-migration false was the old default. Override it once, then preserve new choices.
  return settings[FAST_TABLE_LOADING_DEFAULT_MIGRATION_KEY] === true
    ? settings.fastTableLoading !== false
    : DEFAULT_FAST_TABLE_LOADING;
}

export function migrateFastTableLoading(settings: Record<string, unknown>): Record<string, unknown> {
  return {
    ...settings,
    fastTableLoading: resolveFastTableLoading(settings),
    [FAST_TABLE_LOADING_DEFAULT_MIGRATION_KEY]: true,
  };
}

export async function waitForTableCount(
  fastMode: boolean,
  count: Promise<number | null>,
  onCount: (value: number | null) => void,
): Promise<void> {
  if (fastMode) {
    void count.then(onCount);
    return;
  }
  onCount(await count);
}
