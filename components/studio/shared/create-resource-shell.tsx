"use client";

import { Button } from "@/components/ui/button";
import { Loader2 } from "@/lib/icon-theme/lucide-react";

interface CreateResourceShellProps {
  title: string;
  description: string;
  buttonLabel: string;
  onSubmit: () => void;
  disabled: boolean;
  isCreating: boolean;
  children: React.ReactNode;
}

export function CreateResourceShell({
  title,
  description,
  buttonLabel,
  onSubmit,
  disabled,
  isCreating,
  children,
}: CreateResourceShellProps) {
  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <div className="p-6 border-b border-border bg-muted/30">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
              {title}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {description}
            </p>
          </div>
          <Button
            onClick={onSubmit}
            disabled={disabled}
            className="bg-primary hover:bg-primary/90 text-primary-foreground h-9 px-6 text-xs font-bold "
          >
            {isCreating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              buttonLabel
            )}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-xl mx-auto space-y-8">
          {children}
        </div>
      </div>
    </div>
  );
}
