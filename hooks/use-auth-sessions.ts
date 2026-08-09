"use client";

import { useAuthQuery } from "./use-auth-query";

interface AuthSessionRow {
  id: string;
  user_id: string | null;
  created_at: string | null;
  refreshed_at: string | null;
  not_after: string | null;
  ip: string | null;
  user_agent: string | null;
  aal: string | null;
}

const SESSIONS_QUERY = `
  SELECT id, user_id, created_at, refreshed_at, not_after, ip, user_agent, aal
  FROM auth.sessions
  ORDER BY created_at DESC
  LIMIT 200;
`;

export function useAuthSessions(connectionString: string, enabled: boolean) {
  const { data: sessions, loading, error, refresh } = useAuthQuery<AuthSessionRow>(
    connectionString,
    enabled,
    SESSIONS_QUERY,
    "Failed to load sessions.",
  );

  return { sessions, loading, error, refresh };
}
