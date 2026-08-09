import { useMemo } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AppHeader } from "@/components/app-shell/app-header";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import type { AppHeaderTabsProps } from "@/components/app-shell/app-shared";
import type { Connection } from "@/lib/db/schema";
import { Sparkles, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslucentShell } from "@/hooks/use-translucent-shell";

export type AppShellProps = {
	children: React.ReactNode;
	/** Active section id (matches a nav item `path`). */
	activePath?: string;
	/** Called with a section id when a nav item is selected. */
	onNavigate?: (path: string) => void;
	/** Called when the sidebar "New Connection" action is pressed. */
	onNewConnection?: () => void;
	/** Analytics: currently selected connection (drives the sidebar picker). */
	selectedConnectionId?: number | null;
	/** Analytics: called when a connection is picked in the sidebar. */
	onSelectConnection?: (id: number, name?: string, type?: string | null) => void;
	/** Connections shown in the sidebar's Analytics list. */
	connections?: Connection[];
	/** Custom sidebar body. When set, replaces the default connections nav (the
	 *  traffic-light controls header is kept). Used by the studio "New Layout". */
	sidebarContent?: React.ReactNode;
	/** Controlled sidebar open state. */
	sidebarOpen?: boolean;
	/** Called when the sidebar open state changes. */
	onSidebarOpenChange?: (open: boolean) => void;
	/** Bottom-bar actions (Linear-style, bottom-right of content panel) */
	onAskAI?: () => void;
	isAskAIOpen?: boolean;
	onQueryHistory?: () => void;
	// Background noise
	noiseBgEnabled?: boolean;
	noiseBgOpacity?: number;
	noiseBgSize?: number;
	noiseBgBlendMode?: "overlay" | "soft-light" | "multiply" | "screen";
	noiseBgColor?: string;
	noiseBgTranslucent?: boolean;
} & AppHeaderTabsProps;

export function AppShell({
	children,
	activePath,
	onNavigate,
	onNewConnection,
	selectedConnectionId,
	onSelectConnection,
	connections,
	sidebarContent,
	sidebarOpen,
	onSidebarOpenChange,
	user,
	tabs,
	activeTabId,
	onActivateTab,
	onCloseTab,
	onNewTab,
	onBack,
	onForward,
	canBack,
	canForward,
	onHome,
	showHome,
	onAskAI,
	isAskAIOpen,
	onQueryHistory,
	noiseBgEnabled,
	noiseBgOpacity = 30,
	noiseBgSize = 50,
	noiseBgBlendMode = "overlay",
	noiseBgColor = "#000000",
	noiseBgTranslucent,
}: AppShellProps) {
	useTranslucentShell(noiseBgTranslucent);

	const noiseDataUri = useMemo(() => {
		if (!noiseBgEnabled) return "";
		const freq = (0.111 * Math.pow(10, noiseBgSize / 50)).toFixed(4);
		const r = parseInt(noiseBgColor.slice(1, 3), 16) / 255;
		const g = parseInt(noiseBgColor.slice(3, 5), 16) / 255;
		const b = parseInt(noiseBgColor.slice(5, 7), 16) / 255;
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
			<filter id="n" color-interpolation-filters="sRGB">
				<feTurbulence type="fractalNoise" baseFrequency="${freq} ${freq}" stitchTiles="stitch" numOctaves="3" result="noise"/>
				<feComponentTransfer in="noise" result="stretched">
					<feFuncR type="linear" slope="2" intercept="-0.5"/>
					<feFuncG type="linear" slope="2" intercept="-0.5"/>
					<feFuncB type="linear" slope="2" intercept="-0.5"/>
				</feComponentTransfer>
				<feComponentTransfer in="stretched" result="sparse">
					<feFuncA type="discrete" tableValues="1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0"/>
				</feComponentTransfer>
				<feColorMatrix type="matrix" in="sparse" values="
					0 0 0 0 ${r}
					0 0 0 0 ${g}
					0 0 0 0 ${b}
					0 0 0 0.25 0
				"/>
			</filter>
			<rect width="100%" height="100%" filter="url(#n)"/>
		</svg>`;
		return `url("data:image/svg+xml;base64,${btoa(svg)}")`;
	}, [noiseBgEnabled, noiseBgSize, noiseBgColor]);

	return (
		<div className="overflow-hidden" data-translucent={noiseBgTranslucent ? "" : undefined}>
			<TooltipProvider>
			<SidebarProvider className="relative h-svh" open={sidebarOpen} onOpenChange={onSidebarOpenChange}>
				{noiseBgEnabled && (
					<div
						className="pointer-events-none absolute inset-0 z-0"
						style={{
							backgroundImage: noiseDataUri,
							backgroundRepeat: "repeat",
							backgroundSize: "200px",
							opacity: noiseBgOpacity / 100,
							mixBlendMode: noiseBgBlendMode,
						} as React.CSSProperties}
					/>
				)}
				<AppSidebar
					activePath={activePath}
					onNavigate={onNavigate}
					onNewConnection={onNewConnection}
					selectedConnectionId={selectedConnectionId}
					onSelectConnection={onSelectConnection}
					connections={connections}
					content={sidebarContent}
					onBack={onBack}
					onForward={onForward}
					canBack={canBack}
					canForward={canForward}
					onHome={onHome}
					showHome={showHome}
					tabs={tabs}
					onSelectTab={onActivateTab}
					user={user}
				/>
				<SidebarInset className="overflow-hidden bg-transparent md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:mt-1 md:peer-data-[variant=inset]:mb-0 md:peer-data-[variant=inset]:shadow-none">
				{/* Tabs sit on the outer surface, above the content panel (Linear-style) */}
				<AppHeader
					user={user}
					tabs={tabs}
					activeTabId={activeTabId}
					onActivateTab={onActivateTab}
					onCloseTab={onCloseTab}
					onNewTab={onNewTab}
					onBack={onBack}
					onForward={onForward}
					canBack={canBack}
					canForward={canForward}
					onHome={onHome}
					showHome={showHome}
					onSelectTab={onActivateTab}
				/>
					<div
						className="content-panel-surface mx-2 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border"
						style={
							{
								"--background": "var(--shell-content-bg)",
								"--studio-bg": "var(--shell-content-bg)",
								backgroundColor: "var(--shell-content-bg)",
							} as React.CSSProperties
						}
					>
						{children}
					</div>
					{/* Always reserve the same bottom strip as studio (Ask AI / history bar height). */}
					<div className="flex h-8 shrink-0 items-center justify-end gap-0.5 px-3">
						{onAskAI && (
							<button
								type="button"
								onClick={onAskAI}
								className={cn(
									"flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-all hover:bg-white/8 hover:text-foreground",
									isAskAIOpen ? "bg-white/8 text-foreground" : "text-muted-foreground/60",
								)}
							>
								<Sparkles className="size-3" />
								Ask AI
							</button>
						)}
						{onQueryHistory && (
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										onClick={onQueryHistory}
										className="flex size-6 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:text-foreground"
									>
										<Clock className="size-3" />
									</button>
								</TooltipTrigger>
								<TooltipContent side="top">Query history</TooltipContent>
							</Tooltip>
						)}
					</div>
				</SidebarInset>
			</SidebarProvider>
			</TooltipProvider>
		</div>
	);
}
