import { Loader2 } from "@/lib/icon-theme/lucide-react";
import {
  X,
  Download,
  Copy,
  Trash2,
  FileJson,
  FileText,
  Database as SqlIcon,
  AlertCircle,
} from "@/lib/icon-theme/solar-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface ToolbarSelectionActionsProps {
  selectedRows: Set<number>;
  setSelectedRows: (rows: Set<number>) => void;
  exportData: (format: "json" | "csv" | "sql") => void;
  copyData: (format: "json" | "csv" | "sql") => void;
  handleDeleteRows: () => void;
  isDeleting: boolean;
  deleteDisabled?: boolean;
}

export function ToolbarSelectionActions({
  selectedRows,
  setSelectedRows,
  exportData,
  copyData,
  handleDeleteRows,
  isDeleting,
  deleteDisabled = false,
}: ToolbarSelectionActionsProps) {
  if (selectedRows.size === 0) return null;

  return (
    <>
      <div className="flex items-center gap-2 pr-4 border-r border-border mr-2">
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => setSelectedRows(new Set())}
        >
          <X className="w-4 h-4" />
        </Button>
        <span className="text-xs text-blue-500">
          {selectedRows.size} selected
        </span>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="font-normal"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuLabel className="text-xs tracking-wider text-muted-foreground">
            Download format
          </DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => exportData("json")}
            className="gap-2"
          >
            <FileJson className="w-4 h-4 text-orange-500" /> JSON
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => exportData("csv")} className="gap-2">
            <FileText className="w-4 h-4 text-green-500" /> CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => exportData("sql")} className="gap-2">
            <SqlIcon className="w-4 h-4 text-blue-500" /> SQL (Inserts)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="font-normal"
          >
            <Copy className="w-3.5 h-3.5" />
            Copy
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuLabel className="text-xs tracking-wider text-muted-foreground">
            Copy to clipboard
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={() => copyData("json")} className="gap-2">
            <FileJson className="w-4 h-4 text-orange-500" /> JSON
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => copyData("csv")} className="gap-2">
            <FileText className="w-4 h-4 text-green-500" /> CSV (TSV)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => copyData("sql")} className="gap-2">
            <SqlIcon className="w-4 h-4 text-blue-500" /> SQL (Inserts)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="text-red-500 hover:text-red-600 hover:bg-red-500/10 font-normal"
            disabled={isDeleting || deleteDisabled}
          >
            {isDeleting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
            Delete
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-500" />
              <AlertDialogTitle>
                Delete {selectedRows.size} rows?
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription>
              Are you sure you want to delete the selected rows? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteDisabled}
              onClick={handleDeleteRows}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
