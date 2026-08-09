"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type SelectWithSearchOption = {
  value: string;
  label: string;
};

interface SelectWithSearchProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectWithSearchOption[];
  placeholder: string;
  emptyText?: string;
  searchPlaceholder?: string;
  searchThreshold?: number;
  triggerClassName?: string;
  contentClassName?: string;
}

export function SelectWithSearch({
  value,
  onValueChange,
  options,
  placeholder,
  emptyText = "No options found.",
  searchPlaceholder = "Search...",
  searchThreshold = 10,
  triggerClassName,
  contentClassName,
}: SelectWithSearchProps) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={triggerClassName}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent
        searchThreshold={searchThreshold}
        searchPlaceholder={searchPlaceholder}
        emptyText={emptyText}
        className={contentClassName}
      >
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="text-xs py-1.5 pl-2.5 pr-7 rounded-lg"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
