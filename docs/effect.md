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

```ts
import { Effect } from "effect"
import { effectHandler, simplePostRoute, fromPromise } from "./effect"

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
```

## Tagged errors

Use the shared set in `server/effect/errors.ts` (`ValidationError`, `HttpError`, `DbError`, `UpstreamError`, `NotFoundError`) or add a domain-specific tagged error next to the module when the shared set is too coarse.

`statusForError` maps tags to HTTP status; plain `Error` defaults to **200** to match most historical sidecar routes that returned `{ success: false }` without changing the status code. Pass `fallbackStatus: 500` (or set `status` on the tagged error) when a route historically used another code.

## Migration waves

See the Effect migration plan. Foundation + route adapters land first; domain `lib/` conversion follows transfer → neon-cli → credentials → proxies → agents → the rest of `actions-core`.
