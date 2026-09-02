"use client";

import { Button } from "@/components/ui/button";
import { NavUser } from "@/components/navigation/nav-user";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ModernUISearchBar } from "@/components/app-shell/modern-ui-search";
import { ModernConnectionDropdown } from "@/components/app-shell/modern-connection-dropdown";
import { UpdateHeaderBadge } from "@/components/providers/update-header-badge";
import { Settings, Bell } from "@/lib/icon-theme/lucide-react";
import { AltArrowLeft, AltArrowRight } from "@/lib/icon-theme/solar-icons";
import {
  formatShortcutForPlatform,
  getKeybindingCombo,
  type Keybinding,
} from "@/lib/studio/keybindings";
import {
  LayoutPanelIcon,
  LayoutSidebarLeftIcon,
  LayoutSidebarRightIcon,
} from "@/components/app-shell/vscode-layout-icons";
import { CustomizeLayoutPopover } from "@/components/app-shell/customize-layout-popover";
import { WindowControls } from "@/components/shared/window-controls";
import { useDesktopWindow } from "@/hooks/use-desktop-window";
import type { Connection } from "@/lib/db/schema";

type KeybindingsMap = Record<string, Keybinding>;

function shortcutLabel(
  keybindings: KeybindingsMap | undefined,
  type: string,
): string | null {
  if (!keybindings) return null;
  const combo = getKeybindingCombo(keybindings, type);
  return combo ? formatShortcutForPlatform(combo) : null;
}

/**
 * VS Code "Modern UI" title bar clone: a floating transparent strip over the
 * top of the window. The centered cluster is back/forward immediately left of
 * the search bar; the layout controls sit top-right. "Customize Layout" opens
 * the customization popover. No big colors — everything is muted/neutral.
 */
