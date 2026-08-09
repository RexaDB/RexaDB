"use client";

import { X, Palette, Check } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";

export function ThemePanelHeader({
  title,
  onClose,
  closeBtnClass = "rounded-sm",
}: {
  title: string;
  onClose: () => void;
  closeBtnClass?: string;
}) {
  return (
    <div className="flex h-[44px] items-center justify-between border-b border-studio-border px-3">
      <div className="flex items-center gap-2">
        <Palette className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{title}</span>
      </div>
      <button
        type="button"
        onClick={onClose}
        className={`flex h-6 w-6 items-center justify-center ${closeBtnClass} text-muted-foreground hover:bg-studio-border/30 hover:text-foreground transition-colors`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function ThemePanelFooter({
  hasChanges,
  onResetAll,
  onDiscard,
  onSave,
  saveLabel = "Save Theme",
}: {
  hasChanges: boolean;
  onResetAll: () => void;
  onDiscard: () => void;
  onSave: () => void;
  saveLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between border-t border-studio-border px-3 py-2.5">
      <button
        type="button"
        onClick={onResetAll}
        disabled={!hasChanges}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
      >
        Reset All
      </button>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDiscard}
          className="h-7 text-xs"
        >
          Discard
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={onSave}
          disabled={!hasChanges}
          className="h-7 gap-1 text-xs"
        >
          <Check className="h-3 w-3" />
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
