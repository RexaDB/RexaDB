import React, { useEffect, useMemo } from 'react';
import { Key, Link as LinkIcon, Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { useSheetCloseConfirm } from '@/hooks/use-sheet-close-confirm';
import { useGlobalStudioSettings } from '@/hooks/use-global-studio-settings';

interface InsertRowSheetProps {
  isInsertSheetOpen: boolean;
  setIsInsertSheetOpen: (open: boolean) => void;
  selectedTable: string | null;
  tableStructure: any[];
  insertData: Record<string, string>;
  setInsertData: (data: Record<string, string>) => void;
  handleInsertRow: () => void;
  handleInsertFKSelection: (columnName: string) => Promise<boolean> | boolean | void;
  loading: boolean;
  isFKSelectionSheetOpen?: boolean;
}

export function InsertRowSheet({
  isInsertSheetOpen,
  setIsInsertSheetOpen,
  selectedTable,
  tableStructure,
  insertData,
  setInsertData,
  handleInsertRow,
  handleInsertFKSelection,
  loading,
  isFKSelectionSheetOpen = false,
}: InsertRowSheetProps) {
  useEffect(() => {
    if (isInsertSheetOpen) setInsertData({});
  }, [isInsertSheetOpen]);

  const { confirmSheetClose } = useGlobalStudioSettings();
  const isDirty = useMemo(() => Object.values(insertData).some(v => v !== ''), [insertData]);
  const { handleInteractOutside, ConfirmDialog } = useSheetCloseConfirm(isDirty, confirmSheetClose, () => setIsInsertSheetOpen(false));

  const handleSheetInteractOutside = (e: Event) => {
    // The FK record picker opens on top of this sheet and steals focus, which Radix
    // reports as an "outside" interaction on this Content - ignore it so we don't get
    // dismissed while the picker is open. Radix defers the outside-check for pointerdown
    // events by a tick, so a click on the picker's own Continue/Cancel button can arrive
    // here after isFKSelectionSheetOpen has already flipped false - check the event target
    // itself (rather than only the current open state) to cover that case too.
    const target = e.target as Element | null;
    if (isFKSelectionSheetOpen || target?.closest?.('[data-fk-selection-sheet]')) {
      e.preventDefault();
      return;
    }
    handleInteractOutside(e);
  };

  return (
    <Sheet open={isInsertSheetOpen} onOpenChange={(open) => { setIsInsertSheetOpen(open); if (!open) setInsertData({}); }} modal={false}>
      <SheetContent side="right" contained onInteractOutside={handleSheetInteractOutside} className="bg-background text-foreground flex flex-col p-0 gap-0">
        {ConfirmDialog}
        <div className="flex flex-col h-full">
          <SheetHeader className="h-12 border-b shrink-0 flex items-center px-4">
            <SheetTitle className="sr-only">Insert row{selectedTable ? ` into ${selectedTable}` : ""}</SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              Add a new record to <span className="font-mono text-primary bg-primary/10 px-1 rounded">{selectedTable}</span>.
            </SheetDescription>
          </SheetHeader>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {tableStructure.map((col) => (
              <div key={col.column_name} className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      {(col.is_primary_key === true || (col.is_primary_key as any) === 't') && (
                        <Key className="w-3 h-3 text-yellow-500 shrink-0" />
                      )}
                      {(col.is_foreign_key === true || (col.is_foreign_key as any) === 't') && (
                        <LinkIcon className="w-3 h-3 text-primary shrink-0" />
                      )}
                      <Label htmlFor={col.column_name} className="text-xs font-semibold text-foreground/80">
                        {col.column_name}
                      </Label>
                    </div>
                    {col.is_nullable === 'NO' && !col.column_default && (
                      <span className="text-xs text-red-500 font-bold" title="Required">*</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {(col.is_primary_key === true || (col.is_primary_key as any) === 't') && col.column_default && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 font-medium text-primary tracking-tight">
                        Auto
                      </span>
                    )}
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted font-mono text-muted-foreground tracking-tight">
                      {col.data_type}
                    </span>
                  </div>
                </div>
                
                <div className="relative group">
                  <Input
                    id={col.column_name}
                    placeholder={
                      (col.is_primary_key === true || (col.is_primary_key as any) === 't') && col.column_default 
                        ? "Auto-generated ID" 
                        : col.column_default 
                          ? `Default: ${col.column_default}` 
                          : (col.is_nullable === 'YES' ? 'NULL' : 'Required...')
                    }
                    value={insertData[col.column_name] || ''}
                    onChange={(e) => setInsertData({ ...insertData, [col.column_name]: e.target.value })}
                    className="h-10 font-mono text-xs bg-secondary/30 border-border focus-visible:ring-primary/50 transition-all text-foreground placeholder:text-muted-foreground/30"
                  />
                  {col.is_nullable === 'YES' && !insertData[col.column_name] && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-focus-within:opacity-100 transition-opacity pointer-events-none">
                      <span className="text-xs text-muted-foreground/50 italic">will be NULL</span>
                    </div>
                  )}
                </div>
                {(col.is_foreign_key === true || (col.is_foreign_key as any) === 't') && (
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => { void handleInsertFKSelection(col.column_name); }}
                      className="h-7 px-2 text-xs gap-1 text-primary hover:text-primary hover:bg-primary/10"
                    >
                      <LinkIcon className="w-3 h-3" />
                      Choose record
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
          
          <SheetFooter className="p-4 border-t border-border bg-muted/5 mt-auto flex-row justify-end gap-3 shrink-0">
            <Button 
              variant="ghost" 
              onClick={() => { setIsInsertSheetOpen(false); setInsertData({}); }}
              className="text-xs font-medium h-9 text-muted-foreground hover:text-foreground hover:bg-secondary"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleInsertRow} 
              disabled={loading}
              className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold px-6 h-9 gap-2"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Save Row
            </Button>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
}
