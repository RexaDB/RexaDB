"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Check,
  Code2,
  Keyboard,
  PaletteIcon,
  Pencil,
  Plus,
  Search,
  Trash2,
  WandSparkles,
} from "@/lib/icon-theme/lucide-react";
import { cn } from "@/lib/utils";
import {
  KEYBINDING_ACTIONS,
  DB_VIEWS,
  SIDEBAR_VIEWS,
  buildShortcutCombo,
  describeBinding,
  formatShortcutForPlatform,
} from "@/lib/studio/keybindings";

interface KeybindingsViewProps {
  studio: StudioKeybindingsModel;
}

type KeybindingMode = "ui" | "config";

type KeybindingActionId = (typeof KEYBINDING_ACTIONS)[number]["id"];

interface KeybindingBinding {
  type: KeybindingActionId;
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

interface NewBinding {
  combo: string;
  type: KeybindingActionId;
  schema: string;
  table: string;
  database: string;
  index: number;
  view: string;
  sidebar: string;
}

interface StudioKeybindingsModel {
  keybindings: KeybindingMap;
  setKeybindings: Dispatch<SetStateAction<KeybindingMap>>;
  schemas: string[];
  tables: string[];
  databases: string[];
}

const EMPTY_BINDING_TEMPLATE: NewBinding = {
  combo: "",
  type: "NAVIGATE_TABLE",
  schema: "public",
  table: "",
  database: "",
  index: 0,
  view: "schema",
  sidebar: "tables",
};

function validateConfig(input: unknown): {
  valid: KeybindingMap | null;
  error: string | null;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      valid: null,
      error: "Config must be a JSON object where keys are shortcut combos.",
    };
  }

  const actionsById = new Map(
    KEYBINDING_ACTIONS.map((action) => [action.id, action]),
  );
  const source = input as Record<string, unknown>;

  for (const [combo, rawBinding] of Object.entries(source)) {
    if (!combo.trim()) {
      return { valid: null, error: "Shortcut keys cannot be empty." };
    }

    if (
      !rawBinding ||
      typeof rawBinding !== "object" ||
      Array.isArray(rawBinding)
    ) {
      return {
        valid: null,
        error: `Shortcut \"${combo}\" must be an object with at least a \"type\" field.`,
      };
    }

    const binding = rawBinding as Record<string, unknown>;
    const rawType = binding.type;

    if (typeof rawType !== "string" || !actionsById.has(rawType)) {
      return {
        valid: null,
        error: `Shortcut \"${combo}\" uses an unknown action type.`,
      };
    }

    const action = actionsById.get(rawType)!;
    for (const field of action.fields) {
      const value = binding[field];
      if (value === undefined || value === null || value === "") {
        return {
          valid: null,
          error: `Shortcut \"${combo}\" is missing required field \"${field}\".`,
        };
      }
    }

    if (
      action.fields.includes("index") &&
      (!Number.isInteger(binding.index) || (binding.index as number) < 0)
    ) {
      return {
        valid: null,
        error: `Shortcut \"${combo}\" must have a non-negative integer \"index\".`,
      };
    }

    if (
      action.fields.includes("view") &&
      !DB_VIEWS.some((view) => view.id === binding.view)
    ) {
      return {
        valid: null,
        error: `Shortcut \"${combo}\" has invalid \"view\" value.`,
      };
    }

    if (
      action.fields.includes("sidebar") &&
      !SIDEBAR_VIEWS.some((view) => view.id === binding.sidebar)
    ) {
      return {
        valid: null,
        error: `Shortcut \"${combo}\" has invalid \"sidebar\" value.`,
      };
    }
  }

  return { valid: source as KeybindingMap, error: null };
}

