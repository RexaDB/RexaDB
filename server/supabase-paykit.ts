// Sidecar handlers for PayKit scaffolding in the USER's Supabase project.
// Mounted via dynamicPostRoute in server/index.ts as:
//   POST /api/supabase-paykit/{status,push-schema,deploy,secrets}
// The mgmt token arrives in the request body (never logged, never stored).

import {
  PAYKIT_SCHEMA,
  PAYKIT_TABLE_NAMES,
  PAYKIT_SCHEMA_VERSION,
  PAYKIT_GRANT_STATEMENTS,
  PAYKIT_REQUIRED_PRIVILEGES,
  buildPaykitGrantsStatusQuery,
  buildPaykitRlsStatusQuery,
  buildPaykitTablesPresenceQuery,
  getPaykitSchemaStatements,
  mergeExposedSchemas,
  paykitRlsStatement,
  type PaykitSchemaPhase,
} from "../lib/supabase-paykit/paykit-sql";
import { validateDrafts } from "../lib/supabase-paykit/validation";
import { hashPaykitDrafts } from "../lib/supabase-paykit/codegen";
import {
  ENV_MISMATCH_MESSAGE,
  buildSyncInvokeRequest,
  classifySyncAuthFailure,
  collectCandidateKeys,
  compareTemplateVersion,
  pickAnonKey,
  syncAuthFailureMessage,
  type SyncInvokeRequest,
} from "../lib/supabase-paykit/sync";
import {
  PAYKIT_TEMPLATE_VERSION,
  buildApiSource,
  buildWebhookSource,
} from "../lib/supabase-paykit/function-templates";
import {
  PAYKIT_API_SLUG,
  PAYKIT_FUNCTIONS,
  PAYKIT_REQUIRED_SECRETS,
  paykitWebhookUrl,
  type PaykitDraftState,
  type PaykitFunctionStatus,
  type PaykitProjectStatus,
} from "../lib/supabase-paykit/types";

const MGMT = "https://api.supabase.com";

function err(message: string) {
  return { success: false as const, error: message };
}

function ok<T>(data: T) {
  return { success: true as const, data };
}

function checkRef(ref: unknown): string | null {
  if (typeof ref !== "string" || !/^[a-z0-9-]{1,64}$/.test(ref.trim())) {
    return null;
  }
  return ref.trim();
}

function checkToken(token: unknown): string | null {
  if (typeof token !== "string" || token.trim().length < 8) return null;
  return token;
}

async function mgmt(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(`${MGMT}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text().catch(() => res.statusText);
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: res.status, json: parsed, text };
}

function mgmtError(action: string, status: number, text: string): string {
  const hint =
    status === 401 || status === 403
      ? " (check the Supabase token — it may have expired or lack the required scope; remove and re-link the account)"
      : "";
  return `${action} failed (${status}): ${text.slice(0, 300)}${hint}`;
}

async function runMgmtQuery(token: string, ref: string, query: string): Promise<any[]> {
  const { status, json, text } = await mgmt(token, `/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (status !== 200 && status !== 201) {
    throw new Error(mgmtError("Database query", status, text));
  }
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.result)) return json.result;
  if (Array.isArray(json?.data)) return json.data;
  return [];
}

// ─── status ─────────────────────────────────────────────────────────────

function parseFunctionsList(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.functions)) return payload.functions;
  return [];
}

function parseSecretNames(payload: any): string[] {
  const arr = Array.isArray(payload) ? payload : payload?.secrets;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((s: any) =>
      typeof s === "string" ? s : (s?.name ?? s?.key ?? s?.secret_name ?? null),
    )
    .filter((n: any): n is string => typeof n === "string");
}

