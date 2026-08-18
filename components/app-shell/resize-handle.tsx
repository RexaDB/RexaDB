"use client";

import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";

type ResizeHandleProps = {
  /** Column dividers use a vertical grip; row dividers use a horizontal grip. */
  orientation: "vertical" | "horizontal";
  onMouseDown: (e: React.MouseEvent) => void;
  className?: string;
  style?: React.CSSProperties;
};

/**
 * VS Code–style sash: a wide transparent hit target with a thin center line that
 * lights up on hover/drag and spans the full length of the resized edge.
 * Three dots sit in the middle as a resting affordance (no background pill).
 */
export function ResizeHandle({
  orientation,
  onMouseDown,
  className,
  style,
}: ResizeHandleProps) {
  const isVertical = orientation === "vertical";
  const [dragging, setDragging] = useState(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(true);
      const end = () => {
        setDragging(false);
        window.removeEventListener("mouseup", end);
        window.removeEventListener("blur", end);
      };
      window.addEventListener("mouseup", end);
      window.addEventListener("blur", end);
      onMouseDown(e);
    },
    [onMouseDown],
  );

  return (
    <div
      role="separator"
      aria-orientation={isVertical ? "vertical" : "horizontal"}
      data-dragging={dragging ? "" : undefined}
      className={cn(
        "group/resize relative z-[60] flex shrink-0 items-center justify-center",
        "bg-transparent touch-none select-none",
        isVertical
          ? "w-[6px] cursor-col-resize self-stretch"
          : "h-[6px] w-full cursor-row-resize",
        className,
      )}
      style={style}
      onMouseDown={handleMouseDown}
    >
      {/* Full-length sash line (VS Code hoverBorder effect). */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute rounded-full transition-colors duration-100",
          isVertical
            ? "inset-y-0 left-1/2 w-[2px] -translate-x-1/2"
            : "inset-x-0 top-1/2 h-[2px] -translate-y-1/2",
          dragging
            ? "bg-foreground/45"
            : "bg-transparent group-hover/resize:bg-foreground/30",
        )}
      />

      {/* Resting three-dot indicator, centered on the sash. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none relative z-[1] flex items-center justify-center gap-[3px]",
          "transition-opacity duration-100",
          dragging
            ? "opacity-0"
            : "opacity-45 group-hover/resize:opacity-0",
          isVertical ? "flex-col" : "flex-row",
        )}
      >
        <span className="size-[3px] shrink-0 rounded-full bg-muted-foreground" />
        <span className="size-[3px] shrink-0 rounded-full bg-muted-foreground" />
        <span className="size-[3px] shrink-0 rounded-full bg-muted-foreground" />
      </div>
    </div>
  );
}
