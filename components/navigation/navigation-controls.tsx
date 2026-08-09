"use client";

import type { AppTab } from "@/components/app-shell/app-shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ClockCircle, AltArrowLeft, AltArrowRight } from "@/lib/icon-theme/solar-icons";

type Props = {
  tabs?: AppTab[];
  onSelectTab?: (id: string) => void;
  canBack?: boolean;
  onBack?: () => void;
  canForward?: boolean;
  onForward?: () => void;
  tooltipLabel?: string;
};

export function NavigationControls({
  tabs = [],
  onSelectTab,
  canBack,
  onBack,
  canForward,
  onForward,
  tooltipLabel = "Recently viewed",
}: Props) {
  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={tooltipLabel}
                className="size-7 rounded-full text-muted-foreground hover:bg-[var(--shell-content-bg)] hover:text-foreground"
                size="icon-sm"
                variant="ghost"
              >
                <ClockCircle className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{tooltipLabel}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="start"
          className="w-[20rem] border-border bg-[var(--shell-history-bg)] p-1.5 ring-0"
        >
          <DropdownMenuLabel className="text-sm font-normal text-muted-foreground">
            Recently viewed
          </DropdownMenuLabel>
          {tabs.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              Nothing yet
            </div>
          ) : (
            tabs.map((tab) => (
              <DropdownMenuItem
                key={tab.id}
                className="gap-2.5 py-1.5 text-sm [&_svg]:size-4"
                onClick={() => onSelectTab?.(tab.id)}
              >
                {tab.icon ?? <ClockCircle className="size-4" />}
                <span className="truncate">{tab.title}</span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        aria-label="Back"
        className="size-7 rounded-full text-muted-foreground hover:bg-[var(--shell-content-bg)] hover:text-foreground"
        disabled={!canBack}
        onClick={onBack}
        size="icon-sm"
        variant="ghost"
      >
        <AltArrowLeft />
      </Button>
      <Button
        aria-label="Forward"
        className="size-7 rounded-full text-muted-foreground hover:bg-[var(--shell-content-bg)] hover:text-foreground"
        disabled={!canForward}
        onClick={onForward}
        size="icon-sm"
        variant="ghost"
      >
        <AltArrowRight />
      </Button>
    </>
  );
}
