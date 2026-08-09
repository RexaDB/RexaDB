import { useEffect, useCallback } from "react";

export function useLocalStoragePersistence<T>(
  key: string,
  value: T,
  connectionId: number,
  serialize: (v: T) => string = JSON.stringify,
) {
  useEffect(() => {
    if (typeof window === "undefined" || !window.localStorage) return;
    const restoreKey = "rexa-db-restore-state-" + connectionId;
    const shouldRestore = window.localStorage.getItem(restoreKey) !== "0";
    if (shouldRestore) {
      window.localStorage.setItem(key, serialize(value));
    } else {
      window.localStorage.removeItem(key);
    }
  }, [value, connectionId, key, serialize]);
}

export function useDelayedUpdate<T>(
  setter: (value: T) => void,
  delayedRef: React.MutableRefObject<boolean>,
): (value: T) => void {
  return useCallback(
    (nextValue: T) => {
      delayedRef.current = true;
      setter(nextValue);
    },
    [setter, delayedRef],
  );
}
