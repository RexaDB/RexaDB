// components
import { LayoutGrid as grid, List as list } from "lucide-react";
import { Button } from "@/components/ui/button";

const views = [
  { value: "card", label: "Grid view", icon: grid },
  { value: "list", label: "List view", icon: list },
] as const;

export function ConnectionViewToggle({
  value,
  onChange,
}: {
  value: "card" | "list";
  onChange: (value: "card" | "list") => void;
}) {
  return (
    <div
      role="group"
      aria-label="Connection view"
      className="flex h-9 shrink-0 items-center gap-0.5 rounded-lg border border-border bg-background p-0.5"
    >
      {views.map((view) => (
        <Button
          key={view.value}
          type="button"
          variant={value === view.value ? "secondary" : "ghost"}
          size="icon-sm"
          className="rounded-md"
          aria-label={view.label}
          aria-pressed={value === view.value}
          title={view.label}
          onClick={() => onChange(view.value)}
        >
          <view.icon className="size-4" />
        </Button>
      ))}
    </div>
  );
}
