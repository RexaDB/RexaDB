import type { ReactNode } from "react";
import {
	DatabaseIcon,
	BarChart3Icon,
	SettingsIcon,
} from "lucide-react";

export type SidebarNavItem = {
	title: string;
	path?: string;
	icon?: ReactNode;
	isActive?: boolean;
	subItems?: SidebarNavItem[];
};

export type SidebarNavGroup = {
	label?: string;
	items: SidebarNavItem[];
};

export type AppTabKind = "connections" | "analytics" | "settings" | "supabase" | "spacetimedb";

export type AppHeaderTabsProps = {
	/** Signed-in user displayed in the account menu. */
	user?: { name?: string; email?: string };
	tabs?: AppTab[];
	activeTabId?: string;
	onActivateTab?: (id: string) => void;
	onCloseTab?: (id: string) => void;
	onNewTab?: () => void;
	/** Navigation helpers shown in the tab list when the sidebar is collapsed. */
	onBack?: () => void;
	onForward?: () => void;
	canBack?: boolean;
	canForward?: boolean;
	onHome?: () => void;
	showHome?: boolean;
};

/** An open tab in the AppShell header strip. `id` is unique per open view. */
export type AppTab = {
	id: string;
	kind: AppTabKind;
	title: string;
	connectionId?: number | null;
	connectionType?: string | null;
	/** Optional explicit icon (used when the tab isn't a connections/analytics kind). */
	icon?: ReactNode;
};

/**
 * Sections for the connections workspace. `path` doubles as the section id
 * passed to `onNavigate` (see AppShell / AppSidebar).
 */
export const navGroups: SidebarNavGroup[] = [
	{
		items: [
			{
				title: "Connections",
				path: "connections",
				icon: <DatabaseIcon />,
				isActive: true,
			},
			{
				title: "Supabase",
				path: "supabase",
				icon: <DatabaseIcon />,
			},
		],
	},
	{
		label: "Insights",
		items: [
			{
				title: "Analytics",
				path: "analytics",
				icon: <BarChart3Icon />,
			},
		],
	},
];

export const footerNavLinks: SidebarNavItem[] = [
	{
		title: "Settings",
		path: "settings",
		icon: <SettingsIcon />,
	},
];

export const navLinks: SidebarNavItem[] = [
	...navGroups.flatMap((group) =>
		group.items.flatMap((item) =>
			item.subItems?.length ? [item, ...item.subItems] : [item]
		)
	),
	...footerNavLinks,
];