export function KeybindingsView({ studio }: KeybindingsViewProps) {
  const { keybindings, setKeybindings, schemas, tables, databases } = studio;

  const [mode, setMode] = useState<KeybindingMode>("ui");
  const [newBinding, setNewBinding] = useState<NewBinding>(
    EMPTY_BINDING_TEMPLATE,
  );
  const [isCapturing, setIsCapturing] = useState(false);
  const [editingCombo, setEditingCombo] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [configText, setConfigText] = useState(
    JSON.stringify(keybindings, null, 2),
  );
  const [configError, setConfigError] = useState<string | null>(null);
  const [showModeToggle, setShowModeToggle] = useState<boolean | undefined>(
    undefined,
  );
  const headerRowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = headerRowRef.current;
    if (!el) return;

    const check = () => {
      const avail = el.clientWidth;
      const hide = avail < 420;
      console.log("[keybindings] container width:", avail, "hide:", hide);
      setShowModeToggle(!hide);
    };

    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selectedAction = KEYBINDING_ACTIONS.find(
    (action) => action.id === newBinding.type,
  );
  const canonicalConfigText = useMemo(
    () => JSON.stringify(keybindings, null, 2),
    [keybindings],
  );

  const sortedBindings = useMemo(
    () => Object.entries(keybindings).sort(([a], [b]) => a.localeCompare(b)),
    [keybindings],
  );

  const filteredBindings = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sortedBindings;

    return sortedBindings.filter(([combo, binding]) => {
      const actionName =
        KEYBINDING_ACTIONS.find((action) => action.id === binding.type)?.name ||
        binding.type;
      const description = describeBinding(binding);
      return `${combo} ${actionName} ${description}`
        .toLowerCase()
        .includes(query);
    });
  }, [searchQuery, sortedBindings]);

  const switchMode = (nextMode: KeybindingMode) => {
    setMode(nextMode);
    if (nextMode === "config") {
      setConfigText(canonicalConfigText);
      setConfigError(null);
    }
  };

  const addBinding = () => {
    if (!newBinding.combo) return;

    setKeybindings((prev) => {
      const next = { ...prev };
      if (editingCombo) delete next[editingCombo];
      next[newBinding.combo] = { ...newBinding };
      return next;
    });

    setNewBinding(EMPTY_BINDING_TEMPLATE);
    setEditingCombo(null);
  };

  const removeBinding = (combo: string) => {
    setKeybindings((prev) => {
      const next = { ...prev };
      delete next[combo];
      return next;
    });
  };

  const startEditing = (combo: string, binding: KeybindingBinding) => {
    setEditingCombo(combo);
    setNewBinding({
      combo,
      type: binding.type,
      schema: binding.schema ?? "",
      table: binding.table ?? "",
      database: binding.database ?? "",
      index: typeof binding.index === "number" ? binding.index : 0,
      view: binding.view ?? "schema",
      sidebar: binding.sidebar ?? "tables",
    });
  };

  const cancelEditing = () => {
    setEditingCombo(null);
    setNewBinding(EMPTY_BINDING_TEMPLATE);
  };

  const applyConfig = () => {
    try {
      const parsed = JSON.parse(configText);
      const { valid, error } = validateConfig(parsed);
      if (error || !valid) {
        setConfigError(error || "Configuration is invalid.");
        return;
      }

      setKeybindings(valid);
      const formatted = JSON.stringify(valid, null, 2);
      setConfigText(formatted);
      setConfigError(null);
    } catch {
      setConfigError("Invalid JSON. Check commas, quotes, and braces.");
    }
  };

  const formatConfig = () => {
    try {
      const parsed = JSON.parse(configText);
      setConfigText(JSON.stringify(parsed, null, 2));
      setConfigError(null);
    } catch {
      setConfigError("Cannot format invalid JSON.");
    }
  };

  const resetConfig = () => {
    setConfigText(canonicalConfigText);
    setConfigError(null);
  };

  const existingCombo = newBinding.combo && keybindings[newBinding.combo];
  const isConfigDirty = configText !== canonicalConfigText;

  useEffect(() => {
    if (!isCapturing) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      const combo = buildShortcutCombo(event);
      if (!combo) return;
      setNewBinding((prev) => ({ ...prev, combo }));
      setIsCapturing(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isCapturing]);

  return (
    <div className="flex-1 h-full overflow-auto bg-background text-foreground">
      <div className="mx-auto max-w-6xl space-y-4 sm:space-y-6 px-4 sm:px-6 py-6 sm:py-10">
        <header className="flex flex-col gap-3 sm:gap-4 rounded-lg sm:rounded-lg border border-border bg-card/40 p-4 sm:p-5">
          <div
            ref={headerRowRef}
            className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="space-y-1">
              <h2 className="text-sm sm:text-sm font-semibold">Keybindings</h2>
              <p className="text-xs sm:text-xs text-muted-foreground">
                Customize shortcuts in a visual editor or edit the raw JSON
                config like VS Code.
              </p>
            </div>
            {showModeToggle === true ? (
              <div
                className="inline-flex items-center rounded-lg border border-border bg-muted/30 p-0.5 w-full sm:w-auto"
                role="tablist"
              >
                <button
                  role="tab"
                  aria-selected={mode === "ui"}
                  onClick={() => switchMode("ui")}
                  className={cn(
                    "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs sm:text-xs font-medium transition-all whitespace-nowrap flex-1 sm:flex-initial",
                    mode === "ui"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <PaletteIcon className="h-3.5 w-3.5" />
                  Visual
                </button>
                <button
                  role="tab"
                  aria-selected={mode === "config"}
                  onClick={() => switchMode("config")}
                  className={cn(
                    "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs sm:text-xs font-medium transition-all whitespace-nowrap flex-1 sm:flex-initial",
                    mode === "config"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Code2 className="h-3.5 w-3.5" />
                  Config
                </button>
              </div>
            ) : null}
          </div>
        </header>

        {mode === "ui" ? (
          <div
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            }}
            className="grid gap-4 sm:gap-6"
          >
            <Card className="border-border bg-card/60 min-w-0">
              <CardHeader>
                <CardTitle className="text-sm sm:text-sm">
                  {editingCombo ? "Edit Shortcut" : "Create Shortcut"}
                </CardTitle>
                <CardDescription className="text-xs sm:text-xs">
                  {editingCombo
                    ? "Modify the key combo or action. Saving will update the original shortcut."
                    : "Assign a key combo to any supported action. Existing combos are replaced."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 sm:space-y-4">
                <div className="space-y-1.5 sm:space-y-2">
                  <Label className="text-xs sm:text-xs text-muted-foreground">
                    Action
                  </Label>
                  <Select
                    value={newBinding.type}
                    onValueChange={(value: KeybindingActionId) =>
                      setNewBinding((prev) => ({ ...prev, type: value }))
                    }
                  >
                    <SelectTrigger className="h-8 sm:h-9 bg-background text-xs sm:text-xs">
                      <SelectValue placeholder="Select an action" />
                    </SelectTrigger>
                    <SelectContent className="max-h-64 sm:max-h-72">
                      {KEYBINDING_ACTIONS.map((action) => (
                        <SelectItem
                          key={action.id}
                          value={action.id}
                          className="text-xs sm:text-xs"
                        >
                          {action.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5 sm:space-y-2">
                  <Label className="text-xs sm:text-xs text-muted-foreground">
                    Key Combination
                  </Label>
                  <div className="flex gap-1.5 sm:gap-2">
                    <Button
                      variant="outline"
                      className={cn(
                        "h-8 sm:h-9 flex-1 border-dashed font-mono text-xs sm:text-xs",
                        isCapturing &&
                          "border-primary bg-primary/10 text-primary",
                      )}
                      onClick={() => setIsCapturing(true)}
                    >
                      {isCapturing
                        ? "Press keys..."
                        : newBinding.combo || "Click to record"}
                    </Button>
                    {newBinding.combo ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 sm:h-9 sm:w-9"
                        onClick={() =>
                          setNewBinding((prev) => ({ ...prev, combo: "" }))
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      </Button>
                    ) : null}
                  </div>
                  {existingCombo && editingCombo !== newBinding.combo ? (
                    <p className="text-xs sm:text-xs text-amber-600 dark:text-amber-400">
                      This combo already exists and will be overwritten.
                    </p>
                  ) : null}
                </div>

                {selectedAction?.fields.includes("schema") ? (
                  <div className="space-y-1.5 sm:space-y-2">
                    <Label className="text-xs sm:text-xs text-muted-foreground">
                      Schema
                    </Label>
                    <Select
                      value={newBinding.schema}
                      onValueChange={(value) =>
                        setNewBinding((prev) => ({ ...prev, schema: value }))
                      }
                    >
                      <SelectTrigger className="h-8 sm:h-9 bg-background text-xs sm:text-xs">
                        <SelectValue placeholder="Select schema" />
                      </SelectTrigger>
                      <SelectContent className="max-h-64 sm:max-h-72">
                        {schemas.map((schema) => (
                          <SelectItem
                            key={schema}
                            value={schema}
                            className="text-xs sm:text-xs"
                          >
                            {schema}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                {selectedAction?.fields.includes("table") ? (
                  <div className="space-y-1.5 sm:space-y-2">
                    <Label className="text-xs sm:text-xs text-muted-foreground">
                      Table
                    </Label>
                    <Select
                      value={newBinding.table}
                      onValueChange={(value) =>
                        setNewBinding((prev) => ({ ...prev, table: value }))
                      }
                    >
                      <SelectTrigger className="h-8 sm:h-9 bg-background text-xs sm:text-xs">
                        <SelectValue placeholder="Select table" />
                      </SelectTrigger>
                      <SelectContent className="max-h-64 sm:max-h-72">
                        {tables.map((table) => (
                          <SelectItem
                            key={table}
                            value={table}
                            className="text-xs sm:text-xs"
                          >
                            {table}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                {selectedAction?.fields.includes("database") ? (
                  <div className="space-y-1.5 sm:space-y-2">
                    <Label className="text-xs sm:text-xs text-muted-foreground">
                      Database
                    </Label>
                    <Select
                      value={newBinding.database}
                      onValueChange={(value) =>
                        setNewBinding((prev) => ({ ...prev, database: value }))
                      }
                    >
                      <SelectTrigger className="h-8 sm:h-9 bg-background text-xs sm:text-xs">
                        <SelectValue placeholder="Select database" />
                      </SelectTrigger>
                      <SelectContent className="max-h-64 sm:max-h-72">
                        {databases.map((database) => (
                          <SelectItem
                            key={database}
                            value={database}
                            className="text-xs sm:text-xs"
                          >
                            {database}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                {selectedAction?.fields.includes("view") ? (
                  <div className="space-y-1.5 sm:space-y-2">
                    <Label className="text-xs sm:text-xs text-muted-foreground">
                      View
                    </Label>
                    <Select
                      value={newBinding.view}
                      onValueChange={(value) =>
                        setNewBinding((prev) => ({ ...prev, view: value }))
                      }
                    >
                      <SelectTrigger className="h-8 sm:h-9 bg-background text-xs sm:text-xs">
                        <SelectValue placeholder="Select view" />
                      </SelectTrigger>
                      <SelectContent className="max-h-64 sm:max-h-72">
                        {DB_VIEWS.map((view) => (
                          <SelectItem
                            key={view.id}
                            value={view.id}
                            className="text-xs sm:text-xs"
                          >
                            {view.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                {selectedAction?.fields.includes("sidebar") ? (
                  <div className="space-y-1.5 sm:space-y-2">
                    <Label className="text-xs sm:text-xs text-muted-foreground">
                      Sidebar View
                    </Label>
                    <Select
                      value={newBinding.sidebar}
                      onValueChange={(value) =>
                        setNewBinding((prev) => ({ ...prev, sidebar: value }))
                      }
                    >
                      <SelectTrigger className="h-8 sm:h-9 bg-background text-xs sm:text-xs">
                        <SelectValue placeholder="Select sidebar" />
                      </SelectTrigger>
                      <SelectContent className="max-h-64 sm:max-h-72">
                        {SIDEBAR_VIEWS.map((view) => (
                          <SelectItem
                            key={view.id}
                            value={view.id}
                            className="text-xs sm:text-xs"
                          >
                            {view.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                {selectedAction?.fields.includes("index") ? (
                  <div className="space-y-1.5 sm:space-y-2">
                    <Label className="text-xs sm:text-xs text-muted-foreground">
                      Tab Index
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      value={newBinding.index}
                      onChange={(e) =>
                        setNewBinding((prev) => ({
                          ...prev,
                          index: parseInt(e.target.value || "0", 10) || 0,
                        }))
                      }
                      className="h-8 sm:h-9 bg-background text-xs sm:text-xs"
                    />
                  </div>
                ) : null}

                <div className="flex gap-2">
                  <Button
                    onClick={addBinding}
                    disabled={!newBinding.combo}
                    className="h-8 sm:h-9 flex-1 gap-1.5 text-xs sm:text-xs"
                  >
                    {editingCombo ? (
                      <Pencil className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    ) : (
                      <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    )}
                    {editingCombo ? "Update Shortcut" : "Save Shortcut"}
                  </Button>
                  {editingCombo ? (
                    <Button
                      variant="outline"
                      onClick={cancelEditing}
                      className="h-8 sm:h-9 gap-1.5 text-xs sm:text-xs"
                    >
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card/60 min-w-0">
              <CardHeader className="gap-2 sm:gap-3">
                <div className="flex items-start sm:items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm sm:text-sm">
                      Active Shortcuts
                    </CardTitle>
                    <CardDescription className="text-xs sm:text-xs">
                      Your shortcuts are matched exactly against pressed key
                      combos.
                    </CardDescription>
                  </div>
                  <Badge variant="secondary" className="text-xs sm:text-xs h-5">
                    {sortedBindings.length}
                  </Badge>
                </div>

                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 sm:left-3 top-1/2 h-3 w-3 sm:h-3.5 sm:w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search shortcuts"
                    className="h-8 sm:h-9 pl-7 sm:pl-8 text-xs sm:text-xs"
                  />
                </div>
              </CardHeader>
              <CardContent>
                {filteredBindings.length === 0 ? (
                  <div className="flex min-h-40 sm:min-h-56 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/10 text-center p-4">
                    <Keyboard className="mb-2 sm:mb-3 h-7 w-7 sm:h-9 sm:w-9 text-muted-foreground/40" />
                    <p className="text-xs sm:text-sm font-medium">
                      No shortcuts found
                    </p>
                    <p className="text-xs sm:text-xs text-muted-foreground">
                      Try changing your search or add a new keybinding.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5 sm:space-y-2">
                    {filteredBindings.map(([combo, binding]) => {
                      const actionName =
                        KEYBINDING_ACTIONS.find(
                          (action) => action.id === binding.type,
                        )?.name || binding.type;
                      return (
                        <div
                          key={combo}
                          className="group flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 rounded-lg border border-border bg-background/70 px-2.5 sm:px-3 py-2 min-w-0"
                        >
                          <div className="min-w-0 space-y-1 w-full sm:w-auto">
                            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                              <Kbd className="text-xs sm:text-xs">{combo}</Kbd>
                              <p className="truncate text-xs sm:text-sm font-medium">
                                {actionName}
                              </p>
                            </div>
                            <p className="truncate text-xs sm:text-xs text-muted-foreground">
                              {describeBinding(binding)}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => startEditing(combo, binding)}
                            >
                              <Pencil className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeBinding(combo)}
                            >
                              <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card className="border-border bg-card/60 min-w-0">
            <CardHeader className="gap-2 sm:gap-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-sm sm:text-sm">
                    `keybindings.json` Editor
                  </CardTitle>
                  <CardDescription className="text-xs sm:text-xs">
                    Edit the full configuration directly. Apply only after JSON
                    validates.
                  </CardDescription>
                </div>
                <Badge variant="outline" className="w-fit text-xs sm:text-xs">
                  VS Code-style config mode
                </Badge>
              </div>

              <div className="rounded-lg border border-border bg-muted/20 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-xs text-muted-foreground">
                Format example:{" "}
                <code className="text-xs">{`{"${formatShortcutForPlatform("Cmd+K")}": {"type": "TOGGLE_COMMAND_MENU"}}`}</code>
              </div>
            </CardHeader>
            <CardContent className="space-y-2.5 sm:space-y-3">
              <Textarea
                value={configText}
                onChange={(e) => {
                  setConfigText(e.target.value);
                  if (configError) setConfigError(null);
                }}
                spellCheck={false}
                className="min-h-[280px] sm:min-h-[420px] resize-y font-mono text-xs sm:text-xs"
              />

              {configError ? (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-xs text-destructive">
                  {configError}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <Button
                  onClick={applyConfig}
                  className="gap-1.5 h-7 sm:h-8 text-xs sm:text-xs"
                  size="sm"
                >
                  <Check className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  Apply Config
                </Button>
                <Button
                  onClick={formatConfig}
                  variant="secondary"
                  className="gap-1.5 h-7 sm:h-8 text-xs sm:text-xs"
                  size="sm"
                >
                  <WandSparkles className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  Format JSON
                </Button>
                <Button
                  onClick={resetConfig}
                  variant="ghost"
                  className="h-7 sm:h-8 text-xs sm:text-xs"
                  size="sm"
                >
                  Revert Changes
                </Button>
                <span className="text-xs sm:text-xs text-muted-foreground">
                  {isConfigDirty ? "Unsaved config changes" : "Config in sync"}
                </span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
