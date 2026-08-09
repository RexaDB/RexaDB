"use client";

import { ChevronDown } from "@/lib/icon-theme/lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useEffect, useState } from "react";

export interface SelectOption {
  label: string;
  value: string;
}

interface SelectFilterProps {
  label: string;
  options: SelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  showSearch?: boolean;
  className?: string;
}

export function SelectFilter({
  label,
  options,
  value,
  onChange,
  showSearch = false,
  className,
}: SelectFilterProps) {
  const [open, setOpen] = useState(false);
  const [tempValue, setTempValue] = useState<string[]>(value);

  const isActive = tempValue.length > 0;

  useEffect(() => {
    if (!open) {
      setTempValue(value);
    }
  }, [open, value]);

  const handleApply = () => {
    onChange([...tempValue].sort());
    setOpen(false);
  };

  const handleClearAll = () => {
    setTempValue([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleApply();
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "min-w-20 relative group justify-between",
            isActive ? "border-solid bg-muted" : "border-dashed",
            className,
          )}
        >
          <span>
            {label}
            {tempValue.length > 0 && (
              <span className="ml-1 text-xs">({tempValue.length})</span>
            )}
          </span>
          <ChevronDown className="w-3.5 h-3.5 ml-1" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="p-0 w-72">
        <Command>
          {showSearch && <CommandInput placeholder="Search..." className="text-xs" />}
          <CommandList className="max-h-72">
            <CommandEmpty>No options found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem key={option.value}>
                  <label
                    className="flex items-center overflow-hidden rounded-xs gap-x-3 w-full h-full cursor-pointer"
                  >
                    <Checkbox
                      checked={tempValue.includes(option.value)}
                      onCheckedChange={(checked) => {
                        setTempValue(
                          checked
                            ? [...tempValue, option.value]
                            : tempValue.filter((x) => x !== option.value),
                        );
                      }}
                      onKeyDown={handleKeyDown}
                    />
                    <div className="flex items-center justify-between w-full">
                      <span className="text-xs">{option.label}</span>
                    </div>
                  </label>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="flex items-center justify-end gap-2 border-t border-border p-2">
          <Button size="sm" variant="outline" onClick={handleClearAll}>
            Clear
          </Button>
          <Button size="sm" variant="default" onClick={handleApply}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
