/**
 * Tagged errors for PayKit and Stripe billing operations (Wave 6).
 * Reuses ValidationError and UpstreamError from server/effect/errors.ts.
 */
import { Data } from "effect";

export class StripeError extends Data.TaggedError("StripeError")<{
  message: string;
  status?: number;
}> {}

export class PaykitError extends Data.TaggedError("PaykitError")<{
  message: string;
  status?: number;
}> {}
