"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, Search, Check, Star } from "@/lib/icon-theme/lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  RexaDBIcon,
  ClaudeIcon,
  OpenCodeIcon,
  OpenAIIcon,
  GrokIcon,
  CursorIcon,
  FxIcon,
  PiIcon,
} from "./provider-icons";
import {
  AGENT_PROVIDER_META,
  type AgentModel,
  type AgentProvider,
  type AgentProviderId,
} from "@/lib/agents/provider-types";

const PROVIDER_ICON_MAP: Record<
  AgentProviderId,
  React.ComponentType<{ className?: string }>
> = {
  rexadb: RexaDBIcon,
  "claude-code": ClaudeIcon,
  opencode: OpenCodeIcon,
  codex: OpenAIIcon,
  "grok-build": GrokIcon,
  cursor: CursorIcon,
  fx: FxIcon,
  pi: PiIcon,
};

// Multi-provider agents (opencode, fx, pi) list models from several
// underlying model providers under one CLI — `model.subProvider` carries
// that origin (e.g. parsed from an "anthropic/claude-sonnet-5" slug). Map
// the ones we have a real logo for; anything else falls back to the active
// agent's own icon rather than guessing.
const SUB_PROVIDER_ICON_MAP: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  anthropic: ClaudeIcon,
  claude: ClaudeIcon,
  openai: OpenAIIcon,
  xai: GrokIcon,
  "x-ai": GrokIcon,
  grok: GrokIcon,
  opencode: OpenCodeIcon,
};

function resolveModelIcon(
  model: AgentModel,
  fallback: React.ComponentType<{ className?: string }>,
): React.ComponentType<{ className?: string }> {
  if (!model.subProvider) return fallback;
  return SUB_PROVIDER_ICON_MAP[model.subProvider.toLowerCase()] ?? fallback;
}

function getProviderModels(
  providerId: AgentProviderId,
  provider?: AgentProvider,
): AgentModel[] {
  if (provider?.models && provider.models.length > 0) {
    return provider.models;
  }
  return AGENT_PROVIDER_META[providerId].models;
}

// ─── Model row (matches t3code's Lqe component) ─────────────────────────────
function ModelRow({
  model,
  isSelected,
  providerName,
  ProviderIcon,
  onSelect,
}: {
  model: AgentModel;
  isSelected: boolean;
  providerName: string;
  ProviderIcon: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative w-full !min-w-0 max-w-full cursor-pointer rounded-md px-2 py-2",
        "transition-[background-color,box-shadow,color]",
        isSelected
          ? "bg-foreground/[0.08] text-foreground"
          : "text-foreground hover:bg-[color-mix(in_srgb,var(--popover)_90%,var(--foreground))]",
      )}
    >
      <div className="flex w-full items-center gap-3">
        <div className="min-w-0 flex-1 text-left">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-xs font-medium leading-snug">
              {model.label}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <ProviderIcon className="size-3 shrink-0" />
            <span className="truncate text-xs font-normal leading-snug text-muted-foreground/70">
              {model.description ?? providerName}
            </span>
          </div>
        </div>
        {isSelected && (
          <div className="flex shrink-0 items-center gap-1.5">
            <Check className="size-3.5 shrink-0 text-primary" />
          </div>
        )}
      </div>
    </button>
  );
}

// ─── Legacy section header (matches t3code's collapsible) ────────────────────
function LegacySectionHeader({
  count,
  isExpanded,
  onToggle,
}: {
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isExpanded}
      className="group w-full cursor-pointer rounded-md px-2 py-2 transition-[background-color] hover:bg-[color-mix(in_srgb,var(--popover)_90%,var(--foreground))]"
    >
      <div className="flex w-full items-center gap-3">
        <div className="min-w-0 flex-1 text-left">
          <div className="text-xs font-medium leading-snug">Legacy models</div>
          <div className="mt-1 text-xs font-normal leading-snug text-muted-foreground/70">
            {count} models
          </div>
        </div>
        <ChevronDown
          className={cn("size-4 transition-transform", isExpanded && "rotate-90")}
        />
      </div>
    </button>
  );
}

