"use client";

import { useEffect, useRef, useState } from "react";
import { preventTextSelection, allowTextSelection } from "@/lib/prevent-text-selection";

interface UseResizePanelOptions {
  initialWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  ariaLabel: string;
  onResizeComplete?: () => void;
}

interface ResizeHandleProps {
  "aria-label": string;
  "aria-orientation": "vertical";
  className: string;
  role: "separator";
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onMouseDown: () => void;
}

export function useResizePanel({
  initialWidth = 420,
  minWidth = 360,
  maxWidth = 1100,
  ariaLabel,
  onResizeComplete,
}: UseResizePanelOptions) {
  const [width, setWidth] = useState(initialWidth);
  const [isResizeHovered, setIsResizeHovered] = useState(false);
  const isResizingRef = useRef(false);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isResizingRef.current) return;
      const nextWidth = window.innerWidth - event.clientX;
      const clamped = Math.min(maxWidth, Math.max(minWidth, nextWidth));
      setWidth(clamped);
    };

    const handleMouseUp = () => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      document.body.style.cursor = "";
      allowTextSelection();
      onResizeComplete?.();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [minWidth, maxWidth, onResizeComplete]);

  const resizeHandleProps: ResizeHandleProps = {
    "aria-label": ariaLabel,
    "aria-orientation": "vertical",
    className:
      "absolute left-0 top-0 z-20 h-full w-3 -translate-x-1 cursor-col-resize select-none bg-transparent",
    role: "separator",
    onMouseEnter: () => setIsResizeHovered(true),
    onMouseLeave: () => setIsResizeHovered(false),
    onMouseDown: () => {
      isResizingRef.current = true;
      document.body.style.cursor = "col-resize";
      preventTextSelection();
    },
  };

  return { width, isResizeHovered, resizeHandleProps };
}
