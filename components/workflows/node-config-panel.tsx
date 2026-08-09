"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getNodeDef, getNodeIcon } from "@/lib/workflows/node-registry";
import { X, AlertCircle } from "lucide-react";

type WfNode = {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
};

type Props = {
  node: WfNode;
  onChange: (updated: WfNode) => void;
  onClose: () => void;
};

export function NodeConfigPanel({ node, onChange, onClose }: Props) {
  const def = getNodeDef(node.type);
  // Edits apply immediately (onChange fires on every keystroke) rather than
  // being buffered behind a separate "Save Changes" step - a field you typed
  // into but never explicitly committed used to run with its old/default
  // value instead, with no indication anything was lost.
  const [localName, setLocalName] = useState(node.name);
  const [localConfig, setLocalConfig] = useState<Record<string, unknown>>(node.config);

  useEffect(() => {
    setLocalName(node.name);
    setLocalConfig(node.config);
  }, [node.id]);

  function setName(name: string) {
    setLocalName(name);
    onChange({ ...node, name, config: localConfig });
  }

  function setField(key: string, value: unknown) {
    const config = { ...localConfig, [key]: value };
    setLocalConfig(config);
    onChange({ ...node, name: localName, config });
  }

  if (!def) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Unknown node type: {node.type}
      </div>
    );
  }

  const Icon = getNodeIcon(def.icon);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className="flex size-6 items-center justify-center rounded text-white"
            style={{ backgroundColor: def.color }}
          >
            <Icon className="size-3.5" />
          </span>
          <span className="text-sm font-medium">{def.name}</span>
          {!def.implemented && (
            <span className="rounded bg-yellow-500/10 px-1.5 py-0.5 text-[10px] text-yellow-600">Coming Soon</span>
          )}
        </div>
        <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>

      {/* Fields */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Node name */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Node Name</Label>
          <Input
            value={localName}
            onChange={(e) => setName(e.target.value)}
            className="h-8 text-sm"
            placeholder="Enter node name..."
          />
        </div>

        {def.fields.length === 0 && (
          <p className="text-xs text-muted-foreground">{def.description}</p>
        )}

        {/* Config fields */}
        {def.fields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label className="text-xs font-medium">
              {field.label}
              {field.required && <span className="ml-0.5 text-destructive">*</span>}
            </Label>

            {field.type === "select" ? (
              <Select
                value={String(localConfig[field.key] ?? field.defaultValue ?? "")}
                onValueChange={(v) => setField(field.key, v)}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {field.options?.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : field.type === "boolean" ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id={field.key}
                  checked={Boolean(localConfig[field.key] ?? field.defaultValue)}
                  onCheckedChange={(v) => setField(field.key, Boolean(v))}
                />
                <Label htmlFor={field.key} className="text-xs cursor-pointer">{field.label}</Label>
              </div>
            ) : field.type === "number" ? (
              <Input
                type="number"
                value={String(localConfig[field.key] ?? field.defaultValue ?? "")}
                onChange={(e) => setField(field.key, e.target.value === "" ? null : Number(e.target.value))}
                className="h-8 text-sm"
                placeholder={field.placeholder}
              />
            ) : field.type === "datetime" ? (
              <Input
                type="datetime-local"
                value={String(localConfig[field.key] ?? "")}
                onChange={(e) => setField(field.key, e.target.value)}
                className="h-8 text-sm"
              />
            ) : field.type === "code" || field.type === "textarea" || field.type === "json" || field.type === "expression" ? (
              <Textarea
                value={String(localConfig[field.key] ?? "")}
                onChange={(e) => setField(field.key, e.target.value)}
                placeholder={field.placeholder}
                className={cn(
                  "min-h-[80px] resize-y text-xs",
                  (field.type === "code" || field.type === "json") && "font-mono",
                )}
                rows={field.type === "code" ? 6 : 3}
              />
            ) : (
              <Input
                value={String(localConfig[field.key] ?? "")}
                onChange={(e) => setField(field.key, e.target.value)}
                className="h-8 text-sm"
                placeholder={field.placeholder}
              />
            )}

            {field.hint && (
              <p className="text-[10px] text-muted-foreground leading-snug">{field.hint}</p>
            )}
          </div>
        ))}

        {!def.implemented && (
          <div className="flex items-start gap-2 rounded-lg bg-yellow-500/10 p-3 text-xs text-yellow-700 dark:text-yellow-400">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              This node type is not yet implemented. You can configure it, but it will throw an error when the workflow runs.
            </span>
          </div>
        )}
      </div>

      <div className="border-t border-border p-3">
        <Button size="sm" variant="outline" className="w-full" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
