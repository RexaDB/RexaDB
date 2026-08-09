"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface CustomFontSettingProps {
  value?: string;
  onChange: (value: string) => void;
  title?: string;
  description?: string;
}

export function CustomFontSetting({ value, onChange, title, description }: CustomFontSettingProps) {
  const safeValue = value ?? "";
  return (
    <div className="flex items-start justify-between gap-3 border-t border-border py-3">
      <div className="flex flex-col">
        <span className="font-medium text-xs">{title ?? "Custom Font Family"}</span>
        <span className="max-w-md text-xs text-muted-foreground">
          {description ?? 'Use any installed font or font stack. Example: "IBM Plex Sans", "Segoe UI", sans-serif'}
        </span>
      </div>
      <div className="flex w-full max-w-sm items-center gap-2">
        <Input
          className="h-8 text-xs"
          onChange={(event) => onChange(event.target.value)}
          placeholder={'"IBM Plex Sans", "Segoe UI", sans-serif'}
          value={safeValue}
        />
        <Button
          className="h-8 px-2.5 text-xs"
          disabled={!safeValue.trim()}
          onClick={() => onChange("")}
          type="button"
          variant="outline"
        >
          Clear
        </Button>
      </div>
    </div>
  );
}
