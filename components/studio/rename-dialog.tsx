"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Dispatch, SetStateAction } from "react";

interface RenameDialogProps {
  open: boolean;
  onCancel: () => void;
  editName: string;
  onEditNameChange: Dispatch<SetStateAction<string>>;
  onSave: () => void;
  type: "folder" | "snippet";
}

export function RenameDialog({
  open,
  onCancel,
  editName,
  onEditNameChange,
  onSave,
  type,
}: RenameDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {type === "folder" ? "Rename Folder" : "Rename Snippet"}
          </DialogTitle>
        </DialogHeader>
        <div className="py-2">
          <Input
            placeholder="Name"
            value={editName}
            onChange={(e) => onEditNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSave();
              }
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
