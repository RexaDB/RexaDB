"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Eye,
  GripVertical,
  Check,
  ExternalLink,
  Globe,
  Upload,
  Code,
  Server,
  Key,
  User,
  CheckCircle2,
  ArrowRight,
  LogOut,
  Loader2,
  XCircle,
  Shield,
  Trash2,
} from "@/lib/icon-theme/lucide-react";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuthState } from "@/hooks/use-auth-state";
import { useEntitlementState } from "@/hooks/use-entitlement-state";
import { buildEntitlementCacheMessage } from "@/lib/billing/entitlement-display";
import {
  initStudioAuth,
  loadStudioAuth,
  saveStudioAuth,
  setStudioConfig,
  clearAllStudioData,
  getStudioUrl,
  setStudioUrl,
  addWorkspace,
  disconnectStudioWorkspace,
  listWorkspaces,
  switchWorkspace,
  removeWorkspace,
  type WorkspaceInfo,
} from "@/lib/studio-backend/auth-store";
import { studioApi, StudioApiError } from "@/lib/studio-backend/api-client";
import {
  createThemeId,
  parseThemeJson,
  type CustomEditorTheme,
} from "@/lib/studio/editor-themes";
import {
  BUILTIN_APP_THEMES,
  type CustomAppTheme,
} from "@/lib/studio/app-themes";
import { AiSettingsSection } from "@/components/studio/ai/ai-settings-section";
import { AiProvidersPage } from "@/components/studio/ai/ai-providers-page";
import { IconThemeSetting } from "@/components/studio/settings/icon-theme-setting";
import { CustomFontSetting } from "@/components/studio/settings/custom-font-setting";
import { ThemesSection } from "@/components/studio/settings/themes-section";
import { SqlEditorEngineSetting } from "@/components/studio/settings/sql-editor-engine-setting";
import { ZoomSetting } from "@/components/studio/settings/zoom-setting";
import {
  SettingsSidebar,
  type SettingsSectionId,
} from "@/components/studio/settings/settings-sidebar";
import type { SqlEditorEngine } from "@/lib/studio/types";
import type { CustomIconTheme } from "@/lib/icon-theme/types";
import { useAppUpdate } from "@/hooks/use-app-update";
import { pickCommonSettings } from "@/lib/studio/settings-common";
import { KeybindingsPanel } from "@/components/studio/keybindings-view";
import { McpSettingsSection } from "@/components/studio/settings/mcp-settings-section";

