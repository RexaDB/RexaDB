"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  fetchSchema,
  getSpacetimeDbReducers,
  callSpacetimeDbReducer,
} from "@/lib/db/spacetimedb-client";
import { Search, Play, Loader2, Terminal } from "@/lib/icon-theme/lucide-react";
import { PanelRefreshButtons, PanelLoadingError } from "./panel-shared";

interface ReducerArg {
  name: string;
  algebraic_type: any;
  type_name: string;
}

interface ReducerInfo {
  name: string;
  args: ReducerArg[];
}

function isLifecycleReducer(name: string): boolean {
  return ["init", "__init__", "on_connect", "__on_connect__", "on_disconnect", "__on_disconnect__"].includes(name.toLowerCase());
}

function isCustomType(typeName: string): boolean {
  const primitives = ["Bool", "String", "I8", "I16", "I32", "I64", "I128", "I256", "U8", "U16", "U32", "U64", "U128", "U256", "F32", "F64", "Identity", "ConnectionId", "Timestamp", "TimeDuration", "Bytes"];
  const base = typeName.replace(/^(Option<|Array<)/, "").replace(/>$/, "");
  return !primitives.includes(base);
}

function parseArgValue(value: string, typeName: string): any {
  if (typeName.startsWith("Option<")) return value || null;
  if (typeName.startsWith("Array<") || typeName.endsWith("]")) {
    if (!value.trim()) return [];
    return value.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (["I8", "I16", "I32", "I64", "I128", "I256", "U8", "U16", "U32", "U64", "U128", "U256", "F32", "F64"].includes(typeName)) {
    return typeName.startsWith("F") ? parseFloat(value) : Number(value);
  }
  if (typeName === "Bool") return value === "true" || value === "1";
  return value;
}

function InputForArg({
  arg,
  value,
  onChange,
}: {
  arg: ReducerArg;
  value: string;
  onChange: (v: string) => void;
}) {
  const baseType = arg.type_name.replace(/^(Option<|Array<)/, "").replace(/>$/, "");

  if (baseType === "Bool") {
    return (
      <div className="flex items-center gap-2">
        <Switch
          checked={value === "true"}
          onCheckedChange={(v) => onChange(v ? "true" : "false")}
        />
        <span className="text-xs text-muted-foreground">{value === "true" ? "true" : "false"}</span>
      </div>
    );
  }

  const isNumeric = ["I8", "I16", "I32", "I64", "I128", "I256", "U8", "U16", "U32", "U64", "U128", "U256", "F32", "F64"].includes(baseType);

  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={arg.type_name}
      className="font-mono text-xs h-7"
      type={isNumeric ? "number" : "text"}
    />
  );
}

export function SpacetimeDbReducerPanel({
  connectionString,
  onClose,
}: {
  connectionString: string;
  onClose?: () => void;
}) {
  const [reducers, setReducers] = useState<ReducerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [argValues, setArgValues] = useState<Record<string, Record<string, string>>>({});
  const [callingReducer, setCallingReducer] = useState<string | null>(null);

  const loadReducers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const moduleDef = await fetchSchema(connectionString);
      const r = getSpacetimeDbReducers(moduleDef);
      setReducers(r.sort((a: ReducerInfo, b: ReducerInfo) => a.name.localeCompare(b.name)));
    } catch (err: any) {
      setError(err.message || "Failed to load reducers");
    } finally {
      setLoading(false);
    }
  }, [connectionString]);

  useEffect(() => {
    loadReducers();
  }, [loadReducers]);

  const filteredReducers = useMemo(() => {
    if (!search.trim()) return reducers;
    const q = search.toLowerCase();
    return reducers.filter((r) => r.name.toLowerCase().includes(q));
  }, [reducers, search]);

  const handleCallReducer = useCallback(async (reducer: ReducerInfo) => {
    setCallingReducer(reducer.name);
    try {
      const args = reducer.args.map((arg) => {
        const raw = argValues[reducer.name]?.[arg.name] || "";
        return parseArgValue(raw, arg.type_name);
      });
      const result = await callSpacetimeDbReducer(connectionString, reducer.name, args);
      toast.success(`Reducer '${reducer.name}' called successfully`, {
        description: result?.status?.Committed ? "Transaction committed" : "Executed",
      });
    } catch (err: any) {
      toast.error(`Reducer '${reducer.name}' failed`, {
        description: err.message || "Unknown error",
      });
    } finally {
      setCallingReducer(null);
    }
  }, [connectionString, argValues]);

  const setArgValue = useCallback((reducerName: string, argName: string, value: string) => {
    setArgValues((prev) => ({
      ...prev,
      [reducerName]: { ...(prev[reducerName] || {}), [argName]: value },
    }));
  }, []);

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
        <Terminal className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">Reducers</span>
        <div className="flex-1" />
        <div className="relative w-48">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reducers..."
            className="pl-7 h-7 text-xs"
          />
        </div>
        <PanelRefreshButtons loading={loading} onRefresh={loadReducers} onClose={onClose} />
      </div>

      {loading || error ? (
        <PanelLoadingError loading={loading} error={error} onRetry={loadReducers} loadingLabel="Loading reducers..." />
      ) : filteredReducers.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          {search ? "No reducers match your search" : "No reducers found"}
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-2">
            {filteredReducers.map((reducer) => {
              const lifecycle = isLifecycleReducer(reducer.name);
              const hasCustomTypes = reducer.args.some((a) => isCustomType(a.type_name));
              const canCall = !lifecycle && !hasCustomTypes;

              return (
                <div
                  key={reducer.name}
                  className="border border-border rounded-lg p-3 bg-muted/20"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium">{reducer.name}</span>
                      {lifecycle && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          lifecycle
                        </Badge>
                      )}
                      {hasCustomTypes && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                          custom types
                        </Badge>
                      )}
                    </div>
                    <Button
                      size="sm"
                      className="h-7 text-xs gap-1"
                      disabled={!canCall || callingReducer === reducer.name}
                      onClick={() => handleCallReducer(reducer)}
                    >
                      {callingReducer === reducer.name ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Play className="w-3 h-3" />
                      )}
                      Call
                    </Button>
                  </div>

                  {reducer.args.length > 0 && (
                    <div className="space-y-1.5 ml-1">
                      {reducer.args.map((arg) => (
                        <div key={arg.name} className="flex items-center gap-2">
                          <Label className="text-xs font-mono text-muted-foreground shrink-0 w-28 truncate" title={arg.name}>
                            {arg.name}
                            <span className="text-[10px] ml-1 text-muted-foreground/60">({arg.type_name})</span>
                          </Label>
                          <div className="flex-1">
                            <InputForArg
                              arg={arg}
                              value={argValues[reducer.name]?.[arg.name] || ""}
                              onChange={(v) => setArgValue(reducer.name, arg.name, v)}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {reducer.args.length === 0 && (
                    <p className="text-xs text-muted-foreground ml-1">No arguments</p>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
