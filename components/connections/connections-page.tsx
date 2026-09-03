"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { ConnectionManager } from "@/components/connections/connection-manager";
import { ConnectionAnalyticsShell } from "@/components/connections/connection-analytics-shell";
import { ConnectionAnalytics } from "@/components/connections/connection-analytics";
import { ModernUIShell } from "@/components/app-shell/modern-ui-shell";
import type { ModernUIRailItem } from "@/components/app-shell/modern-ui-rail";
import { AppSettingsView } from "@/components/app-settings-view";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { ArrowLeft } from "@/lib/icon-theme/lucide-react";
import type { AppTab } from "@/components/app-shell/app-shared";
import { Connection } from "@/lib/db/schema";
import { getConnections, getStoredUserProfile } from "@/lib/api/actions-client";
import { supabase } from "@/lib/supabase/client";
import { loadStoredDisplayName, syncAuthenticatedUserProfile } from "@/lib/auth/user-profile";
import { ONBOARDING_COMPLETE_KEY } from "@/lib/onboarding";
import { useAppSettings } from "@/hooks/use-app-settings";
import { getDefaultKeybindings, buildShortcutCombo } from "@/lib/studio/keybindings";
import { Database as DatabaseIcon } from "@/lib/icon-theme/solar-icons";
import { ProviderLogo } from "@/components/shared/provider-logo";
import { PLANETSCALE_LOGIN_ENABLED } from "@/lib/planetscale/auth";
import { useDesktopWindow } from "@/hooks/use-desktop-window";
import { WindowControls } from "@/components/shared/window-controls";

const CONNECTIONS_TAB: AppTab = {
  id: "connections",
  kind: "connections",
  title: "Connections",
};

const SUPABASE_TAB: AppTab = {
  id: "supabase",
  kind: "supabase",
  title: "Supabase",
};

const SPACETIMEDB_TAB: AppTab = {
  id: "spacetimedb",
  kind: "spacetimedb",
  title: "SpacetimeDB",
};

const NEON_TAB: AppTab = {
  id: "neon",
  kind: "neon",
  title: "Neon",
};

const PLANETSCALE_TAB: AppTab = {
  id: "planetscale",
  kind: "planetscale",
  title: "PlanetScale",
};

