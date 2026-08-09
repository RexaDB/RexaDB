"use client";

import { type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Shield, Mail } from "@/lib/icon-theme/lucide-react";
import { getStudioUrl } from "@/lib/studio-backend/auth-store";

interface UserPopoverUser {
  id?: string;
  name: string;
  email?: string;
  avatarUrl?: string | null;
  role?: { id?: number; name?: string } | string | null;
}

export function UserPopover({
  user,
  children,
}: {
  user: UserPopoverUser | null | undefined;
  children: ReactNode;
}) {
  if (!user) return <>{children}</>;

  const roleName = typeof user.role === "string" ? user.role : user.role?.name;
  const avatarSrc = user.avatarUrl
    ? `${getStudioUrl()}/api/avatars/${user.avatarUrl}`
    : null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <span className="cursor-pointer hover:opacity-80 transition-opacity inline-flex items-center gap-1.5">
          {children}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        className="w-72 p-0 overflow-hidden rounded-lg border-border/60"
      >
        <div className="h-16 bg-gradient-to-br from-primary/20 via-primary/10 to-transparent" />
        <div className="px-4 pb-4 -mt-8">
          <div className="mb-3">
            {avatarSrc ? (
              <img
                src={avatarSrc}
                alt=""
                className="w-14 h-14 rounded-lg border-[3px] border-background object-cover"
              />
            ) : (
              <div className="w-14 h-14 rounded-lg border-[3px] border-background bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">
                {user.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          <div className="space-y-0.5">
            <p className="font-semibold text-sm leading-tight">{user.name}</p>
            {user.email && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Mail className="w-3 h-3" />
                {user.email}
              </p>
            )}
          </div>

          {roleName && (
            <div className="mt-3 pt-3 border-t border-border/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Role
                </span>
                <Badge
                  variant="secondary"
                  className="text-xs capitalize font-medium px-2 py-0 h-5"
                >
                  {roleName}
                </Badge>
              </div>
              {user.id && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Shield className="w-3 h-3" />
                  <span className="font-mono truncate">
                    ID: {user.id.slice(0, 8)}…
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
