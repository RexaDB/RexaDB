"use client";

import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AlertCircle } from "@/lib/icon-theme/lucide-react";

export interface DeleteConfirmDialogProps {
  title: string;
  description: ReactNode;
  onConfirm: () => void;
  /** Controlled open state. Omit for uncontrolled (trigger-only) usage. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Element that opens the dialog (rendered via AlertDialogTrigger asChild). */
  trigger?: ReactNode;
  /** Async-busy state: disables buttons and swaps the confirm label. */
  loading?: boolean;
  loadingText?: string;
  /** Extra confirmation requirement state (e.g. folder delete option). */
  confirmDisabled?: boolean;
  /** Extra content rendered between description and footer. */
  children?: ReactNode;
  size?: "default" | "sm";
  contentClassName?: string;
}

/**
 * The single unified destructive confirmation dialog.
 *
 * Covers every delete and data-loss confirm (delete, empty/truncate):
 * the confirm button always reads "Delete" (or `loadingText` while busy).
 * For non-destructive confirmations use `useConfirm()` directly instead.
 */
export function DeleteConfirmDialog({
  title,
  description,
  onConfirm,
  open,
  onOpenChange,
  trigger,
  loading = false,
  loadingText = "Deleting...",
  confirmDisabled = false,
  children,
  size = "default",
  contentClassName,
}: DeleteConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {trigger ? (
        <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      ) : null}
      <AlertDialogContent size={size} className={contentClassName}>
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <AlertDialogTitle>{title}</AlertDialogTitle>
          </div>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter className="border-0 bg-transparent -mx-0 -mb-0 p-0 pt-2">
          <AlertDialogCancel variant="ghost" disabled={loading}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={loading || confirmDisabled}
            className="bg-red-600 border-transparent text-white hover:bg-red-500 hover:text-white"
            onClick={(e) => {
              // Keep close behavior controlled by the caller's open state.
              e.preventDefault();
              onConfirm();
            }}
          >
            {loading ? loadingText : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
