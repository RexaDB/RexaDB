"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, Check } from "@/lib/icon-theme/lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import type { AgentMode } from "@/lib/agents/provider-types";
import type { RexaAgentAppMode } from "@/lib/agents/app-modes";

export function AgentsModePicker({
  modes,
  selectedMode,
  onSelectMode,
  appModes = [],
  selectedAppModeId,
  onSelectAppMode,
}: {
  modes: AgentMode[];
  selectedMode: string;
  onSelectMode: (mode: string) => void;
  appModes?: RexaAgentAppMode[];
  selectedAppModeId?: string;
  onSelectAppMode?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const activeApp = useMemo(
    () =>
      appModes.find((m) => m.id === selectedAppModeId) ??
      appModes.find((m) => m.kind === "plan") ??
      appModes[0],
    [appModes, selectedAppModeId],
  );

  const activeProviderMode = useMemo(
    () =>
      modes.find((m) => m.id === selectedMode) ??
      modes.find((m) => m.isDefault) ??
      modes[0],
    [modes, selectedMode],
  );

  const triggerLabel = activeApp?.label || activeProviderMode?.label || "Mode";

  if (appModes.length === 0 && modes.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="!h-8 min-w-0 max-w-36 shrink-0 justify-between gap-1.5 whitespace-nowrap rounded-md text-muted-foreground sm:max-w-44"
        >
          <span className="min-w-0 flex-1 overflow-hidden truncate text-left">
            {triggerLabel}
          </span>
          <ChevronDown className="-mx-0.5 size-3.5 shrink-0 opacity-50" strokeWidth={2.25} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="dropdown-glass w-64 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]"
      >
        {appModes.length > 0 && onSelectAppMode && (
          <AppModeGroup
            title="RexaDB"
            modes={appModes}
            selectedId={activeApp?.id}
            onSelect={(id) => {
              onSelectAppMode(id);
              setOpen(false);
            }}
          />
        )}
        {modes.length > 0 && (
          <ModeGroup
            title={appModes.length > 0 ? "Provider" : undefined}
            modes={modes.filter((m) => !m.isCustom)}
            selectedId={activeProviderMode?.id}
            onSelect={(id) => {
              onSelectMode(id);
              setOpen(false);
            }}
          />
        )}
        {modes.some((m) => m.isCustom) && (
          <ModeGroup
            title="Provider custom"
            modes={modes.filter((m) => m.isCustom)}
            selectedId={activeProviderMode?.id}
            onSelect={(id) => {
              onSelectMode(id);
              setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function AppModeGroup({
  title,
  modes,
  selectedId,
  onSelect,
}: {
  title?: string;
  modes: RexaAgentAppMode[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="py-0.5">
      {title && (
        <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
          {title}
        </div>
      )}
      {modes.map((mode) => {
        const isSelected = mode.id === selectedId;
        return (
          <button
            key={mode.id}
            type="button"
            onClick={() => onSelect(mode.id)}
            className={cn(
              "flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
              isSelected
                ? "bg-foreground/[0.08] text-foreground"
                : "text-foreground hover:bg-[color-mix(in_srgb,var(--popover)_90%,var(--foreground))]",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium leading-snug">
                {mode.label}
                {!mode.allowSqlWrite && (
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                    · propose only
                  </span>
                )}
              </div>
              {mode.description && (
                <div className="mt-0.5 truncate text-[11px] leading-snug text-muted-foreground/70">
                  {mode.description}
                </div>
              )}
            </div>
            {isSelected && <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />}
          </button>
        );
      })}
    </div>
  );
}

function ModeGroup({
  title,
  modes,
  selectedId,
  onSelect,
}: {
  title?: string;
  modes: AgentMode[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  if (modes.length === 0) return null;
  return (
    <div className="py-0.5">
      {title && (
        <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
          {title}
        </div>
      )}
      {modes.map((mode) => {
        const isSelected = mode.id === selectedId;
        return (
          <button
            key={mode.id}
            type="button"
            onClick={() => onSelect(mode.id)}
            className={cn(
              "flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
              isSelected
                ? "bg-foreground/[0.08] text-foreground"
                : "text-foreground hover:bg-[color-mix(in_srgb,var(--popover)_90%,var(--foreground))]",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium leading-snug">{mode.label}</div>
              {mode.description && (
                <div className="mt-0.5 truncate text-[11px] leading-snug text-muted-foreground/70">
                  {mode.description}
                </div>
              )}
            </div>
            {isSelected && <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />}
          </button>
        );
      })}
    </div>
  );
}
