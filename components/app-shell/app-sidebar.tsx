"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Connection } from "@/lib/db/schema";
import { ProviderLogo, SpacetimeDbBrandImage } from "@/components/shared/provider-logo";
import { useDesktopWindow } from "@/hooks/use-desktop-window";
import type { AppTab } from "@/components/app-shell/app-shared";
import { NavigationControls } from "@/components/navigation/navigation-controls";
import {
  SettingsMinimalistic,
  AltArrowDown,
  AddCircle,
  DatabaseIcon,
  Chart,
  House,
} from "@/lib/icon-theme/solar-icons";
import { NavUser } from "@/components/navigation/nav-user";
import { ResizeHandle } from "@/components/app-shell/resize-handle";

const DRAG = { WebkitAppRegion: "drag" } as React.CSSProperties;
const NO_DRAG = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

/** Flattens buttons: background only on hover/active, never persistent. */
const FLAT_ITEM = "data-active:bg-transparent data-active:text-foreground";

export type AppSidebarProps = {
  /** Active section id: "connections" | "analytics" | "settings". */
  activePath?: string;
  /** Called with a section id when a nav item is selected. */
  onNavigate?: (path: string) => void;
  /** Called when the "New Connection" quick action is pressed. */
  onNewConnection?: () => void;
  /** Analytics: currently selected connection. */
  selectedConnectionId?: number | null;
  /** Analytics: called when a connection is picked in the list. */
  onSelectConnection?: (id: number, name?: string, type?: string | null) => void;
  /** Connections shown in the Analytics list. */
  connections?: Connection[];
  /** History back/forward (rendered at the top of the sidebar). */
  onBack?: () => void;
  onForward?: () => void;
  canBack?: boolean;
  canForward?: boolean;
  /** Home / connections root. Defaults to navigating to `/`. */
  onHome?: () => void;
  /**
   * When false, hide the home button. Defaults to true except on the
   * connections home view (`activePath === "connections"` without custom content).
   */
  showHome?: boolean;
  /** Custom sidebar body. When set, replaces the connections nav/footer. */
  content?: React.ReactNode;
  /** Recently-viewed items shown in the history (clock) dropdown. */
  tabs?: AppTab[];
  onSelectTab?: (id: string) => void;
  /** User data for the avatar. */
  user?: { name?: string; email?: string };
  /** Extra classes merged onto the sidebar container. */
  className?: string;
  /** Extra inline styles applied to the sidebar container. */
  style?: React.CSSProperties;
  /** Current sidebar width in pixels (for resizable sidebar). */
  sidebarWidth?: number;
  /** Called when the sidebar is resized by dragging. */
  onSidebarWidthChange?: (width: number) => void;
  /** Hide the top Home/back/forward header controls (Modern UI). */
  hideHeaderControls?: boolean;
};

