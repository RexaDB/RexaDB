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
import { NavUser } from "@/components/navigation/nav-user";

/**
 * Modern UI's always-visible navigation rail. A brand-new, simple, fixed-width
 * icon rail (no expansion, no sidebar behavior control) sized like the studio's
 * sidebar card: it starts below the tab strip and ends above the bottom bar.
 * Own component so the classic studio rail is never touched.
 */
export type ModernUIRailItem = {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
};

export function ModernUIRail({
  studio,
  settingsOpen,
  onSettingsToggle,
  items,
  activeId,
  onSettingsClick,
  showHome = true,
  showWorkspace = true,
  user,
}: {
  studio: any;
  settingsOpen?: boolean;
  onSettingsToggle?: () => void;
  /** Overrides the studio-derived nav items (dashboard/tables/sql/...) with a
   *  custom set. Used by surfaces with no active studio connection, e.g. the
   *  connections list. */
  items?: ModernUIRailItem[];
  /** Highlighted item id when `items` is provided. */
  activeId?: string | null;
  /** Overrides the bottom "Settings" item's click handler (and its active
   *  state, via `settingsOpen`). Used by surfaces that route to their own
   *  settings view instead of the studio SettingsView dialog. */
  onSettingsClick?: () => void;
  /** Shows the bottom "Home" item. Defaults to true. */
  showHome?: boolean;
  /** Shows the bottom "Workspace" item. Defaults to true. */
  showWorkspace?: boolean;
  /** Shows a profile/account avatar at the very bottom of the rail, matching
   *  the user button New Layout shows. Omitted when there's no user info. */
  user?: { name?: string; email?: string } | null;
}) {
  const router = useRouter();
  const editorLabel = getEditorLabel(studio.dbType);
  const tableLabels = getTableLabels(studio.dbType);
  const isSupabase = studio.connection?.connectionType === "supabase";
  const showAuth = studio.schemas?.includes?.("auth") && isSupabase;
  const navigation = items ? activeId : studio.sidebarView;

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

  const primaryItems: ModernUIRailItem[] =
    items ??
    [
      {
        id: "dashboard",
        label: "Dashboard",
        icon: <LayoutDashboard className="w-5 h-5 shrink-0" />,
        onClick: () => selectView("dashboard"),
      },
      {
        id: "tables",
        label: studio.databaseExplorer
          ? "Database Explorer"
          : studio.schemaExplorer
            ? "Schema Explorer"
            : `${tableLabels.singular} Explorer`,
        icon: studio.databaseExplorer ? (
          <DatabaseIcon className="w-5 h-5 shrink-0" />
        ) : studio.schemaExplorer ? (
          <Layers className="w-5 h-5 shrink-0" />
        ) : (
          <TableEditorIcon className="w-5 h-5 shrink-0" />
        ),
        onClick: () => selectView("tables"),
      },
      {
        id: "sql",
        label: editorLabel,
        icon: <SquareTerminal className="w-5 h-5 shrink-0" />,
        onClick: () => selectView("sql"),
      },
      {
        id: "database",
        label: "Database",
        icon: <DatabaseIcon className="w-5 h-5 shrink-0" />,
        onClick: () => selectView("database"),
      },
      ...(showAuth
        ? [
            {
              id: "auth",
              label: "Authentication",
              icon: <AuthIcon className="w-5 h-5 shrink-0" />,
              onClick: () => selectView("auth"),
            },
          ]
        : []),
      {
        id: "workflows",
        label: "Workflows",
        icon: <Workflow className="w-5 h-5 shrink-0" />,
        onClick: () => selectView("workflows"),
      },
    ];

  const bottomItems: Array<{
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
    onClick: () => void;
    active?: boolean;
  }> = [
    ...(showHome
      ? [
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
        ]
      : []),
    ...(showWorkspace
      ? [
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
        ]
      : []),
    {
      label: "Settings",
      Icon: Settings,
      onClick: onSettingsClick ?? (() => onSettingsToggle?.()),
      active: settingsOpen,
    },
  ];

  return (
    <div className="flex h-full w-12 shrink-0 flex-col overflow-hidden bg-sidebar select-none">
      {/* Top inset clears the title bar; bottom group is pinned with mt-auto. */}
      <div className="flex min-h-0 flex-1 flex-col pt-10 pb-1.5 pl-2 pr-1">
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto scrollbar-hide">
          {primaryItems.map(({ id, label, icon, onClick }) => (
            <NavigationRailItem
              key={id}
              label={label}
              icon={icon}
              onClick={onClick}
              active={navigation === id}
            />
          ))}
        </div>
        <div className="mt-auto flex shrink-0 flex-col gap-1.5 pt-2">
          {bottomItems.map(({ label, Icon, onClick, active }) => (
            <NavigationRailItem
              key={label}
              label={label}
              icon={<Icon className="w-5 h-5 shrink-0" />}
              onClick={onClick}
              active={active}
            />
          ))}
          {user && (
            <>
              <div className="mx-1 h-px shrink-0 bg-border/50" />
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-transparent transition-colors hover:border-border/70 hover:bg-muted/20">
                <NavUser name={user.name} email={user.email} dropdownAlign="end" dropdownSide="right" />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
