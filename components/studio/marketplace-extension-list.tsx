"use client";

import { useState, useEffect, useCallback, type Dispatch, type SetStateAction } from "react";
import { Search, Loader2, Download, Palette, Check } from "@/lib/icon-theme/lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CustomAppTheme } from "@/lib/studio/app-themes";
import type { CustomEditorTheme } from "@/lib/studio/editor-themes";
import { createThemeId } from "@/lib/studio/editor-themes";
import {
  searchThemeExtensions,
  installExtensionThemes,
  type VsCodeExtensionEntry,
} from "@/lib/studio/themes/vscode-marketplace";
import { vsCodeThemeToAppTheme } from "@/lib/studio/themes/vscode-theme-to-app-theme";

const OPEN_VSX_BASE = "https://open-vsx.org/api";

type PendingTheme = {
  name: string;
  uiTheme: string;
  json: Record<string, unknown>;
};

interface MarketplaceExtensionListProps {
  customAppThemes: CustomAppTheme[];
  setCustomAppThemes: Dispatch<SetStateAction<CustomAppTheme[]>>;
  customEditorThemes: CustomEditorTheme[];
  setCustomEditorThemes: Dispatch<SetStateAction<CustomEditorTheme[]>>;
  autoLoad?: boolean;
  onInstall?: (themeName: string) => void;
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function starDisplay(rating: number) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  const empty = 5 - full - (half ? 1 : 0);
  return (
    <span className="inline-flex gap-0.5">
      {"\u2605".repeat(full)}{half ? "\u00BD" : ""}{"\u2606".repeat(empty)}
    </span>
  );
}

function getShowcaseColors(json: Record<string, unknown>) {
  const colors = (json as any).colors ?? {};
  return {
    bg: colors["editor.background"] || "#1e1e1e",
    fg: colors["editor.foreground"] || "#cccccc",
    accent: colors["activityBar.activeBorder"] || colors["focusBorder"] || colors["textLink.foreground"] || "#007acc",
    selection: colors["editor.selectionBackground"] || "#264f78",
  };
}

const swatchLabels = [
  { key: "bg", label: "Bg" },
  { key: "fg", label: "Fg" },
  { key: "accent", label: "Accent" },
  { key: "selection", label: "Sel" },
] as const;

