import { useCallback } from "react";
import { toast } from "sonner";
import { fetchFunctions, runQuery } from "@/lib/api/actions-client";
import { generateActionId, executeSqlWithHistory } from "@/lib/studio/execute-with-review";

interface UseFunctionManagementProps {
  currentConnectionString: string;
  executionMode: 'direct' | 'review';
  confirm: (options: { title: string; description: string; variant: 'destructive' | 'default'; confirmText: string }) => Promise<boolean>;
  addHistoryEntry: (entry: any) => void;
  setPendingActions: (updater: (prev: any[]) => any[]) => void;
  setIsReviewSheetOpen: (open: boolean) => void;
  loadFunctions: () => void;
}

export function useFunctionManagement({
  currentConnectionString,
  executionMode,
  confirm,
  addHistoryEntry,
  setPendingActions,
  setIsReviewSheetOpen,
  loadFunctions,
}: UseFunctionManagementProps) {
  const handleDeleteFunction = useCallback(async (schema: string, functionName: string, args: string = "") => {
    const signature = args.trim();
    const qualifiedName = `"${schema}"."${functionName}"`;
    const sql = signature
      ? `DROP FUNCTION ${qualifiedName}(${signature})`
      : `DROP FUNCTION ${qualifiedName}`;

    if (executionMode === 'review') {
      setPendingActions(prev => [...prev, {
        id: generateActionId(),
        type: 'delete_function',
        description: `Delete function "${schema}"."${functionName}"${signature ? `(${signature})` : ''}`,
        sql,
        metadata: { schema, name: functionName, args: signature }
      }]);
      setIsReviewSheetOpen(true);
      return;
    }

    const isConfirmed = await confirm({
      title: "Delete Function",
      description: `Are you sure you want to delete function "${schema}"."${functionName}"${signature ? `(${signature})` : ''}? This action cannot be undone.`,
      variant: "destructive",
      confirmText: "Delete"
    });

    if (!isConfirmed) return;

    try {
      const { success, error } = await executeSqlWithHistory(runQuery, currentConnectionString, sql, addHistoryEntry);
      if (success) {
        toast.success("Function deleted successfully");
        loadFunctions();
      } else {
        toast.error(error || "Failed to delete function");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete function");
    }
  }, [currentConnectionString, executionMode, confirm, loadFunctions, runQuery, addHistoryEntry, setPendingActions, setIsReviewSheetOpen]);

  const handleUpdateFunctionDefinition = useCallback(async (
    schema: string,
    functionName: string,
    args: string,
    definition: string
  ) => {
    const signature = args.trim();
    const normalizedSql = (definition || "").trim();

    if (!normalizedSql) {
      toast.error("Function definition cannot be empty");
      return false;
    }

    const sql = normalizedSql.replace(
      /^\s*create\s+function\b/i,
      "CREATE OR REPLACE FUNCTION"
    );

    if (executionMode === "review") {
      setPendingActions(prev => [
        ...prev,
        {
          id: generateActionId(),
          type: "update_function",
          description: `Update function \"${schema}\".\"${functionName}\"${signature ? `(${signature})` : ""}`,
          sql,
          metadata: { schema, name: functionName, args: signature }
        }
      ]);
      setIsReviewSheetOpen(true);
      return true;
    }

    try {
      const { success, error } = await executeSqlWithHistory(runQuery, currentConnectionString, sql, addHistoryEntry);
      if (!success) {
        toast.error(error || "Failed to update function");
        return false;
      }

      toast.success("Function updated successfully");
      await loadFunctions();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update function");
      return false;
    }
  }, [currentConnectionString, executionMode, runQuery, addHistoryEntry, loadFunctions, setPendingActions, setIsReviewSheetOpen]);

  return {
    handleDeleteFunction,
    handleUpdateFunctionDefinition,
  };
}
