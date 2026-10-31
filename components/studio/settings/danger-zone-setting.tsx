"use client";

import { setAppIcon } from "@/lib/app-icon";
import { isDesktopRuntime } from "@/lib/desktop";
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
  getConnectionsResult,
  saveStudioTabs,
  saveStudioFolders,
  saveStudioSnippets,
  saveStudioHistory,
  saveStudioTags,
  saveStudioDashboards,
  saveStudioNotes,
  clearSearchIndex,
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
  const [resetStep, setResetStep] = useState<string | null>(null);

  const confirmed = confirmText.trim().toUpperCase() === CONFIRM_PHRASE;

  const handleReset = async () => {
    if (!confirmed || resetting) return;
    setResetting(true);
    const failures: string[] = [];

    // Every persistence call below resolves with `{ success: false }` on
    // failure instead of throwing, so each step is checked explicitly. Any
    // failure aborts before local caches are wiped or the app reloads.
    const runStep = async (
      label: string,
      run: () => Promise<unknown>,
    ): Promise<void> => {
      setResetStep(label);
      try {
        const res = (await run()) as {
          success?: boolean;
          error?: string;
        } | null;
        if (
          res &&
          typeof res === "object" &&
          "success" in res &&
          res.success === false
        ) {
          failures.push(
            `${label}${typeof res.error === "string" && res.error ? `: ${res.error}` : ""}`,
          );
        }
      } catch (err) {
        failures.push(
          `${label}${err instanceof Error && err.message ? `: ${err.message}` : ""}`,
        );
      }
    };

    try {
      // 1. Global preferences back to factory defaults. Every save uses
      // replace semantics server-side, so empty/default payloads truly reset.
      await runStep("App preferences", () => saveGlobalStudioSettings({}));
      await runStep("App theme", () =>
        saveGlobalAppThemeSettings({
          appThemeId: "rexadb-dark",
          customAppThemes: "[]",
        }),
      );
      await runStep("Editor theme", () =>
        saveGlobalEditorThemeSettings({
          editorThemeId: "auto",
          customEditorThemes: "[]",
        }),
      );
      await runStep("App font", () => saveAppFontFamily(""));
      await runStep("Keybindings", () =>
        saveKeybindingsFile(
          normalizeKeybindingsForPlatform(getDefaultKeybindings()),
        ),
      );
      // Server-side normalizer refills pinned provider defaults (empty keys).
      await runStep("AI providers", () => saveGlobalAiSettings({}));
      if (isDesktopRuntime()) {
        await runStep("App icon", () => setAppIcon("default"));
      }

      // 2. Per-connection workspace content. Tabs, dashboards, notes, and
      // friends also live in backend SQLite — clearing browser storage alone
      // leaves them to be restored on next open. Connections themselves stay.
      const conns = await getConnectionsResult();
      if (!conns.ok) {
        failures.push(
          `Load connections${conns.error ? `: ${conns.error}` : ""}`,
        );
      } else {
        for (const conn of conns.data) {
          const id = (conn as { id?: unknown })?.id;
          if (typeof id !== "number") continue;
          const name =
            typeof (conn as { name?: unknown })?.name === "string" &&
            (conn as { name: string }).name
              ? (conn as { name: string }).name
              : `connection ${id}`;
          await runStep(`Tabs (${name})`, () => saveStudioTabs(id, []));
          await runStep(`Folders (${name})`, () => saveStudioFolders(id, []));
          await runStep(`Snippets (${name})`, () => saveStudioSnippets(id, []));
          await runStep(`Query history (${name})`, () =>
            saveStudioHistory(id, []),
          );
          await runStep(`Tags (${name})`, () => saveStudioTags(id, []));
          await runStep(`Dashboards (${name})`, () =>
            saveStudioDashboards(id, { dashboards: [], folders: [] }),
          );
          await runStep(`Notes (${name})`, () =>
            saveStudioNotes(id, { notes: [] }),
          );
          const connectionString = (conn as { connectionString?: unknown })
            ?.connectionString;
          if (
            typeof connectionString === "string" &&
            connectionString.length > 0
          ) {
            await runStep(`Search index (${name})`, () =>
              clearSearchIndex(connectionString),
            );
          } else {
            failures.push(
              `Search index (${name}): credentials locked — unlock the connection and retry`,
            );
          }
        }
      }

      if (failures.length > 0) {
        // Steps run sequentially with no rollback: earlier steps may already
        // be applied, so report a partial reset honestly instead of claiming
        // nothing changed.
        toast.error(
          `Reset stopped partway — some data was already cleared and ${failures.length} step${failures.length === 1 ? "" : "s"} failed. Fix the issue and run it again to finish.`,
          { description: failures.slice(0, 3).join("\n") },
        );
        setResetting(false);
        setResetStep(null);
        return;
      }

      // 3. Workspace session + saved credentials (best-effort teardown; the
      // storage wipe + reload below signs out regardless).
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
      setResetStep(null);
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
              Reset all preferences to factory defaults, wipe per-connection
              workspace content and local caches, and disconnect the workspace.
              Saved connections are kept.
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
            <li>App icon</li>
            <li>Keybindings and AI provider settings (including API keys)</li>
            <li>
              Per-connection content: open tabs, dashboards, notes, snippets,
              folders, query history, and search index
            </li>
            <li>Local caches in this browser</li>
            <li>Workspace connection (you will be signed out of it)</li>
          </ul>
          <p className="text-xs text-muted-foreground">
            Saved database connections are kept. Steps apply in order with
            no rollback: if a step fails, the reset stops and earlier steps
            may already be applied — fix the issue and run it again to
            finish. This cannot be undone. Type{" "}
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
                  {resetStep ? `Resetting ${resetStep}…` : "Resetting…"}
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
