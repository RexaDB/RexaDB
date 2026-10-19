/**
 * Express adapters that run Effects at the HTTP edge and preserve the
 * legacy `{ success, error }` JSON contract used by the Studio UI.
 */
import type { Request, Response, RequestHandler } from "express";
import { Effect, Exit } from "effect";
import {
  messageForError,
  statusForError,
  type ServerError,
} from "./errors";
import {
  failureFromExit,
  logExitDefects,
  runServerPromiseExit,
} from "./runtime";

export type EffectFromRequest<A, E = ServerError> = (
  req: Request,
) => Effect.Effect<A, E>;

export type JsonEnvelope = {
  success: boolean;
  error?: string;
  [key: string]: unknown;
};

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then: unknown }).then === "function"
  );
}

/** Lift a Promise-returning fn into an Effect (Wave 1 bridge for actions-core). */
export function fromPromise<A>(
  evaluate: () => PromiseLike<A>,
  onError?: (cause: unknown) => ServerError | Error,
): Effect.Effect<A, ServerError | Error> {
  return Effect.tryPromise({
    try: () => Promise.resolve(evaluate()),
    catch: (cause) =>
      onError
        ? onError(cause)
        : cause instanceof Error
          ? cause
          : new Error(String(cause)),
  });
}

/**
 * Run an Effect and write JSON. On failure, respond with
 * `{ success: false, error }` using statusForError (default 200 to match
 * most existing sidecar routes).
 *
 * Construction of the Effect is deferred into `Effect.suspend` so a
 * synchronously throwing `programFromReq` becomes a typed failure (JSON
 * error) instead of an unhandled Express async rejection.
 */
export function effectHandler<A, E = ServerError>(
  programFromReq: EffectFromRequest<A, E>,
  options?: {
    /** HTTP status for untyped / plain Error failures. Default 200. */
    fallbackStatus?: number;
    /** Map a successful value before res.json. Default: identity. */
    onSuccess?: (value: A, req: Request, res: Response) => void;
  },
): RequestHandler {
  const fallbackStatus = options?.fallbackStatus ?? 200;
  return async (req, res) => {
    const exit = await runServerPromiseExit(
      Effect.suspend(() => {
        try {
          return programFromReq(req) as Effect.Effect<A, E | Error>;
        } catch (cause) {
          return Effect.fail(
            cause instanceof Error ? cause : new Error(String(cause)),
          ) as Effect.Effect<A, E | Error>;
        }
      }),
    );
    if (Exit.isSuccess(exit)) {
      if (options?.onSuccess) {
        options.onSuccess(exit.value, req, res);
      } else {
        res.json(exit.value);
      }
      return;
    }
    logExitDefects(exit);
    const error = failureFromExit(exit);
    const status = statusForError(error, fallbackStatus);
    res.status(status).json({
      success: false,
      error: messageForError(error),
    } satisfies JsonEnvelope);
  };
}

/**
 * Like effectHandler, but wraps a bare success value as `{ success: true, ... }`.
 * If the Effect already returns an object with `success`, it is sent as-is.
 */
export function effectJsonHandler<A, E = ServerError>(
  programFromReq: EffectFromRequest<A, E>,
  options?: { fallbackStatus?: number },
): RequestHandler {
  return effectHandler(programFromReq, {
    fallbackStatus: options?.fallbackStatus ?? 200,
    onSuccess: (value, _req, res) => {
      if (
        typeof value === "object" &&
        value !== null &&
        "success" in (value as object)
      ) {
        res.json(value);
        return;
      }
      res.json({ success: true, data: value });
    },
  });
}

function liftCallbackResult(
  result: Effect.Effect<any, any> | PromiseLike<any> | any,
): Effect.Effect<any, any> {
  if (Effect.isEffect(result)) return result;
  if (isPromiseLike(result)) return fromPromise(() => result);
  return Effect.succeed(result);
}

/**
 * Drop-in replacement for simplePostRoute: accepts either an Effect or a Promise.
 * Prefer returning Effect from new code.
 *
 * `fn` runs inside the Effect runtime (via effectHandler + suspend), so a
 * synchronous throw becomes a JSON `{ success: false, error }` response.
 */
export function simplePostRoute(
  fn: (
    body: any,
  ) => Effect.Effect<any, any> | PromiseLike<any> | any,
): RequestHandler {
  return effectHandler((req) => liftCallbackResult(fn(req.body)));
}

/** GET (or any method) with a zero-arg Promise/Effect callback. */
export function simpleGetRoute(
  fn: () => Effect.Effect<any, any> | PromiseLike<any> | any,
): RequestHandler {
  return effectHandler(() => liftCallbackResult(fn()));
}

/** Route that passes `Number(req.params.connectionId)` into a Promise/Effect fn. */
export function studioGetRoute(
  fn: (id: number) => Effect.Effect<any, any> | PromiseLike<any> | any,
): RequestHandler {
  return effectHandler((req) =>
    liftCallbackResult(fn(Number(req.params.connectionId))),
  );
}

/** Route that passes connectionId + body into a Promise/Effect fn. */
export function studioPostRoute(
  fn: (
    id: number,
    body: any,
  ) => Effect.Effect<any, any> | PromiseLike<any> | any,
): RequestHandler {
  return effectHandler((req) =>
    liftCallbackResult(fn(Number(req.params.connectionId), req.body)),
  );
}

/**
 * Drop-in replacement for dynamicPostRoute with the same Promise/Effect bridge.
 *
 * Pass an import callback defined at the call site (e.g. in `server/index.ts`)
 * so relative module paths resolve from that file — not from this helper:
 *
 *   dynamicPostRoute(() => import("../lib/db/search-index-actions"), …)
 *
 * Keep the `import("…")` string literal static for `bun build --compile`.
 */
export function dynamicPostRoute(
  loadModule: () => PromiseLike<any>,
  fn: (
    body: any,
    mod: any,
  ) => Effect.Effect<any, any> | PromiseLike<any> | any,
): RequestHandler {
  return effectHandler((req) =>
    Effect.gen(function* () {
      const m = yield* fromPromise(() => loadModule());
      let result: Effect.Effect<any, any> | PromiseLike<any> | any;
      try {
        result = fn(req.body, m);
      } catch (cause) {
        return yield* Effect.fail(
          cause instanceof Error ? cause : new Error(String(cause)),
        );
      }
      return yield* liftCallbackResult(result);
    }),
  );
}

/**
 * Build a POST handler that optionally short-circuits through a workspace DB
 * proxy (`tryProxy`), then runs `fn` as an Effect/Promise.
 *
 * `tryProxy` should write the response and return true when it handled the
 * request (same contract as `tryProxyDbOp` in server/index.ts).
 */
export function proxyBodyRoute(
  tryProxy: (req: Request, res: Response) => Promise<boolean>,
  fn: (req: Request) => Effect.Effect<any, any> | PromiseLike<any> | any,
): RequestHandler {
  const run = effectHandler((req) => liftCallbackResult(fn(req)));
  return async (req, res, next) => {
    try {
      if (await tryProxy(req, res)) return;
    } catch (cause) {
      res.json({
        success: false,
        error: cause instanceof Error ? cause.message : String(cause),
      });
      return;
    }
    return run(req, res, next);
  };
}
