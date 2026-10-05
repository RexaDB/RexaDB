"use client";

/**
 * React bridge between the extension host and RexaDB UI surfaces.
 * Aggregates static manifest contributions + runtime registrations into:
 * commands (Cmd+K), sidebar views, status bar items, languages, themes,
 * ui style packs / shells, webviews, tree data, visualizers, AI tools.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ExtensionHost, runInProcess, type HostCallbacks } from "./extension-host";
import {
  getEnabledExtensions,
  loadInstalled,
  persistInstalled,
} from "./extension-registry";
import { getExtensionDbBridge, onExtensionBridgeChange, type ExtensionDbBridge } from "./db-bridge";
import { resolvePanelTarget } from "./panels";
import {
  applyShell,
  applyStylePack,
  clearShell,
  clearStylePack,
  getActiveShell,
  getActiveStylePack,
} from "./ui-style-packs";
import { peekUiComponent, registerUiComponent, unregisterUiComponent } from "./ui-registry";
import type {
  ExtensionCommandContribution,
  ExtensionShellContribution,
  ExtensionStylePackContribution,
  InstalledExtensionRecord,
  RexaTreeItem,
} from "./types";

export const EXTENSION_OPEN_TAB_EVENT = "rexa:open-extension-tab";
export const EXTENSION_OPEN_PANEL_TAB_EVENT = "rexa:open-extension-panel-tab";

export function requestOpenExtensionTab(detail: { extensionId: string; viewId: string; title?: string }): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EXTENSION_OPEN_TAB_EVENT, { detail }));
}

export function requestOpenExtensionPanelTab(detail: {
  extensionId: string;
  panelId: string;
  title?: string;
  html?: string;
}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EXTENSION_OPEN_PANEL_TAB_EVENT, { detail }));
}

export interface ExtensionCommand extends ExtensionCommandContribution {
  extensionId: string;
}

export interface ExtensionStatusItem {
  key: string;
  extensionId: string;
  id: string;
  text: string;
  tooltip?: string;
  command?: string;
  alignment: "left" | "right";
  priority: number;
}

export interface ExtensionViewState {
  extensionId: string;
  viewId: string;
  name: string;
  containerId?: string;
  type: "tree" | "webview";
  html?: string;
  containerTitle?: string;
}

export interface ExtensionContainerState {
  extensionId: string;
  containerId: string;
  title: string;
  icon?: string;
}

export interface ExtensionRailItemState {
  key: string;
  extensionId: string;
  id: string;
  title: string;
  icon?: string;
  command?: string;
  viewId?: string;
  tooltip?: string;
}

export interface ExtensionPanelState {
  extensionId: string;
  panelId: string;
  title: string;
  html?: string;
  /** Declared area: `editor` panels open as editor tabs, the rest as dialogs. */
  area?: "editor" | "panel" | "both";
}

export interface ExtensionStylePackState extends ExtensionStylePackContribution {
  extensionId: string;
}

export interface ExtensionShellState extends ExtensionShellContribution {
  extensionId: string;
}

export interface ExtensionContextValue {
  extensions: InstalledExtensionRecord[];
  host: ExtensionHost | null;
  commands: ExtensionCommand[];
  views: ExtensionViewState[];
  containers: ExtensionContainerState[];
  railItems: ExtensionRailItemState[];
  panels: ExtensionPanelState[];
  statusItems: ExtensionStatusItem[];
  completions: Record<string, Array<{ label: string; detail?: string; insertText?: string }>>;
  themes: Array<{ extensionId: string; id: string; label: string; themeJson?: Record<string, unknown>; cssVariables?: Record<string, string> }>;
  /** Look-and-feel style packs from `contributes.ui.stylePacks`. */
  stylePacks: ExtensionStylePackState[];
  /** Alternate shells from `contributes.ui.shells`. */
  shells: ExtensionShellState[];
  activeStylePack: { extensionId: string; packId: string } | null;
  activeShell: { extensionId: string; shellId: string } | null;
  applyStylePackById: (extensionId: string, packId: string) => void;
  clearActiveStylePack: () => void;
  setActiveShellById: (extensionId: string, shellId: string) => void;
  clearActiveShell: () => void;
  webviewHtml: Record<string, string>;
  /** Free-form sidebar pages by container id (static manifest `html` or runtime `registerSidebarPage`). */
  sidebarHtml: Record<string, string>;
  treeNodes: Record<string, RexaTreeItem[]>;
  errors: Record<string, string>;
  refresh: () => void;
  executeCommand: (command: string, ...args: unknown[]) => Promise<unknown>;
  expandTree: (viewId: string, parentId?: string) => Promise<RexaTreeItem[]>;
  openPanel: (panelId: string) => void;
  openTab: (viewId: string, opts?: { title?: string }) => void;
  activePanel: ExtensionPanelState | null;
  closePanel: () => void;
}

