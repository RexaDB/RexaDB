"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2,
  Search,
  Table2,
  Layers,
  Key,
  CheckCircle2,
} from "@/lib/icon-theme/lucide-react";
import { fetchTables, fetchTableStructure } from "@/lib/api/actions-client";
import { Badge } from "@/components/ui/badge";
import { TargetTableSelect } from "./target-table-select";
import { CreateObjectShell } from "./create-object-common";

interface CreateIndexViewProps {
  connectionString: string;
  selectedSchema: string;
  onCreateIndex: (
    schema: string,
    table: string,
    name: string,
    columns: string[],
    unique: boolean,
    method: string,
  ) => Promise<void>;
  isCreating: boolean;
}

export function CreateIndexView({
  connectionString,
  selectedSchema,
  onCreateIndex,
  isCreating,
}: CreateIndexViewProps) {
  const [indexName, setIndexName] = useState("");
  const [selectedTable, setSelectedTable] = useState("");
  const [tables, setTables] = useState<string[]>([]);
  const [columns, setColumns] = useState<any[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [isUnique, setIsUnique] = useState(false);
  const [method, setMethod] = useState("btree");
  const [loadingTables, setLoadingTables] = useState(false);
  const [loadingColumns, setLoadingColumns] = useState(false);

  const indexMethods = ["btree", "hash", "gist", "gin", "brin"];

  useEffect(() => {
    async function loadTablesList() {
      setLoadingTables(true);
      try {
        const res = await fetchTables(connectionString, selectedSchema);
        if (res.success && res.data) {
          setTables(res.data);
        }
      } finally {
        setLoadingTables(false);
      }
    }
    loadTablesList();
  }, [connectionString, selectedSchema]);

  useEffect(() => {
    async function loadColumns() {
      if (!selectedTable) {
        setColumns([]);
        setSelectedColumns([]);
        return;
      }
      setLoadingColumns(true);
      try {
        const res = await fetchTableStructure(
          connectionString,
          selectedSchema,
          selectedTable,
        );
        if (res.success && res.data) {
          setColumns(res.data);
          setSelectedColumns([]);
        }
      } finally {
        setLoadingColumns(false);
      }
    }
    loadColumns();
  }, [connectionString, selectedSchema, selectedTable]);

  useEffect(() => {
    if (selectedTable && selectedColumns.length > 0 && !indexName) {
      const suggestedName = `${selectedTable}_${selectedColumns.join("_")}_idx`;
      setIndexName(suggestedName);
    }
  }, [selectedTable, selectedColumns]);

  const toggleColumn = (colName: string) => {
    setSelectedColumns((prev) =>
      prev.includes(colName)
        ? prev.filter((c) => c !== colName)
        : [...prev, colName],
    );
  };

  const handleSubmit = () => {
    if (!indexName || !selectedTable || selectedColumns.length === 0) return;
    onCreateIndex(
      selectedSchema,
      selectedTable,
      indexName,
      selectedColumns,
      isUnique,
      method,
    );
  };

  return (
    <CreateObjectShell
      title="Create a new index"
      description="Improve query performance by indexing columns in"
      schema={selectedSchema}
      isCreating={isCreating}
      submitDisabled={
        !indexName.trim() ||
        !selectedTable ||
        selectedColumns.length === 0 ||
        isCreating
      }
      submitLabel="Create Index"
      onSubmit={handleSubmit}
    >
      {/* Left Column: Config */}
      <div className="space-y-8">
        <TargetTableSelect
          selectedTable={selectedTable}
          onSelectTable={setSelectedTable}
          tables={tables}
          loadingTables={loadingTables}
        />

        <div className="space-y-4">
          <Label
            htmlFor="indexName"
            className="text-xs font-boldtracking-widest text-muted-foreground flex items-center gap-2"
          >
            <Search className="w-3.5 h-3.5" />
            Index Name
          </Label>
          <Input
            id="indexName"
            value={indexName}
            onChange={(e) => setIndexName(e.target.value)}
            placeholder="e.g. users_email_idx"
            className="bg-secondary/30 border-border text-foreground focus-visible:ring-blue-500/50 h-10"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-4">
            <Label className="text-xs font-boldtracking-widest text-muted-foreground">
              Method
            </Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="bg-secondary/30 border-border h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {indexMethods.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-4">
            <Label className="text-xs font-boldtracking-widest text-muted-foreground">
              Constraint
            </Label>
            <div className="flex items-center space-x-2 h-10 px-3 rounded-lg bg-secondary/30 border border-border">
              <Checkbox
                id="unique"
                checked={isUnique}
                onCheckedChange={(checked) => setIsUnique(!!checked)}
              />
              <Label
                htmlFor="unique"
                className="text-xs cursor-pointer select-none font-medium"
              >
                Unique Index
              </Label>
            </div>
          </div>
        </div>
      </div>

      {/* Right Column: Column Selection */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <Label className="text-xs font-boldtracking-widest text-muted-foreground flex items-center gap-2">
            <Layers className="w-3.5 h-3.5" />
            Select Columns
          </Label>
          {selectedColumns.length > 0 && (
            <Badge
              variant="secondary"
              className="text-xs bg-blue-500/10 text-blue-500 border-none"
            >
              {selectedColumns.length} selected
            </Badge>
          )}
        </div>

        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
          {!selectedTable ? (
            <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed border-border rounded-lg opacity-50">
              <Table2 className="w-8 h-8 text-muted-foreground mb-3" />
              <p className="text-xs text-muted-foreground">
                Select a table first to see its columns
              </p>
            </div>
          ) : loadingColumns ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          ) : columns.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-xs">
              No columns found for this table.
            </div>
          ) : (
            columns.map((col) => (
              <div
                key={col.column_name}
                onClick={() => toggleColumn(col.column_name)}
                className={`
                  flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all
                  ${
                    selectedColumns.includes(col.column_name)
                      ? "bg-blue-500/5 border-blue-500/30 ring-1 ring-blue-500/20"
                      : "bg-secondary/10 border-border hover:border-border/80 hover:bg-secondary/20"
                  }
                `}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`
                    w-4 h-4 rounded border flex items-center justify-center transition-colors
                    ${selectedColumns.includes(col.column_name) ? "bg-blue-500 border-blue-500" : "border-muted-foreground/30"}
                  `}
                  >
                    {selectedColumns.includes(col.column_name) && (
                      <CheckCircle2 className="w-3 h-3 text-primary-foreground" />
                    )}
                  </div>
                  <div className="flex flex-col">
                    <span
                      className={`text-xs font-bold ${selectedColumns.includes(col.column_name) ? "text-foreground" : "text-foreground/80"}`}
                    >
                      {col.column_name}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {col.data_type}
                    </span>
                  </div>
                </div>
                {col.is_primary_key && (
                  <Badge
                    variant="outline"
                    className="text-xs tracking-tighter bg-amber-500/5 text-amber-600 border-amber-500/20 gap-1 px-1.5 h-5"
                  >
                    <Key className="w-2.5 h-2.5" />
                    PK
                  </Badge>
                )}
              </div>
            ))
          )}
        </div>
        {selectedTable && columns.length > 0 && (
          <p className="text-xs text-muted-foreground text-center italic mt-4">
            Multicolumn indexes are supported. Select columns in the order you
            want them in the index.
          </p>
        )}
      </div>
    </CreateObjectShell>
  );
}
