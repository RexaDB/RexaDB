"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "@/lib/icon-theme/lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  disconnectStudioWorkspace,
  clearAllStudioData,
} from "@/lib/studio-backend/auth-store";
import {
  saveGlobalStudioSettings,
  saveGlobalAppThemeSettings,
  saveGlobalEditorThemeSettings,
  saveAppFontFamily,
  saveKeybindingsFile,
  saveGlobalAiSettings,
} from "@/lib/api/actions-client";
import {
  getDefaultKeybindings,
  normalizeKeybindingsForPlatform,
} from "@/lib/studio/keybindings";

const CONFIRM_PHRASE = "RESET";

function clearBrowserStorage() {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && (key.startsWith("rexa-db-") || key === "theme")) {
        doomed.push(key);
      }
    }
    for (const key of doomed) window.localStorage.removeItem(key);
  } catch {
    /* storage may be unavailable */
  }
  try {
    window.sessionStorage.clear();
  } catch {
    /* storage may be unavailable */
  }
}

async function clearIndexedDatabases() {
  try {
    if (!("indexedDB" in window) || !indexedDB.databases) return;
    const dbs = await indexedDB.databases();
    await Promise.allSettled(
      dbs
        .map((db) => db.name)
        .filter((name): name is string => typeof name === "string")
        .map(
          (name) =>
            new Promise<void>((resolve) => {
              try {
                const req = indexedDB.deleteDatabase(name);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
                req.onblocked = () => resolve();
              } catch {
                resolve();
              }
            }),
        ),
    );
  } catch {
    /* indexedDB may be unavailable */
  }
}

export function DangerZoneSetting() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);

  const confirmed = confirmText.trim().toUpperCase() === CONFIRM_PHRASE;

  const handleReset = async () => {
    if (!confirmed || resetting) return;
    setResetting(true);
    try {
      // Persisted preferences back to factory defaults. Every save below uses
      // replace semantics server-side, so empty/default payloads truly reset.
      await saveGlobalStudioSettings({});
      await saveGlobalAppThemeSettings({
        appThemeId: "rexadb-dark",
        customAppThemes: "[]",
      });
      await saveGlobalEditorThemeSettings({
        editorThemeId: "auto",
        customEditorThemes: "[]",
      });
      await saveAppFontFamily("");
      await saveKeybindingsFile(
        normalizeKeybindingsForPlatform(getDefaultKeybindings()),
      );
      // Server-side normalizer refills pinned provider defaults (empty keys).
      await saveGlobalAiSettings({});

      // Workspace session + saved credentials.
      try {
        await disconnectStudioWorkspace();
      } catch {
        /* best-effort */
      }
      try {
        await clearAllStudioData();
      } catch {
        /* best-effort */
      }

      clearBrowserStorage();
      await clearIndexedDatabases();

      toast.success("Everything reset. Reloading with fresh defaults…");
      setDialogOpen(false);
      window.setTimeout(() => window.location.reload(), 600);
    } catch {
      toast.error("Reset failed partway — some settings may remain.");
      setResetting(false);
    }
  };

  return (
    <>
      <div
        data-setting-id="danger-zone-reset"
        className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/[0.04] p-4"
      >
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="flex flex-col">
            <span className="font-medium text-xs">Danger Zone</span>
            <span className="text-xs text-muted-foreground">
              Reset all preferences to factory defaults, clear local caches,
              and disconnect the workspace. Saved connections are kept.
            </span>
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              setConfirmText("");
              setDialogOpen(true);
            }}
          >
            Reset Everything…
          </Button>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reset everything?</DialogTitle>
            <DialogDescription>
              This will reset all settings to their defaults:
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>Appearance, editor, grid, tab, and behavior preferences</li>
            <li>Custom app, editor, and icon themes</li>
            <li>Keybindings and AI provider settings (including API keys)</li>
            <li>Local caches (tabs, dashboards, notes, search index)</li>
            <li>Workspace connection (you will be signed out of it)</li>
          </ul>
          <p className="text-xs text-muted-foreground">
            Saved database connections are kept. This cannot be undone. Type{" "}
            <span className="font-mono font-semibold text-foreground">
              {CONFIRM_PHRASE}
            </span>{" "}
            to confirm.
          </p>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={CONFIRM_PHRASE}
            className="h-8 font-mono text-xs"
            autoFocus
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDialogOpen(false)}
              disabled={resetting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleReset}
              disabled={!confirmed || resetting}
            >
              {resetting ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Resetting…
                </>
              ) : (
                "Reset Everything"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
