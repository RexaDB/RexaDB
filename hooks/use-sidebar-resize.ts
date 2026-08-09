"use client";

import { useEffect, useRef, useState } from "react";
import { preventTextSelection, allowTextSelection } from "@/lib/prevent-text-selection";

export function useSidebarResize(
  sidebarWidth: number,
  setSidebarWidth: (width: number) => void,
) {
  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isResizing) return;
    const handlePointerMove = (e: PointerEvent) => {
      const delta = e.clientX - startXRef.current;
      const next = Math.min(480, Math.max(200, startWidthRef.current + delta));
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        setSidebarWidth(next);
        rafRef.current = null;
      });
    };
    const handlePointerUp = () => {
      setIsResizing(false);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    document.body.style.cursor = "col-resize";
    preventTextSelection();
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.cursor = "";
      allowTextSelection();
    };
  }, [isResizing]);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    startWidthRef.current = sidebarWidth;
    setIsResizing(true);
  };

  return { handlePointerDown };
}