export function AppSidebar({
  activePath,
  onNavigate,
  onNewConnection,
  selectedConnectionId,
  onSelectConnection,
  connections = [],
  onBack,
  onForward,
  canBack,
  canForward,
  onHome,
  showHome,
  content,
  tabs = [],
  onSelectTab,
  user,
  className,
  style,
  sidebarWidth,
  onSidebarWidthChange,
  hideHeaderControls = false,
}: AppSidebarProps) {
  const router = useRouter();
  const { state: sidebarState } = useSidebar();
  const { isMac: isMacDesktopApp } = useDesktopWindow();
  const handleHome = onHome ?? (() => router.push("/"));
  // Hide home when already on the connections home screen.
  const homeVisible =
    showHome ?? (Boolean(content) || activePath !== "connections");

  const isExpanded = sidebarState === "expanded";

  const handleResizeStart = (e: React.MouseEvent) => {
    if (!onSidebarWidthChange) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth ?? 256;

    const onMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.min(500, Math.max(150, startWidth + ev.clientX - startX));
      onSidebarWidthChange(newWidth);
    };

    const onMouseUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
      <Sidebar
        collapsible="offcanvas"
        variant="inset"
        className={cn("pt-1 select-none", className)}
        // Modern UI: the floating title bar owns window drag / double-click
        // maximize — don't treat the whole sidebar as a titlebar region.
        data-tauri-drag-region={hideHeaderControls ? "false" : undefined}
        style={style}
      >
      {!hideHeaderControls && (
      <SidebarHeader
        className={cn("-mr-2 h-8 flex-row items-center justify-between pl-0.5 pr-1 py-0")}
        style={DRAG}
        data-tauri-drag-region="deep"
      >
        <div className="flex items-center" style={NO_DRAG}>
          {isExpanded && user && !isMacDesktopApp && (
            <NavUser name={user.name} email={user.email} dropdownAlign="start" />
          )}
        </div>
        <div className="flex items-center gap-0.5" style={NO_DRAG}>
          {homeVisible && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label="Home"
                  className="size-7 rounded-full text-muted-foreground hover:bg-[var(--shell-content-bg)] hover:text-foreground"
                  size="icon-sm"
                  variant="ghost"
                  onClick={handleHome}
                >
                  <House className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Home</TooltipContent>
            </Tooltip>
          )}
          <NavigationControls
            tabs={tabs}
            onSelectTab={onSelectTab}
            canBack={canBack}
            onBack={onBack}
            canForward={canForward}
            onForward={onForward}
          />
        </div>
      </SidebarHeader>
      )}
      {content ? (
        <SidebarContent className="overflow-hidden p-0 select-none">
          {content}
        </SidebarContent>
      ) : (
        <>
      <SidebarContent className="select-none">
        <SidebarGroup>
          <SidebarMenuItem className="flex items-center gap-2">
            <SidebarMenuButton
              className="min-w-8"
              onClick={onNewConnection}
              tooltip="New Connection"
            >
              <AddCircle />
              <span>New Connection</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
            <SidebarMenuButton
              className={FLAT_ITEM}
              isActive={activePath === "connections"}
              onClick={() => onNavigate?.("connections")}
            >
              <DatabaseIcon />
              <span>Connections</span>
            </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem className="mt-1">
              <SidebarMenuButton
                className={FLAT_ITEM}
                isActive={activePath === "supabase"}
                onClick={() => onNavigate?.("supabase")}
              >
                <ProviderLogo type="supabase" className="size-4" />
                <span>Supabase</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem className="mt-1">
              <SidebarMenuButton
                className={FLAT_ITEM}
                isActive={activePath === "spacetimedb"}
                onClick={() => onNavigate?.("spacetimedb")}
              >
                <SpacetimeDbBrandImage className="size-4" />
                <span>SpacetimeDB</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem className="mt-1">
              <SidebarMenuButton
                className={FLAT_ITEM}
                isActive={activePath === "neon"}
                onClick={() => onNavigate?.("neon")}
              >
                <ProviderLogo type="neon" className="size-4" />
                <span>Neon</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-muted-foreground">
            Insights
          </SidebarGroupLabel>
          <SidebarMenu>
            <Collapsible
              asChild
              className="group/collapsible"
              defaultOpen={activePath === "analytics"}
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton
                    className={FLAT_ITEM}
                  >
                    <Chart />
                    <span>Analytics</span>
                    <AltArrowDown className="ml-auto transition-transform duration-200 -rotate-90 group-data-[state=open]/collapsible:rotate-0" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub className="mx-0 translate-x-0 gap-0.5 border-none px-0">
                    {connections.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        No connections
                      </div>
                    ) : (
                      connections.map((c) => (
                        <SidebarMenuSubItem key={c.id}>
                          <SidebarMenuSubButton
                            className="h-8 cursor-pointer text-muted-foreground transition-colors data-active:bg-transparent data-active:text-muted-foreground data-[active=true]:font-medium"
                            isActive={
                              activePath === "analytics" &&
                              selectedConnectionId === c.id
                            }
                            onClick={() =>
                              onSelectConnection?.(c.id, c.name, c.connectionType)
                            }
                            title={c.name}
                          >
                            <ProviderLogo
                              type={c.connectionType}
                              className="size-4 shrink-0"
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {c.name}
                            </span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))
                    )}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu className="mt-2">
          <SidebarMenuItem>
              <SidebarMenuButton
                className={FLAT_ITEM}
                isActive={activePath === "settings"}
                onClick={() => onNavigate?.("settings")}
                size="sm"
              >
                <SettingsMinimalistic />
                <span>Settings</span>
              </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
        </>
      )}
      {onSidebarWidthChange && isExpanded && (
        <ResizeHandle
          orientation="vertical"
          onMouseDown={handleResizeStart}
          className={cn(
            hideHeaderControls
              ? // Modern UI: pin to the gutter between the reserved sidebar column
                // and the content column (not relative to the inner card). The
                // strip is exactly --shell-sash-gap wide ending at
                // --sidebar-width, so the sash line is dead-center in the gap.
                "fixed top-9 bottom-0 z-[60]"
              : // Classic shell: leave room for header/footer chrome.
                "absolute left-full top-10 bottom-8 w-[var(--shell-sash-gap,6px)]",
          )}
          style={
            hideHeaderControls
              ? {
                  left: "calc(var(--sidebar-width) - var(--shell-sash-gap, 6px))",
                  width: "var(--shell-sash-gap, 6px)",
                }
              : undefined
          }
        />
      )}
    </Sidebar>
  );
}
