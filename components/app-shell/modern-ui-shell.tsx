// fallow-ignore-file code-duplication
"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppHeader } from "@/components/app-shell/app-header";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import type { AppHeaderTabsProps } from "@/components/app-shell/app-shared";
import { useTranslucentShell } from "@/hooks/use-translucent-shell";
import { ModernUIRail, type ModernUIRailItem } from "@/components/app-shell/modern-ui-rail";
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "@/components/ui/dialog";
import { SettingsView } from "@/components/studio/settings-view";
import { ModernSqlEditorPanel } from "@/components/app-shell/modern-sql-editor-panel";
import { ModernVscodeHeader } from "@/components/app-shell/modern-vscode-header";
import { ModernStatusBar } from "@/components/app-shell/modern-status-bar";
import { ResizeHandle } from "@/components/app-shell/resize-handle";
import { SheetDockContext } from "@/components/ui/sheet";
import { buildShortcutCombo } from "@/lib/studio/keybindings";

/**
 * The studio's "Modern UI" layout: a self-contained copy of the AppShell
 * chrome ("New Layout") plus an always-visible navigation rail on the far
 * left. Kept as its own component so it can diverge from the New Layout
 * without affecting it.
 */
export type ModernUIShellProps = {
	children: React.ReactNode;
	/** Studio state used to drive the navigation rail. */
	studio: any;
	/** Local-only connection switch handler for the title-bar connection
	 *  dropdown. When omitted, the dropdown navigates to `/studio/{id}`. */
	onHeaderSelectConnection?: (conn: import("@/lib/db/schema").Connection) => void | Promise<void>;
	/** Custom sidebar body. When set, replaces the default connections nav. */
	sidebarContent?: React.ReactNode;
	/** Active section id for the default sidebar body (when `sidebarContent`
	 *  is omitted), e.g. "connections" | "analytics" | "settings". */
	activePath?: string;
	/** Called with a section id when a default-sidebar nav item is selected. */
	onNavigate?: (path: string) => void;
	/** Called when the default sidebar's "New Connection" action is pressed. */
	onNewConnection?: () => void;
	/** Default sidebar: currently selected connection (drives the picker). */
	selectedConnectionId?: number | null;
	/** Default sidebar: called when a connection is picked in the list. */
	onSelectConnection?: (id: number, name?: string, type?: string | null) => void;
	/** Connections shown in the default sidebar's list. */
	connections?: import("@/lib/db/schema").Connection[];
	/** AI chat panel rendered as an in-flow column to the right of the content
	 *  card. It pushes/squeezes the content card like the app sidebar does. */
	aiChatPanel?: React.ReactNode;
	/** Called when the Agents button is clicked (opens agents in a new window). */
	onAgentsClick?: () => void;
	/** SQL editor sheet (Cmd+E) rendered as an in-flow column like the AI chat. */
	sqlSheetPanel?: React.ReactNode;
	/** Controlled SQL sheet open state. */
	isSqlSheetOpen?: boolean;
	/** AI threads sidebar rendered like the AI chat panel (in-flow column to the
	 *  right, pushing the content card). Shows the saved AI chats for the
	 *  current connection. */
	threadsPanel?: React.ReactNode;
	/** Controlled threads sidebar open state. */
	threadsOpen?: boolean;
	/** Called when the threads sidebar open state changes (footer button). */
	onToggleThreads?: () => void;
	/** Controlled sidebar open state. */
	sidebarOpen?: boolean;
	/** Called when the sidebar open state changes. */
	onSidebarOpenChange?: (open: boolean) => void;
	/** Bottom-bar actions (Linear-style, bottom-right of content panel) */
	onAskAI?: () => void;
	isAskAIOpen?: boolean;
	onQueryHistory?: () => void;
	/** Opens the Cmd+K command menu (header search bar). */
	onOpenSearch?: () => void;
	/** User keybindings so the layout controls show real, custom combos. */
	keybindings?: Record<string, any>;
	/** Overrides the rail's studio-derived nav items (dashboard/tables/sql/...)
	 *  with a custom set. Used by surfaces with no active studio connection,
	 *  e.g. the connections list. */
	railItems?: ModernUIRailItem[];
	/** Highlighted item id when `railItems` is provided. */
	railActiveId?: string | null;
	/** Overrides the rail's bottom "Settings" item to route elsewhere instead
	 *  of the built-in studio SettingsView dialog. */
	onSettingsClick?: () => void;
	/** Highlights the rail's "Settings" item when routing via `onSettingsClick`. */
	settingsActive?: boolean;
	/** Skips rendering the built-in settings Dialog. Set by callers (like
	 *  StudioInterface) that render their own settings Dialog as a sibling
	 *  outside the shell, so it keeps the same position in the tree — and
	 *  doesn't get remounted — when the layout switches away from Modern UI. */
	hideSettingsDialog?: boolean;
	/** Shows the rail's bottom "Home" item. Defaults to true. */
	railShowHome?: boolean;
	/** Shows the rail's bottom "Workspace" item. Defaults to true. */
	railShowWorkspace?: boolean;
	/** Whether the bottom "SQL Editor" panel (Cmd+J) is available. It renders
	 *  `<ModernSqlEditorPanel studio={studio} />`, which needs a full studio
	 *  session (query execution, snippets, etc.) — disable on surfaces with no
	 *  active studio connection, e.g. the connections list, to avoid crashing
	 *  on `studio.connection.id`. Defaults to true. */
	enableBottomSqlPanel?: boolean;
	// Background noise
	noiseBgEnabled?: boolean;
	noiseBgOpacity?: number;
	noiseBgSize?: number;
	noiseBgBlendMode?: "overlay" | "soft-light" | "multiply" | "screen";
	noiseBgColor?: string;
	noiseBgTranslucent?: boolean;
} & AppHeaderTabsProps;

