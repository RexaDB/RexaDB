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
import { UserIcon, LogOutIcon, LogInIcon } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { EditProfileModal } from "@/components/edit-profile-modal";
import type { ProfileData, PlanTier } from "@/components/edit-profile-modal";
import FallbackAvatar from "@/components/fallback-avatar";
import { getStoredUserProfile } from "@/lib/api/actions-client";
import { supabase } from "@/lib/supabase/client";
import { useEntitlementState } from "@/hooks/use-entitlement-state";
import { activateLocalUserProfile, getStoredLocalModeName } from "@/lib/auth/user-profile";
import { toast } from "sonner";

export type NavUserProps = {
	name?: string;
	email?: string;
	avatar?: string;
	dropdownAlign?: "start" | "end";
	dropdownSide?: "top" | "right" | "bottom" | "left";
};

export function NavUser({ name, email, avatar, dropdownAlign = "end", dropdownSide }: NavUserProps = {}) {
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
		let mounted = true;

		const applySession = (u: User, accessTokenValue: string | null) => {
			if (!mounted) return;
			setUserId(u.id);
			setAccessToken(accessTokenValue);
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
		};

		const applyLocal = () => {
			if (!mounted) return;
			setUserId(null);
			setAccessToken(null);
			setIsSessionActive(false);
			const localName = getStoredLocalModeName();
			if (!name?.trim()) setResolvedName(localName || "User");
			if (!email?.trim()) setResolvedEmail("");
			getStoredUserProfile().then((res) => {
				if (!mounted) return;
				if (res.success && res.data) {
					if (!name?.trim() && res.data.name) setResolvedName(res.data.name);
					if (!email?.trim() && res.data.email) setResolvedEmail(res.data.email);
				}
			}).catch(() => {});
		};

		supabase.auth.getSession().then(({ data }) => {
			const u = data.session?.user;
			if (u) {
				applySession(u, data.session!.access_token ?? null);
			} else {
				applyLocal();
			}
		});

		const {
			data: { subscription },
		} = supabase.auth.onAuthStateChange((_event, session) => {
			if (session?.user) {
				applySession(session.user, session.access_token ?? null);
			} else {
				applyLocal();
			}
		});

		return () => {
			mounted = false;
			subscription.unsubscribe();
		};
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
						{user.avatar ? <AvatarImage src={user.avatar} /> : null}
						<AvatarFallback className="overflow-hidden bg-transparent p-0">
							<FallbackAvatar name={user.name || "User"} size={28} />
						</AvatarFallback>
					</Avatar>
				</DropdownMenuTrigger>
				<DropdownMenuContent align={dropdownAlign} side={dropdownSide} className="w-60">
					<DropdownMenuItem className="flex items-center justify-start gap-2">
						<DropdownMenuLabel className="flex items-center gap-3">
							<Avatar className="size-10">
								{user.avatar ? <AvatarImage src={user.avatar} /> : null}
								<AvatarFallback className="overflow-hidden bg-transparent p-0">
									<FallbackAvatar name={user.name || "User"} size={40} />
								</AvatarFallback>
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
					{isSessionActive ? (
						<DropdownMenuItem
							className="w-full cursor-pointer"
							variant="destructive"
							onSelect={async () => {
								const { error } = await supabase.auth.signOut();
								if (error) {
									toast.error(error.message);
									return;
								}
								// Reset immediately rather than waiting on the
								// onAuthStateChange listener, which can race
								// against activateLocalUserProfile below and
								// briefly show a stale cached local name.
								setUserId(null);
								setAccessToken(null);
								setIsSessionActive(false);
								setResolvedName("User");
								setResolvedEmail("");
								await activateLocalUserProfile("User");
								toast.success("Signed out.");
							}}
						>
							<LogOutIcon />
							Log out
						</DropdownMenuItem>
					) : (
						<DropdownMenuItem
							className="w-full cursor-pointer"
							onSelect={() => {
								if (typeof window === "undefined") return;
								const redirectUrl = encodeURIComponent(
									window.location.pathname + window.location.search,
								);
								window.location.href = `/auth?redirect_to=${redirectUrl}`;
							}}
						>
							<LogInIcon />
							Sign in
						</DropdownMenuItem>
					)}
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
