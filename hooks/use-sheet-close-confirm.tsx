"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

export function useSheetCloseConfirm(
  isDirty: boolean,
  confirmEnabled: boolean,
  onClose: () => void,
) {
  const [showConfirm, setShowConfirm] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const handleInteractOutside = useCallback(
    (e: Event) => {
      if (confirmEnabled && isDirty) {
        e.preventDefault();
        setShowConfirm(true);
      }
    },
    [confirmEnabled, isDirty],
  );

  const confirmLeave = useCallback(() => {
    setShowConfirm(false);
    onClose();
  }, [onClose]);

  const cancelLeave = useCallback(() => {
    setShowConfirm(false);
  }, []);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        cancelLeave();
      }
    },
    [cancelLeave],
  );

  const ConfirmDialog = showConfirm
    ? typeof window !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-[9999]"
            onClick={handleOverlayClick}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="absolute inset-0 bg-black/10" />
            <div className="flex items-center justify-center h-full pointer-events-none">
              <div
                ref={dialogRef}
                className="bg-background rounded-lg border p-6 max-w-sm w-full shadow-lg ring-1 ring-foreground/10 mx-4 pointer-events-auto"
              >
                <h3 className="text-base font-semibold mb-1">
                  Unsaved changes
                </h3>
                <p className="text-sm text-muted-foreground mb-6">
                  You have unsaved changes. Are you sure you want to leave?
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={cancelLeave}>
                    Stay
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={confirmLeave}
                  >
                    Leave
                  </Button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null
    : null;

  return { handleInteractOutside, ConfirmDialog };
}
