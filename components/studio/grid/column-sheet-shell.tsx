"use client";

import type { ReactNode } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";

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
    <Sheet open={isOpen} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        contained
        onInteractOutside={handleInteractOutside}
        className={className}
      >
        {confirmDialog}
        <div className="flex flex-col h-full">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
