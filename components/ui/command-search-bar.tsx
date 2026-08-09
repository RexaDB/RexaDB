"use client";

import { cn } from "@/lib/utils";
import { Search } from "@/lib/icon-theme/lucide-react";
import { Kbd } from "@/components/ui/kbd";

interface CommandSearchBarProps {
  sleekLayout?: boolean;
  onClick?: () => void;
  className?: string;
  noDrag?: boolean;
}

export function CommandSearchBar({
  sleekLayout,
  onClick,
  className,
  noDrag,
}: CommandSearchBarProps) {
  return (
    <div className={cn("flex-1 max-w-xl", className)}>
      <div
        className={cn("relative group", noDrag && "no-drag")}
        data-tauri-drag-region={noDrag ? "false" : undefined}
        onClick={onClick}
      >
        <Search
          className={cn(
            "absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/30 group-hover:text-foreground/50 transition-colors",
            sleekLayout ? "w-3 h-3" : "w-3.5 h-3.5",
          )}
        />
        <div
          className={cn(
            "w-full bg-background/15 border border-studio-border rounded-lg flex items-center px-3 pl-8 text-xs text-muted-foreground/60 cursor-pointer hover:bg-background/25 transition-colors gap-2 select-none",
            sleekLayout ? "h-8" : "h-9",
          )}
        >
          <div className="flex items-center gap-1 opacity-50">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </div>
          <span className="ml-1">Search</span>
        </div>
      </div>
    </div>
  );
}
