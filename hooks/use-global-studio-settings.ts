"use client";

import { useEffect, useState } from "react";
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

export const ZOOM_UPDATED_EVENT = "rexadb-zoom-updated";

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
  sleekLayout: boolean;
  appShellLayout: boolean;
  modernUiLayout: boolean;
  showTabIndicator: boolean;
  iconThemeId: string;
  customIconThemes: CustomIconTheme[];
  restoreAppState: boolean;
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
  const [sleekLayout, setSleekLayout] = useState<boolean>(false);
  const [activeSleekLayout, setActiveSleekLayout] = useState<boolean>(false);
  const [appShellLayout, setAppShellLayout] = useState<boolean>(true);
  const [modernUiLayout, setModernUiLayout] = useState<boolean>(false);
  const [showTabIndicator, setShowTabIndicator] = useState<boolean>(true);
  const [iconThemeId, setIconThemeId] = useState<string>(DEFAULT_ICON_THEME_ID);
  const [customIconThemes, setCustomIconThemes] = useState<CustomIconTheme[]>(
    [],
  );
  const [restoreAppState, setRestoreAppState] = useState<boolean>(true);
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

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const result = await getGlobalStudioSettings();
      if (cancelled) return;
      if (result.success && result.data) {
        const d = result.data;
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
        if (d.agentApiKey) setAgentApiKey(d.agentApiKey);

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
        if (d.showTabIndicator !== undefined)
          setShowTabIndicator(d.showTabIndicator);
        if (typeof d.iconThemeId === "string" && d.iconThemeId.trim())
          setIconThemeId(d.iconThemeId);
        setCustomIconThemes(normalizeCustomIconThemes(d.customIconThemes));
        if (d.sleekLayout !== undefined) {
          setSleekLayout(d.sleekLayout);
          setActiveSleekLayout(d.sleekLayout);
        }
        if (d.appShellLayout !== undefined) {
          setAppShellLayout(d.appShellLayout);
        }
        if (d.modernUiLayout !== undefined) {
          setModernUiLayout(d.modernUiLayout);
        }
        if (d.restoreAppState !== undefined) {
          setRestoreAppState(d.restoreAppState);
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
      }
      setIsLoaded(true);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!persist || !isLoaded) return;
    void saveGlobalStudioSettings({
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
      sleekLayout,
      appShellLayout,
      modernUiLayout,
      showTabIndicator,
      iconThemeId,
      customIconThemes,
      restoreAppState,
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
    sleekLayout,
    appShellLayout,
    modernUiLayout,
    showTabIndicator,
    iconThemeId,
    customIconThemes,
    restoreAppState,
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
    sleekLayout,
    setSleekLayout,
    activeSleekLayout,
    appShellLayout,
    setAppShellLayout,
    modernUiLayout,
    setModernUiLayout,
    showTabIndicator,
    setShowTabIndicator,
    iconThemeId,
    setIconThemeId,
    customIconThemes,
    setCustomIconThemes,
    restoreAppState,
    setRestoreAppState,
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
