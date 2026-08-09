"use client";

import {
  LayoutGrid,
  GitFork,
  FunctionSquare,
  Box,
  Zap,
  List,
  Layers,
  Shield,
  Plus,
  ScrollText,
  FileJson,
  Terminal,
  Lock,
  Brain,
  Download,
} from "@/lib/icon-theme/lucide-react";
import type { ConnectionDbType } from "@/lib/db/connection-type";
import { getTableLabels } from "@/lib/studio/db-labels";

import { cn } from "@/lib/utils";
import { SidebarHeader } from "@/components/studio/sidebar-header";
import { useState, type DragEvent } from "react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useSidebarResize } from "@/hooks/use-sidebar-resize";

interface DatabaseSidebarProps {
  dbType?: ConnectionDbType;
  setDatabaseView: (
    view:
      | "schema"
      | "tables"
      | "functions"
      | "extensions"
      | "triggers"
      | "enums"
      | "indexes"
      | "rls-policies"
      | "sessions"
      | "locks"
      | "explain-plan"
      | "backup-restore",
  ) => void;
  openCreateDatabaseTab: () => void;
  onOpenSpacetimeDbReducers?: () => void;
  onOpenSpacetimeDbLogs?: () => void;
  onOpenSpacetimeDbSchema?: () => void;
  activeTabId: string | null;
  sleek?: boolean;
}

export function DatabaseSidebar({
  dbType = "postgres",
  setDatabaseView,
  openCreateDatabaseTab,
  onOpenSpacetimeDbReducers,
  onOpenSpacetimeDbLogs,
  onOpenSpacetimeDbSchema,
  activeTabId,
  sleek,
}: DatabaseSidebarProps) {
  const tableLabels = getTableLabels(dbType);

  const handleDragStart = (
    e: DragEvent<HTMLButtonElement>,
    itemType: string,
  ) => {
    e.dataTransfer.setData(
      "application/x-rexadb-item",
      JSON.stringify({
        type: itemType,
        name: itemType,
        schema: "",
      }),
    );
    e.dataTransfer.effectAllowed = "link";
  };

  const [sidebarWidth, setSidebarWidth] = useLocalStorage(
    "rexadb:sidebar-width",
    256,
  );
  const { handlePointerDown } = useSidebarResize(sidebarWidth, setSidebarWidth);

  const dbItems: Array<{
    id: string;
    label: string;
    icon: typeof LayoutGrid;
    type: string;
  }> = [
    {
      id: "schema",
      label: "Schema Diagram",
      icon: GitFork,
      type: "database-schema",
    },
    {
      id: "tables",
      label: `${tableLabels.plural} List`,
      icon: LayoutGrid,
      type: "database-tables",
    },
  ];

  if (dbType === "spacetimedb") {
    dbItems.push(
      {
        id: "spacetimedb-reducers",
        label: "Reducers",
        icon: FunctionSquare,
        type: "database-spacetimedb-reducers",
      },
      {
        id: "spacetimedb-logs",
        label: "Logs",
        icon: ScrollText,
        type: "database-spacetimedb-logs",
      },
      {
        id: "spacetimedb-schema",
        label: "Raw Schema",
        icon: FileJson,
        type: "database-spacetimedb-schema",
      },
    );
  }

  if (dbType === "postgres" || dbType === "supabase-mgmt") {
    dbItems.push(
      {
        id: "functions",
        label: "Functions",
        icon: FunctionSquare,
        type: "database-functions",
      },
      {
        id: "extensions",
        label: "Extensions",
        icon: Box,
        type: "database-extensions",
      },
      {
        id: "triggers",
        label: "Triggers",
        icon: Zap,
        type: "database-triggers",
      },
      {
        id: "enums",
        label: "Enumerated Types",
        icon: List,
        type: "database-enums",
      },
      {
        id: "indexes",
        label: "Indexes",
        icon: Layers,
        type: "database-indexes",
      },
      {
        id: "rls-policies",
        label: "RLS Policies",
        icon: Shield,
        type: "database-rls-policies",
      },
      {
        id: "sessions",
        label: "Sessions",
        icon: Terminal,
        type: "database-sessions",
      },
      { id: "locks", label: "Locks", icon: Lock, type: "database-locks" },
      {
        id: "explain-plan",
        label: "Explain Plan",
        icon: Brain,
        type: "database-explain-plan",
      },
      {
        id: "backup-restore",
        label: "Backup & Restore",
        icon: Download,
        type: "database-backup-restore",
      },
    );
  }

  return (
    <div
      className={cn(
        "relative shrink-0 border-r border-studio-border bg-popover",
        sleek && "border-r-0",
      )}
      style={{ width: sidebarWidth }}
    >
      <div className="flex flex-col overflow-hidden h-full text-muted-foreground">
        <SidebarHeader title="Database" />

        <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {dbItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTabId === `database-${item.id}`;
            const isSpacetimedbItem = item.id.startsWith("spacetimedb-");
            return (
              <button
                key={item.id}
                draggable
                onDragStart={(e) => handleDragStart(e, item.type)}
                onClick={() => {
                  if (isSpacetimedbItem) {
                    if (item.id === "spacetimedb-reducers")
                      onOpenSpacetimeDbReducers?.();
                    else if (item.id === "spacetimedb-logs")
                      onOpenSpacetimeDbLogs?.();
                    else if (item.id === "spacetimedb-schema")
                      onOpenSpacetimeDbSchema?.();
                  } else {
                    setDatabaseView(item.id as any);
                  }
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs rounded-lg transition-all ${
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/10"
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}

          {dbType !== "sqlite" && dbType !== "redis" && dbType !== "trino" && (
            <div className="pt-4 pb-2">
              <button
                onClick={openCreateDatabaseTab}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/10 transition-all border border-dashed border-studio-border hover:border-studio-border-hover"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>New Database</span>
              </button>
            </div>
          )}
        </div>
      </div>
      <div
        className="absolute -right-1.5 top-0 z-20 h-full w-3 cursor-col-resize select-none bg-transparent group"
        onPointerDown={handlePointerDown}
      >
        <div className="h-full w-px mx-auto bg-studio-border/50 group-hover:bg-blue-500/60 transition-colors" />
      </div>
    </div>
  );
}
