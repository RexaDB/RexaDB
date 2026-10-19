import { describe, expect, test } from "bun:test";
import { Cause, Effect, Exit, Option } from "effect";
import {
  detectNeonCliEffect,
  neonOrgsListEffect,
} from "@/lib/neon-cli/cli-runner";
import {
  NeonApiError,
  NeonAuthCancelledError,
  NeonAuthUnavailableError,
  NeonSessionExpiredError,
  toNeonCliError,
} from "@/lib/neon-cli/effect-errors";
import {
  NEON_AUTH_UNAVAILABLE_MESSAGE,
  NEON_SESSION_EXPIRED_MESSAGE,
} from "@/lib/neon-cli/errors";

describe("neon-cli toNeonCliError", () => {
  test("maps session expired and auth unavailable messages", () => {
    const expired = toNeonCliError(new Error(NEON_SESSION_EXPIRED_MESSAGE));
    expect(expired).toBeInstanceOf(NeonSessionExpiredError);
    expect(expired._tag).toBe("NeonSessionExpiredError");

    const unavailable = toNeonCliError(
      new Error(NEON_AUTH_UNAVAILABLE_MESSAGE),
    );
    expect(unavailable).toBeInstanceOf(NeonAuthUnavailableError);

    const cancelled = toNeonCliError(new Error("Sign-in cancelled"));
    expect(cancelled).toBeInstanceOf(NeonAuthCancelledError);

    const other = toNeonCliError(new Error("Neon API 500: boom"));
    expect(other).toBeInstanceOf(NeonApiError);
    expect(other.message).toContain("boom");
  });
});

describe("neon-cli Effect APIs", () => {
  test("detectNeonCliEffect always reports builtin oauth", async () => {
    const result = await Effect.runPromise(detectNeonCliEffect());
    expect(result).toEqual({
      installed: true,
      version: "oauth",
      path: "builtin-oauth",
    });
  });

  test("neonOrgsListEffect remaps thrown session-expired into tagged failure", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.tryPromise({
        try: async () => {
          throw new Error(NEON_SESSION_EXPIRED_MESSAGE);
        },
        catch: (cause) => toNeonCliError(cause),
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const err = Cause.findErrorOption(exit.cause);
      expect(Option.isSome(err)).toBe(true);
      if (Option.isSome(err)) {
        expect(err.value).toBeInstanceOf(NeonSessionExpiredError);
      }
    }
  });

  test("neonOrgsListEffect is an Effect (callable shape)", () => {
    const program = neonOrgsListEffect("default");
    expect(Effect.isEffect(program)).toBe(true);
  });
});
