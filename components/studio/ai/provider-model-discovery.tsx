"use client";

import { useMemo, useState } from "react";
import Image from "next/image";

// components
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// services
import { discoverAiProviderModels } from "@/lib/api/actions-client";
import { logoFor, logoNeedsInvert } from "@/hooks/use-ai-provider-settings";

// types
import type { AiProviderModel } from "@/lib/ai/provider-model-types";

type ProviderModelDiscoveryProps = {
  provider: string;
  apiKey: string;
  baseUrl?: string;
  catalogModels: AiProviderModel[];
  selectedModels: string[];
  onSelect: (model: string) => void;
  providerLabel?: string;
};

function ProviderLogo({
  provider,
  label,
  size = 16,
}: {
  provider: string;
  label: string;
  size?: number;
}) {
  const icon = logoFor(provider);
  if (icon) {
    return (
      <Image
        alt=""
        aria-hidden
        src={icon}
        width={size}
        height={size}
        className={`block shrink-0 object-contain ${logoNeedsInvert(provider) ? "dark:invert" : ""}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function ProviderModelDiscovery({
  provider,
  apiKey,
  baseUrl,
  catalogModels,
  selectedModels,
  onSelect,
  providerLabel,
}: ProviderModelDiscoveryProps) {
  const [open, setOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [liveModels, setLiveModels] = useState<AiProviderModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState<string>("");

  const models = liveModels ?? catalogModels;
  const label = providerLabel || provider;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (model) =>
        model.id.toLowerCase().includes(q) ||
        model.name.toLowerCase().includes(q),
    );
  }, [models, query]);

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
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setQuery("");
          }}
        >
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" aria-expanded={open} className="gap-1.5">
              <ProviderLogo provider={provider} label={label} size={14} />
              Choose models
            </Button>
          </PopoverTrigger>

          <PopoverContent
            align="start"
            className="w-80 max-w-[calc(100vw-2rem)] overflow-hidden p-0"
            onOpenAutoFocus={(event) => event.preventDefault()}
            onWheel={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <ProviderLogo provider={provider} label={label} size={16} />
              <span className="truncate text-xs font-medium text-foreground">{label}</span>
            </div>

            <div className="border-b border-border p-2">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search models…"
                aria-label="Search available models"
                className="h-8 text-xs"
              />
            </div>

            {/* Plain overflow div — cmdk CommandList inside Dialog does not receive mouse wheel. */}
            <div
              role="listbox"
              aria-label="Available models"
              className="overflow-y-auto overscroll-contain"
              style={{ maxHeight: 256 }}
              onWheel={(event) => event.stopPropagation()}
            >
              {filtered.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  {models.length
                    ? "No models match your search."
                    : "Refresh models or enter a model ID below."}
                </p>
              ) : (
                <ul className="p-1">
                  {filtered.map((model) => {
                    const added = selectedModels.includes(model.id);
                    return (
                      <li key={model.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={added}
                          disabled={added}
                          onClick={() => {
                            onSelect(model.id);
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-none hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                        >
                          <ProviderLogo provider={provider} label={label} size={14} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{model.name || model.id}</span>
                            {model.name && model.name !== model.id ? (
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {model.id}
                              </span>
                            ) : null}
                          </span>
                          {added ? (
                            <span className="shrink-0 text-muted-foreground">Added</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
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
