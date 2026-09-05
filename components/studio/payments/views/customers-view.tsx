"use client";

import { useCallback, useEffect, useState } from "react";
import {
  PAYKIT_QUERIES,
  formatDateTime,
  queryPaykit,
} from "@/lib/supabase-paykit/queries";
import {
  DataTable,
  EmptyState,
  SetupCta,
  StatusBadge,
  ViewError,
  ViewLoading,
  ViewShell,
} from "./shared";

export function PaymentsCustomersView({ studio }: { studio: any }) {
  const connectionString: string = studio?.connection?.connectionString ?? "";
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    if (!connectionString) return;
    setLoading(true);
    setError(null);
    const res = await queryPaykit(connectionString, PAYKIT_QUERIES.customers);
    setRows(res.rows);
    setMissing(res.missingSchema);
    if (!res.missingSchema) setError(res.error);
    setLoading(false);
  }, [connectionString]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ViewShell title="Customers" description="Billing customers synced from Stripe checkout and the PayKit API." loading={loading} onRefresh={() => void load()}>
      {loading ? (
        <ViewLoading />
      ) : missing ? (
        <SetupCta onGoSetup={() => studio.openPaymentsSetupTab?.()} />
      ) : (
        <>
          {error && <ViewError message={error} />}
          {rows.length === 0 ? (
            <EmptyState message="No customers yet. Customers appear after the first checkout or API upsert." />
          ) : (
            <DataTable
              rows={rows}
              columns={[
                { key: "id", label: "Customer", mono: true },
                { key: "email", label: "Email" },
                { key: "name", label: "Name" },
                { key: "stripe_customer_id", label: "Stripe ID", mono: true },
                {
                  key: "active_subs",
                  label: "Active subs",
                  render: (r) => <StatusBadge status={Number(r.active_subs) > 0 ? "active" : "none"} />,
                },
                { key: "total_subs", label: "Total subs" },
                { key: "created_at", label: "Created", render: (r) => formatDateTime(r.created_at) },
              ]}
            />
          )}
        </>
      )}
    </ViewShell>
  );
}

export function PaymentsSubscriptionsView({ studio }: { studio: any }) {
  const connectionString: string = studio?.connection?.connectionString ?? "";
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    if (!connectionString) return;
    setLoading(true);
    setError(null);
    const res = await queryPaykit(connectionString, PAYKIT_QUERIES.subscriptions);
    setRows(res.rows);
    setMissing(res.missingSchema);
    if (!res.missingSchema) setError(res.error);
    setLoading(false);
  }, [connectionString]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ViewShell title="Subscriptions" description="Active and historical subscriptions across all plans." loading={loading} onRefresh={() => void load()}>
      {loading ? (
        <ViewLoading />
      ) : missing ? (
        <SetupCta onGoSetup={() => studio.openPaymentsSetupTab?.()} />
      ) : (
        <>
          {error && <ViewError message={error} />}
          {rows.length === 0 ? (
            <EmptyState message="No subscriptions yet. They appear after the first successful checkout." />
          ) : (
            <DataTable
              rows={rows}
              columns={[
                { key: "customer_email", label: "Customer" },
                { key: "plan_name", label: "Plan" },
                { key: "status", label: "Status", render: (r) => <StatusBadge status={String(r.status)} /> },
                {
                  key: "cancel_at_period_end",
                  label: "Cancels at period end",
                  render: (r) => (r.cancel_at_period_end ? "yes" : "no"),
                },
                { key: "current_period_end_at", label: "Period ends", render: (r) => formatDateTime(r.current_period_end_at) },
                { key: "stripe_subscription_id", label: "Stripe ID", mono: true },
              ]}
            />
          )}
        </>
      )}
    </ViewShell>
  );
}
