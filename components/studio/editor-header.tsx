import React from "react";
import {
  Table2 as TableIcon,
  X,
  Plus,
  KeyRound,
  Columns2,
  ArrowRight,
  ArrowLeft,
  Pin,
} from "@/lib/icon-theme/lucide-react";
import { getAllTabTypes, getTabIcon } from "@/lib/studio/tab-registry";
import type { ConnectionDbType } from "@/lib/db/connection-type";
import { getEditorLabel } from "@/lib/studio/db-labels";
import { StudioTooltip } from "./studio-tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { CloseDirtyDialog } from "./close-dirty-dialog";

interface EditorHeaderProps {
  connection: { name: string };
  dbType: ConnectionDbType;
  selectedSchema: string;
  selectedTable: string | null;
  openTabs: any[];
  setOpenTabs: React.Dispatch<React.SetStateAction<any[]>>;
  activeTabId: string | null;
  setActiveTabId: (id: string | null) => void;
  switchTab: (id: string) => void;
  setSelectedCell: (cell: any) => void;
  setViewMode: (
    mode:
      | "tables"
      | "sql"
      | "database"
      | "create-table"
      | "create-key"
      | "settings"
      | "agent-settings"
      | "profile-settings"
      | "keybindings"
      | "dashboard"
      | "import-export"
      | "create-enum"
      | "create-index"
      | "create-trigger"
      | "create-schema"
      | "create-database"
      | "code"
      | "history"
      | "auth"
      | "advisor",
  ) => void;
  setSelectedTable: (table: string | null) => void;
  setSelectedSchema: (schema: string) => void;
  closeTab: (e: React.MouseEvent, id: string) => void;
  closeTabById?: (id: string) => void;
  togglePinTab?: (id: string) => void;
  refreshCurrentTab: () => void;
  viewMode:
    | "tables"
    | "sql"
    | "database"
    | "create-table"
    | "create-key"
    | "settings"
    | "agent-settings"
    | "profile-settings"
    | "keybindings"
    | "dashboard"
    | "import-export"
    | "create-enum"
    | "create-index"
    | "create-trigger"
    | "create-schema"
    | "create-database"
    | "code"
    | "history"
    | "auth"
    | "advisor"
    | "workflow";
  handleRunQuery: () => void;
  loading: boolean;
  databaseView?:
    | "schema"
    | "tables"
    | "functions"
    | "extensions"
    | "triggers"
    | "enums"
    | "indexes"
    | "rls-policies";
  openSqlEditor: (
    table?: string,
    schema?: string,
    initialQuery?: string,
  ) => void;
  isPaneActive?: boolean;
  onActivatePane?: () => void;
  onSplitPane?: () => void;
  onClosePane?: () => void;
  showTabIndicator?: boolean;
  paneId?: string;
  paneTabIds?: string[];
  onCloseOtherTabs?: (keepTabId: string) => void;
  onCloseAllTabs?: () => void;
  onCloseTabsToRight?: (anchorTabId: string) => void;
  onCloseTabsToLeft?: (anchorTabId: string) => void;
  onTabPaneDragStart?: (tab: any, clientX: number, clientY: number) => void;
  onTabPaneDragMove?: (clientX: number, clientY: number) => void;
  onTabPaneDragEnd?: () => void;
  onTabPaneDragCancel?: () => void;
  isTabPaneDragging?: boolean;
  previewTabs?: boolean;
  confirmPreviewTab?: (id: string) => void;
}

const TAB_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  ...Object.fromEntries(
    getAllTabTypes().map((type) => [type, getTabIcon(type) ?? TableIcon]),
  ),
  key: KeyRound,
};

