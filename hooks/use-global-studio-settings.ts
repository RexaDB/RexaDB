"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getGlobalStudioSettings,
  saveGlobalStudioSettings,
} from "@/lib/api/actions-client";
import {
  DEFAULT_ICON_THEME_ID,
  ICON_THEME_UPDATED_EVENT,
  normalizeCustomIconThemes,
  type CustomIconTheme,
} from "@/lib/icon-theme/types";
import type {
  SqlEditorEngine,
  SqlFormatSettingsRequired,
} from "@/lib/studio/types";
import { pickCommonSettings } from "@/lib/studio/settings-common";
import {
  DEFAULT_FAST_TABLE_LOADING,
  FAST_TABLE_LOADING_DEFAULT_MIGRATION_KEY,
  resolveFastTableLoading,
} from "@/lib/studio/fast-table-loading";
import {
  emitSettingsSyncLocalChanged,
  subscribeSettingsSyncApplied,
  subscribeSettingsSyncLocalChanged,
} from "@/lib/studio/settings-sync-events";

/** Order-insensitive deep equality for settings records. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    try {
      return JSON.stringify(value) ?? "";
    } catch {
      return "";
    }
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`)
    .join(",")}}`;
}

export const ZOOM_UPDATED_EVENT = "rexadb-zoom-updated";

// Saves in flight across hook instances in this window. A load resolving
// while a save is landing must defer to the save's broadcast (which carries
// fresher state) instead of painting stale server data over fresh edits.
let inFlightStudioSaves = 0;

interface GlobalStudioSettings extends SqlFormatSettingsRequired {
  appZoom: number;
  executionMode: "direct" | "review";
  rowSpacing: "compact" | "standard" | "relaxed";
  alternatingRowColors: boolean;
  editorFontSize: string;
  editorFontFamily: string;
  sqlEditorEngine: SqlEditorEngine;
  tuiMode: boolean;
  tuiTheme: "auto" | "light" | "dark";
  commandMenuSections: Array<{ id: string; name: string; isVisible: boolean }>;
  agentProvider: "openai" | "gemini";
  agentModel: string;
  agentApiKey: string;
  glassmorphicHeaders: boolean;
  gridAnimations: boolean;
  sleekSelection: boolean;
  colorizedPills: boolean;
  relativeDates: boolean;
  richJsonInspector: boolean;
  dataBars: boolean;
  skeletonLoaders: boolean;
  fastTableLoading: boolean;
  sleekLayout: boolean;
  showTabIndicator: boolean;
  iconThemeId: string;
  customIconThemes: CustomIconTheme[];
  restoreAppState: boolean;
  openConnectionsInNewWindow: boolean;
  schemaExplorer: boolean;
  databaseExplorer: boolean;
  tableExpansion: boolean;
  hideWindowActions: boolean;
  rlsPolicyTabEditor: boolean;
  autoClosePane: boolean;
  confirmSheetClose: boolean;
  sidebarToggleBeforeConnection: boolean;
  autoSaveQueries: boolean;
  vimMode: boolean;
  slashAiTrigger: boolean;
  resultTabsEnabled: boolean;
  showPendingChangesBanner: boolean;
  previewTabs: boolean;
  noiseBgEnabled: boolean;
  noiseBgOpacity: number;
  noiseBgSize: number;
  noiseBgBlendMode: "overlay" | "soft-light" | "multiply" | "screen";
  noiseBgColor: string;
  noiseBgTranslucent: boolean;
}

export function useGlobalStudioSettings(persist = false) {
  const [appZoom, setAppZoom] = useState<number>(100);
  const [executionMode, setExecutionMode] = useState<"direct" | "review">(
    "direct",
  );
  const [rowSpacing, setRowSpacing] = useState<
    "compact" | "standard" | "relaxed"
  >("standard");
  const [alternatingRowColors, setAlternatingRowColors] =
    useState<boolean>(false);
  const [editorFontSize, setEditorFontSize] = useState<string>("14px");
  const [editorFontFamily, setEditorFontFamily] = useState<string>("");
  const [sqlEditorEngine, setSqlEditorEngine] =
    useState<SqlEditorEngine>("monaco");
  const [tuiMode, setTuiMode] = useState<boolean>(false);
  const [tuiTheme, setTuiTheme] = useState<"auto" | "light" | "dark">("auto");
  const [commandMenuSections, setCommandMenuSections] = useState<
    Array<{ id: string; name: string; isVisible: boolean }>
  >([]);
  const [agentProvider, setAgentProvider] = useState<"openai" | "gemini">(
    "openai",
  );
  const [agentModel, setAgentModel] = useState<string>("");
  const [agentApiKey, setAgentApiKey] = useState<string>("");

  const [glassmorphicHeaders, setGlassmorphicHeaders] =
    useState<boolean>(false);
  const [gridAnimations, setGridAnimations] = useState<boolean>(false);
  const [sleekSelection, setSleekSelection] = useState<boolean>(false);
  const [colorizedPills, setColorizedPills] = useState<boolean>(false);
  const [relativeDates, setRelativeDates] = useState<boolean>(false);
  const [richJsonInspector, setRichJsonInspector] = useState<boolean>(false);
  const [dataBars, setDataBars] = useState<boolean>(false);
  const [skeletonLoaders, setSkeletonLoaders] = useState<boolean>(false);
  const [fastTableLoading, setFastTableLoading] = useState<boolean>(DEFAULT_FAST_TABLE_LOADING);
  const [sleekLayout, setSleekLayout] = useState<boolean>(false);
  const [activeSleekLayout, setActiveSleekLayout] = useState<boolean>(false);
  const [showTabIndicator, setShowTabIndicator] = useState<boolean>(true);
  const [iconThemeId, setIconThemeId] = useState<string>(DEFAULT_ICON_THEME_ID);
  const [customIconThemes, setCustomIconThemes] = useState<CustomIconTheme[]>(
    [],
  );
  const [restoreAppState, setRestoreAppState] = useState<boolean>(true);
  const [openConnectionsInNewWindow, setOpenConnectionsInNewWindow] =
    useState<boolean>(false);
  const [schemaExplorer, setSchemaExplorer] = useState<boolean>(false);
  const [databaseExplorer, setDatabaseExplorer] = useState<boolean>(false);
  const [tableExpansion, setTableExpansion] = useState<boolean>(true);
  const [hideWindowActions, setHideWindowActions] = useState<boolean>(false);
  const [rlsPolicyTabEditor, setRlsPolicyTabEditor] = useState<boolean>(false);
  const [autoClosePane, setAutoClosePane] = useState<boolean>(false);
  const [confirmSheetClose, setConfirmSheetClose] = useState<boolean>(false);
  const [sidebarToggleBeforeConnection, setSidebarToggleBeforeConnection] =
    useState<boolean>(false);
  const [autoSaveQueries, setAutoSaveQueries] = useState<boolean>(false);
  const [vimMode, setVimMode] = useState<boolean>(false);
  const [slashAiTrigger, setSlashAiTrigger] = useState<boolean>(true);
  const [resultTabsEnabled, setResultTabsEnabled] = useState<boolean>(true);
  const [showPendingChangesBanner, setShowPendingChangesBanner] = useState<boolean>(true);
  const [previewTabs, setPreviewTabs] = useState<boolean>(false);
  const [noiseBgEnabled, setNoiseBgEnabled] = useState<boolean>(false);
  const [noiseBgOpacity, setNoiseBgOpacity] = useState<number>(30);
  const [noiseBgSize, setNoiseBgSize] = useState<number>(50);
  const [noiseBgBlendMode, setNoiseBgBlendMode] = useState<"overlay" | "soft-light" | "multiply" | "screen">("overlay");
  const [noiseBgColor, setNoiseBgColor] = useState<string>("#000000");
  const [noiseBgTranslucent, setNoiseBgTranslucent] = useState<boolean>(false);
  const [sqlFormatTabWidth, setSqlFormatTabWidth] = useState<number>(2);
  const [sqlFormatUseTabs, setSqlFormatUseTabs] = useState<boolean>(false);
  const [sqlFormatKeywordCase, setSqlFormatKeywordCase] = useState<
    "preserve" | "upper" | "lower"
  >("upper");
  const [sqlFormatDataTypeCase, setSqlFormatDataTypeCase] = useState<
    "preserve" | "upper" | "lower"
  >("preserve");
  const [sqlFormatFunctionCase, setSqlFormatFunctionCase] = useState<
    "preserve" | "upper" | "lower"
  >("preserve");
  const [sqlFormatIdentifierCase, setSqlFormatIdentifierCase] = useState<
    "preserve" | "upper" | "lower"
  >("preserve");
  const [sqlFormatLogicalOperatorNewline, setSqlFormatLogicalOperatorNewline] =
    useState<"before" | "after">("before");
  const [sqlFormatExpressionWidth, setSqlFormatExpressionWidth] =
    useState<number>(50);
  const [sqlFormatLinesBetweenQueries, setSqlFormatLinesBetweenQueries] =
    useState<number>(2);
  const [sqlFormatDenseOperators, setSqlFormatDenseOperators] =
    useState<boolean>(false);
  const [sqlFormatNewlineBeforeSemicolon, setSqlFormatNewlineBeforeSemicolon] =
    useState<boolean>(false);

  const [isLoaded, setIsLoaded] = useState(false);
  const agentApiKeyRef = useRef(agentApiKey);
  agentApiKeyRef.current = agentApiKey;

  const applyFromRecord = (d: Record<string, any>) => {
    if (d.appZoom !== undefined) setAppZoom(d.appZoom);
    if (d.executionMode) setExecutionMode(d.executionMode);
    if (d.rowSpacing) setRowSpacing(d.rowSpacing);
    if (d.alternatingRowColors !== undefined)
      setAlternatingRowColors(d.alternatingRowColors);
    if (d.editorFontSize) setEditorFontSize(d.editorFontSize);
    if (d.editorFontFamily) setEditorFontFamily(d.editorFontFamily);
    if (d.sqlEditorEngine) setSqlEditorEngine(d.sqlEditorEngine);
    if (d.tuiMode !== undefined) setTuiMode(d.tuiMode);
    if (d.tuiTheme) setTuiTheme(d.tuiTheme);
    if (Array.isArray(d.commandMenuSections))
      setCommandMenuSections(d.commandMenuSections);
    if (d.agentProvider) setAgentProvider(d.agentProvider);
    if (d.agentModel) setAgentModel(d.agentModel);
    // Keep device-local API keys: only apply when present in the record.
    if (d.agentApiKey !== undefined) setAgentApiKey(d.agentApiKey);

    if (d.glassmorphicHeaders !== undefined)
      setGlassmorphicHeaders(d.glassmorphicHeaders);
    if (d.gridAnimations !== undefined) setGridAnimations(d.gridAnimations);
    if (d.sleekSelection !== undefined) setSleekSelection(d.sleekSelection);
    if (d.colorizedPills !== undefined) setColorizedPills(d.colorizedPills);
    if (d.relativeDates !== undefined) setRelativeDates(d.relativeDates);
    if (d.richJsonInspector !== undefined)
      setRichJsonInspector(d.richJsonInspector);
    if (d.dataBars !== undefined) setDataBars(d.dataBars);
    if (d.skeletonLoaders !== undefined)
      setSkeletonLoaders(d.skeletonLoaders);
    setFastTableLoading(resolveFastTableLoading(d));
    if (d.showTabIndicator !== undefined)
      setShowTabIndicator(d.showTabIndicator);
    if (typeof d.iconThemeId === "string" && d.iconThemeId.trim())
      setIconThemeId(d.iconThemeId);
    if ("customIconThemes" in d) {
      setCustomIconThemes(normalizeCustomIconThemes(d.customIconThemes));
    }
    if (d.sleekLayout !== undefined) {
      setSleekLayout(d.sleekLayout);
      setActiveSleekLayout(d.sleekLayout);
    }
    if (d.restoreAppState !== undefined) {
      setRestoreAppState(d.restoreAppState);
    }
    if (d.openConnectionsInNewWindow !== undefined) {
      setOpenConnectionsInNewWindow(d.openConnectionsInNewWindow);
    }
    if (d.schemaExplorer !== undefined) {
      setSchemaExplorer(d.schemaExplorer);
    }
    if (d.databaseExplorer !== undefined) {
      setDatabaseExplorer(d.databaseExplorer);
    }
    if (d.tableExpansion !== undefined) {
      setTableExpansion(d.tableExpansion);
    }
    if (d.hideWindowActions !== undefined) {
      setHideWindowActions(d.hideWindowActions);
    }
    if (d.rlsPolicyTabEditor !== undefined) {
      setRlsPolicyTabEditor(d.rlsPolicyTabEditor);
    }
    if (d.autoClosePane !== undefined) {
      setAutoClosePane(d.autoClosePane);
    }
    if (d.confirmSheetClose !== undefined) {
      setConfirmSheetClose(d.confirmSheetClose);
    }
    if (d.sidebarToggleBeforeConnection !== undefined) {
      setSidebarToggleBeforeConnection(d.sidebarToggleBeforeConnection);
    }
    if (d.autoSaveQueries !== undefined) {
      setAutoSaveQueries(d.autoSaveQueries);
    }
    if (d.vimMode !== undefined) {
      setVimMode(d.vimMode);
    }
    if (d.slashAiTrigger !== undefined) {
      setSlashAiTrigger(d.slashAiTrigger);
    }
    if (d.sqlFormatTabWidth !== undefined) {
      setSqlFormatTabWidth(d.sqlFormatTabWidth);
    }
    if (d.sqlFormatUseTabs !== undefined) {
      setSqlFormatUseTabs(d.sqlFormatUseTabs);
    }
    if (d.sqlFormatKeywordCase !== undefined) {
      setSqlFormatKeywordCase(d.sqlFormatKeywordCase);
    }
    if (d.sqlFormatDataTypeCase !== undefined) {
      setSqlFormatDataTypeCase(d.sqlFormatDataTypeCase);
    }
    if (d.sqlFormatFunctionCase !== undefined) {
      setSqlFormatFunctionCase(d.sqlFormatFunctionCase);
    }
    if (d.sqlFormatIdentifierCase !== undefined) {
      setSqlFormatIdentifierCase(d.sqlFormatIdentifierCase);
    }
    if (d.sqlFormatLogicalOperatorNewline !== undefined) {
      setSqlFormatLogicalOperatorNewline(d.sqlFormatLogicalOperatorNewline);
    }
    if (d.sqlFormatExpressionWidth !== undefined) {
      setSqlFormatExpressionWidth(d.sqlFormatExpressionWidth);
    }
    if (d.sqlFormatLinesBetweenQueries !== undefined) {
      setSqlFormatLinesBetweenQueries(d.sqlFormatLinesBetweenQueries);
    }
    if (d.sqlFormatDenseOperators !== undefined) {
      setSqlFormatDenseOperators(d.sqlFormatDenseOperators);
    }
    if (d.sqlFormatNewlineBeforeSemicolon !== undefined) {
      setSqlFormatNewlineBeforeSemicolon(d.sqlFormatNewlineBeforeSemicolon);
    }
    if (d.showPendingChangesBanner !== undefined) {
      setShowPendingChangesBanner(d.showPendingChangesBanner);
    }
    if (d.previewTabs !== undefined) {
      setPreviewTabs(d.previewTabs);
    }
    if (d.resultTabsEnabled !== undefined) {
      setResultTabsEnabled(d.resultTabsEnabled);
    }
    if (d.noiseBgEnabled !== undefined) {
      setNoiseBgEnabled(d.noiseBgEnabled);
    }
    if (d.noiseBgOpacity !== undefined) {
      setNoiseBgOpacity(d.noiseBgOpacity);
    }
    if (d.noiseBgSize !== undefined) {
      setNoiseBgSize(d.noiseBgSize);
    }
    if (d.noiseBgBlendMode) {
      setNoiseBgBlendMode(d.noiseBgBlendMode);
    }
    if (d.noiseBgColor) {
      setNoiseBgColor(d.noiseBgColor);
    }
    if (d.noiseBgTranslucent !== undefined) {
      setNoiseBgTranslucent(d.noiseBgTranslucent);
    }
  };

  // Current state as a plain record (same shape as the save payload).
  const snapshotCurrent = (): Record<string, unknown> => ({
    appZoom,
    executionMode,
    rowSpacing,
    alternatingRowColors,
    editorFontSize,
    editorFontFamily,
    sqlEditorEngine,
    tuiMode,
    tuiTheme,
    commandMenuSections,
    agentProvider,
    agentModel,
    agentApiKey,
    glassmorphicHeaders,
    gridAnimations,
    sleekSelection,
    colorizedPills,
    relativeDates,
    richJsonInspector,
    dataBars,
    skeletonLoaders,
    fastTableLoading,
    sleekLayout,
    showTabIndicator,
    iconThemeId,
    customIconThemes,
    restoreAppState,
    openConnectionsInNewWindow,
    schemaExplorer,
    databaseExplorer,
    tableExpansion,
    hideWindowActions,
    rlsPolicyTabEditor,
    autoClosePane,
    confirmSheetClose,
    sidebarToggleBeforeConnection,
    showPendingChangesBanner,
    autoSaveQueries,
    vimMode,
    slashAiTrigger,
    previewTabs,
    resultTabsEnabled,
    noiseBgEnabled,
    noiseBgOpacity,
    noiseBgSize,
    noiseBgBlendMode,
    noiseBgColor,
    noiseBgTranslucent,
    sqlFormatTabWidth,
    sqlFormatUseTabs,
    sqlFormatKeywordCase,
    sqlFormatDataTypeCase,
    sqlFormatFunctionCase,
    sqlFormatIdentifierCase,
    sqlFormatLogicalOperatorNewline,
    sqlFormatExpressionWidth,
    sqlFormatLinesBetweenQueries,
    sqlFormatDenseOperators,
    sqlFormatNewlineBeforeSemicolon,
  });

  // Baseline of the last applied record. Seeded with pristine mount-state
  // inside the mount effect below (first-render closure = defaults, so even
  // a frantic first-millisecond toggle can't poison it).
  // A field whose current value differs from baseline was touched locally
  // and must survive incoming loads — this is what stops an in-flight
  // mount GET from swallowing a toggle made milliseconds after open.
  const appliedRef = useRef<Record<string, unknown> | null>(null);
  // Fresh mirror of current state, refreshed after every render so
  // long-lived subscriptions always compare against live values.
  const currentRef = useRef<Record<string, unknown> | null>(null);
  useEffect(() => {
    currentRef.current = snapshotCurrent();
  });
  // Freshness watermark: broadcasts bump it; a fetch that STARTED before
  // the latest broadcast read stale server state and must not apply.
  const freshSeqRef = useRef(0);

  // Ref-safe body (refs + stable setters only) so long-lived subscriptions
  // can call it without capturing stale render state. applyFromRecord only
  // invokes stable setters, so holding its first instance is safe.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const applyRespectingUserEdits = useCallback((incoming: Record<string, unknown>) => {
    const prev = appliedRef.current ?? {};
    const current = currentRef.current ?? {};
    const merged: Record<string, unknown> = { ...incoming };
    for (const key of Object.keys(current)) {
      if (stableStringify(current[key]) !== stableStringify((prev as Record<string, unknown>)[key])) {
        merged[key] = current[key];
      }
    }
    applyFromRecord(merged);
    appliedRef.current = merged;
  }, []);

  useEffect(() => {
    if (appliedRef.current === null) appliedRef.current = snapshotCurrent();
    let cancelled = false;
    const mark = freshSeqRef.current;
    const load = async () => {
      const result = await getGlobalStudioSettings();
      if (cancelled || freshSeqRef.current !== mark) return;
      // A save is landing with fresher state via broadcast — don't paint stale.
      if (inFlightStudioSaves > 0) {
        setIsLoaded(true);
        return;
      }
      if (result.success && result.data) {
        applyRespectingUserEdits(result.data as Record<string, any>);
      }
      setIsLoaded(true);
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cross-instance sync: another hook instance in this window (e.g. the
  // settings dialog) saved — apply its payload directly. No refetch, so a
  // GET can never beat the POST and revert a fresh toggle (the flicker).
  // Payload-less events (other sections) still fall back to a guarded refetch.
  const loadSeqRef = useRef(0);
  useEffect(() => {
    return subscribeSettingsSyncLocalChanged((detail) => {
      const incoming = detail?.studioSettings;
      if (incoming && typeof incoming === "object") {
        freshSeqRef.current += 1;
        applyRespectingUserEdits({
          ...incoming,
          agentApiKey:
            typeof (incoming as Record<string, unknown>).agentApiKey === "string"
              ? (incoming as Record<string, unknown>).agentApiKey
              : agentApiKeyRef.current,
        });
        setIsLoaded(true);
        return;
      }
      const seq = ++loadSeqRef.current;
      const mark = freshSeqRef.current;
      void (async () => {
        const result = await getGlobalStudioSettings();
        if (seq !== loadSeqRef.current || freshSeqRef.current !== mark) return;
        if (inFlightStudioSaves > 0) {
          setIsLoaded(true);
          return;
        }
        if (result.success && result.data) {
          applyRespectingUserEdits(result.data as Record<string, any>);
        }
        setIsLoaded(true);
      })();
    });
  }, [applyRespectingUserEdits]);

  // Single source of truth for terminal-UI application: every consumer of
  // this hook applies the class + persists the localStorage mirror, so
  // toggles work from any screen (connections, studio, …), not just studio.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = document.documentElement;
    if (!tuiMode) {
      root.classList.remove("tui-mode");
      delete root.dataset.tuiTheme;
    } else {
      root.classList.add("tui-mode");
      const resolveTheme = () => {
        if (tuiTheme === "auto") {
          return root.classList.contains("dark") ? "dark" : "light";
        }
        return tuiTheme;
      };
      root.dataset.tuiTheme = resolveTheme();
      if (tuiTheme === "auto") {
        const observer = new MutationObserver(() => {
          root.dataset.tuiTheme = resolveTheme();
        });
        observer.observe(root, { attributes: true, attributeFilter: ["class"] });
        try {
          window.localStorage.setItem("rexa-db-tui-mode", "1");
          window.localStorage.setItem("rexa-db-tui-theme", tuiTheme || "auto");
        } catch {
          /* storage may be unavailable */
        }
        return () => observer.disconnect();
      }
    }
    try {
      window.localStorage.setItem("rexa-db-tui-mode", tuiMode ? "1" : "0");
      window.localStorage.setItem("rexa-db-tui-theme", tuiTheme || "auto");
    } catch {
      /* storage may be unavailable */
    }
    return;
  }, [tuiMode, tuiTheme]);

  useEffect(() => {
    return subscribeSettingsSyncApplied((detail) => {
      const remote = detail.payload.studioSettings;
      if (!remote || typeof remote !== "object") return;
      // Preserve the device-local API key — cloud payload never includes it.
      // Respecting-apply keeps any just-made local edits over the pull.
      applyRespectingUserEdits({
        ...remote,
        agentApiKey: agentApiKeyRef.current,
      });
      setIsLoaded(true);
    });
  }, [applyRespectingUserEdits]);

  // Snapshot of the last saved payload — applying an identical record
  // (our own broadcast echo, cloud echo) must not re-save, or saves and
  // broadcasts ping-pong forever.
  const lastSavedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!persist || !isLoaded) return;
    const payload = {
      appZoom,
      executionMode,
      rowSpacing,
      alternatingRowColors,
      editorFontSize,
      editorFontFamily,
      sqlEditorEngine,
      tuiMode,
      tuiTheme,
      commandMenuSections,
      agentProvider,
      agentModel,
      agentApiKey,
      glassmorphicHeaders,
      gridAnimations,
      sleekSelection,
      colorizedPills,
      relativeDates,
      richJsonInspector,
      dataBars,
      skeletonLoaders,
      fastTableLoading,
      [FAST_TABLE_LOADING_DEFAULT_MIGRATION_KEY]: true,
      sleekLayout,
      showTabIndicator,
      iconThemeId,
      customIconThemes,
      restoreAppState,
      openConnectionsInNewWindow,
      schemaExplorer,
      databaseExplorer,
      tableExpansion,
      hideWindowActions,
      rlsPolicyTabEditor,
      autoClosePane,
      confirmSheetClose,
      sidebarToggleBeforeConnection,
      showPendingChangesBanner,
      autoSaveQueries,
      vimMode,
      slashAiTrigger,
      previewTabs,
      resultTabsEnabled,
      noiseBgEnabled,
      noiseBgOpacity,
      noiseBgSize,
      noiseBgBlendMode,
      noiseBgColor,
      noiseBgTranslucent,
      sqlFormatTabWidth,
      sqlFormatUseTabs,
      sqlFormatKeywordCase,
      sqlFormatDataTypeCase,
      sqlFormatFunctionCase,
      sqlFormatIdentifierCase,
      sqlFormatLogicalOperatorNewline,
      sqlFormatExpressionWidth,
      sqlFormatLinesBetweenQueries,
      sqlFormatDenseOperators,
      sqlFormatNewlineBeforeSemicolon,
    };
    let snapshot = "";
    try {
      snapshot = JSON.stringify(payload);
    } catch {
      snapshot = "";
    }
    if (snapshot && snapshot === lastSavedRef.current) return;
    lastSavedRef.current = snapshot;
    inFlightStudioSaves += 1;
    void saveGlobalStudioSettings(payload).then(
      () => {
        emitSettingsSyncLocalChanged("studioSettings", payload as Record<string, unknown>);
      },
      () => {
        // Save failed — keep local state, but let instances that deferred
        // their initial load to this save refetch instead of staying blank.
        emitSettingsSyncLocalChanged("studioSettings");
      },
    ).finally(() => {
      inFlightStudioSaves -= 1;
    });
  }, [
    persist,
    isLoaded,
    appZoom,
    executionMode,
    rowSpacing,
    alternatingRowColors,
    editorFontSize,
    editorFontFamily,
    sqlEditorEngine,
    tuiMode,
    tuiTheme,
    commandMenuSections,
    agentProvider,
    agentModel,
    agentApiKey,
    glassmorphicHeaders,
    gridAnimations,
    sleekSelection,
    colorizedPills,
    relativeDates,
    richJsonInspector,
    dataBars,
    skeletonLoaders,
    fastTableLoading,
    sleekLayout,
    showTabIndicator,
    iconThemeId,
    customIconThemes,
    restoreAppState,
    openConnectionsInNewWindow,
    schemaExplorer,
    databaseExplorer,
    tableExpansion,
    hideWindowActions,
    rlsPolicyTabEditor,
    autoClosePane,
    confirmSheetClose,
    sidebarToggleBeforeConnection,
    showPendingChangesBanner,
    autoSaveQueries,
    vimMode,
    slashAiTrigger,
    previewTabs,
    resultTabsEnabled,
    noiseBgEnabled,
    noiseBgOpacity,
    noiseBgSize,
    noiseBgBlendMode,
    noiseBgColor,
    noiseBgTranslucent,
    sqlFormatTabWidth,
    sqlFormatUseTabs,
    sqlFormatKeywordCase,
    sqlFormatDataTypeCase,
    sqlFormatFunctionCase,
    sqlFormatIdentifierCase,
    sqlFormatLogicalOperatorNewline,
    sqlFormatExpressionWidth,
    sqlFormatLinesBetweenQueries,
    sqlFormatDenseOperators,
    sqlFormatNewlineBeforeSemicolon,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent(ICON_THEME_UPDATED_EVENT, {
        detail: {
          iconThemeId,
          customIconThemes,
        },
      }),
    );
  }, [iconThemeId, customIconThemes]);

  useEffect(() => {
    setActiveSleekLayout(sleekLayout);
  }, [sleekLayout]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent(ZOOM_UPDATED_EVENT, { detail: { zoom: appZoom } }),
    );
  }, [appZoom]);

  return {
    appZoom,
    setAppZoom,
    executionMode,
    setExecutionMode,
    rowSpacing,
    setRowSpacing,
    alternatingRowColors,
    setAlternatingRowColors,
    editorFontSize,
    setEditorFontSize,
    editorFontFamily,
    setEditorFontFamily,
    sqlEditorEngine,
    setSqlEditorEngine,
    tuiMode,
    setTuiMode,
    tuiTheme,
    setTuiTheme,
    commandMenuSections,
    setCommandMenuSections,
    agentProvider,
    setAgentProvider,
    agentModel,
    setAgentModel,
    agentApiKey,
    setAgentApiKey,
    glassmorphicHeaders,
    setGlassmorphicHeaders,
    gridAnimations,
    setGridAnimations,
    sleekSelection,
    setSleekSelection,
    colorizedPills,
    setColorizedPills,
    relativeDates,
    setRelativeDates,
    richJsonInspector,
    setRichJsonInspector,
    dataBars,
    setDataBars,
    skeletonLoaders,
    setSkeletonLoaders,
    fastTableLoading,
    setFastTableLoading,
    sleekLayout,
    setSleekLayout,
    activeSleekLayout,
    showTabIndicator,
    setShowTabIndicator,
    iconThemeId,
    setIconThemeId,
    customIconThemes,
    setCustomIconThemes,
    restoreAppState,
    setRestoreAppState,
    openConnectionsInNewWindow,
    setOpenConnectionsInNewWindow,
    schemaExplorer,
    setSchemaExplorer,
    databaseExplorer,
    setDatabaseExplorer,
    tableExpansion,
    setTableExpansion,
    hideWindowActions,
    setHideWindowActions,
    rlsPolicyTabEditor,
    setRlsPolicyTabEditor,
    autoClosePane,
    setAutoClosePane,
    confirmSheetClose,
    setConfirmSheetClose,
    sidebarToggleBeforeConnection,
    setSidebarToggleBeforeConnection,
    autoSaveQueries,
    setAutoSaveQueries,
    vimMode,
    setVimMode,
    slashAiTrigger,
    setSlashAiTrigger,
    showPendingChangesBanner,
    setShowPendingChangesBanner,
    previewTabs,
    setPreviewTabs,
    noiseBgEnabled,
    setNoiseBgEnabled,
    noiseBgOpacity,
    setNoiseBgOpacity,
    noiseBgSize,
    setNoiseBgSize,
    noiseBgBlendMode,
    setNoiseBgBlendMode,
    noiseBgColor,
    setNoiseBgColor,
    noiseBgTranslucent,
    setNoiseBgTranslucent,
    resultTabsEnabled,
    setResultTabsEnabled,
    sqlFormatTabWidth,
    setSqlFormatTabWidth,
    sqlFormatUseTabs,
    setSqlFormatUseTabs,
    sqlFormatKeywordCase,
    setSqlFormatKeywordCase,
    sqlFormatDataTypeCase,
    setSqlFormatDataTypeCase,
    sqlFormatFunctionCase,
    setSqlFormatFunctionCase,
    sqlFormatIdentifierCase,
    setSqlFormatIdentifierCase,
    sqlFormatLogicalOperatorNewline,
    setSqlFormatLogicalOperatorNewline,
    sqlFormatExpressionWidth,
    setSqlFormatExpressionWidth,
    sqlFormatLinesBetweenQueries,
    setSqlFormatLinesBetweenQueries,
    sqlFormatDenseOperators,
    setSqlFormatDenseOperators,
    sqlFormatNewlineBeforeSemicolon,
    setSqlFormatNewlineBeforeSemicolon,
    isLoaded,
  };
}
