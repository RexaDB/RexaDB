"use client";

import { useMemo, useState } from "react";
import { Puzzle, Trash2, Power, Upload, Plus } from "@/lib/icon-theme/lucide-react";
import { useExtensions } from "@/lib/extensions/react";
import {
  installExtension,
  setExtensionEnabled,
  uninstallExtension,
  parseExtensionBundle,
} from "@/lib/extensions/extension-registry";
import { validateManifest, extensionDisplayName } from "@/lib/extensions/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Extensions manager — VS Code-like Extensions view for RexaDB-native
 * extensions (manifest + Worker-sandboxed `main.js`).
 * Install from a JSON bundle `{ manifest, code }`, enable/disable, inspect
 * contribution points, surface activation errors.
 */
export function ExtensionsView() {
  const { extensions, commands, views, panels, statusItems, errors, refresh } = useExtensions();
  const [bundleText, setBundleText] = useState("");
  const [filter, setFilter] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return extensions;
    return extensions.filter((e) =>
      [e.manifest.id, e.manifest.displayName, e.manifest.description].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [extensions, filter]);

  const doInstall = () => {
    setNotice(null);
    try {
      const { manifest, code } = parseExtensionBundle(bundleText);
      const v = validateManifest(manifest);
      if (!v.ok) {
        setNotice(`Invalid manifest: ${v.errors.join("; ")}`);
        return;
      }
      const res = installExtension(manifest, code, "local");
      if (!res.ok) {
        setNotice(`Install failed: ${res.errors?.join("; ")}`);
        return;
      }
      setBundleText("");
      refresh();
      setNotice(
        code
          ? `Installed ${manifest.id}@${manifest.version}. Reload to activate.`
          : `Installed ${manifest.id}@${manifest.version} (manifest only — static contributions visible after reload, but commands/trees need main.js: reinstall with bundle.json for full functionality).`,
      );
    } catch (err) {
      setNotice(`Install failed: ${String((err as Error)?.message || err)}`);
    }
  };

  const onFile = async (file: File) => {
    setNotice(null);
    try {
      const text = await file.text();
      setBundleText(text);
    } catch (err) {
      setNotice(`Could not read file: ${String((err as Error)?.message || err)}`);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <Puzzle className="size-4" />
        <h2 className="text-sm font-semibold">Extensions</h2>
        <span className="text-xs text-muted-foreground">{extensions.length} installed</span>
      </div>

      <div className="flex gap-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search installed extensions…"
          className="h-8"
        />
      </div>

      {filtered.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
          No extensions installed yet. Paste a bundle below or drop a{" "}
          <code>{"{ manifest, code }"}</code> JSON file. See{" "}
          <code>resources/extensions/hello-rexa</code> for an example.
        </div>
      )}

      <div className="flex flex-col gap-2">
        {filtered.map((rec) => {
          const extCommands = commands.filter((c) => c.extensionId === rec.manifest.id);
          const extViews = views.filter((v) => v.extensionId === rec.manifest.id);
          const extPanels = panels.filter((p) => p.extensionId === rec.manifest.id);
          const extStatus = statusItems.filter((s) => s.extensionId === rec.manifest.id);
          const err = errors[rec.manifest.id];
          return (
            <div key={rec.manifest.id} className="rounded-lg border p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold">
                      {extensionDisplayName(rec.manifest)}
                    </span>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {rec.manifest.version}
                    </span>
                    {!rec.enabled && (
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px]">disabled</span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">{rec.manifest.id}</div>
                  {rec.manifest.description && (
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{rec.manifest.description}</div>
                  )}
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                    {extCommands.length > 0 && <span>{extCommands.length} command(s)</span>}
                    {extViews.length > 0 && <span>· {extViews.length} view(s)</span>}
                    {extPanels.length > 0 && <span>· {extPanels.length} panel(s)</span>}
                    {extStatus.length > 0 && <span>· {extStatus.length} status item(s)</span>}
                    {(rec.manifest.contributes?.languages?.length ?? 0) > 0 && (
                      <span>· {rec.manifest.contributes!.languages!.length} language(s)</span>
                    )}
                    {(rec.manifest.contributes?.themes?.length ?? 0) > 0 && (
                      <span>· {rec.manifest.contributes!.themes!.length} theme(s)</span>
                    )}
                  </div>
                  {err && <div className="mt-1 text-[11px] text-destructive">Activation failed: {err}</div>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    title={rec.enabled ? "Disable" : "Enable"}
                    onClick={() => {
                      setExtensionEnabled(rec.manifest.id, !rec.enabled);
                      refresh();
                    }}
                  >
                    <Power className={cn("size-3.5", rec.enabled ? "text-green-600" : "text-muted-foreground")} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Uninstall"
                    onClick={() => {
                      uninstallExtension(rec.manifest.id);
                      refresh();
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-lg border p-3">
        <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
          <Plus className="size-3.5" /> Install from bundle
        </div>
        <Textarea
          value={bundleText}
          onChange={(e) => setBundleText(e.target.value)}
          placeholder='Paste bundle.json ({ "manifest": {...}, "code": "..." }) — or a raw manifest.json (static contributions only)'
          className="min-h-24 font-mono text-[11px]"
        />
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" onClick={doInstall} disabled={!bundleText.trim()}>
            <Upload className="size-3.5" /> Install
          </Button>
          <label className="cursor-pointer text-xs text-muted-foreground underline">
            Load .json file
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
          </label>
        </div>
        {notice && <div className="mt-2 text-xs text-muted-foreground">{notice}</div>}
      </div>
    </div>
  );
}
