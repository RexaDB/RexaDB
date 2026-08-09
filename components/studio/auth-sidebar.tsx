"use client";

import { Clock, KeyRound, Users } from "@/lib/icon-theme/lucide-react";
import { cn } from "@/lib/utils";
import { SidebarHeader } from "@/components/studio/sidebar-header";
import { type DragEvent } from "react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useSidebarResize } from "@/hooks/use-sidebar-resize";

interface AuthSidebarProps {
  hasAuthSchema: boolean;
  activeView: "users" | "sessions" | "providers" | null;
  onOpenUsers: () => void;
  onOpenSessions: () => void;
  onOpenProviders: () => void;
  sleek?: boolean;
}

export function AuthSidebar({
  hasAuthSchema,
  activeView,
  onOpenUsers,
  onOpenSessions,
  onOpenProviders,
  sleek,
}: AuthSidebarProps) {
  const items = [
    {
      id: "users",
      label: "Users",
      icon: Users,
      onClick: onOpenUsers,
      dragType: "auth-users",
    },
    {
      id: "sessions",
      label: "Sessions",
      icon: Clock,
      onClick: onOpenSessions,
      dragType: "auth-sessions",
    },
    {
      id: "providers",
      label: "Providers",
      icon: KeyRound,
      onClick: onOpenProviders,
      dragType: "auth-providers",
    },
  ] as const;

  const handleDragStart = (
    e: React.DragEvent,
    item: (typeof items)[number],
  ) => {
    e.dataTransfer.setData(
      "application/x-rexadb-item",
      JSON.stringify({
        type: item.dragType,
        name: item.id,
        schema: "",
      }),
    );
    e.dataTransfer.effectAllowed = "link";
  };

  const [sidebarWidth, setSidebarWidth] = useLocalStorage(
    "rexadb:sidebar-width",
    256,
  );
  const { handlePointerDown } = useSidebarResize(sidebarWidth, setSidebarWidth);

  return (
    <div
      className={cn(
        "relative shrink-0 border-r border-studio-border bg-popover",
        sleek && "border-r-0",
      )}
      style={{ width: sidebarWidth }}
    >
      <div className="flex flex-col overflow-hidden h-full text-muted-foreground">
        <SidebarHeader title="Authentication" />

        <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                draggable={hasAuthSchema}
                onDragStart={(e) => hasAuthSchema && handleDragStart(e, item)}
                onClick={item.onClick}
                disabled={!hasAuthSchema}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs rounded-lg transition-all ${
                  !hasAuthSchema
                    ? "text-muted-foreground/40 cursor-not-allowed"
                    : activeView === item.id
                      ? "bg-blue-500/10 text-blue-500 font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/10"
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}

          {!hasAuthSchema && (
            <p className="px-3 pt-2 text-xs text-muted-foreground/70">
              The auth schema is not available on this connection.
            </p>
          )}
        </div>
      </div>
      <div
        className="absolute -right-1.5 top-0 z-20 h-full w-3 cursor-col-resize select-none bg-transparent group"
        onPointerDown={handlePointerDown}
      >
        <div className="h-full w-px mx-auto bg-studio-border/50 group-hover:bg-blue-500/60 transition-colors" />
      </div>
    </div>
  );
}
