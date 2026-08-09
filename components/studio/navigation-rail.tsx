"use client";

import {
  AuthIcon,
  Database as DatabaseIcon,
  House,
  LayoutDashboard,
  Layers,
  Moon,
  Settings,
  SquareTerminal,
  Sun,
  TableEditorIcon,
  Users,
  Workflow,
} from "@/lib/icon-theme/solar-icons";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { DragEvent } from "react";

import type { ConnectionDbType } from "@/lib/db/connection-type";
import type { SidebarBehavior } from "@/lib/studio/sidebar-behavior";

import { getEditorLabel, getTableLabels } from "@/lib/studio/db-labels";
import { NavigationRailItem } from "./navigation-rail-item";
import { SidebarBehaviorControl } from "./sidebar-behavior-control";

interface NavigationRailProps {
  sidebarView: "dashboard" | "tables" | "sql" | "database" | "import-export" | "auth" | "themes" | "workflows";
  setSidebarView: (view: "dashboard" | "tables" | "sql" | "database" | "import-export" | "auth" | "themes" | "workflows") => void;
  onDashboardClick: () => void;
  onTableClick: () => void;
  onSqlClick: () => void;
  onDatabaseClick: () => void;
  onSettingsClick: () => void;
  onConnectStudioClick?: () => void;
  dbType: ConnectionDbType;
  connectionType?: string;
  sidebarBehavior: SidebarBehavior;
  setSidebarBehavior: (behavior: SidebarBehavior) => void;
  railExpanded: boolean;
  hasAuth?: boolean;
  schemaExplorer?: boolean;
  databaseExplorer?: boolean;
  tableExpansion?: boolean;
}

export function NavigationRail({
  sidebarView,
  setSidebarView,
  onDashboardClick,
  onTableClick,
  onSqlClick,
  onDatabaseClick,
  onSettingsClick,
  onConnectStudioClick,
  dbType,
  connectionType,
  sidebarBehavior,
  setSidebarBehavior,
  railExpanded,
  hasAuth = false,
  schemaExplorer = false,
  databaseExplorer = false,
}: NavigationRailProps) {
  const router = useRouter();
  const editorLabel = getEditorLabel(dbType);
  const tableLabels = getTableLabels(dbType);
  
  const isSupabase = connectionType === "supabase";
  const showAuth = hasAuth && isSupabase;
  const railClassName =
    sidebarBehavior === "open"
      ? "w-56 shadow-2xl"
      : sidebarBehavior === "expandable"
        ? "w-12 hover:w-56 shadow-none hover:shadow-2xl"
        : "w-12 shadow-none";

  return (
    <div className={cn(
      "absolute inset-y-0 left-0 border-r border-studio-border bg-popover flex flex-col items-start py-3 px-1.5 z-30 transition-[width,box-shadow] duration-300 group overflow-hidden",
      railClassName
    )}>
      <div className="flex flex-col gap-1.5 w-full">
        <NavigationRailItem
          label="Dashboard"
          icon={<LayoutDashboard className="w-5 h-5 shrink-0" />}
          onClick={() => {
            setSidebarView("dashboard");
            onDashboardClick();
          }}
          active={sidebarView === "dashboard"}
          expanded={railExpanded}
        />
        <NavigationRailItem
          label={databaseExplorer ? "Database Explorer" : schemaExplorer ? "Schema Explorer" : `${tableLabels.singular} Explorer`}
          icon={databaseExplorer ? <DatabaseIcon className="w-5 h-5 shrink-0" /> : schemaExplorer ? <Layers className="w-5 h-5 shrink-0" /> : <TableEditorIcon className="w-5 h-5 shrink-0" />}
          onClick={() => {
            setSidebarView("tables");
            onTableClick();
          }}
          active={sidebarView === "tables"}
          expanded={railExpanded}
        />
        <NavigationRailItem
          label={editorLabel}
          icon={<SquareTerminal className="w-5 h-5 shrink-0" />}
          onClick={() => {
            setSidebarView("sql");
            onSqlClick();
          }}
          active={sidebarView === "sql"}
          expanded={railExpanded}
          draggable
          onDragStart={(e: DragEvent) => {
            e.dataTransfer.setData("application/x-rexadb-item", JSON.stringify({
              type: "sql-editor",
              name: "sql-editor",
              schema: ""
            }));
            e.dataTransfer.effectAllowed = "link";
          }}
        />
        <NavigationRailItem
          label="Database"
          icon={<DatabaseIcon className="w-5 h-5 shrink-0" />}
          onClick={() => {
            setSidebarView("database");
            onDatabaseClick();
          }}
          active={sidebarView === "database"}
          expanded={railExpanded}
        />
        {showAuth && (
          <NavigationRailItem
            label="Authentication"
            icon={<AuthIcon className="w-6 h-6 shrink-0" />}
            onClick={() => {
              setSidebarView("auth");
            }}
          active={sidebarView === "auth"}
          expanded={railExpanded}
        />
      )}
        <NavigationRailItem
          label="Workflows"
          icon={<Workflow className="w-5 h-5 shrink-0" />}
          onClick={() => {
            setSidebarView("workflows");
          }}
          active={sidebarView === "workflows"}
          expanded={railExpanded}
        />
      </div>

      <div className="mt-auto flex flex-col items-start gap-3 w-full">
        <NavigationRailItem
          label="Home"
          icon={<House className="w-5 h-5 shrink-0" />}
          onClick={() => {
            if (typeof window !== "undefined") {
              window.location.href = "/";
              return;
            }
            router.push("/");
          }}
          expanded={railExpanded}
        />
        <NavigationRailItem
          label="Workspace"
          icon={<Users className="w-5 h-5 shrink-0" />}
          onClick={onConnectStudioClick || (() => {
            if (typeof window !== "undefined") {
              window.location.href = "/team";
            }
          })}
          expanded={railExpanded}
        />
        <NavigationRailItem
          label="Settings"
          icon={<Settings className="w-5 h-5 shrink-0" />}
          onClick={onSettingsClick}
          expanded={railExpanded}
        />
        <SidebarBehaviorControl
          behavior={sidebarBehavior}
          setBehavior={setSidebarBehavior}
          expanded={railExpanded}
        />
      </div>
    </div>
  );
}
