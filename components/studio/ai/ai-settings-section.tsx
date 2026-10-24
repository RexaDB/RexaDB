"use client";

import { useLocalCliProviders } from "@/hooks/use-local-cli-providers";
import { localCliModels } from "@/lib/agents/local-provider";
import { useMemo, useState } from "react";
import Image from "next/image";
import { ArrowRight } from "@/lib/icon-theme/lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiKeyField, ModelListEditor } from "@/components/studio/ai/ai-provider-shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { GlobalAiSettings } from "@/lib/api/actions-client";
import {
  useAiProviderSettings,
  PINNED_PROVIDERS,
  logoFor,
  logoNeedsInvert,
} from "@/hooks/use-ai-provider-settings";

function ProviderAvatar({ provider, label }: { provider: string; label: string }) {
  const icon = logoFor(provider);
  if (icon) {
    return (
      <Image
        alt={label}
        className={logoNeedsInvert(provider) ? "dark:invert" : ""}
        height={20}
        src={icon}
        width={20}
      />
    );
  }
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function AiSettingsSection({ onOpenProviders }: { onOpenProviders?: () => void }) {
  const { settings, catalogById, updateSettings, updateProvider, labelFor } = useAiProviderSettings();
  const localCli = useLocalCliProviders();
  const cliModels = localCliModels(localCli.providers);
  const cliName = (id: string) => cliModels.find((m) => m.provider === id)?.name || labelFor(id);
  const [openItem, setOpenItem] = useState<string>("");
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});

  const modelCount = useMemo(
    () =>
      Object.values(settings?.providers || {}).reduce(
        (sum, provider) => sum + (Array.isArray(provider?.models) ? provider.models.length : 0),
        0,
      ),
    [settings],
  );

  const providerCount = useMemo(
    () =>
      Object.entries(settings?.providers || {}).filter(
        ([p, c]) => !!c && (p === "ollama" || String(c.apiKey ?? "").trim()) && Array.isArray(c.models) && c.models.length > 0,
      ).length,
    [settings],
  );

  if (!settings) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Models
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Configure provider access and permissions.
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-8 shrink-0 px-2.5 text-xs" onClick={onOpenProviders}>
          Configure providers
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Label>Local CLI agents</Label>
          <Button variant="outline" size="sm" disabled={localCli.loading} onClick={() => void localCli.refresh()}>
            {localCli.loading ? "Detecting…" : "Refresh"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Uses each CLI’s existing sign-in and billing. No API key is required in RexaDB.
          Sign in in your terminal, then refresh. CLI agents can use their own tools and permissions.
        </p>
        {localCli.error && <p role="alert" className="text-xs text-destructive">{localCli.error}</p>}
        {localCli.providers.filter((p) => p.id !== "rexadb").map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 text-xs">
            <span>{p.name}</span>
            <span className="text-muted-foreground">{p.status === "installed" ? "Available" : p.status === "auth-required" ? "Sign-in required" : p.status === "not-installed" ? "Not installed" : "Check CLI"}</span>
          </div>
        ))}
      </div>

      {/* Permissions Card */}
      <div className="rounded-lg border border-border bg-card p-4">
        <Label className="text-xstracking-wider text-muted-foreground font-medium">
          Permissions
        </Label>
        <Select
          value={settings.permissionMode}
          onValueChange={(value) =>
            updateSettings({
              ...settings,
              permissionMode: value as GlobalAiSettings["permissionMode"],
            })
          }
        >
          <SelectTrigger className="mt-2 h-8 w-full text-xs sm:w-[220px]">
            <SelectValue placeholder="Select permission mode" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="schema_only">Schema only</SelectItem>
            <SelectItem value="schema_with_data">
              Schema with database data (read only)
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Default provider — used for one-shot agent actions (e.g. AI filter). */}
      {(() => {
        const usableProviders: Array<[string, { models: string[] }]> = Object.entries(settings.providers || {}).filter(
          ([p, c]) => !!c && (p === "ollama" || String(c.apiKey ?? "").trim()) && Array.isArray(c.models) && c.models.length > 0,
        );
        for (const id of new Set(cliModels.map((m) => m.provider))) {
          usableProviders.push([id, { models: cliModels.filter((m) => m.provider === id).map((m) => m.model) }]);
        }
        const activeProvider = usableProviders.some(([p]) => p === settings.defaultProvider)
          ? settings.defaultProvider
          : "";
        const activeModels = activeProvider
          ? (usableProviders.find(([id]) => id === activeProvider)?.[1].models || [])
          : [];
        const activeModel = activeModels.includes(settings.defaultModel)
          ? settings.defaultModel
          : "";
        return (
          <div className="rounded-lg border border-border bg-card p-4">
            <Label className="text-xstracking-wider text-muted-foreground font-medium">
              Default provider
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Used for one-shot agent actions like AI filter from search.
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <Select
                value={activeProvider}
                onValueChange={(provider) =>
                  updateSettings({ ...settings, defaultProvider: provider, defaultModel: provider.startsWith("cli:") ? "default" : "" })
                }
              >
                <SelectTrigger className="h-8 w-full text-xs sm:w-[220px]">
                  <SelectValue placeholder="Select default provider" />
                </SelectTrigger>
                <SelectContent>
                  {usableProviders.map(([p]) => (
                    <SelectItem key={p} value={p}>
                      {cliName(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={activeModel}
                disabled={!activeProvider}
                onValueChange={(model) =>
                  updateSettings({ ...settings, defaultModel: model })
                }
              >
                <SelectTrigger className="h-8 w-full text-xs sm:w-[220px]">
                  <SelectValue placeholder="Select default model" />
                </SelectTrigger>
                <SelectContent>
                  {activeModels.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        );
      })()}

      {/* Web search (Exa) — key-only, no models. */}
      {(() => {
        const exaKey = settings.providers["exa"]?.apiKey || "";
        return (
          <div className="rounded-lg border border-border bg-card p-4">
            <Label className="text-xstracking-wider text-muted-foreground font-medium">
              Web search (Exa)
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Lets the agent search the live web. Works out of the box
              with a free daily quota — add a key for unlimited,
              richer results ($20 signup credits + $10 free every
              month).{" "}
              <a
                className="underline underline-offset-2"
                href="https://dashboard.exa.ai/api-keys"
                rel="noreferrer"
                target="_blank"
              >
                Get a free key
              </a>
            </p>
            <div className="mt-2">
              <ApiKeyField
                value={exaKey}
                onChange={(apiKey) => updateProvider("exa", { apiKey })}
              />
            </div>
          </div>
        );
      })()}

      <Accordion
        className="space-y-2"
        collapsible
        type="single"
        value={openItem}
        onValueChange={setOpenItem}
      >
        {/* Pinned provider accordions — the rest of the Pi SDK catalog lives on the dedicated Providers page. */}
        {PINNED_PROVIDERS.map((provider) => {
          const config = settings.providers[provider];
          if (!config) return null;
          const label = labelFor(provider);

          const addModel = () => {
            const nextModel = (modelDrafts[provider] || "").trim();
            if (!nextModel) return;
            updateProvider(provider, { models: Array.from(new Set([...config.models, nextModel])) });
            setModelDrafts((prev) => ({ ...prev, [provider]: "" }));
          };

          return (
            <AccordionItem
              key={provider}
              className="rounded-lg border border-border bg-card"
              value={provider}
            >
              <AccordionTrigger className="px-4 py-3 transition-colors hover:bg-muted/50 hover:no-underline focus-visible:border-transparent focus-visible:ring-0">
                <div className="flex flex-1 items-center gap-3 min-w-0">
                  <ProviderAvatar provider={provider} label={label} />

                  <div className="flex flex-col items-start truncate">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {label}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground truncate">
                      {config.models.length > 0
                        ? `${config.models.length} model${config.models.length === 1 ? "" : "s"}`
                        : "No models"}
                    </span>
                  </div>
                </div>
              </AccordionTrigger>

              <AccordionContent className="border-t border-border px-4 pb-4 pt-3">
                <div className="space-y-4">
                  <ApiKeyField
                    value={config.apiKey}
                    onChange={(apiKey) => updateProvider(provider, { apiKey })}
                  />

                  <ModelListEditor
                    provider={provider}
                    providerLabel={labelFor(provider)}
                    apiKey={config.apiKey}
                    baseUrl={config.baseUrl}
                    catalogModels={catalogById.get(provider)?.models || []}
                    onSelect={(model) => updateProvider(provider, {
                      models: Array.from(new Set([...config.models, model])),
                    })}
                    models={config.models}
                    draft={modelDrafts[provider] || ""}
                    onDraftChange={(value) =>
                      setModelDrafts((prev) => ({ ...prev, [provider]: value }))
                    }
                    onAdd={addModel}
                    onRemove={(model) =>
                      updateProvider(provider, {
                        models: config.models.filter((item) => item !== model),
                      })
                    }
                    addLabel="Add Model"
                  />

                  {(provider === "openrouter" || provider === "ollama") && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Base URL
                      </Label>
                      <Input
                        className="h-8 font-mono text-xs"
                        value={config.baseUrl || ""}
                        onChange={(event) => updateProvider(provider, { baseUrl: event.target.value })}
                      />
                    </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      <p className="text-center text-xs text-muted-foreground">
        {modelCount} API model{modelCount === 1 ? "" : "s"} across {providerCount}{" "}
        API provider{providerCount === 1 ? "" : "s"}. {new Set(cliModels.map((m) => m.provider)).size} local CLIs available.
      </p>
    </section>
  );
}
