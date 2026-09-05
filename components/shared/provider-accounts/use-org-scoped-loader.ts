"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface OrgScopedLoaderOptions<A, O, R> {
  activeAccount: A | null;
  /** Stable key that retriggers org loading (usually activeAccount.id). */
  accountKey: string | null | undefined;
  listOrgs: (account: A) => Promise<O[]>;
  pickInitialOrgKey: (orgs: O[]) => string | null;
  loadResources: (account: A, orgKey: string | null) => Promise<R[]>;
  /** When true, skip resource load while orgKey is null (PlanetScale). Default false (Neon). */
  requireOrgForResources?: boolean;
  /** Extra dep that retriggers the whole flow (e.g. Neon reloadSignal after reconnect). */
  reloadSignal?: unknown;
  resourceErrorMessage?: string;
  orgsErrorMessage?: string;
}

export function useOrgScopedLoader<A, O, R>({
  activeAccount,
  accountKey,
  listOrgs,
  pickInitialOrgKey,
  loadResources,
  requireOrgForResources = false,
  reloadSignal,
  resourceErrorMessage = "Failed to load resources for this account.",
  orgsErrorMessage = "Failed to load organizations for this account.",
}: OrgScopedLoaderOptions<A, O, R>) {
  const [orgs, setOrgs] = useState<O[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [orgsError, setOrgsError] = useState<string | null>(null);
  const [resources, setResources] = useState<R[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const loadResourcesForOrg = useCallback(
    async (account: A, orgKey: string | null, requestId: number) => {
      if (requireOrgForResources && orgKey == null) {
        setResources([]);
        return;
      }
      setLoading(true);
      setLoadError(null);
      try {
        const data = await loadResources(account, orgKey);
        if (requestIdRef.current !== requestId) return;
        setResources(data);
      } catch (err) {
        if (requestIdRef.current !== requestId) return;
        setResources([]);
        setLoadError(err instanceof Error ? err.message : resourceErrorMessage);
      } finally {
        if (requestIdRef.current === requestId) setLoading(false);
      }
    },
    [loadResources, requireOrgForResources, resourceErrorMessage],
  );

  const reload = useCallback(() => {
    if (!activeAccount) return;
    const requestId = ++requestIdRef.current;
    void loadResourcesForOrg(activeAccount, selectedOrg, requestId);
  }, [activeAccount, selectedOrg, loadResourcesForOrg]);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    if (!activeAccount) {
      setOrgs([]);
      setSelectedOrg(null);
      setOrgsError(null);
      setResources([]);
      setLoadError(null);
      return;
    }
    setOrgs([]);
    setSelectedOrg(null);
    setOrgsError(null);

    (async () => {
      setOrgsLoading(true);
      let orgKey: string | null = null;
      try {
        const list = await listOrgs(activeAccount);
        if (requestIdRef.current !== requestId) return;
        setOrgs(list);
        orgKey = pickInitialOrgKey(list);
        setSelectedOrg(orgKey);
      } catch (err) {
        if (requestIdRef.current !== requestId) return;
        setOrgsError(err instanceof Error ? err.message : orgsErrorMessage);
      } finally {
        if (requestIdRef.current === requestId) setOrgsLoading(false);
      }
      if (requestIdRef.current !== requestId) return;
      if (requireOrgForResources && orgKey == null) return;
      await loadResourcesForOrg(activeAccount, orgKey, requestId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey, reloadSignal]);

  const handleOrgChange = useCallback(
    (orgKey: string) => {
      setSelectedOrg(orgKey);
      if (!activeAccount) return;
      const requestId = ++requestIdRef.current;
      void loadResourcesForOrg(activeAccount, orgKey, requestId);
    },
    [activeAccount, loadResourcesForOrg],
  );

  return {
    orgs,
    selectedOrg,
    setSelectedOrg,
    orgsLoading,
    orgsError,
    resources,
    loading,
    loadError,
    setResources,
    setLoadError,
    reload,
    handleOrgChange,
    requestIdRef,
  };
}