export function ModernVscodeHeader({
  height,
  macTrafficLightInset = 72,
  onOpenSearch,
  keybindings,
  activityBarOpen,
  onToggleActivityBar,
  sidebarOpen,
  onToggleSidebar,
  secondarySidebarOpen,
  onToggleSecondarySidebar,
  panelOpen,
  onTogglePanel,
  statusBarOpen,
  onToggleStatusBar,
  onOpenNotifications,
  canBack,
  onBack,
  canForward,
  onForward,
  connection,
  onSelectConnection,
  user,
  onOpenSettings,
  settingsActive,
}: {
  /** Height of the strip between the window top and the content container. */
  height?: number;
  /** Left inset for the macOS traffic lights so the layout controls don't collide. */
  macTrafficLightInset?: number;
  /** Opens the Cmd+K command menu from the search bar. */
  onOpenSearch?: () => void;
  /** User keybindings so the customization dialog shows real, custom combos. */
  keybindings?: KeybindingsMap;
  activityBarOpen?: boolean;
  onToggleActivityBar?: () => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  secondarySidebarOpen?: boolean;
  onToggleSecondarySidebar?: () => void;
  panelOpen?: boolean;
  onTogglePanel?: () => void;
  statusBarOpen?: boolean;
  onToggleStatusBar?: () => void;
  onOpenNotifications?: () => void;
  canBack?: boolean;
  onBack?: () => void;
  canForward?: boolean;
  onForward?: () => void;
  /** Active studio connection for the title-bar connection switcher. */
  connection?: {
    id: number;
    name: string;
    connectionType?: string | null;
    connectionString?: string;
  } | null;
  /**
   * Optional local-only connection switch handler. When provided, the header
   * dropdown does not navigate the main studio (used by the Agents window).
   */
  onSelectConnection?: (conn: Connection) => void | Promise<void>;
  /** Optional account info for the same NavUser popover used in the navigation rail. */
  user?: { name?: string; email?: string; avatar?: string; user_metadata?: Record<string, unknown> } | null;
  /** Optional settings button action for the title bar. */
  onOpenSettings?: () => void;
  settingsActive?: boolean;
}) {
  // Compact title-bar controls so the cluster sits cleanly inside the ~36px
  // strip above the content cards (mt-9 / pt-9).
  const navButtonClass =
    "size-[22px] select-none rounded-[4px] text-muted-foreground transition-colors hover:bg-sidebar hover:text-foreground [&_svg]:size-3.5";
  const layoutButtonClass = navButtonClass;
  const sidebarShortcut = shortcutLabel(keybindings, "TOGGLE_SIDEBAR");
  const panelShortcut = shortcutLabel(keybindings, "TOGGLE_BOTTOM_PANEL");
  const aiShortcut = shortcutLabel(keybindings, "TOGGLE_AI_PANEL");
  const { isMaximized, sendWindowAction, canUseDesktop, isMac, isLinuxCloseOnly } = useDesktopWindow();

  const userName =
    user?.name ||
    (typeof user?.user_metadata?.name === "string" && user.user_metadata.name) ||
    (typeof user?.user_metadata?.full_name === "string" &&
      user.user_metadata.full_name) ||
    (typeof user?.user_metadata?.display_name === "string" &&
      user.user_metadata.display_name) ||
    user?.email?.split("@")[0] ||
    undefined;

  return (
    <header
      className="absolute inset-x-0 top-0 z-40 flex h-8 shrink-0 select-none items-center gap-2 px-2"
      data-tauri-drag-region="deep"
      style={{
        // Prefer the measured strip height when available so the bar always
        // matches the gap above the content cards; fall back to h-9.
        height: height !== undefined ? height : undefined,
        paddingLeft: macTrafficLightInset
          ? `${macTrafficLightInset}px`
          : undefined,
      }}
    >
      {/* True horizontal center of the title bar (not biased by the right chrome). */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="pointer-events-auto flex select-none items-center justify-center gap-1">
          <Button
            aria-label="Back"
            className={navButtonClass}
            disabled={!canBack}
            onClick={onBack}
            size="icon-sm"
            variant="ghost"
          >
            <AltArrowLeft />
          </Button>
          <Button
            aria-label="Forward"
            className={navButtonClass}
            disabled={!canForward}
            onClick={onForward}
            size="icon-sm"
            variant="ghost"
          >
            <AltArrowRight />
          </Button>
          <ModernConnectionDropdown
            connection={connection}
            onSelectConnection={onSelectConnection}
          />
          <ModernUISearchBar onOpen={onOpenSearch} keybindings={keybindings} />
          <UpdateHeaderBadge />
        </div>
      </div>

      {/* Right: layout controls + customize layout. */}
      <div className="relative z-10 ml-auto flex min-w-0 items-center justify-end gap-0.5">
        {onToggleSidebar && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Toggle primary sidebar"
                className={layoutButtonClass}
                size="icon-sm"
                variant="ghost"
                onClick={onToggleSidebar}
              >
                <LayoutSidebarLeftIcon className="size-3.5" active={sidebarOpen} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Toggle Primary Side Bar
              {sidebarShortcut ? ` (${sidebarShortcut})` : ""}
            </TooltipContent>
          </Tooltip>
        )}
        {onToggleSecondarySidebar && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Toggle secondary sidebar"
                className={layoutButtonClass}
                size="icon-sm"
                variant="ghost"
                onClick={onToggleSecondarySidebar}
              >
                <LayoutSidebarRightIcon
                  className="size-3.5"
                  active={secondarySidebarOpen}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Toggle Secondary Side Bar
              {aiShortcut ? ` (${aiShortcut})` : ""}
            </TooltipContent>
          </Tooltip>
        )}
        {onTogglePanel && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Toggle panel"
                className={layoutButtonClass}
                size="icon-sm"
                variant="ghost"
                onClick={onTogglePanel}
              >
                <LayoutPanelIcon className="size-3.5" active={panelOpen} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Toggle Panel
              {panelShortcut ? ` (${panelShortcut})` : ""}
            </TooltipContent>
          </Tooltip>
        )}
        <CustomizeLayoutPopover
          keybindings={keybindings}
          activityBarOpen={activityBarOpen}
          onToggleActivityBar={onToggleActivityBar}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={onToggleSidebar}
          secondarySidebarOpen={secondarySidebarOpen}
          onToggleSecondarySidebar={onToggleSecondarySidebar}
          panelOpen={panelOpen}
          onTogglePanel={onTogglePanel}
          statusBarOpen={statusBarOpen}
          onToggleStatusBar={onToggleStatusBar}
        />
        {onOpenNotifications && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Notifications"
                className={navButtonClass}
                size="icon-sm"
                variant="ghost"
                onClick={onOpenNotifications}
              >
                <Bell className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Notifications</TooltipContent>
          </Tooltip>
        )}
        {/* Same avatar popover trigger as the navigation rail (NavUser) and same settings
            button as the studio shell. On macOS the avatar sits top-right with settings
            behind it; elsewhere settings sit top-right with the avatar behind. */}
        {isMac ? (
          <>
            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                title={settingsActive ? "Close settings" : "Settings"}
                aria-label="Settings"
                className="flex h-7 w-7 items-center justify-center rounded-full border border-studio-border bg-background/15 hover:bg-background/25 transition-colors no-drag"
              >
                <Settings
                  className={`w-3.5 h-3.5 ${settingsActive ? "text-foreground" : "text-muted-foreground/60"}`}
                />
              </button>
            )}
            {user && (
              <NavUser
                name={userName}
                email={user?.email}
                avatar={user?.avatar}
                dropdownAlign="end"
                dropdownSide="bottom"
              />
            )}
          </>
        ) : (
          <>
            {user && (
              <NavUser
                name={userName}
                email={user?.email}
                avatar={user?.avatar}
                dropdownAlign="end"
                dropdownSide="bottom"
              />
            )}
            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                title={settingsActive ? "Close settings" : "Settings"}
                aria-label="Settings"
                className="flex h-7 w-7 items-center justify-center rounded-full border border-studio-border bg-background/15 hover:bg-background/25 transition-colors no-drag"
              >
                <Settings
                  className={`w-3.5 h-3.5 ${settingsActive ? "text-foreground" : "text-muted-foreground/60"}`}
                />
              </button>
            )}
          </>
        )}
        {canUseDesktop && !isMac && (
          <WindowControls
            isMaximized={isMaximized}
            onMinimize={() => sendWindowAction("minimize")}
            onMaximizeToggle={() => sendWindowAction("maximize-toggle")}
            onClose={() => sendWindowAction("close")}
            wayland={isLinuxCloseOnly}
          />
        )}
      </div>
    </header>
  );
}
