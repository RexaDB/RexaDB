"use client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const TTL_UNITS = [
  { value: "seconds", label: "Seconds", multiplier: 1 },
  { value: "minutes", label: "Minutes", multiplier: 60 },
  { value: "hours", label: "Hours", multiplier: 60 * 60 },
  { value: "days", label: "Days", multiplier: 60 * 60 * 24 },
];

interface TtlUnitSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  selectItemClassName?: string;
}

export function TtlUnitSelect({
  value,
  onValueChange,
  selectItemClassName = "rounded-lg text-sm pl-3 pr-3",
}: TtlUnitSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="h-9 w-[120px] rounded-lg bg-muted/20 border-studio-border text-sm">
        <SelectValue placeholder="Seconds" />
      </SelectTrigger>
      <SelectContent
        position="popper"
        align="start"
        sideOffset={6}
        className="bg-studio-bg border-studio-border rounded-lg p-1"
      >
        {TTL_UNITS.map((unit) => (
          <SelectItem
            key={unit.value}
            value={unit.value}
            className={selectItemClassName}
          >
            {unit.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
