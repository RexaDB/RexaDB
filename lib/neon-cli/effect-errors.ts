/**
 * Effect tagged errors for the Neon CLI / OAuth domain (Wave 3).
 * Message constants stay in `./errors` so the browser UI can import them
 * without pulling Effect into the client bundle.
 */
import { Data } from "effect";
import {
  NEON_AUTH_UNAVAILABLE_MESSAGE,
  NEON_SESSION_EXPIRED_MESSAGE,
  isNeonAuthUnavailableError,
  isNeonSessionExpiredError,
} from "./errors";

/** Stored Neon OAuth session is dead; UI should offer Reconnect. */
export class NeonSessionExpiredError extends Data.TaggedError(
  "NeonSessionExpiredError",
)<{
  readonly message: string;
}> {}

/** Transient reachability problem; session itself is still valid. */
export class NeonAuthUnavailableError extends Data.TaggedError(
  "NeonAuthUnavailableError",
)<{
  readonly message: string;
}> {}

/** User cancelled interactive OAuth (abort / close dialog). */
export class NeonAuthCancelledError extends Data.TaggedError(
  "NeonAuthCancelledError",
)<{
  readonly message: string;
}> {}

/** Generic Neon Management API / OAuth failure. */
export class NeonApiError extends Data.TaggedError("NeonApiError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type NeonCliError =
  | NeonSessionExpiredError
  | NeonAuthUnavailableError
  | NeonAuthCancelledError
  | NeonApiError;

/** Map a thrown Error (or unknown) into a tagged NeonCliError. */
export function toNeonCliError(cause: unknown): NeonCliError {
  const message =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : String(cause ?? "Neon request failed");
  if (isNeonSessionExpiredError(message)) {
    return new NeonSessionExpiredError({
      message: message || NEON_SESSION_EXPIRED_MESSAGE,
    });
  }
  if (isNeonAuthUnavailableError(message)) {
    return new NeonAuthUnavailableError({
      message: message || NEON_AUTH_UNAVAILABLE_MESSAGE,
    });
  }
  if (/cancelled|aborted/i.test(message)) {
    return new NeonAuthCancelledError({ message });
  }
  return new NeonApiError({ message, cause });
}
