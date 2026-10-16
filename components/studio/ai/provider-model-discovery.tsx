"use client";

import { useState } from "react";

// components
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// services
import { discoverAiProviderModels } from "@/lib/api/actions-client";

// types
import type { AiProviderModel } from "@/lib/ai/provider-model-types";

type ProviderModelDiscoveryProps = {
  provider: string;
  apiKey: string;
  baseUrl?: string;
  catalogModels: AiProviderModel[];
  selectedModels: string[];
  onSelect: (model: string) => void;
};

export function ProviderModelDiscovery({
  provider,
  apiKey,
  baseUrl,
  catalogModels,
  selectedModels,
  onSelect,
}: ProviderModelDiscoveryProps) {
  const [open, setOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [liveModels, setLiveModels] = useState<AiProviderModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const models = liveModels ?? catalogModels;

  const refreshModels = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await discoverAiProviderModels(provider, apiKey, baseUrl);
      if (!result.success || !result.data) {
        setError(result.error || "Could not load models. You can still enter a model ID below.");
        return;
      }
      setLiveModels(result.data);
      setOpen(true);
    } catch {
      setError("Could not load models. Try again or enter a model ID below.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" aria-expanded={open}>
              Choose models
            </Button>
          </PopoverTrigger>

          <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-0">
            <Command>
              <CommandInput placeholder="Search models…" aria-label="Search available models" />

              <CommandList>
                <CommandEmpty>
                  {models.length ? "No models match your search." : "Refresh models or enter a model ID below."}
                </CommandEmpty>

                <CommandGroup>
                  {models.map((model) => (
                    <CommandItem
                      key={model.id}
                      value={model.id}
                      keywords={[model.name]}
                      disabled={selectedModels.includes(model.id)}
                      onSelect={() => onSelect(model.id)}
                      className="items-start text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="break-words">{model.name}</div>
                        {model.name !== model.id ? (
                          <div className="break-all text-[11px] text-muted-foreground">{model.id}</div>
                        ) : null}
                      </div>

                      {selectedModels.includes(model.id) ? <span className="text-muted-foreground">Added</span> : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <Button variant="ghost" size="sm" loading={loading} onClick={refreshModels}>
          Refresh models
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground" role="status">
        {liveModels !== null
          ? `${models.length} model${models.length === 1 ? "" : "s"} returned by this provider.`
          : models.length
            ? "Browse the built-in catalog or refresh from your provider."
            : "Refresh to discover models from your provider."}
      </p>

      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}
