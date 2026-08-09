"use client";

import { useState, useEffect, useCallback, type Dispatch, type SetStateAction } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Plus,
  Upload,
  Code,
  Trash2,
  Palette,
} from "@/lib/icon-theme/lucide-react";
import type { CustomAppTheme } from "@/lib/studio/app-themes";
import type { CustomEditorTheme } from "@/lib/studio/editor-themes";
import {
  deletePublishedTheme,
  publishTheme,
  fetchUserPublishedThemes,
  type CommunityTheme,
} from "@/lib/supabase/theme-marketplace";
import { MarketplaceExtensionList } from "@/components/studio/marketplace-extension-list";

interface ThemesSectionProps {
  customAppThemes: CustomAppTheme[];
  setCustomAppThemes: Dispatch<SetStateAction<CustomAppTheme[]>>;
  appThemeId: string;
  setAppThemeId: (id: string) => void;
  customEditorThemes: CustomEditorTheme[];
  setCustomEditorThemes: Dispatch<SetStateAction<CustomEditorTheme[]>>;
  user: { id: string } | null;
  isSessionActive: boolean;
  onOpenEditorThemeDialog: () => void;
  onOpenThemeCreator?: () => void;
  onOpenIconThemeCreator?: () => void;
}

export function ThemesSection({
  setCustomAppThemes,
  appThemeId,
  setAppThemeId,
  customAppThemes,
  customEditorThemes,
  setCustomEditorThemes,
  user,
  isSessionActive,
  onOpenEditorThemeDialog,
  onOpenThemeCreator,
  onOpenIconThemeCreator,
}: ThemesSectionProps) {
  const [publishOpen, setPublishOpen] = useState(false);
  const [selectedPublish, setSelectedPublish] = useState("");
  const [publishDesc, setPublishDesc] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishedThemes, setPublishedThemes] = useState<CommunityTheme[]>([]);
  useEffect(() => {
    if (!user?.id) return;
    fetchUserPublishedThemes(user.id).then(({ themes }) => setPublishedThemes(themes));
  }, [user?.id]);

  const handleInstall = useCallback((themeName: string) => {
    const theme = customAppThemes.find((t) => t.name === themeName + " (App)");
    if (theme) setAppThemeId(theme.id);
  }, [customAppThemes, setAppThemeId]);

  const handlePublishSubmit = async () => {
    if (!selectedPublish) { toast.error("Select a theme to publish."); return; }
    const [prefix, id] = selectedPublish.startsWith("custom:") ? ["custom", selectedPublish.slice(7)]
      : selectedPublish.startsWith("editor:") ? ["custom-editor", selectedPublish.slice(7)]
      : ["", ""];
    if (!id) { toast.error("Invalid theme."); return; }
    const theme = prefix === "custom" ? customAppThemes.find((t) => t.id === id) : customEditorThemes.find((t) => t.id === id);
    if (!theme) { toast.error("Theme not found."); return; }

    setPublishing(true);
    const themeType = prefix === "custom" ? "app" as const : "editor" as const;
    const themeJson = prefix === "custom"
      ? { name: theme.name, base: (theme as CustomAppTheme).base, colors: (theme as CustomAppTheme).colors }
      : { name: theme.name, themeJson: (theme as CustomEditorTheme).themeJson };

    const { error } = await publishTheme({ name: theme.name, description: publishDesc, themeType, themeJson });
    setPublishing(false);

    if (error) { toast.error(error); return; }
    toast.success(`Published "${theme.name}" to the community!`);
    setPublishOpen(false);
    setPublishDesc("");
    if (user?.id) {
      fetchUserPublishedThemes(user.id).then(({ themes }) => setPublishedThemes(themes));
    }
  };

  const handleDeletePublished = async (themeId: string) => {
    const { error } = await deletePublishedTheme(themeId);
    if (error) { toast.error(error); return; }
    setPublishedThemes((prev) => prev.filter((t) => t.id !== themeId));
    toast.success("Theme removed from community.");
  };

  return (
    <section className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Themes</h2>
          <p className="text-xs text-muted-foreground">
            Browse and install themes from the VS Code Marketplace.
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" className="h-8 px-3 text-xs gap-1.5 shrink-0">
              <Plus className="w-3.5 h-3.5" />
              Add Theme
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 bg-popover border-border">
            {onOpenThemeCreator && (
              <DropdownMenuItem className="text-xs gap-2 cursor-pointer" onClick={onOpenThemeCreator}>
                <Palette className="w-3.5 h-3.5" />
                Custom App Theme
              </DropdownMenuItem>
            )}
            {onOpenIconThemeCreator && (
              <DropdownMenuItem className="text-xs gap-2 cursor-pointer" onClick={onOpenIconThemeCreator}>
                <Palette className="w-3.5 h-3.5" />
                Visual Icon Theme
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="text-xs gap-2 cursor-pointer" onClick={onOpenEditorThemeDialog}>
              <Code className="w-3.5 h-3.5" />
              Custom Editor Theme
            </DropdownMenuItem>
            {isSessionActive && (customAppThemes.length > 0 || customEditorThemes.length > 0) && (
              <DropdownMenuItem
                className="text-xs gap-2 cursor-pointer border-t border-border/50 pt-1.5 mt-1.5"
                onClick={() => setPublishOpen(true)}
              >
                <Upload className="w-3.5 h-3.5" />
                Publish Theme
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Marketplace */}
      <div className="border border-studio-border rounded-lg overflow-hidden bg-popover">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-studio-border/40 bg-muted/20">
          <Palette className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">VS Code Marketplace</span>
        </div>
        <div className="p-3 max-h-[500px] overflow-y-auto">
          <MarketplaceExtensionList
            customAppThemes={customAppThemes}
            setCustomAppThemes={setCustomAppThemes}
            customEditorThemes={customEditorThemes}
            setCustomEditorThemes={setCustomEditorThemes}
            autoLoad
            onInstall={handleInstall}
          />
        </div>
      </div>

      {/* Published to Community */}
      {user?.id && publishedThemes.length > 0 && (
        <div className="space-y-2 border-t border-border pt-4">
          <h3 className="text-xs font-medium text-muted-foreground">Published to Community</h3>
          <div className="flex flex-col gap-1.5">
            {publishedThemes.map((pt) => (
              <div key={pt.id} className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/20 px-2.5 py-1.5">
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-medium text-foreground truncate">{pt.name}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {pt.theme_type === "app" ? "App" : "Editor"} Theme &middot; {pt.downloads} download{pt.downloads !== 1 ? "s" : ""}
                  </span>
                </div>
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-red-500 hover:text-red-600" onClick={() => handleDeletePublished(pt.id)}>
                  <Trash2 className="w-3 h-3 mr-1" />
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Publish Dialog */}
      <Dialog open={publishOpen} onOpenChange={(open) => { if (!open) { setPublishOpen(false); setSelectedPublish(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Publish Theme</DialogTitle>
            <DialogDescription>Share your custom theme with the community.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">Select Theme</label>
              <select
                value={selectedPublish}
                onChange={(e) => setSelectedPublish(e.target.value)}
                className="w-full h-8 text-xs bg-secondary/20 border border-studio-border rounded-lg px-2 text-foreground"
              >
                <option value="" disabled>Choose a theme...</option>
                {customAppThemes.map((t) => (
                  <option key={t.id} value={`custom:${t.id}`}>App: {t.name}</option>
                ))}
                {customEditorThemes.map((t) => (
                  <option key={t.id} value={`editor:${t.id}`}>Editor: {t.name}</option>
                ))}
              </select>
            </div>
            {selectedPublish && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground">Description</label>
                <Textarea
                  value={publishDesc}
                  onChange={(e) => setPublishDesc(e.target.value)}
                  placeholder="Describe your theme..."
                  className="min-h-[100px] text-xs"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPublishOpen(false)}>Cancel</Button>
            <Button type="button" onClick={handlePublishSubmit} disabled={publishing || !selectedPublish}>
              {publishing ? "Publishing..." : "Publish to Community"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