export function AgentsModelPicker({
  providers,
  activeProvider,
  onSelectProvider,
  selectedModel,
  onSelectModel,
  isDetecting,
}: {
  providers: AgentProvider[];
  activeProvider: AgentProviderId;
  onSelectProvider: (id: AgentProviderId) => void;
  selectedModel: string;
  onSelectModel: (model: string) => void;
  isDetecting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [legacyExpanded, setLegacyExpanded] = useState(false);

  const activeMeta =
    providers.find((p) => p.id === activeProvider) ?? providers[0];
  const ActiveIcon = PROVIDER_ICON_MAP[activeProvider] ?? RexaDBIcon;

  const activeModels = getProviderModels(activeProvider, activeMeta);

  const triggerLabel = useMemo(() => {
    const model = activeModels.find((m) => m.id === selectedModel);
    if (model) return model.label;
    if (selectedModel) return selectedModel;
    return activeMeta?.name ?? "Agent";
  }, [activeModels, activeMeta, selectedModel]);

  // Split into current and legacy models (t3code's oJe/sJe filter)
  const { currentModels, legacyModels } = useMemo(() => {
    const sorted = [...activeModels].sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return 0;
    });
    return {
      currentModels: sorted.filter((m) => !m.isLegacy),
      legacyModels: sorted.filter((m) => m.isLegacy),
    };
  }, [activeModels]);

  const filterModels = (models: typeof currentModels, query: string) => {
    if (!query.trim()) return models;
    const q = query.toLowerCase();
    return models.filter(
      (m) =>
        m.label.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q),
    );
  };

  const filteredCurrent = useMemo(
    () => filterModels(currentModels, searchQuery),
    [currentModels, searchQuery],
  );

  const filteredLegacy = useMemo(
    () => filterModels(legacyModels, searchQuery),
    [legacyModels, searchQuery],
  );

  const allFiltered = useMemo(() => {
    if (legacyModels.length > 0 && legacyExpanded) {
      return [...filteredCurrent, ...filteredLegacy];
    }
    return filteredCurrent;
  }, [filteredCurrent, filteredLegacy, legacyModels.length, legacyExpanded]);

  const renderModelRows = (models: typeof currentModels) =>
    models.map((model) => (
      <div key={model.id}>
        <ModelRow
          model={model}
          isSelected={model.id === selectedModel}
          providerName={activeMeta?.name ?? "Agent"}
          ProviderIcon={resolveModelIcon(model, ActiveIcon)}
          onSelect={() => {
            onSelectModel(model.id);
            setOpen(false);
          }}
        />
        <div className="h-0.5" />
      </div>
    ));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "!h-8 min-w-0 shrink-0 justify-between gap-1.5 whitespace-nowrap rounded-md text-muted-foreground",
            "max-w-48 sm:max-w-56",
          )}
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <ActiveIcon className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 overflow-hidden truncate">
              {triggerLabel}
            </span>
          </span>
          <ChevronDown className="-mx-0.5 size-3.5 shrink-0 opacity-50" strokeWidth={2.25} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="dropdown-glass model-picker-surface relative flex h-86.5 max-h-86.5 w-screen max-w-90 flex-row overflow-hidden rounded-lg border bg-popover p-0 text-popover-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)] [clip-path:inset(0_round_var(--radius-lg))]"
      >
        {/* Sidebar — provider icons only (t3code: w-11, aspect-square buttons) */}
        <div
          data-model-picker-sidebar="true"
          className="w-11 shrink-0 overflow-y-auto overflow-x-hidden bg-muted/30 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="relative flex min-h-full flex-col gap-1 p-1">
            {isDetecting ? (
              <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                Detecting...
              </div>
            ) : (
              providers.map((provider) => {
                const Icon = PROVIDER_ICON_MAP[provider.id] ?? RexaDBIcon;
                const isActive = provider.id === activeProvider;
                const isAvailable = provider.status === "installed";
                return (
                  <button
                    key={provider.id}
                    type="button"
                    disabled={!isAvailable}
                    onClick={() => {
                      onSelectProvider(provider.id);
                      setSearchQuery("");
                      setLegacyExpanded(false);
                    }}
                    className={cn(
                      "relative isolate flex w-full cursor-pointer aspect-square items-center justify-center rounded-md transition-colors",
                      "hover:bg-[color-mix(in_srgb,var(--popover)_90%,var(--foreground))] focus-visible:bg-[color-mix(in_srgb,var(--popover)_90%,var(--foreground))] focus-visible:outline-none",
                      !isAvailable && "cursor-not-allowed opacity-50 hover:bg-transparent",
                    )}
                  >
                    <Icon className="size-5 shrink-0" />
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right side — search + model list (t3code: bg-muted/40, border-l) */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-l border-border/70 bg-muted/40">
          {/* Search bar */}
          <div className="px-2 pt-2">
            <div className="border-b border-border/70 pb-2.5 transition-colors focus-within:border-ring">
              <div className="flex items-center gap-1.5">
                <Search className="-translate-x-0.5 size-4 shrink-0 text-muted-foreground opacity-70" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search models..."
                  className="h-6.5 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
                  autoFocus
                />
              </div>
            </div>
          </div>

          {/* Model list */}
          <div className="model-picker-list scrollbar-gutter-stable min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain py-1.5 [--fade-size:1.5rem]">
            <div className="pl-2 pr-2">
              {allFiltered.length > 0 ? (
                <>
                  {renderModelRows(filteredCurrent)}

                  {/* Legacy section (collapsible, starts collapsed) */}
                  {legacyModels.length > 0 && filteredLegacy.length > 0 && (
                    <>
                      {!searchQuery.trim() && (
                        <LegacySectionHeader
                          count={filteredLegacy.length}
                          isExpanded={legacyExpanded}
                          onToggle={() => setLegacyExpanded((v) => !v)}
                        />
                      )}
                      {(legacyExpanded || searchQuery.trim()) && renderModelRows(filteredLegacy)}
                    </>
                  )}
                </>
              ) : (
                <div className="not-empty:py-6 empty:h-0 px-2 py-4 text-center text-xs font-normal leading-snug text-muted-foreground">
                  No models found
                </div>
              )}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
