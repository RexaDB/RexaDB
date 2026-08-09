"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { preventTextSelection, allowTextSelection } from "@/lib/prevent-text-selection";

type SplitViewProps = {
  primary: ReactNode;
  secondary: ReactNode;
  ratio: number;
  onRatioChange: (ratio: number) => void;
  minRatio?: number;
  maxRatio?: number;
  direction?: "horizontal" | "vertical";
};

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
  const dragRef = useRef<boolean>(false);
  const rafRef = useRef<number | null>(null);
  const lastRatioRef = useRef<number>(ratio);
  const [localRatio, setLocalRatio] = useState(ratio);

  const clampRatio = useCallback((next: number) => Math.min(maxRatio, Math.max(minRatio, next)), [maxRatio, minRatio]);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    if (!dragRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (isVertical ? !rect.height : !rect.width) return;
    const nextRatio = clampRatio(
      isVertical
        ? (event.clientY - rect.top) / rect.height
        : (event.clientX - rect.left) / rect.width,
    );
    lastRatioRef.current = nextRatio;
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      setLocalRatio(lastRatioRef.current);
    });
  }, [clampRatio, isVertical]);

  const handlePointerUp = useCallback(() => {
    dragRef.current = false;
    document.body.style.cursor = "";
    allowTextSelection();
    window.removeEventListener("pointermove", handlePointerMove);
    if (lastRatioRef.current !== ratio) {
      onRatioChange(lastRatioRef.current);
    }
  }, [handlePointerMove, onRatioChange, ratio]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = true;
    document.body.style.cursor = isVertical ? "row-resize" : "col-resize";
    preventTextSelection();
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }, [handlePointerMove, handlePointerUp, isVertical]);

  useEffect(() => () => {
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    handlePointerUp();
  }, [handlePointerMove, handlePointerUp]);
  useEffect(() => {
    if (dragRef.current) return;
    lastRatioRef.current = ratio;
    setLocalRatio(ratio);
  }, [ratio]);
  useEffect(() => () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  return (
    <div ref={containerRef} className={`flex flex-1 min-h-0 min-w-0 ${isVertical ? "flex-col" : ""} overflow-hidden`}>
      <div className={`min-w-0 ${isVertical ? "shrink-0" : "h-full"} flex flex-col overflow-hidden`} style={isVertical ? { height: `${localRatio * 100}%` } : { width: `${localRatio * 100}%` }}>
        {primary}
      </div>
      <div
        className={`${isVertical ? "h-1.5 cursor-row-resize" : "w-1.5 cursor-col-resize"} shrink-0 bg-studio-border/70 hover:bg-blue-500/40 transition-colors`}
        onPointerDown={handlePointerDown}
        aria-label={isVertical ? "Resize horizontal split view" : "Resize split view"}
      />
      <div className={`min-w-0 ${isVertical ? "shrink-0" : "h-full"} flex flex-col overflow-hidden`} style={isVertical ? { height: `${(1 - localRatio) * 100}%` } : { width: `${(1 - localRatio) * 100}%` }}>
        {secondary}
      </div>
    </div>
  );
}
