import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import type { SidebarNavGroup, SidebarNavItem } from "@/components/app-shell/app-shared";
import { ChevronRightIcon } from "lucide-react";

type NavGroupProps = SidebarNavGroup & {
	/** Currently active section id (matches an item `path`). */
	activePath?: string;
	/** When provided, items navigate via callback instead of `<a href>`. */
	onNavigate?: (path: string) => void;
	/** Extra classes applied to every menu button (e.g. to flatten active bg). */
	itemClassName?: string;
};

export function NavGroup({
	label,
	items,
	activePath,
	onNavigate,
	itemClassName,
}: NavGroupProps) {
	const isItemActive = (item: SidebarNavItem) =>
		activePath !== undefined ? item.path === activePath : !!item.isActive;

	return (
		<SidebarGroup>
			{label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
			<SidebarMenu>
				{items.map((item) => (
					<Collapsible
						asChild
						className="group/collapsible"
						defaultOpen={
							isItemActive(item) ||
							item.subItems?.some((i) => isItemActive(i))
						}
						key={item.title}
					>
						<SidebarMenuItem>
							{item.subItems?.length ? (
								<>
									<CollapsibleTrigger asChild>
										<SidebarMenuButton
											className={itemClassName}
											isActive={isItemActive(item)}
										>
											{item.icon}
											<span>{item.title}</span>
											<ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
										</SidebarMenuButton>
									</CollapsibleTrigger>
									<CollapsibleContent>
										<SidebarMenuSub>
											{item.subItems?.map((subItem) => (
												<SidebarMenuSubItem key={subItem.title}>
													<SidebarMenuSubButton
														asChild={!onNavigate}
														isActive={isItemActive(subItem)}
														onClick={
															onNavigate && subItem.path
																? () => onNavigate(subItem.path!)
																: undefined
														}
													>
														{onNavigate ? (
															<>
																{subItem.icon}
																<span>{subItem.title}</span>
															</>
														) : (
															<a href={subItem.path}>
																{subItem.icon}
																<span>{subItem.title}</span>
															</a>
														)}
													</SidebarMenuSubButton>
												</SidebarMenuSubItem>
											))}
										</SidebarMenuSub>
									</CollapsibleContent>
								</>
							) : (
								<SidebarMenuButton
									asChild={!onNavigate}
									className={itemClassName}
									isActive={isItemActive(item)}
									onClick={
										onNavigate && item.path
											? () => onNavigate(item.path!)
											: undefined
									}
								>
									{onNavigate ? (
										<>
											{item.icon}
											<span>{item.title}</span>
										</>
									) : (
										<a href={item.path}>
											{item.icon}
											<span>{item.title}</span>
										</a>
									)}
								</SidebarMenuButton>
							)}
						</SidebarMenuItem>
					</Collapsible>
				))}
			</SidebarMenu>
		</SidebarGroup>
	);
}
