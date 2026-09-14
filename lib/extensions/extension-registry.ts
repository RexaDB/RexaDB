/**
 * Extension registry — install / enable / disable / persist.
 * Storage: localStorage (web + Tauri webview) so installs survive reloads
 * without filesystem access. Tauri filesystem loading can layer on top later.
 */

import { validateManifest, type ExtensionManifest, type InstalledExtensionRecord } from "./types";

const INSTALLED_KEY = "rexadb.extensions.installed.v1";

function safeParse(json: string | null): InstalledExtensionRecord[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json) as InstalledExtensionRecord[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function loadInstalled(): InstalledExtensionRecord[] {
  if (typeof localStorage === "undefined") return [];
  return safeParse(localStorage.getItem(INSTALLED_KEY));
}

export function persistInstalled(records: InstalledExtensionRecord[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(INSTALLED_KEY, JSON.stringify(records));
  } catch {
    // Quota exceeded (large bundled code) — persist manifests without code.
    try {
      localStorage.setItem(
        INSTALLED_KEY,
        JSON.stringify(records.map((r) => ({ ...r, code: undefined }))),
      );
    } catch {
      /* ignore */
    }
  }
}

export function installExtension(
  manifest: ExtensionManifest,
  code?: string,
  source: InstalledExtensionRecord["source"] = "local",
): { ok: boolean; errors?: string[]; record?: InstalledExtensionRecord } {
  const v = validateManifest(manifest);
  if (!v.ok) return { ok: false, errors: v.errors };
  const records = loadInstalled();
  const next: InstalledExtensionRecord = {
    manifest,
    code,
    source,
    enabled: true,
    installedAt: Date.now(),
  };
  const idx = records.findIndex((r) => r.manifest.id === manifest.id);
  if (idx >= 0) records[idx] = { ...next, enabled: records[idx].enabled };
  else records.push(next);
  persistInstalled(records);
  return { ok: true, record: next };
}

export function uninstallExtension(id: string): InstalledExtensionRecord[] {
  const records = loadInstalled().filter((r) => r.manifest.id !== id);
  persistInstalled(records);
  return records;
}

export function setExtensionEnabled(id: string, enabled: boolean): InstalledExtensionRecord[] {
  const records = loadInstalled().map((r) => (r.manifest.id === id ? { ...r, enabled } : r));
  persistInstalled(records);
  return records;
}

export function getEnabledExtensions(): InstalledExtensionRecord[] {
  return loadInstalled().filter((r) => r.enabled);
}

/** Parse an install payload. Accepts either a `{ manifest, code }` bundle
 *  (see the hello-rexa bundle.json example) or a raw manifest object —
 *  the latter installs static contributions only (no runtime handlers). */
export function parseExtensionBundle(json: string): { manifest: ExtensionManifest; code?: string } {
  const parsed = JSON.parse(json) as {
    manifest?: ExtensionManifest;
    code?: string;
  } & Partial<ExtensionManifest>;
  if (parsed?.manifest) return { manifest: parsed.manifest, code: parsed.code };
  if (parsed && typeof parsed.id === "string" && typeof parsed.engines === "object") {
    const { ...manifest } = parsed;
    return { manifest: manifest as ExtensionManifest };
  }
  throw new Error("bundle must contain { manifest, code } or a raw manifest object");
}
