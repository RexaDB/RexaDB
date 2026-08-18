"use client";

import { Fragment } from "react";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { NavUser } from "@/components/navigation/nav-user";
import { ProviderLogo, SpacetimeDbBrandImage } from "@/components/shared/provider-logo";
import type { AppTab, AppHeaderTabsProps } from "@/components/app-shell/app-shared";
import { NavigationControls } from "@/components/navigation/navigation-controls";
import { WindowControls } from "@/components/shared/window-controls";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSidebar } from "@/components/ui/sidebar";
import { useDesktopWindow } from "@/hooks/use-desktop-window";
import {
	PlusIcon,
	XIcon,
	DatabaseIcon,
	BarChart3Icon,
	SettingsIcon,
	PanelLeft,
	SquareTerminal,
	Columns2,
	SquareX,
} from "lucide-react";
import {
	House,
} from "@/lib/icon-theme/solar-icons";

function TabIcon({ tab }: { tab: AppTab }) {
	if (tab.icon) return <>{tab.icon}</>;
	if (tab.kind === "analytics") {
		return tab.connectionType ? (
			<ProviderLogo type={tab.connectionType} className="size-4" />
		) : (
			<BarChart3Icon className="size-4" />
		);
	}
	if (tab.kind === "settings") return <SettingsIcon className="size-4" />;
	if (tab.kind === "supabase") {
		return (
			<Image
				src="/providers/supabase.png"
				alt=""
				width={16}
				height={16}
				className="size-4 rounded-[3px] object-contain"
			/>
		);
	}
	if (tab.kind === "spacetimedb") {
		return <SpacetimeDbBrandImage className="size-4" />;
	}
	return <DatabaseIcon className="size-4" />;
}

export type AppHeaderProps = AppHeaderTabsProps & {
	onSelectTab?: (id: string) => void;
	/**
	 * Left inset reserved for the macOS traffic lights when the sidebar is
	 * collapsed. Override with 0 when another element (e.g. a nav rail) already
	 * occupies that strip.
	 */
	macTrafficLightInset?: number;
	/** Hide the user avatar from the tab strip (e.g. when a nav rail owns it). */
	hideUserAvatar?: boolean;
	/** Content rendered in the center of the header (e.g. a search bar). */
	headerCenter?: React.ReactNode;
	/** Toggle the bottom panel (Modern UI / VS Code-style panel). */
	onTogglePanel?: () => void;
	panelOpen?: boolean;
	/** Toggle the primary sidebar. */
	onToggleSidebar?: () => void;
	sidebarOpen?: boolean;
	/** Split the active pane (mirrors the classic tab bar's Split Pane action). */
	onSplitPane?: () => void;
	/** Close the active pane (shown only when a pane split is active). */
	onClosePane?: () => void;
	/** Extra classes merged onto the header element. */
	className?: string;
	/**
	 * When false, this strip is not a window drag/titlebar region (double-click
	 * will not maximize). Use false in Modern UI — only the floating title bar
	 * should act as the macOS titlebar. Defaults to true.
	 */
	windowDragRegion?: boolean;
};

