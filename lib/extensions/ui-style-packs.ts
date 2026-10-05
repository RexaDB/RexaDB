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
  // Prefix each top-level selector as a descendant of the active pack so
  // `[data-slot=…]` and `.rexadb-shell-…` rules both work. Nested CSS
  // (`html[…] { .class {…} }`) would miss classes on `<html>` itself.
  const attr = `html[data-rexadb-ui-pack="${packId}"]`;
  return trimmed.replace(/(^|})\s*([^@}/\s][^{]*?)\s*\{/g, (_m, brace: string, selectors: string) => {
    const scoped = selectors
      .split(",")
      .map((raw) => {
        const s = raw.trim();
        if (!s) return s;
        if (s.startsWith(":root") || s.startsWith("html")) {
          return s.replace(/^(:root|html)/, attr);
        }
        // Shell `className` lives on <html> — attach the leading class to the
        // pack attribute (`html[pack].rexadb-shell-x …`), keep the rest.
        const shellClass = s.match(/^(\.[A-Za-z0-9_-]+)(\s+[\s\S]*)?$/);
        if (shellClass) {
          return `${attr}${shellClass[1]}${shellClass[2] ?? ""}`;
        }
        return `${attr} ${s}`;
      })
      .filter(Boolean)
      .join(", ");
    return `${brace}\n${scoped} {`;
  });
}

export function applyStylePack(
  pack: ExtensionStylePackContribution,
  extensionId: string,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const fqId = `${extensionId}:${pack.id}`;

  // Clear previous pack vars / attribute.
  clearStylePackDom(false);

  root.dataset.rexadbUiPack = fqId;
  for (const [k, v] of Object.entries(pack.cssVariables ?? {})) {
    const name = k.startsWith("--") ? k : `--ui-${k}`;
    root.style.setProperty(name, v);
  }

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

function clearStylePackDom(clearStorage: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
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
