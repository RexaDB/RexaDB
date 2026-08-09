"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Plus, X } from "@/lib/icon-theme/lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getGlobalAiSettings,
  saveGlobalAiSettings,
  type GlobalAiSettings,
} from "@/lib/api/actions-client";

const providerMeta = {
  openai: { label: "OpenAI", icon: "/providers/openai.svg" },
  anthropic: { label: "Anthropic", icon: "/providers/anthropic_black.svg" },
  google: { label: "Google", icon: "/providers/google.svg" },
  openrouter: { label: "OpenRouter", icon: "/providers/openrouter_light.svg" },
  kilo: { label: "Kilo Code", icon: "/providers/kilo.svg" },
  ollama: {
    label: "Ollama",
    icon: "/providers/ollama-logo-black-light-svg.svg",
  },
} as const;

export function AiSettingsSection() {
  const [settings, setSettings] = useState<GlobalAiSettings | null>(null);
  const [openItem, setOpenItem] = useState<string>("");
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    void (async () => {
      const result = await getGlobalAiSettings();
      if (result.success && result.data) {
        setSettings(result.data);
      }
    })();
  }, []);

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

  const updateSettings = (next: GlobalAiSettings) => {
    setSettings(next);
    void saveGlobalAiSettings(next);
  };

  const iconToneClass = (provider: keyof typeof providerMeta) => {
    if (provider === "google") return "";
    return "dark:invert";
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          Models
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Configure provider access and permissions.
        </p>
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
        {/* LLM Provider Accordions */}
        {Object.entries(providerMeta).map(([provider, meta]) => {
          const config =
            settings.providers[provider as keyof typeof settings.providers];

          const addModel = () => {
            const nextModel = (modelDrafts[provider] || "").trim();
            if (!nextModel) return;
            updateSettings({
              ...settings,
              providers: {
                ...settings.providers,
                [provider]: {
                  ...config,
                  models: Array.from(new Set([...config.models, nextModel])),
                },
              },
            });
            setModelDrafts((prev) => ({
              ...prev,
              [provider]: "",
            }));
          };

          return (
            <AccordionItem
              key={provider}
              className="rounded-lg border border-border bg-card"
              value={provider}
            >
              <AccordionTrigger className="px-4 py-3 transition-colors hover:bg-muted/50 hover:no-underline focus-visible:border-transparent focus-visible:ring-0">
                <div className="flex flex-1 items-center gap-3 min-w-0">
                  <Image
                    alt={meta.label}
                    className={iconToneClass(
                      provider as keyof typeof providerMeta,
                    )}
                    height={20}
                    src={meta.icon}
                    width={20}
                  />

                  <div className="flex flex-col items-start truncate">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {meta.label}
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
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      API Key
                    </Label>
                    <Input
                      type="password"
                      placeholder="sk-..."
                      className="h-8 font-mono text-xs"
                      value={config.apiKey}
                      onChange={(event) => {
                        updateSettings({
                          ...settings,
                          providers: {
                            ...settings.providers,
                            [provider]: {
                              ...config,
                              apiKey: event.target.value,
                            },
                          },
                        });
                      }}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Models
                    </Label>
                    <div className="space-y-1.5">
                      {config.models.map((model) => (
                        <div
                          key={model}
                          className="flex items-center justify-between rounded-lg border border-border px-2.5 py-1.5"
                        >
                          <span className="text-xs text-foreground">
                            {model}
                          </span>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => {
                              updateSettings({
                                ...settings,
                                providers: {
                                  ...settings.providers,
                                  [provider]: {
                                    ...config,
                                    models: config.models.filter(
                                      (item) => item !== model,
                                    ),
                                  },
                                },
                              });
                            }}
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
                        value={modelDrafts[provider] || ""}
                        onChange={(event) =>
                          setModelDrafts((prev) => ({
                            ...prev,
                            [provider]: event.target.value,
                          }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addModel();
                          }
                        }}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-2.5 text-xs"
                        onClick={addModel}
                      >
                        <Plus className="h-4 w-4" />
                        Add Model
                      </Button>
                    </div>
                  </div>

                  {(provider === "openrouter" || provider === "ollama") && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Base URL
                      </Label>
                      <Input
                        className="h-8 font-mono text-xs"
                        value={config.baseUrl || ""}
                        onChange={(event) =>
                          updateSettings({
                            ...settings,
                            providers: {
                              ...settings.providers,
                              [provider]: {
                                ...settings.providers[
                                  provider as keyof typeof settings.providers
                                ],
                                baseUrl: event.target.value,
                              },
                            },
                          })
                        }
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
