"use client";

import { Fragment, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sortable, SortableItem, SortableItemHandle } from "@/components/reui/sortable";
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
		return <ProviderLogo type="supabase" className="size-4" />;
	}
	if (tab.kind === "spacetimedb") {
		return <SpacetimeDbBrandImage className="size-4" />;
	}
	if (tab.kind === "neon") {
		return <ProviderLogo type="neon" className="size-4" />;
	}
	return <DatabaseIcon className="size-4" />;
}

/**
 * Splits tabs into contiguous runs sharing the same `paneId`, so each split-
 * pane group gets its own drag-reorder scope — a tab can be dragged among
 * its pane-mates, never across a pane boundary, since array order is also
 * what encodes which visual pane-group block a tab belongs to.
 */
function groupTabsByPane(tabs: AppTab[]): AppTab[][] {
	const groups: AppTab[][] = [];
	for (const tab of tabs) {
		const last = groups[groups.length - 1];
		if (last && last[0].paneId === tab.paneId) {
			last.push(tab);
		} else {
			groups.push([tab]);
		}
	}
	return groups;
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
	/**
	 * Hide the window controls (minimize/maximize/close) from this tab strip.
	 * Used in Modern UI, where the floating title bar already renders them in
	 * the top-right corner. Defaults to false.
	 */
	hideWindowControls?: boolean;
	/**
	 * Show the Home / frequently-viewed-tabs controls that appear in the tab
	 * strip when the sidebar is collapsed. Modern UI already has its own nav
	 * rail with a Home item, so this is New-Layout-only. Defaults to true.
	 */
	showCollapsedNavControls?: boolean;
};

export function AppHeader({
	user,
	tabs = [],
	activeTabId,
	onActivateTab,
	onCloseTab,
	onNewTab,
	onReorderTab,
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
	hideWindowControls = false,
	showCollapsedNavControls = true,
}: AppHeaderProps) {
	const { state: sidebarState } = useSidebar();
	const { isMaximized, sendWindowAction, canUseDesktop, isMac, isLinuxCloseOnly } = useDesktopWindow();
	const sidebarCollapsed = sidebarState === "collapsed";
	const trafficLightInset = isMac ? macTrafficLightInset : 0;
	const tabGroups = useMemo(() => groupTabsByPane(tabs), [tabs]);

	return (
		<header
			className={cn(
				// h-9 + p-1 matches tab height (h-7) so left/right inset equals top/bottom.
				"relative sticky top-0 z-50 flex h-9 shrink-0 items-center justify-between gap-1 p-1",
				windowDragRegion && "app-drag-region",
				className
			)}
			data-tauri-drag-region={windowDragRegion ? "deep" : "false"}
			style={
				trafficLightInset && sidebarCollapsed
					? { paddingLeft: `${trafficLightInset}px` }
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
					{showCollapsedNavControls && sidebarCollapsed && tabs.length > 0 && (
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
					{tabGroups.map((group, groupIndex) => (
						<Fragment key={group[0]?.id ?? groupIndex}>
							{groupIndex > 0 && (
								<div className="mx-1.5 h-4 w-px shrink-0 self-center bg-foreground/30" />
							)}
							<Sortable
								value={group}
								getItemValue={(t) => t.id}
								strategy="horizontal"
								onValueChange={() => {}}
								onMove={({ activeIndex, overIndex }) => {
									const source = group[activeIndex];
									const target = group[overIndex];
									if (source && target) onReorderTab?.(source.id, target.id);
								}}
								className="flex shrink-0 items-center gap-1.5"
							>
								{group.map((tab) => {
									const active = tab.id === activeTabId;
									return (
										<SortableItem key={tab.id} value={tab.id} className="shrink-0">
											<SortableItemHandle asChild cursor={false}>
												<div
													onClick={() => onActivateTab?.(tab.id)}
													className={cn(
														"group flex h-7 min-w-24 max-w-52 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs transition-colors select-none",
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
											</SortableItemHandle>
										</SortableItem>
									);
								})}
							</Sortable>
						</Fragment>
					))}
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
				{canUseDesktop && !isMac && !hideWindowControls && (
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
