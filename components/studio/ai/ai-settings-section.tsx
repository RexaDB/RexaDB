"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Plus, X, ArrowRight } from "@/lib/icon-theme/lucide-react";

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
  const { settings, updateSettings, updateProvider, labelFor } = useAiProviderSettings();
  const [openItem, setOpenItem] = useState<string>("");
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});

  const modelCount = useMemo(
    () =>
      Object.values(settings?.providers || {}).reduce(
        (sum, provider) => sum + provider.models.length,
        0,
      ),
    [settings],
  );

  const providerCount = useMemo(
    () =>
      Object.entries(settings?.providers || {}).filter(
        ([p, c]) => (p === "ollama" || c.apiKey.trim()) && c.models.length > 0,
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
        {modelCount} model{modelCount === 1 ? "" : "s"} across {providerCount}{" "}
        provider{providerCount === 1 ? "" : "s"}.
      </p>
    </section>
  );
}
