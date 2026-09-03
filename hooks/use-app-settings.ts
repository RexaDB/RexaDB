"use client";

import { useEffect, useRef, useState } from "react";
import { useGlobalStudioSettings } from "@/hooks/use-global-studio-settings";
import { useGlobalEditorTheme } from "@/hooks/use-global-editor-theme";
import { useGlobalAppTheme } from "@/hooks/use-global-app-theme";
import { useGlobalAppFontFamily } from "@/hooks/use-global-app-font-family";
import {
  getDefaultKeybindings,
  normalizeKeybindingsForPlatform,
  withMissingDefaultKeybindings,
} from "@/lib/studio/keybindings";
import {
  getKeybindingsFile,
  saveKeybindingsFile,
} from "@/lib/api/actions-client";

export function useAppSettings(planCode = "free") {
  const settings = useGlobalStudioSettings(true);
  const editor = useGlobalEditorTheme(true);
  const appTheme = useGlobalAppTheme(true);
  const font = useGlobalAppFontFamily(true);

  // Keybindings are a global preference (keybindings.json), not per-connection.
  // The connections-page settings shell has no studio instance to provide them,
  // so load them here — otherwise KeybindingsPanel crashes on undefined.
  const [keybindings, setKeybindings] = useState<Record<string, any>>(() =>
    normalizeKeybindingsForPlatform(getDefaultKeybindings()),
  );
  const keybindingsDidMountRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    getKeybindingsFile()
      .then((res) => {
        if (cancelled) return;
        if (res?.success && res.data) {
          setKeybindings(
            normalizeKeybindingsForPlatform(
              withMissingDefaultKeybindings(res.data),
            ),
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!keybindingsDidMountRef.current) {
      keybindingsDidMountRef.current = true;
      return;
    }
    void saveKeybindingsFile(keybindings).catch(() => {});
  }, [keybindings]);

  return {
    appZoom: settings.appZoom,
    setAppZoom: settings.setAppZoom,
    executionMode: settings.executionMode,
    setExecutionMode: settings.setExecutionMode,
    rowSpacing: settings.rowSpacing,
    setRowSpacing: settings.setRowSpacing,
    alternatingRowColors: settings.alternatingRowColors,
    setAlternatingRowColors: settings.setAlternatingRowColors,
    editorFontSize: settings.editorFontSize,
    setEditorFontSize: settings.setEditorFontSize,
    sqlEditorEngine: settings.sqlEditorEngine,
    setSqlEditorEngine: settings.setSqlEditorEngine,
    editorThemeId: editor.editorThemeId,
    setEditorThemeId: editor.setEditorThemeId,
    customEditorThemes: editor.customEditorThemes,
    setCustomEditorThemes: editor.setCustomEditorThemes,
    appThemeId: appTheme.appThemeId,
    setAppThemeId: appTheme.setAppThemeId,
    customAppThemes: appTheme.customAppThemes,
    setCustomAppThemes: appTheme.setCustomAppThemes,
    customFontFamily: font.customFontFamily,
    setCustomFontFamily: font.setCustomFontFamily,
    iconThemeId: settings.iconThemeId,
    setIconThemeId: settings.setIconThemeId,
    customIconThemes: settings.customIconThemes,
    setCustomIconThemes: settings.setCustomIconThemes,
    tuiMode: settings.tuiMode,
    setTuiMode: settings.setTuiMode,
    tuiTheme: settings.tuiTheme,
    setTuiTheme: settings.setTuiTheme,
    commandMenuSections: settings.commandMenuSections,
    setCommandMenuSections: settings.setCommandMenuSections,
    planCode,
    glassmorphicHeaders: settings.glassmorphicHeaders,
    setGlassmorphicHeaders: settings.setGlassmorphicHeaders,
    gridAnimations: settings.gridAnimations,
    setGridAnimations: settings.setGridAnimations,
    sleekSelection: settings.sleekSelection,
    setSleekSelection: settings.setSleekSelection,
    colorizedPills: settings.colorizedPills,
    setColorizedPills: settings.setColorizedPills,
    relativeDates: settings.relativeDates,
    setRelativeDates: settings.setRelativeDates,
    richJsonInspector: settings.richJsonInspector,
    setRichJsonInspector: settings.setRichJsonInspector,
    dataBars: settings.dataBars,
    setDataBars: settings.setDataBars,
    skeletonLoaders: settings.skeletonLoaders,
    setSkeletonLoaders: settings.setSkeletonLoaders,
    sleekLayout: settings.sleekLayout,
    setSleekLayout: settings.setSleekLayout,
    activeSleekLayout: settings.activeSleekLayout,
    showTabIndicator: settings.showTabIndicator,
    setShowTabIndicator: settings.setShowTabIndicator,
    restoreAppState: settings.restoreAppState,
    setRestoreAppState: settings.setRestoreAppState,
    schemaExplorer: settings.schemaExplorer,
    setSchemaExplorer: settings.setSchemaExplorer,
    databaseExplorer: settings.databaseExplorer,
    setDatabaseExplorer: settings.setDatabaseExplorer,
    tableExpansion: settings.tableExpansion,
    setTableExpansion: settings.setTableExpansion,
    hideWindowActions: settings.hideWindowActions,
    setHideWindowActions: settings.setHideWindowActions,
    rlsPolicyTabEditor: settings.rlsPolicyTabEditor,
    setRlsPolicyTabEditor: settings.setRlsPolicyTabEditor,
    confirmSheetClose: settings.confirmSheetClose,
    setConfirmSheetClose: settings.setConfirmSheetClose,
    sidebarToggleBeforeConnection: settings.sidebarToggleBeforeConnection,
    setSidebarToggleBeforeConnection: settings.setSidebarToggleBeforeConnection,
    autoSaveQueries: settings.autoSaveQueries,
    setAutoSaveQueries: settings.setAutoSaveQueries,
    keybindings,
    setKeybindings,
    vimMode: settings.vimMode,
    setVimMode: settings.setVimMode,
    sqlFormatTabWidth: settings.sqlFormatTabWidth,
    setSqlFormatTabWidth: settings.setSqlFormatTabWidth,
    sqlFormatUseTabs: settings.sqlFormatUseTabs,
    setSqlFormatUseTabs: settings.setSqlFormatUseTabs,
    sqlFormatKeywordCase: settings.sqlFormatKeywordCase,
    setSqlFormatKeywordCase: settings.setSqlFormatKeywordCase,
    sqlFormatDataTypeCase: settings.sqlFormatDataTypeCase,
    setSqlFormatDataTypeCase: settings.setSqlFormatDataTypeCase,
    sqlFormatFunctionCase: settings.sqlFormatFunctionCase,
    setSqlFormatFunctionCase: settings.setSqlFormatFunctionCase,
    sqlFormatIdentifierCase: settings.sqlFormatIdentifierCase,
    setSqlFormatIdentifierCase: settings.setSqlFormatIdentifierCase,
    sqlFormatLogicalOperatorNewline: settings.sqlFormatLogicalOperatorNewline,
    setSqlFormatLogicalOperatorNewline: settings.setSqlFormatLogicalOperatorNewline,
    sqlFormatExpressionWidth: settings.sqlFormatExpressionWidth,
    setSqlFormatExpressionWidth: settings.setSqlFormatExpressionWidth,
    sqlFormatLinesBetweenQueries: settings.sqlFormatLinesBetweenQueries,
    setSqlFormatLinesBetweenQueries: settings.setSqlFormatLinesBetweenQueries,
    sqlFormatDenseOperators: settings.sqlFormatDenseOperators,
    setSqlFormatDenseOperators: settings.setSqlFormatDenseOperators,
    sqlFormatNewlineBeforeSemicolon: settings.sqlFormatNewlineBeforeSemicolon,
    setSqlFormatNewlineBeforeSemicolon: settings.setSqlFormatNewlineBeforeSemicolon,
    noiseBgEnabled: settings.noiseBgEnabled,
    setNoiseBgEnabled: settings.setNoiseBgEnabled,
    noiseBgOpacity: settings.noiseBgOpacity,
    setNoiseBgOpacity: settings.setNoiseBgOpacity,
    noiseBgSize: settings.noiseBgSize,
    setNoiseBgSize: settings.setNoiseBgSize,
    noiseBgBlendMode: settings.noiseBgBlendMode,
    setNoiseBgBlendMode: settings.setNoiseBgBlendMode,
    noiseBgColor: settings.noiseBgColor,
    setNoiseBgColor: settings.setNoiseBgColor,
    noiseBgTranslucent: settings.noiseBgTranslucent,
    setNoiseBgTranslucent: settings.setNoiseBgTranslucent,
    isLoaded: settings.isLoaded,
  };
}
