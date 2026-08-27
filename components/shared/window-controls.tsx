"use client";

import {
  CornersIn,
  CornersOut,
  Minus,
  X,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { StudioTooltip } from "@/components/studio/studio-tooltip";

const controlClass =
  "size-6 rounded-[min(var(--radius-md),10px)] text-muted-foreground transition-colors hover:text-foreground hover:bg-muted";

export function WindowControls({
  isMaximized,
  onMinimize,
  onMaximizeToggle,
  onClose,
  wayland,
}: {
  isMaximized: boolean;
  onMinimize: () => void;
  onMaximizeToggle: () => void;
  onClose: () => void;
  wayland?: boolean;
}) {
  if (wayland) {
    return (
      <div className="flex items-center">
        <StudioTooltip label="Close">
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-6 rounded-[min(var(--radius-md),10px)] text-muted-foreground transition-colors hover:bg-destructive hover:text-white"
            onClick={onClose}
          >
            <X weight="bold" className="size-3" />
          </Button>
        </StudioTooltip>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0.5">
      <StudioTooltip label="Minimize">
        <Button
          variant="ghost"
          size="icon-xs"
          className={controlClass}
          onClick={onMinimize}
        >
          <Minus weight="bold" className="size-3" />
        </Button>
      </StudioTooltip>
      <StudioTooltip label={isMaximized ? "Restore" : "Maximize"}>
        <Button
          variant="ghost"
          size="icon-xs"
          className={controlClass}
          onClick={onMaximizeToggle}
        >
          {isMaximized ? (
            <CornersIn weight="duotone" className="size-3.5" />
          ) : (
            <CornersOut weight="duotone" className="size-3.5" />
          )}
        </Button>
      </StudioTooltip>
      <StudioTooltip label="Close">
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-6 rounded-[min(var(--radius-md),10px)] text-muted-foreground transition-colors hover:bg-destructive hover:text-white"
          onClick={onClose}
        >
          <X weight="bold" className="size-3" />
        </Button>
      </StudioTooltip>
    </div>
  );
}