const TAB_DRAG_ICON_COLORS: Record<string, string> = {
  table: "text-blue-500",
  sql: "text-orange-500",
  "create-table": "text-green-500",
  "create-key": "text-green-500",
  "database-schema": "text-purple-500",
  "database-tables": "text-blue-500",
  "database-functions": "text-yellow-500",
  "database-extensions": "text-pink-500",
  "database-rls-policies": "text-cyan-500",
  settings: "text-blue-500",
  "agent-settings": "text-blue-500",
  "profile-settings": "text-blue-500",
  dashboard: "text-cyan-500",
  analytics: "text-cyan-500",
  advisor: "text-cyan-500",
  "manage-workspaces": "text-purple-500",
  "diff-table": "text-purple-500",
  "connect-studio": "text-purple-500",
  "payments-plans": "text-blue-500",
  "payments-customers": "text-cyan-500",
  "payments-subscriptions": "text-purple-500",
  "payments-revenue": "text-green-500",
  "payments-webhooks": "text-yellow-500",
  "payments-setup": "text-muted-foreground",
};

function TabIcon({
  tabType,
  isActive,
}: {
  tabType: string;
  isActive: boolean;
}) {
  const Icon = TAB_ICONS[tabType] ?? TableIcon;
  return (
    <Icon
      className={`w-3 h-3 ${isActive ? "text-primary" : "text-muted-foreground"}`}
    />
  );
}

