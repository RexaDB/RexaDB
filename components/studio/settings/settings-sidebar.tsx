"use client";

import { cn } from "@/lib/utils";

export type SettingsSectionId =
  | "general"
  | "editor"
  | "ai"
  | "security"
  | "advanced"
  | "themes"
  | "workspace";

const items: Array<{ id: SettingsSectionId; label: string }> = [
  { id: "general", label: "General" },
  { id: "editor", label: "Editor" },
  { id: "themes", label: "Themes" },
  { id: "ai", label: "AI" },
  { id: "security", label: "Security" },
  { id: "advanced", label: "Advanced" },
  { id: "workspace", label: "Workspace" },
];

export function SettingsSidebar({
  activeSection,
  onSelect,
}: {
  activeSection: SettingsSectionId;
  onSelect: (section: SettingsSectionId) => void;
}) {
  return (
    <aside className="sticky top-0 h-fit w-40 shrink-0 border-r border-border/60 pr-4">
      <nav className="flex flex-col gap-1.5 py-2">
        {items.map((item) => (
          <button
            key={item.id}
            className={cn(
              "rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
              activeSection === item.id
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
            onClick={() => onSelect(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
