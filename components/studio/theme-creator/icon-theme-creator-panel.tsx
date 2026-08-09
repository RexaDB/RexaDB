"use client";

import { useState, useEffect, useRef, useCallback, useMemo, createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Search, Upload, RotateCcw, X } from "@/lib/icon-theme/lucide-react";
import { cn } from "@/lib/utils";
import { createThemeId, createThemeNameFromId } from "@/lib/studio/editor-themes";
import { Button } from "@/components/ui/button";
import { IconItem } from "./icon-item";
import type { CustomIconTheme } from "@/lib/icon-theme/types";

import * as Lucide from "@/lib/icon-theme/lucide-react";
import { AuthIcon as CustomAuthIcon } from "@/components/studio/AuthIcon";
import { TableEditorIcon as CustomTableEditorIcon } from "@/components/studio/TableEditorIcon";
import { DatabaseIcon as CustomDatabaseIcon } from "@/components/studio/database-icon";
import { toHex, COLOR_PRESETS } from "./theme-colors-shared";
import { ThemePanelHeader, ThemePanelFooter } from "./theme-panel-shell";

const CUSTOM_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  AuthIcon: CustomAuthIcon,
  TableEditorIcon: CustomTableEditorIcon,
  DatabaseIcon: CustomDatabaseIcon,
};

function getIconComponent(name: string): React.ComponentType<{ className?: string }> | undefined {
  return (Lucide as any)[name] ?? CUSTOM_ICONS[name];
}

const ICON_NAMES = [
  "Activity", "AlertCircle", "AlertTriangle", "ArrowDown", "ArrowLeft",
  "ArrowRight", "ArrowRightLeft", "ArrowUp", "ArrowUpDown", "Ban",
  "BarChart3", "Bell", "BellIcon", "BluetoothIcon", "BookOpen", "Bot",
  "Box", "Brain", "Briefcase", "Bug", "Building2", "Calendar",
  "CalendarDays", "Camera", "Check", "CheckCircle2", "CheckIcon",
  "CheckSquare", "ClipboardCheck", "ChevronDown", "ChevronDownIcon",
  "ChevronLeft", "ChevronRight", "ChevronRightIcon", "ChevronsUpDown",
  "ChevronUp", "ChevronUpIcon", "Circle", "Clock", "Clock4", "Cloud",
  "CloudOff", "Code", "Code2", "Columns2", "Columns3", "Command", "Copy",
  "CopyPlus", "CornerDownLeft", "Cpu", "CreditCardIcon", "Database",
  "DatabaseIcon", "Diamond", "Download", "DownloadIcon", "Edit2",
  "EllipsisVertical", "Eraser", "ExternalLink", "Eye", "EyeIcon", "EyeOff",
  "File", "FileArchive", "FileCode", "FileCode2", "FileCodeIcon",
  "FileIcon", "FileJson", "FileText", "FileTextIcon", "FileUp", "Files",
  "Filter", "Fingerprint", "Flame", "Folder", "FolderIcon", "FolderOpen",
  "FolderOpenIcon", "FolderPlus", "FolderSearchIcon", "FunctionSquare",
  "Gauge", "GitBranch", "GitCommitHorizontal", "GitCompare", "GitFork",
  "GitGraph", "Globe", "GripVertical", "GripVerticalIcon", "HardDrive",
  "Hash", "HelpCircleIcon", "History", "House", "ImageIcon", "Info", "Key",
  "Keyboard", "KeyboardIcon", "KeyRound", "LanguagesIcon", "Laptop",
  "Layers", "Layout", "LayoutDashboard", "LayoutGrid", "LayoutIcon",
  "Link", "Link2", "List", "Loader2", "Loader2Icon", "Lock", "LogOut",
  "LogOutIcon", "Mail", "MailIcon", "Maximize2", "Menu", "Minimize2",
  "Minus", "MonitorIcon", "Moon", "MoonIcon", "MoreHorizontal",
  "MoreHorizontalIcon", "MoreVertical", "MoreVerticalIcon", "MusicIcon",
  "Palette", "PaletteIcon", "PanelLeft", "PanelLeftDashed",
  "PanelRightClose", "Pause", "Play", "Plus", "PlusIcon", "PlusSquare",
  "Pencil", "PencilLine", "Pin", "RefreshCcw", "RefreshCw", "RotateCcw",
  "RotateCw", "Rows3", "Save", "SaveIcon", "ScrollText", "Search",
  "SearchX", "Send", "Server", "Settings", "Settings2", "SettingsIcon",
  "Shield", "ShieldCheck", "ShieldIcon", "SlidersHorizontal", "Sparkles",
  "Square", "SquareTerminal", "Star", "Sun", "SunIcon", "Table", "Table2",
  "Tag", "Terminal", "TestTube", "Timer", "Trash2", "TrendingDownIcon",
  "TrendingUp", "TrendingUpIcon", "Type", "Undo2", "Unlock", "Upload",
  "UploadCloud", "User", "UserIcon", "UserPlus", "Users", "VideoIcon",
  "Wand2", "WandSparkles", "Workflow", "X", "XCircle", "XIcon", "Zap",
  "AuthIcon", "TableEditorIcon",
];



