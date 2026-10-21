"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Check, Copy } from "@/lib/icon-theme/lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export interface NeonAuthUser {
  UID: string;
  "Display name": string;
  Email: string | null;
  Providers: string;
  "Created at": string | null;
  __avatar_url?: string | null;
  __confirmed: boolean;
  __created_at_raw?: string | null;
}

function initials(name: string): string {
  return name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "U";
}

export function NeonAuthUserIdentity({ user }: { user: NeonAuthUser }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar className="size-8"><AvatarImage src={user.__avatar_url ?? undefined} alt="" /><AvatarFallback className="text-xs font-semibold">{initials(user["Display name"] || user.Email || "User")}</AvatarFallback></Avatar>
      <div className="min-w-0"><div className="truncate font-medium" title={user["Display name"]}>{user["Display name"] || "Unnamed user"}</div><div className="truncate text-xs text-muted-foreground">{user.Email || "No email address"}</div></div>
    </div>
  );
}

export function NeonAuthUserId({ user }: { user: NeonAuthUser }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const copyId = useCallback(() => {
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      toast.error("Could not copy the user ID.");
      return;
    }
    void clipboard
      .writeText(user.UID)
      .then(() => {
        setCopied(true);
        if (resetTimer.current) clearTimeout(resetTimer.current);
        resetTimer.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        toast.error("Could not copy the user ID.");
      });
  }, [user.UID]);

  return (
    <div className="flex items-center gap-1">
      <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={user.UID}>
        {user.UID}
      </span>
      <button
        type="button"
        aria-label={copied ? "User ID copied" : "Copy user ID"}
        title={copied ? "Copied" : "Copy user ID"}
        onClick={copyId}
        className="shrink-0 rounded-md p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
      >
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

export function NeonAuthUserStatus({ user }: { user: NeonAuthUser }) {
  const statusClass = user.__confirmed ? "border-success/20 bg-success/10 text-success" : "border-border bg-muted text-muted-foreground";
  return <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs ${statusClass}`}>{user.__confirmed ? "Verified" : "Unverified"}</span>;
}

export function NeonAuthUserCreated({ user }: { user: NeonAuthUser }) {
  const value = user.__created_at_raw ?? user["Created at"];
  if (!value) return <span>—</span>;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <span>—</span>;
  const absolute = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  return <span title={absolute}>{formatDistanceToNow(date, { addSuffix: true })}</span>;
}
