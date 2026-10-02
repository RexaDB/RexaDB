"use client";

import {
  StudioSheet,
  StudioSheetFooter,
  StudioSheetHeader,
  StudioSheetTitle,
} from "@/components/common/studio-sheet";
import { Button } from "@/components/ui/button";
import { X } from "@/lib/icon-theme/lucide-react";
import { JsonCodeEditor } from "./json-code-editor";

export interface JsonCellEditorState {
  columnName: string;
  value: string;
  isModified: boolean;
}

export function JsonCellEditorSheet({
  editor,
  error,
  onValueChange,
  onSave,
  onCancel,
  onSetNull,
  onDiscard,
}: {
  editor: JsonCellEditorState | null;
  error: string | null;
  onValueChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onSetNull: () => void;
  onDiscard: () => void;
}) {
  return (
    <StudioSheet
      open={!!editor}
      onOpenChange={() => undefined}
      modal={false}
      contentProps={{
        side: "right",
        contained: true,
        showCloseButton: false,
        onEscapeKeyDown: (event) => {
          event.preventDefault();
          onCancel();
        },
        className: "w-[min(800px,92vw)] sm:max-w-none",
      }}
    >
      {editor && (
        <>
          <StudioSheetHeader>
            <StudioSheetTitle>Edit {editor.columnName}</StudioSheetTitle>
          </StudioSheetHeader>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-1 right-3 z-10"
            onClick={onCancel}
            aria-label="Close JSON editor"
          >
            <X className="size-4" />
          </Button>
          <JsonCodeEditor value={editor.value} onChange={onValueChange} />
          {error && <div className="border-t border-destructive/30 px-4 py-2 text-xs text-destructive">{error}</div>}
          <StudioSheetFooter className="flex-row justify-end gap-2 px-3 py-2.5">
            {editor.isModified && (
              <Button type="button" variant="ghost" size="sm" onClick={onDiscard} className="text-amber-500 hover:text-amber-400">
                Discard change
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={onSetNull}>
              Set NULL
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={onSave}>
              Save pending
            </Button>
          </StudioSheetFooter>
        </>
      )}
    </StudioSheet>
  );
}
