"use client";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";
import { cn } from "@/lib/utils";

type SearchableSelectOption =
  | string
  | { value: string; label: string; icon?: string };

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder?: string;
  emptyText?: string;
  searchThreshold?: number;
  className?: string;
  contentClassName?: string;
  inputClassName?: string;
  itemClassName?: string;
  listClassName?: string;
}

export function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder,
  searchPlaceholder = "Search...",
  emptyText = "No options found.",
  searchThreshold = 8,
  className,
  contentClassName,
  inputClassName,
  itemClassName,
  listClassName,
}: SearchableSelectProps) {
  const normalizedOptions = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  );
  const optionLabels = normalizedOptions.map((option) => option.label);
  const labelToValueMap = new Map(
    normalizedOptions.map((option) => [option.label, option.value]),
  );
  const valueToLabelMap = new Map(
    normalizedOptions.map((option) => [option.value, option.label]),
  );
  const labelToIcon = new Map(
    normalizedOptions.filter((o) => o.icon).map((o) => [o.label, o.icon!]),
  );
  const valueToIcon = new Map(
    normalizedOptions.filter((o) => o.icon).map((o) => [o.value, o.icon!]),
  );
  const selectedLabel = valueToLabelMap.get(value) ?? null;
  const selectedIcon = value ? valueToIcon.get(value) : undefined;
  const showSearch = normalizedOptions.length >= searchThreshold;

  return (
    <Combobox
      items={optionLabels}
      value={selectedLabel}
      onValueChange={(nextValue) => {
        if (!nextValue) return;
        onValueChange(labelToValueMap.get(nextValue) || nextValue);
      }}
    >
      <ComboboxTrigger
        className={cn(
          "h-9 w-full rounded-lg border border-border bg-muted/30 px-3 text-xs text-left flex items-center justify-between gap-2",
          className,
        )}
      >
        <span className="flex items-center gap-2 min-w-0">
          {selectedIcon ? (
            <img
              src={selectedIcon}
              alt=""
              className="w-4 h-4 rounded-lg object-contain shrink-0"
            />
          ) : null}
          <ComboboxValue placeholder={placeholder} />
        </span>
      </ComboboxTrigger>
      <ComboboxContent
        className={cn(
          "min-w-[var(--anchor-width)] w-max max-w-[min(var(--available-width),32rem)] max-h-72 overflow-hidden",
          contentClassName,
        )}
      >
        {showSearch && (
          <ComboboxInput
            placeholder={searchPlaceholder}
            showTrigger={false}
            showClear={false}
            className={cn("w-full", inputClassName)}
          />
        )}
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
        <ComboboxList className={cn("max-h-56 overflow-y-auto", listClassName)}>
          {(item) => (
            <ComboboxItem key={item} value={item} className={itemClassName}>
              {labelToIcon.has(item) ? (
                <img
                  src={labelToIcon.get(item)}
                  alt=""
                  className="w-4 h-4 rounded-lg object-contain shrink-0"
                />
              ) : null}
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
