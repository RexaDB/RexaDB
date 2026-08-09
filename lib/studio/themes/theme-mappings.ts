export type MappingEntry = {
  cssVar: string;
  sources: string[];
  fallback: string;
  derive?: {
    from: string;
    op: "lighten" | "darken" | "saturate" | "desaturate" | "hue-rotate" | "alpha" | "contrast-fg";
    amount?: number;
  };
};

export const MAPPINGS: MappingEntry[] = [
  // ── Core shadcn/ui (existing) ──
  { cssVar: "--background", sources: ["editor.background"], fallback: "#111111" },
  { cssVar: "--foreground", sources: ["editor.foreground"], fallback: "#e2e2e2" },
  { cssVar: "--card", sources: ["editorWidget.background", "sideBar.background", "editor.background"], fallback: "#1a1a1a" },
  { cssVar: "--card-foreground", sources: ["editorWidget.foreground", "editor.foreground"], fallback: "#e2e2e2" },
  { cssVar: "--popover", sources: ["menu.background", "editorWidget.background", "sideBar.background"], fallback: "#1a1a1a" },
  { cssVar: "--popover-foreground", sources: ["menu.foreground", "editorWidget.foreground", "editor.foreground"], fallback: "#e2e2e2" },
  { cssVar: "--primary", sources: ["textLink.foreground", "focusBorder", "button.background", "inputOption.activeBorder"], fallback: "#3b82f6" },
  { cssVar: "--secondary", sources: ["tab.inactiveBackground", "activityBar.inactiveBackground", "sideBarSectionHeader.background"], fallback: "#222222" },
  { cssVar: "--secondary-foreground", sources: ["tab.inactiveForeground", "activityBar.inactiveForeground", "editor.foreground"], fallback: "#a0a0a0" },
  { cssVar: "--muted", sources: ["editor.lineHighlightBackground", "list.hoverBackground", "sideBarSectionHeader.background"], fallback: "#202020" },
  { cssVar: "--muted-foreground", sources: ["editorLineNumber.foreground", "tab.inactiveForeground", "descriptionForeground"], fallback: "#9d9d9d" },
  { cssVar: "--accent", sources: ["list.activeSelectionBackground", "menu.selectionBackground", "editor.selectionBackground"], fallback: "#2a2a2a" },
  { cssVar: "--accent-foreground", sources: ["list.activeSelectionForeground", "menu.selectionForeground", "editor.foreground"], fallback: "#e2e2e2" },
  { cssVar: "--destructive", sources: ["errorForeground", "inputValidation.errorBorder"], fallback: "#ef4444" },
  { cssVar: "--border", sources: ["sideBar.border", "editorGroup.border", "panel.border", "editorGroupHeader.tabsBorder"], fallback: "#2a2a2a" },
  { cssVar: "--input", sources: ["input.background", "dropdown.background", "editor.background"], fallback: "#1a1a1a" },
  { cssVar: "--ring", sources: ["focusBorder", "inputOption.activeBorder", "textLink.foreground"], fallback: "#3b82f6" },
  { cssVar: "--sidebar", sources: ["sideBar.background", "activityBar.background", "editor.background"], fallback: "#111111" },
  { cssVar: "--sidebar-foreground", sources: ["sideBar.foreground", "activityBar.foreground", "editor.foreground"], fallback: "#e2e2e2" },
  { cssVar: "--sidebar-primary", sources: ["textLink.foreground", "focusBorder", "sideBar.foreground"], fallback: "#3b82f6" },
  { cssVar: "--sidebar-accent", sources: ["sideBarSectionHeader.background", "list.activeSelectionBackground"], fallback: "#222222" },
  { cssVar: "--sidebar-accent-foreground", sources: ["sideBarSectionHeader.foreground", "list.activeSelectionForeground"], fallback: "#e2e2e2" },
  { cssVar: "--sidebar-border", sources: ["sideBar.border", "sideBarSectionHeader.border", "sideBar.dropBackground"], fallback: "#2a2a2a" },
  { cssVar: "--sidebar-ring", sources: ["focusBorder", "textLink.foreground"], fallback: "#3b82f6" },
  { cssVar: "--studio-bg", sources: ["editor.background"], fallback: "#111111" },
  { cssVar: "--studio-border", sources: ["editorGroup.border", "editorGroupHeader.tabsBorder", "panel.border"], fallback: "#2a2a2a" },
  { cssVar: "--studio-header-bg", sources: ["titleBar.activeBackground", "activityBar.background", "editor.background"], fallback: "#0a0a0a" },
  { cssVar: "--studio-cell-text", sources: ["editor.foreground"], fallback: "#e2e2e2" },
  { cssVar: "--studio-cell-muted", sources: ["editorLineNumber.foreground"], fallback: "#9d9d9d" },
  { cssVar: "--studio-tab-active", sources: ["tab.activeBackground", "editor.background"], fallback: "#141414" },
  { cssVar: "--studio-tab-inactive", sources: ["tab.inactiveBackground", "activityBar.background", "editor.background"], fallback: "#0a0a0a" },
  { cssVar: "--studio-row-hover", sources: ["list.hoverBackground", "editor.lineHighlightBackground"], fallback: "#1a1a1a" },
  { cssVar: "--studio-selection", sources: ["editor.selectionBackground", "list.activeSelectionBackground"], fallback: "rgba(255,255,255,0.15)" },
  { cssVar: "--studio-accent-purple", sources: [], fallback: "#8b5cf6" },

  // ── Shell chrome (NEW: maps VS Code shell tokens → app shell vars) ──
  { cssVar: "--title-bar-bg", sources: ["titleBar.activeBackground", "activityBar.background"], fallback: "#0a0a0a" },
  { cssVar: "--title-bar-fg", sources: ["titleBar.activeForeground", "activityBar.foreground", "editor.foreground"], fallback: "#e2e2e2" },
  { cssVar: "--activity-bar-bg", sources: ["activityBar.background", "sideBar.background"], fallback: "#111111" },
  { cssVar: "--activity-bar-fg", sources: ["activityBar.foreground", "sideBar.foreground", "editor.foreground"], fallback: "#ffffff" },
  { cssVar: "--activity-bar-inactive", sources: ["activityBar.inactiveForeground"], fallback: "#858585" },
  { cssVar: "--activity-bar-active-border", sources: ["activityBar.activeBorder", "focusBorder"], fallback: "#ffffff" },
  { cssVar: "--side-bar-bg", sources: ["sideBar.background", "activityBar.background"], fallback: "#111111" },
  { cssVar: "--side-bar-fg", sources: ["sideBar.foreground", "activityBar.foreground", "editor.foreground"], fallback: "#e2e2e2" },
  { cssVar: "--side-bar-header-bg", sources: ["sideBarSectionHeader.background", "sideBar.background"], fallback: "#1a1a1a" },
  { cssVar: "--panel-bg", sources: ["panel.background", "editor.background"], fallback: "#111111" },
  { cssVar: "--panel-fg", sources: ["panelTitle.activeForeground", "editor.foreground"], fallback: "#e2e2e2" },
  { cssVar: "--panel-border", sources: ["panel.border", "editorGroup.border"], fallback: "#2a2a2a" },
  { cssVar: "--panel-header-bg", sources: ["panel.background", "sideBarSectionHeader.background"], fallback: "#1a1a1a" },
  { cssVar: "--status-bar-bg", sources: ["statusBar.background", "activityBar.background"], fallback: "#007acc" },
  { cssVar: "--status-bar-fg", sources: ["statusBar.foreground", "activityBar.foreground"], fallback: "#ffffff" },

  // ── Shell derived (derived from core/chrome vars) ──
  { cssVar: "--shell-bg", sources: [], fallback: "#070707", derive: { from: "--background", op: "darken", amount: 4 } },
  { cssVar: "--shell-fg", sources: [], fallback: "#ffffff", derive: { from: "--foreground", op: "lighten", amount: 5 } },
  { cssVar: "--shell-fg-muted", sources: [], fallback: "#666666", derive: { from: "--muted-foreground", op: "lighten", amount: 0 } },
  { cssVar: "--shell-border", sources: [], fallback: "#434343", derive: { from: "--border", op: "lighten", amount: 8 } },
  { cssVar: "--shell-chip", sources: [], fallback: "#232323", derive: { from: "--sidebar", op: "darken", amount: 3 } },
  { cssVar: "--shell-chip-hover", sources: [], fallback: "#2a2a2a", derive: { from: "--shell-chip", op: "lighten", amount: 5 } },
  { cssVar: "--shell-chip-active", sources: [], fallback: "#151515", derive: { from: "--shell-chip", op: "darken", amount: 5 } },
  { cssVar: "--shell-sidebar", sources: [], fallback: "#232323", derive: { from: "--sidebar", op: "darken", amount: 2 } },
  { cssVar: "--shell-panel", sources: [], fallback: "#151515", derive: { from: "--background", op: "darken", amount: 2 } },

  // ── Tabs (NEW) ──
  { cssVar: "--tab-active-bg", sources: ["tab.activeBackground", "editor.background"], fallback: "#141414" },
  { cssVar: "--tab-active-fg", sources: ["tab.activeForeground", "editor.foreground"], fallback: "#e2e2e2" },
  { cssVar: "--tab-inactive-bg", sources: ["tab.inactiveBackground", "activityBar.background", "editor.background"], fallback: "#0a0a0a" },
  { cssVar: "--tab-inactive-fg", sources: ["tab.inactiveForeground", "activityBar.inactiveForeground"], fallback: "#666666" },
  { cssVar: "--tab-hover-bg", sources: ["tab.hoverBackground", "list.hoverBackground"], fallback: "#1a1a1a" },
  { cssVar: "--tab-border", sources: ["tab.border", "editorGroupHeader.tabsBorder"], fallback: "#2a2a2a" },
  { cssVar: "--tab-active-border-top", sources: ["tab.activeBorderTop", "activityBar.activeBorder", "focusBorder"], fallback: "#007acc" },

  // ── Editor widgets / overlays (NEW) ──
  { cssVar: "--editor-widget-bg", sources: ["editorWidget.background", "editor.background"], fallback: "#1a1a1a" },
  { cssVar: "--editor-widget-fg", sources: ["editorWidget.foreground", "editor.foreground"], fallback: "#e2e2e2" },
  { cssVar: "--editor-widget-border", sources: ["editorWidget.border", "editorGroup.border"], fallback: "#2a2a2a" },
  { cssVar: "--menu-bg", sources: ["menu.background", "editorWidget.background"], fallback: "#1a1a1a" },
  { cssVar: "--menu-fg", sources: ["menu.foreground", "editorWidget.foreground"], fallback: "#e2e2e2" },
  { cssVar: "--menu-separator", sources: ["menu.separatorBackground", "menu.border", "editorWidget.border"], fallback: "#2a2a2a" },
  { cssVar: "--notification-bg", sources: ["notificationCenter.background", "notificationCenterHeader.background", "editorWidget.background"], fallback: "#1a1a1a" },
  { cssVar: "--notification-fg", sources: ["notifications.foreground", "editorWidget.foreground", "editor.foreground"], fallback: "#e2e2e2" },
  { cssVar: "--notification-border", sources: ["notifications.border", "editorWidget.border"], fallback: "#2a2a2a" },

  // ── Controls: button, badge, input, progress (NEW) ──
  { cssVar: "--button-bg", sources: ["button.background", "textLink.foreground"], fallback: "#3b82f6" },
  { cssVar: "--button-fg", sources: ["button.foreground"], fallback: "#ffffff" },
  { cssVar: "--button-hover-bg", sources: ["button.hoverBackground"], fallback: "#2563eb", derive: { from: "--button-bg", op: "darken", amount: 8 } },
  { cssVar: "--badge-bg", sources: ["badge.background", "button.background"], fallback: "#3b82f6" },
  { cssVar: "--badge-fg", sources: ["badge.foreground", "button.foreground"], fallback: "#ffffff" },
  { cssVar: "--input-bg", sources: ["input.background", "dropdown.background", "editor.background"], fallback: "#1a1a1a" },
  { cssVar: "--input-fg", sources: ["input.foreground", "dropdown.foreground", "editor.foreground"], fallback: "#e2e2e2" },
  { cssVar: "--input-border", sources: ["input.border", "editorWidget.border", "sideBar.border"], fallback: "#2a2a2a" },
  { cssVar: "--input-placeholder", sources: ["input.placeholderForeground", "descriptionForeground"], fallback: "#9d9d9d" },
  { cssVar: "--progress-bar-bg", sources: ["progressBar.background", "button.background", "textLink.foreground"], fallback: "#3b82f6" },

  // ── Scrollbar (NEW) ──
  { cssVar: "--scrollbar-bg", sources: ["scrollbarSlider.background"], fallback: "rgba(255,255,255,0.1)" },
  { cssVar: "--scrollbar-hover-bg", sources: ["scrollbarSlider.hoverBackground", "scrollbarSlider.background"], fallback: "rgba(255,255,255,0.15)" },
  { cssVar: "--scrollbar-active-bg", sources: ["scrollbarSlider.activeBackground", "scrollbarSlider.hoverBackground"], fallback: "rgba(255,255,255,0.2)" },

  // ── List / selection (NEW) ──
  { cssVar: "--list-hover-bg", sources: ["list.hoverBackground", "editor.lineHighlightBackground"], fallback: "#1a1a1a" },
  { cssVar: "--list-hover-fg", sources: ["list.hoverForeground", "editor.foreground"], fallback: "#e2e2e2" },
  { cssVar: "--list-active-bg", sources: ["list.activeSelectionBackground", "menu.selectionBackground"], fallback: "#2a2a2a" },
  { cssVar: "--list-active-fg", sources: ["list.activeSelectionForeground", "menu.selectionForeground"], fallback: "#e2e2e2" },
  { cssVar: "--list-focus-bg", sources: ["list.focusBackground", "list.activeSelectionBackground"], fallback: "#2a2a2a" },
  { cssVar: "--list-focus-fg", sources: ["list.focusForeground", "list.activeSelectionForeground"], fallback: "#e2e2e2" },

  // ── Editor group / gutter (NEW) ──
  { cssVar: "--editor-group-bg", sources: ["editorGroup.background", "editor.background"], fallback: "#111111" },
  { cssVar: "--editor-group-border", sources: ["editorGroup.border", "panel.border"], fallback: "#2a2a2a" },
  { cssVar: "--editor-group-tabs-bg", sources: ["editorGroupHeader.tabsBackground", "activityBar.background"], fallback: "#0a0a0a" },
  { cssVar: "--editor-group-tabs-border", sources: ["editorGroupHeader.tabsBorder", "editorGroup.border"], fallback: "#2a2a2a" },

  // ── Syntax tokens (populated by tokenColors extraction, not VS Code colors) ──
  { cssVar: "--syntax-keyword", sources: [], fallback: "#569cd6" },
  { cssVar: "--syntax-string", sources: [], fallback: "#ce9178" },
  { cssVar: "--syntax-number", sources: [], fallback: "#b5cea8" },
  { cssVar: "--syntax-function", sources: [], fallback: "#dcdcaa" },
  { cssVar: "--syntax-variable", sources: [], fallback: "#9cdcfe" },
  { cssVar: "--syntax-comment", sources: [], fallback: "#6a9955" },
  { cssVar: "--syntax-type", sources: [], fallback: "#4ec9b0" },
];
