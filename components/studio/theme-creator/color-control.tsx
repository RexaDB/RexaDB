"use client";

import { useState, useEffect, useCallback } from "react";
import { RotateCcw } from "@/lib/icon-theme/lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toHex, COLOR_PRESETS } from "./theme-colors-shared";

interface ColorControlProps {
  label: string;
  variable: string;
  value: string;
  defaultValue: string;
  onChange: (variable: string, value: string) => void;
}

export function ColorControl({
  label,
  variable,
  value,
  defaultValue,
  onChange,
}: ColorControlProps) {
  const [hexInput, setHexInput] = useState("");

  useEffect(() => {
    setHexInput(toHex(value));
  }, [value]);

  const parseHex = useCallback(
    (hex: string): string => {
      const cleaned = hex.replace("#", "");
      if (/^[0-9a-fA-F]{6}$/.test(cleaned)) return `#${cleaned.toLowerCase()}`;
      if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
        const [r, g, b] = cleaned;
        return `#${r}${r}${g}${g}${b}${b}`;
      }
      return value;
    },
    [value],
  );

  function handleColorChange(newColor: string) {
    setHexInput(newColor);
    onChange(variable, newColor);
  }

  function handleHexBlur() {
    const parsed = parseHex(hexInput);
    setHexInput(parsed);
    onChange(variable, parsed);
  }

  function handleReset() {
    const defHex = toHex(defaultValue);
    setHexInput(defHex);
    onChange(variable, defaultValue);
  }

  const isModified = value !== defaultValue;
  const currentHex = hexInput || "#888";
  const swatchStyle = { backgroundColor: currentHex };

  return (
    <div className="flex items-center gap-2.5 group">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-studio-border/60"
            style={swatchStyle}
            aria-label={`Pick color for ${label}`}
          />
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={4}
          className="w-[200px] bg-popover border-border p-2"
        >
          <div className="grid grid-cols-8 gap-1">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => handleColorChange(c)}
                className={cn(
                  "h-5 w-5 cursor-pointer rounded-lg border transition-transform hover:scale-125",
                  c === currentHex ? "border-foreground" : "border-transparent",
                )}
                style={{ backgroundColor: c }}
                aria-label={c}
              />
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1.5 border-t border-border/50 pt-2">
            <div
              className="h-5 w-5 shrink-0 rounded-lg border border-studio-border/60"
              style={{ backgroundColor: currentHex }}
            />
            <input
              type="text"
              value={hexInput}
              onChange={(e) => setHexInput(e.target.value)}
              onBlur={handleHexBlur}
              onKeyDown={(e) => e.key === "Enter" && handleHexBlur()}
              className="h-6 flex-1 rounded-lg border border-border/50 bg-transparent px-1.5 font-mono text-xs outline-none focus:border-border"
            />
          </div>
        </PopoverContent>
      </Popover>
      <span className="min-w-[80px] text-xs text-foreground">{label}</span>
      <input
        type="text"
        value={hexInput}
        onChange={(e) => setHexInput(e.target.value)}
        onBlur={handleHexBlur}
        onKeyDown={(e) => e.key === "Enter" && handleHexBlur()}
        className={cn(
          "h-6 min-w-0 flex-1 rounded-lg border bg-transparent px-1.5 font-mono text-xs outline-none transition-colors",
          isModified
            ? "border-blue-500/40 text-blue-400"
            : "border-studio-border/40 text-muted-foreground",
        )}
      />
      {isModified && (
        <button
          type="button"
          onClick={handleReset}
          className="shrink-0 text-muted-foreground/40 transition-colors hover:text-foreground"
          aria-label={`Reset ${label}`}
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
