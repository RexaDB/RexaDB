"use client";

import type { ComponentProps, ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/** Shared outer surface for product sheets; caller classes remain available for intentional variants. */
export function StudioSheetContent({
  className,
  contained = false,
  side = "right",
  closeButtonClassName = "absolute top-1 right-3",
  ...props
}: ComponentProps<typeof SheetContent>) {
  return (
    <SheetContent
      {...props}
      side={side}
      contained={contained}
      closeButtonClassName={closeButtonClassName}
      className={cn(
        "flex flex-col gap-0 border-border bg-background p-0 text-foreground",
        contained ? "w-[min(420px,92vw)]" : "sm:max-w-[520px]",
        className,
      )}
    />
  );
}

/** Sheet chrome mirrors Modern UI's compact tab strip. */
export function StudioSheetHeader({
  className,
  ...props
}: ComponentProps<typeof SheetHeader>) {
  return (
    <SheetHeader
      {...props}
      className={cn(
        className,
        "relative flex h-9 shrink-0 flex-row items-center justify-between gap-1 overflow-hidden border-b border-border bg-background p-1 pl-3 pr-10 [&_[data-slot=button]]:h-7 [&_[data-slot=button]]:rounded-md [&_[data-slot=button]]:px-2 [&_[data-slot=button]]:text-xs",
      )}
    />
  );
}

/** Sheet titles use the same selected-pill treatment as the active app tab. */
export function StudioSheetTitle({
  className,
  ...props
}: ComponentProps<typeof SheetTitle>) {
  return (
    <SheetTitle
      {...props}
      className={cn(
        className,
        "flex h-7 min-w-24 max-w-52 shrink-0 select-none items-center gap-1.5 truncate rounded-md bg-studio-tab-active px-2 text-xs font-medium text-foreground transition-colors",
      )}
    />
  );
}

/** Supporting copy in the sheet tab strip. */
export function StudioSheetDescription({
  className,
  ...props
}: ComponentProps<typeof SheetDescription>) {
  return (
    <SheetDescription
      {...props}
      className={cn(
        className,
        "min-w-0 flex-1 truncate whitespace-nowrap text-xs text-muted-foreground",
      )}
    />
  );
}

/** Scrollable sheet content area with consistent spacing and sizing behavior. */
export function StudioSheetBody({
  className,
  children,
  ...props
}: ComponentProps<"div"> & { children: ReactNode }) {
  return (
    <div
      {...props}
      className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", className)}
    >
      {children}
    </div>
  );
}

/** Footer mirrors the tab strip with a matching compact top edge. */
export function StudioSheetFooter({
  className,
  ...props
}: ComponentProps<typeof SheetFooter>) {
  return (
    <SheetFooter
      {...props}
      className={cn(
        className,
        "mt-auto flex min-h-9 shrink-0 flex-row items-center justify-end gap-1 border-t border-border bg-background px-3 py-2 [&_[data-slot=button]]:h-7 [&_[data-slot=button]]:rounded-md [&_[data-slot=button]]:px-2.5 [&_[data-slot=button]]:text-xs [&_[data-slot=button]]:font-normal",
      )}
    />
  );
}

/** Root + consistently styled shadcn sheet surface for complete sheet dialogs. */
export function StudioSheet({
  children,
  contentProps,
  ...rootProps
}: Omit<ComponentProps<typeof Sheet>, "children"> & {
  children: ReactNode;
  contentProps?: ComponentProps<typeof SheetContent>;
}) {
  return (
    <Sheet {...rootProps}>
      <StudioSheetContent {...contentProps}>{children}</StudioSheetContent>
    </Sheet>
  );
}
