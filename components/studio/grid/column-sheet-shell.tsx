"use client";

import { StudioSheet } from "@/components/common/studio-sheet";

import type { ReactNode } from "react";

/**
 * Outer container shared by Add/Edit column sheets.
 * Preserves each sheet's own header/body markup — only the
 * Sheet + SheetContent wrapper and dirty-confirm dialog are shared.
 */
export function ColumnSheetShell({
  isOpen,
  onOpenChange,
  handleInteractOutside,
  confirmDialog,
  className,
  children,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  handleInteractOutside: (event: Event) => void;
  confirmDialog: ReactNode;
  className: string;
  children: ReactNode;
}) {
  return (
    <StudioSheet
      open={isOpen}
      onOpenChange={onOpenChange}
      modal={false}
      contentProps={{
        side: "right",
        contained: true,
        onInteractOutside: handleInteractOutside,
        className,
      }}
    >
      {confirmDialog}
      <div className="flex flex-col h-full">{children}</div>
    </StudioSheet>
  );
}