export function EditorHeader({
  connection,
  dbType,
  selectedSchema,
  selectedTable,
  openTabs,
  setOpenTabs,
  activeTabId,
  setActiveTabId,
  switchTab,
  setSelectedCell,
  setViewMode,
  setSelectedTable,
  setSelectedSchema,
  closeTab,
  closeTabById,
  togglePinTab,
  refreshCurrentTab,
  viewMode,
  handleRunQuery,
  loading,
  databaseView,
  openSqlEditor,
  isPaneActive,
  onActivatePane,
  onSplitPane,
  onClosePane,
  showTabIndicator = true,
  paneId,
  paneTabIds,
  onCloseOtherTabs,
  onCloseAllTabs,
  onCloseTabsToRight,
  onCloseTabsToLeft,
  onTabPaneDragStart,
  onTabPaneDragMove,
  onTabPaneDragEnd,
  onTabPaneDragCancel,
  isTabPaneDragging,
  previewTabs,
  confirmPreviewTab,
}: EditorHeaderProps) {
  const tabsRef = React.useRef<HTMLDivElement>(null);
  const [scrollInfo, setScrollInfo] = React.useState({
    scrollLeft: 0,
    scrollWidth: 0,
    clientWidth: 0,
  });
  const [isDragging, setIsDragging] = React.useState(false);
  const [isTabDragActive, setIsTabDragActive] = React.useState(false);
  const [draggedTabId, setDraggedTabId] = React.useState<string | null>(null);
  const [dragGhostSnapshot, setDragGhostSnapshot] = React.useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const dragReorderKeyRef = React.useRef<string>("");
  const tabRefs = React.useRef<Record<string, HTMLDivElement | null>>({});
  const openTabsRef = React.useRef<any[]>(openTabs);
  const dragGhostRef = React.useRef<HTMLDivElement | null>(null);
  const dragGhostFrameRef = React.useRef<number | null>(null);
  const dragGhostMetricsRef = React.useRef({ left: 0, top: 0, width: 0 });
  const dragStartX = React.useRef<number>(0);
  const dragStartScrollLeft = React.useRef<number>(0);
  const isTabDragging = React.useRef<boolean>(false);
  const pendingDragTabIdRef = React.useRef<string | null>(null);
  const tabDragStartX = React.useRef<number>(0);
  const tabDragPointerOffsetX = React.useRef<number>(0);
  const draggedTabWidthRef = React.useRef<number>(0);
  const hasTabMovedRef = React.useRef<boolean>(false);
  const isCrossPaneDraggingRef = React.useRef<boolean>(false);
  const [pendingCloseTabId, setPendingCloseTabId] = React.useState<
    string | null
  >(null);
  const pendingCloseTabName = React.useMemo(() => {
    if (!pendingCloseTabId) return "";
    return openTabs.find((t) => t.id === pendingCloseTabId)?.name ?? "";
  }, [pendingCloseTabId, openTabs]);
  const editorLabel = getEditorLabel(dbType);

  const sortedTabs = React.useMemo(() => {
    const pinned = openTabs.filter((t) => t.pinned);
    const unpinned = openTabs.filter((t) => !t.pinned);
    return [...pinned, ...unpinned];
  }, [openTabs]);

  const reorderTabs = React.useCallback(
    (sourceId: string, insertIndex: number) => {
      setOpenTabs((prevTabs) => {
        const sourceIndex = prevTabs.findIndex((t) => t.id === sourceId);
        if (sourceIndex === -1) return prevTabs;

        const nextTabs = [...prevTabs];
        const [sourceTab] = nextTabs.splice(sourceIndex, 1);

        const boundedIndex = Math.max(
          0,
          Math.min(insertIndex, nextTabs.length),
        );
        nextTabs.splice(boundedIndex, 0, sourceTab);
        return nextTabs;
      });
    },
    [setOpenTabs],
  );

  React.useEffect(() => {
    openTabsRef.current = openTabs;
  }, [openTabs]);

  const setDragGhostNode = React.useCallback((node: HTMLDivElement | null) => {
    dragGhostRef.current = node;
    if (!node) return;

    const { left, top } = dragGhostMetricsRef.current;
    node.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  }, []);

  const scheduleDragGhostPosition = React.useCallback((left: number) => {
    dragGhostMetricsRef.current.left = left;
    if (dragGhostFrameRef.current !== null) return;

    dragGhostFrameRef.current = window.requestAnimationFrame(() => {
      dragGhostFrameRef.current = null;
      const ghostNode = dragGhostRef.current;
      if (!ghostNode) return;

      const { left: ghostLeft, top: ghostTop } = dragGhostMetricsRef.current;
      ghostNode.style.transform = `translate3d(${ghostLeft}px, ${ghostTop}px, 0)`;
    });
  }, []);

  const handleScroll = () => {
    if (tabsRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = tabsRef.current;
      setScrollInfo({ scrollLeft, scrollWidth, clientWidth });
    }
  };

  const handleThumbMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragStartX.current = e.clientX;
    dragStartScrollLeft.current = tabsRef.current?.scrollLeft || 0;
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (tabsRef.current) {
      // If the user is scrolling vertically, scroll the container horizontally
      if (e.deltaY !== 0) {
        tabsRef.current.scrollLeft += e.deltaY;
      }
    }
  };

  React.useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!tabsRef.current) return;
      const deltaX = e.clientX - dragStartX.current;
      const scrollRatio = scrollInfo.scrollWidth / scrollInfo.clientWidth;
      tabsRef.current.scrollLeft =
        dragStartScrollLeft.current + deltaX * scrollRatio;
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, scrollInfo.clientWidth, scrollInfo.scrollWidth]);

  React.useEffect(() => {
    if (!isTabDragActive) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!tabsRef.current) return;
      const activeDragTabId = draggedTabId ?? pendingDragTabIdRef.current;
      if (!activeDragTabId) return;
      const dragDistance = Math.abs(e.clientX - tabDragStartX.current);
      if (!draggedTabId && dragDistance <= 2) return;
      if (!draggedTabId) {
        setDraggedTabId(activeDragTabId);
      }
      const nextGhostLeft = e.clientX - tabDragPointerOffsetX.current;
      scheduleDragGhostPosition(nextGhostLeft);
      if (dragDistance > 2) {
        hasTabMovedRef.current = true;
      }

      const bounds = tabsRef.current.getBoundingClientRect();
      const outsideTabBar =
        e.clientY > bounds.bottom + 10 ||
        e.clientX > bounds.right ||
        e.clientX < bounds.left;
      if (outsideTabBar && onTabPaneDragStart) {
        if (!isCrossPaneDraggingRef.current) {
          isCrossPaneDraggingRef.current = true;
          const tabs = openTabsRef.current;
          const sourceTab = tabs.find((tab) => tab.id === activeDragTabId);
          if (sourceTab) {
            onTabPaneDragStart(sourceTab, e.clientX, e.clientY);
          }
        } else if (onTabPaneDragMove) {
          onTabPaneDragMove(e.clientX, e.clientY);
        }
        return;
      }

      if (isCrossPaneDraggingRef.current) {
        isCrossPaneDraggingRef.current = false;
        onTabPaneDragCancel?.();
      }

      if (e.clientX > bounds.right - 24) {
        tabsRef.current.scrollLeft += 24;
      } else if (e.clientX < bounds.left + 24) {
        tabsRef.current.scrollLeft -= 24;
      }

      const tabs = openTabsRef.current;
      const sourceIndex = tabs.findIndex((tab) => tab.id === activeDragTabId);
      if (sourceIndex === -1) return;

      let draggedWidth = draggedTabWidthRef.current;
      if (!draggedWidth) {
        draggedWidth =
          tabRefs.current[activeDragTabId]?.getBoundingClientRect().width || 0;
      }
      const draggedCenterX = nextGhostLeft + draggedWidth / 2;
      const swapThreshold = 4;

      if (sourceIndex > 0) {
        const prevTab = tabs[sourceIndex - 1];
        const prevNode = tabRefs.current[prevTab.id];
        if (prevNode) {
          const prevRect = prevNode.getBoundingClientRect();
          const prevCenter = prevRect.left + prevRect.width / 2;
          if (draggedCenterX < prevCenter - swapThreshold) {
            const reorderKey = `${sourceIndex}->${sourceIndex - 1}`;
            if (dragReorderKeyRef.current !== reorderKey) {
              reorderTabs(activeDragTabId, sourceIndex - 1);
              dragReorderKeyRef.current = reorderKey;
            }
            return;
          }
        }
      }

      if (sourceIndex < tabs.length - 1) {
        const nextTab = tabs[sourceIndex + 1];
        const nextNode = tabRefs.current[nextTab.id];
        if (nextNode) {
          const nextRect = nextNode.getBoundingClientRect();
          const nextCenter = nextRect.left + nextRect.width / 2;
          if (draggedCenterX > nextCenter + swapThreshold) {
            const reorderKey = `${sourceIndex}->${sourceIndex + 1}`;
            if (dragReorderKeyRef.current !== reorderKey) {
              reorderTabs(activeDragTabId, sourceIndex + 1);
              dragReorderKeyRef.current = reorderKey;
            }
          }
        }
      }
    };
    const handleMouseUp = () => {
      if (isCrossPaneDraggingRef.current) {
        isCrossPaneDraggingRef.current = false;
        onTabPaneDragEnd?.();
      }
      isTabDragging.current = false;
      setIsTabDragActive(false);
      pendingDragTabIdRef.current = null;
      setDraggedTabId(null);
      setDragGhostSnapshot(null);
      dragGhostMetricsRef.current = { left: 0, top: 0, width: 0 };
      tabDragPointerOffsetX.current = 0;
      draggedTabWidthRef.current = 0;
      dragReorderKeyRef.current = "";
      if (dragGhostFrameRef.current !== null) {
        window.cancelAnimationFrame(dragGhostFrameRef.current);
        dragGhostFrameRef.current = null;
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp, { once: true });
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp as any);
    };
  }, [draggedTabId, isTabDragActive, reorderTabs, scheduleDragGhostPosition]);

  React.useEffect(() => {
    return () => {
      if (dragGhostFrameRef.current !== null) {
        window.cancelAnimationFrame(dragGhostFrameRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    const el = tabsRef.current;
    if (el) {
      el.addEventListener("scroll", handleScroll);
      // Use a ResizeObserver for more accurate container size tracking
      const resizeObserver = new ResizeObserver(() => handleScroll());
      resizeObserver.observe(el);

      handleScroll();
      return () => {
        el.removeEventListener("scroll", handleScroll);
        resizeObserver.disconnect();
      };
    }
  }, []);

  React.useEffect(() => {
    if (activeTabId && tabsRef.current) {
      const activeTabElement = tabsRef.current.querySelector(
        `[data-tab-id="${activeTabId}"]`,
      );
      if (activeTabElement) {
        activeTabElement.scrollIntoView({
          behavior: "auto",
          block: "nearest",
          inline: "nearest",
        });
      }
    }
  }, [activeTabId]);

  const showScrollbar = scrollInfo.scrollWidth > scrollInfo.clientWidth;
  const thumbWidth = showScrollbar
    ? Math.max(
        20,
        (scrollInfo.clientWidth / scrollInfo.scrollWidth) *
          scrollInfo.clientWidth,
      )
    : 0;
  const thumbLeft = showScrollbar
    ? (scrollInfo.scrollLeft / scrollInfo.scrollWidth) * scrollInfo.clientWidth
    : 0;
  const draggedTab = draggedTabId
    ? openTabs.find((tab) => tab.id === draggedTabId)
    : null;
  const GhostTabIcon = TAB_ICONS[draggedTab?.type ?? ""] ?? TableIcon;
  const draggedTabColor =
    (draggedTab && TAB_DRAG_ICON_COLORS[draggedTab.type]) || "text-blue-500";
  const showSplitPaneButton = Boolean(onSplitPane && isPaneActive);
  const showClosePaneButton = Boolean(onClosePane && isPaneActive);
  const paneActionCount =
    Number(showSplitPaneButton) + Number(showClosePaneButton);
  const tabsRightPaddingClass =
    paneActionCount === 0 ? "pr-0" : paneActionCount === 1 ? "pr-12" : "pr-24";

  return (
    <div
      className="flex flex-col shrink-0 group/header"
      onMouseDown={() => {
        if (!isTabDragging.current) {
          onActivatePane?.();
        }
      }}
    >
      {/* Tabs Area */}
      <div className="h-[44px] relative border-b border-studio-border bg-studio-bg">
        <div
          ref={tabsRef}
          onWheel={handleWheel}
          className={`absolute inset-0 flex items-center overflow-x-auto tabs-scrollbar z-10 ${tabsRightPaddingClass}`}
        >
          <div className="flex items-center h-[44px]">
            {sortedTabs.map((tab) => {
              const tabIndex = paneTabIds ? paneTabIds.indexOf(tab.id) : -1;
              const isFirst = tabIndex === 0;
              const isLast =
                tabIndex >= 0 && tabIndex === (paneTabIds?.length ?? 1) - 1;
              const isOnly = (paneTabIds?.length ?? 1) <= 1;
              return (
                <ContextMenu key={tab.id}>
                  <ContextMenuTrigger>
                    <div
                      ref={(el) => {
                        tabRefs.current[tab.id] = el;
                      }}
                      data-tab-id={tab.id}
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        if ((e.target as HTMLElement).closest("button")) return;
                        isTabDragging.current = true;
                        setIsTabDragActive(true);
                        pendingDragTabIdRef.current = tab.id;
                        hasTabMovedRef.current = false;
                        tabDragStartX.current = e.clientX;
                        const currentRect =
                          tabRefs.current[tab.id]?.getBoundingClientRect();
                        if (currentRect) {
                          tabDragPointerOffsetX.current =
                            e.clientX - currentRect.left;
                          draggedTabWidthRef.current = currentRect.width;
                          dragGhostMetricsRef.current = {
                            left: currentRect.left,
                            top: currentRect.top,
                            width: currentRect.width,
                          };
                          setDragGhostSnapshot({
                            left: currentRect.left,
                            top: currentRect.top,
                            width: currentRect.width,
                          });
                        } else {
                          tabDragPointerOffsetX.current = 0;
                          draggedTabWidthRef.current = 0;
                          dragGhostMetricsRef.current = {
                            left: 0,
                            top: 0,
                            width: 0,
                          };
                          setDragGhostSnapshot(null);
                        }
                        setDraggedTabId(null);
                        dragReorderKeyRef.current = "";
                      }}
                      onMouseUp={() => {
                        if (draggedTabId) return;
                        isTabDragging.current = false;
                        setIsTabDragActive(false);
                        pendingDragTabIdRef.current = null;
                      }}
                      onClick={(e) => {
                        if (hasTabMovedRef.current) {
                          hasTabMovedRef.current = false;
                          return;
                        }
                        if (e.ctrlKey || e.metaKey) {
                          togglePinTab?.(tab.id);
                          return;
                        }
                        switchTab(tab.id);
                      }}
                      onDoubleClick={(e) => {
                        if ((e.target as HTMLElement).closest("button")) return;
                        if (tab.isPreview) confirmPreviewTab?.(tab.id);
                      }}
                      className={`h-[44px] flex items-center gap-2 px-3 text-xs group relative select-none min-w-[140px] max-w-[220px] border-r border-studio-border ${
                        draggedTabId === tab.id
                          ? "cursor-grabbing"
                          : "cursor-pointer"
                      } ${
                        activeTabId === tab.id
                          ? "bg-studio-tab-active text-foreground"
                          : "bg-studio-tab-inactive hover:bg-studio-row-hover text-muted-foreground"
                      } ${draggedTabId === tab.id ? "opacity-0 pointer-events-none" : ""}`}
                    >
                      <TabIcon
                        tabType={tab.type}
                        isActive={activeTabId === tab.id}
                      />
                      {tab.dirty && (
                        <span className="w-1.5 h-1.5 rounded-lg bg-foreground/70 shrink-0" />
                      )}
                      {tab.pinned && (
                        <Pin className="w-2.5 h-2.5 shrink-0 text-muted-foreground/50" />
                      )}
                      <span
                        className={`truncate flex-1 text-left ${activeTabId === tab.id ? "font-medium" : ""} ${tab.isPreview ? "italic" : ""}`}
                      >
                        {tab.name}
                      </span>
                      {!tab.pinned && (
                        <StudioTooltip label="Close Tab">
                          <button
                            onClick={(e) => {
                              if (tab.dirty) {
                                e.stopPropagation();
                                e.preventDefault();
                                setPendingCloseTabId(tab.id);
                                return;
                              }
                              closeTab(e, tab.id);
                            }}
                            className={`p-0.5 rounded-lg hover:bg-muted/40 opacity-0 group-hover:opacity-100 ${
                              activeTabId === tab.id ? "opacity-100" : ""
                            }`}
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </StudioTooltip>
                      )}
                      {showTabIndicator && activeTabId === tab.id && (
                        <div className="absolute top-0 left-0 right-0 h-[1px] bg-primary shadow-[0_0_8px_var(--ring)]" />
                      )}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-44">
                    <ContextMenuItem
                      className="text-xs"
                      disabled={tab.pinned}
                      onClick={() => {
                        if (tab.dirty) {
                          setPendingCloseTabId(tab.id);
                        } else {
                          closeTabById?.(tab.id);
                        }
                      }}
                    >
                      <X className="mr-2 h-3.5 w-3.5" />
                      Close
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      className="text-xs"
                      onClick={() => togglePinTab?.(tab.id)}
                    >
                      <Pin className="mr-2 h-3.5 w-3.5" />
                      {tab.pinned ? "Unpin Tab" : "Pin Tab"}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      className="text-xs"
                      disabled={isOnly || tab.pinned}
                      onClick={() => onCloseOtherTabs?.(tab.id)}
                    >
                      Close Others
                    </ContextMenuItem>
                    <ContextMenuItem
                      className="text-xs"
                      disabled={isOnly || tab.pinned}
                      onClick={() => onCloseAllTabs?.()}
                    >
                      Close All
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      className="text-xs"
                      disabled={isLast || tab.pinned}
                      onClick={() => onCloseTabsToRight?.(tab.id)}
                    >
                      <ArrowRight className="mr-2 h-3.5 w-3.5" />
                      Close Tabs To Right
                    </ContextMenuItem>
                    <ContextMenuItem
                      className="text-xs"
                      disabled={isFirst || tab.pinned}
                      onClick={() => onCloseTabsToLeft?.(tab.id)}
                    >
                      <ArrowLeft className="mr-2 h-3.5 w-3.5" />
                      Close Tabs To Left
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}

            {/* New Tab Button */}
            <StudioTooltip label={`New ${editorLabel}`}>
              <button
                onClick={() => openSqlEditor()}
                className="h-[44px] px-3 flex items-center justify-center text-muted-foreground hover:bg-studio-row-hover border-r border-studio-border"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </StudioTooltip>
          </div>
        </div>

        {paneActionCount > 0 && (
          <div className="absolute right-0 top-0 z-20 flex h-[44px] items-center bg-studio-bg pl-1 px-1 border-b border-studio-border">
            {showSplitPaneButton && (
              <StudioTooltip label="Split Pane">
                <button
                  onClick={() => onSplitPane?.()}
                  className="h-[44px] px-3 flex items-center justify-center text-muted-foreground/40 transition-colors hover:text-muted-foreground/70"
                >
                  <Columns2 className="w-3.5 h-3.5" />
                </button>
              </StudioTooltip>
            )}
            {showClosePaneButton && (
              <StudioTooltip label="Close Pane">
                <button
                  onClick={() => onClosePane?.()}
                  className="h-[44px] px-3 flex items-center justify-center text-muted-foreground/40 transition-colors hover:text-muted-foreground/70"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </StudioTooltip>
            )}
          </div>
        )}

        {draggedTab && dragGhostSnapshot && !isTabPaneDragging && (
          <div
            ref={setDragGhostNode}
            className="fixed h-[44px] min-w-[140px] max-w-[220px] flex items-center gap-2 px-3 text-xs border border-studio-border bg-studio-tab-active text-foreground shadow-lg pointer-events-none select-none"
            style={{
              left: 0,
              top: 0,
              width: `${dragGhostSnapshot.width}px`,
              transform: `translate3d(${dragGhostSnapshot.left}px, ${dragGhostSnapshot.top}px, 0)`,
              zIndex: 9999,
            }}
          >
            <GhostTabIcon className={`w-3 h-3 ${draggedTabColor}`} />
            <span className="truncate flex-1 text-left font-medium">
              {draggedTab.name}
            </span>
          </div>
        )}

        {/* Custom Scrollbar Component */}
        {showScrollbar && (
          <div className="absolute bottom-0 left-0 right-0 h-[4px] z-50">
            <div className="relative w-full h-full px-2">
              <div
                onMouseDown={handleThumbMouseDown}
                className={`absolute bottom-0 h-full rounded-lg cursor-grab active:cursor-grabbing ${
                  isDragging
                    ? "bg-muted-foreground/60 dark:bg-muted-foreground/80 opacity-100"
                    : "bg-muted-foreground/30 dark:bg-muted-foreground/50 opacity-0 group-hover/header:opacity-100"
                }`}
                style={{
                  width: `${thumbWidth}px`,
                  left: `${thumbLeft}px`,
                }}
              />
            </div>
          </div>
        )}
      </div>
      <CloseDirtyDialog
        open={!!pendingCloseTabId}
        tabName={pendingCloseTabName}
        onDiscard={() => {
          if (pendingCloseTabId) {
            closeTabById?.(pendingCloseTabId);
            setPendingCloseTabId(null);
          }
        }}
        onCancel={() => setPendingCloseTabId(null)}
      />
    </div>
  );
}
