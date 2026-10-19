import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import {
  createStripeWebhookEndpointEffect,
} from "../../server/stripe";
import {
  getPaykitStatusEffect,
  pushPaykitSchemaEffect,
  setPaykitSecretsEffect,
} from "../../server/supabase-paykit";

describe("Stripe Effect API", () => {
  test("validates Stripe secret key format", async () => {
    const exit = await Effect.runPromiseExit(
      createStripeWebhookEndpointEffect({
        secretKey: "bad-key",
        url: "https://example.com/webhook",
        events: ["payment_intent.succeeded"],
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  test("validates URL is https", async () => {
    const exit = await Effect.runPromiseExit(
      createStripeWebhookEndpointEffect({
        secretKey: "sk_test_1234567890",
        url: "http://example.com/webhook",
        events: ["payment_intent.succeeded"],
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  test("validates events array non-empty", async () => {
    const exit = await Effect.runPromiseExit(
      createStripeWebhookEndpointEffect({
        secretKey: "sk_test_1234567890",
        url: "https://example.com/webhook",
        events: [],
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  test("validates events count <= 100", async () => {
    const events = Array.from({ length: 101 }, (_, i) => `event${i}`);
    const exit = await Effect.runPromiseExit(
      createStripeWebhookEndpointEffect({
        secretKey: "sk_test_1234567890",
        url: "https://example.com/webhook",
        events,
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("PayKit Effect API (wrapper tests)", () => {
  test("getPaykitStatusEffect validates missing token/ref", async () => {
    const exit = await Effect.runPromiseExit(
      getPaykitStatusEffect({}),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  test("pushPaykitSchemaEffect validates missing token/ref", async () => {
    const exit = await Effect.runPromiseExit(
      pushPaykitSchemaEffect({}),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  test("setPaykitSecretsEffect validates missing token/ref", async () => {
    const exit = await Effect.runPromiseExit(
      setPaykitSecretsEffect({}),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  test("setPaykitSecretsEffect validates no secrets provided", async () => {
    const exit = await Effect.runPromiseExit(
      setPaykitSecretsEffect({ token: "sbp_xxx", ref: "abc123", secrets: {} }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
