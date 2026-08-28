// Shared, synchronous source of truth for the user's layout preference (New
// Layout / Modern UI). Read by components/gates/app-boot-skeleton.tsx on
// boot (before the authoritative settings load from disk) and by every
// `useGlobalStudioSettings` instance via `useSyncExternalStore`.
//
// A page can have many concurrent `useGlobalStudioSettings` instances (the
// studio's own, the zoom wrapper, assorted sheets/panels each pulling one
// unrelated field) — every one of them used to carry its own independent
// `useState` for these two flags, kept "in sync" by broadcasting a
// CustomEvent on change. With a dozen+ instances all listening and
// rebroadcasting each other's updates, a toggle could race: one instance's
// stale rebroadcast would land after another's fresh write and silently
// revert it, so a change would appear to do nothing. A single external
// store with one canonical value sidesteps that entirely — there is no
// "other instance" to race against.
//
// Both flags live under one key, written together in a single call. Two
// separate keys (written by two separate effects) left a window where one
// key could be updated and the other not yet — a reader in that window
// would combine a fresh flag with a stale one and could land on a
// combination the user never actually chose (e.g. both "New Layout" and
// "Modern UI" true, or both false), which is what made the boot skeleton
// pick the wrong chrome intermittently. A single JSON blob, written and
// read in one shot, can't be observed half-updated.
const LAYOUT_PREFS_STORAGE_KEY = "rexa-db-layout-prefs";

export type LayoutPrefs = {
  appShellLayout: boolean;
  modernUiLayout: boolean;
};

export const DEFAULT_LAYOUT_PREFS: LayoutPrefs = {
  appShellLayout: false,
  modernUiLayout: true,
};

/**
 * "New Layout" and "Modern UI" are mutually exclusive shells — if both ever
 * end up true (stale data from before this was enforced, a corrupt cache
 * entry, etc.), Modern UI wins since it's the more specific of the two.
 */
export function normalizeLayoutPrefs(prefs: LayoutPrefs): LayoutPrefs {
  if (prefs.appShellLayout && prefs.modernUiLayout) {
    return { appShellLayout: false, modernUiLayout: true };
  }
  return prefs;
}

function readRawCachedLayoutPrefs(raw: string | null): LayoutPrefs {
  if (!raw) return DEFAULT_LAYOUT_PREFS;
  try {
    const parsed = JSON.parse(raw);
    return normalizeLayoutPrefs({
      appShellLayout:
        typeof parsed?.appShellLayout === "boolean"
          ? parsed.appShellLayout
          : DEFAULT_LAYOUT_PREFS.appShellLayout,
      modernUiLayout:
        typeof parsed?.modernUiLayout === "boolean"
          ? parsed.modernUiLayout
          : DEFAULT_LAYOUT_PREFS.modernUiLayout,
    });
  } catch {
    return DEFAULT_LAYOUT_PREFS;
  }
}

/** One-off synchronous read — for call sites that just need a snapshot once (e.g. the boot skeleton), not live updates. */
export function readCachedLayoutPrefs(): LayoutPrefs {
  return currentLayoutPrefs;
}

type Listener = () => void;

const initialRaw = typeof window === "undefined" ? null : window.localStorage.getItem(LAYOUT_PREFS_STORAGE_KEY);
let currentLayoutPrefs: LayoutPrefs = readRawCachedLayoutPrefs(initialRaw);
// Whether THIS device/profile has ever saved a layout choice before. A fresh
// install has none, so the very first DB load is allowed to seed the store
// (see `hydrateLayoutPrefsFromDb`). Once anything exists here, localStorage
// — written synchronously by every `setLayoutPrefs` call — is always at
// least as fresh as a DB round trip, permanently: a page/route boundary can
// give this module a brand new instance with `hydratedFromDb` reset to
// `false` (e.g. Next.js's per-route bundles, or a hard navigation), and
// without this check that fresh instance would treat the DB's still-in-transit
// or already-stale value as authoritative and stomp the real, current one —
// which is exactly what made a layout toggle silently revert the moment you
// navigated away right after changing it.
const hasExistingLocalCache = initialRaw !== null;
const listeners = new Set<Listener>();

function persist(prefs: LayoutPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAYOUT_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

/** Current value, synchronously — the `getSnapshot` half of `useSyncExternalStore`. */
export function getLayoutPrefsSnapshot(): LayoutPrefs {
  return currentLayoutPrefs;
}

/** Subscribe to changes — the `subscribe` half of `useSyncExternalStore`. */
export function subscribeToLayoutPrefs(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The one place layout prefs are ever written. Updates the canonical value,
 * persists it, and notifies every subscribed component synchronously — no
 * events, no per-instance state to fall out of sync.
 */
export function setLayoutPrefs(next: LayoutPrefs): void {
  const normalized = normalizeLayoutPrefs(next);
  if (
    normalized.appShellLayout === currentLayoutPrefs.appShellLayout &&
    normalized.modernUiLayout === currentLayoutPrefs.modernUiLayout
  ) {
    return;
  }
  currentLayoutPrefs = normalized;
  persist(normalized);
  listeners.forEach((listener) => listener());
}

let hydratedThisSession = false;

/**
 * Every `useGlobalStudioSettings` instance loads the authoritative settings
 * from disk once on mount (an async round trip) and offers them here.
 * Switching layouts remounts a lot of the studio's own tree (the content
 * under the shell wrapper unavoidably remounts when the wrapper itself
 * changes type), so a fresh batch of instances mount and kick off their own
 * loads *because of* the very toggle that just fired.
 *
 * Two separate guards, for two separate ways the DB can be stale:
 *  - `hasExistingLocalCache`: this device already had a cached preference
 *    before this session even started, so the DB — an async round trip that
 *    may still be in flight or simply behind a very recent local change —
 *    is never more authoritative here, no matter the timing. Only a
 *    device/profile with no local cache at all (a fresh install) lets the
 *    DB seed the very first value.
 *  - `hydratedThisSession`: even on that fresh-install path, only the FIRST
 *    of the many instances that load in the same session gets to seed the
 *    store; every later one is assumed stale relative to whatever's already
 *    live (this also covers a bare `let` resetting on a route boundary that
 *    gives this module a new instance without a real page reload).
 */
export function hydrateLayoutPrefsFromDb(prefs: Partial<LayoutPrefs>): void {
  if (hasExistingLocalCache || hydratedThisSession) return;
  hydratedThisSession = true;
  if (prefs.appShellLayout === undefined && prefs.modernUiLayout === undefined) return;
  setLayoutPrefs(
    normalizeLayoutPrefs({
      appShellLayout: prefs.appShellLayout ?? currentLayoutPrefs.appShellLayout,
      modernUiLayout: prefs.modernUiLayout ?? currentLayoutPrefs.modernUiLayout,
    }),
  );
}
