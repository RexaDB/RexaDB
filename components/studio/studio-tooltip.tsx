"use client";

import type { ReactNode } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function StudioTooltip({
  children,
  label,
  side = "bottom",
}: {
  children: ReactNode;
  label: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground shadow-md"
          hideArrow
          side={side}
          sideOffset={6}
        >
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
