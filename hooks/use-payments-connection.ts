"use client";

import { useEffect, useMemo, useState } from "react";
import {
  resolveMgmtTokenForRef,
  resolvePaymentsConnection,
} from "@/lib/supabase-paykit/supabase-ref";
import { listProjects } from "@/lib/supabase-mgmt/client";

export interface PaymentsConnection {
  kind: "mgmt" | "postgres";
  projectRef: string;
  /** null while resolving (postgres) or when no linked account has access */
  token: string | null;
  tokenLoading: boolean;
}

/**
 * Resolves the PayKit connection for the active studio connection.
 * mgmt connections carry their token; direct postgres connections reuse a
 * linked Supabase account token when one can see the same project ref.
 */
export function usePaymentsConnection(studio: any): PaymentsConnection | null {
  const connectionString: string | undefined = studio?.connection?.connectionString;
  const connectionType: string | undefined =
    studio?.connection?.connectionType ?? studio?.dbType;

  const info = useMemo(
    () => resolvePaymentsConnection(connectionType, connectionString),
    [connectionType, connectionString],
  );

  const [linkedToken, setLinkedToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (info?.kind !== "postgres") {
      setLinkedToken(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void resolveMgmtTokenForRef(info.projectRef, listProjects)
      .then((t) => {
        if (!cancelled) setLinkedToken(t);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [info?.kind, info?.projectRef]);

  if (!info) return null;
  if (info.kind === "mgmt") {
    return { kind: "mgmt", projectRef: info.projectRef, token: info.token, tokenLoading: false };
  }
  return { kind: "postgres", projectRef: info.projectRef, token: linkedToken, tokenLoading: loading };
}
