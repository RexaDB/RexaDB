"use client";

import { neonUsersStatusMessage } from "./neon-auth-users-messages";

interface NeonAuthUsersStatusProps {
  error: string | null;
  loading: boolean;
  filteredCount: number;
  totalCount: number;
  limitReached: boolean;
}

/**
 * The line under the Neon user table. It keeps the refresh error and the
 * account limit visible while the table still shows the rows it loaded.
 */
export function NeonAuthUsersStatus({
  error,
  loading,
  filteredCount,
  totalCount,
  limitReached,
}: NeonAuthUsersStatusProps) {
  const message = neonUsersStatusMessage({
    error,
    loading,
    filteredCount,
    totalCount,
    limitReached,
  });

  return (
    <div className="flex h-8 shrink-0 items-center justify-between gap-4 px-3 text-xs text-muted-foreground">
      <span
        className={
          message.tone === "error"
            ? "min-w-0 truncate text-destructive"
            : "min-w-0 truncate"
        }
        title={error ?? undefined}
      >
        {message.text}
      </span>
      {message.notice ? <span className="shrink-0">{message.notice}</span> : null}
    </div>
  );
}
