"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { ArrowLeft, Plus, Search, X } from "@/lib/icon-theme/lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  useAiProviderSettings,
  PINNED_PROVIDERS,
  PROVIDER_LABELS,
  logoFor,
  logoNeedsInvert,
} from "@/hooks/use-ai-provider-settings";

function ProviderLogo({ provider, label, size = 22 }: { provider: string; label: string; size?: number }) {
  const icon = logoFor(provider);
  if (icon) {
    return (
      <Image
        alt={label}
        className={logoNeedsInvert(provider) ? "dark:invert" : ""}
        height={size}
        src={icon}
        width={size}
      />
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function AiProvidersPage({ onBack }: { onBack?: () => void }) {
  const { settings, catalog, updateProvider, addProvider, removeProvider, labelFor } =
    useAiProviderSettings();
  const [query, setQuery] = useState("");
  const [openProvider, setOpenProvider] = useState<string | null>(null);
  const [modelDraft, setModelDraft] = useState("");

  const providers = useMemo(() => {
    const catalogIds = new Set(catalog.map((c) => c.id));
    const pinnedExtras = PINNED_PROVIDERS.filter((id) => !catalogIds.has(id)).map((id) => ({
      id,
      name: PROVIDER_LABELS[id] || id,
      baseUrl: undefined as string | undefined,
    }));
    return [...catalog, ...pinnedExtras].sort((a, b) => a.name.localeCompare(b.name));
  }, [catalog]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return providers;
    return providers.filter((p) => p.name.toLowerCase().includes(q) || p.id.includes(q));
  }, [providers, query]);

  if (!settings) return null;

  const active = openProvider ? providers.find((p) => p.id === openProvider) : null;
  const activeConfig = openProvider ? settings.providers[openProvider] : undefined;
  const activePinned = openProvider ? PINNED_PROVIDERS.includes(openProvider) : false;

  const openDialog = (id: string) => {
    if (!settings.providers[id]) addProvider(id);
    setOpenProvider(id);
    setModelDraft("");
  };

  const addModel = () => {
    if (!openProvider || !activeConfig) return;
    const next = modelDraft.trim();
    if (!next) return;
    updateProvider(openProvider, { models: Array.from(new Set([...activeConfig.models, next])) });
    setModelDraft("");
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        {onBack && (
          <Button variant="ghost" size="icon-xs" onClick={onBack} aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-foreground">Providers</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Every provider the Pi agent SDK supports. Pick one to configure it.
          </p>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search providers…"
          className="h-8 pl-8 text-xs"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {filtered.map((p) => {
          const config = settings.providers[p.id];
          const configured = !!config && (p.id === "ollama" || config.apiKey.trim().length > 0) && config.models.length > 0;
          const label = labelFor(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => openDialog(p.id)}
              className="flex flex-col items-start gap-2.5 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-muted/50"
            >
              <div className="flex w-full items-center justify-between">
                <ProviderLogo provider={p.id} label={label} />
                {configured && (
                  <span className="flex size-2 shrink-0 rounded-full bg-emerald-500" aria-label="Configured" />
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-foreground">{label}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {config
                    ? config.models.length > 0
                      ? `${config.models.length} model${config.models.length === 1 ? "" : "s"}`
                      : "Not configured"
                    : "Not configured"}
                </div>
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="col-span-full py-8 text-center text-xs text-muted-foreground">
            No providers match “{query}”.
          </p>
        )}
      </div>

      <Dialog open={!!openProvider} onOpenChange={(open) => !open && setOpenProvider(null)}>
        <DialogContent className="max-w-sm">
          {active && activeConfig && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2.5">
                  <ProviderLogo provider={active.id} label={labelFor(active.id)} size={24} />
                  <DialogTitle>{labelFor(active.id)}</DialogTitle>
                </div>
                <DialogDescription>
                  {active.id === "ollama"
                    ? "Point this at a local or remote Ollama server."
                    : "Add an API key and the model ids you want available."}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">API Key</Label>
                  <Input
                    type="password"
                    placeholder="sk-..."
                    className="h-8 font-mono text-xs"
                    value={activeConfig.apiKey}
                    onChange={(event) => updateProvider(active.id, { apiKey: event.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Models</Label>
                  <div className="space-y-1.5">
                    {activeConfig.models.map((model) => (
                      <div
                        key={model}
                        className="flex items-center justify-between rounded-lg border border-border px-2.5 py-1.5"
                      >
                        <span className="text-xs text-foreground">{model}</span>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() =>
                            updateProvider(active.id, {
                              models: activeConfig.models.filter((item) => item !== model),
                            })
                          }
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add model id"
                      className="h-8 text-xs"
                      value={modelDraft}
                      onChange={(event) => setModelDraft(event.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addModel();
                        }
                      }}
                    />
                    <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={addModel}>
                      <Plus className="h-4 w-4" />
                      Add
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Base URL <span className="text-muted-foreground/60">(optional override)</span>
                  </Label>
                  <Input
                    className="h-8 font-mono text-xs"
                    placeholder={active.baseUrl || "Provider default"}
                    value={activeConfig.baseUrl || ""}
                    onChange={(event) => updateProvider(active.id, { baseUrl: event.target.value })}
                  />
                </div>

                {!activePinned && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-full text-xs text-destructive hover:text-destructive"
                    onClick={() => {
                      removeProvider(active.id);
                      setOpenProvider(null);
                    }}
                  >
                    Remove provider
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
