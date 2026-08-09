import { useEffect } from "react";
import { buildShortcutCombo } from "@/lib/studio/keybindings";
import type { Keybinding } from "@/lib/studio/keybindings";

interface UseStudioPanelShortcutsProps {
  onToggleAi: () => void;
  onToggleSql: () => void;
  onTogglePendingChanges: () => void;
  keybindings: Record<string, Keybinding>;
}

export function useStudioPanelShortcuts({
  onToggleAi,
  onToggleSql,
  onTogglePendingChanges,
  keybindings,
}: UseStudioPanelShortcutsProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const comboStr = buildShortcutCombo(event);
      if (!comboStr) return;

      const binding = keybindings[comboStr];
      if (!binding) return;

      switch (binding.type) {
        case "TOGGLE_GLOBAL_SQL_PANEL":
          event.preventDefault();
          onToggleSql();
          break;
        case "TOGGLE_AI_PANEL":
          event.preventDefault();
          onToggleAi();
          break;
        case "TOGGLE_PENDING_CHANGES_PANEL":
          event.preventDefault();
          onTogglePendingChanges();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onToggleAi, onToggleSql, onTogglePendingChanges, keybindings]);
}