export function AppHeader({
	user,
	tabs = [],
	activeTabId,
	onActivateTab,
	onCloseTab,
	onNewTab,
	onBack,
	onForward,
	canBack,
	canForward,
	onHome,
	showHome = true,
	onSelectTab,
	macTrafficLightInset = 72,
	hideUserAvatar = false,
	headerCenter,
	onTogglePanel,
	panelOpen,
	onToggleSidebar,
	sidebarOpen,
	onSplitPane,
	onClosePane,
	className,
	windowDragRegion = true,
}: AppHeaderProps) {
	const { state: sidebarState } = useSidebar();
	const { isMaximized, sendWindowAction, canUseDesktop, isMac, isWindows, isLinuxCloseOnly } = useDesktopWindow();
	const sidebarCollapsed = sidebarState === "collapsed";
	const windowsFrameInset = isWindows ? "var(--tauri-frame-controls-width, 138px)" : undefined;
	const trafficLightInset = isMac ? macTrafficLightInset : 0;

	return (
		<header
			className={cn(
				// h-9 + p-1 matches tab height (h-7) so left/right inset equals top/bottom.
				"relative sticky top-0 z-50 flex h-9 shrink-0 items-center justify-between gap-1 p-1",
				windowDragRegion && isWindows && "app-drag-region",
				className
			)}
			data-tauri-drag-region={windowDragRegion ? "deep" : "false"}
			style={
				trafficLightInset && sidebarCollapsed
					? { paddingLeft: `${trafficLightInset}px` }
					: windowsFrameInset
						? { paddingRight: windowsFrameInset }
						: undefined
			}
		>
			{!isMac && !hideUserAvatar && sidebarCollapsed && (
				<div className="flex items-center gap-2 pr-1">
					<NavUser name={user?.name} email={user?.email} />
				</div>
			)}
			<div className="flex min-w-0 flex-1 items-center gap-1">
				<div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-hide">
					{sidebarCollapsed && tabs.length > 0 && (
						<>
							{showHome && (
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											aria-label="Home"
											className="size-7 rounded-full text-muted-foreground hover:bg-[var(--shell-content-bg)] hover:text-foreground"
											size="icon-sm"
											variant="ghost"
											onClick={onHome}
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
								tooltipLabel="Frequently viewed"
							/>
						</>
					)}
					{tabs.map((tab, index) => {
						const active = tab.id === activeTabId;
						const newPaneGroup =
							tab.paneId &&
							index > 0 &&
							tabs[index - 1].paneId !== tab.paneId;
						return (
							<Fragment key={tab.id}>
								{newPaneGroup && (
									<div className="mx-1.5 h-4 w-px shrink-0 self-center bg-foreground/30" />
								)}
								<div
									onClick={() => onActivateTab?.(tab.id)}
									className={cn(
										"group flex h-7 min-w-24 max-w-52 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs transition-colors shrink-0 select-none",
										active
											? "bg-studio-tab-active text-foreground"
											: "bg-black/5 dark:bg-white/[0.07] text-muted-foreground hover:bg-black/10 hover:text-foreground dark:hover:bg-white/[0.12]"
									)}
								>
									<TabIcon tab={tab} />
									<span className="flex-1 truncate">{tab.title}</span>
									<button
										type="button"
										aria-label="Close tab"
										onClick={(e) => {
											e.stopPropagation();
											onCloseTab?.(tab.id);
										}}
										className={cn(
											"flex size-4 shrink-0 items-center justify-center rounded transition-opacity hover:bg-white/10",
											active
												? "opacity-70 hover:opacity-100"
												: "opacity-0 group-hover:opacity-100"
										)}
									>
										<XIcon className="size-3" />
									</button>
								</div>
							</Fragment>
						);
					})}
					<Button
						aria-label="New tab"
						className="size-6 shrink-0 text-muted-foreground"
						onClick={onNewTab}
						size="icon-sm"
						variant="ghost"
					>
						<PlusIcon />
					</Button>
				</div>
				{(onSplitPane || onClosePane) && (
					<div className="flex shrink-0 items-center gap-0.5">
						{onSplitPane && (
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										aria-label="Split pane"
										className="size-6 shrink-0 text-muted-foreground"
										onClick={onSplitPane}
										size="icon-sm"
										variant="ghost"
									>
										<Columns2 />
									</Button>
								</TooltipTrigger>
								<TooltipContent side="bottom">Split Pane</TooltipContent>
							</Tooltip>
						)}
						{onClosePane && (
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										aria-label="Close pane"
										className="size-6 shrink-0 text-muted-foreground"
										onClick={onClosePane}
										size="icon-sm"
										variant="ghost"
									>
										<SquareX />
									</Button>
								</TooltipTrigger>
								<TooltipContent side="bottom">Close Pane</TooltipContent>
							</Tooltip>
						)}
					</div>
				)}
			</div>
			{headerCenter && (
				<div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
					<div className="pointer-events-auto">{headerCenter}</div>
				</div>
			)}
			<div className="flex items-center gap-2">
				{onToggleSidebar && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								aria-label="Toggle sidebar"
								className={cn(
									"size-7 rounded-full text-muted-foreground hover:bg-[var(--shell-content-bg)] hover:text-foreground",
									sidebarOpen && "bg-[var(--shell-content-bg)] text-foreground",
								)}
								size="icon-sm"
								variant="ghost"
								onClick={onToggleSidebar}
							>
								<PanelLeft className="size-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom">Toggle Sidebar</TooltipContent>
					</Tooltip>
				)}
				{onTogglePanel && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								aria-label="Toggle panel"
								className={cn(
									"size-7 rounded-full text-muted-foreground hover:bg-[var(--shell-content-bg)] hover:text-foreground",
									panelOpen && "bg-[var(--shell-content-bg)] text-foreground",
								)}
								size="icon-sm"
								variant="ghost"
								onClick={onTogglePanel}
							>
								<SquareTerminal className="size-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom">Toggle Panel</TooltipContent>
					</Tooltip>
				)}
				{isMac && !hideUserAvatar && (
					<NavUser name={user?.name} email={user?.email} />
				)}
				{canUseDesktop && !isMac && !isWindows && (
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
