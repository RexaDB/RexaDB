"use client";

import React, { useEffect, useState } from "react";
import {
  Server,
  Plus,
  Trash2,
  ArrowRight,
  Loader2,
  ArrowLeft,
  CheckCircle2,
  Circle,
  RefreshCw,
} from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  listWorkspaces,
  switchWorkspace,
  removeWorkspace,
  getStudioUrl,
  loadStudioAuth,
  ensureActiveWorkspaceInList,
  type WorkspaceInfo,
} from "@/lib/studio-backend/auth-store";
import { AcceptView } from "@/components/studio/connect-studio-view";

interface ManageWorkspacesViewProps {
  studio: {
    openConnectStudioTab?: () => void;
  };
}

export function ManageWorkspacesView({ studio }: ManageWorkspacesViewProps) {
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const activeUrl = getStudioUrl();
  const auth = loadStudioAuth();

  const load = async () => {
    setLoading(true);
    await ensureActiveWorkspaceInList();
    const list = await listWorkspaces();
    setWorkspaces(list);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleSwitch = async (url: string) => {
    setSwitching(url);
    const ok = await switchWorkspace(url);
    setSwitching(null);
    if (ok) {
      toast.success("Switched workspace");
      if (typeof window !== "undefined") {
        window.location.href = "/";
      }
    } else {
      toast.error("Failed to switch workspace");
    }
  };

  const handleRemove = async (url: string) => {
    setRemoving(url);
    const ok = await removeWorkspace(url);
    setRemoving(null);
    if (ok) {
      toast.success("Workspace removed");
      load();
    } else {
      toast.error("Failed to remove workspace");
    }
  };

  if (showForm) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="shrink-0 border-b border-studio-border">
          <div className="flex items-center gap-3 px-6 py-3">
            <button
              onClick={() => setShowForm(false)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to workspaces
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <AcceptView
            onConnected={() => {
              setShowForm(false);
              load();
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 border-b border-studio-border">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center">
              <Server className="w-3.5 h-3.5 text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-semibold">Workspaces</h1>
              <p className="text-xs text-muted-foreground/70">
                {workspaces.length} connected
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => load()}
              className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
            <Button
              variant="default"
              size="sm"
              onClick={() => setShowForm(true)}
              className="h-7 text-xs gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Connect
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-lg border border-studio-border bg-muted/10 animate-pulse" />
            ))}
          </div>
        ) : workspaces.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-xs">
              <div className="w-16 h-16 rounded-2xl bg-muted/30 mx-auto mb-4 flex items-center justify-center">
                <Server className="w-7 h-7 text-muted-foreground/30" />
              </div>
              <h3 className="text-sm font-medium mb-1">No workspaces connected</h3>
              <p className="text-xs text-muted-foreground/70 mb-5 leading-relaxed">
                Connect to a Rexadb Studio to sync snippets, dashboards, and collaborate with your team.
              </p>
              <Button
                variant="default"
                size="sm"
                onClick={() => setShowForm(true)}
                className="h-8 text-xs gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Connect Workspace
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-2">
            {workspaces.map((ws) => {
              const isActive = auth !== null && ws.studioUrl === activeUrl;
              return (
                <div
                  key={ws.studioUrl}
                  className={`group relative rounded-lg border transition-all duration-150 ${
                    isActive
                      ? "border-primary/30 bg-primary/[0.03]"
                      : "border-studio-border hover:border-muted-foreground/20 hover:bg-muted/5"
                  }`}
                >
                  <div className="flex items-center gap-3 px-4 py-3 min-w-0">
                    <div className="shrink-0">
                      {isActive ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <Circle className="w-4 h-4 text-muted-foreground/20" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {ws.name}
                        </span>
                        {isActive && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-medium shrink-0">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground/50 truncate mt-0.5 font-mono">
                        {ws.studioUrl}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {!isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSwitch(ws.studioUrl)}
                          disabled={switching === ws.studioUrl}
                          className="h-7 text-xs gap-1 px-2"
                        >
                          {switching === ws.studioUrl ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <ArrowRight className="w-3 h-3" />
                          )}
                          Switch
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemove(ws.studioUrl)}
                        disabled={removing === ws.studioUrl}
                        className="h-7 w-7 p-0 text-muted-foreground/40 hover:text-red-500 hover:bg-red-500/10"
                      >
                        {removing === ws.studioUrl ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
