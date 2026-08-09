"use client";

import { Palette, Check, Sparkles } from "@/lib/icon-theme/lucide-react";

import { Button } from "@/components/ui/button";
import type { ParsedThemeBlock as ThemeBlockData } from "@/lib/ai/chat-blocks";
export type { ThemeBlockData };

function extractKeyColors(colors?: Record<string, string>) {
  if (!colors) return [];
  const priority = [
    "--primary",
    "--background",
    "--foreground",
    "--card",
    "--muted",
    "--accent",
    "--border",
    "--studio-bg",
    "--studio-cell-text",
    "--studio-selection",
    "--chart-1",
    "--chart-2",
    "--chart-3",
  ];
  const seen = new Set<string>();
  const result: Array<{ label: string; value: string }> = [];
  for (const key of priority) {
    const val = colors[key];
    if (val && !seen.has(val)) {
      seen.add(val);
      result.push({ label: key.replace(/^--/, ""), value: val });
    }
  }
  for (const [key, val] of Object.entries(colors)) {
    if (result.length >= 8) break;
    if (val && !seen.has(val)) {
      seen.add(val);
      result.push({ label: key.replace(/^--/, ""), value: val });
    }
  }
  return result;
}

export function AiThemeBlock({
  themeBlock,
  onApply,
}: {
  themeBlock: ThemeBlockData;
  onApply: (block: ThemeBlockData) => void;
}) {
  const isApp = themeBlock.type === "app";
  const title = themeBlock.theme.name;
  const chips = isApp
    ? extractKeyColors(
        (themeBlock as Extract<ThemeBlockData, { type: "app" }>).theme.colors,
      )
    : [];

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Palette className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{title}</span>
        </div>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          {isApp
            ? themeBlock.theme.base === "dark"
              ? "Dark"
              : "Light"
            : "Editor"}
        </span>
      </div>

      <div className="space-y-3 px-3 py-3">
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <span
                key={chip.label}
                className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-xs font-medium text-foreground/80"
                style={{
                  backgroundColor: chip.value,
                  color: isLight(chip.value) ? "#000" : "#fff",
                }}
              >
                {chip.label}
              </span>
            ))}
          </div>
        )}

        <Button
          className="h-8 gap-1.5 px-3 text-xs"
          onClick={() => onApply(themeBlock)}
          variant="outline"
        >
          <Check className="h-3.5 w-3.5" />
          Add Theme
        </Button>
      </div>
    </div>
  );
}

function isLight(hex: string): boolean {
  const match = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})/i);
  if (!match) return false;
  const r = parseInt(match[1], 16);
  const g = parseInt(match[2], 16);
  const b = parseInt(match[3], 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}
