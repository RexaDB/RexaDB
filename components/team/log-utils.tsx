"use client";

import type { ComponentType, ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { getStudioUrl } from "@/lib/studio-backend/auth-store";
import { UserPopover } from "@/components/team/user-popover";

export function LogTable({
  headers,
  children,
}: {
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-black/10 bg-table-band p-0.5 dark:border-white/10">
      <div className="overflow-x-auto rounded-[14px] border border-black/10 dark:border-white/[0.07]">
        <table className="w-full border-separate border-spacing-0 text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-muted-foreground [&>th]:bg-table-band [&>th]:px-4 [&>th]:py-3 [&>th]:font-medium [&>th]:whitespace-nowrap">
              {headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="[&>tr>td]:border-b [&>tr>td]:border-border/60 [&>tr:last-child>td]:border-b-0 [&>tr]:bg-table-row [&>tr]:transition-colors [&>tr]:hover:bg-table-row-hover [&>tr>td]:px-4 [&>tr>td]:py-3">
            {children}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function LogLoadingState({ loading }: { loading: boolean }) {
  if (!loading) return null;
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-lg border-2 border-primary border-t-transparent" />
    </div>
  );
}

interface LogUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
}

export function LogUserCell({ user }: { user: LogUser }) {
  return (
    <UserPopover user={user}>
      <div className="flex items-center gap-2">
        {user.avatarUrl ? (
          <img
            src={`${getStudioUrl()}/api/avatars/${user.avatarUrl}`}
            alt=""
            className="w-5 h-5 rounded-lg object-cover shrink-0"
          />
        ) : user.name ? (
          <div className="w-5 h-5 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
            {user.name.charAt(0).toUpperCase()}
          </div>
        ) : null}
        <span className="truncate">{user.name ?? "—"}</span>
      </div>
    </UserPopover>
  );
}

function LogEmptyState({
  icon: Icon,
  text,
}: {
  icon: ComponentType<{ className?: string }>;
  text: string;
}) {
  return (
    <div className="p-8 text-center">
      <Icon className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

export function LogPageLayout({
  title,
  description,
  emptyIcon,
  emptyText,
  isEmpty,
  children,
}: {
  title: string;
  description: string;
  emptyIcon: ComponentType<{ className?: string }>;
  emptyText: string;
  isEmpty: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div>
        <h1 className="text-sm font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>
      <Card className="border-studio-border bg-studio-bg/50">
        {isEmpty ? (
          <LogEmptyState icon={emptyIcon} text={emptyText} />
        ) : (
          children
        )}
      </Card>
    </div>
  );
}
