"use client";

import { useState } from "react";
import { AuthSectionHeader } from "./auth-section-header";
import { AuthDataGrid } from "./auth-data-grid";
import { useAuthSessions } from "@/hooks/use-auth-sessions";

interface AuthSessionsViewProps {
  connectionString: string;
  enabled: boolean;
}

export function AuthSessionsView({ connectionString, enabled }: AuthSessionsViewProps) {
  const [search, setSearch] = useState("");
  const { sessions, loading, error, refresh } = useAuthSessions(connectionString, enabled);
  const columns = [
    { name: "id", type: "uuid", isPrimaryKey: true },
    { name: "user_id", type: "uuid" },
    { name: "created_at", type: "timestamp" },
    { name: "refreshed_at", type: "timestamp" },
    { name: "not_after", type: "timestamp" },
    { name: "ip", type: "inet" },
    { name: "user_agent", type: "text" },
    { name: "aal", type: "text" },
  ];

  if (!enabled) {
    return <div className="p-6 text-sm text-muted-foreground">Auth schema not available for this connection.</div>;
  }

  return (
    <div className="flex flex-col min-h-0 h-full">
      <AuthSectionHeader
        title="Sessions"
        description="Track active Supabase auth sessions and metadata."
        search={search}
        onSearchChange={setSearch}
        onRefresh={refresh}
        loading={loading}
        countLabel={`${sessions.length} total`}
        placeholder="Search by session id, user id, or IP"
      />
      <div className="flex-1 min-h-0">
        <AuthDataGrid
          rows={sessions}
          columns={columns}
          loading={loading}
          error={error}
          search={search}
          selectedTable="auth.sessions"
          selectedSchema="auth"
        />
      </div>
    </div>
  );
}
