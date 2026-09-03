"use client";

import { cn } from "@/lib/utils";
import {
  Settings2,
  Code2,
  Palette,
  Bot,
  Shield,
  SlidersHorizontal,
  Keyboard,
  Users,
  Server as ServerIcon,
} from "@/lib/icon-theme/lucide-react";

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
}: {
  activeSection: SettingsSectionId;
  onSelect: (section: SettingsSectionId) => void;
}) {
  return (
    <aside className="sticky top-0 flex h-full min-h-0 w-52 shrink-0 flex-col border-r border-border">
      <nav className="flex flex-col gap-1 px-2 py-4">
        {items.map(({ id, label, Icon }) => (
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