const svgBodyCache = new Map<string, string>();

function getSvgBody(name: string): string {
  const cached = svgBodyCache.get(name);
  if (cached !== undefined) return cached;
  try {
    const IconComp = getIconComponent(name);
    if (!IconComp) {
      svgBodyCache.set(name, "");
      return "";
    }
    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.left = "-9999px";
    container.style.top = "-9999px";
    document.body.appendChild(container);
    const root = createRoot(container);
    flushSync(() => {
      root.render(createElement(IconComp));
    });
    const svg = container.querySelector("svg");
    const body = svg ? svg.innerHTML : "";
    root.unmount();
    document.body.removeChild(container);
    svgBodyCache.set(name, body);
    return body;
  } catch {
    svgBodyCache.set(name, "");
    return "";
  }
}

interface DraftIcon {
  color: string | null;
  svgBody: string | null;
}

interface IconThemeCreatorPanelProps {
  isOpen: boolean;
  onClose: () => void;
  iconThemeId: string;
  customIconThemes: CustomIconTheme[];
  onSaveIconTheme: (theme: CustomIconTheme) => void;
}

export function IconThemeCreatorPanel({
  isOpen,
  onClose,
  iconThemeId,
  customIconThemes,
  onSaveIconTheme,
}: IconThemeCreatorPanelProps) {
  const [search, setSearch] = useState("");
  const [draftIcons, setDraftIcons] = useState<Record<string, DraftIcon>>({});
  const [selectedIcon, setSelectedIcon] = useState<string | null>(null);
  const originalsRef = useRef<Record<string, DraftIcon>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const [hexInput, setHexInput] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    const active = customIconThemes.find((t) => t.id === iconThemeId);
    const initial: Record<string, DraftIcon> = {};
    if (active) {
      for (const [name, icon] of Object.entries(active.icons)) {
        initial[name] = {
          color: icon.attrs?.stroke ?? null,
          svgBody: icon.body ?? null,
        };
      }
    }
    setDraftIcons(initial);
    originalsRef.current = JSON.parse(JSON.stringify(initial));
    setSearch("");
    setSelectedIcon(null);
  }, [isOpen, iconThemeId, customIconThemes]);

  useEffect(() => {
    const draft = selectedIcon ? draftIcons[selectedIcon] : undefined;
    setHexInput(draft?.color ? toHex(draft.color) : "");
  }, [selectedIcon, draftIcons]);

  const handleChange = useCallback(
    (name: string, color: string | null, svgBody: string | null) => {
      setDraftIcons((prev) => {
        const next = { ...prev, [name]: { color, svgBody } };
        if (!color && !svgBody) delete next[name];
        return next;
      });
    },
    [],
  );

  const hasChanges = useMemo(() => {
    const orig = originalsRef.current;
    const keys = new Set([...Object.keys(orig), ...Object.keys(draftIcons)]);
    for (const key of keys) {
      const a = orig[key];
      const b = draftIcons[key];
      if (!a && !b) continue;
      if (!a || !b) return true;
      if (a.color !== b.color || a.svgBody !== b.svgBody) return true;
    }
    return false;
  }, [draftIcons]);

  const filteredNames = useMemo(
    () =>
      search.trim()
        ? ICON_NAMES.filter((n) =>
            n.toLowerCase().includes(search.toLowerCase()),
          )
        : ICON_NAMES,
    [search],
  );

  // fallow-ignore-next-line code-duplication
  const handleSave = useCallback(() => {
    const existingIds = new Set(customIconThemes.map((t) => t.id));
    const id = createThemeId("Icon Theme", existingIds);
    const name = createThemeNameFromId(id);
    const icons: CustomIconTheme["icons"] = {};
    for (const [iconName, draft] of Object.entries(draftIcons)) {
      const attrs: Record<string, string> = {};
      if (draft.color) attrs.stroke = draft.color;
      const body = draft.svgBody || getSvgBody(iconName);
      if (body) {
        icons[iconName] = {
          body,
          ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
        };
      }
    }
    onSaveIconTheme({ id, name, icons });
    onClose();
  }, [draftIcons, customIconThemes, onSaveIconTheme, onClose]);

  const handleDiscard = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleResetAll = useCallback(() => {
    setDraftIcons({});
    setSelectedIcon(null);
  }, []);

  const handleSelect = useCallback((name: string) => {
    setSelectedIcon((prev) => (prev === name ? null : name));
  }, []);

  const modifiedCount = useMemo(
    () => Object.keys(draftIcons).length,
    [draftIcons],
  );

  const selectedDraft = selectedIcon ? draftIcons[selectedIcon] : null;
  const SelectedComp = selectedIcon ? getIconComponent(selectedIcon) : null;

  const handleColorPick = useCallback(
    (c: string) => {
      if (!selectedIcon) return;
      handleChange(selectedIcon, c, selectedDraft?.svgBody ?? null);
    },
    [selectedIcon, selectedDraft, handleChange],
  );

  const handleHexBlur = useCallback(() => {
    if (!selectedIcon) return;
    const cleaned = hexInput.replace("#", "");
    if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
      handleChange(selectedIcon, `#${cleaned.toLowerCase()}`, selectedDraft?.svgBody ?? null);
    }
  }, [hexInput, selectedIcon, selectedDraft, handleChange]);

  const handleReset = useCallback(() => {
    if (!selectedIcon) return;
    handleChange(selectedIcon, null, null);
    setHexInput("");
  }, [selectedIcon, handleChange]);

  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!selectedIcon) return;
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        const match = text.match(/<svg[^>]*>([\s\S]*)<\/svg>/i);
        if (match) {
          handleChange(selectedIcon, selectedDraft?.color ?? null, match[1].trim());
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [selectedIcon, selectedDraft, handleChange],
  );

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "flex h-full w-[340px] shrink-0 flex-col border-l border-studio-border bg-background overflow-hidden",
        "animate-in slide-in-from-right duration-200",
      )}
    >
      <ThemePanelHeader title="Icon Theme Creator" onClose={onClose} />

      {/* Search */}
      <div className="px-3 py-2 border-b border-studio-border/50">
        <div className="flex items-center gap-1.5 rounded-sm border border-studio-border/40 px-2 h-7">
          <Search className="h-3 w-3 shrink-0 text-muted-foreground/60" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search icons..."
            className="flex-1 bg-transparent text-xs outline-none text-foreground placeholder:text-muted-foreground/40"
          />
          {modifiedCount > 0 && (
            <span className="text-[10px] text-muted-foreground/60 shrink-0">
              {modifiedCount} modified
            </span>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className={cn("overflow-y-auto", selectedIcon ? "flex-1" : "flex-1")}>
        <div className="grid grid-cols-5 gap-px p-2">
          {filteredNames
            .map((name) => ({ name, comp: getIconComponent(name) }))
            .filter((entry): entry is { name: string; comp: React.ComponentType<{ className?: string }> } => !!entry.comp)
            .map(({ name, comp: iconComp }) => {
              const draft = draftIcons[name];
              return (
                <IconItem
                  key={name}
                  name={name}
                  icon={iconComp}
                  color={draft?.color ?? null}
                  selected={selectedIcon === name}
                  modified={!!draft}
                  onSelect={handleSelect}
                />
              );
            })}
        </div>
        {filteredNames.length === 0 && (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            No icons found
          </div>
        )}
      </div>

      {/* Detail panel for selected icon */}
      {selectedIcon && SelectedComp ? (
        <div className="border-t border-studio-border px-3 py-2.5 space-y-2.5">
          <div className="flex items-center gap-2.5 pb-2 border-b border-studio-border/50">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-sm border border-studio-border/60"
              style={{ color: selectedDraft?.color ?? undefined }}
            >
              <SelectedComp className="h-5 w-5" />
            </div>
            <span className="text-xs font-medium text-foreground truncate flex-1">{selectedIcon}</span>
            <button
              type="button"
              onClick={() => setSelectedIcon(null)}
              className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          <div>
            <span className="text-[10px] text-muted-foreground mb-1 block">Color</span>
            <div className="grid grid-cols-8 gap-1">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => handleColorPick(c)}
                  className={cn(
                    "h-4 w-4 cursor-pointer rounded-sm border transition-transform hover:scale-125",
                    toHex(selectedDraft?.color ?? "") === c ? "border-foreground" : "border-transparent",
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <div
              className="h-4 w-4 shrink-0 rounded-sm border border-studio-border/60"
              style={{ backgroundColor: hexInput || "#888" }}
            />
            <input
              type="text"
              value={hexInput}
              onChange={(e) => setHexInput(e.target.value)}
              onBlur={handleHexBlur}
              onKeyDown={(e) => e.key === "Enter" && handleHexBlur()}
              placeholder="#000000"
              className="h-6 flex-1 rounded-sm border border-border/50 bg-transparent px-1.5 font-mono text-xs outline-none focus:border-border"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <input
              ref={fileRef}
              type="file"
              accept=".svg"
              className="hidden"
              onChange={handleFile}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 flex-1 gap-1 text-[10px]"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-3 w-3" />
              {selectedDraft?.svgBody ? "Replace SVG" : "Upload SVG"}
            </Button>
          </div>

          {(selectedDraft?.color || selectedDraft?.svgBody) && (
            <button
              type="button"
              onClick={handleReset}
              className="flex w-full items-center justify-center gap-1 rounded-sm py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" />
              Reset to default
            </button>
          )}
        </div>
      ) : null}

      <ThemePanelFooter hasChanges={hasChanges} onResetAll={handleResetAll} onDiscard={handleDiscard} onSave={handleSave} />
    </div>
  );
}
