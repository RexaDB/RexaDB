/**
 * Apply / clear extension UI style packs and shells on the document.
 * Mirrors `themes.ts` but targets look-and-feel (buttons, shell chrome, …).
 */

import type { ExtensionShellContribution, ExtensionStylePackContribution } from "./ui-slots";

const ACTIVE_PACK_KEY = "rexadb.extensions.activeStylePack";
const ACTIVE_SHELL_KEY = "rexadb.extensions.activeShell";
const STYLE_ELEMENT_ID = "rexadb-extension-ui-pack";

export type ActiveStylePackRef = { extensionId: string; packId: string };
export type ActiveShellRef = { extensionId: string; shellId: string };

/** @internal exported for tests */
export function scopeCss(packId: string, css: string): string {
  const trimmed = css.trim();
  if (!trimmed) return "";
  if (trimmed.includes("data-rexadb-ui-pack=") || trimmed.includes("@rexadb-unscoped")) {
    return trimmed.replace(/\s*\/\*\s*@rexadb-unscoped\s*\*\//g, "").trim();
  }
  const attr = `html[data-rexadb-ui-pack="${packId}"]`;
  return scopeCssBlock(attr, trimmed);
}

function scopeSelectors(attr: string, selectors: string): string {
  return selectors
    .split(",")
    .map((raw) => {
      const s = raw.trim();
      if (!s) return s;
      if (s.startsWith(":root") || s.startsWith("html")) {
        return s.replace(/^(:root|html)/, attr);
      }
      // Only classes actually placed on `<html>` by a shell (`rexadb-shell-*`)
      // attach directly; every other leading class (e.g. `.card`) is a
      // descendant and must keep its descendant combinator.
      const shellClass = s.match(/^(\.[A-Za-z0-9_-]+)(\s+[\s\S]*)?$/);
      if (shellClass && shellClass[1].startsWith(".rexadb-shell-")) {
        return `${attr}${shellClass[1]}${shellClass[2] ?? ""}`;
      }
      // Also handle `html`-level shell class followed by descendants without
      // requiring the full selector to be a single class, e.g.
      // `.rexadb-shell-x [data-slot="shell"]`.
      if (s.startsWith(".rexadb-shell-")) {
        const spaceAt = s.search(/\s/);
        if (spaceAt > 0) {
          return `${attr}${s.slice(0, spaceAt)}${s.slice(spaceAt)}`;
        }
        return `${attr}${s}`;
      }
      return `${attr} ${s}`;
    })
    .filter(Boolean)
    .join(", ");
}

/** CSS-aware scoping: leaves `@keyframes` steps alone, recurses into `@media`. */
function scopeCssBlock(attr: string, css: string): string {
  let out = "";
  let i = 0;
  const n = css.length;
  const skipWs = () => {
    while (i < n && /\s/.test(css[i]!)) i++;
  };
  while (i < n) {
    skipWs();
    if (i >= n) break;
    // Preserve comments verbatim.
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      out += css.slice(i, stop);
      i = stop;
      continue;
    }
    const brace = css.indexOf("{", i);
    if (brace < 0) {
      out += css.slice(i);
      break;
    }
    const selector = css.slice(i, brace).trim();
    // Find matching close brace (handles nested blocks).
    let depth = 0;
    let j = brace;
    let inStr: string | null = null;
    for (; j < n; j++) {
      const ch = css[j]!;
      if (inStr) {
        if (ch === "\\") {
          j++;
        } else if (ch === inStr) {
          inStr = null;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        inStr = ch;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    const inner = css.slice(brace + 1, j);
    const lowerSel = selector.toLowerCase();
    if (
      lowerSel.startsWith("@keyframes") ||
      lowerSel.startsWith("@-webkit-keyframes") ||
      lowerSel.startsWith("@font-face") ||
      lowerSel.startsWith("@import") ||
      lowerSel.startsWith("@charset") ||
      lowerSel.startsWith("@namespace")
    ) {
      // Steps like `from` / `to` / `50%` must not be rewritten.
      out += `${selector} {${inner}}`;
    } else if (
      lowerSel.startsWith("@media") ||
      lowerSel.startsWith("@supports") ||
      lowerSel.startsWith("@layer") ||
      lowerSel.startsWith("@container")
    ) {
      out += `${selector} {${scopeCssBlock(attr, inner)}}`;
    } else if (selector.startsWith("@")) {
      out += `${selector} {${inner}}`;
    } else if (!selector) {
      out += `{${inner}}`;
    } else {
      out += `${scopeSelectors(attr, selector)} {${inner}}`;
    }
    i = j + 1;
  }
  return out;
}

export function applyStylePack(
  pack: ExtensionStylePackContribution,
  extensionId: string,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const fqId = `${extensionId}:${pack.id}`;

  // Clear previous pack vars / attribute (restores prior values).
  clearStylePackDom(false);

  root.dataset.rexadbUiPack = fqId;
  const tracked: Array<{ name: string; prev: string | null }> = [];
  for (const [k, v] of Object.entries(pack.cssVariables ?? {})) {
    const name = k.startsWith("--") ? k : `--ui-${k}`;
    const prev = root.style.getPropertyValue(name);
    tracked.push({ name, prev: prev || null });
    root.style.setProperty(name, v);
  }
  appliedPackVars = tracked;

  let el = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ELEMENT_ID;
    document.head.appendChild(el);
  }
  const parts: string[] = [];
  if (pack.cssVariables && Object.keys(pack.cssVariables).length > 0) {
    const vars = Object.entries(pack.cssVariables)
      .map(([k, v]) => `${k.startsWith("--") ? k : `--ui-${k}`}: ${v};`)
      .join("\n  ");
    parts.push(`html[data-rexadb-ui-pack="${fqId}"] {\n  ${vars}\n}`);
  }
  if (pack.css?.trim()) {
    parts.push(scopeCss(fqId, pack.css));
  }
  el.textContent = parts.join("\n\n");

  try {
    localStorage.setItem(ACTIVE_PACK_KEY, JSON.stringify({ extensionId, packId: pack.id } satisfies ActiveStylePackRef));
  } catch {
    /* ignore */
  }
}

/** Variables set by the active pack + their pre-pack values (for restore). */
let appliedPackVars: Array<{ name: string; prev: string | null }> = [];

function clearStylePackDom(clearStorage: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // Restore every variable this pack touched (including explicit `--accent`),
  // not just the `--ui-*` namespace, so switching/clearing never leaks.
  for (const { name, prev } of appliedPackVars.splice(0)) {
    root.style.removeProperty(name);
    if (prev) root.style.setProperty(name, prev);
  }
  // Legacy packs applied before var tracking: drop leftover `--ui-*` vars.
  for (const key of Array.from(root.style)) {
    if (key.startsWith("--ui-")) root.style.removeProperty(key);
  }
  delete root.dataset.rexadbUiPack;
  const el = document.getElementById(STYLE_ELEMENT_ID);
  if (el) el.textContent = "";
  if (clearStorage) {
    try {
      localStorage.removeItem(ACTIVE_PACK_KEY);
    } catch {
      /* ignore */
    }
  }
}

export function clearStylePack(): void {
  clearStylePackDom(true);
}

export function getActiveStylePack(): ActiveStylePackRef | null {
  try {
    const raw = localStorage.getItem(ACTIVE_PACK_KEY);
    return raw ? (JSON.parse(raw) as ActiveStylePackRef) : null;
  } catch {
    return null;
  }
}

export function applyShell(
  shell: ExtensionShellContribution,
  extensionId: string,
  resolvePack?: (packId: string) => ExtensionStylePackContribution | undefined,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  clearShellDom(false);

  const fqId = `${extensionId}:${shell.id}`;
  root.dataset.rexadbShell = fqId;
  if (shell.className?.trim()) {
    root.dataset.rexadbShellClass = shell.className.trim();
    for (const cls of shell.className.trim().split(/\s+/)) {
      if (cls) root.classList.add(cls);
    }
  }

  if (shell.stylePackId && resolvePack) {
    const pack = resolvePack(shell.stylePackId);
    if (pack) applyStylePack(pack, extensionId);
  }

  try {
    localStorage.setItem(
      ACTIVE_SHELL_KEY,
      JSON.stringify({ extensionId, shellId: shell.id } satisfies ActiveShellRef),
    );
  } catch {
    /* ignore */
  }
}

function clearShellDom(clearStorage: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const prevClass = root.dataset.rexadbShellClass;
  if (prevClass) {
    for (const cls of prevClass.split(/\s+/)) {
      if (cls) root.classList.remove(cls);
    }
  }
  delete root.dataset.rexadbShell;
  delete root.dataset.rexadbShellClass;
  if (clearStorage) {
    try {
      localStorage.removeItem(ACTIVE_SHELL_KEY);
    } catch {
      /* ignore */
    }
  }
}

export function clearShell(opts?: { clearStylePack?: boolean }): void {
  clearShellDom(true);
  if (opts?.clearStylePack) clearStylePack();
}

export function getActiveShell(): ActiveShellRef | null {
  try {
    const raw = localStorage.getItem(ACTIVE_SHELL_KEY);
    return raw ? (JSON.parse(raw) as ActiveShellRef) : null;
  } catch {
    return null;
  }
}
