"use client";

import { ChevronDown, Settings, Bot } from "@/lib/icon-theme/lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { GlobalAiSettings } from "@/lib/api/actions-client";
import { useDiscoveredAgents, getConfiguredModels } from "@/lib/ai/model-utils";

function getProviderBadge(provider: string) {
  if (provider === "external") {
    return <Bot className="h-3 w-3" />;
  }
  if (provider === "ollama") {
    return (
      <img
        alt="Ollama"
        className="h-3 w-3 object-contain"
        src="/providers/ollama-logo-black-light-svg.svg"
      />
    );
  }
  const src =
    provider === "google"
      ? "/providers/google.svg"
      : provider === "openai"
        ? "/providers/openai.svg"
        : provider === "anthropic"
          ? "/providers/anthropic_black.svg"
          : provider === "kilo"
            ? "/providers/kilo.svg"
            : "/providers/openrouter_light.svg";
  const toneClass = provider === "google" ? "" : "dark:invert";

  return (
    <img
      alt={provider}
      className={`h-3 w-3 object-contain ${toneClass}`}
      src={src}
    />
  );
}

export function AiModelPicker({
  settings,
  currentProvider,
  currentModel,
  onSelectProvider,
  onAddModels,
}: {
  settings: GlobalAiSettings;
  currentProvider?: string;
  currentModel?: string;
  onSelectProvider: (provider: string, model: string) => void;
  onAddModels: () => void;
}) {
  const discoveredAgents = useDiscoveredAgents();

  const { agents, llmModels } = getConfiguredModels(settings, discoveredAgents);
  const hasItems = agents.length > 0 || llmModels.length > 0;
  const displayLabel = currentModel || "Select model";
  const displayProvider = currentProvider || "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="h-6 gap-1 px-0.5 text-xs text-muted-foreground"
          variant="ghost"
        >
          <div className="flex h-3 w-3 items-center justify-center">
            {displayProvider ? (
              getProviderBadge(displayProvider)
            ) : (
              <Bot className="h-3 w-3" />
            )}
          </div>
          <span className="max-w-[90px] truncate">{displayLabel}</span>
          <ChevronDown className="h-2.5 w-2.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="z-[80] w-52 rounded-lg border-border bg-popover p-0"
      >
        <div className="p-1">
          {agents.map((agent) => (
            <DropdownMenuItem
              key={agent.id}
              className="gap-2 rounded-lg px-2 py-1.5 text-xs"
              onClick={() => onSelectProvider("external", agent.id)}
            >
              <div className="flex h-3 w-3 items-center justify-center">
                {getProviderBadge("external")}
              </div>
              <span className="truncate">{agent.model}</span>
            </DropdownMenuItem>
          ))}
          {agents.length > 0 && llmModels.length > 0 && (
            <div className="my-1 border-t border-border" />
          )}
          {llmModels.map(({ model, provider }) => (
            <DropdownMenuItem
              key={`${provider}-${model}`}
              className="gap-2 rounded-lg px-2 py-1.5 text-xs"
              onClick={() => onSelectProvider(provider, model)}
            >
              <div className="flex h-3 w-3 items-center justify-center">
                {getProviderBadge(provider)}
              </div>
              <span className="truncate">{model}</span>
            </DropdownMenuItem>
          ))}
          {!hasItems && (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">
              No models or agents found
            </div>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2 px-2 py-1.5 text-xs text-muted-foreground"
          onClick={onAddModels}
        >
          <Settings className="h-3.5 w-3.5" />
          AI Settings...
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
