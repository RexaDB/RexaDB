import React, { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSheetCloseConfirm } from "@/hooks/use-sheet-close-confirm";
import { useGlobalStudioSettings } from "@/hooks/use-global-studio-settings";
import { Link2 } from "@/lib/icon-theme/lucide-react";

function FkActionSelect({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="text-xs">
          <SelectValue placeholder="Select action" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="NO ACTION">NO ACTION</SelectItem>
          <SelectItem value="RESTRICT">RESTRICT</SelectItem>
          <SelectItem value="CASCADE">CASCADE</SelectItem>
          <SelectItem value="SET NULL">SET NULL</SelectItem>
          <SelectItem value="SET DEFAULT">SET DEFAULT</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

interface AddFKSheetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  data: {
    sourceSchema: string;
    sourceTable: string;
    sourceColumn: string;
    targetSchema: string;
    targetTable: string;
    targetColumn: string;
  } | null;
  onConfirm: (data: any) => void;
}

export function AddFKSheet({
  isOpen,
  onOpenChange,
  data,
  onConfirm,
}: AddFKSheetProps) {
  const [constraintName, setConstraintName] = useState("");
  const [onUpdate, setOnUpdate] = useState("NO ACTION");
  const [onDelete, setOnDelete] = useState("NO ACTION");

  const { appShellLayout, confirmSheetClose } = useGlobalStudioSettings();

  useEffect(() => {
    if (data && isOpen) {
      setConstraintName(
        `fk_${data.sourceTable}_${data.sourceColumn}_${data.targetTable}`,
      );
    }
  }, [data, isOpen]);

  const handleConfirm = () => {
    if (!data) return;
    onConfirm({
      ...data,
      constraintName,
      onUpdate,
      onDelete,
    });
  };

  const defaultConstraintName = data
    ? `fk_${data.sourceTable}_${data.sourceColumn}_${data.targetTable}`
    : "";
  const isDirty =
    constraintName !== defaultConstraintName ||
    onUpdate !== "NO ACTION" ||
    onDelete !== "NO ACTION";
  const { handleInteractOutside, ConfirmDialog } = useSheetCloseConfirm(
    isDirty,
    confirmSheetClose,
    () => onOpenChange(false),
  );

  if (!data) return null;

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        contained={appShellLayout}
        onInteractOutside={handleInteractOutside}
        className="bg-background border-border text-foreground sm:max-w-md flex flex-col p-0 gap-0"
      >
        {ConfirmDialog}
        <SheetHeader className="p-6 border-b shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <Link2 className="w-5 h-5 text-primary" />
            <SheetTitle>Create Foreign Key</SheetTitle>
          </div>
          <SheetDescription>
            Creating a relationship between{" "}
            <span className="font-mono text-primary">
              {data.sourceTable}.{data.sourceColumn}
            </span>{" "}
            and{" "}
            <span className="font-mono text-primary">
              {data.targetTable}.{data.targetColumn}
            </span>
            .
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-auto p-6 space-y-6">
          <div className="space-y-2">
            <Label htmlFor="constraint-name">Constraint Name</Label>
            <Input
              id="constraint-name"
              value={constraintName}
              onChange={(e) => setConstraintName(e.target.value)}
              className="font-mono text-xs"
              placeholder="fk_table_column_ref"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FkActionSelect
              label="On Update"
              value={onUpdate}
              onValueChange={setOnUpdate}
            />
            <FkActionSelect
              label="On Delete"
              value={onDelete}
              onValueChange={setOnDelete}
            />
          </div>

          <div className="p-4 rounded-lg bg-muted/50 border border-border/50 space-y-2">
            <p className="text-xs font-bold text-muted-foregroundtracking-wider">
              Preview DDL
            </p>
            <code className="text-xs block whitespace-pre-wrap break-all text-primary/90 font-mono leading-relaxed">
              ALTER TABLE "{data.sourceSchema}"."{data.sourceTable}"{"\n"}
              ADD CONSTRAINT "{constraintName}"{"\n"}
              FOREIGN KEY ("{data.sourceColumn}"){"\n"}
              REFERENCES "{data.targetSchema}"."{data.targetTable}" ("
              {data.targetColumn}"){"\n"}
              ON UPDATE {onUpdate} ON DELETE {onDelete};
            </code>
          </div>
        </div>

        <SheetFooter className="p-6 border-t bg-muted/5 shrink-0">
          <div className="flex gap-2 w-full">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={handleConfirm}
            >
              Create Relationship
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
