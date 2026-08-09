"use client";

import {
  useState,
  useEffect,
  useCallback,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  Search,
  Download,
  Palette,
  Code,
  Loader2,
  AlertCircle,
  Check,
  ExternalLink,
} from "@/lib/icon-theme/lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  fetchCommunityThemes,
  incrementDownloadCount,
  type CommunityTheme,
} from "@/lib/supabase/theme-marketplace";
import { createThemeId, parseThemeJson } from "@/lib/studio/editor-themes";
import {
  searchVsCodeThemes,
  fetchVsCodeThemeJson,
  type VsCodeThemeEntry,
} from "@/lib/studio/themes/vscode-marketplace";
import { vsCodeThemeToAppTheme } from "@/lib/studio/themes/vscode-theme-to-app-theme";
import type { CustomAppTheme } from "@/lib/studio/app-themes";
import type { CustomEditorTheme } from "@/lib/studio/editor-themes";

interface ThemeMarketplaceProps {
  customAppThemes: CustomAppTheme[];
  setCustomAppThemes: Dispatch<SetStateAction<CustomAppTheme[]>>;
  setAppThemeId: (id: string) => void;
  customEditorThemes: CustomEditorTheme[];
  setCustomEditorThemes: Dispatch<SetStateAction<CustomEditorTheme[]>>;
  setEditorThemeId: (id: string) => void;
  initialFilter?: "app" | "editor";
}

type FilterType = "all" | "app" | "editor" | "vscode";

