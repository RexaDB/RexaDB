import * as React from "react";
import { Filter, ArrowUpDown, Plus, X } from "@/lib/icon-theme/solar-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ConnectionDbType } from "@/lib/db/connection-type";

type SortRule = { column: string; direction: "ASC" | "DESC" };

interface ToolbarFilterSortProps {
  filterQuery: string;
  setFilterQuery: (query: string) => void;
  sortConfig: SortRule[];
  setSortConfig: (config: SortRule[]) => void;
  refreshTableData: (
    table: string,
    schema: string,
    filter: string,
    sort: SortRule[],
  ) => void;
  selectedTable: string | null;
  selectedSchema: string;
  results: { fields?: Array<{ name: string }> } | null;
  dbType?: ConnectionDbType;
  globalSearchQuery?: string;
  setGlobalSearchQuery?: (query: string) => void;
  setGlobalSearchScope?: (scope: "page" | "table") => void;
}

type FilterOperator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "starts_with"
  | "ends_with"
  | "is_null"
  | "is_not_null"
  | "none"
  | "";

interface FilterRule {
  id: string;
  enabled: boolean;
  column: string;
  operator: FilterOperator;
  value: string;
}

const FILTER_OPERATORS: Array<{ value: FilterOperator; label: string }> = [
  { value: "eq", label: "Equals" },
  { value: "ne", label: "Not equals" },
  { value: "contains", label: "Contains" },
  { value: "starts_with", label: "Starts with" },
  { value: "ends_with", label: "Ends with" },
  { value: "gt", label: "Greater than" },
  { value: "gte", label: "Greater or equal" },
  { value: "lt", label: "Less than" },
  { value: "lte", label: "Less or equal" },
  { value: "is_null", label: "Is null" },
  { value: "is_not_null", label: "Is not null" },
];

const SQL_TO_FILTER_OP: Record<string, FilterOperator> = {
  "=": "eq",
  "!=": "ne",
  "<>": "ne",
  ">": "gt",
  ">=": "gte",
  "<": "lt",
  "<=": "lte",
  LIKE: "contains",
  ILIKE: "contains",
  "NOT LIKE": "ne",
  "IS NULL": "is_null",
  "IS NOT NULL": "is_not_null",
};

function makeRule(defaultColumn = ""): FilterRule {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    enabled: true,
    column: defaultColumn || "none",
    operator: "none",
    value: "",
  };
}

function operatorNeedsValue(operator: FilterOperator): boolean {
  return (
    operator !== "is_null" &&
    operator !== "is_not_null" &&
    operator !== "none" &&
    operator !== ""
  );
}

function quoteIdentifier(
  name: string,
  dbType: ToolbarFilterSortProps["dbType"],
): string {
  // fallow-ignore-next-line code-duplication
  const raw = String(name || "");
  if (dbType === "mysql" || dbType === "clickhouse") {
    return `\`${raw.replace(/`/g, "``")}\``;
  }
  if (dbType === "mssql") {
    return `[${raw.replace(/]/g, "]]")}]`;
  }
  return `"${raw.replace(/"/g, '""')}"`;
}

function quoteString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function toSqlLiteral(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed.length) return "''";
  if (/^null$/i.test(trimmed)) return "NULL";
  if (/^true$/i.test(trimmed)) return "TRUE";
  if (/^false$/i.test(trimmed)) return "FALSE";
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  return quoteString(trimmed);
}

