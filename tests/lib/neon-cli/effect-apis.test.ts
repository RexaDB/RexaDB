import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Cause, Effect, Exit, Option } from "effect";
import {
  detectNeonCliEffect,
  neonOrgsListEffect,
  neonProfileRemoveEffect,
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
import * as neonOauthApi from "@/lib/neon-oauth/api";

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
  const spies: Array<{ mockRestore: () => void }> = [];
  afterEach(() => {
    while (spies.length) spies.pop()?.mockRestore();
  });

  test("detectNeonCliEffect always reports builtin oauth", async () => {
    const result = await Effect.runPromise(detectNeonCliEffect());
    expect(result).toEqual({
      installed: true,
      version: "oauth",
      path: "builtin-oauth",
    });
  });

  test("neonOrgsListEffect remaps listOrgs session-expired into tagged failure", async () => {
    const listOrgsSpy = spyOn(neonOauthApi, "listOrgs").mockImplementation(
      async () => {
        throw new Error(NEON_SESSION_EXPIRED_MESSAGE);
      },
    );
    spies.push(listOrgsSpy);

    const exit = await Effect.runPromiseExit(neonOrgsListEffect("default"));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(listOrgsSpy).toHaveBeenCalledWith("default");
    if (Exit.isFailure(exit)) {
      const err = Cause.findErrorOption(exit.cause);
      expect(Option.isSome(err)).toBe(true);
      if (Option.isSome(err)) {
        expect(err.value).toBeInstanceOf(NeonSessionExpiredError);
        expect(err.value.message).toBe(NEON_SESSION_EXPIRED_MESSAGE);
      }
    }
  });

  test("neonProfileRemoveEffect succeeds for a sync profileRemove", async () => {
    const removeSpy = spyOn(neonOauthApi, "profileRemove").mockReturnValue({
      success: true as const,
    });
    spies.push(removeSpy);

    const result = await Effect.runPromise(
      neonProfileRemoveEffect("wave3-test-profile"),
    );
    expect(result).toEqual({ success: true });
    expect(removeSpy).toHaveBeenCalledWith("wave3-test-profile");
  });

  test("neonOrgsListEffect is an Effect (callable shape)", () => {
    const program = neonOrgsListEffect("default");
    expect(Effect.isEffect(program)).toBe(true);
  });
});
