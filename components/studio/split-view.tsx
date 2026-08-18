"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { preventTextSelection, allowTextSelection } from "@/lib/prevent-text-selection";
import { cn } from "@/lib/utils";

type SplitViewProps = {
  primary: ReactNode;
  secondary: ReactNode;
  ratio: number;
  onRatioChange: (ratio: number) => void;
  minRatio?: number;
  maxRatio?: number;
  direction?: "horizontal" | "vertical";
};

/** Hit target centered on the 1px rule. Wide enough to grab, still feels like the line. */
const SASH_HIT_PX = 8;

export function SplitView({
  primary,
  secondary,
  ratio,
  onRatioChange,
  minRatio = 0.2,
  maxRatio = 0.8,
  direction = "horizontal",
}: SplitViewProps) {
  const isVertical = direction === "vertical";
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastRatioRef = useRef(ratio);
  const ratioRef = useRef(ratio);
  const onRatioChangeRef = useRef(onRatioChange);
  const [localRatio, setLocalRatio] = useState(ratio);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const clampRatio = useCallback(
    (next: number) => Math.min(maxRatio, Math.max(minRatio, next)),
    [maxRatio, minRatio],
  );
  const clampRatioRef = useRef(clampRatio);

  useEffect(() => {
    ratioRef.current = ratio;
  }, [ratio]);
  useEffect(() => {
    onRatioChangeRef.current = onRatioChange;
  }, [onRatioChange]);
  useEffect(() => {
    clampRatioRef.current = clampRatio;
  }, [clampRatio]);

  const applyPointerRatio = useCallback(
    (clientX: number, clientY: number) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const size = isVertical ? rect.height : rect.width;
      if (!size) return;
      const nextRatio = clampRatioRef.current(
        isVertical ? (clientY - rect.top) / size : (clientX - rect.left) / size,
      );
      lastRatioRef.current = nextRatio;
      if (rafRef.current) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        setLocalRatio(lastRatioRef.current);
      });
    },
    [isVertical],
  );

  const stopDrag = useCallback((event?: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = false;
    setIsDragging(false);
    document.body.style.cursor = "";
    allowTextSelection();

    if (event) {
      const target = event.currentTarget;
      if (target.hasPointerCapture(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
      }
      const rect = target.getBoundingClientRect();
      const stillOver =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      setIsHovered(stillOver);
    } else {
      setIsHovered(false);
    }

    if (lastRatioRef.current !== ratioRef.current) {
      onRatioChangeRef.current(lastRatioRef.current);
    }
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = true;
      lastRatioRef.current = localRatio;
      setIsDragging(true);
      setIsHovered(true);
      document.body.style.cursor = isVertical ? "row-resize" : "col-resize";
      preventTextSelection();
      event.currentTarget.setPointerCapture(event.pointerId);
      applyPointerRatio(event.clientX, event.clientY);
    },
    [applyPointerRatio, isVertical, localRatio],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      applyPointerRatio(event.clientX, event.clientY);
    },
    [applyPointerRatio],
  );

  useEffect(() => {
    if (dragRef.current) return;
    lastRatioRef.current = ratio;
    setLocalRatio(ratio);
  }, [ratio]);

  useEffect(
    () => () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (dragRef.current) {
        dragRef.current = false;
        document.body.style.cursor = "";
        allowTextSelection();
      }
    },
    [],
  );

  const sashActive = isHovered || isDragging;
  const primarySize = `${localRatio * 100}%`;
  const secondarySize = `${(1 - localRatio) * 100}%`;

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 overflow-hidden",
        isVertical && "flex-col",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 flex-col overflow-hidden",
          isVertical ? "shrink-0" : "h-full",
        )}
        style={isVertical ? { height: primarySize } : { width: primarySize }}
      >
        {primary}
      </div>
      <div
        role="separator"
        aria-orientation={isVertical ? "horizontal" : "vertical"}
        aria-label={isVertical ? "Resize horizontal split view" : "Resize split view"}
        aria-valuemin={Math.round(minRatio * 100)}
        aria-valuemax={Math.round(maxRatio * 100)}
        aria-valuenow={Math.round(localRatio * 100)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onLostPointerCapture={() => {
          if (dragRef.current) stopDrag();
        }}
        onPointerEnter={() => setIsHovered(true)}
        onPointerLeave={() => {
          if (!dragRef.current) setIsHovered(false);
        }}
        className={cn(
          // z-30 sits above pane bodies (z-10). Without this the second pane
          // paints over the sash and hover/drag only work in random gaps.
          "absolute z-30 touch-none select-none",
          isVertical
            ? "left-0 right-0 cursor-row-resize"
            : "top-0 bottom-0 cursor-col-resize",
        )}
        style={
          isVertical
            ? {
                top: primarySize,
                height: SASH_HIT_PX,
                transform: "translateY(-50%)",
              }
            : {
                left: primarySize,
                width: SASH_HIT_PX,
                transform: "translateX(-50%)",
              }
        }
      >
        {/* Idle 1px rule. Hidden once the sidebar-style hover pill is showing. */}
        <div
          className={cn(
            "pointer-events-none absolute bg-border transition-opacity",
            sashActive ? "opacity-0" : "opacity-100",
            isVertical
              ? "inset-x-0 top-1/2 h-px -translate-y-1/2"
              : "inset-y-0 left-1/2 w-px -translate-x-1/2",
          )}
        />
        {/* Same hover/active treatment as the Modern sidebar resizer:
            rounded-full, hover:bg-border/50, active:bg-border. Fills the full
            height/width of the sash so the pill matches the separator. */}
        <div
          className={cn(
            "pointer-events-none absolute rounded-full transition-colors",
            isVertical
              ? "inset-x-0 top-1/2 -translate-y-1/2"
              : "inset-y-0 left-1/2 -translate-x-1/2",
            isDragging ? "bg-border" : isHovered ? "bg-border/50" : "bg-transparent",
          )}
          style={isVertical ? { height: SASH_HIT_PX } : { width: SASH_HIT_PX }}
        />
      </div>
      <div
        className={cn(
          "flex min-w-0 flex-col overflow-hidden",
          isVertical ? "shrink-0" : "h-full",
        )}
        style={isVertical ? { height: secondarySize } : { width: secondarySize }}
      >
        {secondary}
      </div>
    </div>
  );
}