function buildRuleClause(
  rule: FilterRule,
  dbType: ToolbarFilterSortProps["dbType"],
): string | null {
  if (
    !rule.enabled ||
    !rule.column ||
    rule.column === "none" ||
    !rule.operator ||
    rule.operator === "none"
  )
    return null;
  if (operatorNeedsValue(rule.operator) && !rule.value.trim()) return null;

  const column = quoteIdentifier(rule.column, dbType);
  let literal = toSqlLiteral(rule.value);
  if (dbType === "mssql") {
    if (literal === "TRUE") literal = "1";
    if (literal === "FALSE") literal = "0";
  }

  switch (rule.operator) {
    case "eq":
      return literal === "NULL"
        ? `${column} IS NULL`
        : `${column} = ${literal}`;
    case "ne":
      return literal === "NULL"
        ? `${column} IS NOT NULL`
        : `${column} <> ${literal}`;
    case "gt":
      return `${column} > ${literal}`;
    case "gte":
      return `${column} >= ${literal}`;
    case "lt":
      return `${column} < ${literal}`;
    case "lte":
      return `${column} <= ${literal}`;
    case "contains":
      return dbType === "mssql"
        ? `CAST(${column} AS NVARCHAR(MAX)) LIKE ${quoteString(`%${rule.value.replace(/'/g, "''")}%`)}`
        : `CAST(${column} AS TEXT) LIKE ${quoteString(`%${rule.value.replace(/'/g, "''")}%`)}`;
    case "starts_with":
      return dbType === "mssql"
        ? `CAST(${column} AS NVARCHAR(MAX)) LIKE ${quoteString(`${rule.value.replace(/'/g, "''")}%`)}`
        : `CAST(${column} AS TEXT) LIKE ${quoteString(`${rule.value.replace(/'/g, "''")}%`)}`;
    case "ends_with":
      return dbType === "mssql"
        ? `CAST(${column} AS NVARCHAR(MAX)) LIKE ${quoteString(`%${rule.value.replace(/'/g, "''")}`)}`
        : `CAST(${column} AS TEXT) LIKE ${quoteString(`%${rule.value.replace(/'/g, "''")}`)}`;
    case "is_null":
      return `${column} IS NULL`;
    case "is_not_null":
      return `${column} IS NOT NULL`;
    default:
      return null;
  }
}

export function ToolbarFilterSort({
  filterQuery,
  setFilterQuery,
  sortConfig,
  setSortConfig,
  refreshTableData,
  selectedTable,
  selectedSchema,
  results,
  dbType = "postgres",
  globalSearchQuery,
  setGlobalSearchQuery,
  setGlobalSearchScope,
}: ToolbarFilterSortProps) {
  const columns = React.useMemo(
    () => results?.fields?.map((f) => f.name) ?? [],
    [results?.fields],
  );
  const firstColumn = columns[0] ?? "";
  const [isFilterMenuOpen, setIsFilterMenuOpen] = React.useState(false);
  const [draftRules, setDraftRules] = React.useState<FilterRule[]>([]);
  const [customWhere, setCustomWhere] = React.useState("");
  const [isSortPopoverOpen, setIsSortPopoverOpen] = React.useState(false);
  const [addSortColumn, setAddSortColumn] = React.useState("");
  const [localSorts, setLocalSorts] = React.useState<SortRule[]>(
    sortConfig ?? [],
  );

  // Autocomplete state
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const [cursorPos, setCursorPos] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const suggestionsRef = React.useRef<HTMLDivElement>(null);

  const operators = React.useMemo(
    () => [
      "=",
      "!=",
      "<>",
      ">",
      ">=",
      "<",
      "<=",
      "LIKE",
      "ILIKE",
      "IS NULL",
      "IS NOT NULL",
    ],
    [],
  );

  React.useEffect(() => {
    if (!isFilterMenuOpen || !customWhere.trim()) {
      setShowSuggestions(false);
      return;
    }

    const val = customWhere;
    const cursor = cursorPos;
    const beforeCursor = val.slice(0, cursor);
    const parts = beforeCursor.split(/\s+/).filter((p) => p.length > 0);
    const isAfterSpace = beforeCursor.endsWith(" ");
    const lastPart = isAfterSpace ? "" : parts[parts.length - 1] || "";

    // Identify if we already have an operator in the CURRENT condition segment.
    // We split by AND/OR to find the last segment before the cursor.
    const segments = beforeCursor.split(/\s+(?:AND|OR)\s+/i);
    const lastSegment = segments[segments.length - 1];
    const segmentParts = lastSegment.split(/\s+/).filter((p) => p.length > 0);

    // Check if any part of the last segment is a known operator.
    const hasOperator = segmentParts.some((p) => {
      const upperP = p.toUpperCase();
      return (
        operators.some((op) => op.toUpperCase() === upperP) ||
        Object.keys(SQL_TO_FILTER_OP).some((op) => op.toUpperCase() === upperP)
      );
    });

    // Also check for multi-word operators like 'IS NULL' in the whole segment
    const hasMultiWordOp = operators.some(
      (op) =>
        op.includes(" ") &&
        lastSegment.toUpperCase().includes(op.toUpperCase()),
    );

    // If an operator is already present in this segment, we shouldn't recommend anything (user is typing value)
    if (hasOperator || hasMultiWordOp) {
      setShowSuggestions(false);
      return;
    }

    let newSuggestions: string[] = [];

    if (isAfterSpace) {
      const prevWord = parts[parts.length - 1];
      const upperPrev = prevWord?.toUpperCase();
      if (prevWord && columns.includes(prevWord)) {
        newSuggestions = operators;
      } else if (upperPrev === "AND" || upperPrev === "OR") {
        newSuggestions = columns;
      } else {
        // Typed something that isn't a column or joiner, then space.
        // Don't recommend columns here.
        setShowSuggestions(false);
        return;
      }
    } else if (lastPart) {
      const columnMatches = columns.filter((c) =>
        c.toLowerCase().startsWith(lastPart.toLowerCase()),
      );
      const operatorMatches = operators.filter((o) =>
        o.toLowerCase().startsWith(lastPart.toLowerCase()),
      );
      newSuggestions = [...columnMatches, ...operatorMatches];
    } else {
      newSuggestions = columns;
    }

    setSuggestions(newSuggestions);
    setActiveIndex(0);
    setShowSuggestions(newSuggestions.length > 0);
  }, [customWhere, columns, operators, isFilterMenuOpen, cursorPos]);

  // Scroll active suggestion into view
  React.useEffect(() => {
    if (showSuggestions && suggestionsRef.current) {
      const activeEl = suggestionsRef.current.children[
        activeIndex
      ] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [activeIndex, showSuggestions]);

  const handleSuggestionSelect = React.useCallback(
    (suggestion: string) => {
      const val = customWhere;
      const cursor = inputRef.current?.selectionStart ?? val.length;
      const beforeCursor = val.slice(0, cursor);
      const afterCursor = val.slice(cursor);

      const isAfterSpace = beforeCursor.endsWith(" ");

      let newVal = "";
      if (isAfterSpace) {
        newVal = beforeCursor + suggestion + " " + afterCursor;
      } else {
        const lastSpaceIndex = beforeCursor.lastIndexOf(" ");
        const prefix =
          lastSpaceIndex === -1
            ? ""
            : beforeCursor.slice(0, lastSpaceIndex + 1);
        newVal = prefix + suggestion + " " + afterCursor;
      }

      setCustomWhere(newVal);
      setShowSuggestions(false);

      // Set focus back to input and move cursor
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          const newCursorPos = newVal.length - afterCursor.length;
          inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
          setCursorPos(newCursorPos);
        }
      }, 0);
    },
    [customWhere],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showSuggestions) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % suggestions.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex(
          (prev) => (prev - 1 + suggestions.length) % suggestions.length,
        );
      } else if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        handleSuggestionSelect(suggestions[activeIndex]);
      } else if (e.key === "Escape") {
        setShowSuggestions(false);
      }
    } else if (e.key === "Enter") {
      const val = customWhere.trim();
      if (!val) {
        handleApplyFilter();
        return;
      }

      // Try to parse the input into rules (split by AND/OR)
      const segments = val.split(/\s+(?:AND|OR)\s+/i);
      const parsedRules: FilterRule[] = [];
      const sortedColumns = [...columns].sort((a, b) => b.length - a.length);
      const sortedSqlOps = Object.keys(SQL_TO_FILTER_OP).sort(
        (a, b) => b.length - a.length,
      );

      for (const segment of segments) {
        let col = "none";
        let sqlOp = "none";
        let filterVal = "";
        const segmentTrimmed = segment.trim();

        for (const c of sortedColumns) {
          if (segmentTrimmed.toLowerCase().startsWith(c.toLowerCase())) {
            const rest = segmentTrimmed.slice(c.length).trim();
            for (const op of sortedSqlOps) {
              if (rest.toUpperCase().startsWith(op)) {
                col = c;
                sqlOp = op;
                filterVal = rest.slice(op.length).trim();
                break;
              }
            }
            break;
          }
        }

        if (col !== "none" && sqlOp !== "none") {
          const filterOp = SQL_TO_FILTER_OP[sqlOp.toUpperCase()];
          if (filterOp) {
            parsedRules.push({
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}-${parsedRules.length}`,
              enabled: true,
              column: col,
              operator: filterOp,
              value: filterVal,
            });
          }
        }
      }

      if (parsedRules.length > 0) {
        e.preventDefault();
        setDraftRules((prev) => {
          let updated = [...prev];
          // Replace placeholder if it's the only one
          if (
            updated.length === 1 &&
            (updated[0].column === "none" || !updated[0].column) &&
            (updated[0].operator === "none" || !updated[0].operator)
          ) {
            updated = [];
          }
          return [...updated, ...parsedRules];
        });
        setCustomWhere("");
        setShowSuggestions(false);
      } else {
        // If nothing was parsed but there is content, just apply the filter (keeps raw SQL in customWhere)
        handleApplyFilter();
      }
    }
  };

  React.useEffect(() => {
    if (!isSortPopoverOpen) return;
    setLocalSorts(sortConfig ?? []);
    setAddSortColumn("");
  }, [isSortPopoverOpen, sortConfig]);

  const availableSortColumns = React.useMemo(
    () =>
      columns.filter(
        (column) => !localSorts.some((rule) => rule.column === column),
      ),
    [columns, localSorts],
  );

  const hasSortChanges = React.useMemo(
    () => JSON.stringify(localSorts) !== JSON.stringify(sortConfig),
    [localSorts, sortConfig],
  );

  const handleAddSort = React.useCallback((column: string) => {
    setLocalSorts((prev) => [...prev, { column, direction: "ASC" }]);
  }, []);

  const handleRemoveSort = React.useCallback((column: string) => {
    setLocalSorts((prev) => prev.filter((rule) => rule.column !== column));
  }, []);

  const handleToggleDirection = React.useCallback(
    (column: string, direction: "ASC" | "DESC") => {
      setLocalSorts((prev) =>
        prev.map((rule) =>
          rule.column === column ? { ...rule, direction } : rule,
        ),
      );
    },
    [],
  );

  const applySorts = React.useCallback(() => {
    setSortConfig(localSorts);
    if (selectedTable)
      refreshTableData(selectedTable, selectedSchema, filterQuery, localSorts);
    setIsSortPopoverOpen(false);
  }, [
    filterQuery,
    localSorts,
    refreshTableData,
    selectedSchema,
    selectedTable,
    setSortConfig,
  ]);

  const clearSorts = React.useCallback(() => {
    setSortConfig([]);
    if (selectedTable)
      refreshTableData(selectedTable, selectedSchema, filterQuery, []);
    setIsSortPopoverOpen(false);
  }, [
    filterQuery,
    refreshTableData,
    selectedSchema,
    selectedTable,
    setSortConfig,
  ]);

  const prepareDialog = React.useCallback(() => {
    setDraftRules([makeRule("")]);
    setCustomWhere(filterQuery);
    setIsFilterMenuOpen(true);
  }, [filterQuery]);

  const handleApplyFilter = React.useCallback(() => {
    const visualClauses = draftRules
      .map((rule) => buildRuleClause(rule, dbType))
      .filter((clause): clause is string => !!clause);
    const clauses: string[] = [...visualClauses];
    if (customWhere.trim()) clauses.push(`(${customWhere.trim()})`);
    const nextFilter = clauses.join(" AND ");

    setFilterQuery(nextFilter);
    if (selectedTable) {
      refreshTableData(selectedTable, selectedSchema, nextFilter, sortConfig);
    }
    setIsFilterMenuOpen(false);
  }, [
    customWhere,
    draftRules,
    refreshTableData,
    selectedSchema,
    selectedTable,
    setFilterQuery,
    sortConfig,
    dbType,
  ]);

  return (
    <>
      <Popover open={isFilterMenuOpen} onOpenChange={setIsFilterMenuOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            onClick={prepareDialog}
            className={`font-normal ${filterQuery ? "text-blue-500 bg-blue-500/10" : ""}`}
          >
            <Filter className="w-3.5 h-3.5" />
            {filterQuery ? "Filtered" : "Filter"}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-[520px] max-w-[calc(100vw-1rem)] p-0 bg-popover text-popover-foreground border-border"
        >
          <div className="space-y-3 py-3">
            {draftRules.length === 0 ? (
              <div className="space-y-1 px-3">
                <h5 className="text-xs text-muted-foreground">
                  No filters applied to this view
                </h5>
                <p className="text-xs text-muted-foreground/80">
                  Add a rule below to filter the results
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {draftRules.map((rule, index) => (
                  <div key={rule.id} className="px-3">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg border border-border bg-background flex items-center justify-center shrink-0">
                        <Checkbox
                          checked={rule.enabled}
                          onCheckedChange={(checked) => {
                            const next = checked === true;
                            setDraftRules((prev) =>
                              prev.map((item, i) =>
                                i === index ? { ...item, enabled: next } : item,
                              ),
                            );
                          }}
                        />
                      </div>
                      <div className="flex-1 grid grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1.1fr)] gap-2">
                        <Select
                          value={rule.column || "none"}
                          onValueChange={(value) => {
                            if (!value || value === "none") return;
                            setDraftRules((prev) =>
                              prev.map((item, i) =>
                                i === index ? { ...item, column: value } : item,
                              ),
                            );
                          }}
                        >
                          <SelectTrigger className="h-8 w-full text-xs bg-background border-border">
                            <SelectValue placeholder="Column..." />
                          </SelectTrigger>
                          <SelectContent
                            position="popper"
                            className="bg-popover border-border"
                          >
                            <SelectGroup>
                              <SelectItem value="none" className="text-xs">
                                Column...
                              </SelectItem>
                              {columns.map((column) => (
                                <SelectItem
                                  key={column}
                                  value={column}
                                  className="text-xs"
                                >
                                  {column}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <Select
                          value={rule.operator || "none"}
                          onValueChange={(value) => {
                            const nextOperator = value as FilterOperator;
                            setDraftRules((prev) =>
                              prev.map((item, i) =>
                                i === index
                                  ? { ...item, operator: nextOperator }
                                  : item,
                              ),
                            );
                          }}
                        >
                          <SelectTrigger className="h-8 w-full text-xs bg-background border-border">
                            <SelectValue placeholder="Operator..." />
                          </SelectTrigger>
                          <SelectContent
                            position="popper"
                            className="bg-popover border-border"
                          >
                            <SelectGroup>
                              <SelectItem value="none" className="text-xs">
                                Operator...
                              </SelectItem>
                              {FILTER_OPERATORS.map((operator) => (
                                <SelectItem
                                  key={operator.value}
                                  value={operator.value}
                                  className="text-xs"
                                >
                                  {operator.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <Input
                          value={rule.value}
                          placeholder="Value..."
                          disabled={
                            !rule.operator ||
                            rule.operator === "none" ||
                            !operatorNeedsValue(rule.operator)
                          }
                          onChange={(event) => {
                            const value = event.target.value;
                            setDraftRules((prev) =>
                              prev.map((item, i) =>
                                i === index ? { ...item, value } : item,
                              ),
                            );
                          }}
                          className="h-8 w-full text-xs bg-background border-border disabled:opacity-40"
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
                        onClick={() => {
                          setDraftRules((prev) => {
                            const next = prev.filter(
                              (item) => item.id !== rule.id,
                            );
                            if (next.length === 0) return [makeRule("")];
                            return next;
                          });
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="h-px bg-border" />

            <div className="px-3 flex items-center gap-3">
              <Button
                variant="outline"
                className="h-8 px-3 text-xs border-border"
                onClick={() =>
                  setDraftRules((prev) => [...prev, makeRule(firstColumn)])
                }
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add Filter
              </Button>
              <div className="relative flex-1">
                <Input
                  ref={inputRef}
                  value={customWhere}
                  onChange={(event) => {
                    setCustomWhere(event.target.value);
                    setCursorPos(event.target.selectionStart ?? 0);
                  }}
                  onKeyDown={handleKeyDown}
                  onFocus={(e) => {
                    setCursorPos(e.target.selectionStart ?? 0);
                    // Don't manually call setShowSuggestions here, let the useEffect handle it based on customWhere content
                  }}
                  onKeyUp={(e) =>
                    setCursorPos(
                      (e.target as HTMLInputElement).selectionStart ?? 0,
                    )
                  }
                  onMouseUp={(e) =>
                    setCursorPos(
                      (e.target as HTMLInputElement).selectionStart ?? 0,
                    )
                  }
                  onBlur={() => {
                    setTimeout(() => setShowSuggestions(false), 150);
                  }}
                  placeholder="Advanced filter… e.g. revenue > 100"
                  className={`h-8 w-full text-xs bg-background border-border ${showSuggestions ? "rounded-b-none border-b-0" : ""}`}
                />
                {showSuggestions && (
                  <div
                    ref={suggestionsRef}
                    className="absolute z-[60] top-full left-0 right-0 bg-popover border-x border-b border-border rounded-b-md shadow-lg max-h-48 overflow-y-auto"
                  >
                    {suggestions.map((suggestion, index) => (
                      <div
                        key={suggestion}
                        className={`px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                          index === activeIndex
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent/50"
                        }`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSuggestionSelect(suggestion);
                        }}
                      >
                        {suggestion}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="px-3 flex items-center justify-between gap-2 pt-1">
              <Button
                variant="outline"
                className="h-8 px-3 text-xs border-border"
                onClick={() => {
                  setDraftRules([makeRule("")]);
                  setCustomWhere("");
                  setFilterQuery("");
                  if (setGlobalSearchQuery) setGlobalSearchQuery("");
                  if (setGlobalSearchScope) setGlobalSearchScope("page");
                  if (selectedTable)
                    refreshTableData(
                      selectedTable,
                      selectedSchema,
                      "",
                      sortConfig,
                    );
                  setIsFilterMenuOpen(false);
                }}
              >
                Clear filters
              </Button>
              <Button
                className="h-8 px-3 text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
                onClick={handleApplyFilter}
              >
                Apply filters
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <Popover open={isSortPopoverOpen} onOpenChange={setIsSortPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={`font-normal ${sortConfig?.length ? "text-blue-500 bg-blue-500/10" : ""}`}
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            {sortConfig?.length
              ? `Sorted by ${sortConfig.length} rule${sortConfig.length > 1 ? "s" : ""}`
              : "Sort"}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-[380px] max-w-[calc(100vw-1rem)] p-0 bg-popover text-popover-foreground border-border"
        >
          <div className="space-y-2 py-2">
            {localSorts.length === 0 ? (
              <div className="space-y-1 px-3">
                <h5 className="text-xs text-muted-foreground">
                  No sorts applied to this view
                </h5>
                <p className="text-xs text-muted-foreground/80">
                  Add a column below to sort the view
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {localSorts.map((sort) => (
                  <div
                    key={sort.column}
                    className="flex items-center gap-2 px-3"
                  >
                    <div className="text-xs font-mono text-foreground truncate">
                      {sort.column}
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                      <Button
                        variant={
                          sort.direction === "ASC" ? "default" : "outline"
                        }
                        size="sm"
                        className={`h-6 px-2 text-xs ${sort.direction === "ASC" ? "bg-primary text-primary-foreground" : "border-border text-muted-foreground/60"}`}
                        onClick={() =>
                          handleToggleDirection(sort.column, "ASC")
                        }
                      >
                        ASC
                      </Button>
                      <Button
                        variant={
                          sort.direction === "DESC" ? "default" : "outline"
                        }
                        size="sm"
                        className={`h-6 px-2 text-xs ${sort.direction === "DESC" ? "bg-primary text-primary-foreground" : "border-border text-muted-foreground/60"}`}
                        onClick={() =>
                          handleToggleDirection(sort.column, "DESC")
                        }
                      >
                        DESC
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        onClick={() => handleRemoveSort(sort.column)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="h-px bg-border" />

            <div className="px-3 space-y-2">
              <span className="text-xs tracking-wider text-muted-foreground/60">
                Add column
              </span>
              {availableSortColumns.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  All columns have been added
                </p>
              ) : (
                <Select
                  value={addSortColumn}
                  onValueChange={(value) => {
                    if (!value) return;
                    handleAddSort(value);
                    setAddSortColumn("");
                  }}
                >
                  <SelectTrigger className="h-8 w-full text-xs bg-background border-border">
                    <SelectValue placeholder="Pick a column to sort by" />
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    className="bg-popover border-border"
                  >
                    <SelectGroup>
                      {availableSortColumns.map((column) => (
                        <SelectItem
                          key={column}
                          value={column}
                          className="text-xs"
                        >
                          {column}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="px-3 flex items-center justify-between gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground/60 hover:text-foreground"
                onClick={clearSorts}
                disabled={localSorts.length === 0}
              >
                Clear
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
                onClick={applySorts}
                disabled={!hasSortChanges}
              >
                Apply sorting
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
