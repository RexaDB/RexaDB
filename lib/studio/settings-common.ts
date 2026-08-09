const COMMON_SETTING_PAIRS = [
  ["confirmSheetClose", "setConfirmSheetClose"],
  ["sidebarToggleBeforeConnection", "setSidebarToggleBeforeConnection"],
  ["autoSaveQueries", "setAutoSaveQueries"],
  ["vimMode", "setVimMode"],
  ["slashAiTrigger", "setSlashAiTrigger"],
  ["resultTabsEnabled", "setResultTabsEnabled"],
  ["sqlFormatTabWidth", "setSqlFormatTabWidth"],
  ["sqlFormatUseTabs", "setSqlFormatUseTabs"],
  ["sqlFormatKeywordCase", "setSqlFormatKeywordCase"],
  ["sqlFormatDataTypeCase", "setSqlFormatDataTypeCase"],
  ["sqlFormatFunctionCase", "setSqlFormatFunctionCase"],
  ["sqlFormatIdentifierCase", "setSqlFormatIdentifierCase"],
  ["sqlFormatLogicalOperatorNewline", "setSqlFormatLogicalOperatorNewline"],
  ["sqlFormatExpressionWidth", "setSqlFormatExpressionWidth"],
  ["sqlFormatLinesBetweenQueries", "setSqlFormatLinesBetweenQueries"],
  ["sqlFormatDenseOperators", "setSqlFormatDenseOperators"],
  ["sqlFormatNewlineBeforeSemicolon", "setSqlFormatNewlineBeforeSemicolon"],
] as const;

export function pickCommonSettings(source: any): any {
  const result: any = {};
  for (const [k, sk] of COMMON_SETTING_PAIRS) {
    if (k in source) result[k] = source[k];
    if (sk in source) result[sk] = source[sk];
  }
  return result;
}
