"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertCircle } from "@/lib/icon-theme/lucide-react";
import { cn } from "@/lib/utils";
import type { ConfirmDialogState } from "@/lib/studio/table-utils";

interface ConfirmDialogProps {
  state: ConfirmDialogState;
  setState: (state: React.SetStateAction<ConfirmDialogState>) => void;
}

export function ConfirmDialog({ state, setState }: ConfirmDialogProps) {
  return (
    <AlertDialog
      open={state.open}
      onOpenChange={(open) =>
        setState((prev) => ({ ...prev, open }))
      }
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            <AlertCircle
              className={cn(
                "w-5 h-5",
                state.variant === "destructive"
                  ? "text-red-500"
                  : "text-neutral-500",
              )}
            />
            <AlertDialogTitle>{state.title}</AlertDialogTitle>
          </div>
          <AlertDialogDescription>
            {state.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={state.variant || "default"}
            onClick={() => {
              state.onConfirm();
              setState((prev) => ({ ...prev, open: false }));
            }}
          >
            Confirm
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