export async function getPaykitStatus(body: any) {
  const token = checkToken(body?.token);
  const ref = checkRef(body?.ref);
  if (!token || !ref) return err("Missing Supabase token or project ref.");

  const warnings: string[] = [];

  // tables (+ RLS state, best-effort)
  const present = new Set<string>();
  const rls = new Map<string, boolean>();
  let schemaExists = false;
  try {
    const rows = await runMgmtQuery(token, ref, buildPaykitTablesPresenceQuery());
    for (const r of rows) {
      const name = (r?.table_name ?? r?.tablename ?? "") as string;
      if (name) present.add(name);
    }
    try {
      const rlsRows = await runMgmtQuery(token, ref, buildPaykitRlsStatusQuery());
      for (const r of rlsRows) {
        const name = (r?.table_name ?? "") as string;
        if (name) rls.set(name, (r as any)?.rls_enabled === true);
      }
    } catch {
      // RLS state unknown — leave nulls, don't block status.
    }
    try {
      const nsRows = await runMgmtQuery(
        token,
        ref,
        `SELECT to_regnamespace('${PAYKIT_SCHEMA}') IS NOT NULL AS exists`,
      );
      schemaExists = nsRows[0]?.exists === true;
    } catch {
      schemaExists = present.size > 0;
    }
  } catch (e: any) {
    return err(e.message);
  }

  // functions (best-effort: older tokens may lack edge_functions scope)
  const functions: PaykitFunctionStatus[] = [];
  try {
    const { status, json, text } = await mgmt(token, `/v1/projects/${ref}/functions`, {
      method: "GET",
    });
    if (status === 200 || status === 201) {
      const list = parseFunctionsList(json);
      const bySlug = new Map(list.map((f: any) => [f?.slug ?? f?.name, f]));
      for (const spec of PAYKIT_FUNCTIONS) {
        const found: any = bySlug.get(spec.slug);
        functions.push({
          slug: spec.slug,
          deployed: Boolean(found),
          verifyJwt:
            found?.verify_jwt === undefined ? null : Boolean(found.verify_jwt),
          version: found?.version ?? found?.updated_at ?? null,
        });
      }
    } else {
      warnings.push(mgmtError("Functions list", status, text));
      for (const spec of PAYKIT_FUNCTIONS) {
        functions.push({ slug: spec.slug, deployed: false, verifyJwt: null });
      }
    }
  } catch (e: any) {
    warnings.push(`Functions list unavailable: ${e.message}`);
    for (const spec of PAYKIT_FUNCTIONS) {
      functions.push({ slug: spec.slug, deployed: false, verifyJwt: null });
    }
  }

  // Deployed bundle template version (best-effort): invoke the open status
  // action on paykit-api with the anon key. A reachable bundle that reports
  // no version predates versioning and is stale by definition; anything
  // unreadable stays unknown and never blocks.
  let functionsStale: boolean | null = null;
  const apiFn = functions.find((f) => f.slug === PAYKIT_API_SLUG);
  if (apiFn?.deployed) {
    try {
      const { status: keyStatus, json: keyJson } = await mgmt(token, `/v1/projects/${ref}/api-keys`, {
        method: "GET",
      });
      const anonKey =
        keyStatus === 200 || keyStatus === 201 ? pickAnonKey(keyJson) : null;
      if (!anonKey) {
        warnings.push("Project API keys unavailable — deployed bundle version unknown.");
      } else {
        const res = await fetch(
          `https://${ref}.supabase.co/functions/v1/${PAYKIT_API_SLUG}?action=status`,
          {
            method: "POST",
            headers: {
              apikey: anonKey,
              Authorization: `Bearer ${anonKey}`,
              "Content-Type": "application/json",
            },
            body: "{}",
          },
        );
        const text = await res.text().catch(() => "");
        let payload: any = null;
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
        if (res.status === 200 || res.status === 201) {
          if (payload && typeof payload === "object") {
            const tv =
              typeof payload.templateVersion === "string" ? payload.templateVersion : null;
            apiFn.templateVersion = tv;
            const freshness =
              tv === null ? "stale" : compareTemplateVersion(tv, PAYKIT_TEMPLATE_VERSION);
            functionsStale = freshness === "stale" ? true : freshness === "current" ? false : null;
          } else {
            warnings.push("Deployed bundle version unreadable — treating as unknown.");
          }
        } else {
          warnings.push(`Deployed bundle version check failed (status ${res.status}).`);
        }
      }
    } catch (e: any) {
      warnings.push(`Deployed bundle version check failed: ${e.message}`);
    }
  }

  // secrets (presence only — values are masked server-side)
  const secretsPresent: Record<string, boolean> = {};
  for (const name of PAYKIT_REQUIRED_SECRETS) secretsPresent[name] = false;
  try {
    const { status, json } = await mgmt(token, `/v1/projects/${ref}/secrets`, {
      method: "GET",
    });
    if (status === 200 || status === 201) {
      const names = new Set(parseSecretNames(json));
      for (const name of PAYKIT_REQUIRED_SECRETS) {
        secretsPresent[name] = names.has(name);
      }
    } else {
      warnings.push(
        "Secrets list unavailable (token may lack secrets scope) — set secrets anyway; values are write-only.",
      );
    }
  } catch (e: any) {
    warnings.push(`Secrets list unavailable: ${e.message}`);
  }

  const tables = PAYKIT_TABLE_NAMES.map((table) => ({
    table,
    present: present.has(table),
    rlsEnabled: rls.has(table) ? (rls.get(table) as boolean) : null,
  }));

  // service_role grants (best-effort) — required on every present table.
  let grantsReady: boolean | null = null;
  try {
    const grantRows = await runMgmtQuery(token, ref, buildPaykitGrantsStatusQuery());
    const byTable = new Map<string, Set<string>>();
    for (const r of grantRows) {
      const name = String((r as any)?.table_name ?? "");
      const priv = String((r as any)?.privilege_type ?? "").toUpperCase();
      if (!name || !priv) continue;
      if (!byTable.has(name)) byTable.set(name, new Set());
      byTable.get(name)!.add(priv);
    }
    grantsReady = [...present].every((t) =>
      (PAYKIT_REQUIRED_PRIVILEGES as readonly string[]).every((p) => byTable.get(t)?.has(p)),
    );
  } catch {
    // Grants state unknown — leave null, don't block status.
  }

  // PostgREST exposure (best-effort) — the Edge Functions reach paykit.*
  // through the Data API with Accept-Profile/Content-Profile headers.
  let postgrestExposed: boolean | null = null;
  try {
    const { status: pgStatus, json } = await mgmt(token, `/v1/projects/${ref}/postgrest`, {
      method: "GET",
    });
    if (pgStatus === 200 || pgStatus === 201) {
      const dbSchema = json?.db_schema ?? json?.dbSchema ?? null;
      if (typeof dbSchema === "string") {
        postgrestExposed = dbSchema
          .split(",")
          .map((s: string) => s.trim())
          .includes(PAYKIT_SCHEMA);
      } else {
        warnings.push("Could not read PostgREST exposed schemas.");
      }
    } else {
      warnings.push("PostgREST config unavailable (token may lack config scope).");
    }
  } catch (e: any) {
    warnings.push(`PostgREST config unavailable: ${e.message}`);
  }

  const status: PaykitProjectStatus = {
    ref,
    tables,
    schemaExists,
    schemaReady: tables.every((t) => t.present),
    functions,
    secretsPresent,
    secretsReady: PAYKIT_REQUIRED_SECRETS.every((n) => secretsPresent[n]),
    webhookUrl: paykitWebhookUrl(ref),
    postgrestExposed,
    grantsReady,
    functionsStale,
    warnings,
  };
  return ok(status);
}

