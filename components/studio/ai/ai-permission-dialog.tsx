"use client";

import { Check } from "@/lib/icon-theme/lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GlobalAiSettings } from "@/lib/api/actions-client";
import { cn } from "@/lib/utils";

const options: Array<{
  value: GlobalAiSettings["permissionMode"];
  title: string;
  description: string;
}> = [
  {
    value: "schema_only",
    title: "Schema only",
    description:
      "The assistant can inspect tables, columns, and structure, but not read database rows.",
  },
  {
    value: "schema_with_data",
    title: "Schema with database data (read only)",
    description:
      "The assistant can inspect schema and read database data through read-only access.",
  },
];

export function AiPermissionDialog({
  isOpen,
  permissionMode,
  onClose,
  onConfirm,
  onSelect,
}: {
  isOpen: boolean;
  permissionMode: GlobalAiSettings["permissionMode"];
  onClose: () => void;
  onConfirm: () => void;
  onSelect: (value: GlobalAiSettings["permissionMode"]) => void;
}) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => (!next ? onClose() : undefined)}
    >
      <DialogContent
        className="z-[90] sm:max-w-[460px]"
        overlayClassName="z-[85] bg-black/35 supports-backdrop-filter:backdrop-blur-md"
      >
        <DialogHeader>
          <DialogTitle>Permissions</DialogTitle>
          <DialogDescription>
            Choose how much access the assistant has in this chat.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {options.map((option) => {
            const isSelected = permissionMode === option.value;

            return (
              <button
                key={option.value}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border border-border px-4 py-3 text-left transition-colors hover:bg-muted/40",
                  isSelected && "bg-muted/30",
                )}
                onClick={() => onSelect(option.value)}
                type="button"
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-lg border",
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border",
                  )}
                >
                  {isSelected ? <Check className="h-3 w-3" /> : null}
                </span>
                <span className="space-y-1">
                  <span className="block text-sm font-medium text-foreground">
                    {option.title}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <DialogFooter>
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button onClick={onConfirm}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
