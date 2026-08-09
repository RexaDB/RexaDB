"use client";

import { AlertTriangle } from "@/lib/icon-theme/lucide-react";

export function AdvisorDisabledState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <AlertTriangle className="h-10 w-10 text-amber-500 mb-4" />
      <h3 className="text-lg font-medium text-foreground mb-2">
        Advisor requires a PostgreSQL connection
      </h3>
      <p className="text-sm text-muted-foreground max-w-md mb-6">
        The Advisor feature analyzes PostgreSQL databases for performance, security, and schema
        improvements. Connect to a PostgreSQL database to get started.
      </p>
      <div className="text-xs text-muted-foreground space-y-2">
        <p>Some checks require the <code className="text-foreground bg-muted px-1 rounded">pg_stat_statements</code> extension.</p>
        <p>Connection types supported: PostgreSQL, Supabase, Neon, and any Postgres-compatible database.</p>
      </div>
    </div>
  );
}
