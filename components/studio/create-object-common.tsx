"use client";

import { Loader2 } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";

interface CreateObjectShellProps {
  title: string;
  description: string;
  schema: string;
  isCreating: boolean;
  submitDisabled: boolean;
  submitLabel: string;
  onSubmit: () => void;
  children: React.ReactNode;
}

export function CreateObjectShell({
  title,
  description,
  schema,
  isCreating,
  submitDisabled,
  submitLabel,
  onSubmit,
  children,
}: CreateObjectShellProps) {
  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <div className="p-6 border-b border-border bg-muted/30">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
              {title}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {description}
              <span className="text-foreground font-mono font-bold bg-muted px-1 rounded ml-1">
                {schema}
              </span>
              .
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={onSubmit}
              disabled={submitDisabled}
              className="bg-primary hover:bg-primary/90 text-primary-foreground h-9 px-6 text-xs font-bold"
            >
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                submitLabel
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
          {children}
        </div>
      </div>
    </div>
  );
}
