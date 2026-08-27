"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  EllipsisVertical,
  FileJson,
  Plus,
  RotateCcw,
  Search,
  AlertTriangle,
  Trash2,
  X,
} from "@/lib/icon-theme/lucide-react";
import { cn } from "@/lib/utils";
import {
  KEYBINDING_ACTIONS,
  DB_VIEWS,
  SIDEBAR_VIEWS,
  buildShortcutCombo,
  describeBinding,
  formatShortcutForPlatform,
  getDefaultKeybindings,
} from "@/lib/studio/keybindings";
import { getKeybindingsFile } from "@/lib/api/actions-client";
import { openExternalUrl } from "@/lib/desktop";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KeybindingBinding {
  type: string;
  schema?: string;
  table?: string;
  database?: string;
  index?: number;
  view?: string;
  sidebar?: string;
  combo?: string;
  [key: string]: unknown;
}

type KeybindingMap = Record<string, KeybindingBinding>;

// ---------------------------------------------------------------------------
// Helpers (adapted from t3code's keybinding logic)
// ---------------------------------------------------------------------------

/** Render a combo string as a group of Kbd "pills", matching t3code's design. */
function KeybindingPill({ value }: { value: string }) {
  const parts = value.split("+");
  return (
    <KbdGroup className="bg-transparent p-0 shadow-none">
      {parts.map((part) => (
        <Kbd key={part} className="min-w-6 justify-center px-1.5">
          {part === "Cmd"
            ? "⌘"
            : part === "Shift"
              ? "⇧"
              : part === "Alt"
                ? "⌥"
                : part === "Ctrl"
                  ? "⌃"
                  : part.length === 1
                    ? part.toUpperCase()
                    : part}
        </Kbd>
      ))}
    </KbdGroup>
  );
}

/** Build a flat row object from the keybinding map for table rendering. */
interface KeybindingRow {
  id: string;
  combo: string;
  binding: KeybindingBinding;
  actionName: string;
  description: string;
  isDefault: boolean;
}

function buildRows(
  keybindings: KeybindingMap,
  query: string,
): KeybindingRow[] {
  const defaults = getDefaultKeybindings();
  const entries = Object.entries(keybindings).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  const rows: KeybindingRow[] = entries.map(([combo, binding]) => {
    const actionName =
      KEYBINDING_ACTIONS.find((action) => action.id === binding.type)?.name ||
      binding.type;
    return {
      id: combo,
      combo,
      binding,
      actionName,
      description: describeBinding(binding),
      isDefault:
        defaults[combo]?.type === binding.type &&
        JSON.stringify(defaults[combo]) === JSON.stringify({ ...binding, combo }),
    };
  });

  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (row) =>
      row.combo.toLowerCase().includes(q) ||
      row.actionName.toLowerCase().includes(q) ||
      row.description.toLowerCase().includes(q) ||
      row.binding.type.toLowerCase().includes(q),
  );
}

/** Detect conflicts: same combo used by multiple bindings. */
function findConflicts(
  allRows: KeybindingRow[],
  combo: string,
  excludeId?: string,
): string[] {
  if (!combo.trim()) return [];
  return allRows
    .filter(
      (row) =>
        row.id !== excludeId &&
        row.combo.toLowerCase() === combo.toLowerCase(),
    )
    .map((row) => row.actionName);
}

// ---------------------------------------------------------------------------
// Action field editors (for bindings that take extra params like schema/table)
// ---------------------------------------------------------------------------