export function MarketplaceExtensionList({
  customAppThemes,
  setCustomAppThemes,
  customEditorThemes,
  setCustomEditorThemes,
  autoLoad,
  onInstall,
}: MarketplaceExtensionListProps) {
  const [search, setSearch] = useState("");
  const [extensions, setExtensions] = useState<VsCodeExtensionEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState<Set<string>>(new Set());
  const [pendingThemes, setPendingThemes] = useState<Record<string, PendingTheme[]>>({});
  const [installingTheme, setInstallingTheme] = useState<Set<string>>(new Set());
  const [showcaseOpen, setShowcaseOpen] = useState(false);
  const [showcaseExt, setShowcaseExt] = useState<{ ext: VsCodeExtensionEntry; themes: PendingTheme[] } | null>(null);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2 && !autoLoad) return;
    setLoading(true);
    setError(null);
    const timer = setTimeout(async () => {
      const { extensions: exts, total: t, error: err } = await searchThemeExtensions(q);
      setExtensions(exts);
      setTotal(t);
      setError(err);
      setLoading(false);
    }, q.length < 2 ? 0 : 200);
    return () => clearTimeout(timer);
  }, [search, autoLoad]);

  const loadMore = useCallback(async () => {
    if (loading) return;
    const q = search.trim();
    if (q.length < 2 && !autoLoad) return;
    setLoading(true);
    const newOffset = offset + 50;
    const { extensions: exts, error: err } = await searchThemeExtensions(q, newOffset);
    if (err) setError(err);
    else { setExtensions((prev) => [...prev, ...exts]); setOffset(newOffset); }
    setLoading(false);
  }, [loading, search, offset, autoLoad]);

  const browseThemes = useCallback(async (ext: VsCodeExtensionEntry) => {
    const key = `${ext.namespace}/${ext.name}`;
    if (parsing.has(key)) return;
    const cached = pendingThemes[key];
    if (cached) {
      setShowcaseExt({ ext, themes: cached });
      setShowcaseOpen(true);
      return;
    }
    setParsing((prev) => new Set(prev).add(key));
    const { themes, error: installError } = await installExtensionThemes(ext.namespace, ext.name, ext.version);
    setParsing((prev) => { const next = new Set(prev); next.delete(key); return next; });
    if (installError || themes.length === 0) {
      toast.error(installError || "Failed to fetch extension themes");
      return;
    }
    setPendingThemes((prev) => ({ ...prev, [key]: themes }));
    setShowcaseExt({ ext, themes });
    setShowcaseOpen(true);
  }, [parsing, setParsing, pendingThemes, setPendingThemes]);

  const installTheme = useCallback(async (theme: PendingTheme) => {
    if (!showcaseExt) return;
    const ext = showcaseExt.ext;
    const extId = `${ext.namespace}/${ext.name}`;
    const themeKey = `${extId}/${theme.name}`;
    if (installingTheme.has(themeKey)) return;
    setInstallingTheme((prev) => new Set(prev).add(themeKey));

    const base: "light" | "dark" = (theme.json as any)?.type === "light" || theme.uiTheme === "vs" ? "light" : "dark";

    const editorExistingIds = new Set(customEditorThemes.map((t) => t.id));
    const editorId = createThemeId(theme.name, editorExistingIds);
    setCustomEditorThemes((prev) => [...prev, { id: editorId, name: theme.name, themeJson: JSON.stringify(theme.json) }]);

    const appExistingIds = new Set(customAppThemes.map((t) => t.id));
    const appId = createThemeId(theme.name + " App", appExistingIds);
    setCustomAppThemes((prev) => [...prev, { id: appId, name: theme.name + " (App)", base, colors: vsCodeThemeToAppTheme(theme.json, base) }]);

    setInstallingTheme((prev) => { const next = new Set(prev); next.delete(themeKey); return next; });
    toast.success(`Installed "${theme.name}"`);
    setShowcaseOpen(false);
    setShowcaseExt(null);
    onInstall?.(theme.name);
  }, [customAppThemes, customEditorThemes, setCustomAppThemes, setCustomEditorThemes, installingTheme, setInstallingTheme, onInstall, showcaseExt]);

  const hasMore = extensions.length < total;

  const isThemeInstalled = useCallback((themeName: string) => {
    return customAppThemes.some((t) => t.name === themeName + " (App)");
  }, [customAppThemes]);

  return (
    <div className="flex flex-col min-h-0">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search theme extensions from VS Code Marketplace..."
          className="h-8 pl-9 pr-8 text-xs bg-secondary/20 border-studio-border"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 animate-spin" />
        )}
      </div>

      <div className={cn("flex-1 overflow-y-auto overflow-x-hidden", (search.trim().length >= 2 || (autoLoad && extensions.length > 0)) && "mt-2")}>
        {search.trim().length < 2 && !autoLoad && !loading && (
          <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <Palette className="w-8 h-8 opacity-20" />
            <span className="text-xs">Search theme extensions from the marketplace</span>
          </div>
        )}

        {autoLoad && extensions.length === 0 && !error && (
          <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin opacity-30" />
            <span className="text-xs">{loading ? "Loading themes..." : "No themes found"}</span>
          </div>
        )}

        {error && (
          <div className="px-3 py-2 text-xs text-red-500 bg-red-500/5 rounded-md mx-1">{error}</div>
        )}

        {search.trim().length >= 2 && !loading && extensions.length === 0 && !error && (
          <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <Palette className="w-8 h-8 opacity-20" />
            <span className="text-xs">No extensions found</span>
          </div>
        )}

        {extensions.map((ext) => {
          const extId = `${ext.namespace}/${ext.name}`;
          const isParsing = parsing.has(extId);
          const themes = pendingThemes[extId];
          return (
            <div key={extId} className="px-2 py-3 border-b border-studio-border/40 last:border-b-0">
              <div className="flex gap-3">
                <img
                  src={`${OPEN_VSX_BASE}/${ext.namespace}/${ext.name}/${ext.version}/file/icon`}
                  alt=""
                  className="w-10 h-10 shrink-0 rounded mt-0.5 bg-secondary/30 object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = "";
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
                <div className="flex flex-col min-w-0 flex-1 gap-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold truncate text-foreground">{ext.displayName}</span>
                    {ext.verified && (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-500 font-medium shrink-0">Verified</span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground/60 truncate">{ext.namespace}</span>
                  <p className="text-xs text-muted-foreground/80 line-clamp-1 mt-0.5">{ext.description}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {ext.averageRating > 0 ? (
                      <span className="text-xs text-yellow-500/80 flex items-center gap-1">
                        <span className="text-yellow-500">{starDisplay(ext.averageRating)}</span>
                        <span className="text-muted-foreground/40">({ext.reviewCount})</span>
                      </span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-500 font-medium">New</span>
                    )}
                    <span className="text-xs text-muted-foreground/40">{formatDownloads(ext.downloadCount)} installs</span>
                    <div className="ml-auto">
                      {isParsing ? (
                        <button
                          disabled
                          className="inline-flex items-center gap-1 h-7 px-3 text-xs rounded-md bg-primary/10 text-primary/60 cursor-not-allowed"
                        >
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Loading
                        </button>
                      ) : (
                        <button
                          onClick={() => browseThemes(ext)}
                          className="inline-flex items-center gap-1 h-7 px-3 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                          <Palette className="w-3 h-3" />
                          {themes ? "Browse Again" : "Browse"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {hasMore && (
          <div className="px-2 pt-2 pb-1">
            <button
              onClick={loadMore}
              disabled={loading}
              className="w-full h-8 text-xs rounded-md border border-studio-border bg-secondary/20 hover:bg-secondary/40 transition-colors text-muted-foreground disabled:opacity-50"
            >
              {loading ? (
                <><Loader2 className="w-3 h-3 animate-spin inline mr-1" /> Loading...</>
              ) : (
                `Load more (${total - extensions.length} remaining)`
              )}
            </button>
          </div>
        )}
      </div>

      {/* Theme Showcase Dialog */}
      <Dialog
        open={showcaseOpen}
        onOpenChange={(open) => {
          if (!open) {
            setShowcaseOpen(false);
            setShowcaseExt(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">
              Themes from {showcaseExt?.ext.displayName ?? "Extension"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto -mx-6 px-6 space-y-2">
            {showcaseExt?.themes.map((theme) => {
              const colors = getShowcaseColors(theme.json);
              const themeKey = `${showcaseExt.ext.namespace}/${showcaseExt.ext.name}/${theme.name}`;
              const isInstalling = installingTheme.has(themeKey);
              const installed = isThemeInstalled(theme.name);
              return (
                <div
                  key={theme.name}
                  className="flex flex-col gap-2 rounded-lg border border-studio-border/60 bg-secondary/10 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-medium text-foreground truncate">{theme.name}</span>
                      {installed && (
                        <span className="inline-flex items-center gap-0.5 text-[11px] text-emerald-500 font-medium shrink-0">
                          <Check className="w-3 h-3" />
                          Installed
                        </span>
                      )}
                    </div>
                    {installed ? (
                      <span className="inline-flex items-center gap-1 h-7 px-3 text-xs rounded-md bg-emerald-500/10 text-emerald-500 font-medium shrink-0">
                        <Check className="w-3.5 h-3.5" />
                        Installed
                      </span>
                    ) : isInstalling ? (
                      <button
                        disabled
                        className="inline-flex items-center gap-1 h-7 px-3 text-xs rounded-md bg-primary/10 text-primary/60 cursor-not-allowed shrink-0"
                      >
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Installing
                      </button>
                    ) : (
                      <button
                        onClick={() => installTheme(theme)}
                        className="inline-flex items-center gap-1 h-7 px-3 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Install
                      </button>
                    )}
                  </div>
                  {/* Color Preview Strip */}
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 h-6 rounded overflow-hidden flex">
                      {[colors.bg, colors.fg, colors.accent, colors.selection, colors.bg].map((c, i) => (
                        <div key={i} className="flex-1" style={{ backgroundColor: c }} />
                      ))}
                    </div>
                  </div>
                  {/* Color Swatches */}
                  <div className="flex items-center gap-3">
                    {swatchLabels.map(({ key, label }) => (
                      <div key={key} className="flex items-center gap-1">
                        <div
                          className="w-3 h-3 rounded-full border border-white/10"
                          style={{ backgroundColor: colors[key] }}
                        />
                        <span className="text-[10px] text-muted-foreground/60 font-mono">{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
