# Effect conventions (RexaDB sidecar)

RexaDB’s local Express server and the `lib/` modules it reaches are migrating to [Effect v4](https://effect.website/docs/v4/onboarding). This doc is the style guide for that work.

## Scope

- **In scope:** `server/` and server-reachable `lib/` — core Effect only (`Effect.gen`, tagged errors, `try` / `tryPromise`, structured concurrency).
- **Out of scope for now:** `@effect/platform-http`, Effect Schema, Effect Config, rewriting React UI to run Effects.

## Layout

| Path | Role |
|------|------|
| `server/effect/errors.ts` | Shared `Data.TaggedError` types |
| `server/effect/http.ts` | Express adapters (`effectHandler`, `simplePostRoute`, …) |
| `server/effect/proxy.ts` | Upstream HTTP proxy helpers (`effectProxyHandler`, `fetchUpstreamEffect`, …) |
| `server/effect/billing-errors.ts` | Tagged errors for PayKit + Stripe (`ValidationError`, `UpstreamError`, `StripeError`, `PaykitError`) |
| `server/effect/runtime.ts` | `runPromise` / `runPromiseExit` + defect logging |
| `docs/effect.md` | This guide |

## Rules

1. **Programs as values** — domain functions return `Effect<A, E, R>` (usually `R = never`).
2. **Compose with generators** — prefer `Effect.gen(function* () { … })`.
3. **Expected vs unexpected**
   - Expected: `Effect.fail(new SomeTaggedError({ message }))`.
   - Unexpected: leave as defects, or remap with `Effect.try` / `Effect.tryPromise` `{ catch }`.
4. **Run only at the edge** — call `Effect.runPromise` / `runServerPromiseExit` inside Express adapters or tests. Do not nest `runPromise` inside domain logic.
5. **Dual-use `lib/`** — if the UI still imports a module, keep a Promise facade:

   ```ts
   export const fooEffect = (...): Effect.Effect<A, E> => …
   export const foo = (...): Promise<A> => Effect.runPromise(fooEffect(...))
   ```

6. **Stable JSON** — map failures through `effectHandler` so the UI keeps `{ success: false, error: string }` (and existing status codes). Prefer returning the envelope in the success channel when legacy routes already did that (e.g. transfer clash).
7. **Static imports of Effect** — `import { Effect, Data } from "effect"`. Required for `bun build --compile` packaging of the sidecar binary.

## Adapters

Wave 1 moved the common Express factories onto Effect:

- `simpleGetRoute` / `simplePostRoute` / `studioGetRoute` / `studioPostRoute`
- `dynamicPostRoute(loadModule, fn)` — import callback at the call site
- `proxyBodyRoute(tryProxyDbOp, fn)` — workspace DB proxy short-circuit, then Effect

Thin JSON routes (connections, neon-cli list APIs, SQL/schema via proxy helpers, settings) should use these. Leave SSE/streaming and upstream HTTP proxies for later waves.

```ts
import { Effect } from "effect"
import { effectHandler, simplePostRoute, fromPromise, proxyBodyRoute } from "./effect"

app.get("/health", effectHandler(() => Effect.succeed({ status: "ok", port })))

// Bridge existing Promise APIs during Wave 1:
app.post("/api/x", simplePostRoute((body) => mod.somePromiseApi(body)))

app.get(
  "/api/y",
  effectHandler(() =>
    fromPromise(() => mod.listThings()).pipe(
      Effect.map((things) => ({ success: true, things })),
    ),
  ),
)

// dynamicPostRoute takes an import callback so relative paths resolve at the
// call site (server/index.ts), not inside server/effect/http.ts:
app.post(
  "/api/search-index/query",
  dynamicPostRoute(
    () => import("../lib/db/search-index-actions"),
    (body, m) => m.searchLocalIndex(body.connectionString, body.term),
  ),
)
```

`effectHandler` builds the program inside `Effect.suspend` and catches synchronous throws from `programFromReq`, so a callback that throws while constructing its Effect still returns `{ success: false, error }` instead of leaving the Express request hanging.

## Tagged errors

Use the shared set in `server/effect/errors.ts` (`ValidationError`, `HttpError`, `DbError`, `UpstreamError`, `NotFoundError`) or add a domain-specific tagged error next to the module when the shared set is too coarse.

`statusForError` maps tags to HTTP status; plain `Error` defaults to **200** to match most historical sidecar routes that returned `{ success: false }` without changing the status code. Pass `fallbackStatus: 500` (or set `status` on the tagged error) when a route historically used another code.

## Migration waves

See the Effect migration plan. Foundation + route adapters land first; domain `lib/` conversion follows transfer → neon-cli → credentials → proxies → agents → the rest of `actions-core`.

### Transfer domain (Wave 2)

| API | Notes |
|-----|--------|
| `lib/transfer/errors.ts` | `TransferAdapterError`, `TransferValidationError`, `TransferFailedError` |
| `TransferService.transferProjectEffect` | Expected failures stay in `TransferResult` (`success: false`) |
| `TransferService.exportPackageEffect` / `importPackageEffect` | Missing adapter → tagged error |
| `createTransferServiceEffect` | Adapter load failures logged and skipped |
| `server/transfer-api.ts` | Background job via `Effect.runFork(executeTransferEffect…)` |

Promise facades (`transferProject`, `createTransferService`, …) remain for tests and any dual-use callers.

### Neon CLI domain (Wave 3)

| API | Notes |
|-----|--------|
| `lib/neon-cli/errors.ts` | Browser-safe message constants only (no Effect import) |
| `lib/neon-cli/effect-errors.ts` | Tagged `NeonSessionExpiredError`, `NeonAuthUnavailableError`, `NeonAuthCancelledError`, `NeonApiError` + `toNeonCliError` |
| `lib/neon-cli/cli-runner.ts` | `*Effect` variants for detect, lists, auth-status, profile remove, connection string, login |
| Browser `lib/neon-cli/client.ts` | Stays Promise/HTTP — do not import Effect there |

SSE `/api/neon-cli/login` still owns the event-stream; it runs `runNeonAuthLoginEffect` via `Effect.runPromise` and maps tagged errors with `.message`.

### Credentials / vault domain (Wave 4)

| API | Notes |
|-----|--------|
| `lib/credentials/effect-errors.ts` | `CredentialValidationError`, `VaultConfigError`, `CredentialCacheError`, `KeychainError` |
| `lib/credentials/connection-credential-cache.ts` | Effect-first in-memory cache; sync facades via `Effect.runSync` |
| `lib/credentials/credential-cache-effects.ts` | Validated `putCredentialCacheEntryEffect` / `lockCredentialCacheEffect` |
| `lib/credentials/vault-config-effects.ts` | `fromVaultConfigPromise` / `fromVaultMigrationPromise` |
| UI modules (`local-vault`, `connection-credentials`) | Stay Promise/browser-safe — do not import Effect there |

### Upstream HTTP proxies (Wave 5)

| API | Notes |
|-----|--------|
| `server/effect/proxy.ts` | `effectProxyHandler`, `fetchUpstreamEffect`, `readUpstreamTextEffect`, `readUpstreamBufferEffect`, `proxiedPayloadResult` |
| `UpstreamError` | Tagged error for network/upstream failures (502) |
| Proxy routes | Supabase mgmt, PlanetScale, SpacetimeDB, Studio proxy wired through `effectProxyHandler` |
| Binary support | Buffers forwarded with correct `Content-Type` header |
| JSON fallback | `proxiedPayloadResult` parses JSON when possible, falls back to text (matches historical behavior) |

### PayKit + Stripe billing (Wave 6)

| API | Notes |
|-----|--------|
| `server/effect/billing-errors.ts` | Tagged `StripeError`, `PaykitError` (reuses `ValidationError` and `UpstreamError` from `errors.ts`) |
| `server/stripe.ts` | `createStripeWebhookEndpointEffect` with full validation, network failures → `UpstreamError`, JSON parse failures → `StripeError`, Promise facade kept |
| `server/supabase-paykit.ts` | Effect variants for all PayKit operations — pragmatic wrappers with `mapPaykitResult` that distinguishes input validation (`ValidationError`) from provider failures (`PaykitError`) |
| Billing routes | All PayKit and Stripe routes wired through `effectJsonHandler` to wrap bare data in `{ success, data }` |
| Promise facades | Original Promise functions kept for any direct callers |

### MCP server (Wave 7)

| API | Notes |
|-----|--------|
| `server/effect/mcp-errors.ts` | Tagged `McpDisabledError`, `McpConfigError`, `McpRequestError` |
| `server/effect/mcp-config.ts` | Effect APIs for config load/save, token management, audit log, custom mode CRUD |
| `server/effect/mcp-http.ts` | `handleMcpHttpRequestEffect` for MCP HTTP endpoint validation and auth |
| MCP routes | Config GET/PUT, token regenerate/reveal, audit-log, modes CRUD, HTTP endpoint all wired through Effect |
| Streaming `/mcp` | Uses Effect for validation but delegates to `handleMcpHttpRequest` for response writing |
| Promise facades | Original `loadMcpExternalConfig`, `saveMcpExternalConfig` kept for direct callers |

### Agent provider discovery (Wave 8)

`server/agents-api.ts` runs provider detection and model-list routes as Effects while preserving the existing stale-while-revalidate cache behavior and response shapes. The provider cache, local CLI probes, and UI-facing Promise APIs remain behind the adapter boundary. Streaming agent routes stay at the Express edge because they own SSE and subprocess lifecycles.

### Studio persistence from actions-core (Wave 9)

`server/studio-storage-api.ts` exposes Effect programs for Studio folders, snippets, query history, tags, tabs, settings, dashboards, and notes. The sidecar routes use those programs and map rejected storage operations to `DbError`; the Promise APIs in `lib/db/actions-core.ts` remain available to UI and other existing callers.

### App settings and migration (Wave 10)

`server/app-settings-api.ts` exposes typed Effect programs for global app font/theme/editor/Studio settings and legacy settings migration. The existing actions-core Promise functions remain the compatibility facade; sidecar settings routes preserve their current JSON response shapes.

### User data and analytics (Wave 11)

`server/user-data-api.ts` exposes typed Effect programs for user profile operations, application error logging, and user/connection analytics. Sidecar routes retain the `actions-core` Promise facade for non-server callers; rejected storage operations enter the Effect error channel as `DbError`.

### AI settings and chat persistence (Wave 12)

`server/ai-storage-api.ts` exposes typed Effect programs for global AI settings, chat listing/message reads, and persisted message actions. The server routes preserve the existing action names and response values, while the Promise APIs remain available to other callers.

### SQL execution and schema browsing (Wave 13)

`server/database-actions-api.ts` exposes typed Effect programs for query execution/cancellation, schema and table browsing, database listing, referenced records, and table row mutations. Routes keep workspace connection interception in `proxyBodyRoute`; non-workspace actions run through the Effect facade.

### Remaining actions-core and server routes (Wave 14)

`server/database-metadata-api.ts` wraps database metadata, sessions, advisor, explain-plan, backup, and Redis-key actions. `server/connection-actions-api.ts` wraps connection CRUD, groups, ordering, workspace IDs, and connection testing. `server/actions-core-api.ts` wraps entitlement persistence, AI chat deletion, snippet versions, Studio bootstrap, and snapshot operations. Routes use these Effects while retaining their established response envelopes and generic action names. The streamed snapshot and agent/workflow execution routes remain at the Express edge because they own streams or long-lived execution.