function ActionFieldsEditor({
  binding,
  onChange,
}: {
  binding: KeybindingBinding;
  onChange: (patch: Partial<KeybindingBinding>) => void;
}) {
  const action = KEYBINDING_ACTIONS.find((a) => a.id === binding.type);
  if (!action) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {action.fields.includes("schema") ? (
        <Select
          value={binding.schema ?? "public"}
          onValueChange={(v) => onChange({ schema: v })}
        >
          <SelectTrigger className="h-7 w-28 rounded-sm !bg-inherit text-[13px]">
            <SelectValue placeholder="Schema" />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            <SelectItem value="public">public</SelectItem>
            <SelectItem value="information_schema">information_schema</SelectItem>
          </SelectContent>
        </Select>
      ) : null}

      {action.fields.includes("table") ? (
        <Input
          value={binding.table ?? ""}
          onChange={(e) => onChange({ table: e.target.value })}
          placeholder="table name"
          className="h-7 w-28 rounded-sm !bg-inherit text-[13px]"
        />
      ) : null}

      {action.fields.includes("database") ? (
        <Input
          value={binding.database ?? ""}
          onChange={(e) => onChange({ database: e.target.value })}
          placeholder="database"
          className="h-7 w-28 rounded-sm !bg-inherit text-[13px]"
        />
      ) : null}

      {action.fields.includes("view") ? (
        <Select
          value={binding.view ?? "schema"}
          onValueChange={(v) => onChange({ view: v })}
        >
          <SelectTrigger className="h-7 w-28 rounded-sm !bg-inherit text-[13px]">
            <SelectValue placeholder="View" />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            {DB_VIEWS.map((view) => (
              <SelectItem key={view.id} value={view.id}>
                {view.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {action.fields.includes("sidebar") ? (
        <Select
          value={binding.sidebar ?? "tables"}
          onValueChange={(v) => onChange({ sidebar: v })}
        >
          <SelectTrigger className="h-7 w-28 rounded-sm !bg-inherit text-[13px]">
            <SelectValue placeholder="Sidebar" />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            {SIDEBAR_VIEWS.map((view) => (
              <SelectItem key={view.id} value={view.id}>
                {view.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {action.fields.includes("index") ? (
        <Input
          type="number"
          min={0}
          value={binding.index ?? 0}
          onChange={(e) =>
            onChange({ index: parseInt(e.target.value || "0", 10) || 0 })
          }
          className="h-7 w-16 rounded-sm !bg-inherit text-[13px]"
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Key capture input (records pressed keys into a combo string)
// ---------------------------------------------------------------------------

function KeyCaptureInput({
  value,
  isRecording,
  onRecordStart,
  onRecordEnd,
  onChange,
  placeholder = "Unassigned",
  ariaLabel,
}: {
  value: string;
  isRecording: boolean;
  onRecordStart: () => void;
  onRecordEnd: () => void;
  onChange: (combo: string) => void;
  placeholder?: string;
  ariaLabel: string;
}) {
  return (
    <Input
      data-keybinding-capture=""
      autoFocus={isRecording}
      aria-label={ariaLabel}
      value={isRecording ? "" : value}
      placeholder={isRecording ? "Press shortcut" : placeholder}
      className={cn(
        "h-7 w-44 rounded-md text-[13px]",
        isRecording && "border-primary/70 bg-primary/5",
      )}
      onFocus={onRecordStart}
      onBlur={onRecordEnd}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Tab") return;
        e.preventDefault();
        if (e.key === "Escape") {
          onChange("");
          onRecordEnd();
          return;
        }
        const combo = buildShortcutCombo({
          key: e.key,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
        });
        if (!combo) return;
        onChange(combo);
        onRecordEnd();
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Conflict warning (t3code style)
// ---------------------------------------------------------------------------

function ConflictWarning({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;
  const description =
    labels.length === 1
      ? `Conflicts with ${labels[0]}.`
      : `Conflicts with ${labels.slice(0, 3).join(", ")}${labels.length > 3 ? ", and more" : ""}.`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-label={description}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-amber-500 outline-none transition-colors hover:bg-amber-500/10 focus-visible:ring-2 focus-visible:ring-amber-500/25"
          >
            <AlertTriangle className="size-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-72 whitespace-normal leading-relaxed">
          {description} The most recent matching binding wins when both conditions can apply.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Existing keybinding row (t3code table design)
// ---------------------------------------------------------------------------

function KeybindingTableRow({
  row,
  allRows,
  isSaving,
  onSave,
  onReset,
  onRemove,
}: {
  row: KeybindingRow;
  allRows: KeybindingRow[];
  isSaving: boolean;
  onSave: (combo: string, binding: KeybindingBinding) => void;
  onReset: (row: KeybindingRow) => void;
  onRemove: (row: KeybindingRow) => void;
}) {
  const [keyDraft, setKeyDraft] = useState(row.combo);
  const [bindingDraft, setBindingDraft] = useState<KeybindingBinding>(
    row.binding,
  );
  const [isRecording, setIsRecording] = useState(false);

  // Sync local draft when the row changes externally
  useEffect(() => {
    setKeyDraft(row.combo);
    setBindingDraft(row.binding);
  }, [row.combo, row.binding]);

  const isDirty =
    keyDraft !== row.combo ||
    JSON.stringify(bindingDraft) !== JSON.stringify(row.binding);

  const showPill =
    !isRecording && keyDraft === row.combo && keyDraft.length > 0 && !isDirty;
  const conflictLabels = findConflicts(allRows, keyDraft, row.id);
  const canReset = !row.isDefault;
  const canRemove = true;
  const hasRowActions = canReset || canRemove;

  const save = () => {
    onSave(keyDraft, bindingDraft);
  };

  return (
    <div className="grid grid-cols-[minmax(190px,1.1fr)_minmax(220px,0.85fr)_minmax(210px,1fr)_60px] items-center px-4 py-1.5 text-sm hover:bg-accent/40">
      {/* Command */}
      <div className="min-w-0 pr-4">
        <div className="flex min-w-0 items-center gap-1.5">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  aria-label={row.binding.type}
                  className="truncate text-[13px] font-medium text-foreground"
                >
                  {row.actionName}
                </div>
              </TooltipTrigger>
              <TooltipContent side="top">{row.binding.type}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Keybinding */}
      <div className="flex min-w-0 items-center gap-2 pr-4">
        {showPill ? (
          <button
            type="button"
            onClick={() => setIsRecording(true)}
            aria-label={`Edit shortcut for ${row.actionName}`}
            className="group inline-flex h-7 items-center gap-1.5 rounded-md border border-transparent px-1.5 outline-none transition-colors hover:border-border/70 hover:bg-background focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/24"
          >
            <KeybindingPill value={row.combo} />
            <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/0 transition-opacity group-hover:text-muted-foreground/70 group-focus-visible:text-muted-foreground/70">
              Edit
            </span>
          </button>
        ) : (
          <KeyCaptureInput
            value={keyDraft}
            isRecording={isRecording}
            onRecordStart={() => setIsRecording(true)}
            onRecordEnd={() => setIsRecording(false)}
            onChange={setKeyDraft}
            ariaLabel={`Keybinding for ${row.actionName}`}
          />
        )}
        {isDirty ? (
          <Button
            size="sm"
            disabled={isSaving || keyDraft.trim().length === 0}
            onClick={save}
          >
            {isSaving ? "Saving" : "Save"}
          </Button>
        ) : null}
      </div>

      {/* Action params */}
      <div className="pr-4">
        <ActionFieldsEditor
          binding={bindingDraft}
          onChange={(patch) =>
            setBindingDraft((prev) => ({ ...prev, ...patch }))
          }
        />
      </div>

      {/* Status / actions */}
      <div className="flex items-center justify-end gap-1">
        <ConflictWarning labels={conflictLabels} />
        {hasRowActions ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-7 text-muted-foreground hover:text-foreground"
                disabled={isSaving}
                aria-label={`Actions for ${row.actionName}`}
              >
                <EllipsisVertical className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-36">
              {canReset ? (
                <DropdownMenuItem
                  disabled={isSaving}
                  onClick={() => onReset(row)}
                >
                  <RotateCcw className="size-3.5" />
                  Reset to default
                </DropdownMenuItem>
              ) : null}
              {canRemove ? (
                <DropdownMenuItem
                  variant="destructive"
                  disabled={isSaving}
                  onClick={() => onRemove(row)}
                >
                  <Trash2 className="size-3.5" />
                  Remove
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <span className="sr-only">
          {formatShortcutForPlatform(row.combo)}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New keybinding row (t3code "add" row)
// ---------------------------------------------------------------------------

function NewKeybindingTableRow({
  allRows,
  isSaving,
  onSave,
  onCancel,
}: {
  allRows: KeybindingRow[];
  isSaving: boolean;
  onSave: (combo: string, binding: KeybindingBinding) => void;
  onCancel: () => void;
}) {
  const [combo, setCombo] = useState("");
  const [binding, setBinding] = useState<KeybindingBinding>({
    type: "TOGGLE_COMMAND_MENU",
  });
  const [isRecording, setIsRecording] = useState(false);
  const actionName =
    KEYBINDING_ACTIONS.find((a) => a.id === binding.type)?.name ||
    "new keybinding";
  const conflictLabels = findConflicts(allRows, combo, "new");

  return (
    <div className="grid grid-cols-[minmax(190px,1.1fr)_minmax(220px,0.85fr)_minmax(210px,1fr)_60px] items-center px-4 py-1.5 text-sm hover:bg-accent/40">
      <div className="min-w-0 pr-4">
        <Select
          value={binding.type}
          onValueChange={(v) =>
            setBinding((prev) => ({ ...prev, type: v }))
          }
        >
          <SelectTrigger className="h-7 w-full max-w-60 text-xs">
            <SelectValue placeholder="Command" />
          </SelectTrigger>
          <SelectContent className="max-h-72 min-w-56">
            {KEYBINDING_ACTIONS.map((action) => (
              <SelectItem
                key={action.id}
                value={action.id}
                className="min-h-7 w-full py-1 text-xs"
              >
                <span className="truncate">{action.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex min-w-0 items-center gap-2 pr-4">
        <KeyCaptureInput
          value={combo}
          isRecording={isRecording}
          onRecordStart={() => setIsRecording(true)}
          onRecordEnd={() => setIsRecording(false)}
          onChange={setCombo}
          ariaLabel={`Keybinding for ${actionName}`}
        />
        <Button
          size="sm"
          disabled={isSaving || combo.trim().length === 0}
          onClick={() => onSave(combo, binding)}
        >
          {isSaving ? "Saving" : "Save"}
        </Button>
      </div>
      <div className="pr-4">
        <ActionFieldsEditor
          binding={binding}
          onChange={(patch) => setBinding((prev) => ({ ...prev, ...patch }))}
        />
      </div>
      <div className="flex items-center justify-end gap-1">
        <ConflictWarning labels={conflictLabels} />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 text-muted-foreground hover:text-foreground"
          disabled={isSaving}
          aria-label="Cancel new keybinding"
          onClick={onCancel}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expandable header search (t3code design)
// ---------------------------------------------------------------------------

function ExpandableHeaderSearch({
  query,
  onChange,
  isOpen,
  onOpenChange,
  inputRef,
  collapsedAccessory,
}: {
  query: string;
  onChange: (next: string) => void;
  isOpen: boolean;
  onOpenChange: (next: boolean) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  collapsedAccessory?: React.ReactNode;
}) {
  if (!isOpen) {
    return (
      <>
        {collapsedAccessory}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() => onOpenChange(true)}
                aria-label="Search keybindings"
              >
                <Search className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Search keybindings</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </>
    );
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        autoFocus
        type="search"
        value={query}
        onChange={(e) => onChange(e.currentTarget.value)}
        onBlur={() => {
          if (query.length === 0) onOpenChange(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onChange("");
            onOpenChange(false);
          }
        }}
        placeholder="Search keybindings"
        aria-label="Search keybindings"
        className="h-7 w-44 pl-7 text-xs"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// KeybindingsPanel — the t3code-style settings panel
// ---------------------------------------------------------------------------

interface KeybindingsPanelProps {
  keybindings: KeybindingMap;
  setKeybindings: Dispatch<SetStateAction<KeybindingMap>>;
}

export function KeybindingsPanel({
  keybindings,
  setKeybindings,
}: KeybindingsPanelProps) {
  const [query, setQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isAddingBinding, setIsAddingBinding] = useState(false);
  const [savingCombo, setSavingCombo] = useState<string | null>(null);
  const [openingJsonFile, setOpeningJsonFile] = useState(false);

  const openJsonFile = async () => {
    setOpeningJsonFile(true);
    try {
      const result = await getKeybindingsFile();
      const filePath = result?.filePath;
      if (!result.success || !filePath) {
        throw new Error(result.error || "keybindings.json path unavailable");
      }
      await openExternalUrl(filePath);
    } catch (error) {
      console.error("Failed to open keybindings.json", error);
      toast.error("Couldn't open keybindings.json");
    } finally {
      setOpeningJsonFile(false);
    }
  };

  const rows = useMemo(
    () => buildRows(keybindings, query),
    [keybindings, query],
  );

  // Cmd/Ctrl+F opens search (t3code behavior)
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod || e.altKey || e.key.toLowerCase() !== "f") return;
      const target = e.target;
      if (
        target !== searchInputRef.current &&
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      setIsSearchOpen(true);
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const saveKeybinding = (combo: string, binding: KeybindingBinding) => {
    const trimmed = combo.trim();
    if (!trimmed) return;
    setSavingCombo(combo);
    setKeybindings((prev) => {
      const next = { ...prev };
      // Remove any old entry that maps to this combo (replace)
      delete next[combo];
      next[trimmed] = { ...binding, combo: trimmed };
      return next;
    });
    setSavingCombo(null);
    setIsAddingBinding(false);
  };

  const removeKeybinding = (row: KeybindingRow) => {
    setKeybindings((prev) => {
      const next = { ...prev };
      delete next[row.combo];
      return next;
    });
  };

  const resetKeybinding = (row: KeybindingRow) => {
    const defaults = getDefaultKeybindings();
    const defaultBinding = defaults[row.combo];
    if (!defaultBinding) {
      // If there's no default for this combo, just remove it
      removeKeybinding(row);
      return;
    }
    setKeybindings((prev) => ({
      ...prev,
      [row.combo]: { ...defaultBinding, combo: row.combo },
    }));
  };

  const bindingsCount = (
    <span className="text-[11px] text-muted-foreground">
      {rows.length + (isAddingBinding ? 1 : 0)}{" "}
      {rows.length + (isAddingBinding ? 1 : 0) === 1 ? "binding" : "bindings"}
    </span>
  );

  return (
    <TooltipProvider>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Keybindings</h2>
          <p className="text-xs text-muted-foreground">
            Customize keyboard shortcuts. Click a keybinding to edit, or add a
            new one.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <ExpandableHeaderSearch
            query={query}
            onChange={setQuery}
            isOpen={isSearchOpen}
            onOpenChange={setIsSearchOpen}
            inputRef={searchInputRef}
            collapsedAccessory={bindingsCount}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() => setIsAddingBinding(true)}
                aria-label="Add keybinding"
              >
                <Plus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Add keybinding</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Open keybindings.json"
                disabled={openingJsonFile}
                onClick={() => void openJsonFile()}
              >
                <FileJson className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Open keybindings.json</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card/60">
        <ScrollArea className="w-full max-w-full rounded-none">
          <div className="min-w-[680px]">
            {/* Column headers */}
            <div className="grid grid-cols-[minmax(190px,1.1fr)_minmax(220px,0.85fr)_minmax(210px,1fr)_60px] border-b border-border/70 bg-muted/25 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
              <div>Command</div>
              <div>Keybinding</div>
              <div>Parameters</div>
              <div className="text-right">Status</div>
            </div>

            {/* Rows */}
            <div className="divide-y divide-border/60">
              {isAddingBinding ? (
                <NewKeybindingTableRow
                  allRows={rows}
                  isSaving={savingCombo !== null}
                  onSave={saveKeybinding}
                  onCancel={() => setIsAddingBinding(false)}
                />
              ) : null}
              {rows.map((row) => (
                <KeybindingTableRow
                  key={row.id}
                  row={row}
                  allRows={rows}
                  isSaving={savingCombo === row.combo}
                  onSave={(combo, binding) => {
                    setKeybindings((prev) => {
                      const next = { ...prev };
                      if (combo !== row.combo) delete next[row.combo];
                      next[combo] = { ...binding, combo };
                      return next;
                    });
                  }}
                  onReset={resetKeybinding}
                  onRemove={removeKeybinding}
                />
              ))}
              {rows.length === 0 && !isAddingBinding ? (
                <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                  No keybindings match your search.
                </div>
              ) : null}
            </div>
          </div>
        </ScrollArea>
      </div>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// KeybindingsView — standalone tab wrapper (kept for backward compatibility)
// ---------------------------------------------------------------------------

interface StudioKeybindingsModel {
  keybindings: KeybindingMap;
  setKeybindings: Dispatch<SetStateAction<KeybindingMap>>;
  schemas: string[];
  tables: string[];
  databases: string[];
}

interface KeybindingsViewProps {
  studio: StudioKeybindingsModel;
}

export function KeybindingsView({ studio }: KeybindingsViewProps) {
  const { keybindings, setKeybindings } = studio;

  return (
    <div className="flex-1 h-full overflow-auto bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <KeybindingsPanel
          keybindings={keybindings}
          setKeybindings={setKeybindings}
        />
      </div>
    </div>
  );
}
