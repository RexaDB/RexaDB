"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table2 } from "@/lib/icon-theme/lucide-react";

interface TargetTableSelectProps {
  selectedTable: string;
  onSelectTable: (table: string) => void;
  tables: string[];
  loadingTables: boolean;
}

export function TargetTableSelect({
  selectedTable,
  onSelectTable,
  tables,
  loadingTables,
}: TargetTableSelectProps) {
  return (
    <div className="space-y-4">
      <Label className="text-xs font-bold tracking-widest text-muted-foreground flex items-center gap-2">
        <Table2 className="w-3.5 h-3.5" />
        Target Table
      </Label>
      <Select value={selectedTable} onValueChange={onSelectTable}>
        <SelectTrigger className="bg-secondary/30 border-border h-10">
          <SelectValue
            placeholder={
              loadingTables ? "Loading tables..." : "Select a table"
            }
          />
        </SelectTrigger>
        <SelectContent>
          {tables.map((table) => (
            <SelectItem key={table} value={table}>
              {table}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
