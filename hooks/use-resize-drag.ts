"use client";

import { useCallback } from "react";

/**
 * Shared mouse-drag resize handler (sidebar / chat-sheet width).
 * Extracts the duplicated onMouseMove/onMouseUp col-resize boilerplate.
 */
export function useResizeDrag(options: {
  startWidth: number;
  minWidth: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
  disabled?: boolean;
}) {
  const { startWidth, minWidth, maxWidth, onWidthChange, disabled } = options;

  return useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      e.preventDefault();
      const startX = e.clientX;
      const initial = startWidth;

      const onMouseMove = (ev: MouseEvent) => {
        const newWidth = Math.min(maxWidth, Math.max(minWidth, initial + ev.clientX - startX));
        onWidthChange(newWidth);
      };

      const onMouseUp = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [startWidth, minWidth, maxWidth, onWidthChange, disabled],
  );
}
