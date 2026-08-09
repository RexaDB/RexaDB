"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface SidebarHeaderProps {
  title: string;
  actions?: React.ReactNode;
  className?: string;
}

export function SidebarHeader({
  title,
  actions,
  className,
}: SidebarHeaderProps) {
  return (
    <div
      className={cn(
        "px-4 h-[44px] border-b border-studio-border flex items-center justify-between shrink-0",
        className,
      )}
    >
      <h2 className="text-sm text-muted-foreground">{title}</h2>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </div>
  );
}
