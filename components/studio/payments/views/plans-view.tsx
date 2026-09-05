"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CopyPromptButton } from "../copy-prompt-button";
import { cn } from "@/lib/utils";
import { usePaymentsConnection } from "@/hooks/use-payments-connection";
import {
  deployPaykitFunctions,
  loadPaykitDrafts,
  savePaykitDrafts,
  syncPaykitProducts,
} from "@/lib/supabase-paykit/deploy-client";
import { summarizeSyncResult } from "@/lib/supabase-paykit/sync";
import { validateDrafts } from "@/lib/supabase-paykit/validation";
import type { PaykitDraftState } from "@/lib/supabase-paykit/types";
import { PlansTab } from "../plans-tab";
import { FeaturesTab } from "../features-tab";
import { ViewShell } from "./shared";

export function PaymentsPlansView({ studio }: { studio: any }) {
  const conn = usePaymentsConnection(studio);
  const ref = conn?.projectRef ?? null;
  const [drafts, setDrafts] = useState<PaykitDraftState | null>(null);
  const [tab, setTab] = useState<"products" | "features">("products");

  useEffect(() => {
    if (ref) setDrafts(loadPaykitDrafts(ref));
    else setDrafts(null);
  }, [ref]);

  useEffect(() => {
    if (ref && drafts) savePaykitDrafts(ref, drafts);
  }, [ref, drafts]);

  const update = useCallback(
    (fn: (d: PaykitDraftState) => PaykitDraftState) => {
      setDrafts((d) => (d ? fn(d) : d));
    },
    [],
  );

  const errors = drafts ? validateDrafts(drafts) : [];
  const token = conn?.token ?? null;
  const [syncing, setSyncing] = useState(false);

  const runSync = async () => {
    if (!token || !ref) {
      toast.error("Link a Supabase account that can see this project first.");
      return;
    }
    if (errors.length > 0) {
      toast.error("Fix plan errors first — sync needs valid drafts.");
      return;
    }
    if (!drafts || drafts.plans.length === 0) {
      toast.error("Add a product first — there is nothing to sync.");
      return;
    }
    // Sync acts on the DEPLOYED bundle, not these drafts — so deploy first.
    // Otherwise sync "succeeds" while pushing last run's stale plans.
    setSyncing(true);
    try {
      const deployed = await deployPaykitFunctions({ token, ref, drafts });
      const failed = deployed.results.filter((r) => !r.deployed);
      if (failed.length > 0) {
        throw new Error(
          `Deploy failed: ${failed.map((r) => `${r.slug}: ${r.error ?? "failed"}`).join(" ")}`,
        );
      }
      const result = await syncPaykitProducts(token, ref);
      const s = summarizeSyncResult(result);
      toast.success(
        `Synced ${s.products} product${s.products === 1 ? "" : "s"} to Stripe (${s.withPrices} with prices${s.features > 0 ? `, ${s.features} feature${s.features === 1 ? "" : "s"} linked` : ""}).`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  if (!ref || !drafts) {
    return (
      <ViewShell title="Plans">
        <p className="text-xs text-muted-foreground">
          Open a Supabase project connection to manage billing plans.
        </p>
      </ViewShell>
    );
  }

  return (
    <ViewShell
      title="Plans"
      description="Define once here, then deploy to sync products and prices to Stripe. Drafts are stored on this device until deployed."
      actions={
        <span className="flex shrink-0 items-center gap-1.5">
          <CopyPromptButton drafts={drafts} projectRef={ref} />
          <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0 gap-1.5 text-xs"
          disabled={syncing || !token}
          onClick={() => void runSync()}
          title={token ? "Create/update Stripe products and prices from these drafts" : "Link a Supabase account first"}
        >
          {syncing ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5 shrink-0" />
          )}
          {syncing ? "Syncing…" : "Sync to Stripe"}
        </Button>
        </span>
      }
    >
      {errors.length > 0 && (
        <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          <AlertTriangle className="mt-px size-4 shrink-0 text-amber-500" />
          <ul className="flex min-w-0 flex-col gap-0.5 break-words">
            {errors.slice(0, 6).map((e, i) => (
              <li key={i}>• {e}</li>
            ))}
            {errors.length > 6 && <li>• …and {errors.length - 6} more</li>}
          </ul>
        </div>
      )}
      <div className="flex items-center gap-1 border-b border-border">
        {(
          [
            { id: "products", label: "Products", count: drafts.plans.length },
            { id: "features", label: "Features", count: drafts.features.length },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "-mb-px border-b-2 px-3 pb-2 pt-1 text-sm transition-colors",
              tab === t.id
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}{" "}
            <span className="font-normal text-muted-foreground">({t.count})</span>
          </button>
        ))}
      </div>
      <div className="w-full min-w-0">
        {tab === "products" ? (
          <PlansTab drafts={drafts} update={update} />
        ) : (
          <FeaturesTab drafts={drafts} update={update} />
        )}
      </div>
    </ViewShell>
  );
}
