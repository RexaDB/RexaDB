"use client";

import { useRouter } from "next/navigation";
import {
  AuthIcon,
  Database as DatabaseIcon,
  House,
  LayoutDashboard,
  Layers,
  Settings,
  SquareTerminal,
  TableEditorIcon,
  Users,
  Workflow,
} from "@/lib/icon-theme/solar-icons";
import { getEditorLabel, getTableLabels } from "@/lib/studio/db-labels";
import { NavigationRailItem } from "@/components/studio/navigation-rail-item";

/**
 * Modern UI's always-visible navigation rail. A brand-new, simple, fixed-width
 * icon rail (no expansion, no sidebar behavior control) sized like the studio's
 * sidebar card: it starts below the tab strip and ends above the bottom bar.
 * Own component so the classic studio rail is never touched.
 */
export function ModernUIRail({ studio }: { studio: any }) {
  const router = useRouter();
  const editorLabel = getEditorLabel(studio.dbType);
  const tableLabels = getTableLabels(studio.dbType);
  const isSupabase = studio.connection?.connectionType === "supabase";
  const showAuth = studio.schemas?.includes?.("auth") && isSupabase;
  const navigation = studio.sidebarView;

  // Selecting the already-active view deselects it (closes the sidebar).
  // Keep isSidebarVisible in sync so the TOGGLE_SIDEBAR hotkey stays correct.
  const selectView = (id: string) => {
    if (navigation === id) {
      studio.setSidebarView?.(null);
      studio.setIsSidebarVisible?.(false);
    } else {
      studio.setSidebarView?.(id);
      studio.setIsSidebarVisible?.(true);
    }
  };

  const primaryItems: Array<{
    id: string;
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
    onClick: () => void;
  }> = [
    {
      id: "dashboard",
      label: "Dashboard",
      Icon: LayoutDashboard,
      onClick: () => selectView("dashboard"),
    },
    {
      id: "tables",
      label: studio.databaseExplorer
        ? "Database Explorer"
        : studio.schemaExplorer
          ? "Schema Explorer"
          : `${tableLabels.singular} Explorer`,
      Icon: studio.databaseExplorer
        ? DatabaseIcon
        : studio.schemaExplorer
          ? Layers
          : TableEditorIcon,
      onClick: () => selectView("tables"),
    },
    {
      id: "sql",
      label: editorLabel,
      Icon: SquareTerminal,
      onClick: () => selectView("sql"),
    },
    {
      id: "database",
      label: "Database",
      Icon: DatabaseIcon,
      onClick: () => selectView("database"),
    },
    ...(showAuth
      ? [
          {
            id: "auth",
            label: "Authentication",
            Icon: AuthIcon,
            onClick: () => selectView("auth"),
          },
        ]
      : []),
    {
      id: "workflows",
      label: "Workflows",
      Icon: Workflow,
      onClick: () => selectView("workflows"),
    },
  ];

  const bottomItems: Array<{
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
    onClick: () => void;
  }> = [
    {
      label: "Home",
      Icon: House,
      onClick: () => {
        if (typeof window !== "undefined") {
          window.location.href = "/";
          return;
        }
        router.push("/");
      },
    },
    {
      label: "Workspace",
      Icon: Users,
      onClick:
        studio.openConnectStudioTab ||
        (() => {
          if (typeof window !== "undefined") {
            window.location.href = "/team";
          }
        }),
    },
    {
      label: "Settings",
      Icon: Settings,
      onClick: () => studio.openSettingsTab?.(),
    },
  ];

  return (
    <div className="flex h-full w-12 shrink-0 flex-col overflow-hidden bg-sidebar select-none">
      {/* Top inset clears the title bar; bottom group is pinned with mt-auto. */}
      <div className="flex min-h-0 flex-1 flex-col pt-10 pb-1.5 pl-2 pr-1">
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto scrollbar-hide">
          {primaryItems.map(({ id, label, Icon, onClick }) => (
            <NavigationRailItem
              key={id}
              label={label}
              icon={<Icon className="w-5 h-5 shrink-0" />}
              onClick={onClick}
              active={navigation === id}
            />
          ))}
        </div>
        <div className="mt-auto flex shrink-0 flex-col gap-1.5 pt-2">
          {bottomItems.map(({ label, Icon, onClick }) => (
            <NavigationRailItem
              key={label}
              label={label}
              icon={<Icon className="w-5 h-5 shrink-0" />}
              onClick={onClick}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
