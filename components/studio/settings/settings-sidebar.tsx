"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Settings2,
  Code2,
  Palette,
  Bot,
  Shield,
  SlidersHorizontal,
  Keyboard,
  Users,
  Search,
  X,
  Server as ServerIcon,
} from "@/lib/icon-theme/lucide-react";
import { filterSettingsSearch } from "@/components/studio/settings/settings-search";

export type SettingsSectionId =
  | "general"
  | "editor"
  | "ai"
  | "mcp"
  | "security"
  | "advanced"
  | "themes"
  | "keybindings"
  | "workspace";

const items: Array<{
  id: SettingsSectionId;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "general", label: "General", Icon: Settings2 },
  { id: "editor", label: "Editor", Icon: Code2 },
  { id: "themes", label: "Themes", Icon: Palette },
  { id: "ai", label: "AI", Icon: Bot },
  { id: "mcp", label: "MCP Server", Icon: ServerIcon },
  { id: "security", label: "Security", Icon: Shield },
  { id: "keybindings", label: "Keybindings", Icon: Keyboard },
  { id: "advanced", label: "Advanced", Icon: SlidersHorizontal },
  { id: "workspace", label: "Workspace", Icon: Users },
];

export function SettingsSidebar({
  activeSection,
  onSelect,
  searchQuery,
  onSearchChange,
}: {
  activeSection: SettingsSectionId;
  onSelect: (section: SettingsSectionId) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
}) {
  const query = searchQuery ?? "";
  const showSearch = onSearchChange !== undefined;

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    const matchingSections = new Set(
      filterSettingsSearch(q).map((entry) => entry.section),
    );
    return items.filter(
      ({ id, label }) =>
        label.toLowerCase().includes(q) || matchingSections.has(id),
    );
  }, [query]);

  return (
    <aside className="sticky top-0 flex h-full min-h-0 w-52 shrink-0 flex-col border-r border-border">
      {showSearch ? (
        <div className="px-2 pt-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => onSearchChange?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") onSearchChange?.("");
              }}
              placeholder="Search settings"
              aria-label="Search settings"
              className="h-7 pl-7 pr-7 text-xs"
            />
            {query ? (
              <button
                type="button"
                aria-label="Clear settings search"
                onClick={() => onSearchChange?.("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <nav className="flex flex-col gap-1 px-2 py-4">
        {visibleItems.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors",
              activeSection === id
                ? "bg-muted text-foreground font-medium"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
            onClick={() => onSelect(id)}
            type="button"
          >
            <Icon className="size-4 shrink-0" />
            {label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
