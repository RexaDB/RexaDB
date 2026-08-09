"use client";

import { type Dispatch, type SetStateAction } from "react";
import { cn } from "@/lib/utils";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useSidebarResize } from "@/hooks/use-sidebar-resize";
import { ResizeHandle } from "@/components/studio/sidebar-common";
import { SidebarHeader } from "@/components/studio/sidebar-header";
import { MarketplaceExtensionList } from "@/components/studio/marketplace-extension-list";
import type { CustomAppTheme } from "@/lib/studio/app-themes";
import type { CustomEditorTheme } from "@/lib/studio/editor-themes";

interface ThemeSidebarProps {
  appThemeId: string;
  customAppThemes: CustomAppTheme[];
  setCustomAppThemes: Dispatch<SetStateAction<CustomAppTheme[]>>;
  setAppThemeId: (id: string) => void;
  editorThemeId: string;
  customEditorThemes: CustomEditorTheme[];
  setCustomEditorThemes: Dispatch<SetStateAction<CustomEditorTheme[]>>;
  setEditorThemeId: (id: string) => void;
  sleek?: boolean;
}

export function ThemeSidebar({
  customAppThemes,
  setCustomAppThemes,
  setAppThemeId,
  customEditorThemes,
  setCustomEditorThemes,
  setEditorThemeId,
  sleek,
}: ThemeSidebarProps) {
  const [sidebarWidth, setSidebarWidth] = useLocalStorage("rexadb:sidebar-width-themes", 420);
  const { handlePointerDown } = useSidebarResize(sidebarWidth, setSidebarWidth);

  return (
    <div
      className={cn(
        "relative shrink-0 border-r border-studio-border bg-popover flex flex-col h-full",
        sleek && "border-studio-border/70",
      )}
      style={{ width: sidebarWidth }}
    >
      <SidebarHeader title="Theme Extensions" />
      <div className="flex-1 overflow-hidden px-3 pb-3 pt-2">
        <MarketplaceExtensionList
          customAppThemes={customAppThemes}
          setCustomAppThemes={setCustomAppThemes}
          customEditorThemes={customEditorThemes}
          setCustomEditorThemes={setCustomEditorThemes}
        />
      </div>
      <ResizeHandle onPointerDown={handlePointerDown} />
    </div>
  );
}
