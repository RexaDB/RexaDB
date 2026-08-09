"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Clock, ChevronDown } from "@/lib/icon-theme/lucide-react";
import type { RedisKeyType } from "@/types/redis";
import { TTL_UNITS, TtlUnitSelect } from "./redis-ttl-unit-select";

export type RedisCreateKeyFieldValues = {
  key: string;
  type: RedisKeyType;
  rawValue: string;
  ttlSeconds: string;
};

const typeHelp: Record<RedisKeyType, string> = {
  string: "Enter the value as plain text.",
  hash: "Use field=value pairs, separated by commas or new lines.",
  list: "Enter values separated by commas or new lines.",
  set: "Enter values separated by commas or new lines.",
  zset: "Use score member pairs, separated by commas or new lines.",
};

interface RedisCreateKeyFieldsProps {
  values: RedisCreateKeyFieldValues;
  onChange: (next: Partial<RedisCreateKeyFieldValues>) => void;
}

export function RedisCreateKeyFields({
  values,
  onChange,
}: RedisCreateKeyFieldsProps) {
  const [ttlDraft, setTtlDraft] = useState(values.ttlSeconds);
  const [ttlUnit, setTtlUnit] = useState("seconds");

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <label className="text-xs font-medium text-muted-foreground">Key</label>
        <Input
          value={values.key}
          onChange={(e) => onChange({ key: e.target.value })}
          className="h-9 text-xs"
        />
      </div>

      <div className="grid gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          Type
        </label>
        <SearchableSelect
          options={["string", "hash", "list", "set", "zset"].map((value) => ({
            value,
            label: value.toUpperCase(),
          }))}
          value={values.type}
          onValueChange={(value) => onChange({ type: value as RedisKeyType })}
          placeholder="Select type"
          searchPlaceholder="Search types..."
          emptyText="No types found."
          searchThreshold={3}
        />
      </div>

      <div className="grid gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          Value
        </label>
        <Textarea
          value={values.rawValue}
          onChange={(e) => onChange({ rawValue: e.target.value })}
          className="min-h-[88px] text-xs"
        />
        <p className="text-xs text-muted-foreground">{typeHelp[values.type]}</p>
      </div>

      {/* TTL Popover */}
      <div className="grid gap-1">
        <label className="text-xs font-medium text-muted-foreground">TTL</label>
        <Popover
          onOpenChange={(open) => {
            if (open) {
              setTtlDraft(values.ttlSeconds || "");
              setTtlUnit("seconds");
            }
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs text-muted-foreground"
            >
              <Clock className="h-4 w-4" />
              {values.ttlSeconds ? `${values.ttlSeconds}s` : "Optional"}
              <ChevronDown className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={6}
            className="w-72 p-4 text-foreground bg-studio-bg border border-studio-border rounded-lg"
          >
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                placeholder="Value"
                value={ttlDraft}
                onChange={(e) => setTtlDraft(e.target.value)}
                className="h-8 bg-muted/20 border-studio-border text-sm rounded-lg"
              />
              <TtlUnitSelect value={ttlUnit} onValueChange={setTtlUnit} />
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                size="sm"
                onClick={() => onChange({ ttlSeconds: "" })}
                className="text-xs bg-muted/20 text-muted-foreground hover:bg-muted/30"
              >
                Remove
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const num = Number(ttlDraft);
                  if (!num || num <= 0) return;
                  const unitMultiplier =
                    TTL_UNITS.find((u) => u.value === ttlUnit)?.multiplier || 1;
                  onChange({ ttlSeconds: String(num * unitMultiplier) });
                }}
                className="text-xs bg-blue-600 text-white hover:bg-blue-700"
              >
                Apply
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
