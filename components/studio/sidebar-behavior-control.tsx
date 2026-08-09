"use client";

import { PanelLeftDashed } from "@/lib/icon-theme/lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SidebarBehavior } from "@/lib/studio/sidebar-behavior";

import { StudioTooltip } from "./studio-tooltip";

export function SidebarBehaviorControl({
  behavior,
  setBehavior,
  expanded = false,
}: {
  behavior: SidebarBehavior;
  setBehavior: (behavior: SidebarBehavior) => void;
  expanded?: boolean;
}) {
  return (
    <DropdownMenu>
      <StudioTooltip label="Sidebar Control" side="right">
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="relative h-9 w-full overflow-visible rounded-lg px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
          >
            <span className="absolute left-0 top-0 flex h-9 w-9 items-center justify-center rounded-lg border border-transparent transition-[background-color,border-color,color] duration-200 hover:border-border/70 hover:bg-muted/20">
              <span className="flex size-5 items-center justify-center">
                <PanelLeftDashed className="size-5 shrink-0" />
              </span>
            </span>
            <span
              className={
                expanded
                  ? "absolute left-11 top-1/2 min-w-max -translate-y-1/2 text-left text-xs font-medium opacity-100 transition-opacity duration-150"
                  : "absolute left-11 top-1/2 min-w-max -translate-y-1/2 text-left text-xs font-medium opacity-0 transition-opacity duration-150"
              }
            >
              Sidebar
            </span>
          </Button>
        </DropdownMenuTrigger>
      </StudioTooltip>

      <DropdownMenuContent side="top" align="start" className="w-44">
        <DropdownMenuRadioGroup
          value={behavior}
          onValueChange={(value) => setBehavior(value as SidebarBehavior)}
        >
          <DropdownMenuLabel>Sidebar control</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem value="open">Expanded</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="closed">
            Collapsed
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="expandable">
            Expand on hover
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
