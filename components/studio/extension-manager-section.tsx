"use client";

import { Power, Puzzle } from "@/lib/icon-theme/lucide-react";
import { useExtensions } from "@/lib/extensions/react";
import { extensionDisplayName } from "@/lib/extensions/types";
import { setExtensionEnabled } from "@/lib/extensions/extension-registry";
import { cn } from "@/lib/utils";

/**
 * The Extensions MANAGER sidebar (`extensions` rail entry).
 *
 * Management only: installed extensions with enable/disable toggles plus a
 * footer link to the full Extensions manager tab. It never renders extension
 * content views (trees, webviews) — those live exclusively in each
 * container's own standalone sidebar (`extensions:<containerId>`), so the
 * same content never appears in two sidebars.
 */
export function ExtensionManagerSection({
  studio,
}: {
  studio?: { openExtensionsTab?: () => void };
}) {
  const { extensions, commands, views, panels, refresh, errors } = useExtensions();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {extensions.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            No extensions installed.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {extensions.map((rec) => {
              const name = extensionDisplayName(rec.manifest);
              const err = errors[rec.manifest.id];
              const viewCount = views.filter((v) => v.extensionId === rec.manifest.id).length;
              const commandCount = commands.filter((c) => c.extensionId === rec.manifest.id).length;
              const panelCount = panels.filter((p) => p.extensionId === rec.manifest.id).length;
              return (
                <div
                  key={rec.manifest.id}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5"
                >
                  <Puzzle
                    className={cn(
                      "size-4 shrink-0",
                      rec.enabled ? "text-muted-foreground" : "text-muted-foreground/40",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">
                      {name}
                      {!rec.enabled && (
                        <span className="ml-1.5 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">
                          disabled
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {rec.manifest.version}
                      {viewCount > 0 && ` · ${viewCount} view(s)`}
                      {commandCount > 0 && ` · ${commandCount} command(s)`}
                      {panelCount > 0 && ` · ${panelCount} panel(s)`}
                    </div>
                    {err && (
                      <div className="truncate text-[10px] text-destructive">
                        Activation failed: {err}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    title={rec.enabled ? "Disable" : "Enable"}
                    onClick={() => {
                      setExtensionEnabled(rec.manifest.id, !rec.enabled);
                      refresh();
                    }}
                    className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-white/10 hover:text-foreground"
                  >
                    <Power className={cn("size-3.5", rec.enabled && "text-green-600")} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => studio?.openExtensionsTab?.()}
        className="flex h-8 shrink-0 items-center justify-center gap-2 border-t text-xs text-muted-foreground hover:text-foreground"
      >
        <Puzzle className="size-3.5" /> Manage extensions
      </button>
    </div>
  );
}
