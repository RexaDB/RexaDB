"use client";

import {
  StudioSheetContent as SheetContent,
  StudioSheetHeader as SheetHeader,
  StudioSheetFooter as SheetFooter,
  StudioSheetTitle as SheetTitle,
  StudioSheetDescription as SheetDescription,
} from "@/components/common/studio-sheet";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
} from "@/components/ui/sheet";
import { Loader2, Check, X, Trash2 } from "@/lib/icon-theme/lucide-react";
import { toast } from "sonner";
import { interpolateSqlParamsForDisplay } from "@/lib/studio/general-utils";
import { buildPendingEditsSql, countPendingCellEdits, countUnsaveablePendingRows, isNonSqlPreviewDbType } from "@/lib/studio/pending-changes-utils";

interface PendingAction {
  id: string;
  type: string;
  description: string;
  sql: string;
  params?: any[];
  metadata: any;
}

interface ReviewSheetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  pendingChanges: Record<string, any>;
  pendingActions: PendingAction[];
  onCommit: () => Promise<void>;
  onCancelCommit?: () => void;
  loading?: boolean;
  onClearPending: () => void;
  onRemoveAction?: (id: string) => void;
  selectedSchema?: string;
  selectedTable?: string;
  dbType?: string;
}

export function ReviewSheet({
  isOpen,
  onOpenChange,
  pendingChanges,
  pendingActions,
  onCommit,
  onCancelCommit,
  loading = false,
  onClearPending,
  onRemoveAction,
  selectedSchema = "",
  selectedTable = "",
  dbType = "postgres",
}: ReviewSheetProps) {
  const pendingChangesCount = countPendingCellEdits(pendingChanges);
  const pendingEditSql = useMemo(
    () => buildPendingEditsSql(pendingChanges, selectedSchema, selectedTable, dbType),
    [pendingChanges, selectedSchema, selectedTable, dbType],
  );
  const unsaveableRowsCount = useMemo(
    () => countUnsaveablePendingRows(pendingChanges),
    [pendingChanges],
  );
  const isNonSqlPreview = isNonSqlPreviewDbType(dbType);
  const hasMissingTable = !selectedTable?.trim();
  const pendingActionsCount = pendingActions.length;
  const totalItems = pendingChangesCount + pendingActionsCount;

  const groupedActions = useMemo(() => {
    const groups: Record<string, PendingAction[]> = {};
    pendingActions.forEach((action) => {
      const type = action.type;
      if (!groups[type]) groups[type] = [];
      groups[type].push(action);
    });
    return groups;
  }, [pendingActions]);

  const formatActionType = (type: string) => {
    return type
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  const handleCommit = async () => {
    try {
      await onCommit();
      toast.success("Changes committed successfully");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to commit changes");
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange} modal={false}>
      <SheetContent side="right" contained className="bg-background text-foreground flex flex-col p-0 gap-0">
        <SheetHeader className="h-12 border-b shrink-0 flex items-center px-4">
          <SheetTitle className="sr-only">Review Changes</SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            {totalItems} pending change{totalItems !== 1 ? "s" : ""}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {pendingChangesCount > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Cell Edits</h3>
                  <Badge variant="secondary">{pendingChangesCount}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {pendingChangesCount} cell edit{pendingChangesCount !== 1 ? "s" : ""} pending
                </div>
                {pendingEditSql.length > 0 && (
                  <div className="space-y-2">
                    {pendingEditSql.map((sql, index) => (
                      <pre key={index} className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-[10px] text-foreground">
                        {sql}
                      </pre>
                    ))}
                  </div>
                )}
                {pendingEditSql.length === 0 && isNonSqlPreview && (
                  <div className="text-xs text-muted-foreground">
                    SQL preview isn&apos;t available for {dbType} — these edits commit through the native driver.
                  </div>
                )}
                {pendingEditSql.length === 0 && !isNonSqlPreview && hasMissingTable && (
                  <div className="text-xs text-muted-foreground">
                    Select a table to preview these edits — switching schemas cleared the table selection but kept the pending edits.
                  </div>
                )}
                {unsaveableRowsCount > 0 && !isNonSqlPreview && !hasMissingTable && (
                  <div className="text-xs text-muted-foreground">
                    {unsaveableRowsCount} row{unsaveableRowsCount !== 1 ? "s" : ""} without a primary key can&apos;t be saved — commit will reject them.
                  </div>
                )}
              </div>
            )}

            {pendingActionsCount > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Actions</h3>
                  <Badge variant="secondary">{pendingActionsCount}</Badge>
                </div>
                <div className="space-y-2">
                  {Object.entries(groupedActions).map(([type, actions]) => (
                    <div key={type} className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium">{formatActionType(type)}</span>
                        <Badge variant="outline" className="text-xs">
                          {actions.length}
                        </Badge>
                      </div>
                      {actions.map((action) => (
                        <div
                          key={action.id}
                          className="p-2 rounded border bg-muted/50 text-xs space-y-1"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="flex-1 text-muted-foreground">
                              {action.description}
                            </span>
                            {onRemoveAction && (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="h-5 w-5 shrink-0"
                                onClick={() => onRemoveAction(action.id)}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                          {action.sql && (
                            <code className="block p-1 rounded bg-background/50 text-[10px] overflow-x-auto">
                              {action.params?.length
                                ? interpolateSqlParamsForDisplay(action.sql, action.params)
                                : action.sql}
                            </code>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {totalItems === 0 && (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No pending changes
              </div>
            )}
          </div>
        </ScrollArea>

        <Separator />

        <SheetFooter className="p-4 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onClearPending}
            disabled={totalItems === 0 || loading}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Clear All
          </Button>
          {loading && onCancelCommit && (
            <Button
              variant="outline"
              size="sm"
              onClick={onCancelCommit}
            >
              <X className="h-4 w-4 mr-2" />
              Stop Commit
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleCommit}
            disabled={totalItems === 0 || loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Check className="h-4 w-4 mr-2" />
            )}
            Commit Changes
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