// ─── push-schema ────────────────────────────────────────────────────────

export async function pushPaykitSchema(body: any) {
  const token = checkToken(body?.token);
  const ref = checkRef(body?.ref);
  if (!token || !ref) return err("Missing Supabase token or project ref.");
  const phase: PaykitSchemaPhase =
    body?.phase === "schema" || body?.phase === "tables" ? body.phase : "all";
  const statements = getPaykitSchemaStatements(phase);

  let applied = 0;
  for (let i = 0; i < statements.length; i++) {
    try {
      await runMgmtQuery(token, ref, statements[i]);
      applied++;
    } catch (e: any) {
      return err(
        `Schema statement ${applied + 1}/${statements.length} (phase ${phase}) failed: ${e.message}`,
      );
    }
  }
  return ok({ applied, total: statements.length, phase });
}

// ─── repair ─────────────────────────────────────────────────────────────
// Fills gaps in an EXISTING setup without redeploying everything:
// missing RLS enables, missing service_role grants, missing PostgREST
// exposure. Absent tables are NOT created here — that is "Run setup".
// Everything applied is additive and idempotent.
export async function repairPaykitProject(body: any) {
  const token = checkToken(body?.token);
  const ref = checkRef(body?.ref);
  if (!token || !ref) return err("Missing Supabase token or project ref.");

  const before = await getPaykitStatus({ token, ref });
  if (!before.success) {
    return err(`Repair needs current project status: ${before.error}`);
  }
  const st = before.data;
  const warnings = [...st.warnings];
  const applied: string[] = [];
  const appliedNote = () =>
    applied.length > 0 ? ` Already applied: ${applied.join("; ")}.` : "";

  // 1. RLS on present tables that lack it.
  const missingRls = st.tables
    .filter((t) => t.present && t.rlsEnabled !== true)
    .map((t) => t.table);
  for (const t of missingRls) {
    try {
      await runMgmtQuery(token, ref, paykitRlsStatement(t));
      applied.push(`RLS enabled on paykit.${t}`);
    } catch (e: any) {
      return err(`Repair stopped enabling RLS on paykit.${t}: ${e.message}.${appliedNote()}`);
    }
  }

  // 2. service_role grants when known-missing.
  if (st.grantsReady === false) {
    try {
      for (const sql of PAYKIT_GRANT_STATEMENTS) {
        await runMgmtQuery(token, ref, sql);
      }
      applied.push("service_role grants restored");
    } catch (e: any) {
      return err(`Repair stopped restoring grants: ${e.message}.${appliedNote()}`);
    }
  } else if (st.grantsReady === null) {
    warnings.push("Grants state unreadable — grants left untouched.");
  }

  // 3. PostgREST exposure when known-missing.
  if (st.postgrestExposed === false) {
    const exposed = await exposePaykitSchema({ token, ref });
    if (!exposed.success) {
      return err(`Repair stopped: Data API exposure failed: ${exposed.error}.${appliedNote()}`);
    }
    applied.push("paykit schema exposed via Data API");
  }

  if (applied.length === 0) {
    return ok({ applied, warnings, alreadyOk: true as const, status: st });
  }

  const after = await getPaykitStatus({ token, ref });
  if (!after.success) {
    warnings.push(`Repaired, but status refresh failed: ${after.error}`);
    return ok({ applied, warnings, alreadyOk: false as const, status: st });
  }
  return ok({ applied, warnings, alreadyOk: false as const, status: after.data });
}