export function ThemeMarketplace({
  customAppThemes,
  setCustomAppThemes,
  setAppThemeId,
  customEditorThemes,
  setCustomEditorThemes,
  setEditorThemeId,
  initialFilter,
}: ThemeMarketplaceProps) {
  const [themes, setThemes] = useState<CommunityTheme[]>([]);
  const [vscodeEntries, setVscodeEntries] = useState<VsCodeThemeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<FilterType>(
    initialFilter || "all",
  );
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const loadThemes = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (typeFilter === "vscode") {
      const { entries, error: err } = await searchVsCodeThemes(search);
      if (err) {
        setError(err);
      } else {
        setVscodeEntries(entries);
      }
    } else {
      const { themes: fetched, error: err } = await fetchCommunityThemes({
        type: typeFilter === "all" ? undefined : typeFilter,
        search: search || undefined,
      });
      if (err) {
        setError(err);
      } else {
        setThemes(fetched);
      }
    }

    setLoading(false);
  }, [typeFilter, search]);

  useEffect(() => {
    loadThemes();
  }, [loadThemes]);

  const handleApply = async (theme: CommunityTheme) => {
    setApplyingId(theme.id);
    try {
      const data = theme.theme_json as Record<string, unknown>;

      if (theme.theme_type === "app") {
        const existingIds = new Set(customAppThemes.map((t) => t.id));
        const id = createThemeId(theme.name, existingIds);
        const newTheme: CustomAppTheme = {
          id,
          name: theme.name,
          base: (data.base as "light" | "dark") || "dark",
          colors: (data.colors as Record<string, string>) || {},
        };
        setCustomAppThemes([...customAppThemes, newTheme]);
        setAppThemeId(id);
        toast.success(`Applied "${theme.name}" app theme!`);
      } else {
        const existingIds = new Set(customEditorThemes.map((t) => t.id));
        const id = createThemeId(theme.name, existingIds);
        const themeJson =
          typeof data.themeJson === "string"
            ? data.themeJson
            : JSON.stringify(data.themeJson);
        const newTheme: CustomEditorTheme = {
          id,
          name: theme.name,
          themeJson,
        };
        setCustomEditorThemes([...customEditorThemes, newTheme]);
        setEditorThemeId(id);
        toast.success(`Applied "${theme.name}" editor theme!`);
      }

      await incrementDownloadCount(theme.id);
    } catch {
      toast.error("Failed to apply theme.");
    } finally {
      setApplyingId(null);
    }
  };

  const handleVsCodeImport = async (entry: VsCodeThemeEntry) => {
    setApplyingId(entry.id);
    try {
      const { json, error: fetchError } = await fetchVsCodeThemeJson(entry);
      if (fetchError || !json) {
        toast.error(fetchError || "Failed to fetch theme from VS Code marketplace.");
        return;
      }

      const jsonStr = JSON.stringify(json);
      const { name: themeName } = parseThemeJson(jsonStr);
      const base: "light" | "dark" =
        json.type === "light" || entry.uiTheme === "vs" ? "light" : "dark";
      const resolvedName = themeName || entry.label;

      const editorExistingIds = new Set(customEditorThemes.map((t) => t.id));
      const editorId = createThemeId(resolvedName, editorExistingIds);
      const editorTheme: CustomEditorTheme = {
        id: editorId,
        name: resolvedName,
        themeJson: jsonStr,
      };
      setCustomEditorThemes((prev) => [...prev, editorTheme]);
      setEditorThemeId(editorId);

      const appExistingIds = new Set(customAppThemes.map((t) => t.id));
      const appId = createThemeId(resolvedName + " App", appExistingIds);
      const mappedColors = vsCodeThemeToAppTheme(json, base);
      const appTheme: CustomAppTheme = {
        id: appId,
        name: resolvedName + " (App)",
        base,
        colors: mappedColors,
      };
      setCustomAppThemes((prev) => [...prev, appTheme]);
      setAppThemeId(appId);

      toast.success(`Imported "${resolvedName}" from VS Code Marketplace!`);
    } catch {
      toast.error("Failed to import theme.");
    } finally {
      setApplyingId(null);
    }
  };

  const isVscode = typeFilter === "vscode";

  return (
    <div className="space-y-4 min-h-[200px]">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isVscode ? "Search VS Code themes..." : "Search community themes..."}
            className="h-8 pl-8 text-xs bg-secondary/20 border-studio-border"
          />
        </div>
        <div className="flex gap-1 bg-secondary/20 p-0.5 rounded-lg border border-studio-border">
          {(["all", "app", "editor", "vscode"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={cn(
                "px-2.5 py-0.5 text-xs font-bold rounded-lg transition-all",
                typeFilter === t
                  ? "bg-muted/40 text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "all" ? "All" : t === "app" ? "App" : t === "editor" ? "Editor" : "VS Code"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-xs">Loading themes...</span>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
          <AlertCircle className="h-6 w-6 text-destructive" />
          <span className="text-xs">{error}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={loadThemes}
            className="text-xs"
          >
            Retry
          </Button>
        </div>
      ) : (isVscode ? vscodeEntries.length === 0 : themes.length === 0) ? (
        <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
          <Palette className="h-8 w-8 opacity-30" />
          <span className="text-xs">No themes found</span>
          <span className="text-xs text-muted-foreground/60">
            {search
              ? "Try a different search term"
              : isVscode
                ? "No VS Code themes available right now"
                : "Be the first to publish a theme!"}
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {isVscode
            ? vscodeEntries.map((entry) => (
                <Card key={entry.id} size="sm" className="group">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-xs font-semibold truncate">
                        {entry.label}
                      </CardTitle>
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0 text-xs px-1.5 py-0 h-4",
                          entry.uiTheme === "vs"
                            ? "border-amber-500/30 text-amber-500"
                            : entry.uiTheme === "vs-dark"
                              ? "border-blue-500/30 text-blue-500"
                              : "border-purple-500/30 text-purple-500",
                        )}
                      >
                        {entry.uiTheme === "vs"
                          ? "Light"
                          : entry.uiTheme === "vs-dark"
                            ? "Dark"
                            : "HC"}
                      </Badge>
                    </div>
                    {entry.description && (
                      <p className="text-xs text-muted-foreground/70 line-clamp-2 mt-1">
                        {entry.description}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="truncate">
                      by {entry.publisher}
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      <Download className="w-3 h-3" />
                      {entry.downloadCount.toLocaleString()}
                    </span>
                  </CardContent>
                  <CardFooter>
                    <Button
                      size="sm"
                      variant="default"
                      className="w-full h-7 text-xs"
                      onClick={() => handleVsCodeImport(entry)}
                      disabled={applyingId === entry.id}
                    >
                      {applyingId === entry.id ? (
                        <>
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          Importing...
                        </>
                      ) : (
                        <>
                          <ExternalLink className="w-3 h-3 mr-1" />
                          Import
                        </>
                      )}
                    </Button>
                  </CardFooter>
                </Card>
              ))
            : themes.map((theme) => (
                <Card key={theme.id} size="sm" className="group">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-xs font-semibold truncate">
                        {theme.name}
                      </CardTitle>
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0 text-xs px-1.5 py-0 h-4",
                          theme.theme_type === "app"
                            ? "border-blue-500/30 text-blue-500"
                            : "border-emerald-500/30 text-emerald-500",
                        )}
                      >
                        {theme.theme_type === "app" ? (
                          <Palette className="w-2.5 h-2.5 mr-0.5" />
                        ) : (
                          <Code className="w-2.5 h-2.5 mr-0.5" />
                        )}
                        {theme.theme_type === "app" ? "App" : "Editor"}
                      </Badge>
                    </div>
                    {theme.description && (
                      <p className="text-xs text-muted-foreground/70 line-clamp-2 mt-1">
                        {theme.description}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="truncate">
                      by {theme.author_name || "Anonymous"}
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      <Download className="w-3 h-3" />
                      {theme.downloads}
                    </span>
                  </CardContent>
                  <CardFooter>
                    <Button
                      size="sm"
                      variant="default"
                      className="w-full h-7 text-xs"
                      onClick={() => handleApply(theme)}
                      disabled={applyingId === theme.id}
                    >
                      {applyingId === theme.id ? (
                        <>
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          Applying...
                        </>
                      ) : (
                        <>
                          <Check className="w-3 h-3 mr-1" />
                          Apply
                        </>
                      )}
                    </Button>
                  </CardFooter>
                </Card>
              ))}
        </div>
      )}
    </div>
  );
}
