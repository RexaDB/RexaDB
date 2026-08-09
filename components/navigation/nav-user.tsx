"use client";

import { useState, useEffect } from "react";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserIcon, LogOutIcon } from "lucide-react";
import { EditProfileModal } from "@/components/edit-profile-modal";
import type { ProfileData, PlanTier } from "@/components/edit-profile-modal";
import { getStoredUserProfile } from "@/lib/api/actions-client";
import { supabase } from "@/lib/supabase/client";
import { useEntitlementState } from "@/hooks/use-entitlement-state";

export type NavUserProps = {
	name?: string;
	email?: string;
	avatar?: string;
	dropdownAlign?: "start" | "end";
};

export function NavUser({ name, email, avatar, dropdownAlign = "end" }: NavUserProps = {}) {
	const [profileOpen, setProfileOpen] = useState(false);
	const [storedAvatar, setStoredAvatar] = useState<string | undefined>(
		typeof window !== "undefined"
			? window.localStorage.getItem("rexa-db-user-avatar") || undefined
			: undefined,
	);
	const [profile, setProfile] = useState<ProfileData>({
		fullName: name?.trim() || "User",
		email: email?.trim() || "",
		avatarUrl: storedAvatar || avatar || undefined,
		plan: "free",
	});

	const [resolvedName, setResolvedName] = useState(name?.trim() || "");
	const [resolvedEmail, setResolvedEmail] = useState(email?.trim() || "");
	const [userId, setUserId] = useState<string | null>(null);
	const [accessToken, setAccessToken] = useState<string | null>(null);
	const [isSessionActive, setIsSessionActive] = useState(false);

	useEffect(() => {
		supabase.auth.getSession().then(({ data }) => {
			const u = data.session?.user;
			if (u) {
				setUserId(u.id);
				setAccessToken(data.session!.access_token ?? null);
				setIsSessionActive(true);
				if (!name?.trim()) {
					const n =
						u.user_metadata?.full_name ||
						u.user_metadata?.name ||
						u.user_metadata?.display_name ||
						u.email?.split("@")[0] ||
						"User";
					setResolvedName(n);
				}
				if (!email?.trim() && u.email) setResolvedEmail(u.email);
			} else {
				getStoredUserProfile().then((res) => {
					if (res.success && res.data) {
						if (!name?.trim() && res.data.name) setResolvedName(res.data.name);
						if (!email?.trim() && res.data.email) setResolvedEmail(res.data.email);
					}
				}).catch(() => {});
			}
		});
	}, []);

	const { entitlement, refreshEntitlement } = useEntitlementState({ userId, accessToken, isSessionActive });

	const displayAvatar = storedAvatar || avatar || "";
	const displayName = name?.trim() || resolvedName || "User";
	const displayEmail = email?.trim() || resolvedEmail || "";
	const user = {
		name: displayName,
		email: displayEmail,
		avatar: displayAvatar,
	};

	useEffect(() => {
		if (!profileOpen) return;

		const planCode = entitlement.effectivePlanCode ?? "free";
		const plan: PlanTier =
			planCode === "pro" ? "pro"
			: planCode === "team" ? "team"
			: planCode === "enterprise" ? "enterprise"
			: planCode === "otl" ? "otl"
			: "free";
		const accessEndsAt = entitlement.accessEndsAt;
		const daysRemaining =
			accessEndsAt && plan !== "free"
				? Math.max(0, Math.ceil((accessEndsAt - Date.now()) / 86_400_000))
				: undefined;

		const load = async () => {
			try {
				const [profileRes, sessionRes] = await Promise.all([
					getStoredUserProfile(),
					supabase.auth.getSession(),
				]);

				const supabaseUser = sessionRes.data.session?.user;
				const avatarUrl =
					storedAvatar ||
					supabaseUser?.user_metadata?.avatar_url ||
					supabaseUser?.user_metadata?.picture ||
					avatar ||
					undefined;

				setProfile({
					fullName:
						(profileRes.success && profileRes.data?.name) ||
						supabaseUser?.user_metadata?.full_name ||
						supabaseUser?.user_metadata?.name ||
						name?.trim() ||
						"User",
					email:
						(profileRes.success && profileRes.data?.email) ||
						supabaseUser?.email ||
						email?.trim() ||
						"",
					avatarUrl,
					plan,
					daysRemaining,
				});
			} catch {}
		};
		void load();
	}, [profileOpen, entitlement]);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Avatar className="size-7 cursor-pointer">
						<AvatarImage src={user.avatar} />
						<AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
					</Avatar>
				</DropdownMenuTrigger>
				<DropdownMenuContent align={dropdownAlign} className="w-60">
					<DropdownMenuItem className="flex items-center justify-start gap-2">
						<DropdownMenuLabel className="flex items-center gap-3">
							<Avatar className="size-10">
								<AvatarImage src={user.avatar} />
								<AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
							</Avatar>
							<div>
								<span className="font-medium text-foreground">{user.name}</span>{" "}
								<br />
								<div className="max-w-full overflow-hidden overflow-ellipsis whitespace-nowrap text-muted-foreground text-xs">
									{user.email}
								</div>
							</div>
						</DropdownMenuLabel>
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem onSelect={() => setProfileOpen(true)}>
						<UserIcon />
						Profile
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem className="w-full cursor-pointer" variant="destructive">
						<LogOutIcon />
						Log out
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<EditProfileModal
				open={profileOpen}
				onOpenChange={setProfileOpen}
				profile={profile}
				onSave={(data) => {
					setProfile(data);
					if (typeof window !== "undefined") {
						if (data.avatarUrl) {
							window.localStorage.setItem("rexa-db-user-avatar", data.avatarUrl);
						} else {
							window.localStorage.removeItem("rexa-db-user-avatar");
						}
					}
					setStoredAvatar(data.avatarUrl);
					setProfileOpen(false);
				}}
				onRefreshSubscription={async () => {
					await refreshEntitlement("manual-refresh");
				}}
			/>
		</>
	);
}
