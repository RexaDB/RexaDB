/**
 * Privacy switches. They live in localStorage rather than the studio settings
 * so that they stay on this device: settings sync can never turn one back on,
 * and code outside React (the error logger) can read them synchronously.
 *
 * Values are JSON, matching `useLocalStorage`.
 */

export const DIAGNOSTICS_STORAGE_KEY = "rexa-db-diagnostics-enabled";
export const AUTO_UPDATE_CHECKS_STORAGE_KEY = "rexa-db-auto-update-checks";

export const DIAGNOSTICS_DEFAULT = false;
export const AUTO_UPDATE_CHECKS_DEFAULT = true;

export function readPrivacySwitch(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) === true;
  } catch {
    // An unreadable choice counts as off: nothing leaves the device on a guess.
    return false;
  }
}

export function writePrivacySwitch(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The caller reads the switch back, so a failed write shows as unchanged.
  }
}

/** Whether error reports may be uploaded. Opt-in. */
export function isDiagnosticsEnabled(): boolean {
  return readPrivacySwitch(DIAGNOSTICS_STORAGE_KEY, DIAGNOSTICS_DEFAULT);
}

/** Whether the app may look for updates on its own at launch. */
export function isAutoUpdateCheckEnabled(): boolean {
  return readPrivacySwitch(AUTO_UPDATE_CHECKS_STORAGE_KEY, AUTO_UPDATE_CHECKS_DEFAULT);
}
