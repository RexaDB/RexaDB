"use client";

interface PendingChangesBannerProps {
  pendingChangesCount: number;
  pendingActionsCount: number;
  onReview: () => void;
}

export function PendingChangesBanner({
  pendingChangesCount,
  pendingActionsCount,
  onReview,
}: PendingChangesBannerProps) {
  const total = pendingChangesCount + pendingActionsCount;
  if (total === 0) return null;

  let label = `${total} pending change${total !== 1 ? "s" : ""}`;
  const parts: string[] = [];
  if (pendingChangesCount > 0) {
    parts.push(
      `${pendingChangesCount} cell edit${pendingChangesCount !== 1 ? "s" : ""}`,
    );
  }
  if (pendingActionsCount > 0) {
    parts.push(
      `${pendingActionsCount} action${pendingActionsCount !== 1 ? "s" : ""}`,
    );
  }
  if (parts.length > 0) {
    label = `${total} pending (${parts.join(", ")})`;
  }

  return (
    <div className="flex items-center justify-between px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/20 shrink-0">
      <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">
        {label}
      </span>
      <button
        onClick={onReview}
        className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 hover:underline transition-colors"
      >
        Review &rarr;
      </button>
    </div>
  );
}