export function ModernUIShell({
	children,
	studio,
	onHeaderSelectConnection,
	sidebarContent,
	activePath,
	onNavigate,
	onNewConnection,
	selectedConnectionId,
	onSelectConnection,
	connections,
	aiChatPanel,
	onAgentsClick,
	sqlSheetPanel,
	isSqlSheetOpen,
	threadsPanel,
	threadsOpen,
	onToggleThreads,
	sidebarOpen,
	onSidebarOpenChange,
	user,
	tabs,
	activeTabId,
	onActivateTab,
	onCloseTab,
	onReorderTab,
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
	onOpenSearch,
	keybindings,
	railItems,
	railActiveId,
	onSettingsClick,
	settingsActive,
	hideSettingsDialog,
	railShowHome = true,
	railShowWorkspace = true,
	enableBottomSqlPanel = true,
	noiseBgEnabled,
	noiseBgOpacity = 30,
	noiseBgSize = 50,
	noiseBgBlendMode = "overlay",
	noiseBgColor = "#000000",
	noiseBgTranslucent,
}: ModernUIShellProps) {
	useTranslucentShell(noiseBgTranslucent);

	const [panelOpen, setPanelOpen] = useState(false);
	const [activityBarOpen, setActivityBarOpen] = useState(true);
	const [statusBarOpen, setStatusBarOpen] = useState(true);
	// The main studio session shares its settings-modal state (`use-studio.ts`)
	// so Cmd+, and other "open settings" actions outside this component (e.g.
	// the sidebar's Settings row) open the same modal instead of a separate one.
	// Surfaces without a full studio session (e.g. the connections list) fall
	// back to local state.
	const [localSettingsOpen, setLocalSettingsOpen] = useState(false);
	const hasControlledSettingsModal = typeof studio?.setSettingsModalOpen === "function";
	const settingsOpen = hasControlledSettingsModal ? !!studio.settingsModalOpen : localSettingsOpen;
	const setSettingsOpen = hasControlledSettingsModal ? studio.setSettingsModalOpen : setLocalSettingsOpen;
	const [sidebarWidth, setSidebarWidth] = useState(256);
	const [aiWidth, setAiWidth] = useState(400);
	const [sqlSheetWidth, setSqlSheetWidth] = useState(480);
	const [threadsWidth, setThreadsWidth] = useState(300);
	const [sqlEditorHeight, setSqlEditorHeight] = useState(240);
	const rootRef = useRef<HTMLDivElement | null>(null);
	const cardRef = useRef<HTMLDivElement | null>(null);
	// DOM node for `contained` sheets (Insert Row, Add Column, etc.) to portal
	// into, so they dock as an in-flow column next to the content card instead
	// of floating over it — same treatment as the AI chat / SQL / threads
	// panels below. State (not a plain ref) so SheetDockContext re-renders
	// consumers once the node exists.
	const [dockContainer, setDockContainer] = useState<HTMLDivElement | null>(null);
	// Height of the strip between the window top and the content card. Measured
	// so the floating title bar (and its search bar) stays vertically centered
	// in that strip without hard-coding a value.
	// Default matches the content/sidebar top inset (mt-8 / pt-8 = 32px).
	const [titleBarHeight, setTitleBarHeight] = useState(32);

	useLayoutEffect(() => {
		const measure = () => {
			const root = rootRef.current;
			const card = cardRef.current;
			if (!root || !card) return;
			const rootRect = root.getBoundingClientRect();
			const cardRect = card.getBoundingClientRect();
			setTitleBarHeight(
				Math.max(0, Math.round(cardRect.top - rootRect.top)),
			);
		};
		measure();
		const observer = new ResizeObserver(measure);
		if (cardRef.current) observer.observe(cardRef.current);
		window.addEventListener("resize", measure);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, []);

	// Layout chrome shortcuts — always resolve via the user's keybindings map
	// (pressed combo → binding.type) so remapped shortcuts work. Capture phase
	// so we can handle the Modern UI panel without also opening the legacy sheet.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const combo = buildShortcutCombo(event);
			if (!combo || !keybindings) return;
			const binding = keybindings[combo];
			if (!binding) return;

			switch (binding.type) {
				// Bottom panel is separate from the floating SQL sheet
				// (TOGGLE_GLOBAL_SQL_PANEL / Cmd+E).
				case "TOGGLE_BOTTOM_PANEL":
					if (!enableBottomSqlPanel) break;
					event.preventDefault();
					event.stopImmediatePropagation();
					setPanelOpen((open) => !open);
					break;
				case "TOGGLE_ACTIVITY_BAR":
					event.preventDefault();
					event.stopImmediatePropagation();
					setActivityBarOpen((open) => !open);
					break;
				case "TOGGLE_STATUS_BAR":
					event.preventDefault();
					event.stopImmediatePropagation();
					setStatusBarOpen((open) => !open);
					break;
				default:
					break;
			}
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [keybindings, enableBottomSqlPanel]);

	const handleAiResizeStart = (e: React.MouseEvent) => {
		e.preventDefault();
		const startX = e.clientX;
		const startWidth = aiWidth;

		const onMouseMove = (ev: MouseEvent) => {
			const next = Math.min(700, Math.max(320, startWidth + (startX - ev.clientX)));
			setAiWidth(next);
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

	const handleSqlSheetResizeStart = (e: React.MouseEvent) => {
		e.preventDefault();
		const startX = e.clientX;
		const startWidth = sqlSheetWidth;

		const onMouseMove = (ev: MouseEvent) => {
			const next = Math.min(800, Math.max(360, startWidth + (startX - ev.clientX)));
			setSqlSheetWidth(next);
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

	const handleThreadsResizeStart = (e: React.MouseEvent) => {
		e.preventDefault();
		const startX = e.clientX;
		const startWidth = threadsWidth;

		const onMouseMove = (ev: MouseEvent) => {
			const next = Math.min(500, Math.max(220, startWidth + (startX - ev.clientX)));
			setThreadsWidth(next);
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

	const handleSqlEditorResizeStart = (e: React.MouseEvent) => {
		e.preventDefault();
		const startY = e.clientY;
		const startHeight = sqlEditorHeight;

		const onMouseMove = (ev: MouseEvent) => {
			const next = Math.min(600, Math.max(120, startHeight + (startY - ev.clientY)));
			setSqlEditorHeight(next);
		};

		const onMouseUp = () => {
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
		};

		document.body.style.cursor = "row-resize";
		document.body.style.userSelect = "none";
		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
	};

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
					<feFuncA type="discrete" tableValues="1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0"/>
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
		<SheetDockContext.Provider value={dockContainer}>
		<div className="overflow-hidden" data-translucent={noiseBgTranslucent ? "" : undefined}>
			<TooltipProvider>
			<div className="relative flex h-svh min-w-0 flex-col bg-sidebar" ref={rootRef}>
				{/* VS Code-style title bar: floats transparently over the top strip
				    without taking layout space, so nothing gets pushed down. */}
				<ModernVscodeHeader
					height={titleBarHeight}
					onOpenSearch={onOpenSearch}
					keybindings={keybindings}
					activityBarOpen={activityBarOpen}
					onToggleActivityBar={() => setActivityBarOpen((open) => !open)}
					onTogglePanel={
						enableBottomSqlPanel ? () => setPanelOpen((open) => !open) : undefined
					}
					panelOpen={panelOpen}
					onToggleSidebar={() => onSidebarOpenChange?.(!sidebarOpen)}
					sidebarOpen={sidebarOpen}
					onToggleSecondarySidebar={onAskAI}
					secondarySidebarOpen={isAskAIOpen}
					statusBarOpen={statusBarOpen}
					onToggleStatusBar={() => setStatusBarOpen((open) => !open)}
					onBack={onBack}
					onForward={onForward}
					canBack={canBack}
					canForward={canForward}
					connection={studio?.connection ?? null}
					onSelectConnection={onHeaderSelectConnection}
				/>
				{/* Row of the rail + sidebar/content area. Grows to fill the window
				    so the footer can sit at the very bottom. When the status bar is
				    hidden, keep a small bottom inset so chrome doesn't sit flush. */}
				<div
					className={
						statusBarOpen
							? "flex min-h-0 min-w-0 flex-1 bg-sidebar"
							: "flex min-h-0 min-w-0 flex-1 bg-sidebar pb-2"
					}
				>
					{/* Always-visible navigation rail, as its own component to the left of
					    the sidebar+content parent card. Its own column is the strip
					    between the window edge and the parent card. */}
					{activityBarOpen && (
						<div className="relative z-30 h-full shrink-0">
							<ModernUIRail
								studio={studio}
								settingsOpen={settingsActive ?? settingsOpen}
								onSettingsToggle={() => setSettingsOpen((o: boolean) => !o)}
								items={railItems}
								activeId={railActiveId}
								onSettingsClick={onSettingsClick}
								showHome={railShowHome}
								showWorkspace={railShowWorkspace}
								user={user}
							/>
						</div>
					)}
					{/* The rest of the New Layout chrome. The transform re-anchors the
					    fixed sidebar to this panel so it never covers the rail. */}
				<div className="relative h-full min-w-0 flex-1 overflow-visible">
					<SidebarProvider
						className="relative h-full !min-h-0 w-full min-w-0 overflow-visible [transform:translateZ(0)] [&_[data-slot=sidebar-gap]]:transition-none"
						style={
							{
								"--sidebar-width": `${sidebarWidth}px`,
								// Shared gutter between shell cards; sash hit target matches this.
								"--shell-sash-gap": "6px",
							} as React.CSSProperties
						}
						open={sidebarOpen}
						onOpenChange={onSidebarOpenChange}
					>
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
					{/* Fixed sidebar defaults to h-svh (full viewport), which overshoots
					    once the status bar steals height. top/bottom + height:auto stretch
					    it to this transformed parent (same column as the content card).
					    pt-8 matches the content card's mt-8 top inset.
					    Right padding = --shell-sash-gap so the resize sash is centered
					    in the gutter between the sidebar card and the content card. */}
					<AppSidebar
						className="z-20 top-0 bottom-0 h-auto max-h-none overflow-visible pt-8 pb-0 pl-1.5 pr-[var(--shell-sash-gap,6px)] [&_[data-slot=sidebar-container]]:pr-[var(--shell-sash-gap,6px)] [&_[data-slot=sidebar-inner]]:relative [&_[data-slot=sidebar-inner]]:h-full [&_[data-slot=sidebar-inner]]:overflow-visible [&_[data-slot=sidebar-inner]]:bg-[var(--shell-content-bg)] [&_[data-slot=sidebar-inner]]:rounded-lg [&_[data-slot=sidebar-inner]]:border [&_[data-slot=sidebar-inner]]:border-border [&_[data-slot=sidebar-inner]]:p-1"
						style={{
							transition: "none",
							top: 0,
							// Match content column bottom; row padding already insets when
							// the status bar is hidden.
							bottom: 0,
							height: "auto",
							maxHeight: "none",
						}}
						sidebarWidth={sidebarWidth}
						onSidebarWidthChange={setSidebarWidth}
						hideHeaderControls
						activePath={activePath}
						onNavigate={onNavigate}
						onNewConnection={onNewConnection}
						selectedConnectionId={selectedConnectionId}
						onSelectConnection={onSelectConnection}
						connections={connections}
						onBack={onBack}
						onForward={onForward}
						canBack={canBack}
						canForward={canForward}
						onHome={onHome}
						showHome={showHome}
						tabs={tabs}
						onSelectTab={onActivateTab}
						user={user}
						content={sidebarContent}
					/>
					<SidebarInset className="relative z-0 h-full min-h-0 w-auto min-w-0 overflow-hidden bg-transparent md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-1 md:peer-data-[variant=inset]:mt-0 md:peer-data-[variant=inset]:mb-0 md:peer-data-[variant=inset]:shadow-none">
						{/* Horizontal row: the SQL editor panel lives BELOW the content
					    card in the left column (so it only pushes the tabs up), while
					    the AI chat panel stays a full-height column to the right. */}
						<div className="flex min-h-0 flex-1">
						{/* Left column: the card wraps the tab list and the tab content,
					    and the SQL editor panel sits below it when open. */}
						<div className="flex min-h-0 min-w-0 flex-1 flex-col">
						<div
							ref={cardRef}
							className="mt-8 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border"
							style={
								{
									"--background": "var(--shell-content-bg)",
									"--studio-bg": "var(--shell-content-bg)",
									backgroundColor: "var(--shell-content-bg)",
								} as React.CSSProperties
							}
						>
							{!studio.splitView?.enabled && (
								<AppHeader
									user={user}
									tabs={tabs}
									activeTabId={activeTabId}
									onActivateTab={onActivateTab}
									onCloseTab={onCloseTab}
									onReorderTab={onReorderTab}
									onNewTab={onNewTab}
									onBack={onBack}
									onForward={onForward}
									canBack={canBack}
									canForward={canForward}
									onHome={onHome}
									showHome={showHome}
									onSelectTab={onActivateTab}
									hideUserAvatar
									onSplitPane={() => studio.createSplit?.()}
									onClosePane={studio.splitView?.enabled ? () => studio.closeActivePane?.() : undefined}
									// The rail occupies the far-left strip on Mac, so the tab
									// strip must not reserve extra space for the traffic lights.
									macTrafficLightInset={activityBarOpen ? 0 : undefined}
									// Only the floating Modern title bar is a window drag region;
									// double-click on the tab list must not maximize.
									windowDragRegion={false}
									// The floating ModernVscodeHeader already renders window
									// controls in the top-right corner; hide the duplicate here.
									hideWindowControls
									// Modern UI's own nav rail already has a Home item; don't
									// duplicate Home/history/back/forward in the tab strip too.
									showCollapsedNavControls={false}
									// Padding lives on AppHeader (p-1) so tab inset matches all sides.
									className="border-b border-border"
								/>
							)}
							<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
								{children}
							</div>
						</div>
						{/* SQL editor panel: a bottom panel that reuses the real
					    SqlEditor. It pushes the content card up but never the AI
					    chat panel. The resize handle is the 4px strip between the
					    card and the panel. */}
						{panelOpen && enableBottomSqlPanel && (
							<>
								<ResizeHandle
									orientation="horizontal"
									onMouseDown={handleSqlEditorResizeStart}
								/>
								<div
									className="relative shrink-0 overflow-hidden rounded-lg border border-border"
									style={
										{
											height: sqlEditorHeight,
											"--background": "var(--shell-content-bg)",
											"--studio-bg": "var(--shell-content-bg)",
											"--studio-header-bg": "var(--shell-content-bg)",
											background: "var(--shell-content-bg)",
										} as React.CSSProperties
									}
								>
									<ModernSqlEditorPanel studio={studio} />
								</div>
							</>
						)}
						</div>
						{/* Docking target for `contained` sheets (Insert Row, Add Column,
					    FK picker, etc.) — each portals in its own resize handle + card.
					    `contents` so the portaled elements become direct flex items of
					    the row above (a definite-width container) rather than children
					    of a shrink-to-fit wrapper, which would make any percentage-based
					    sheet width (e.g. `w-full`) resolve against an indeterminate size. */}
						<div ref={setDockContainer} className="contents" />
						{/* SQL editor sheet (Cmd+E): same in-flow column pattern as AI chat. */}
						{isSqlSheetOpen && sqlSheetPanel && (
							<>
								<ResizeHandle
									orientation="vertical"
									onMouseDown={handleSqlSheetResizeStart}
									className="mt-8"
								/>
								<div
									className="relative mt-8 flex min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border border-border"
									style={
										{
											width: sqlSheetWidth,
											background: "var(--shell-content-bg)",
										} as React.CSSProperties
									}
								>
									{sqlSheetPanel}
								</div>
							</>
						)}
						{/* AI chat panel: an in-flow card that squeezes the content
					    card. The resize handle sits BETWEEN the two cards, spanning
					    the same height as the sidebar's handle. */}
						{isAskAIOpen && aiChatPanel && (
							<>
								<ResizeHandle
									orientation="vertical"
									onMouseDown={handleAiResizeStart}
									className="mt-8"
								/>
								<div
									className="relative mt-8 flex min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border border-border"
									style={
										{
											width: aiWidth,
											background: "var(--shell-content-bg)",
										} as React.CSSProperties
									}
								>
							{aiChatPanel}
							</div>
						</>
					)}
						{/* AI threads sidebar: same in-flow card pattern as the AI chat
					    panel, sitting further right. */}
						{threadsOpen && threadsPanel && (
							<>
								<ResizeHandle
									orientation="vertical"
									onMouseDown={handleThreadsResizeStart}
									className="mt-8"
								/>
								<div
									className="relative mt-8 flex min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border border-border"
									style={
										{
											width: threadsWidth,
											background: "var(--shell-content-bg)",
										} as React.CSSProperties
									}
								>
									{threadsPanel}
								</div>
							</>
						)}
						</div>
					</SidebarInset>
				</SidebarProvider>
				</div>
				</div>
				{/* Real footer: a VS Code-style status bar pinned to the bottom of the
				    window, spanning the full width (including under the rail). */}
				{statusBarOpen && (
					<ModernStatusBar
						studio={studio}
						isAskAIOpen={isAskAIOpen}
						onAskAI={onAskAI}
						onAgentsClick={onAgentsClick}
						onQueryHistory={onQueryHistory}
						threadsOpen={threadsOpen}
						onToggleThreads={onToggleThreads}
					/>
				)}
			</div>
			</TooltipProvider>
			{!hideSettingsDialog && (
				<Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
					<DialogContent
						hideCloseButton
						className="h-[80vh] w-[80vw] !max-w-[80vw] flex flex-col overflow-hidden p-0 duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
						overlayClassName="bg-black/40"
					>
						<DialogTitle className="sr-only">Settings</DialogTitle>
						<SettingsView studio={studio} />
					</DialogContent>
				</Dialog>
			)}
		</div>
		</SheetDockContext.Provider>
	);
}