// ─── postgrest exposure ─────────────────────────────────────────────────
// The Edge Functions talk to paykit.* through the Data API, which requires
// the schema in PostgREST's exposed list. Fully automatic when the token
// has config scope; otherwise the UI falls back to Dashboard instructions.
export async function exposePaykitSchema(body: any) {
  const token = checkToken(body?.token);
  const ref = checkRef(body?.ref);
  if (!token || !ref) return err("Missing Supabase token or project ref.");

  const manualHint =
    `Fallback: Supabase Dashboard → Project Settings → Data API → Exposed schemas → add "${PAYKIT_SCHEMA}".`;

  let current: string | null = null;
  try {
    const { status, json, text } = await mgmt(token, `/v1/projects/${ref}/postgrest`, {
      method: "GET",
    });
    if (status !== 200 && status !== 201) {
      return err(mgmtError("Read PostgREST config", status, text) + ` ${manualHint}`);
    }
    current = typeof json?.db_schema === "string" ? json.db_schema : null;
  } catch (e: any) {
    return err(`Read PostgREST config failed: ${e.message} ${manualHint}`);
  }

  const merged = mergeExposedSchemas(current, PAYKIT_SCHEMA);
  if (merged === null) return ok({ exposed: true, via: "already" as const });

  try {
    const { status, text } = await mgmt(token, `/v1/projects/${ref}/postgrest`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ db_schema: merged }),
    });
    if (status !== 200 && status !== 201 && status !== 204) {
      return err(mgmtError("Update PostgREST config", status, text) + ` ${manualHint}`);
    }
  } catch (e: any) {
    return err(`Update PostgREST config failed: ${e.message} ${manualHint}`);
  }

  // Reload PostgREST config + schema cache without a project restart.
  for (const payload of ["reload config", "reload schema"]) {
    try {
      await runMgmtQuery(token, ref, `NOTIFY pgrst, '${payload}'`);
    } catch (e: any) {
      return err(
        `PostgREST config updated but reload failed: ${e.message} If the API still misses the "${PAYKIT_SCHEMA}" schema, restart the project from General Settings.`,
      );
    }
  }

  // Verify the schema stuck.
  try {
    const { status, json } = await mgmt(token, `/v1/projects/${ref}/postgrest`, {
      method: "GET",
    });
    const dbSchema = status === 200 || status === 201 ? json?.db_schema : null;
    const exposed =
      typeof dbSchema === "string" &&
      dbSchema.split(",").map((s: string) => s.trim()).includes(PAYKIT_SCHEMA);
    if (!exposed) {
      return err(
        `PostgREST config updated but "${PAYKIT_SCHEMA}" is not exposed yet. ${manualHint}`,
      );
    }
  } catch (e: any) {
    return err(`PostgREST verification failed: ${e.message} ${manualHint}`);
  }
  return ok({ exposed: true, via: "auto" as const });
}

