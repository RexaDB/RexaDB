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
import { Zap, FunctionSquare, Clock, Layout } from "@/lib/icon-theme/lucide-react";
import { fetchTables, fetchFunctions } from "@/lib/api/actions-client";
import { Badge } from "@/components/ui/badge";
import { TargetTableSelect } from "./target-table-select";
import { CreateObjectShell } from "./create-object-common";

interface CreateTriggerViewProps {
  connectionString: string;
  selectedSchema: string;
  onCreateTrigger: (
    schema: string,
    table: string,
    name: string,
    events: string[],
    timing: string,
    orientation: string,
    functionName: string,
  ) => Promise<void>;
  isCreating: boolean;
}

export function CreateTriggerView({
  connectionString,
  selectedSchema,
  onCreateTrigger,
  isCreating,
}: CreateTriggerViewProps) {
  const [triggerName, setTriggerName] = useState("");
  const [selectedTable, setSelectedTable] = useState("");
  const [selectedFunction, setSelectedFunction] = useState("");
  const [tables, setTables] = useState<string[]>([]);
  const [functions, setFunctions] = useState<any[]>([]);
  const [events, setEvents] = useState<string[]>(["INSERT"]);
  const [timing, setTiming] = useState("BEFORE");
  const [orientation, setOrientation] = useState("ROW");
  const [loadingTables, setLoadingTables] = useState(false);
  const [loadingFunctions, setLoadingFunctions] = useState(false);

  const timingOptions = ["BEFORE", "AFTER", "INSTEAD OF"];
  const orientationOptions = ["ROW", "STATEMENT"];
  const eventOptions = ["INSERT", "UPDATE", "DELETE", "TRUNCATE"];

  useEffect(() => {
    async function loadData() {
      setLoadingTables(true);
      setLoadingFunctions(true);
      try {
        const [tablesRes, functionsRes] = await Promise.all([
          fetchTables(connectionString, selectedSchema),
          fetchFunctions(connectionString, selectedSchema),
        ]);

        if (tablesRes.success && tablesRes.data) {
          setTables(tablesRes.data);
        }

        if (functionsRes.success && functionsRes.data) {
          // Filter for functions that return 'trigger'
          setFunctions(
            functionsRes.data.filter(
              (f: any) =>
                f.return_type.toLowerCase() === "trigger" ||
                f.return_type.toLowerCase() === "opaque",
            ),
          );
        }
      } finally {
        setLoadingTables(false);
        setLoadingFunctions(false);
      }
    }
    loadData();
  }, [connectionString, selectedSchema]);

  useEffect(() => {
    if (selectedTable && events.length > 0 && !triggerName) {
      const suggestedName = `trig_${selectedTable}_${events[0].toLowerCase()}`;
      setTriggerName(suggestedName);
    }
  }, [selectedTable, events]);

  const toggleEvent = (event: string) => {
    setEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  };

  const handleSubmit = () => {
    if (
      !triggerName ||
      !selectedTable ||
      !selectedFunction ||
      events.length === 0
    )
      return;
    onCreateTrigger(
      selectedSchema,
      selectedTable,
      triggerName,
      events,
      timing,
      orientation,
      selectedFunction,
    );
  };

  return (
    <CreateObjectShell
      title="Create a new trigger"
      description="Automate actions when data changes in"
      schema={selectedSchema}
      isCreating={isCreating}
      submitDisabled={
        !triggerName.trim() ||
        !selectedTable ||
        !selectedFunction ||
        events.length === 0 ||
        isCreating
      }
      submitLabel="Create Trigger"
      onSubmit={handleSubmit}
    >
      {/* Left Column: Basic Config */}
      <div className="space-y-8">
        <div className="space-y-4">
          <Label
            htmlFor="triggerName"
            className="text-xs font-boldtracking-widest text-muted-foreground flex items-center gap-2"
          >
            <Zap className="w-3.5 h-3.5" />
            Trigger Name
          </Label>
          <Input
            id="triggerName"
            value={triggerName}
            onChange={(e) => setTriggerName(e.target.value)}
            placeholder="e.g. notify_on_user_update"
            className="bg-secondary/30 border-border text-foreground focus-visible:ring-blue-500/50 h-10"
          />
        </div>

        <TargetTableSelect
          selectedTable={selectedTable}
          onSelectTable={setSelectedTable}
          tables={tables}
          loadingTables={loadingTables}
        />

        <div className="space-y-4">
          <Label className="text-xs font-boldtracking-widest text-muted-foreground flex items-center gap-2">
            <FunctionSquare className="w-3.5 h-3.5" />
            Function to Execute
          </Label>
          <Select value={selectedFunction} onValueChange={setSelectedFunction}>
            <SelectTrigger className="bg-secondary/30 border-border h-10">
              <SelectValue
                placeholder={
                  loadingFunctions
                    ? "Loading functions..."
                    : "Select a trigger function"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {functions.length === 0 && !loadingFunctions ? (
                <div className="p-2 text-xs text-muted-foreground text-center">
                  No trigger functions found in this schema.
                </div>
              ) : (
                functions.map((f) => (
                  <SelectItem key={f.name} value={f.name}>
                    {f.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground italic">
            Only functions returning <span className="font-mono">TRIGGER</span>{" "}
            are listed.
          </p>
        </div>
      </div>

      {/* Right Column: Execution Config */}
      <div className="space-y-8">
        <div className="space-y-4">
          <Label className="text-xs font-boldtracking-widest text-muted-foreground flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" />
            Events & Timing
          </Label>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <span className="text-xs text-muted-foreground font-medium">
                Timing
              </span>
              <Select value={timing} onValueChange={setTiming}>
                <SelectTrigger className="bg-secondary/30 border-border h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {timingOptions.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <span className="text-xs text-muted-foreground font-medium">
                Orientation
              </span>
              <Select value={orientation} onValueChange={setOrientation}>
                <SelectTrigger className="bg-secondary/30 border-border h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {orientationOptions.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <span className="text-xs text-muted-foreground font-medium">
              Trigger on Events
            </span>
            <div className="grid grid-cols-2 gap-2">
              {eventOptions.map((event) => (
                <div
                  key={event}
                  onClick={() => toggleEvent(event)}
                  className={`
                    flex items-center space-x-2 p-2 rounded-lg border cursor-pointer transition-all
                    ${
                      events.includes(event)
                        ? "bg-blue-500/5 border-blue-500/30 ring-1 ring-blue-500/20"
                        : "bg-secondary/10 border-border hover:bg-secondary/20"
                    }
                  `}
                >
                  <Checkbox
                    id={`event-${event}`}
                    checked={events.includes(event)}
                    onCheckedChange={() => {}} // Handled by div onClick
                  />
                  <Label
                    htmlFor={`event-${event}`}
                    className="text-xs cursor-pointer select-none font-medium uppercase"
                  >
                    {event}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 rounded-lg border border-border bg-muted/20 space-y-3">
          <Label className="text-xs font-boldtracking-widest text-muted-foreground flex items-center gap-2">
            <Layout className="w-3.5 h-3.5" />
            Summary
          </Label>
          <div className="text-xs space-y-2 text-foreground/80 leading-relaxed">
            <p>
              This trigger will run{" "}
              <Badge
                variant="secondary"
                className="bg-blue-500/10 text-blue-500 border-none h-4 px-1 text-xs"
              >
                {timing}
              </Badge>{" "}
              <span className="font-bold">{events.join(" or ")}</span>{" "}
              operations.
            </p>
            <p>
              It will execute for{" "}
              <span className="font-bold">
                {orientation === "ROW" ? "each row" : "the entire statement"}
              </span>
              .
            </p>
            <p>
              Executing function:{" "}
              <span className="font-mono font-bold text-blue-500 underline underline-offset-2">
                {selectedFunction || "..."}()
              </span>
            </p>
          </div>
        </div>
      </div>
    </CreateObjectShell>
  );
}
