"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { isDesktopRuntime } from "@/lib/desktop";
import {
  DEFAULT_ICON_THEME_ID,
  type CustomIconTheme,
} from "@/lib/icon-theme/types";

interface IconThemeSettingProps {
  iconThemeId: string;
  setIconThemeId: (value: string) => void;
  customIconThemes: CustomIconTheme[];
  setCustomIconThemes: Dispatch<SetStateAction<CustomIconTheme[]>>;
}

export function IconThemeSetting({
  iconThemeId,
  setIconThemeId,
  customIconThemes,
  setCustomIconThemes,
}: IconThemeSettingProps) {
  const [isImporting, setIsImporting] = useState(false);
  const canUseDesktop = isDesktopRuntime();

  const handleImportTheme = async () => {
    if (!canUseDesktop || isImporting) return;
    setIsImporting(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!selected) return;
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const content = await readTextFile(selected);
      const importedTheme = JSON.parse(content) as CustomIconTheme;
      setCustomIconThemes((current) => {
        const next = current.filter((theme) => theme.id !== importedTheme.id);
        return [...next, importedTheme];
      });
      setIconThemeId(importedTheme.id);
      toast.success(`Imported ${importedTheme.name}.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to import icon theme.",
      );
    } finally {
      setIsImporting(false);
    }
  };

  const handleRemoveTheme = (themeId: string) => {
    setCustomIconThemes((current) =>
      current.filter((theme) => theme.id !== themeId),
    );
    if (iconThemeId === themeId) {
      setIconThemeId(DEFAULT_ICON_THEME_ID);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-t border-border py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <span className="font-medium text-xs">Icon Theme</span>
          <span className="max-w-md text-xs text-muted-foreground">
            Import a JSON manifest that maps Lucide export names like{" "}
            <code>LayoutDashboard</code> or <code>RefreshCw</code> to SVG files.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={
              iconThemeId === DEFAULT_ICON_THEME_ID ? "default" : "outline"
            }
            className="h-8 px-2.5 text-xs"
            onClick={() => setIconThemeId(DEFAULT_ICON_THEME_ID)}
          >
            Lucide Default
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-8 px-2.5 text-xs"
            onClick={handleImportTheme}
            disabled={!canUseDesktop || isImporting}
          >
            {isImporting ? "Importing…" : "Import Theme"}
          </Button>
        </div>
      </div>

      {customIconThemes.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {customIconThemes.map((theme) => (
            <div
              key={theme.id}
              className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/20 px-2.5 py-2"
            >
              <div className="flex flex-col">
                <span className="text-xs font-medium text-foreground">
                  {theme.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {theme.id} • {Object.keys(theme.icons).length} overrides
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant={iconThemeId === theme.id ? "default" : "outline"}
                  className="h-7 px-2 text-xs"
                  onClick={() => setIconThemeId(theme.id)}
                >
                  {iconThemeId === theme.id ? "Active" : "Use"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-red-500 hover:text-red-600"
                  onClick={() => handleRemoveTheme(theme.id)}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {!canUseDesktop ? (
        <span className="text-xs text-muted-foreground">
          Icon theme import is available in the desktop app.
        </span>
      ) : null}
    </div>
  );
}
