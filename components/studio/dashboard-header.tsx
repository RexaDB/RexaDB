"use client";

import Image from "next/image";
import { RefreshCw, Lock, Unlock } from "@/lib/icon-theme/lucide-react";

import { Button } from "@/components/ui/button";

export function DashboardHeader({
  onRefresh,
  onEditWithAi,
  isLocked,
  onToggleLock,
  isRefreshing,
}: {
  onRefresh: () => void;
  onEditWithAi: () => void;
  isLocked: boolean;
  onToggleLock: () => void;
  isRefreshing?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
      <Button className="h-8 gap-1.5 px-3 text-xs" onClick={onRefresh} variant="outline" disabled={isRefreshing}>
        <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
        {isRefreshing ? "Refreshing..." : "Refresh"}
      </Button>

      <div className="flex items-center gap-2">
        <Button
          className="h-8 gap-1.5 px-3 text-xs"
          onClick={onToggleLock}
          variant="outline"
          title={isLocked ? "Unlock dashboard" : "Lock dashboard"}
        >
          {isLocked ? (
            <Lock className="h-3.5 w-3.5" />
          ) : (
            <Unlock className="h-3.5 w-3.5" />
          )}
          {isLocked ? "Locked" : "Unlock"}
        </Button>

        <Button className="h-8 gap-2 pl-2.5 pr-3 text-xs" onClick={onEditWithAi} variant="outline">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
            <Image
              alt="AI"
              className="block brightness-0 dark:brightness-0 dark:invert"
              height={16}
              src="/AI.svg"
              width={16}
            />
          </span>
          Edit With AI
        </Button>
      </div>
    </div>
  );
}
