"use client";

import { Plus, X } from "lucide-react";

// components
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProviderModelDiscovery } from "./provider-model-discovery";

// types
import type { AiProviderModel } from "@/lib/ai/provider-model-types";

export function ApiKeyField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">API Key</Label>
      <Input
        type="password"
        placeholder="sk-..."
        className="h-8 font-mono text-xs"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function ModelListEditor({
  models,
  draft,
  onDraftChange,
  onAdd,
  onRemove,
  provider,
  apiKey,
  baseUrl,
  catalogModels,
  onSelect,
  addLabel = "Add",
  providerLabel,
}: {
  models: string[];
  draft: string;
  onDraftChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (model: string) => void;
  provider: string;
  apiKey: string;
  baseUrl?: string;
  catalogModels: AiProviderModel[];
  onSelect: (model: string) => void;
  addLabel?: string;
  providerLabel?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">Models</Label>

      <ProviderModelDiscovery
        key={JSON.stringify([provider, apiKey, baseUrl])}
        provider={provider}
        apiKey={apiKey}
        baseUrl={baseUrl}
        catalogModels={catalogModels}
        selectedModels={models}
        onSelect={onSelect}
        providerLabel={providerLabel}
      />

      <div className="space-y-1.5">
        {models.map((model) => (
          <div
            key={model}
            className="flex items-center justify-between rounded-lg border border-border px-2.5 py-1.5"
          >
            <span className="text-xs text-foreground">{model}</span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Remove ${model}`}
              onClick={() => onRemove(model)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Enter a model ID manually"
          aria-label="Manual model ID"
          className="h-8 text-xs"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd();
            }
          }}
        />
        <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={onAdd}>
          <Plus className="h-4 w-4" />
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

export function BaseUrlField({
  value,
  placeholder = "Provider default",
  onChange,
  label = "Base URL",
}: {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  label?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        className="h-8 font-mono text-xs"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