export function ConnectionsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const searchParams = useSearchParams();
  const editConnectionId = searchParams.get("edit") ? Number(searchParams.get("edit")) : null;
  const { isMaximized, sendWindowAction, canUseDesktop, isMac } = useDesktopWindow();

  const [tabs, setTabs] = useState<AppTab[]>([CONNECTIONS_TAB]);
  // History of activated tab ids for the back/forward arrows.
  const [nav, setNav] = useState<{ stack: string[]; index: number }>({
    stack: [CONNECTIONS_TAB.id],
    index: 0,
  });

  const [displayName, setDisplayName] = useState("User");
  const [email, setEmail] = useState("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedConnection, setSelectedConnection] = useState<Connection | null>(null);
  const [newConnectionTrigger, setNewConnectionTrigger] = useState(0);
  const { appThemeId, setAppThemeId } = useAppSettings();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  // Used only in standalone (non-embedded) mode to show a connection's
  // analytics full-page, since there is no tab system / shell around it.
  const [standaloneAnalytics, setStandaloneAnalytics] = useState<Connection | null>(null);
  const keybindings = useMemo(() => getDefaultKeybindings(), []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = loadStoredDisplayName();
    if (stored) setDisplayName(stored);
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      (window as any).__rexa_open_onboarding = () => {
        try {
          window.localStorage.removeItem(ONBOARDING_COMPLETE_KEY);
        } catch {}
        setOnboardingOpen(true);
      };
    }
  }, []);

  useEffect(() => {
    const markOnboardingComplete = () => {
      try {
        window.localStorage.setItem(ONBOARDING_COMPLETE_KEY, "1");
      } catch {}
    };

    const hydrate = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session?.user) {
          markOnboardingComplete();
          const synced = await syncAuthenticatedUserProfile(data.session.user);
          if (synced.result.success && synced.user) {
            const name =
              synced.user.user_metadata?.name ||
              synced.user.user_metadata?.full_name ||
              synced.user.user_metadata?.display_name ||
              synced.user.email?.split("@")[0];
            if (name) setDisplayName(name);
            if (synced.user.email) setEmail(synced.user.email);
          }
          return;
        }
        const profile = await getStoredUserProfile();
        if (profile.success && profile.data) {
          markOnboardingComplete();
          setDisplayName(profile.data.name || "User");
          return;
        }
        // No session and no stored profile — this is a brand new install.
        // Grandfather anyone who somehow already flagged onboarding complete
        // (e.g. cleared their profile but kept localStorage) out of the flow.
        const alreadyOnboarded =
          window.localStorage.getItem(ONBOARDING_COMPLETE_KEY) === "1";
        if (!alreadyOnboarded) {
          setOnboardingOpen(true);
        }
      } catch {}
    };
    void hydrate();
  }, []);

  const loadConns = useCallback(async () => {
    try {
      const rows = await getConnections();
      setConnections(rows || []);
    } catch {}
  }, []);
  useEffect(() => {
    void loadConns();
  }, [loadConns]);

  const activeTabId = nav.stack[nav.index] ?? CONNECTIONS_TAB.id;
  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? CONNECTIONS_TAB,
    [tabs, activeTabId],
  );
  const section = activeTab.kind;
  const selectedConnectionId = activeTab.connectionId ?? null;

  useEffect(() => {
    if (!selectedConnectionId) {
      setSelectedConnection(null);
      return;
    }
    const found = connections.find((c) => c.id === selectedConnectionId) || null;
    if (found) {
      setSelectedConnection(found);
      return;
    }
    let active = true;
    (async () => {
      try {
        const rows = await getConnections();
        if (active) {
          setSelectedConnection(rows?.find((c) => c.id === selectedConnectionId) || null);
        }
      } catch {}
    })();
    return () => {
      active = false;
    };
  }, [selectedConnectionId, connections]);

  const activate = useCallback((id: string) => {
    setNav((prev) => {
      if (prev.stack[prev.index] === id) return prev;
      const stack = [...prev.stack.slice(0, prev.index + 1), id];
      return { stack, index: stack.length - 1 };
    });
  }, []);

  const openTab = useCallback(
    (tab: AppTab) => {
      setTabs((prev) =>
        prev.some((t) => t.id === tab.id)
          ? prev.map((t) => (t.id === tab.id ? { ...t, ...tab } : t))
          : [...prev, tab],
      );
      activate(tab.id);
    },
    [activate],
  );

  const reorderTabs = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setTabs((prev) => {
      const fromIndex = prev.findIndex((t) => t.id === sourceId);
      const toIndex = prev.findIndex((t) => t.id === targetId);
      if (fromIndex < 0 || toIndex < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      // Don't close the sole home tab.
      if (id === CONNECTIONS_TAB.id && tabs.length === 1) return;

      const idx = tabs.findIndex((t) => t.id === id);
      if (idx < 0) return;

      let nextTabs = tabs.filter((t) => t.id !== id);
      if (nextTabs.length === 0) nextTabs = [CONNECTIONS_TAB];
      setTabs(nextTabs);

      const wasActive = activeTabId === id;
      if (wasActive) {
        // Chrome-style: activate the tab that slides into this index, else the left neighbor.
        const neighbor =
          (idx < nextTabs.length ? nextTabs[idx] : nextTabs[nextTabs.length - 1]) ??
          CONNECTIONS_TAB;
        setNav((prev) => {
          const without = prev.stack.filter(
            (s) => s !== id && nextTabs.some((t) => t.id === s),
          );
          if (without[without.length - 1] === neighbor.id) {
            return {
              stack: without.length ? without : [neighbor.id],
              index: Math.max(0, without.length - 1),
            };
          }
          const stack = [...without, neighbor.id];
          return { stack, index: stack.length - 1 };
        });
      } else {
        setNav((prev) => {
          const stack = prev.stack.filter((s) => s !== id);
          if (stack.length === 0) {
            return { stack: [activeTabId], index: 0 };
          }
          return {
            stack,
            index: Math.min(prev.index, stack.length - 1),
          };
        });
      }
    },
    [tabs, activeTabId],
  );

  const goBack = useCallback(() => {
    setNav((prev) => (prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev));
  }, []);
  const goForward = useCallback(() => {
    setNav((prev) =>
      prev.index < prev.stack.length - 1 ? { ...prev, index: prev.index + 1 } : prev,
    );
  }, []);

  // Settings opens as a modal (matching both shells' rail/sidebar "Settings"
  // entry) instead of a tab, in New Layout and Modern UI alike.
  const handleNavigate = useCallback(
    (path: string) => {
      if (path === "connections") openTab(CONNECTIONS_TAB);
      else if (path === "supabase") openTab(SUPABASE_TAB);
      else if (path === "spacetimedb") openTab(SPACETIMEDB_TAB);
      else if (path === "neon") openTab(NEON_TAB);
      else if (path === "planetscale" && PLANETSCALE_LOGIN_ENABLED) openTab(PLANETSCALE_TAB);
      else if (path === "settings") setSettingsModalOpen(true);
    },
    [openTab],
  );

  const handleSelectConnection = useCallback(
    (id: number, name?: string, type?: string | null) => {
      const conn = connections.find((c) => c.id === id);
      openTab({
        id: `analytics:${id}`,
        kind: "analytics",
        title: name || conn?.name || "Analytics",
        connectionId: id,
        connectionType: type ?? conn?.connectionType ?? null,
      });
    },
    [openTab, connections],
  );

  const railItems: ModernUIRailItem[] = useMemo(
    () => [
      {
        id: "connections",
        label: "Connections",
        icon: <DatabaseIcon className="w-5 h-5 shrink-0" />,
        onClick: () => openTab(CONNECTIONS_TAB),
      },
      {
        id: "supabase",
        label: "Supabase",
        icon: <ProviderLogo type="supabase" className="w-5 h-5 shrink-0" />,
        onClick: () => openTab(SUPABASE_TAB),
      },
      {
        id: "spacetimedb",
        label: "SpacetimeDB",
        icon: <ProviderLogo type="spacetimedb" className="w-5 h-5 shrink-0" />,
        onClick: () => openTab(SPACETIMEDB_TAB),
      },
      {
        id: "neon",
        label: "Neon",
        icon: <ProviderLogo type="neon" className="w-5 h-5 shrink-0" />,
        onClick: () => openTab(NEON_TAB),
      },
      ...(PLANETSCALE_LOGIN_ENABLED
        ? [
            {
              id: "planetscale",
              label: "PlanetScale",
              icon: <ProviderLogo type="planetscale" className="w-5 h-5 shrink-0" />,
              onClick: () => openTab(PLANETSCALE_TAB),
            },
          ]
        : []),
    ],
    [openTab],
  );

  // Studio-style tab shortcuts: Cmd/Ctrl+W close, Cmd/Ctrl+1–9 switch tab.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;

      if (e.key.toLowerCase() === "w") {
        e.preventDefault();
        e.stopPropagation();
        if (activeTabId) closeTab(activeTabId);
        return;
      }

      // fallow-ignore-next-line code-duplication
      const codeMatch = /^Digit([1-9])$/.exec(e.code || "");
      const keyMatch = /^([1-9])$/.exec(e.key || "");
      const digit = codeMatch?.[1] ?? keyMatch?.[1];
      if (digit) {
        const tabIndex = Number(digit) - 1;
        const target = tabs[tabIndex];
        if (target) {
          e.preventDefault();
          e.stopPropagation();
          activate(target.id);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [tabs, activeTabId, closeTab, activate]);

  // Sidebar toggle (default Cmd+B) and settings (default Cmd+,) keybindings.
  // The studio handles these itself via its own keydown listener; this page
  // has no studio session, so it needs its own to keep the shortcuts working
  // here too. Settings opens the same modal as the rail's Settings button.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const combo = buildShortcutCombo(e);
      if (!combo) return;
      const type = keybindings[combo]?.type;
      if (type === "TOGGLE_SIDEBAR") {
        e.preventDefault();
        e.stopPropagation();
        setSidebarOpen((open) => !open);
      } else if (type === "OPEN_SETTINGS") {
        e.preventDefault();
        e.stopPropagation();
        setSettingsModalOpen(true);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings]);

  const shellProps = {
    user: { name: displayName, email },
    tabs,
    activeTabId,
    onActivateTab: activate,
    onCloseTab: closeTab,
    onReorderTab: reorderTabs,
    onNewTab: () => openTab(CONNECTIONS_TAB),
    sidebarOpen,
    onSidebarOpenChange: setSidebarOpen,
    onBack: goBack,
    onForward: goForward,
    canBack: nav.index > 0,
    canForward: nav.index < nav.stack.length - 1,
    onHome: () => openTab(CONNECTIONS_TAB),
  };

  const content = (
    <>
      {section === "connections" && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ConnectionManager
            hideHeader
            editConnectionId={editConnectionId}
            newConnectionTrigger={newConnectionTrigger}
            isAnalyticsEnabled={false}
            onAnalyticsToggle={() => {}}
            onViewAnalytics={(id) => handleSelectConnection(id)}
            onOpenSupabaseAccounts={() => openTab(SUPABASE_TAB)}
            onOpenSpacetimedbAccounts={() => openTab(SPACETIMEDB_TAB)}
            onOpenNeonAccounts={() => openTab(NEON_TAB)}
            onOpenPlanetscaleAccounts={() => openTab(PLANETSCALE_TAB)}
          />
        </div>
      )}

      {section === "supabase" && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ConnectionManager hideHeader initialScreen="supabase" />
        </div>
      )}

      {section === "spacetimedb" && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ConnectionManager
            hideHeader
            initialScreen="spacetimedb-account"
            onOpenSpacetimedbAccounts={() => openTab(SPACETIMEDB_TAB)}
          />
        </div>
      )}

      {section === "neon" && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ConnectionManager
            hideHeader
            initialScreen="neon-cli"
            onOpenNeonAccounts={() => openTab(NEON_TAB)}
          />
        </div>
      )}

      {section === "planetscale" && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ConnectionManager
            hideHeader
            initialScreen="planetscale-account"
            onOpenPlanetscaleAccounts={() => openTab(PLANETSCALE_TAB)}
          />
        </div>
      )}

      {section === "analytics" && (
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
          <ConnectionAnalyticsShell
            connectionId={selectedConnectionId}
            connection={selectedConnection}
          />
        </div>
      )}

    </>
  );

  const standalone = (() => {
    if (standaloneAnalytics) {
      return (
        <div className="flex h-screen min-h-0 w-full flex-col overflow-hidden bg-studio-bg text-foreground">
          <div className="flex shrink-0 items-center gap-2 border-b border-studio-border bg-studio-header-bg/90 px-4 z-20">
            <div className="flex h-12 items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => setStandaloneAnalytics(null)}
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <span className="text-sm font-medium truncate">
                Analytics — {standaloneAnalytics.name}
              </span>
            </div>
          </div>
          <div className="flex min-h-0 flex-1">
            <ConnectionAnalytics
              connectionId={standaloneAnalytics.id}
              connection={standaloneAnalytics}
            />
          </div>
        </div>
      );
    }
    return (
      <div className="flex h-screen min-h-0 w-full flex-col overflow-hidden bg-studio-bg text-foreground">
        {canUseDesktop && (
          <header
            className="app-drag-region flex h-9 shrink-0 items-center justify-end px-3 select-none"
            data-tauri-drag-region="deep"
          >
            {isMac && <div className="w-[72px]" />}
            {canUseDesktop && !isMac && (
              <WindowControls
                isMaximized={isMaximized}
                onMinimize={() => sendWindowAction("minimize")}
                onMaximizeToggle={() => sendWindowAction("maximize-toggle")}
                onClose={() => sendWindowAction("close")}
              />
            )}
          </header>
        )}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-[var(--shell-content-bg)]">
            <ConnectionManager
              hideHeader
              embedded
              editConnectionId={editConnectionId}
              newConnectionTrigger={newConnectionTrigger}
              isAnalyticsEnabled={false}
              onAnalyticsToggle={() => {}}
              onViewAnalytics={(id) => {
                const conn = connections.find((c) => c.id === id);
                if (conn) setStandaloneAnalytics(conn);
              }}
            />
          </div>
        </div>
      </div>
    );
  })();

  return (
    <>
      <OnboardingFlow
        open={onboardingOpen}
        appThemeId={appThemeId}
        setAppThemeId={setAppThemeId}
        onComplete={({ name, email: onboardedEmail }) => {
          setDisplayName(name);
          if (onboardedEmail) setEmail(onboardedEmail);
          try {
            window.localStorage.setItem(ONBOARDING_COMPLETE_KEY, "1");
          } catch {}
          setOnboardingOpen(false);
          void loadConns();
        }}
      />
      {embedded ? (
        <ModernUIShell
          {...shellProps}
          studio={{ connection: selectedConnection }}
          onHeaderSelectConnection={(conn) =>
            handleSelectConnection(conn.id, conn.name, conn.connectionType)
          }
          activePath={section}
          onNavigate={handleNavigate}
          onNewConnection={() => {
            openTab(CONNECTIONS_TAB);
            setNewConnectionTrigger((n) => n + 1);
          }}
          selectedConnectionId={selectedConnectionId}
          onSelectConnection={handleSelectConnection}
          connections={connections}
          keybindings={keybindings}
          railItems={railItems}
          railActiveId={
            section === "connections" ||
            section === "supabase" ||
            section === "spacetimedb" ||
            section === "neon" ||
            section === "planetscale"
              ? section
              : null
          }
          onSettingsClick={() => setSettingsModalOpen(true)}
          settingsActive={settingsModalOpen}
          hideSettingsDialog
          railShowHome={false}
          railShowWorkspace={false}
          enableBottomSqlPanel={false}
        >
          {content}
        </ModernUIShell>
      ) : (
        standalone
      )}
      <Dialog open={settingsModalOpen} onOpenChange={setSettingsModalOpen}>
        <DialogContent
          hideCloseButton
          className="h-[80vh] w-[80vw] !max-w-[80vw] flex flex-col overflow-hidden p-0"
          overlayClassName="bg-black/40"
        >
          <DialogTitle className="sr-only">Settings</DialogTitle>
          <AppSettingsView />
        </DialogContent>
      </Dialog>
    </>
  );
}
