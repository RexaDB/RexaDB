"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Minus, Plus } from "@/lib/icon-theme/lucide-react";
import { SettingRow } from "@/components/studio/settings-view";
import { useState, useCallback, useEffect } from "react";

const MIN_ZOOM = 50;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;

export function ZoomSetting({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [inputValue, setInputValue] = useState(String(value));

  useEffect(() => {
    setInputValue(String(value));
  }, [value]);

  const clamp = useCallback((v: number) => {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(v)));
  }, []);

  const handleDecrement = useCallback(() => {
    onChange(clamp(value - ZOOM_STEP));
  }, [value, onChange, clamp]);

  const handleIncrement = useCallback(() => {
    onChange(clamp(value + ZOOM_STEP));
  }, [value, onChange, clamp]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputValue(e.target.value);
    },
    [],
  );

  const handleBlur = useCallback(() => {
    const parsed = parseInt(inputValue, 10);
    if (isNaN(parsed)) {
      setInputValue(String(value));
      return;
    }
    onChange(clamp(parsed));
  }, [inputValue, value, onChange, clamp]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        handleBlur();
      }
    },
    [handleBlur],
  );

  return (
    <SettingRow
      title="Zoom Level"
      description="Increase or decrease the overall zoom of the application."
    >
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={handleDecrement}
          disabled={value <= MIN_ZOOM}
        >
          <Minus className="h-3 w-3" />
        </Button>
        <Input
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="h-7 w-16 text-center text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={handleIncrement}
          disabled={value >= MAX_ZOOM}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    </SettingRow>
  );
}
