"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetTitle,
} from "@/components/ui/sheet";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FieldError, slugifyPaykitId } from "./product-sheet";
import { validatePaykitId } from "@/lib/supabase-paykit/validation";
import type {
  PaykitFeatureDraft,
  PaykitFeatureType,
} from "@/lib/supabase-paykit/types";

interface FeatureSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  takenIds: Set<string>;
  onAdd: (feature: PaykitFeatureDraft) => void;
  /** When set, the sheet edits an existing feature instead of creating one. */
  initialFeature?: PaykitFeatureDraft | null;
  title?: string;
  submitLabel?: string;
}

export function FeatureSheet({
  open,
  onOpenChange,
  takenIds,
  onAdd,
  initialFeature = null,
  title = "Create feature",
  submitLabel = "Create feature",
}: FeatureSheetProps) {
  const [name, setName] = useState("");
  const [lookupKey, setLookupKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [type, setType] = useState<PaykitFeatureType>("boolean");
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Fresh form every time the sheet opens (prefilled when editing).
  useEffect(() => {
    if (!open) return;
    setName(initialFeature?.description ?? "");
    setLookupKey(initialFeature?.id ?? "");
    setKeyTouched(Boolean(initialFeature));
    setType(initialFeature?.type ?? "boolean");
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  const submit = () => {
    const nextErrors: Record<string, string> = {};
    const idErr = validatePaykitId(lookupKey);
    if (idErr) nextErrors.lookupKey = idErr;
    else if (takenIds.has(lookupKey.trim())) {
      nextErrors.lookupKey = "This lookup key is already used by another feature.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const trimmedName = name.trim();
    onAdd({
      id: lookupKey.trim(),
      type,
      ...(trimmedName ? { description: trimmedName } : {}),
    });
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        contained
        className="flex w-[min(480px,85vw)] flex-col gap-0 p-0"
        resizeHandleLabel="Resize feature panel"
        minResizeWidth={360}
        showCloseButton={false}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-6 py-4">
          <SheetTitle className="text-xl font-semibold tracking-tight">
            {title}
          </SheetTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">Feature name</span>
            <span className="text-xs text-muted-foreground">
              This won&apos;t be shown to customers.
            </span>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!keyTouched) setLookupKey(slugifyPaykitId(e.target.value));
              }}
              placeholder="Messages"
              className="h-10 rounded-lg text-sm"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">
              Lookup key <span className="font-normal text-muted-foreground">(required)</span>
            </span>
            <span className="text-xs text-muted-foreground">
              A unique key you provide as your own identifier to support
              easier retrieval.
            </span>
            <Input
              value={lookupKey}
              onChange={(e) => {
                setKeyTouched(true);
                setLookupKey(e.target.value.trim());
              }}
              placeholder="messages"
              className={cn(
                "h-10 rounded-lg font-mono text-xs",
                errors.lookupKey && "border-destructive",
              )}
            />
            <FieldError message={errors.lookupKey} />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">Type</span>
            <span className="text-xs text-muted-foreground">
              Boolean features gate access; metered features track usage
              against a limit.
            </span>
            <div className="grid grid-cols-2 gap-2">
              {(["boolean", "metered"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setType(v)}
                  className={cn(
                    "h-11 rounded-lg border text-sm font-medium capitalize transition-colors",
                    type === v
                      ? "border-primary/60 bg-primary/5 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        <SheetFooter className="flex-row justify-end gap-2 border-t border-border px-6 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit}>
            {submitLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
