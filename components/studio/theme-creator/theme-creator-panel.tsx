"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { applyAppThemeVariables } from "@/lib/studio/app-themes";
import { createThemeId, createThemeNameFromId } from "@/lib/studio/editor-themes";
import { ColorControl } from "./color-control";
import { ThemePanelHeader, ThemePanelFooter } from "./theme-panel-shell";
import type { CustomAppTheme } from "@/lib/studio/app-themes";

const CATEGORIES: {
  id: string;
  label: string;
  vars: { key: string; label: string }[];
}[] = [
  {
    id: "bg",
    label: "Background",
    vars: [
      { key: "--background", label: "Background" },
      { key: "--card", label: "Card" },
      { key: "--popover", label: "Popover" },
      { key: "--sidebar", label: "Sidebar" },
    ],
  },
  {
    id: "text",
    label: "Text",
    vars: [
      { key: "--foreground", label: "Foreground" },
      { key: "--card-foreground", label: "Card Foreground" },
      { key: "--popover-foreground", label: "Popover Foreground" },
      { key: "--muted-foreground", label: "Muted Foreground" },
      { key: "--sidebar-foreground", label: "Sidebar Foreground" },
    ],
  },
  {
    id: "primary",
    label: "Primary & Accent",
    vars: [
      { key: "--primary", label: "Primary" },
      { key: "--primary-foreground", label: "Primary Foreground" },
      { key: "--ring", label: "Ring" },
      { key: "--accent", label: "Accent" },
      { key: "--accent-foreground", label: "Accent Foreground" },
      { key: "--sidebar-primary", label: "Sidebar Primary" },
      {
        key: "--sidebar-primary-foreground",
        label: "Sidebar Primary Foreground",
      },
    ],
  },
  {
    id: "secondary",
    label: "Secondary & Muted",
    vars: [
      { key: "--secondary", label: "Secondary" },
      { key: "--secondary-foreground", label: "Secondary Foreground" },
      { key: "--muted", label: "Muted" },
      { key: "--sidebar-accent", label: "Sidebar Accent" },
      {
        key: "--sidebar-accent-foreground",
        label: "Sidebar Accent Foreground",
      },
    ],
  },
  {
    id: "border",
    label: "Borders & Inputs",
    vars: [
      { key: "--border", label: "Border" },
      { key: "--input", label: "Input" },
      { key: "--sidebar-border", label: "Sidebar Border" },
      { key: "--sidebar-ring", label: "Sidebar Ring" },
    ],
  },
  {
    id: "studio",
    label: "Studio UI",
    vars: [
      { key: "--studio-bg", label: "Studio Background" },
      { key: "--studio-border", label: "Studio Border" },
      { key: "--studio-header-bg", label: "Header Background" },
      { key: "--table-header-bg", label: "Table Header" },
      { key: "--studio-cell-text", label: "Cell Text" },
      { key: "--studio-cell-muted", label: "Cell Muted" },
      { key: "--studio-tab-active", label: "Tab Active" },
      { key: "--studio-tab-inactive", label: "Tab Inactive" },
      { key: "--studio-row-hover", label: "Row Hover" },
      { key: "--studio-selection", label: "Selection" },
    ],
  },
  {
    id: "status",
    label: "Status Colors",
    vars: [
      { key: "--destructive", label: "Destructive" },
      { key: "--chart-1", label: "Chart 1" },
      { key: "--chart-2", label: "Chart 2" },
      { key: "--chart-3", label: "Chart 3" },
      { key: "--chart-4", label: "Chart 4" },
      { key: "--chart-5", label: "Chart 5" },
    ],
  },
];

interface ThemeCreatorPanelProps {
  isOpen: boolean;
  onClose: () => void;
  activeTheme: CustomAppTheme | null;
  customAppThemes: CustomAppTheme[];
  builtInAppThemes: CustomAppTheme[];
  onSaveTheme: (theme: CustomAppTheme) => void;
}

