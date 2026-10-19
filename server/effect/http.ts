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
    const exit = await runServerPromiseExit(programFromReq(req));
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

/**
 * Drop-in replacement for simplePostRoute: accepts either an Effect or a Promise.
 * Prefer returning Effect from new code.
 */
export function simplePostRoute(
  fn: (
    body: any,
  ) => Effect.Effect<any, any> | PromiseLike<any> | any,
): RequestHandler {
  return effectHandler((req) => {
    const result = fn(req.body);
    if (Effect.isEffect(result)) return result;
    if (isPromiseLike(result)) return fromPromise(() => result);
    return Effect.succeed(result);
  });
}

/**
 * Drop-in replacement for dynamicPostRoute with the same Promise/Effect bridge.
 * Keep importPath static string literals for bun build --compile.
 */
export function dynamicPostRoute(
  importPath: string,
  fn: (
    body: any,
    mod: any,
  ) => Effect.Effect<any, any> | PromiseLike<any> | any,
): RequestHandler {
  return effectHandler((req) =>
    Effect.gen(function* () {
      const m = yield* fromPromise(() => import(importPath));
      const result = fn(req.body, m);
      if (Effect.isEffect(result)) return yield* result;
      if (isPromiseLike(result)) return yield* fromPromise(() => result);
      return result;
    }),
  );
}
