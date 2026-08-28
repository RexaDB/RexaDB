"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ChevronRight } from "@/lib/icon-theme/lucide-react";

/**
 * One list row (a project, database, branch...) shared by the provider
 * account screens. Renders as a div, never a <button> — rows commonly need
 * to nest their own interactive controls (a "Connect" button, an external
 * link icon), and a <button> can't legally contain another <button>.
 */
export function ResourceRow({
  icon,
  title,
  subtitle,
  trailing,
  onClick,
  expandable,
  expanded,
  className,
}: {
  icon: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  expandable?: boolean;
  expanded?: boolean;
  className?: string;
}) {
  const clickable = Boolean(onClick);

  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={cn(
        "flex items-center gap-3 rounded-lg px-2.5 py-2.5 transition-colors",
        clickable && "cursor-pointer hover:bg-studio-row-hover/70",
        className,
      )}
    >
      {expandable && (
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
      )}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/60">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-1.5">{trailing}</div>}
    </div>
  );
}
