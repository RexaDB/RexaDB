"use client";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronsUpDown,
  CloudOff,
  Settings,
  LogOut,
  LogIn,
  Server,
} from "@/lib/icon-theme/lucide-react";
import type { ReactNode } from "react";

interface UserAvatarDropdownProps {
  displayName: string;
  user?: { email?: string } | null;
  isSessionActive?: boolean;
  localMode?: boolean;
  onOpenSettings?: () => void;
  onLogout: () => void;
  onSignIn?: () => void;
  sleekLayout?: boolean;
  children?: ReactNode;
  plan?: { label?: string };
}

export function UserAvatarDropdown({
  displayName,
  user,
  isSessionActive,
  localMode,
  onOpenSettings,
  onLogout,
  onSignIn,
  sleekLayout,
  children,
  plan,
}: UserAvatarDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-2 px-2 text-xs font-normal border border-studio-border rounded-lg bg-background/15 hover:bg-background/25 transition-colors no-drag",
            sleekLayout ? "h-8" : "h-9",
          )}
        >
          <div className="w-5 h-5 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <span className="max-w-[100px] truncate">{displayName}</span>
          <ChevronsUpDown className="w-3 h-3 text-muted-foreground/40" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56 bg-popover border-studio-border [.tui-mode_&]:border"
      >
        <DropdownMenuLabel>
          <div className="flex flex-col space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{displayName}</p>
              {user && !isSessionActive && (
                <span title="Not synced to cloud">
                  <CloudOff className="w-3.5 h-3.5 text-muted-foreground" />
                </span>
              )}
            </div>
            {plan?.label && (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary border border-primary/20 w-fit">
                  {plan.label.charAt(0).toUpperCase() + plan.label.slice(1)}{" "}
                  Plan
                </span>
              </div>
            )}
            {user ? (
              <p className="text-xs text-muted-foreground truncate mt-1">
                {user.email || ""}
              </p>
            ) : localMode ? (
              <p className="text-xs text-muted-foreground truncate mt-1">
                Local mode
              </p>
            ) : null}
          </div>
        </DropdownMenuLabel>
        {children}
        <DropdownMenuSeparator className="bg-studio-border" />
        <DropdownMenuItem
          onClick={onOpenSettings ?? (() => {})}
          className="gap-2 text-xs cursor-pointer"
        >
          <Settings className="w-3.5 h-3.5" />
          Settings
        </DropdownMenuItem>
        {user ? (
          <>
            <DropdownMenuSeparator className="bg-studio-border" />
            <DropdownMenuItem
              onClick={onLogout}
              className="gap-2 text-xs cursor-pointer text-destructive hover:text-destructive/90 hover:bg-destructive/5"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </DropdownMenuItem>
          </>
        ) : (
          onSignIn && (
            <>
              <DropdownMenuSeparator className="bg-studio-border" />
              <DropdownMenuItem
                onClick={onSignIn}
                className="gap-2 text-xs cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5" />
                Sign In
              </DropdownMenuItem>
            </>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
