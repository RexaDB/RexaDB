/**
 * Tagged errors for PayKit and Stripe billing operations (Wave 6).
 */
import { Data } from "effect";

export class ValidationError extends Data.TaggedError("ValidationError")<{
  message: string;
  status?: number;
}> {}

export class UpstreamError extends Data.TaggedError("UpstreamError")<{
  message: string;
  status?: number;
}> {}

export class StripeError extends Data.TaggedError("StripeError")<{
  message: string;
  status?: number;
}> {}

export class PaykitError extends Data.TaggedError("PaykitError")<{
  message: string;
  status?: number;
}> {}