function AddThemeMenu({
  onBrowseThemes,
  onCustomTheme,
  icon: Icon,
}: {
  onBrowseThemes: () => void;
  onCustomTheme?: () => void;
  icon: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" className="h-7 px-2.5 text-xs">
          Add Theme
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-48 bg-popover border-border"
      >
        <DropdownMenuItem
          className="text-xs gap-2 cursor-pointer"
          onClick={onBrowseThemes}
        >
          <Globe className="w-3.5 h-3.5" />
          Browse Themes
        </DropdownMenuItem>
        {onCustomTheme ? (
          <DropdownMenuItem
            className="text-xs gap-2 cursor-pointer"
            onClick={onCustomTheme}
          >
            {Icon}
            Custom Theme
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ThemeDialogConfig {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  nameValue: string;
  onNameChange: (value: string) => void;
  jsonValue: string;
  onJsonChange: (value: string) => void;
  jsonPlaceholder: string;
  fileName: string | null;
  onFileUpload: (file: File | null) => void;
  onCancel: () => void;
  onAdd: () => void;
  dialogPos: { x: number; y: number };
  onDialogHeaderMouseDown: (e: React.MouseEvent) => void;
}

function ThemeAddDialog(cfg: ThemeDialogConfig) {
  return (
    <Dialog open={cfg.open} onOpenChange={cfg.onOpenChange} modal={false}>
      <DialogContent
        className="max-w-2xl max-h-[80vh]"
        overlayClassName="!bg-transparent !backdrop-blur-none pointer-events-none"
        style={{
          top: cfg.dialogPos.y,
          left: cfg.dialogPos.x,
          transform: "none",
        }}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader
          onMouseDown={cfg.onDialogHeaderMouseDown}
          className="cursor-grab active:cursor-grabbing select-none"
        >
          <DialogTitle>{cfg.title}</DialogTitle>
          <DialogDescription>{cfg.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground">
              Theme Name
            </label>
            <Input
              value={cfg.nameValue}
              onChange={(e) => cfg.onNameChange(e.target.value)}
              placeholder="My Custom Theme"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground">
              Theme JSON
            </label>
            <Textarea
              value={cfg.jsonValue}
              onChange={(e) => cfg.onJsonChange(e.target.value)}
              placeholder={cfg.jsonPlaceholder}
              className="min-h-[200px] max-h-[300px] font-mono text-xs"
            />
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs text-muted-foreground">
                {cfg.fileName
                  ? `Loaded: ${cfg.fileName}`
                  : "Upload a .json theme file"}
              </label>
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => cfg.onFileUpload(e.target.files?.[0] || null)}
                className="text-xs text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-secondary/60 file:px-3 file:py-1 file:text-xs file:font-medium file:text-foreground"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={cfg.onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={cfg.onAdd}>
            Add Theme
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ThemeSelectSection({
  value,
  onValueChange,
  builtInThemes,
  customThemes,
  onCustomTheme,
  onBrowseThemes,
  icon,
}: {
  value: string;
  onValueChange: (v: string) => void;
  builtInThemes: Array<{ id: string; label: string }>;
  customThemes: Array<{ id: string; name: string }>;
  onCustomTheme?: () => void;
  onBrowseThemes: () => void;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="h-8 w-48 bg-secondary/50 border-border text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-popover border-border">
          {builtInThemes.map((theme) => (
            <SelectItem key={theme.id} value={theme.id}>
              {theme.label}
            </SelectItem>
          ))}
          {customThemes.length > 0 ? (
            <div className="px-2 py-1 text-xstracking-wide text-muted-foreground">
              Custom
            </div>
          ) : null}
          {customThemes.map((theme) => (
            <SelectItem key={theme.id} value={theme.id}>
              {theme.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <AddThemeMenu
        onBrowseThemes={onBrowseThemes}
        onCustomTheme={onCustomTheme}
        icon={icon}
      />
    </div>
  );
}

interface CommandMenuSection {
  id: string;
  name: string;
  isVisible: boolean;
}

interface StudioSettingsModel {
  appZoom: number;
  setAppZoom: (value: number) => void;
  executionMode: "direct" | "review";
  setExecutionMode: (value: "direct" | "review") => void;
  rowSpacing: "compact" | "standard" | "relaxed";
  setRowSpacing: (value: "compact" | "standard" | "relaxed") => void;
  alternatingRowColors: boolean;
  setAlternatingRowColors: (value: boolean) => void;
  editorFontSize: string;
  setEditorFontSize: (value: string) => void;
  editorFontFamily: string;
  setEditorFontFamily: (value: string) => void;
  sqlEditorEngine: SqlEditorEngine;
  setSqlEditorEngine: (value: SqlEditorEngine) => void;
  editorThemeId: string;
  setEditorThemeId: (value: string) => void;
  customEditorThemes: CustomEditorTheme[];
  setCustomEditorThemes: Dispatch<SetStateAction<CustomEditorTheme[]>>;
  appThemeId: string;
  setAppThemeId: (value: string) => void;
  customAppThemes: CustomAppTheme[];
  setCustomAppThemes: Dispatch<SetStateAction<CustomAppTheme[]>>;
  customFontFamily: string;
  setCustomFontFamily: (value: string) => void;
  iconThemeId: string;
  setIconThemeId: (value: string) => void;
  customIconThemes: CustomIconTheme[];
  setCustomIconThemes: Dispatch<SetStateAction<CustomIconTheme[]>>;
  tuiMode: boolean;
  setTuiMode: (value: boolean) => void;
  tuiTheme: "auto" | "light" | "dark";
  setTuiTheme: (value: "auto" | "light" | "dark") => void;
  commandMenuSections: CommandMenuSection[];
  setCommandMenuSections: Dispatch<SetStateAction<CommandMenuSection[]>>;
  planCode: string;

  glassmorphicHeaders: boolean;
  setGlassmorphicHeaders: (value: boolean) => void;
  gridAnimations: boolean;
  setGridAnimations: (value: boolean) => void;
  sleekSelection: boolean;
  setSleekSelection: (value: boolean) => void;
  colorizedPills: boolean;
  setColorizedPills: (value: boolean) => void;
  relativeDates: boolean;
  setRelativeDates: (value: boolean) => void;
  richJsonInspector: boolean;
  setRichJsonInspector: (value: boolean) => void;
  dataBars: boolean;
  setDataBars: (value: boolean) => void;
  skeletonLoaders: boolean;
  setSkeletonLoaders: (value: boolean) => void;
  sleekLayout: boolean;
  setSleekLayout: (value: boolean) => void;
  activeSleekLayout: boolean;
  showTabIndicator: boolean;
  setShowTabIndicator: (value: boolean) => void;
  restoreAppState: boolean;
  setRestoreAppState: (value: boolean) => void;
  schemaExplorer: boolean;
  setSchemaExplorer: (value: boolean) => void;
  databaseExplorer: boolean;
  setDatabaseExplorer: (value: boolean) => void;
  hideWindowActions: boolean;
  setHideWindowActions: (value: boolean) => void;
  autoClosePane: boolean;
  setAutoClosePane: (value: boolean) => void;
  rlsPolicyTabEditor: boolean;
  setRlsPolicyTabEditor: (value: boolean) => void;
  tableExpansion: boolean;
  setTableExpansion: (value: boolean) => void;
  confirmSheetClose: boolean;
  setConfirmSheetClose: (value: boolean) => void;
  sidebarToggleBeforeConnection: boolean;
  setSidebarToggleBeforeConnection: (value: boolean) => void;
  autoSaveQueries: boolean;
  setAutoSaveQueries: (value: boolean) => void;
  vimMode: boolean;
  setVimMode: (value: boolean) => void;
  slashAiTrigger: boolean;
  setSlashAiTrigger: (value: boolean) => void;
  resultTabsEnabled: boolean;
  setResultTabsEnabled: (value: boolean) => void;
  showPendingChangesBanner: boolean;
  setShowPendingChangesBanner: (value: boolean) => void;
  previewTabs: boolean;
  setPreviewTabs: (value: boolean) => void;
  noiseBgEnabled: boolean;
  setNoiseBgEnabled: (value: boolean) => void;
  noiseBgOpacity: number;
  setNoiseBgOpacity: (value: number) => void;
  noiseBgSize: number;
  setNoiseBgSize: (value: number) => void;
  noiseBgBlendMode: "overlay" | "soft-light" | "multiply" | "screen";
  setNoiseBgBlendMode: (value: "overlay" | "soft-light" | "multiply" | "screen") => void;
  noiseBgColor: string;
  setNoiseBgColor: (value: string) => void;
  noiseBgTranslucent: boolean;
  setNoiseBgTranslucent: (value: boolean) => void;
  sqlFormatTabWidth: number;
  setSqlFormatTabWidth: (value: number) => void;
  sqlFormatUseTabs: boolean;
  setSqlFormatUseTabs: (value: boolean) => void;
  sqlFormatKeywordCase: "preserve" | "upper" | "lower";
  setSqlFormatKeywordCase: (value: "preserve" | "upper" | "lower") => void;
  sqlFormatDataTypeCase: "preserve" | "upper" | "lower";
  setSqlFormatDataTypeCase: (value: "preserve" | "upper" | "lower") => void;
  sqlFormatFunctionCase: "preserve" | "upper" | "lower";
  setSqlFormatFunctionCase: (value: "preserve" | "upper" | "lower") => void;
  sqlFormatIdentifierCase: "preserve" | "upper" | "lower";
  setSqlFormatIdentifierCase: (value: "preserve" | "upper" | "lower") => void;
  sqlFormatLogicalOperatorNewline: "before" | "after";
  setSqlFormatLogicalOperatorNewline: (value: "before" | "after") => void;
  sqlFormatExpressionWidth: number;
  setSqlFormatExpressionWidth: (value: number) => void;
  sqlFormatLinesBetweenQueries: number;
  setSqlFormatLinesBetweenQueries: (value: number) => void;
  sqlFormatDenseOperators: boolean;
  setSqlFormatDenseOperators: (value: boolean) => void;
  sqlFormatNewlineBeforeSemicolon: boolean;
  setSqlFormatNewlineBeforeSemicolon: (value: boolean) => void;
  searchSettings: any;
  setSearchSettings: (value: any) => void;
  settingsInitialSection?: SettingsSectionId;
  keybindings: Record<string, any>;
  setKeybindings: Dispatch<SetStateAction<Record<string, any>>>;
}

interface SettingsViewProps {
  studio: StudioSettingsModel;
  onOpenThemeCreator?: () => void;
  onOpenIconThemeCreator?: () => void;
}

export function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-t border-border py-3">
      <div className="flex flex-col">
        <span className="font-medium text-xs">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      {children}
    </div>
  );
}

function ToggleSetting({
  title,
  description,
  value,
  onChange,
}: {
  title: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <SettingRow title={title} description={description}>
      <button
        onClick={() => onChange(!value)}
        className={cn(
          "w-10 h-5 rounded-lg relative transition-colors duration-200 outline-none border border-border",
          value ? "bg-primary" : "bg-muted",
        )}
      >
        <div
          className={cn(
            "absolute top-0.5 w-3.5 h-3.5 rounded-lg transition-transform duration-200",
            value
              ? "translate-x-5.5 bg-primary-foreground"
              : "translate-x-0.5 bg-muted-foreground/50",
          )}
        />
      </button>
    </SettingRow>
  );
}

export function SwitchSetting({
  title,
  description,
  value,
  onChange,
}: {
  title: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <SettingRow title={title} description={description}>
      <Switch checked={value} onCheckedChange={onChange} />
    </SettingRow>
  );
}

export function SelectSetting<T extends string>({
  title,
  description,
  value,
  onValueChange,
  options,
  width = "w-32",
  disabled,
}: {
  title: string;
  description: string;
  value: T;
  onValueChange: (v: T) => void;
  options: { value: T; label: string }[];
  width?: string;
  disabled?: boolean;
}) {
  return (
    <SettingRow title={title} description={description}>
      <Select
        value={value}
        onValueChange={onValueChange as (v: string) => void}
        disabled={disabled}
      >
        <SelectTrigger
          className={cn(
            "h-8 bg-secondary/50 border-border text-xs",
            width,
            disabled && "opacity-60",
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-popover border-border">
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}

function removeCustomTheme(
  setThemes: React.Dispatch<React.SetStateAction<any[]>>,
  currentId: string,
  setCurrentId: (id: string) => void,
  fallbackId: string,
  themeId: string,
) {
  setThemes((prev) => prev.filter((t) => t.id !== themeId));
  if (currentId === themeId) {
    setCurrentId(fallbackId);
  }
}

function generateCopyName(
  selectedName: string,
  existingNames: Set<string>,
): string {
  let newName = `${selectedName} (copy)`;
  let counter = 2;
  while (existingNames.has(newName)) {
    newName = `${selectedName} (copy ${counter})`;
    counter++;
  }
  return newName;
}

function validateAndPrepareTheme(
  jsonInput: string,
  parseTheme: (json: string) => { error?: string; theme?: any },
  nameInput: string,
  builtInThemes: Array<{ id: string; label?: string; name?: string }>,
  customThemes: Array<{ name: string; id: string }>,
): { name: string; id: string; parsed: any } | null {
  if (!jsonInput.trim()) {
    toast.error("Paste a theme JSON first.");
    return null;
  }
  const parsed = parseTheme(jsonInput);
  if (parsed.error || !parsed.theme) {
    toast.error(parsed.error || "Invalid theme JSON.");
    return null;
  }
  const name = nameInput.trim() || parsed.theme?.name || "Custom Theme";
  if (!validateThemeName(name, builtInThemes, customThemes)) return null;
  const id = generateThemeId(name, customThemes, builtInThemes);
  return { name, id, parsed };
}

function validateThemeName(
  name: string,
  builtInThemes: Array<{ label?: string; name?: string }>,
  customThemes: Array<{ name: string }>,
): boolean {
  const labels = builtInThemes.map((t: any) => t.label ?? t.name);
  const existingNames = new Set([
    ...labels,
    ...customThemes.map((t) => t.name),
  ]);
  if (existingNames.has(name)) {
    toast.error(`Theme name "${name}" already exists.`);
    return false;
  }
  return true;
}

function generateThemeId(
  name: string,
  customThemes: Array<{ id: string }>,
  builtInThemes: Array<{ id: string }>,
): string {
  const existingIds = new Set(customThemes.map((t) => t.id));
  builtInThemes.forEach((t) => existingIds.add(t.id));
  return createThemeId(name, existingIds);
}

export function SettingsView({
  studio,
  onOpenThemeCreator,
  onOpenIconThemeCreator,
}: SettingsViewProps) {
  const {
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
    editorThemeId,
    setEditorThemeId,
    customEditorThemes,
    setCustomEditorThemes,
    appThemeId,
    setAppThemeId,
    customAppThemes,
    setCustomAppThemes,
    customFontFamily,
    setCustomFontFamily,
    iconThemeId,
    setIconThemeId,
    customIconThemes,
    setCustomIconThemes,
    tuiMode,
    setTuiMode,
    tuiTheme,
    setTuiTheme,
    commandMenuSections,
    setCommandMenuSections,
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
    sleekLayout,
    setSleekLayout,
    activeSleekLayout,
    showTabIndicator,
    setShowTabIndicator,
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
    autoClosePane,
    setAutoClosePane,
    rlsPolicyTabEditor,
    setRlsPolicyTabEditor,
    searchSettings,
    setSearchSettings,
    keybindings,
    setKeybindings,
  } = studio;

  const {
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
  } = pickCommonSettings(studio);

  const { accessToken, user, isSessionActive } = useAuthState();
  const { entitlement } = useEntitlementState({
    userId: isSessionActive ? (user?.id ?? null) : null,
    accessToken,
    isSessionActive,
  });

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const dragOverIndex = useRef<number | null>(null);
  const {
    updateState,
    setUpdateState,
    installing: installingUpdate,
    setInstalling: setInstallingUpdate,
    handleRenewOtl,
    checkForUpdates,
    handleDownload,
    handleInstall,
  } = useAppUpdate();
  const [isEditorThemeDialogOpen, setIsEditorThemeDialogOpen] = useState(false);
  const [themeNameInput, setThemeNameInput] = useState("");
  const [themeJsonInput, setThemeJsonInput] = useState("");
  const [themeFileName, setThemeFileName] = useState<string | null>(null);
  const [workspaceAuth, setWorkspaceAuth] = useState<{
    userId: string;
    studioToken: string;
  } | null>(null);
  const [workspaceActive, setWorkspaceActive] = useState(false);
  const [workspaceUrl, setWorkspaceUrl] = useState("http://localhost:3000");
  const [workspaceToken, setWorkspaceToken] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceEmail, setWorkspaceEmail] = useState("");
  const [workspaceConnecting, setWorkspaceConnecting] = useState(false);
  const [workspaceAuthLoaded, setWorkspaceAuthLoaded] = useState(false);
  const [workspaceLoginMode, setWorkspaceLoginMode] = useState<
    "invite" | "login"
  >("invite");
  const [workspaceLoginEmail, setWorkspaceLoginEmail] = useState("");
  const [workspaceLoginPassword, setWorkspaceLoginPassword] = useState("");
  const [workspaceTempToken, setWorkspaceTempToken] = useState("");
  const [workspaceTotpCode, setWorkspaceTotpCode] = useState("");
  const [workspaceLoginStep, setWorkspaceLoginStep] = useState<"form" | "totp">(
    "form",
  );
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(
    studio.settingsInitialSection ?? "general",
  );
  const [showProviders, setShowProviders] = useState(false);
  useEffect(() => {
    if (activeSection !== "ai") setShowProviders(false);
  }, [activeSection]);
  const [workspaceLoggingIn, setWorkspaceLoggingIn] = useState(false);
  const [savedWorkspaces, setSavedWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [switchingWs, setSwitchingWs] = useState<string | null>(null);
  const [removingWs, setRemovingWs] = useState<string | null>(null);

  const loadSavedWorkspaces = useCallback(async () => {
    setWorkspacesLoading(true);
    const list = await listWorkspaces();
    setSavedWorkspaces(list);
    setWorkspacesLoading(false);
  }, []);

  useEffect(() => {
    if (activeSection === "workspace") {
      loadSavedWorkspaces();
    }
  }, [activeSection, loadSavedWorkspaces]);

  const activateWorkspace = useCallback(
    async (
      url: string,
      studioToken: string,
      userId: string,
      successMessage: string,
    ) => {
      setWorkspaceActive(true);
      if (typeof window !== "undefined")
        window.sessionStorage.setItem("workspace:active", "1");
      window.dispatchEvent(
        new CustomEvent("workspace:changed", { detail: { connected: true } }),
      );
      let wsName = url;
      try {
        const sr = await studioApi.get<{ data: { name: string } }>("/studio");
        wsName = sr?.data?.name || url;
      } catch {}
      const added = await addWorkspace({
        studioUrl: url,
        studioToken,
        userId,
        name: wsName,
      });
      if (!added)
        toast.warning("Connected but failed to save to workspace list");
      toast.success(successMessage);
    },
    [],
  );

  const loginSuccess = useCallback(async (url: string, studioToken: string) => {
    await saveStudioAuth({ userId: "", studioToken });
    const me = await studioApi.get<{ data: { id: string } }>("/auth/me");
    await setStudioConfig({
      studioUrl: url,
      userId: me.data.id,
      studioToken,
    });
    setWorkspaceAuth({
      userId: me.data.id,
      studioToken,
    });
    await activateWorkspace(
      url,
      studioToken,
      me.data.id,
      "Connected to workspace via sign-in!",
    );
  }, []);

  useEffect(() => {
    initStudioAuth().then(() => {
      const auth = loadStudioAuth();
      setWorkspaceAuth(auth);
      setWorkspaceAuthLoaded(true);
      const stored =
        typeof window !== "undefined" &&
        window.sessionStorage.getItem("workspace:active") === "1";
      if (auth && stored) {
        setWorkspaceActive(true);
      }
    });
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.connected !== undefined) {
        setWorkspaceActive(!!detail.connected);
      }
      loadSavedWorkspaces();
    };
    window.addEventListener("workspace:changed", handler);
    return () => window.removeEventListener("workspace:changed", handler);
  }, [loadSavedWorkspaces]);

  useEffect(() => {
    if (studio.settingsInitialSection) {
      setActiveSection(studio.settingsInitialSection);
    }
  }, [studio.settingsInitialSection]);
  const [themeDialogPos, setThemeDialogPos] = useState({ x: 0, y: 0 });
  const themeDialogDrag = useRef({
    dragging: false,
    startX: 0,
    startY: 0,
    startPosX: 0,
    startPosY: 0,
  });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const d = themeDialogDrag.current;
      if (!d.dragging) return;
      setThemeDialogPos({
        x: d.startPosX + e.clientX - d.startX,
        y: d.startPosY + e.clientY - d.startY,
      });
    };
    const up = () => {
      themeDialogDrag.current.dragging = false;
    };
    window.addEventListener("mousemove", handler);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", handler);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  const handleDialogHeaderMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    themeDialogDrag.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startPosX: themeDialogPos.x,
      startPosY: themeDialogPos.y,
    };
  };

  useEffect(() => {
    if (isEditorThemeDialogOpen) {
      setThemeDialogPos({
        x: Math.max(24, window.innerWidth - 696),
        y: Math.max(60, Math.round(window.innerHeight * 0.5)),
      });
    }
  }, [isEditorThemeDialogOpen]);

  const appBuiltInThemes = BUILTIN_APP_THEMES.map((theme) => ({
    id: theme.id,
    label: theme.name,
  }));
  const editorBuiltInThemes = [
    { id: "auto", label: "Auto (follow app)" },
    { id: "studio-dark", label: "Studio Dark" },
    { id: "light", label: "Light" },
    { id: "vs-dark", label: "VS Dark" },
    { id: "hc-black", label: "High Contrast" },
  ];

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    // Create a ghost image if needed, or just let default happen
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "0.4";
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    setDraggedIndex(null);
    dragOverIndex.current = null;
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "1";
    }
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    if (draggedIndex === null || draggedIndex === index) return;

    // Live reordering logic
    const newSections = [...commandMenuSections];
    const movedSection = newSections[draggedIndex];
    newSections.splice(draggedIndex, 1);
    newSections.splice(index, 0, movedSection);

    setCommandMenuSections(newSections);
    setDraggedIndex(index);
  };

  const toggleSectionVisibility = (id: string) => {
    setCommandMenuSections((prev) =>
      prev.map((section) =>
        section.id === id
          ? { ...section, isVisible: !section.isVisible }
          : section,
      ),
    );
  };

  const handleFileUpload = useCallback(
    (
      file: File | null,
      setJson: (v: string) => void,
      setFileName: (v: string | null) => void,
      nameInput: string,
      setNameInput: (v: string) => void,
      label: string,
    ) => {
      if (!file) return;
      file
        .text()
        .then((text) => {
          setJson(text);
          setFileName(file.name);
          if (!nameInput.trim()) {
            setNameInput(file.name.replace(/\\.json$/i, ""));
          }
        })
        .catch((err) => {
          console.error(`Failed to read ${label} file`, err);
          toast.error(`Failed to read ${label} file.`);
        });
    },
    [],
  );

  const handleThemeFileUpload = (file: File | null) =>
    handleFileUpload(
      file,
      setThemeJsonInput,
      setThemeFileName,
      themeNameInput,
      setThemeNameInput,
      "theme",
    );

  const resetThemeInputs = (
    setName: (v: string) => void,
    setJson: (v: string) => void,
    setFileName: (v: string | null) => void,
  ) => {
    setName("");
    setJson("");
    setFileName(null);
  };

  const resetThemeDialog = () =>
    resetThemeInputs(setThemeNameInput, setThemeJsonInput, setThemeFileName);

  const handleAddEditorTheme = () => {
    const result = validateAndPrepareTheme(
      themeJsonInput,
      parseThemeJson,
      themeNameInput,
      editorBuiltInThemes,
      customEditorThemes,
    );
    if (!result) return;
    setCustomEditorThemes([
      ...customEditorThemes,
      { id: result.id, name: result.name, themeJson: themeJsonInput },
    ]);
    setEditorThemeId(result.id);
    setIsEditorThemeDialogOpen(false);
    resetThemeDialog();
    toast.success(`Added "${result.name}" theme.`);
  };

  const handleRemoveEditorTheme = (themeId: string) =>
    removeCustomTheme(
      setCustomEditorThemes,
      editorThemeId,
      setEditorThemeId,
      "auto",
      themeId,
    );

  const handleRemoveAppTheme = (themeId: string) =>
    removeCustomTheme(
      setCustomAppThemes,
      appThemeId,
      setAppThemeId,
      "zinc-dark-white",
      themeId,
    );

  useEffect(() => {
    if (!isEditorThemeDialogOpen) return;
    const selected = customEditorThemes.find((t) => t.id === editorThemeId);
    if (selected) {
      setThemeJsonInput(selected.themeJson);
      const existingLabels = new Set([
        ...editorBuiltInThemes.map((t) => t.label),
        ...customEditorThemes.map((t) => t.name),
      ]);
      setThemeNameInput(generateCopyName(selected.name, existingLabels));
    } else {
      setThemeJsonInput(
        JSON.stringify(
          { base: "vs-dark", inherit: true, rules: [], colors: {} },
          null,
          2,
        ),
      );
      setThemeNameInput("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditorThemeDialogOpen, editorThemeId, customEditorThemes]);

  const handleWorkspaceLogin = async () => {
    const email = workspaceLoginEmail.trim().toLowerCase();
    if (!email || !workspaceLoginPassword) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Please enter a valid email address");
      return;
    }
    setWorkspaceLoggingIn(true);
    try {
      const url = workspaceUrl.trim().replace(/\/+$/, "");
      await setStudioUrl(url);
      const res = await studioApi.post<{
        data: { studioToken?: string; step?: string; tempToken?: string };
      }>("/auth/login", {
        email,
        password: workspaceLoginPassword,
      });
      if (res.data?.step === "totp" && res.data.tempToken) {
        setWorkspaceTempToken(res.data.tempToken);
        setWorkspaceTotpCode("");
        setWorkspaceLoginStep("totp");
      } else if (res.data?.studioToken) {
        await loginSuccess(url, res.data.studioToken);
      } else {
        toast.error("Unexpected login response.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Login failed");
    } finally {
      setWorkspaceLoggingIn(false);
    }
  };

  const handleWorkspaceTotp = async () => {
    if (!workspaceTotpCode.trim()) return;
    setWorkspaceLoggingIn(true);
    try {
      const url = workspaceUrl.trim().replace(/\/+$/, "");
      const res = await studioApi.post<{
        data: { studioToken: string };
      }>("/auth/login/totp", {
        tempToken: workspaceTempToken,
        code: workspaceTotpCode.trim(),
      });
      if (res.data?.studioToken) {
        await loginSuccess(url, res.data.studioToken);
      } else {
        toast.error("Unexpected TOTP response.");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "TOTP verification failed",
      );
    } finally {
      setWorkspaceLoggingIn(false);
    }
  };

  const handleCheckUpdates = async () => {
    toast.success("Checking for updates...");
    await checkForUpdates();
  };

  const handleDownloadUpdate = async () => {
    if (!handleDownload) {
      toast.error("Update controls are only available in the desktop app.");
      return;
    }
    await handleDownload();
    toast.success("Downloading update...");
  };

  const handleInstallUpdate = async () => {
    if (!handleInstall) {
      toast.error("Update controls are only available in the desktop app.");
      return;
    }
    setInstallingUpdate(true);
    try {
      await handleInstall();
    } catch {
      setInstallingUpdate(false);
      toast.error("Failed to install update.");
      return;
    }
    toast.success("Installing update and restarting...");
  };


  const updatesUntil = entitlement.updatesUntil;
  const updatesExpired = entitlement.updatesExpired;
  const entitlementNotice = buildEntitlementCacheMessage(entitlement);

  return (
    <div className="flex-1 overflow-auto bg-background text-foreground h-full">
      <div className="flex h-full min-h-0">
        <SettingsSidebar
          activeSection={activeSection}
          onSelect={setActiveSection}
        />

        <div className="min-w-0 flex-1 space-y-8 overflow-auto px-8 py-6">
          {activeSection === "ai" ? (
            showProviders ? (
              <AiProvidersPage onBack={() => setShowProviders(false)} />
            ) : (
              <section className="space-y-4">
                <AiSettingsSection onOpenProviders={() => setShowProviders(true)} />
                <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
                  <div className="flex flex-col">
                    <span className="font-medium text-xs">Slash AI Trigger</span>
                    <span className="text-xs text-muted-foreground">
                      Type / in an empty editor to activate AI mode.
                    </span>
                  </div>
                  <Switch
                    checked={slashAiTrigger}
                    onCheckedChange={setSlashAiTrigger}
                  />
                </div>
              </section>
            )
          ) : null}

          {activeSection === "general" ? (
            <section className="space-y-5">
              <h2 className="text-sm font-semibold">General</h2>

              <div className="space-y-4">
                {/* Appearance */}
                <div className="flex flex-col space-y-3">
                  <div className="flex flex-col">
                    <span className="font-medium text-xs">Appearance</span>
                    <span className="text-xs text-muted-foreground">
                      Select how Rexa DB looks on your device.
                    </span>
                  </div>

                  <div className="grid max-w-lg grid-cols-3 gap-3">
                    {[
                      {
                        id: "light",
                        themeId: "light",
                        label: "Light",
                        preview: "bg-white",
                      },
                      {
                        id: "dark",
                        themeId: "zinc-dark-white",
                        label: "Dark",
                        preview: "bg-[#0F0F0F]",
                      },
                      {
                        id: "system",
                        themeId: "system",
                        label: "System",
                        preview: "bg-gradient-to-br from-white to-[#0F0F0F]",
                      },
                    ].map((item) => (
                      <button
                        key={item.id}
                        onClick={() => setAppThemeId(item.themeId)}
                        className="group flex flex-col items-center gap-1.5"
                      >
                        <div
                          className={cn(
                            "w-full aspect-[16/10] rounded-lg border-2 flex flex-col overflow-hidden relative transition-all",
                            appThemeId === item.themeId
                              ? "border-blue-500 shadow-sm"
                              : "border-border group-hover:border-muted-foreground/20",
                          )}
                        >
                          <div className={cn("flex-1", item.preview)} />
                          <div className="h-4 bg-muted/30 border-t border-border flex items-center px-1.5 gap-1">
                            <div className="w-1.5 h-1.5 rounded-lg bg-red-500/50" />
                            <div className="w-1.5 h-1.5 rounded-lg bg-amber-500/50" />
                            <div className="w-1.5 h-1.5 rounded-lg bg-green-500/50" />
                          </div>
                          {appThemeId === item.themeId && (
                            <div className="absolute top-2 right-2 w-4 h-4 bg-blue-500 rounded-lg flex items-center justify-center">
                              <Check className="w-2.5 h-2.5 text-white" />
                            </div>
                          )}
                        </div>
                        <span
                          className={cn(
                            "text-xs font-medium transition-colors",
                            appThemeId === item.themeId
                              ? "text-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {item.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* App Theme */}
                <div className="flex items-start justify-between gap-3 border-t border-border py-3">
                  <div className="flex flex-col">
                    <span className="font-medium text-xs">App Theme</span>
                    <span className="text-xs text-muted-foreground max-w-md">
                      Choose a built-in theme or add a custom palette for the
                      whole app.
                    </span>
                  </div>
                  <ThemeSelectSection
                    value={appThemeId}
                    onValueChange={setAppThemeId}
                    builtInThemes={appBuiltInThemes}
                    customThemes={customAppThemes}
                    onCustomTheme={onOpenThemeCreator}
                    onBrowseThemes={() => setActiveSection("themes")}
                    icon={<Upload className="w-3.5 h-3.5" />}
                  />
                </div>

                {customAppThemes.length > 0 ? (
                  <div className="flex flex-col gap-1.5 pb-1">
                    <span className="text-xs text-muted-foreground">
                      Custom app themes
                    </span>
                    <div className="flex flex-col gap-1.5">
                      {customAppThemes.map((theme) => (
                        <div
                          key={theme.id}
                          className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/20 px-2.5 py-1.5"
                        >
                          <div className="flex flex-col">
                            <span className="text-xs font-medium text-foreground">
                              {theme.name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {theme.id} • {theme.base}
                            </span>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-red-500 hover:text-red-600"
                            onClick={() => handleRemoveAppTheme(theme.id)}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <CustomFontSetting
                  value={customFontFamily}
                  onChange={setCustomFontFamily}
                />
                <IconThemeSetting
                  iconThemeId={iconThemeId}
                  setIconThemeId={setIconThemeId}
                  customIconThemes={customIconThemes}
                  setCustomIconThemes={setCustomIconThemes}
                />

                <ZoomSetting value={appZoom} onChange={setAppZoom} />

                {/* Row Spacing */}
                <SelectSetting
                  title="Row Spacing"
                  description="Adjust the vertical spacing between rows in data tables."
                  value={rowSpacing}
                  onValueChange={setRowSpacing}
                  options={[
                    { value: "compact", label: "Compact" },
                    { value: "standard", label: "Standard" },
                    { value: "relaxed", label: "Relaxed" },
                  ]}
                />

                {/* Terminal UI */}
                <ToggleSetting
                  title="Terminal UI (Experimental)"
                  description="Switch the app to a blocky terminal-style UI with mono typography."
                  value={tuiMode}
                  onChange={setTuiMode}
                />

                {/* Terminal Theme */}
                <SelectSetting
                  title="Terminal Theme"
                  description="Choose light, dark, or follow system while in terminal UI."
                  value={tuiTheme}
                  onValueChange={setTuiTheme}
                  disabled={!tuiMode}
                  options={[
                    { value: "auto", label: "System" },
                    { value: "light", label: "Light" },
                    { value: "dark", label: "Dark" },
                  ]}
                />

                {/* Sleek Layout */}
                <SettingRow
                  title="Sleek Layout"
                  description="Add padding and rounded corners to main interface panels."
                >
                  <div className="flex flex-col items-end gap-1">
                    {sleekLayout !== activeSleekLayout && (
                      <span className="text-xs text-amber-500 font-medium whitespace-nowrap">
                        Applying layout changes...
                      </span>
                    )}
                    <button
                      onClick={() => setSleekLayout(!sleekLayout)}
                      className={cn(
                        "w-10 h-5 rounded-lg relative transition-colors duration-200 outline-none border border-border",
                        sleekLayout ? "bg-primary" : "bg-muted",
                      )}
                    >
                      <div
                        className={cn(
                          "absolute top-0.5 w-3.5 h-3.5 rounded-lg transition-transform duration-200",
                          sleekLayout
                            ? "translate-x-5.5 bg-primary-foreground"
                            : "translate-x-0.5 bg-muted-foreground/50",
                        )}
                      />
                    </button>
                  </div>
                </SettingRow>

                {/* Translucent Background */}
                <ToggleSetting
                  title="Translucent Background"
                  description="Make the outer chrome translucent with a blur effect, showing the desktop behind the window."
                  value={noiseBgTranslucent}
                  onChange={setNoiseBgTranslucent}
                />

                {/* Background Noise */}
                <ToggleSetting
                  title="Background Noise"
                  description="Add a subtle grain texture to the sidebar and outer surface."
                  value={noiseBgEnabled}
                  onChange={setNoiseBgEnabled}
                />
                {noiseBgEnabled && (
                  <div className="flex flex-col space-y-3 border-t border-border pt-3">
                    <SettingRow
                      title="Noise Size"
                      description="Scale of the noise pattern (smaller = finer grain)."
                    >
                      <input
                        type="range"
                        min={1}
                        max={100}
                        value={noiseBgSize}
                        onChange={(e) => setNoiseBgSize(Number(e.target.value))}
                        className="h-2 w-28 cursor-pointer appearance-none rounded-full bg-muted accent-primary
                          [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
                      />
                    </SettingRow>
                    <SelectSetting
                      title="Blend Mode"
                      description="How the noise blends with the background."
                      value={noiseBgBlendMode}
                      onValueChange={setNoiseBgBlendMode}
                      options={[
                        { value: "overlay", label: "Overlay" },
                        { value: "soft-light", label: "Soft Light" },
                        { value: "multiply", label: "Multiply" },
                        { value: "screen", label: "Screen" },
                      ]}
                    />
                    <SettingRow
                      title="Color"
                      description="Tint color for the noise texture."
                    >
                      <input
                        type="color"
                        value={noiseBgColor}
                        onChange={(e) => setNoiseBgColor(e.target.value)}
                        className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent p-0.5 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-none"
                      />
                    </SettingRow>
                    <SettingRow
                      title="Opacity"
                      description="Strength of the noise effect."
                    >
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={noiseBgOpacity}
                        onChange={(e) => setNoiseBgOpacity(Number(e.target.value))}
                        className="h-2 w-28 cursor-pointer appearance-none rounded-full bg-muted accent-primary
                          [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
                      />
                    </SettingRow>
                  </div>
                )}

                {/* Alternating Row Colors */}
                <ToggleSetting
                  title="Alternating Row Colors"
                  description="Apply alternating background colors to rows in data tables for easier reading."
                  value={alternatingRowColors}
                  onChange={setAlternatingRowColors}
                />

                {/* Pending Changes Banner */}
                <ToggleSetting
                  title="Show Pending Changes Banner"
                  description="Display a banner above the data grid when there are unsaved changes."
                  value={showPendingChangesBanner}
                  onChange={setShowPendingChangesBanner}
                />

                {/* Restore App State */}
                <ToggleSetting
                  title="Restore App State"
                  description="When enabled, reopens tabs and restores your previous session when you return to a connection."
                  value={restoreAppState}
                  onChange={setRestoreAppState}
                />

                {/* Auto-Save Executed Queries */}
                <ToggleSetting
                  title="Auto-Save Executed Queries"
                  description="Automatically save every executed query as a snippet with a query number and timestamp."
                  value={autoSaveQueries}
                  onChange={setAutoSaveQueries}
                />

                {/* Local Search Index */}
                <ToggleSetting
                  title="Local Search Index"
                  description="Cache universal search results in a local SQLite database for instant repeat searches. Indexed data is stored separately from your connection database."
                  value={searchSettings?.localIndexEnabled ?? false}
                  onChange={(v: boolean) =>
                    setSearchSettings((prev: any) => ({
                      ...prev,
                      localIndexEnabled: v,
                    }))
                  }
                />
              </div>
            </section>
          ) : null}

          {activeSection === "editor" ? (
            <section className="space-y-5">
              <h2 className="text-sm font-semibold">Editor</h2>

              <div className="space-y-4">
                <SelectSetting
                  title="Editor Font Size"
                  description="Adjust the font size for query editors."
                  value={editorFontSize}
                  onValueChange={setEditorFontSize}
                  options={[
                    { value: "12px", label: "12px" },
                    { value: "13px", label: "13px" },
                    { value: "14px", label: "14px" },
                    { value: "16px", label: "16px" },
                  ]}
                />

                <CustomFontSetting
                  value={editorFontFamily}
                  onChange={setEditorFontFamily}
                  title="Editor Font Family"
                  description="Use a specific font for the SQL editor. If empty, it will follow the app font."
                />

                <SwitchSetting
                  title="Vim Mode"
                  description="Enable Vim keybindings for the SQL editor."
                  value={vimMode}
                  onChange={setVimMode}
                />
                <SwitchSetting
                  title="Result Tabs"
                  description="Show query results in individual tabs for multi-statement queries."
                  value={resultTabsEnabled}
                  onChange={setResultTabsEnabled}
                />

                <div className="flex items-start justify-between gap-3 border-t border-border py-3">
                  <div className="flex flex-col">
                    <span className="font-medium text-xs">Editor Theme</span>
                    <span className="text-xs text-muted-foreground max-w-md">
                      Choose a built-in theme or add a custom VS Code theme JSON
                      for editors.
                    </span>
                  </div>
                  <ThemeSelectSection
                    value={editorThemeId}
                    onValueChange={setEditorThemeId}
                    builtInThemes={editorBuiltInThemes}
                    customThemes={customEditorThemes}
                    onCustomTheme={() => setIsEditorThemeDialogOpen(true)}
                    onBrowseThemes={() => setActiveSection("themes")}
                    icon={<Code className="w-3.5 h-3.5" />}
                  />
                </div>
              </div>

              {/* SQL Formatting */}
              <div className="space-y-4">
                <h3 className="text-xs font-semiboldtracking-wider text-muted-foreground pt-4">
                  SQL Formatting
                </h3>

                <SelectSetting
                  title="Keyword Case"
                  description="Casing for SQL keywords (SELECT, FROM, WHERE...)."
                  value={sqlFormatKeywordCase}
                  onValueChange={(v) =>
                    setSqlFormatKeywordCase(v as "preserve" | "upper" | "lower")
                  }
                  options={[
                    { value: "preserve", label: "Preserve" },
                    { value: "upper", label: "Upper" },
                    { value: "lower", label: "Lower" },
                  ]}
                />
                <SelectSetting
                  title="Data Type Case"
                  description="Casing for data types (INT, VARCHAR...)."
                  value={sqlFormatDataTypeCase}
                  onValueChange={(v) =>
                    setSqlFormatDataTypeCase(
                      v as "preserve" | "upper" | "lower",
                    )
                  }
                  options={[
                    { value: "preserve", label: "Preserve" },
                    { value: "upper", label: "Upper" },
                    { value: "lower", label: "Lower" },
                  ]}
                />
                <SelectSetting
                  title="Function Case"
                  description="Casing for function names (COUNT, SUM...)."
                  value={sqlFormatFunctionCase}
                  onValueChange={(v) =>
                    setSqlFormatFunctionCase(
                      v as "preserve" | "upper" | "lower",
                    )
                  }
                  options={[
                    { value: "preserve", label: "Preserve" },
                    { value: "upper", label: "Upper" },
                    { value: "lower", label: "Lower" },
                  ]}
                />
                <SelectSetting
                  title="Identifier Case"
                  description="Casing for identifiers (experimental)."
                  value={sqlFormatIdentifierCase}
                  onValueChange={(v) =>
                    setSqlFormatIdentifierCase(
                      v as "preserve" | "upper" | "lower",
                    )
                  }
                  options={[
                    { value: "preserve", label: "Preserve" },
                    { value: "upper", label: "Upper" },
                    { value: "lower", label: "Lower" },
                  ]}
                />

                <SelectSetting
                  title="Tab Width"
                  description="Number of spaces per indentation level."
                  value={String(sqlFormatTabWidth)}
                  onValueChange={(v) => setSqlFormatTabWidth(Number(v))}
                  width="w-24"
                  options={[1, 2, 3, 4, 6, 8].map((n) => ({
                    value: String(n),
                    label: `${n} ${n === 1 ? "space" : "spaces"}`,
                  }))}
                />

                <SwitchSetting
                  title="Use Tabs"
                  description="Use tab characters instead of spaces for indentation."
                  value={sqlFormatUseTabs}
                  onChange={setSqlFormatUseTabs}
                />

                <SelectSetting
                  title="Logical Operator Newline"
                  description="Place AND/OR before or after the newline."
                  value={sqlFormatLogicalOperatorNewline}
                  onValueChange={(v) =>
                    setSqlFormatLogicalOperatorNewline(v as "before" | "after")
                  }
                  width="w-28"
                  options={[
                    { value: "before", label: "Before" },
                    { value: "after", label: "After" },
                  ]}
                />

                <SelectSetting
                  title="Expression Width"
                  description="Max chars in parentheses before wrapping."
                  value={String(sqlFormatExpressionWidth)}
                  onValueChange={(v) => setSqlFormatExpressionWidth(Number(v))}
                  width="w-28"
                  options={[10, 20, 30, 40, 50, 60, 80, 100, 120].map((n) => ({
                    value: String(n),
                    label: String(n),
                  }))}
                />
                <SelectSetting
                  title="Lines Between Queries"
                  description="Number of blank lines between separate queries."
                  value={String(sqlFormatLinesBetweenQueries)}
                  onValueChange={(v) =>
                    setSqlFormatLinesBetweenQueries(Number(v))
                  }
                  width="w-24"
                  options={[0, 1, 2, 3, 4, 5].map((n) => ({
                    value: String(n),
                    label: String(n),
                  }))}
                />

                <SwitchSetting
                  title="Dense Operators"
                  description="Remove spaces around operators (e.g. a=b instead of a = b)."
                  value={sqlFormatDenseOperators}
                  onChange={setSqlFormatDenseOperators}
                />
                <SwitchSetting
                  title="Newline Before Semicolon"
                  description="Place semicolons on their own line."
                  value={sqlFormatNewlineBeforeSemicolon}
                  onChange={setSqlFormatNewlineBeforeSemicolon}
                />
              </div>
            </section>
          ) : null}

          {activeSection === "themes" ? (
            <ThemesSection
              customAppThemes={customAppThemes}
              setCustomAppThemes={setCustomAppThemes}
              appThemeId={appThemeId}
              setAppThemeId={setAppThemeId}
              customEditorThemes={customEditorThemes}
              setCustomEditorThemes={setCustomEditorThemes}
              user={user}
              isSessionActive={isSessionActive}
              onOpenEditorThemeDialog={() => setIsEditorThemeDialogOpen(true)}
              onOpenThemeCreator={onOpenThemeCreator}
              onOpenIconThemeCreator={onOpenIconThemeCreator}
            />
          ) : null}

          {activeSection === "security" ? (
            <section className="space-y-5">
              <h2 className="text-sm font-semibold">Security</h2>

              <div className="space-y-4">
                <SelectSetting
                  title="Execution Mode"
                  description={
                    'When set to "Review", queries are sent to a review panel instead of executing directly.'
                  }
                  value={executionMode}
                  onValueChange={setExecutionMode}
                  options={[
                    { value: "direct", label: "Direct" },
                    { value: "review", label: "Review" },
                  ]}
                />
              </div>
            </section>
          ) : null}

          {activeSection === "keybindings" ? (
            <section className="space-y-4">
              <KeybindingsPanel
                keybindings={keybindings}
                setKeybindings={setKeybindings}
              />
            </section>
          ) : null}

          {activeSection === "mcp" ? <McpSettingsSection /> : null}

          {activeSection === "workspace" ? (
            <section className="space-y-4">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold">Workspace</h2>
                <p className="text-xs text-muted-foreground">
                  Connect to a rexadb-studio workspace to manage shared
                  connections.
                </p>
              </div>
              {!workspaceAuthLoaded ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading...
                </div>
              ) : workspaceAuth && workspaceActive ? (
                <Card className="p-4 border-studio-border bg-studio-bg/50 space-y-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    <span className="text-sm font-medium">Connected</span>
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p>URL: {getStudioUrl()}</p>
                    <p>User ID: {workspaceAuth.userId}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setWorkspaceActive(false);
                        disconnectStudioWorkspace();
                        toast.success("Switched to local connections");
                      }}
                      className="flex-1"
                    >
                      <LogOut className="w-3.5 h-3.5 mr-1" />
                      Deactivate
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={async () => {
                        await clearAllStudioData();
                        setWorkspaceAuth(null);
                        setWorkspaceActive(false);
                        setWorkspaceLoginMode("invite");
                        setWorkspaceLoginStep("form");
                        if (typeof window !== "undefined")
                          window.sessionStorage.removeItem("workspace:active");
                        window.dispatchEvent(
                          new CustomEvent("workspace:changed", {
                            detail: { connected: false },
                          }),
                        );
                        toast.success("Forgotten workspace credentials");
                      }}
                    >
                      Forget
                    </Button>
                  </div>
                </Card>
              ) : workspaceAuth && !workspaceActive ? (
                <Card className="p-4 border-studio-border bg-studio-bg/50 space-y-3">
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p>URL: {getStudioUrl()}</p>
                    <p>User ID: {workspaceAuth.userId}</p>
                    <p className="text-foreground/60 italic">
                      Saved credentials found
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => {
                        setWorkspaceActive(true);
                        if (typeof window !== "undefined")
                          window.sessionStorage.setItem(
                            "workspace:active",
                            "1",
                          );
                        window.dispatchEvent(
                          new CustomEvent("workspace:changed", {
                            detail: { connected: true },
                          }),
                        );
                        toast.success("Reconnected to workspace");
                      }}
                      className="flex-1"
                    >
                      <ArrowRight className="w-3.5 h-3.5 mr-1" />
                      Reconnect
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={async () => {
                        await clearAllStudioData();
                        setWorkspaceAuth(null);
                        setWorkspaceLoginMode("invite");
                        setWorkspaceLoginStep("form");
                        if (typeof window !== "undefined")
                          window.sessionStorage.removeItem("workspace:active");
                        toast.success("Forgotten workspace credentials");
                      }}
                    >
                      Forget
                    </Button>
                  </div>
                </Card>
              ) : workspaceLoginStep === "totp" ? (
                <Card className="p-4 border-studio-border bg-studio-bg/50 space-y-4">
                  <div className="space-y-2 text-center">
                    <Shield className="w-8 h-8 text-primary mx-auto" />
                    <h3 className="text-sm font-semibold">
                      Two-Factor Authentication
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Enter the 6-digit code from your authenticator app
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Input
                      placeholder="000000"
                      value={workspaceTotpCode}
                      onChange={(e) =>
                        setWorkspaceTotpCode(
                          e.target.value.replace(/\D/g, "").slice(0, 6),
                        )
                      }
                      className="bg-background/70 border-border/60 h-10 text-center text-sm font-mono tracking-[0.3em]"
                      maxLength={6}
                      autoFocus
                    />
                  </div>
                  <Button
                    disabled={
                      workspaceLoggingIn || workspaceTotpCode.length !== 6
                    }
                    onClick={handleWorkspaceTotp}
                    className="w-full"
                  >
                    {workspaceLoggingIn ? "Verifying..." : "Verify & Connect"}
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      setWorkspaceLoginStep("form");
                      setWorkspaceTempToken("");
                      setWorkspaceTotpCode("");
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground w-full text-center"
                  >
                    Back to sign in
                  </button>
                </Card>
              ) : (
                <Card className="p-4 border-studio-border bg-studio-bg/50 space-y-4">
                  <div className="flex items-center gap-1 rounded-lg bg-muted/40 p-1">
                    <button
                      onClick={() => setWorkspaceLoginMode("invite")}
                      className={cn(
                        "flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                        workspaceLoginMode === "invite"
                          ? "bg-background text-foreground border border-border/40 shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Accept Invite
                    </button>
                    <button
                      onClick={() => setWorkspaceLoginMode("login")}
                      className={cn(
                        "flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                        workspaceLoginMode === "login"
                          ? "bg-background text-foreground border border-border/40 shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Sign In
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Workspace URL
                    </Label>
                    <Input
                      placeholder="http://localhost:3000"
                      value={workspaceUrl}
                      onChange={(e) => setWorkspaceUrl(e.target.value)}
                      className="bg-background/70 border-border/60 h-10"
                    />
                  </div>

                  {workspaceLoginMode === "invite" ? (
                    <>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">
                          Invite Token
                        </Label>
                        <Input
                          placeholder="64-character hex token"
                          value={workspaceToken}
                          onChange={(e) => setWorkspaceToken(e.target.value)}
                          className="bg-background/70 border-border/60 h-10 font-mono text-xs"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">
                          Name
                        </Label>
                        <Input
                          placeholder="John Doe"
                          value={workspaceName}
                          onChange={(e) => setWorkspaceName(e.target.value)}
                          className="bg-background/70 border-border/60 h-10"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">
                          Email
                        </Label>
                        <Input
                          type="email"
                          placeholder="john@example.com"
                          value={workspaceEmail}
                          onChange={(e) => setWorkspaceEmail(e.target.value)}
                          className="bg-background/70 border-border/60 h-10"
                        />
                      </div>
                      <Button
                        disabled={
                          workspaceConnecting ||
                          !workspaceToken.trim() ||
                          !workspaceName.trim() ||
                          !workspaceEmail.trim()
                        }
                        onClick={async () => {
                          setWorkspaceConnecting(true);
                          try {
                            const url = workspaceUrl.trim().replace(/\/+$/, "");
                            const res = await studioApi.post<{
                              data: { userId: string; studioToken: string };
                            }>("/invites/accept", {
                              token: workspaceToken.trim(),
                              name: workspaceName.trim(),
                              email: workspaceEmail.trim().toLowerCase(),
                            });
                            await setStudioConfig({
                              studioUrl: url,
                              userId: res.data.userId,
                              studioToken: res.data.studioToken,
                            });
                            setWorkspaceAuth({
                              userId: res.data.userId,
                              studioToken: res.data.studioToken,
                            });
                            await activateWorkspace(
                              url,
                              res.data.studioToken,
                              res.data.userId,
                              "Connected to workspace!",
                            );
                          } catch (err) {
                            toast.error(
                              err instanceof Error
                                ? err.message
                                : "Failed to connect",
                            );
                          } finally {
                            setWorkspaceConnecting(false);
                          }
                        }}
                        className="w-full"
                      >
                        {workspaceConnecting
                          ? "Connecting..."
                          : "Connect to Workspace"}
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">
                          Email
                        </Label>
                        <Input
                          type="email"
                          placeholder="john@example.com"
                          value={workspaceLoginEmail}
                          onChange={(e) =>
                            setWorkspaceLoginEmail(e.target.value)
                          }
                          className="bg-background/70 border-border/60 h-10"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">
                          Password
                        </Label>
                        <Input
                          type="password"
                          placeholder="Your password"
                          value={workspaceLoginPassword}
                          onChange={(e) =>
                            setWorkspaceLoginPassword(e.target.value)
                          }
                          className="bg-background/70 border-border/60 h-10"
                        />
                      </div>
                      <Button
                        disabled={
                          workspaceLoggingIn ||
                          !workspaceLoginEmail.trim() ||
                          !workspaceLoginPassword
                        }
                        onClick={handleWorkspaceLogin}
                        className="w-full"
                      >
                        {workspaceLoggingIn
                          ? "Signing in..."
                          : "Sign In & Connect"}
                      </Button>
                    </>
                  )}
                </Card>
              )}

              <div className="pt-4 border-t border-studio-border">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-muted-foreground">
                    Saved Workspaces
                  </h3>
                  {workspacesLoading && (
                    <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                  )}
                </div>
                {savedWorkspaces.length === 0 ? (
                  <p className="text-xs text-muted-foreground/50">
                    No workspaces saved yet.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {savedWorkspaces.map((ws) => {
                      const isActiveWs =
                        workspaceAuth !== null &&
                        ws.studioUrl === getStudioUrl();
                      return (
                        <div
                          key={ws.studioUrl}
                          className="flex items-center gap-3 px-3 py-2 rounded-lg border border-studio-border bg-studio-bg/30 group hover:bg-muted/10 transition-colors"
                        >
                          <div
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActiveWs ? "bg-emerald-500" : "bg-muted-foreground/20"}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium truncate">
                                {ws.name}
                              </span>
                              {isActiveWs && (
                                <span className="text-[10px] px-1 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-medium shrink-0">
                                  Active
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-muted-foreground/50 truncate font-mono">
                              {ws.studioUrl}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {!isActiveWs && (
                              <button
                                onClick={async () => {
                                  setSwitchingWs(ws.studioUrl);
                                  const ok = await switchWorkspace(
                                    ws.studioUrl,
                                  );
                                  setSwitchingWs(null);
                                  if (ok) {
                                    toast.success("Switched workspace");
                                    if (typeof window !== "undefined")
                                      window.location.href = "/";
                                  } else {
                                    toast.error("Failed to switch workspace");
                                  }
                                }}
                                disabled={switchingWs === ws.studioUrl}
                                className="h-6 px-2 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                              >
                                {switchingWs === ws.studioUrl ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  "Switch"
                                )}
                              </button>
                            )}
                            <button
                              onClick={async () => {
                                setRemovingWs(ws.studioUrl);
                                await removeWorkspace(ws.studioUrl);
                                setRemovingWs(null);
                                loadSavedWorkspaces();
                              }}
                              disabled={removingWs === ws.studioUrl}
                              className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground/30 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                            >
                              {removingWs === ws.studioUrl ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Trash2 className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {activeSection === "advanced" ? (
            <section className="space-y-4">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold">Advanced</h2>
                <p className="text-xs text-muted-foreground">
                  Configure advanced behavior and appearance of the application.
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-4">
                  <h3 className="text-sm font-medium">Interface Polish</h3>

                  <SwitchSetting
                    title="Show Tab Indicator"
                    description="Display the primary color line above the active editor tab."
                    value={showTabIndicator}
                    onChange={setShowTabIndicator}
                  />
                  <SwitchSetting
                    title="Window Action Buttons"
                    description="Show custom minimize, maximize, and close buttons in the header. Disable if your window manager provides these natively."
                    value={!hideWindowActions}
                    onChange={(v) => setHideWindowActions(!v)}
                  />
                  <SwitchSetting
                    title="Sidebar Toggle Before Connection"
                    description="Move the sidebar toggle button before the connection selector in the header."
                    value={sidebarToggleBeforeConnection}
                    onChange={setSidebarToggleBeforeConnection}
                  />
                </div>

                <div className="space-y-4 pt-4">
                  <h3 className="text-sm font-medium">
                    Data Grid - Visual Overhaul
                  </h3>

                  <SwitchSetting
                    title="Glassmorphic Sticky Headers"
                    description="Translucent, blurred backdrop for grid headers."
                    value={glassmorphicHeaders}
                    onChange={setGlassmorphicHeaders}
                  />
                  <SwitchSetting
                    title="Micro-Animations"
                    description="Subtle transition effects on row hover."
                    value={gridAnimations}
                    onChange={setGridAnimations}
                  />
                  <SwitchSetting
                    title="Sleek Selection States"
                    description="Subtle box-shadow glow for selected cells and rows."
                    value={sleekSelection}
                    onChange={setSleekSelection}
                  />
                </div>

                <div className="space-y-4 pt-4">
                  <h3 className="text-sm font-medium">
                    Data Grid - Smart Cell Visualizations
                  </h3>

                  <SwitchSetting
                    title="Colorized Pills"
                    description="Render Booleans and Enums as elegant, colored pills."
                    value={colorizedPills}
                    onChange={setColorizedPills}
                  />
                  <SwitchSetting
                    title="Relative Dates"
                    description="Format dates into a more readable relative format."
                    value={relativeDates}
                    onChange={setRelativeDates}
                  />
                  <SwitchSetting
                    title="Rich JSON Inspector"
                    description="Formatted mini-pill for JSON objects with tooltip."
                    value={richJsonInspector}
                    onChange={setRichJsonInspector}
                  />
                  <SwitchSetting
                    title="Data Bars"
                    description="Inline background progress bar for numeric columns."
                    value={dataBars}
                    onChange={setDataBars}
                  />
                </div>

                <div className="space-y-4 pt-4">
                  <h3 className="text-sm font-medium">
                    Data Grid - Empty States & Loading Polish
                  </h3>

                  <SwitchSetting
                    title="Skeleton Loaders"
                    description="Animated skeleton rows during data loading."
                    value={skeletonLoaders}
                    onChange={setSkeletonLoaders}
                  />
                </div>

                <div className="space-y-4 pt-4">
                  <h3 className="text-sm font-medium">Schema Explorer</h3>

                  <SwitchSetting
                    title="Enable Schema Explorer"
                    description="Show tables, functions, triggers, and indexes in a unified explorer with schema icon."
                    value={schemaExplorer}
                    onChange={setSchemaExplorer}
                  />
                </div>

                <div className="space-y-4 pt-4">
                  <h3 className="text-sm font-medium">Database Explorer</h3>

                  <SwitchSetting
                    title="Enable Database Explorer"
                    description="Browse all schemas and object types (tables, functions, triggers, indexes, enums) in a hierarchical tree view."
                    value={databaseExplorer}
                    onChange={setDatabaseExplorer}
                  />

                  <SwitchSetting
                    title="Enable Table Expansion"
                    description="Show expand/collapse arrows next to table names to view columns inline in the sidebar."
                    value={tableExpansion}
                    onChange={setTableExpansion}
                  />
                </div>

                <div className="space-y-4 pt-4">
                  <h3 className="text-sm font-medium">Tab Behavior</h3>

                  <SwitchSetting
                    title="Preview Tabs"
                    description="VS Code-style preview mode. Opening a table, snippet, or dashboard shows it in a temporary tab (italicized) that gets replaced when you open another item. Double-click a tab or pin it to keep it permanently."
                    value={previewTabs}
                    onChange={setPreviewTabs}
                  />
                </div>

                <div className="space-y-4 pt-4">
                  <h3 className="text-sm font-medium">Pane Behavior</h3>

                  <SwitchSetting
                    title="Auto-close Empty Panes"
                    description="Automatically close a split pane when its last tab is closed."
                    value={autoClosePane}
                    onChange={setAutoClosePane}
                  />
                  <SwitchSetting
                    title="Confirm Unsaved Sheet Close"
                    description="Show a confirmation dialog when clicking outside a form sheet with unsaved changes."
                    value={confirmSheetClose}
                    onChange={setConfirmSheetClose}
                  />
                </div>
              </div>

              <div className="space-y-1 mt-8">
                <h3 className="text-sm font-medium">System Configuration</h3>
              </div>

              <div className="space-y-2.5 border-t border-border py-3">
                <SqlEditorEngineSetting
                  onChange={setSqlEditorEngine}
                  value={sqlEditorEngine}
                />
              </div>

              <SwitchSetting
                title="Open RLS Policies in Tab"
                description="Edit and create Row-Level Security policies in an editor tab instead of a side sheet."
                value={rlsPolicyTabEditor}
                onChange={setRlsPolicyTabEditor}
              />

              <div className="space-y-2.5">
                <div className="flex flex-col">
                  <span className="font-medium text-xs">App Updates</span>
                  <span className="text-xs text-muted-foreground">
                    Current version: {updateState.currentVersion || "Unknown"}
                    {updateState.latestVersion
                      ? ` • Latest: ${updateState.latestVersion}`
                      : ""}
                  </span>
                </div>
                {updatesExpired ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Updates expired on{" "}
                      {updatesUntil
                        ? new Date(updatesUntil).toLocaleDateString()
                        : "your last renewal date"}
                      . Your license is perpetual — only updates are gated.
                    </p>
                    <Button size="sm" onClick={handleRenewOtl}>
                      Renew License
                      <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={handleCheckUpdates}
                      disabled={
                        updateState.checking ||
                        updateState.downloading ||
                        installingUpdate
                      }
                      className="h-7 rounded-lg border border-border bg-secondary/40 px-2.5 text-xs font-medium text-foreground hover:bg-secondary/60 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {updateState.checking
                        ? "Checking..."
                        : "Check for Updates"}
                    </button>
                    <button
                      onClick={handleDownloadUpdate}
                      disabled={
                        !updateState.updateAvailable ||
                        updateState.downloading ||
                        updateState.updateDownloaded ||
                        installingUpdate
                      }
                      className="h-7 rounded-lg border border-border bg-secondary/40 px-2.5 text-xs font-medium text-foreground hover:bg-secondary/60 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {updateState.downloading
                        ? `Downloading${typeof updateState.progressPercent === "number" ? ` ${Math.round(updateState.progressPercent)}%` : "..."}`
                        : updateState.updateDownloaded
                          ? "Downloaded"
                          : "Download Update"}
                    </button>
                    <button
                      onClick={handleInstallUpdate}
                      disabled={
                        !updateState.updateDownloaded || installingUpdate
                      }
                      className="h-7 rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {installingUpdate
                        ? "Installing..."
                        : "Install and Restart"}
                    </button>
                  </div>
                )}
                {entitlementNotice ? (
                  <p className="text-xs text-muted-foreground">
                    {entitlementNotice}
                  </p>
                ) : null}
                {!updateState.enabled && !updatesExpired ? (
                  <p className="text-xs text-muted-foreground">
                    Automatic updates are not configured for this build.
                  </p>
                ) : null}
                {updateState.error && !updatesExpired ? (
                  <p className="text-xs text-red-500">{updateState.error}</p>
                ) : null}
              </div>

              <div className="space-y-1 mt-8">
                <h3 className="text-sm font-medium">
                  Command Menu Customization
                </h3>
                <p className="text-xs text-muted-foreground">
                  Drag to reorder or click the eye icon to show/hide sections in
                  the command menu (⌘K).
                </p>
              </div>

              <div className="space-y-1.5 border-t border-border pt-3">
                {commandMenuSections.map((section, index: number) => (
                  <div
                    key={section.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleDragOver(e, index)}
                    className={cn(
                      "flex items-center justify-between rounded-lg border p-2.5 group cursor-default transition-all duration-200",
                      draggedIndex === index
                        ? "bg-blue-500/10 border-blue-500/50 scale-[1.02] shadow-lg z-10"
                        : !section.isVisible
                          ? "bg-secondary/10 border-border/40 opacity-60"
                          : "bg-secondary/30 border-border hover:bg-secondary/50",
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <GripVertical
                        className={cn(
                          "w-4 h-4 transition-colors",
                          draggedIndex === index
                            ? "text-blue-500"
                            : "text-muted-foreground/30 group-hover:text-muted-foreground/60 cursor-grab active:cursor-grabbing",
                        )}
                      />
                      <span
                        className={cn(
                          "text-xs font-medium transition-all duration-200",
                          draggedIndex === index
                            ? "text-blue-500"
                            : !section.isVisible
                              ? "text-muted-foreground line-through"
                              : "text-foreground",
                        )}
                      >
                        {section.name}
                      </span>
                    </div>
                    <button
                      onClick={() => toggleSectionVisibility(section.id)}
                      className={cn(
                        "p-1 rounded hover:bg-muted transition-colors",
                        section.isVisible
                          ? "text-foreground/70"
                          : "text-muted-foreground",
                      )}
                    >
                      <Eye
                        className={cn(
                          "w-4 h-4",
                          !section.isVisible && "opacity-50",
                        )}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <ThemeAddDialog
        open={isEditorThemeDialogOpen}
        onOpenChange={(open) => {
          setIsEditorThemeDialogOpen(open);
          if (!open) resetThemeDialog();
        }}
        title="Add Custom Editor Theme"
        description="Paste a VS Code theme JSON (colors + tokenColors) or a Monaco theme definition."
        nameValue={themeNameInput}
        onNameChange={setThemeNameInput}
        jsonValue={themeJsonInput}
        onJsonChange={setThemeJsonInput}
        jsonPlaceholder="Paste theme JSON here"
        fileName={themeFileName}
        onFileUpload={handleThemeFileUpload}
        onCancel={() => setIsEditorThemeDialogOpen(false)}
        onAdd={handleAddEditorTheme}
        dialogPos={themeDialogPos}
        onDialogHeaderMouseDown={handleDialogHeaderMouseDown}
      />
    </div>
  );
}
