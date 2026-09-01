"use client";

import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface RexaContextMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export function RexaContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: RexaContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // "pointerdown", not "mousedown": Glide's own canvas mousedown handler
    // (node_modules/@glideapps/glide-data-grid's internal DataGrid)
    // calls preventDefault() on the pointerdown event for any click
    // landing on the grid — which, per the Pointer Events spec, suppresses
    // the browser's synthesized compatibility mousedown/click events for
    // that interaction entirely. A "mousedown" listener never sees clicks
    // on the grid at all; "pointerdown" is the original event and always
    // fires regardless of what anyone does with preventDefault on it.
    const handlePointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onClose]);

  const clampedX = Math.min(x, (typeof window !== "undefined" ? window.innerWidth : x) - 220);
  const clampedY = Math.min(y, (typeof window !== "undefined" ? window.innerHeight : y) - items.length * 32 - 16);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[400] min-w-[200px] rounded-md border border-studio-border bg-popover p-1 shadow-2xl text-xs"
      style={{ left: Math.max(4, clampedX), top: Math.max(4, clampedY) }}
    >
      {items.map((item) => (
        <React.Fragment key={item.key}>
          {item.separatorBefore && <div className="my-1 h-px bg-studio-border" />}
          <button
            type="button"
            disabled={item.disabled}
            className="flex w-full items-center rounded px-2 py-1.5 text-left text-foreground hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            {item.label}
          </button>
        </React.Fragment>
      ))}
    </div>,
    document.body,
  );
}
