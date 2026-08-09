export function createLocalStorageEffect<T>(
  connectionId: number,
  entries: Array<{ key: string; value: unknown; serialize?: (v: unknown) => string }>,
) {
  if (typeof window === "undefined" || !window.localStorage) return;
  const restoreKey = "rexa-db-restore-state-" + connectionId;
  const shouldRestore = window.localStorage.getItem(restoreKey) !== "0";
  for (const entry of entries) {
    if (shouldRestore) {
      const serialized = entry.serialize ? entry.serialize(entry.value) : JSON.stringify(entry.value);
      window.localStorage.setItem(entry.key, serialized);
    } else {
      window.localStorage.removeItem(entry.key);
    }
  }
}
