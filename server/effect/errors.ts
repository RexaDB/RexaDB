/**
 * Shared tagged errors for the RexaDB sidecar.
 * Domain failures live in the Effect error channel; bugs stay defects.
 */
import { Data } from "effect";

/** Invalid request input (missing fields, bad shape). */
export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string;
  readonly status?: number;
}> {}

/** Generic HTTP-boundary failure with an explicit status code. */
export class HttpError extends Data.TaggedError("HttpError")<{
  readonly message: string;
  readonly status: number;
}> {}

/** Local SQLite / actions-core / DB operation failure. */
export class DbError extends Data.TaggedError("DbError")<{
  readonly message: string;
  readonly status?: number;
}> {}

/** Upstream HTTP / CLI / provider proxy failure. */
export class UpstreamError extends Data.TaggedError("UpstreamError")<{
  readonly message: string;
  readonly status?: number;
}> {}

/** Missing resource (connection, transfer job, etc.). */
export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly message: string;
  readonly status?: number;
}> {}

export type ServerError =
  | ValidationError
  | HttpError
  | DbError
  | UpstreamError
  | NotFoundError;

/** True when value looks like one of our tagged server errors. */
export function isTaggedServerError(
  error: unknown,
): error is ServerError & { readonly _tag: string; readonly message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string" &&
    typeof (error as { _tag: unknown })._tag === "string"
  );
}

/** Map a tagged (or unknown) failure to HTTP status. Defaults preserve legacy 200+JSON for plain errors. */
export function statusForError(
  error: unknown,
  fallbackStatus = 200,
): number {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }
  if (isTaggedServerError(error)) {
    switch (error._tag) {
      case "ValidationError":
        return 400;
      case "NotFoundError":
        return 404;
      case "UpstreamError":
        return 502;
      case "HttpError":
        return (error as HttpError).status;
      default:
        return fallbackStatus;
    }
  }
  return fallbackStatus;
}

export function messageForError(error: unknown): string {
  if (isTaggedServerError(error)) return error.message;
  if (error instanceof Error) return error.message;
  return String(error ?? "Unknown error");
}