const ExtensionContext = createContext<ExtensionContextValue | null>(null);

export function useExtensions(): ExtensionContextValue {
  const ctx = useContext(ExtensionContext);
  if (!ctx) {
    return {
      extensions: [],
      host: null,
      commands: [],
      views: [],
      containers: [],
      railItems: [],
      panels: [],
      statusItems: [],
      completions: {},
      themes: [],
      stylePacks: [],
      shells: [],
      activeStylePack: null,
      activeShell: null,
      applyStylePackById: () => {},
      clearActiveStylePack: () => {},
      setActiveShellById: () => {},
      clearActiveShell: () => {},
      webviewHtml: {},
      sidebarHtml: {},
      treeNodes: {},
      errors: {},
      refresh: () => {},
      executeCommand: async () => undefined,
      expandTree: async () => [],
      openPanel: () => {},
      openTab: () => {},
      activePanel: null,
      closePanel: () => {},
    };
  }
  return ctx;
}

export function ExtensionProvider({
  children,
  dbBridge,
}: {
  children: React.ReactNode;
  /** Test/SSR override. In the app the live bridge is registered globally by StudioInterface. */
  dbBridge?: ExtensionDbBridge;
}) {
  const [records, setRecords] = useState<InstalledExtensionRecord[]>([]);
  const [commands, setCommands] = useState<ExtensionCommand[]>([]);
  const [views, setViews] = useState<ExtensionViewState[]>([]);
  const [containers, setContainers] = useState<ExtensionContainerState[]>([]);
  const [railItems, setRailItems] = useState<ExtensionRailItemState[]>([]);
  const [panels, setPanels] = useState<ExtensionPanelState[]>([]);
  const [statusItems, setStatusItems] = useState<ExtensionStatusItem[]>([]);
  const [completions, setCompletions] = useState<ExtensionContextValue["completions"]>({});
  const [themes, setThemes] = useState<ExtensionContextValue["themes"]>([]);
  const [stylePacks, setStylePacks] = useState<ExtensionStylePackState[]>([]);
  const [shells, setShells] = useState<ExtensionShellState[]>([]);
  const [activeStylePack, setActiveStylePack] = useState<{ extensionId: string; packId: string } | null>(null);
  const [activeShell, setActiveShell] = useState<{ extensionId: string; shellId: string } | null>(null);
  const [webviewHtml, setWebviewHtml] = useState<Record<string, string>>({});
  const [sidebarHtml, setSidebarHtml] = useState<Record<string, string>>({});
  const [treeNodes, setTreeNodes] = useState<Record<string, RexaTreeItem[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [activePanel, setActivePanel] = useState<ExtensionPanelState | null>(null);
  const [recordsHydrated, setRecordsHydrated] = useState(false);
  const hostRef = useRef<ExtensionHost | null>(null);
  const runtimeCommandsRef = useRef<Map<string, { extensionId: string; title: string; group?: string }>>(new Map());
  const treeOwnerRef = useRef<Map<string, string>>(new Map());
  const stylePacksRef = useRef<ExtensionStylePackState[]>([]);
  const shellsRef = useRef<ExtensionShellState[]>([]);
  /** Slot ids (`button`, `shell`, …) whose bindings this provider owns. */
  const providerUiOwnedRef = useRef<Set<string>>(new Set());
  const dbBridgeRef = useRef(dbBridge);
  dbBridgeRef.current = dbBridge;

  const refresh = useCallback(() => {
    setRecords(loadInstalled());
    setRecordsHydrated(true);
  }, []);

  // Seed static contributions from manifests (no code execution needed).
  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const cmdList: ExtensionCommand[] = [];
    const viewList: ExtensionViewState[] = [];
    const containerAcc: ExtensionContainerState[] = [];
    const railAcc: ExtensionRailItemState[] = [];
    const panelList: ExtensionPanelState[] = [];
    const statusList: ExtensionStatusItem[] = [];
    const themeList: ExtensionContextValue["themes"] = [];
    const stylePackList: ExtensionStylePackState[] = [];
    const shellList: ExtensionShellState[] = [];
    const wantedSlotBindings = new Map<string, React.ComponentType<any>>();
    for (const rec of records) {
      if (!rec.enabled) continue;
      const c = rec.manifest.contributes;
      const group = rec.manifest.displayName || rec.manifest.id;
      for (const cmd of c?.commands ?? []) {
        cmdList.push({ ...cmd, group: cmd.group ?? group, extensionId: rec.manifest.id });
      }
      const containers = new Map((c?.viewsContainers ?? []).map((vc) => [vc.id, vc.title]));
      for (const vc of c?.viewsContainers ?? []) {
        if (vc.html) {
          setSidebarHtml((prev) => (prev[vc.id] ? prev : { ...prev, [vc.id]: vc.html! }));
        }
      }
      for (const v of c?.views ?? []) {
        viewList.push({
          extensionId: rec.manifest.id,
          viewId: v.id,
          name: v.name,
          containerId: v.containerId,
          type: v.type,
          html: v.html,
          containerTitle: v.containerId ? containers.get(v.containerId) : undefined,
        });
        if (v.type === "webview" && v.html) {
          setWebviewHtml((prev) => (prev[v.id] ? prev : { ...prev, [v.id]: v.html! }));
        }
      }
      for (const p of c?.webviewPanels ?? []) {
        panelList.push({ extensionId: rec.manifest.id, panelId: p.id, title: p.title, html: p.html, area: p.area });
      }
      for (const s of c?.statusBar ?? []) {
        statusList.push({
          key: `${rec.manifest.id}:${s.id}`,
          extensionId: rec.manifest.id,
          id: s.id,
          text: s.text,
          tooltip: s.tooltip,
          command: s.command,
          alignment: s.alignment ?? "right",
          priority: s.priority ?? 0,
        });
      }
      for (const t of c?.themes ?? []) {
        themeList.push({ extensionId: rec.manifest.id, id: t.id, label: t.label, themeJson: t.themeJson, cssVariables: t.cssVariables });
      }
      for (const pack of c?.ui?.stylePacks ?? []) {
        stylePackList.push({ ...pack, extensionId: rec.manifest.id });
      }
      for (const shell of c?.ui?.shells ?? []) {
        shellList.push({ ...shell, extensionId: rec.manifest.id });
        // Trusted React shell override: if a component is already registered
        // under componentKey or extensionId:shellId, also bind it to "shell"
        // when this shell becomes the active selection (handled in setActive).
        if (shell.componentKey && peekUiComponent(shell.componentKey)) {
          /* registration is host-owned; nothing to do at aggregate time */
        }
      }
      for (const slot of c?.ui?.slots ?? []) {
        if (!slot.componentKey) continue;
        const Comp = peekUiComponent(slot.componentKey);
        if (Comp) wantedSlotBindings.set(slot.slot, Comp);
      }
      const containerList: ExtensionContainerState[] = (c?.viewsContainers ?? []).map((vc) => ({
        extensionId: rec.manifest.id,
        containerId: vc.id,
        title: vc.title,
        icon: vc.icon,
      }));
      containerAcc.push(...containerList);
      // Static rail items + one automatic item per view container — unless the
      // manifest declares railItems explicitly, in which case the explicit
      // list wins so extensions never get duplicate rail entries.
      const staticRail = c?.railItems ?? [];
      for (const r of staticRail) {
        railAcc.push({
          key: `${rec.manifest.id}:${r.id}`,
          extensionId: rec.manifest.id,
          id: r.id,
          title: r.title,
          icon: r.icon,
          command: r.command,
          viewId: r.viewId,
          tooltip: r.tooltip,
        });
      }
      if (staticRail.length === 0) {
        for (const vc of containerList) {
          railAcc.push({
            key: `${rec.manifest.id}:container:${vc.containerId}`,
            extensionId: rec.manifest.id,
            id: `container:${vc.containerId}`,
            title: vc.title,
            icon: vc.icon,
            tooltip: `${group} views`,
          });
        }
      }
    }
    // Merge runtime-registered commands (avoid dupes; manifest wins for title).
    for (const [command, meta] of runtimeCommandsRef.current) {
      if (!cmdList.some((c) => c.command === command)) {
        cmdList.push({ command, title: meta.title, group: meta.group, extensionId: meta.extensionId });
      }
    }
    setCommands(cmdList);
    setViews(viewList);
    setContainers(containerAcc);
    setRailItems((prev) => {
      // Keep runtime-created items for matching keys.
      const runtime = new Map(prev.map((r) => [r.key, r]));
      const merged = railAcc.map((r) => runtime.get(r.key) ?? r);
      for (const r of prev) {
        if (!merged.some((m) => m.key === r.key)) merged.push(r);
      }
      return merged;
    });
    setPanels(panelList);
    setStatusItems((prev) => {
      // Keep runtime updates (text/tooltip) for matching keys.
      const runtime = new Map(prev.map((s) => [s.key, s]));
      return statusList.map((s) => runtime.get(s.key) ?? s);
    });
    setThemes(themeList);
    setStylePacks(stylePackList);
    setShells(shellList);
    stylePacksRef.current = stylePackList;
    shellsRef.current = shellList;

    // Re-apply persisted pack/shell if the contributing extension is still enabled.
    // Shell first, then the saved pack wins so a refresh never swaps the
    // user's chosen pack for the shell's linked pack. Guarded by hydration:
    // `records` starts empty while `refresh()` loads, and clearing on that
    // first empty pass would delete saved choices before they can restore.
    if (recordsHydrated) {
      const savedShell = getActiveShell();
      let shellLinkedPack: { extensionId: string; packId: string } | null = null;
      if (savedShell) {
        const shell = shellList.find((s) => s.extensionId === savedShell.extensionId && s.id === savedShell.shellId);
        if (shell) {
          applyShell(shell, shell.extensionId, (packId) =>
            stylePackList.find((p) => p.extensionId === shell.extensionId && p.id === packId),
          );
          if (shell.stylePackId) {
            const linked = stylePackList.find(
              (p) => p.extensionId === shell.extensionId && p.id === shell.stylePackId,
            );
            if (linked) shellLinkedPack = { extensionId: shell.extensionId, packId: shell.stylePackId };
          }
          if (shell.componentKey || peekUiComponent(`${shell.extensionId}:${shell.id}`)) {
            const Comp =
              (shell.componentKey ? peekUiComponent(shell.componentKey) : undefined) ??
              peekUiComponent(`${shell.extensionId}:${shell.id}`);
            if (Comp) wantedSlotBindings.set("shell", Comp);
          }
          setActiveShell(savedShell);
        } else {
          clearShell();
          providerUiOwnedRef.current.delete("shell");
          setActiveShell(null);
        }
      } else {
        setActiveShell(null);
      }
      const savedPack = getActiveStylePack();
      if (savedPack) {
        const pack = stylePackList.find((p) => p.extensionId === savedPack.extensionId && p.id === savedPack.packId);
        if (pack) {
          applyStylePack(pack, pack.extensionId);
          setActiveStylePack(savedPack);
        } else if (shellLinkedPack) {
          // Pack extension gone but shell linked pack applied — keep picker aligned.
          setActiveStylePack(shellLinkedPack);
        } else {
          clearStylePack();
          setActiveStylePack(null);
        }
      } else if (shellLinkedPack) {
        setActiveStylePack(shellLinkedPack);
      } else {
        setActiveStylePack(null);
      }
    }
    // Sync provider-owned slot/shell bindings: remove overrides whose
    // extension was disabled/uninstalled or whose shell is no longer active.
    {
      const owned = providerUiOwnedRef.current;
      for (const key of Array.from(owned)) {
        if (!wantedSlotBindings.has(key)) {
          unregisterUiComponent(key);
          owned.delete(key);
        }
      }
      for (const [key, Comp] of wantedSlotBindings) {
        if (peekUiComponent(key) !== Comp) registerUiComponent(key, Comp);
        owned.add(key);
      }
      // A CSS-only shell (no Comp) must drop a previous shell override.
      if (!wantedSlotBindings.has("shell") && owned.has("shell")) {
        unregisterUiComponent("shell");
        owned.delete("shell");
      }
    }
  }, [records, recordsHydrated]);

  const applyStylePackById = useCallback((extensionId: string, packId: string) => {
    const pack = stylePacksRef.current.find((p) => p.extensionId === extensionId && p.id === packId);
    if (!pack) throw new Error(`style pack not found: ${extensionId}:${packId}`);
    applyStylePack(pack, extensionId);
    setActiveStylePack({ extensionId, packId });
  }, []);

  const clearActiveStylePack = useCallback(() => {
    clearStylePack();
    setActiveStylePack(null);
  }, []);

  const setActiveShellById = useCallback((extensionId: string, shellId: string) => {
    const shell = shellsRef.current.find((s) => s.extensionId === extensionId && s.id === shellId);
    if (!shell) throw new Error(`shell not found: ${extensionId}:${shellId}`);
    applyShell(shell, extensionId, (packId) =>
      stylePacksRef.current.find((p) => p.extensionId === extensionId && p.id === packId),
    );
    if (shell.stylePackId) {
      setActiveStylePack({ extensionId, packId: shell.stylePackId });
    }
    const Comp =
      (shell.componentKey ? peekUiComponent(shell.componentKey) : undefined) ??
      peekUiComponent(`${extensionId}:${shellId}`);
    if (Comp) {
      registerUiComponent("shell", Comp);
      providerUiOwnedRef.current.add("shell");
    } else {
      unregisterUiComponent("shell");
      providerUiOwnedRef.current.delete("shell");
    }
    setActiveShell({ extensionId, shellId });
  }, []);

  const clearActiveShell = useCallback(() => {
    clearShell({ clearStylePack: false });
    // Drop the shell React override so ModernUIShell returns.
    unregisterUiComponent("shell");
    providerUiOwnedRef.current.delete("shell");
    setActiveShell(null);
  }, []);

  // Boot the sandbox host once; (re)load enabled extensions with code.
  useEffect(() => {
    const callbacks: HostCallbacks = {
      onLog: () => {},
      resolveCapabilities: (extensionId) =>
        loadInstalled().find((r) => r.manifest.id === extensionId)?.manifest.capabilities ?? [],
      commands: {
        register: (extensionId, command, title, group) => {
          runtimeCommandsRef.current.set(command, {
            extensionId,
            title: title || command,
            group: group || extensionId,
          });
          setCommands((prev) => {
            if (prev.some((c) => c.command === command)) return prev;
            return [...prev, { command, title: title || command, group: group || extensionId, extensionId }];
          });
        },
        execute: async (command, ...args) => {
          // Worker-registered command handlers are invoked via host; static
          // manifest commands without handlers resolve as no-ops carrying args.
          const host = hostRef.current;
          if (host) {
            for (const extId of host.loadedIds) {
              try {
                const value = await host.invokeWorkerHandler(extId, `command:${command}`, args);
                return value as never;
              } catch {
                // try next extension
              }
            }
          }
          // Fall through: core handles `rexa.*` built-ins elsewhere.
          return undefined as never;
        },
        list: () =>
          commands.map((c) => ({ command: c.command, title: c.title, group: c.group })),
      },
      window: {
        showMessage: async (kind, message) => {
          const { toast } = await import("sonner");
          if (kind === "error") toast.error(message);
          else if (kind === "warning") toast.warning(message);
          else toast.info(message);
        },
        showInputBox: async (prompt) => {
          return window.prompt(prompt) ?? undefined;
        },
        statusBarCreate: (extensionId, id, text, opts) => {
          const key = `${extensionId}:${id}`;
          setStatusItems((prev) => {
            if (prev.some((s) => s.key === key)) return prev;
            return [
              ...prev,
              {
                key,
                extensionId,
                id,
                text,
                tooltip: opts?.tooltip,
                command: opts?.command,
                alignment: opts?.alignment ?? "right",
                priority: opts?.priority ?? 0,
              },
            ];
          });
        },
        statusBarUpdate: (extensionId, id, patch) => {
          const key = `${extensionId}:${id}`;
          setStatusItems((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
        },
        webviewViewRegister: (extensionId, viewId, html) => {
          setWebviewHtml((prev) => ({ ...prev, [viewId]: html }));
          setViews((prev) => {
            if (prev.some((v) => v.viewId === viewId)) return prev;
            return [...prev, { extensionId, viewId, name: viewId, type: "webview", html }];
          });
        },
        sidebarPageRegister: (extensionId, containerId, html) => {
          setSidebarHtml((prev) => ({ ...prev, [containerId]: html }));
        },
        webviewPanelOpen: (extensionId, panelId, html) => {
          // Fresh manifest lookup (the boot-effect closure can't see later
          // `panels` state) for the declared area + title/html fallbacks.
          const declared = loadInstalled()
            .find((r) => r.manifest.id === extensionId)
            ?.manifest.contributes?.webviewPanels?.find((p) => p.id === panelId);
          const title = declared?.title ?? panels.find((p) => p.panelId === panelId)?.title ?? panelId;
          const resolvedHtml = html ?? declared?.html;
          if (resolvePanelTarget(declared?.area) === "tab") {
            // Editor-area panels open as full-height editor tabs (their own
            // tab content — never sidebar content), one tab per panel.
            requestOpenExtensionPanelTab({ extensionId, panelId, title, html: resolvedHtml });
            return;
          }
          setActivePanel({ extensionId, panelId, title, html: resolvedHtml, area: declared?.area });
        },
      },
      tree: {
        registerProvider: (extensionId, viewId) => {
          treeOwnerRef.current.set(viewId, extensionId);
        },
        setChildren: (viewId, parentId, items) => {
          const key = parentId ? `${viewId}:${parentId}` : viewId;
          setTreeNodes((prev) => ({ ...prev, [key]: items }));
        },
      },
      workspace: {
        get: async () => ({}),
        set: async () => {},
      },
      languages: {
        completionsAdd: (languageId, items) => {
          setCompletions((prev) => ({
            ...prev,
            [languageId]: [...(prev[languageId] ?? []), ...items],
          }));
        },
        formatterAdd: () => {},
      },
      db: {
        getConnections: () =>
          (dbBridgeRef.current ?? getExtensionDbBridge())?.getConnections() ?? Promise.resolve([]),
        getActiveConnection: () =>
          (dbBridgeRef.current ?? getExtensionDbBridge())?.getActiveConnection() ?? Promise.resolve(null),
        executeQuery: <T,>(sql: string, params?: unknown[]) =>
          (dbBridgeRef.current ?? getExtensionDbBridge())?.executeQuery<T>(sql, params) ??
          Promise.resolve({ rows: [], fields: [] }),
        getSchema: () =>
          (dbBridgeRef.current ?? getExtensionDbBridge())?.getSchema() ??
          Promise.resolve({ database: "", dbType: "", schemas: [], tables: [] }),
        readTable: (schema: string, table: string, limit?: number) =>
          (dbBridgeRef.current ?? getExtensionDbBridge())?.readTable(schema, table, limit) ??
          Promise.resolve({ rows: [], fields: [] }),
        getActiveQuery: () =>
          (dbBridgeRef.current ?? getExtensionDbBridge())?.getActiveQuery() ?? Promise.resolve(""),
        setActiveQuery: (sql: string) =>
          (dbBridgeRef.current ?? getExtensionDbBridge())?.setActiveQuery(sql) ?? Promise.resolve(),
        openVisualizer: async () => {},
      },
      ai: { registerTool: () => {} },
      env: {
        clipboardWrite: async (text) => {
          await navigator.clipboard?.writeText(text);
        },
      },
      rail: {
        create: (extensionId, item) => {
          const key = `${extensionId}:${item.id}`;
          setRailItems((prev) => {
            if (prev.some((r) => r.key === key)) return prev;
            return [...prev, { key, extensionId, ...item }];
          });
        },
      },
      tabs: {
        open: (extensionId, viewId, opts) => {
          requestOpenExtensionTab({ extensionId, viewId, title: opts?.title });
        },
      },
      ui: {
        applyStylePack: async (extensionId, packId) => {
          const pack = stylePacksRef.current.find((p) => p.extensionId === extensionId && p.id === packId);
          if (!pack) throw new Error(`style pack not found: ${extensionId}:${packId}`);
          applyStylePack(pack, extensionId);
          setActiveStylePack({ extensionId, packId });
        },
        clearStylePack: async () => {
          clearStylePack();
          setActiveStylePack(null);
        },
        setActiveShell: async (extensionId, shellId) => {
          const shell = shellsRef.current.find((s) => s.extensionId === extensionId && s.id === shellId);
          if (!shell) throw new Error(`shell not found: ${extensionId}:${shellId}`);
          applyShell(shell, extensionId, (packId) =>
            stylePacksRef.current.find((p) => p.extensionId === extensionId && p.id === packId),
          );
          if (shell.stylePackId) setActiveStylePack({ extensionId, packId: shell.stylePackId });
          const Comp =
            (shell.componentKey ? peekUiComponent(shell.componentKey) : undefined) ??
            peekUiComponent(`${extensionId}:${shellId}`);
          if (Comp) {
            registerUiComponent("shell", Comp);
            providerUiOwnedRef.current.add("shell");
          } else {
            unregisterUiComponent("shell");
            providerUiOwnedRef.current.delete("shell");
          }
          setActiveShell({ extensionId, shellId });
        },
        clearShell: async () => {
          clearShell({ clearStylePack: false });
          unregisterUiComponent("shell");
          providerUiOwnedRef.current.delete("shell");
          setActiveShell(null);
        },
        listStylePacks: async () =>
          stylePacksRef.current.map((p) => ({ extensionId: p.extensionId, id: p.id, label: p.label })),
        listShells: async () =>
          shellsRef.current.map((s) => ({ extensionId: s.extensionId, id: s.id, label: s.label })),
        getActiveStylePack: async () => getActiveStylePack(),
        getActiveShell: async () => getActiveShell(),
      },
    };

    const host = new ExtensionHost(callbacks);
    hostRef.current = host;

    let cancelled = false;
    const loadEnabled = async () => {
      const enabled = getEnabledExtensions().filter((r) => r.code);
      const isBrowserWorker = typeof Worker !== "undefined";
      for (const rec of enabled) {
        if (cancelled) break;
        try {
          if (isBrowserWorker) {
            await host.load(rec.manifest.id, rec.code!);
          } else {
            await runInProcess(rec.manifest.id, rec.code!, callbacks);
          }
        } catch (err) {
          setErrors((prev) => ({ ...prev, [rec.manifest.id]: String((err as Error)?.message || err) }));
        }
      }
    };
    void loadEnabled();

    // Workers boot at app startup — before any studio session exists — so
    // anything snapshotted at activation (sidebar pages, trees) sees empty
    // fallbacks. Re-run activation whenever a studio session opens (and on
    // connection switches) so extensions read live data. Registrations are
    // all idempotent/deduped, so re-activation is safe.
    const offBridge = onExtensionBridgeChange((bridge) => {
      if (!bridge || cancelled) return;
      const current = hostRef.current;
      if (!current) return;
      current.unloadAll();
      void loadEnabled();
    });

    const onStorage = (e: StorageEvent) => {
      if (e.key?.startsWith("rexadb.extensions")) refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      offBridge();
      window.removeEventListener("storage", onStorage);
      host.unloadAll();
      hostRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const executeCommand = useCallback(async (command: string, ...args: unknown[]) => {
    const host = hostRef.current;
    if (host) {
      for (const extId of host.loadedIds) {
        try {
          return await host.invokeWorkerHandler(extId, `command:${command}`, args);
        } catch {
          // not handled by this extension — try next
        }
      }
    }
    // No handler: still resolve so palette clicks never crash.
    return undefined;
  }, []);

  const expandTree = useCallback(async (viewId: string, parentId?: string) => {
    const host = hostRef.current;
    const owner = treeOwnerRef.current.get(viewId);
    if (host && owner) {
      try {
        return await host.getTreeChildren(owner, viewId, parentId);
      } catch {
        return [];
      }
    }
    return [];
  }, []);

  const openPanel = useCallback(
    (panelId: string) => {
      const p = panels.find((x) => x.panelId === panelId);
      if (p) setActivePanel(p);
    },
    [panels],
  );

  const closePanel = useCallback(() => setActivePanel(null), []);

  const openTab = useCallback(
    (viewId: string, opts?: { title?: string }) => {
      const owner = views.find((v) => v.viewId === viewId);
      requestOpenExtensionTab({
        extensionId: owner?.extensionId ?? "",
        viewId,
        title: opts?.title ?? owner?.name,
      });
    },
    [views],
  );

  const value = useMemo<ExtensionContextValue>(
    () => ({
      extensions: records,
      host: hostRef.current,
      commands,
      views,
      containers,
      railItems,
      panels,
      statusItems: [...statusItems].sort((a, b) => b.priority - a.priority),
      completions,
      themes,
      stylePacks,
      shells,
      activeStylePack,
      activeShell,
      applyStylePackById,
      clearActiveStylePack,
      setActiveShellById,
      clearActiveShell,
      webviewHtml,
      sidebarHtml,
      treeNodes,
      errors,
      refresh,
      executeCommand,
      expandTree,
      openPanel,
      openTab,
      activePanel,
      closePanel,
    }),
    [
      records,
      commands,
      views,
      containers,
      railItems,
      panels,
      statusItems,
      completions,
      themes,
      stylePacks,
      shells,
      activeStylePack,
      activeShell,
      applyStylePackById,
      clearActiveStylePack,
      setActiveShellById,
      clearActiveShell,
      webviewHtml,
      sidebarHtml,
      treeNodes,
      errors,
      refresh,
      executeCommand,
      expandTree,
      openPanel,
      openTab,
      activePanel,
      closePanel,
    ],
  );

  return <ExtensionContext.Provider value={value}>{children}</ExtensionContext.Provider>;
}

/** Persist bundled example extensions on first run (dev convenience). */
export function ensureBundledExtensions(bundled: InstalledExtensionRecord[]): void {
  if (typeof localStorage === "undefined") return;
  const existing = loadInstalled();
  let changed = false;
  for (const b of bundled) {
    if (!existing.some((r) => r.manifest.id === b.manifest.id)) {
      existing.push(b);
      changed = true;
    }
  }
  if (changed) persistInstalled(existing);
}