// ─── sync products to Stripe ────────────────────────────────────────────
// Invokes the deployed paykit-api (?action=sync-products). Admin proof
// travels two ways: the service/secret key (apikey header, compared
// in-function) and the Management API token (x-rexadb-mgmt, validated live
// against api.supabase.com for this project). Either one passing authorizes
// sync — this survives masked/rotated/divergent key formats on either side.
// Creates/updates Stripe products + prices from the deployed PAYKIT_DATA
// bundle and fills paykit.product / paykit.product_feature.
export async function syncPaykitProducts(body: any) {
  const token = checkToken(body?.token);
  const ref = checkRef(body?.ref);
  if (!token || !ref) return err("Missing Supabase token or project ref.");

  // 1. API-key candidates via Management API (never logged, never stored).
  // New-format secrets often sit under other entry names while the function
  // environment holds exactly one of them — collect everything key-like.
  let keysJson: unknown = null;
  try {
    const { status, json, text } = await mgmt(token, `/v1/projects/${ref}/api-keys`, {
      method: "GET",
    });
    if (status !== 200 && status !== 201) {
      return err(mgmtError("Read project API keys", status, text));
    }
    keysJson = json;
  } catch (e: any) {
    return err(`Read project API keys failed: ${e.message}`);
  }
  // The mgmt token itself always travels too (owner-proof fallback in the
  // function), so an empty candidate list still gets one mgmt-only attempt.
  const candidates = collectCandidateKeys(keysJson);
  const attempts = candidates.length > 0 ? candidates : [""];

  // 2. try each candidate in turn. Only key-format-dependent 401s move on to
  // the next key: a legacy-plain 401 means the bundle itself is old (no key
  // will help), and any non-401 outcome is key-independent. Values the
  // runtime refuses to put on the wire (e.g. masked secrets) are skipped.
  let mismatchDetail: { reqLen: number; envLen: number } | null = null;
  for (const serviceKey of attempts) {
    let invoke: SyncInvokeRequest;
    try {
      invoke = buildSyncInvokeRequest(ref, serviceKey, token);
    } catch (e: any) {
      return err(e.message);
    }
    let res: Response;
    try {
      res = await fetch(invoke.url, {
        method: "POST",
        headers: invoke.headers,
        body: JSON.stringify(invoke.body),
      });
    } catch (e: any) {
      // Header-validation throws are per-value (masked secret) → next key.
      // Anything else is endpoint-wide → abort like before.
      if (/invalid (value|header)|bytestring/i.test(String(e?.message || ""))) {
        continue;
      }
      return err(`Sync request failed: ${(e as Error)?.message || e}`);
    }
    const text = await res.text().catch(() => res.statusText);
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    if (res.status === 200 || res.status === 201) {
      if (json && typeof json.error === "string" && json.error) {
        if (/STRIPE_SECRET_KEY/i.test(json.error)) {
          return err("Sync needs Stripe secrets — set them first, then sync again.");
        }
        return err(`Sync failed: ${json.error.slice(0, 300)}`);
      }
      const products = Array.isArray(json?.products) ? json.products : [];
      return ok({ products });
    }
    if (res.status === 404) {
      return err("paykit-api is not deployed yet — Run setup first, then sync.");
    }
    if (res.status !== 401) {
      return err(`Sync failed (${res.status}): ${String(json?.error ?? text).slice(0, 300)}`);
    }
    const kind = classifySyncAuthFailure(json);
    if (kind === "stale" || kind === "no-service-key-env") {
      return err(syncAuthFailureMessage(kind));
    }
    if (kind === "env-mismatch") {
      const d = (json as any)?.detail;
      if (
        !mismatchDetail &&
        d &&
        typeof d.reqLen === "number" &&
        typeof d.envLen === "number"
      ) {
        mismatchDetail = { reqLen: d.reqLen, envLen: d.envLen };
      }
      continue;
    }
    continue;
  }

  // Every candidate 401'd with a key-dependent outcome (env mismatch and/or
  // gateway rejection): no key format on this project matches the function.
  if (mismatchDetail) {
    return err(
      `${ENV_MISMATCH_MESSAGE} (sent ${mismatchDetail.reqLen} chars, function holds ${mismatchDetail.envLen} chars)`,
    );
  }
  return err(syncAuthFailureMessage("gateway"));
}

