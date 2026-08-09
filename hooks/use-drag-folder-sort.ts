"use client";

import { useEffect, useRef } from "react";

export function useDragFolderSort(
  isDragging: unknown,
  dragStartRef: React.RefObject<{ x: number; y: number } | null>,
  handleMove: (event: PointerEvent) => void,
  handleUp: () => void,
) {
  const moveRef = useRef(handleMove);
  const upRef = useRef(handleUp);
  moveRef.current = handleMove;
  upRef.current = handleUp;

  useEffect(() => {
    if (!isDragging || !dragStartRef.current) return;

    const onMove = (e: PointerEvent) => moveRef.current(e);
    const onUp = () => upRef.current();

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [isDragging, dragStartRef]);
}
