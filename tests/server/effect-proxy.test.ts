import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  UpstreamError,
  ValidationError,
  effectProxyHandler,
  fetchUpstreamEffect,
  proxiedPayloadResult,
} from "../../server/effect/proxy";

function mockRes() {
  let statusCode = 200;
  const headers: Record<string, string> = {};
  let json: unknown;
  let sent: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    set(name: string, value: string) {
      headers[name] = value;
      return this;
    },
    json(payload: unknown) {
      json = payload;
      return this;
    },
    send(payload: unknown) {
      sent = payload;
      return this;
    },
  };
  return {
    res,
    get statusCode() {
      return statusCode;
    },
    get json() {
      return json;
    },
    get sent() {
      return sent;
    },
    get headers() {
      return headers;
    },
  };
}

describe("proxiedPayloadResult", () => {
  test("parses JSON and falls back to text", () => {
    expect(proxiedPayloadResult(200, '{"ok":true}')).toEqual({
      kind: "json",
      status: 200,
      body: { ok: true },
    });
    expect(proxiedPayloadResult(204, "plain")).toEqual({
      kind: "text",
      status: 204,
      body: "plain",
    });
  });
});

describe("effectProxyHandler", () => {
  test("writes JSON proxy results", async () => {
    const route = effectProxyHandler(() =>
      Effect.succeed({
        kind: "json" as const,
        status: 201,
        body: { id: 1 },
      }),
    );
    const mocked = mockRes();
    await route({} as any, mocked.res as any, (() => undefined) as any);
    expect(mocked.statusCode).toBe(201);
    expect(mocked.json).toEqual({ id: 1 });
  });

  test("writes binary proxy results with exact bytes and Content-Type", async () => {
    const binaryData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
    const route = effectProxyHandler(() =>
      Effect.succeed({
        kind: "binary" as const,
        status: 200,
        body: binaryData,
        contentType: "image/png",
      }),
    );
    const mocked = mockRes();
    await route({} as any, mocked.res as any, (() => undefined) as any);
    expect(mocked.statusCode).toBe(200);
    expect(mocked.headers["Content-Type"]).toBe("image/png");
    expect(Buffer.isBuffer(mocked.sent)).toBe(true);
    expect(mocked.sent).toEqual(binaryData);
  });

  test("writes binary with fallback Content-Type when empty", async () => {
    const binaryData = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const route = effectProxyHandler(() =>
      Effect.succeed({
        kind: "binary" as const,
        status: 200,
        body: binaryData,
        contentType: "",
      }),
    );
    const mocked = mockRes();
    await route({} as any, mocked.res as any, (() => undefined) as any);
    expect(mocked.statusCode).toBe(200);
    expect(mocked.headers["Content-Type"]).toBe("application/octet-stream");
    expect(mocked.sent).toEqual(binaryData);
  });

  test("maps UpstreamError to 502 { success: false, error }", async () => {
    const route = effectProxyHandler(() =>
      Effect.fail(
        new UpstreamError({ message: "connect ECONNREFUSED", status: 502 }),
      ),
    );
    const mocked = mockRes();
    await route({} as any, mocked.res as any, (() => undefined) as any);
    expect(mocked.statusCode).toBe(502);
    expect(mocked.json).toEqual({
      success: false,
      error: "connect ECONNREFUSED",
    });
  });

  test("maps ValidationError status and custom error envelope", async () => {
    const route = effectProxyHandler(
      () =>
        Effect.fail(
          new ValidationError({
            message: "Invalid proxy host",
            status: 400,
          }),
        ),
      {
        errorBody: (error) => ({
          error:
            error &&
            typeof error === "object" &&
            "message" in error
              ? String((error as { message: unknown }).message)
              : "bad",
          requestId: "studio-test",
        }),
      },
    );
    const mocked = mockRes();
    await route({} as any, mocked.res as any, (() => undefined) as any);
    expect(mocked.statusCode).toBe(400);
    expect(mocked.json).toEqual({
      error: "Invalid proxy host",
      requestId: "studio-test",
    });
  });

  test("catches synchronous throws while building the program", async () => {
    const route = effectProxyHandler(() => {
      throw new Error("sync proxy boom");
    });
    const mocked = mockRes();
    await route({} as any, mocked.res as any, (() => undefined) as any);
    expect(mocked.statusCode).toBe(502);
    expect(mocked.json).toEqual({
      success: false,
      error: "sync proxy boom",
    });
  });
});

describe("fetchUpstreamEffect", () => {
  test("fails with UpstreamError when fetch rejects", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    try {
      const exit = await Effect.runPromiseExit(
        fetchUpstreamEffect("https://example.invalid/v1"),
      );
      expect(exit._tag).toBe("Failure");
    } finally {
      globalThis.fetch = original;
    }
  });
});