// ─── deploy ─────────────────────────────────────────────────────────────

function toTemplateData(drafts: PaykitDraftState) {
  return {
    hash: hashPaykitDrafts(drafts),
    schemaVersion: PAYKIT_SCHEMA_VERSION,
    features: drafts.features.map((f) => ({ id: f.id, type: f.type, description: f.description ?? null })),
    plans: drafts.plans.map((p) => ({
      id: p.id,
      name: p.name,
      group: p.group || "base",
      default: p.default,
      priceAmount: p.priceAmount ?? null,
      priceInterval: p.priceInterval ?? null,
      priceCurrency: p.priceCurrency ?? null,
      includes: p.includes.map((inc) => ({
        featureId: inc.featureId,
        limit: inc.limit ?? null,
        reset: inc.reset ?? null,
      })),
    })),
  };
}

async function deployOneFunction(
  token: string,
  ref: string,
  slug: string,
  name: string,
  source: string,
  verifyJwt: boolean,
): Promise<{ deployed: boolean; verifyJwt: boolean | null; error?: string }> {
  const form = new FormData();
  form.append(
    "metadata",
    JSON.stringify({ entrypoint_path: "index.ts", name }),
  );
  form.append(
    "file",
    new Blob([source], { type: "application/typescript" }),
    "index.ts",
  );
  const deploy = await mgmt(
    token,
    `/v1/projects/${ref}/functions/deploy?slug=${encodeURIComponent(slug)}`,
    { method: "POST", body: form as any },
  );
  if (deploy.status !== 200 && deploy.status !== 201) {
    return {
      deployed: false,
      verifyJwt: null,
      error: mgmtError(`Deploy ${slug}`, deploy.status, deploy.text),
    };
  }

  // Equivalent of `--no-verify-jwt`: the flag goes in BOTH the query string
  // and the JSON body — the endpoint has silently ignored query-only
  // updates before, which left gateway verification on.
  const flag = verifyJwt ? "true" : "false";
  const wantFlag = verifyJwt;
  for (let attempt = 0; attempt < 2; attempt++) {
    const patch = await mgmt(
      token,
      `/v1/projects/${ref}/functions/${encodeURIComponent(slug)}?verify_jwt=${flag}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verify_jwt: wantFlag }),
      },
    );
    if (patch.status !== 200 && patch.status !== 201 && patch.status !== 204) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      return {
        deployed: true,
        verifyJwt: null,
        error:
          `Deployed ${slug} but verify_jwt=${flag} could not be confirmed (${patch.status}). ` +
          `Set it manually: supabase functions deploy ${slug} --project-ref ${ref} ` +
          (verifyJwt ? "" : "--no-verify-jwt"),
      };
    }
    // Confirm the flag actually landed — a 2xx alone doesn't prove it.
    try {
      const { status: listStatus, json: listJson } = await mgmt(
        token,
        `/v1/projects/${ref}/functions`,
        { method: "GET" },
      );
      if (listStatus === 200 || listStatus === 201) {
        const found = parseFunctionsList(listJson).find(
          (f: any) => (f?.slug ?? f?.name) === slug,
        );
        const actual = found?.verify_jwt;
        if (actual === undefined) {
          // Field absent — trust the PATCH, status check will re-read it.
          return { deployed: true, verifyJwt };
        }
        if (Boolean(actual) === wantFlag) {
          return { deployed: true, verifyJwt };
        }
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        return {
          deployed: true,
          verifyJwt: null,
          error:
            `Deployed ${slug} but gateway verification stayed ${actual ? "on" : "off"} (wanted ${wantFlag ? "on" : "off"}). ` +
            `Flip it manually: Supabase Dashboard → Edge Functions → ${slug} → disable JWT verification` +
            (verifyJwt ? ", or redeploy without --no-verify-jwt." : "."),
        };
      }
    } catch {
      // Confirmation read failed — trust the PATCH, status check re-reads it.
      return { deployed: true, verifyJwt };
    }
    if (attempt === 0) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    return { deployed: true, verifyJwt: null };
  }
  return { deployed: true, verifyJwt: null };
}

export async function deployPaykitFunctions(body: any) {
  const token = checkToken(body?.token);
  const ref = checkRef(body?.ref);
  const drafts = body?.drafts as PaykitDraftState | undefined;
  if (!token || !ref) return err("Missing Supabase token or project ref.");
  if (!drafts || drafts.version !== 1 || !Array.isArray(drafts.plans)) {
    return err("Missing plan drafts.");
  }
  const normalized: PaykitDraftState = {
    version: 1,
    features: Array.isArray(drafts.features) ? drafts.features : [],
    plans: drafts.plans,
    updatedAt: typeof drafts.updatedAt === "number" ? drafts.updatedAt : Date.now(),
  };
  const errors = validateDrafts(normalized);
  if (errors.length > 0) {
    return err(`Fix plan errors first: ${errors.slice(0, 3).join(" ")}`);
  }

  const data = toTemplateData(normalized);
  const sources = new Map([
    ["paykit-webhook", buildWebhookSource(data)],
    ["paykit-api", buildApiSource(data)],
  ]);
  const results: Array<{
    slug: string;
    deployed: boolean;
    verifyJwt: boolean | null;
    error?: string;
  }> = [];
  for (const spec of PAYKIT_FUNCTIONS) {
    const built = sources.get(spec.slug)!;
    const res = await deployOneFunction(
      token,
      ref,
      spec.slug,
      spec.name,
      built.source,
      spec.verifyJwt,
    );
    results.push({ slug: spec.slug, ...res });
  }
  return ok({ results });
}

// ─── secrets ────────────────────────────────────────────────────────────

const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

export async function setPaykitSecrets(body: any) {
  const token = checkToken(body?.token);
  const ref = checkRef(body?.ref);
  const secrets = body?.secrets as Record<string, string> | undefined;
  if (!token || !ref) return err("Missing Supabase token or project ref.");
  if (!secrets || typeof secrets !== "object" || Object.keys(secrets).length === 0) {
    return err("No secrets provided.");
  }

  const entries: Array<{ name: string; value: string }> = [];
  for (const [name, value] of Object.entries(secrets)) {
    if (!SECRET_NAME_RE.test(name)) return err(`Invalid secret name: ${name}`);
    if (typeof value !== "string" || value.length === 0 || value.length > 20000) {
      return err(`Invalid value for secret: ${name}`);
    }
    entries.push({ name, value });
  }
  if (entries.length > 20) return err("Too many secrets in one request.");

  const { status, text } = await mgmt(token, `/v1/projects/${ref}/secrets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entries),
  });
  if (status !== 200 && status !== 201 && status !== 204) {
    return err(
      mgmtError("Set secrets", status, text) +
        " — fallback: supabase secrets set --project-ref " +
        ref +
        " " +
        entries.map((e) => e.name).join(" "),
    );
  }
  return ok({ requested: entries.map((e) => e.name) });
}
