/**
 * Effect helpers for upstream HTTP proxies (Wave 5).
 * Proxies relay status + body from an upstream host; failures become
 * UpstreamError / ValidationError with the historical JSON envelopes.
 */
import type { Request, Response, RequestHandler } from "express";
import { Effect, Exit } from "effect";
import {
  UpstreamError,
  ValidationError,
  messageForError,
  statusForError,
  type ServerError,
} from "./errors";
import {
  failureFromExit,
  logExitDefects,
  runServerPromiseExit,
} from "./runtime";

export type ProxyResult =
  | { kind: "json"; status: number; body: unknown }
  | { kind: "text"; status: number; body: string }
  | { kind: "binary"; status: number; body: Buffer; contentType: string };

export type ProxyErrorEnvelope = {
  status: number;
  body: Record<string, unknown>;
};

/** Fetch an upstream URL; network failures → UpstreamError (502). */
export const fetchUpstreamEffect = (
  url: string,
  init?: RequestInit,
): Effect.Effect<globalThis.Response, UpstreamError> =>
  Effect.tryPromise({
    try: () => fetch(url, init),
    catch: (cause) =>
      new UpstreamError({
        message:
          cause instanceof Error ? cause.message : "Upstream request failed",
        status: 502,
      }),
  });

/** Read upstream body as text. */
export const readUpstreamTextEffect = (
  upstream: globalThis.Response,
): Effect.Effect<string, UpstreamError> =>
  Effect.tryPromise({
    try: () => upstream.text(),
    catch: (cause) =>
      new UpstreamError({
        message:
          cause instanceof Error
            ? cause.message
            : "Failed to read upstream response",
        status: 502,
      }),
  });

/** Read upstream body as ArrayBuffer → Buffer. */
export const readUpstreamBufferEffect = (
  upstream: globalThis.Response,
): Effect.Effect<Buffer, UpstreamError> =>
  Effect.tryPromise({
    try: async () => Buffer.from(await upstream.arrayBuffer()),
    catch: (cause) =>
      new UpstreamError({
        message:
          cause instanceof Error
            ? cause.message
            : "Failed to read upstream response",
        status: 502,
      }),
  });

/**
 * Parse upstream text as JSON when possible, otherwise return raw text —
 * matches the historical `forwardProxiedResponse` behavior.
 */
export function proxiedPayloadResult(
  status: number,
  text: string,
): ProxyResult {
  try {
    return { kind: "json", status, body: JSON.parse(text) };
  } catch {
    return { kind: "text", status, body: text };
  }
}

function writeProxyResult(res: Response, result: ProxyResult): void {
  if (result.kind === "json") {
    res.status(result.status).json(result.body);
    return;
  }
  if (result.kind === "binary") {
    res
      .status(result.status)
      .set("Content-Type", result.contentType || "application/octet-stream")
      .send(result.body);
    return;
  }
  res.status(result.status).send(result.body);
}

export type EffectProxyOptions = {
  /** Build the error JSON body. Default: `{ success: false, error }`. */
  errorBody?: (
    error: unknown,
    req: Request,
  ) => Record<string, unknown>;
  /** Override status mapping. Default: statusForError(..., 502). */
  errorStatus?: (error: unknown) => number;
};

/**
 * Run a proxy Effect and write ProxyResult / tagged-error JSON to Express.
 * Sync throws while building the program are caught (same as effectHandler).
 */
export function effectProxyHandler(
  programFromReq: (
    req: Request,
  ) => Effect.Effect<ProxyResult, ServerError | Error>,
  options?: EffectProxyOptions,
): RequestHandler {
  const errorStatus =
    options?.errorStatus ?? ((error: unknown) => statusForError(error, 502));
  const errorBody =
    options?.errorBody ??
    ((error: unknown) => ({
      success: false,
      error: messageForError(error),
    }));

  return async (req, res) => {
    const exit = await runServerPromiseExit(
      Effect.suspend(() => {
        try {
          return programFromReq(req);
        } catch (cause) {
          return Effect.fail(
            cause instanceof Error ? cause : new Error(String(cause)),
          );
        }
      }),
    );
    if (Exit.isSuccess(exit)) {
      writeProxyResult(res, exit.value);
      return;
    }
    logExitDefects(exit);
    const error = failureFromExit(exit);
    res.status(errorStatus(error)).json(errorBody(error, req));
  };
}

export { UpstreamError, ValidationError };
