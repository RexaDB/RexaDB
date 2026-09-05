"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { openExternalUrl } from "@/lib/desktop";
import { toast } from "sonner";
import TaskRows from "@/components/studio/ai/task-rows";
import type { Task, TaskStatus } from "@/lib/ai/task-types";
import { usePaymentsConnection } from "@/hooks/use-payments-connection";
import {
  createStripeWebhookEndpoint,
  deployPaykitFunctions,
  exposePaykitSchema,
  fetchPaykitStatus,
  loadPaykitDrafts,
  pushPaykitSchema,
  repairPaykitProject,
  setPaykitSecrets,
  syncPaykitProducts,
} from "@/lib/supabase-paykit/deploy-client";
import { isSyncBlockingError, summarizeSyncResult } from "@/lib/supabase-paykit/sync";
import {
  PAYKIT_WEBHOOK_EVENTS,
  paykitWebhookUrl,
} from "@/lib/supabase-paykit/types";
import type {
  PaykitDraftState,
  PaykitProjectStatus,
} from "@/lib/supabase-paykit/types";
import { validateDrafts } from "@/lib/supabase-paykit/validation";
import { PaykitLogo } from "../paykit-logo";
import { CopyPromptButton } from "../copy-prompt-button";

type Phase = "schema" | "tables" | "deploy" | "expose" | "verify";
type StepId = "schema" | "tables" | "functions" | "verify";

const STEP_LABELS: Record<StepId, string> = {
  schema: "Setting up the schema",
  tables: "Creating tables",
  functions: "Creating edge functions",
  verify: "Verifying setup",
};

function functionsDeployed(status: PaykitProjectStatus | null): boolean {
  if (!status || status.functions.length === 0) return false;
  return status.functions.every((f) => f.deployed);
}

function setupComplete(status: PaykitProjectStatus | null): boolean {
  if (!status) return false;
  // RLS / grants / bundle version gate completion only when the status check
  // could read them (null = unknown, e.g. older tokens) — never block on
  // unknowns. A stale bundle specifically means sync will 401, so it blocks.
  // Gateway JWT verification must be off on every deployed function (auth is
  // enforced in-function); unknown stays passing.
  const rlsOk = status.tables.every((t) => t.rlsEnabled !== false);
  const grantsOk = status.grantsReady !== false;
  const bundleOk = status.functionsStale !== true;
  const jwtOk = !status.functions.some(
    (f) => f.deployed && f.verifyJwt === true,
  );
  return (
    status.schemaReady &&
    functionsDeployed(status) &&
    status.secretsReady &&
    status.postgrestExposed !== false &&
    rlsOk &&
    grantsOk &&
    bundleOk &&
    jwtOk
  );
}