export function ThemeCreatorPanel({
  isOpen,
  onClose,
  activeTheme,
  customAppThemes,
  builtInAppThemes,
  onSaveTheme,
}: ThemeCreatorPanelProps) {
  const [draftColors, setDraftColors] = useState<Record<string, string>>({});
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    () => new Set(CATEGORIES.map((c) => c.id)),
  );
  const appliedKeysRef = useRef<string[]>([]);
  const originalsRef = useRef<Record<string, string> | null>(null);
  const savedRef = useRef(false);

  const allThemes = [...builtInAppThemes, ...customAppThemes];

  const cleanupStyles = useCallback(() => {
    if (appliedKeysRef.current.length > 0) {
      const root = document.documentElement;
      appliedKeysRef.current.forEach((key) => root.style.removeProperty(key));
      appliedKeysRef.current = [];
    }
  }, []);

  useEffect(() => {
    if (isOpen && activeTheme) {
      savedRef.current = false;
      const colors = { ...activeTheme.colors };
      setDraftColors(colors);
      originalsRef.current = { ...activeTheme.colors };
    }
    if (!isOpen && originalsRef.current && !savedRef.current) {
      appliedKeysRef.current = applyAppThemeVariables(
        document.documentElement,
        originalsRef.current,
        appliedKeysRef.current,
      );
    }
  }, [isOpen, activeTheme, cleanupStyles]);

  useEffect(() => {
    if (!isOpen || Object.keys(draftColors).length === 0) return;
    appliedKeysRef.current = applyAppThemeVariables(
      document.documentElement,
      draftColors,
      appliedKeysRef.current,
    );
  }, [draftColors, isOpen]);

  useEffect(() => {
    return () => {
      if (originalsRef.current && !savedRef.current) {
        applyAppThemeVariables(
          document.documentElement,
          originalsRef.current,
          appliedKeysRef.current,
        );
      } else {
        cleanupStyles();
      }
    };
  }, [cleanupStyles]);

  const handleColorChange = useCallback((variable: string, value: string) => {
    setDraftColors((prev) => ({ ...prev, [variable]: value }));
  }, []);

  const handleResetAll = useCallback(() => {
    if (originalsRef.current) {
      setDraftColors({ ...originalsRef.current });
    }
  }, []);

  // fallow-ignore-next-line code-duplication
  const handleSave = useCallback(() => {
    if (!activeTheme) return;
    savedRef.current = true;
    const existingIds = new Set(allThemes.map((t) => t.id));
    const id = createThemeId(`${activeTheme.name} Custom`, existingIds);
    const name = createThemeNameFromId(id);
    const newTheme: CustomAppTheme = {
      id,
      name,
      base: activeTheme.base,
      colors: { ...draftColors },
    };
    onSaveTheme(newTheme);
    onClose();
  }, [activeTheme, allThemes, draftColors, onSaveTheme, onClose]);

  const handleDiscard = useCallback(() => {
    if (originalsRef.current) {
      appliedKeysRef.current = applyAppThemeVariables(
        document.documentElement,
        originalsRef.current,
        appliedKeysRef.current,
      );
    }
    onClose();
  }, [onClose]);

  const toggleCategory = useCallback((id: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (!isOpen) return null;

  if (!activeTheme) {
    return (
      <div className="flex h-full w-[340px] shrink-0 flex-col items-center justify-center border-l border-studio-border bg-background gap-2 px-6">
        <Palette className="h-6 w-6 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground text-center">
          Select a dark or light theme first, then customize it here.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 text-xs text-blue-500 hover:text-blue-400 transition-colors"
        >
          Close
        </button>
      </div>
    );
  }

  const hasChanges =
    originalsRef.current &&
    Object.entries(draftColors).some(
      ([key, val]) => originalsRef.current?.[key] !== val,
    );

  return (
    <div
      className={cn(
        "flex h-full w-[340px] shrink-0 flex-col border-l border-studio-border bg-background overflow-hidden",
        "animate-in slide-in-from-right duration-200",
      )}
    >
      <ThemePanelHeader title="Theme Creator" onClose={onClose} closeBtnClass="rounded-lg" />

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="divide-y divide-studio-border/50">
          {CATEGORIES.map((category) => {
            const isExpanded = expandedCategories.has(category.id);
            const hasModifiedVars = originalsRef.current
              ? category.vars.some(
                  (v) => originalsRef.current?.[v.key] !== draftColors[v.key],
                )
              : false;

            return (
              <div key={category.id}>
                <button
                  type="button"
                  onClick={() => toggleCategory(category.id)}
                  className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-foreground hover:bg-studio-border/20 transition-colors"
                >
                  <span>{category.label}</span>
                  <div className="flex items-center gap-1.5">
                    {hasModifiedVars && (
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                    )}
                    <svg
                      className={cn(
                        "h-3 w-3 text-muted-foreground transition-transform",
                        isExpanded && "rotate-90",
                      )}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </div>
                </button>
                {isExpanded && (
                  <div className="space-y-1 px-3 pb-3">
                    {category.vars.map((v) => {
                      const defaultValue =
                        originalsRef.current?.[v.key] ??
                        activeTheme?.colors[v.key] ??
                        "";
                      return (
                        <ColorControl
                          key={v.key}
                          label={v.label}
                          variable={v.key}
                          value={draftColors[v.key] ?? defaultValue}
                          defaultValue={defaultValue}
                          onChange={handleColorChange}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <ThemePanelFooter hasChanges={!!hasChanges} onResetAll={handleResetAll} onDiscard={handleDiscard} onSave={handleSave} />
    </div>
  );
}
