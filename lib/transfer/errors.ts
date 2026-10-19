/**
 * Tagged errors for the transfer domain (Effect Wave 2).
 * Expected transfer outcomes still often use `{ success: false }` in
 * TransferResult; these cover adapter/setup failures and unexpected throws.
 */
import { Data } from "effect";

/** No ProviderAdapter registered for the requested provider. */
export class TransferAdapterError extends Data.TaggedError("TransferAdapterError")<{
  readonly message: string;
  readonly provider?: string;
}> {}

/** Source or destination connection failed validation. */
export class TransferValidationError extends Data.TaggedError(
  "TransferValidationError",
)<{
  readonly message: string;
}> {}

/** Unexpected failure while creating the service or running a transfer step. */
export class TransferFailedError extends Data.TaggedError("TransferFailedError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type TransferError =
  | TransferAdapterError
  | TransferValidationError
  | TransferFailedError;
