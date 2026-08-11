"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { ConnectionManager } from "@/components/connections/connection-manager";
import { ConnectionAnalyticsShell } from "@/components/connections/connection-analytics-shell";
import { AppShell } from "@/components/app-shell/app-shell";
import { AppSettingsView } from "@/components/app-settings-view";
import { V128OnboardingModal } from "@/components/v128-onboarding-modal";
import type { AppTab } from "@/components/app-shell/app-shared";
import { Connection } from "@/lib/db/schema";
import { getConnections, getStoredUserProfile } from "@/lib/api/actions-client";
import { supabase } from "@/lib/supabase/client";
import { loadStoredDisplayName, syncAuthenticatedUserProfile } from "@/lib/auth/user-profile";
import { useAppSettings } from "@/hooks/use-app-settings";

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

export function ConnectionsPage() {
  const searchParams = useSearchParams();
  const editConnectionId = searchParams.get("edit") ? Number(searchParams.get("edit")) : null;

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
  const { setAppShellLayout } = useAppSettings();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = loadStoredDisplayName();
    if (stored) setDisplayName(stored);
  }, []);

  useEffect(() => {
    const hydrate = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session?.user) {
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
          setDisplayName(profile.data.name || "User");
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

  const handleNavigate = useCallback(
    (path: string) => {
      if (path === "connections") openTab(CONNECTIONS_TAB);
      else if (path === "supabase") openTab(SUPABASE_TAB);
      else if (path === "spacetimedb") openTab(SPACETIMEDB_TAB);
      else if (path === "settings")
        openTab({ id: "settings", kind: "settings", title: "Settings" });
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

  return (
    <>
    <V128OnboardingModal onEnableLayout={() => setAppShellLayout(true)} />
    <AppShell
      activePath={section}
      onNavigate={handleNavigate}
      onNewConnection={() => { openTab(CONNECTIONS_TAB); setNewConnectionTrigger((n) => n + 1); }}
      selectedConnectionId={selectedConnectionId}
      onSelectConnection={handleSelectConnection}
      connections={connections}
      user={{ name: displayName, email }}
      tabs={tabs}
      activeTabId={activeTabId}
      onActivateTab={activate}
      onCloseTab={closeTab}
      onNewTab={() => openTab(CONNECTIONS_TAB)}
      onBack={goBack}
      onForward={goForward}
      canBack={nav.index > 0}
      canForward={nav.index < nav.stack.length - 1}
      onHome={() => openTab(CONNECTIONS_TAB)}
    >
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

      {section === "analytics" && (
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
          <ConnectionAnalyticsShell
            connectionId={selectedConnectionId}
            connection={selectedConnection}
          />
        </div>
      )}

      {section === "settings" && (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <AppSettingsView />
        </div>
      )}

    </AppShell>
    </>
  );
}
