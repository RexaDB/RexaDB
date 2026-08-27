"use client";

import { cn } from "@/lib/utils";
import {
  Bot,
  Sparkles,
  Terminal,
  Code,
  Zap,
  Box,
  Brain,
} from "@/lib/icon-theme/lucide-react";
import type { AgentProvider, AgentProviderId } from "@/lib/agents/provider-types";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Bot,
  Sparkles,
  Terminal,
  Code,
  Zap,
  Box,
  Brain,
};

export function AgentsProviderSelector({
  providers,
  activeProvider,
  onSelect,
}: {
  providers: AgentProvider[];
  activeProvider: AgentProviderId;
  onSelect: (id: AgentProviderId) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 overflow-x-auto scrollbar-hide">
      {providers.map((provider) => {
        const Icon = ICON_MAP[provider.icon] || Bot;
        const isActive = provider.id === activeProvider;
        const isAvailable = provider.status === "installed";

        return (
          <button
            key={provider.id}
            onClick={() => onSelect(provider.id)}
            disabled={!isAvailable}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors shrink-0",
              isActive
                ? "bg-neutral-500/15 text-neutral-200 border border-neutral-500/20"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/30 border border-transparent",
              !isAvailable && "opacity-40 cursor-not-allowed",
            )}
            title={
              isAvailable
                ? provider.name
                : `${provider.name} (not installed)`
            }
          >
            {provider.id === "rexadb" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/ai-agent.png" alt="" className="w-4 h-4 shrink-0 rounded-[3px] object-cover dark:invert" />
            ) : (
              <Icon className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>{provider.name}</span>
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full shrink-0",
                provider.status === "installed"
                  ? "bg-emerald-400"
                  : provider.status === "auth-required"
                    ? "bg-amber-400"
                    : "bg-neutral-600",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
