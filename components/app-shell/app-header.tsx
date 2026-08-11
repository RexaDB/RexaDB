"use client";

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
}: AppHeaderProps) {
	const { state: sidebarState } = useSidebar();
	const { isMaximized, sendWindowAction, canUseDesktop, isMac, isWindows, isLinuxCloseOnly } = useDesktopWindow();
	const sidebarCollapsed = sidebarState === "collapsed";
	const macTrafficLightInset = isMac ? 72 : 0;
	const windowsFrameInset = isWindows ? "var(--tauri-frame-controls-width, 138px)" : undefined;

	return (
		<header
			className={cn(
				"sticky top-0 z-50 flex h-9 shrink-0 items-center justify-between gap-2 px-2",
				isWindows && "app-drag-region"
			)}
			data-tauri-drag-region="deep"
			style={
				macTrafficLightInset && sidebarCollapsed
					? { paddingLeft: `${macTrafficLightInset}px` }
					: windowsFrameInset
						? { paddingRight: windowsFrameInset }
						: undefined
			}
		>
			{!isMac && sidebarCollapsed && (
				<div className="flex items-center gap-2 pr-1">
					<NavUser name={user?.name} email={user?.email} />
				</div>
			)}
			<div className="flex min-w-0 flex-1 items-center gap-2">
				<div className="flex min-w-0 items-center gap-1 overflow-x-auto scrollbar-hide -mt-0.5">
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
					{tabs.map((tab) => {
						const active = tab.id === activeTabId;
						return (
							<div
								key={tab.id}
								onClick={() => onActivateTab?.(tab.id)}
								className={cn(
									"group flex h-7 min-w-24 max-w-52 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs transition-colors shrink-0 select-none",
									active
										? "bg-[var(--shell-tab-active-bg)] text-foreground"
										: "bg-[var(--shell-tab-inactive-bg)] text-muted-foreground hover:text-foreground"
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
			</div>
			<div className="flex items-center gap-2">
				{isMac && (
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