export function PaymentsSetupView({ studio }: { studio: any }) {
  const conn = usePaymentsConnection(studio);
  const ref = conn?.projectRef ?? null;
  const token = conn?.token ?? null;

  const [drafts, setDrafts] = useState<PaykitDraftState | null>(null);
  const [status, setStatus] = useState<PaykitProjectStatus | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [completed, setCompleted] = useState<StepId[]>([]);
  const [failedStep, setFailedStep] = useState<StepId | null>(null);
  const [ran, setRan] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [exposeNote, setExposeNote] = useState<string | null>(null);
  const [secretsOpen, setSecretsOpen] = useState(false);
  /** When true, saving secrets automatically starts the setup run. */
  const [gateRun, setGateRun] = useState(false);
  const [dialogView, setDialogView] = useState<"secrets" | "webhook">("secrets");
  const [copiedUrl, setCopiedUrl] = useState(false);

  const webhookUrl = ref ? paykitWebhookUrl(ref) : "";

  const copyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1500);
    } catch {
      toast.error("Could not copy to clipboard.");
    }
  };
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({
    STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
  });
  const [savingSecrets, setSavingSecrets] = useState(false);
  /** Auto-create endpoint in Stripe (webhook tab). Key stays in memory only. */
  const [stripeKey, setStripeKey] = useState("");
  const [creatingEndpoint, setCreatingEndpoint] = useState(false);
  const [endpointResult, setEndpointResult] = useState<{
    id: string;
    secret: string;
    livemode: boolean;
  } | null>(null);
  const [endpointError, setEndpointError] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [savingWebhookSecret, setSavingWebhookSecret] = useState(false);

  // Prefill the auto-create key from what was typed on the Secrets tab.
  useEffect(() => {
    if (
      dialogView === "webhook" &&
      !stripeKey &&
      secretInputs.STRIPE_SECRET_KEY?.trim()
    ) {
      setStripeKey(secretInputs.STRIPE_SECRET_KEY.trim());
    }
  }, [dialogView, secretInputs.STRIPE_SECRET_KEY, stripeKey]);

  const autoCreateEndpoint = async () => {
    const key = stripeKey.trim() || secretInputs.STRIPE_SECRET_KEY?.trim() || "";
    if (!key) {
      toast.error("Paste your Stripe secret key first (sk_test_… or sk_live_…).");
      return;
    }
    if (!webhookUrl) {
      toast.error("No endpoint URL — open a Supabase project connection first.");
      return;
    }
    setCreatingEndpoint(true);
    setEndpointError(null);
    setEndpointResult(null);
    try {
      const created = await createStripeWebhookEndpoint({
        secretKey: key,
        url: webhookUrl,
        events: PAYKIT_WEBHOOK_EVENTS,
      });
      setEndpointResult({
        id: created.id,
        secret: created.secret,
        livemode: created.livemode,
      });
      toast.success("Endpoint created in Stripe — save the signing secret below.");
    } catch (e) {
      setEndpointError(
        e instanceof Error ? e.message : "Creating the endpoint failed.",
      );
    } finally {
      setCreatingEndpoint(false);
    }
  };

  const copyEndpointSecret = async () => {
    if (!endpointResult) return;
    try {
      await navigator.clipboard.writeText(endpointResult.secret);
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 1500);
    } catch {
      toast.error("Could not copy to clipboard.");
    }
  };

  const saveWebhookSecret = async () => {
    if (!token || !ref || !endpointResult) return;
    setSavingWebhookSecret(true);
    try {
      await setPaykitSecrets(token, ref, {
        STRIPE_WEBHOOK_SECRET: endpointResult.secret,
      });
      toast.success("Webhook signing secret saved to the Supabase project.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Saving the secret failed.");
    } finally {
      setSavingWebhookSecret(false);
    }
  };

  useEffect(() => {
    if (ref) setDrafts(loadPaykitDrafts(ref));
    else setDrafts(null);
  }, [ref]);

  const refresh = useCallback(async () => {
    if (!token || !ref) {
      setStatus(null);
      return null;
    }
    try {
      const s = await fetchPaykitStatus(token, ref);
      setStatus(s);
      return s;
    } catch {
      // status errors surface on run; silent here
      return null;
    }
  }, [token, ref]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const draftErrors = drafts ? validateDrafts(drafts) : ["No plans defined."];
  const running = phase !== null;
  const done = setupComplete(status);

  const activeStep: StepId | null =
    phase === "schema" ? "schema"
    : phase === "tables" ? "tables"
    : phase === "deploy" ? "functions"
    : phase === "expose" || phase === "verify" ? "verify"
    : null;

  const stepStatus = (id: StepId): TaskStatus => {
    if (failedStep === id) return "failed";
    if (completed.includes(id)) return "completed";
    if (activeStep === id) return "in_progress";
    if (!status) return "pending";
    if (id === "schema" && status.schemaExists) return "completed";
    if (id === "tables" && status.schemaReady) return "completed";
    if (id === "functions" && functionsDeployed(status)) return "completed";
    if (id === "verify" && done) return "completed";
    return "pending";
  };

  const presentCount = status?.tables.filter((t) => t.present).length ?? 0;

  /** AI-task list driving the progress card (same component as the agent todo list). */
  const tasks: Task[] = (Object.keys(STEP_LABELS) as StepId[]).map((id) => {
    const task: Task = { id, label: STEP_LABELS[id], status: stepStatus(id) };
    if (id === "schema") {
      task.amount = "paykit";
      task.details = [
        { label: "Schema", meta: status?.schemaExists ? "exists" : "missing" },
        { label: "Grants", meta: "service_role" },
      ];
    }
    if (id === "tables") {
      task.amount = status ? `${presentCount}/10 tables` : undefined;
      task.details = [
        { label: "Tables", meta: status ? `${presentCount}/10` : "—" },
        { label: "Keys & indexes", meta: status?.schemaReady ? "applied" : "pending" },
      ];
    }
    if (id === "functions") {
      const fns = status?.functions ?? [];
      task.amount = status ? `${fns.filter((f) => f.deployed).length}/2 live` : undefined;
      task.details = fns.map((f) => ({
        label: f.slug,
        meta: !f.deployed
          ? "missing"
          : f.verifyJwt === false
            ? "live · no-jwt"
            : f.verifyJwt === true
              ? "live · jwt on"
              : "live",
      }));
    }
    if (id === "verify") {
      const rlsCount = status?.tables.filter((t) => t.rlsEnabled).length ?? 0;
      task.details = [
        { label: "Secrets", meta: status ? (status.secretsReady ? "set" : "missing") : "—" },
        { label: "RLS", meta: status ? `${rlsCount}/10 enforced` : "—" },
        {
          label: "Data API",
          meta: !status || status.postgrestExposed === null ? "—" : status.postgrestExposed ? "exposed" : "missing",
        },
        {
          label: "Plan lookup",
          meta:
            !status || status.functionsStale === null
              ? "—"
              : status.functionsStale
                ? "missing"
                : "available",
        },
      ];
    }
    return task;
  });

  const runSetup = async () => {
    if (!token || !ref || !drafts) return;
    if (draftErrors.length > 0) {
      toast.error("Fix plan errors in the Plans tab before running setup.");
      return;
    }
    setRunError(null);
    setExposeNote(null);
    setCompleted([]);
    setFailedStep(null);
    const failStepFor = (p: Phase): StepId =>
      p === "schema" ? "schema" : p === "tables" ? "tables" : p === "deploy" ? "functions" : "verify";
    let current: Phase = "schema";
    const go = (p: Phase) => {
      current = p;
      setPhase(p);
    };
    try {
      go("schema");
      await pushPaykitSchema(token, ref, "schema");
      setCompleted(["schema"]);
      go("tables");
      await pushPaykitSchema(token, ref, "tables");
      setCompleted(["schema", "tables"]);
      go("deploy");
      const deployed = await deployPaykitFunctions({ token, ref, drafts });
      if (deployed.results.some((r) => !r.deployed)) {
        throw new Error(
          deployed.results
            .filter((r) => !r.deployed)
            .map((r) => `${r.slug}: ${r.error ?? "failed"}`)
            .join(" "),
        );
      }
      setCompleted(["schema", "tables", "functions"]);
      go("expose");
      const notes: string[] = [];
      try {
        await exposePaykitSchema(token, ref);
      } catch (e) {
        notes.push(
          e instanceof Error ? e.message : "Automatic exposure failed.",
        );
      }
      go("verify");
      const fresh = await refresh();
      if (fresh && !fresh.secretsReady) {
        notes.push("Finish by adding your Stripe secrets below.");
      }
      // Auto-sync so deployed drafts go live on Stripe without a manual call.
      // Non-fatal, except blocking sync failures (stale bundle, gateway
      // block, env mismatch): those prove the project isn't working, so the
      // verify step fails instead of showing Completed next to the error.
      try {
        const synced = await syncPaykitProducts(token, ref);
        const s = summarizeSyncResult(synced);
        notes.push(
          `Synced ${s.products} product${s.products === 1 ? "" : "s"} to Stripe (${s.withPrices} with prices${s.features > 0 ? `, ${s.features} feature${s.features === 1 ? "" : "s"} linked` : ""}).`,
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "sync failed";
        notes.push(
          `Auto-sync skipped: ${message} — use Sync to Stripe in the Plans tab.`,
        );
        if (isSyncBlockingError(message)) {
          setFailedStep("verify");
        }
      }
      if (notes.length > 0) setExposeNote(notes.join(" "));
      toast.success("Setup finished. Add Stripe secrets if you haven't yet.");
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Setup failed.");
      setFailedStep(failStepFor(current));
    } finally {
      setPhase(null);
      setRan(true);
      await refresh();
    }
  };

  // Sequential flow: Run setup first — Set secrets only appears afterwards
  // (or when secrets are known-missing), never next to it up front.
  // Once setup is complete, a disabled Completed pill replaces it.
  const lastRunClean = ran && !runError && !failedStep;
  const showRun = !running && !done && !lastRunClean;
  const showSecrets =
    !running &&
    !done &&
    (lastRunClean || (status !== null && !status.secretsReady));

  // Gaps in an EXISTING setup that repair can fill without a full re-run:
  // missing RLS, missing service_role grants, missing Data API exposure.
  // Absent tables are not gaps — that is "Run setup" territory.
  // A stale function bundle is NOT repairable in place (needs redeploy),
  // so it gets its own hint pointing at Run setup instead of the Fix pill.
  const repairGaps: string[] = [];
  const bundleStale = status !== null && !running && status.functionsStale === true;
  if (status && !running) {
    const rlsMissing = status.tables.filter(
      (t) => t.present && t.rlsEnabled === false,
    ).length;
    if (rlsMissing > 0) {
      repairGaps.push(
        `RLS disabled on ${rlsMissing} table${rlsMissing === 1 ? "" : "s"}`,
      );
    }
    if (status.grantsReady === false) {
      repairGaps.push("service_role grants incomplete");
    }
    if (status.postgrestExposed === false) {
      repairGaps.push("paykit schema not exposed via Data API");
    }
  }

  const [repairing, setRepairing] = useState(false);
  const runRepair = async () => {
    if (!token || !ref) return;
    setRepairing(true);
    try {
      const result = await repairPaykitProject(token, ref);
      if (result.applied.length > 0) {
        toast.success(`Fixed: ${result.applied.join("; ")}.`);
      } else {
        toast.success("Nothing missing — already complete.");
      }
      if (result.status) setStatus(result.status);
      else await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Repair failed.");
      await refresh();
    } finally {
      setRepairing(false);
    }
  };

  const saveSecrets = async () => {
    if (!token || !ref) return;
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(secretInputs)) {
      if (v.trim()) payload[k] = v.trim();
    }
    if (Object.keys(payload).length === 0) {
      toast.error("Enter at least one secret value.");
      return;
    }
    setSavingSecrets(true);
    try {
      await setPaykitSecrets(token, ref, payload);
      const shouldRun = gateRun;
      setGateRun(false);
      setSecretInputs({ STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "" });
      setSecretsOpen(false);
      toast.success("Secrets saved to the Supabase project.");
      await refresh();
      if (shouldRun) void runSetup();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Setting secrets failed.");
    } finally {
      setSavingSecrets(false);
    }
  };

  /** Run setup goes through the secrets modal first (same dialog as Set secrets). */
  const handleRunClick = () => {
    if (draftErrors.length > 0) {
      toast.error("Fix plan errors in the Plans tab before running setup.");
      return;
    }
    if (status?.secretsReady) {
      void runSetup();
      return;
    }
    setGateRun(true);
    setSecretsOpen(true);
  };

  const pillButton =
    "h-11 flex-1 rounded-full border border-border bg-card px-8 text-sm font-medium text-foreground shadow-sm hover:bg-muted/50";

  return (
    <div className="mx-auto my-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-center gap-3">
        <PaykitLogo className="h-9 w-auto text-foreground" />
        <h2 className="text-2xl font-semibold tracking-tight">PayKit Setup</h2>
      </div>

      <div className="px-1 py-2">
        {!ref ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Open a Supabase project connection to set up billing.
          </p>
        ) : !token ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Direct Postgres connection with no linked Supabase account that can
            see this project. Link the account in the Supabase tab to run
            automatic setup.
          </p>
        ) : (
          <>
            <div className="flex justify-center">
              <TaskRows
                tasks={tasks}
                variant="Capsules"
                onRetry={() => {
                  setFailedStep(null);
                  setRunError(null);
                  void runSetup();
                }}
              />
            </div>

            {(runError || exposeNote) && (
              <p className="mt-5 break-words rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed">
                {runError ?? exposeNote}
              </p>
            )}

            <div className="mx-auto mt-7 flex w-full max-w-[440px] items-center gap-2">
              {showRun && !repairing && (
                <Button
                  className={pillButton}
                  disabled={draftErrors.length > 0 || repairing}
                  onClick={handleRunClick}
                >
                  {ran ? "Fix setup" : "Run setup"}
                </Button>
              )}
              {running && (
                <Button className={pillButton} disabled>
                  <Loader2 className="size-4 animate-spin" />
                  Setting up…
                </Button>
              )}
              {showSecrets && !repairing && (
                <Button
                  className={pillButton}
                  disabled={!token || savingSecrets || repairing}
                  onClick={() => {
                    setGateRun(false);
                    setSecretsOpen(true);
                  }}
                >
                  Set secrets
                </Button>
              )}
              {done && !running && (
                <Button className={pillButton} disabled>
                  <Check className="size-4" />
                  Completed
                </Button>
              )}
              {done && !running && drafts && (
                <CopyPromptButton
                  drafts={drafts}
                  projectRef={ref ?? ""}
                  triggerClassName="h-11 flex-1 rounded-full px-8 text-sm font-medium"
                />
              )}
              {repairGaps.length > 0 && !running && (
                <Button
                  className={pillButton}
                  disabled={repairing}
                  onClick={() => void runRepair()}
                >
                  {repairing && <Loader2 className="size-4 animate-spin" />}
                  {repairing ? "Fixing…" : "Fix missing pieces"}
                </Button>
              )}
            </div>
            {repairGaps.length > 0 && !running && !repairing && (
              <div className="mt-2 flex justify-center">
                <span className="inline-flex h-[22px] items-center rounded-full bg-amber-500/10 px-2 text-[11.5px] font-medium text-amber-600 dark:text-amber-400">
                  Missing: {repairGaps.join(" · ")}
                </span>
              </div>
            )}
            {bundleStale && (
              <div className="mt-2 flex justify-center">
                <span className="inline-flex h-[22px] items-center rounded-full bg-amber-500/10 px-2 text-[11.5px] font-medium text-amber-600 dark:text-amber-400">
                  Edge Functions outdated — Run setup to update
                </span>
              </div>
            )}
            {status && !running && status.functions.some((f) => f.deployed && f.verifyJwt === true) && (
              <div className="mt-2 flex justify-center">
                <span className="inline-flex h-[22px] items-center rounded-full bg-amber-500/10 px-2 text-[11.5px] font-medium text-amber-600 dark:text-amber-400">
                  Gateway JWT verification is on — Run setup to disable it
                </span>
              </div>
            )}
            {draftErrors.length > 0 && (
              <p className="mt-2 text-right text-[11px] text-amber-500">
                Define valid plans first (Plans tab) to enable Run setup.
              </p>
            )}
          </>
        )}
      </div>

      <Dialog
        open={secretsOpen}
        onOpenChange={(open) => {
          setSecretsOpen(open);
          if (!open) {
            setGateRun(false);
          } else {
            setDialogView("secrets");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Set secrets</DialogTitle>
          </DialogHeader>
          <div className="grid w-full max-w-full min-w-0 grid-cols-2 gap-1 rounded-full border border-border bg-muted/40 p-1">
            {(["secrets", "webhook"] as const).map((view) => (
              <button
                key={view}
                type="button"
                onClick={() => setDialogView(view)}
                className={`h-8 rounded-full text-xs font-medium transition-colors ${
                  dialogView === view
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {view === "secrets" ? "Secrets" : "Webhook setup"}
              </button>
            ))}
          </div>
          {dialogView === "secrets" ? (
            <>
              {gateRun && (
                <p className="text-xs text-muted-foreground">
                  Add your Stripe keys to continue — setup starts automatically
                  after saving.
                </p>
              )}
              <div className="flex flex-col gap-3 py-2">
                <div className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-2 font-mono text-xs">
                    STRIPE_SECRET_KEY
                    {status?.secretsPresent.STRIPE_SECRET_KEY && (
                      <span className="rounded-full border border-green-500/30 bg-green-500/10 px-1.5 py-px text-[10px] text-green-500">
                        set
                      </span>
                    )}
                  </span>
                  <Input
                    type="password"
                    value={secretInputs.STRIPE_SECRET_KEY ?? ""}
                    onChange={(e) =>
                      setSecretInputs((s) => ({ ...s, STRIPE_SECRET_KEY: e.target.value }))
                    }
                    placeholder="sk_…"
                    autoComplete="off"
                    className="font-mono text-xs"
                  />
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Lets your Edge Functions create checkouts, customers and
                    prices. Stripe Dashboard → Developers → API keys → Secret
                    key. Starts with <span className="font-mono">sk_test_</span> (test)
                    or <span className="font-mono">sk_live_</span> (live).
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-2 font-mono text-xs">
                    STRIPE_WEBHOOK_SECRET
                    {status?.secretsPresent.STRIPE_WEBHOOK_SECRET && (
                      <span className="rounded-full border border-green-500/30 bg-green-500/10 px-1.5 py-px text-[10px] text-green-500">
                        set
                      </span>
                    )}
                  </span>
                  <Input
                    type="password"
                    value={secretInputs.STRIPE_WEBHOOK_SECRET ?? ""}
                    onChange={(e) =>
                      setSecretInputs((s) => ({ ...s, STRIPE_WEBHOOK_SECRET: e.target.value }))
                    }
                    placeholder="whsec_…"
                    autoComplete="off"
                    className="font-mono text-xs"
                  />
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Proves webhooks really came from Stripe. Register the
                    endpoint first (see Webhook setup tab), then copy its
                    Signing secret — starts with{" "}
                    <span className="font-mono">whsec_</span>.
                  </p>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Values go straight to Supabase secrets — never stored in
                  RexaDB.
                </p>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setSecretsOpen(false)}
                  disabled={savingSecrets}
                >
                  Cancel
                </Button>
                <Button onClick={() => void saveSecrets()} disabled={savingSecrets}>
                  {savingSecrets && <Loader2 className="size-3.5 animate-spin" />}
                  Save secrets
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="flex max-w-full min-w-0 flex-col gap-3 overflow-hidden py-2">
                <div className="flex max-w-full min-w-0 flex-col gap-1.5">
                  <span className="text-xs font-medium">Endpoint URL</span>
                  <div className="flex max-w-full min-w-0 items-center gap-1.5">
                    <code
                      title={webhookUrl}
                      className="block max-w-full min-w-0 flex-1 truncate overflow-hidden rounded-lg border border-border bg-muted/40 px-2.5 py-2 font-mono text-[11px]"
                    >
                      {webhookUrl}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0 text-[11px]"
                      onClick={() => void copyWebhookUrl()}
                    >
                      {copiedUrl ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      {copiedUrl ? "Copied" : "Copy"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0 text-[11px]"
                      onClick={() =>
                        void openExternalUrl("https://dashboard.stripe.com/webhooks")
                      }
                      title="Open Stripe Dashboard → Webhooks"
                    >
                      <ExternalLink className="size-3.5" />
                      Open Stripe
                    </Button>
                  </div>
                </div>
                <div className="flex max-w-full min-w-0 flex-col gap-2 overflow-hidden rounded-xl border border-border bg-muted/20 p-2.5">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="text-xs font-medium">Auto-create in Stripe</span>
                    {endpointResult && (
                      <span
                        className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] ${
                          endpointResult.livemode
                            ? "border-amber-500/30 bg-amber-500/10 text-amber-500"
                            : "border-green-500/30 bg-green-500/10 text-green-500"
                        }`}
                      >
                        {endpointResult.livemode ? "live" : "test"}
                      </span>
                    )}
                  </div>
                  {!endpointResult ? (
                    <>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        Creates the endpoint with the URL above and all{" "}
                        {PAYKIT_WEBHOOK_EVENTS.length} events pre-set. The key
                        goes to your local RexaDB sidecar only — never stored.
                      </p>
                      <Input
                        type="password"
                        value={stripeKey}
                        onChange={(e) => setStripeKey(e.target.value)}
                        placeholder="sk_test_…"
                        autoComplete="off"
                        className="font-mono text-xs"
                      />
                      {stripeKey.trim().startsWith("sk_live_") && (
                        <p className="text-[11px] text-amber-500">
                          Live key — this creates a LIVE endpoint.
                        </p>
                      )}
                      {endpointError && (
                        <p className="break-words text-[11px] text-destructive">
                          {endpointError}
                        </p>
                      )}
                      <Button
                        onClick={() => void autoCreateEndpoint()}
                        disabled={creatingEndpoint || !webhookUrl}
                        className="h-8 text-[11px]"
                      >
                        {creatingEndpoint && (
                          <Loader2 className="size-3.5 animate-spin" />
                        )}
                        {creatingEndpoint ? "Creating…" : "Create endpoint"}
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="break-words font-mono text-[11px] text-muted-foreground">
                        Endpoint {endpointResult.id} created — save its signing
                        secret:
                      </p>
                      <div className="flex max-w-full min-w-0 items-center gap-1.5">
                        <code
                          title={endpointResult.secret}
                          className="block max-w-full min-w-0 flex-1 truncate overflow-hidden rounded-lg border border-border bg-muted/40 px-2.5 py-2 font-mono text-[11px]"
                        >
                          {endpointResult.secret}
                        </code>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 shrink-0 text-[11px]"
                          onClick={() => void copyEndpointSecret()}
                        >
                          {copiedSecret ? (
                            <Check className="size-3.5" />
                          ) : (
                            <Copy className="size-3.5" />
                          )}
                          {copiedSecret ? "Copied" : "Copy"}
                        </Button>
                      </div>
                      <Button
                        onClick={() => void saveWebhookSecret()}
                        disabled={savingWebhookSecret || !token}
                        className="h-8 text-[11px]"
                      >
                        {savingWebhookSecret && (
                          <Loader2 className="size-3.5 animate-spin" />
                        )}
                        Save as STRIPE_WEBHOOK_SECRET
                      </Button>
                    </>
                  )}
                </div>
                <ol className="flex max-w-full min-w-0 list-decimal flex-col gap-1.5 pl-5 text-[12px] leading-relaxed text-muted-foreground">
                  <li className="min-w-0">Stripe Dashboard → Developers → Webhooks → Add endpoint.</li>
                  <li className="min-w-0">Paste the endpoint URL above.</li>
                  <li className="min-w-0">
                    Select events:{" "}
                    <span className="font-mono text-[11px] break-all">
                      {PAYKIT_WEBHOOK_EVENTS.join(", ")}
                    </span>
                    .
                  </li>
                  <li>Add endpoint, then Reveal → copy the Signing secret.</li>
                  <li>
                    Back on the Secrets tab, save it as{" "}
                    <span className="font-mono">STRIPE_WEBHOOK_SECRET</span>.
                  </li>
                </ol>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogView("secrets")}>
                  Back to secrets
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
