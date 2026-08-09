"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SqlEditorEngine } from "@/lib/studio/types";

export function SqlEditorEngineSetting({
  value,
  onChange,
}: {
  value: SqlEditorEngine;
  onChange: (value: SqlEditorEngine) => void;
}) {
  return (
    <div className="space-y-1.5 border-t border-border py-3">
      <div className="flex flex-col">
        <span className="font-medium text-xs">SQL Editor Engine</span>
        <span className="text-xs text-muted-foreground">
          Use the custom lightweight editor or Monaco with built-in editor features.
        </span>
      </div>
      <Select value={value} onValueChange={(next) => onChange(next as SqlEditorEngine)}>
        <SelectTrigger className="h-8 w-44 bg-secondary/50 border-border text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-popover border-border">
          <SelectItem value="custom">Custom</SelectItem>
          <SelectItem value="monaco">Monaco</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
