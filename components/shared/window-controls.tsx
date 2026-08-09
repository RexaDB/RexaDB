"use client";

import { Minus, Square, Copy, X } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { StudioTooltip } from "@/components/studio/studio-tooltip";

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
      <div className="flex items-center ml-1">
        <StudioTooltip label="Close">
          <Button
            variant="ghost"
            size="icon"
            className="w-8 h-8 text-muted-foreground/60 hover:text-red-500 hover:bg-red-500/10"
            onClick={onClose}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </StudioTooltip>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 ml-1 border-l border-studio-border">
      <StudioTooltip label="Minimize">
        <Button
          variant="ghost"
          size="icon"
          className="w-8 h-8 text-muted-foreground/60 hover:text-foreground hover:bg-studio-bg"
          onClick={onMinimize}
        >
          <Minus className="w-3.5 h-3.5" />
        </Button>
      </StudioTooltip>
      <StudioTooltip label={isMaximized ? "Restore" : "Maximize"}>
        <Button
          variant="ghost"
          size="icon"
          className="w-8 h-8 text-muted-foreground/60 hover:text-foreground hover:bg-studio-bg"
          onClick={onMaximizeToggle}
        >
          {isMaximized ? <Copy className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
        </Button>
      </StudioTooltip>
      <StudioTooltip label="Close">
        <Button
          variant="ghost"
          size="icon"
          className="w-8 h-8 text-muted-foreground/60 hover:text-red-500 hover:bg-red-500/10"
          onClick={onClose}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </StudioTooltip>
    </div>
  );
}
